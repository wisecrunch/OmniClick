// Offscreen document: owns the MediaRecorder, because service workers can't use getUserMedia.
// Chunks are written to IndexedDB as they arrive, so long recordings don't sit in memory.
const DEFAULT_MAX_MINUTES = 120;
const MIN_FREE_START = 500e6;
const MIN_FREE_RUNNING = 200e6;

let recorder = null;
let stopped = null;
let tabStream = null;
let micStream = null;
let audioCtx = null;
let mime = '';
let rid = '';
let seq = 0;
let writes = Promise.resolve();
let startedAt = 0;
let pausedAt = 0;
let pausedTotal = 0;
let limitTimer = null;
let spaceTimer = null;

// MP4 (H.264) first: YouTube accepts it as-is and every editor opens it. WebM is the fallback.
const WITH_AUDIO = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2',
  'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm',
];
const VIDEO_ONLY = [
  'video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4',
  'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm',
];

const requestStop = () => chrome.runtime.sendMessage({ type: 'rec-stop' }).catch(() => {});

async function freeSpace() {
  const { quota = 0, usage = 0 } = await navigator.storage.estimate();
  return quota - usage;
}

function release() {
  clearTimeout(limitTimer);
  clearInterval(spaceTimer);
  for (const s of [tabStream, micStream]) if (s) s.getTracks().forEach((t) => t.stop());
  if (audioCtx) audioCtx.close();
  recorder = stopped = tabStream = micStream = audioCtx = null;
}

async function start({ streamId, opts }) {
  if (recorder) throw new Error('Already recording');
  if ((await freeSpace()) < MIN_FREE_START) throw new Error('Not enough free disk space to record (need about 500 MB).');
  const source = { chromeMediaSource: 'tab', chromeMediaSourceId: streamId };
  const constraints = {
    video: { mandatory: { ...source, maxWidth: 3840, maxHeight: 2160, maxFrameRate: 30 } },
  };
  if (opts.audio) constraints.audio = { mandatory: source };
  tabStream = await navigator.mediaDevices.getUserMedia(constraints);

  try {
    if (opts.mic) {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
        .catch(() => { throw new Error('Microphone access was not granted. Tick "Narrate with microphone" in the popup to allow it.'); });
    }

    let recordStream = tabStream;
    if (tabStream.getAudioTracks().length || micStream) {
      // Mix tab audio and microphone into one track. Capturing a tab mutes it for the user,
      // so the tab audio is also played back (the microphone is not, to avoid echo).
      audioCtx = new AudioContext();
      const mix = audioCtx.createMediaStreamDestination();
      if (tabStream.getAudioTracks().length) {
        const tabSource = audioCtx.createMediaStreamSource(tabStream);
        tabSource.connect(mix);
        tabSource.connect(audioCtx.destination);
      }
      if (micStream) audioCtx.createMediaStreamSource(micStream).connect(mix);
      recordStream = new MediaStream([...tabStream.getVideoTracks(), ...mix.stream.getAudioTracks()]);
    }

    const hasAudio = recordStream.getAudioTracks().length > 0;
    mime = (hasAudio ? WITH_AUDIO : VIDEO_ONLY).find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) throw new Error('This browser cannot record video');

    rid = crypto.randomUUID();
    seq = 0;
    writes = Promise.resolve();
    startedAt = Date.now();
    pausedAt = pausedTotal = 0;
    const meta = { mime: mime.split(';')[0], startedAt };

    recorder = new MediaRecorder(recordStream, { mimeType: mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 128_000 });
    stopped = new Promise((resolve) => { recorder.onstop = resolve; });
    recorder.ondataavailable = (e) => {
      if (!e.data.size) return;
      const n = seq++;
      writes = writes.then(() => OmniDB.putChunk(rid, n, e.data, meta)).catch(requestStop);
    };
    recorder.start(1000);

    const maxMinutes = opts.maxMinutes > 0 ? opts.maxMinutes : DEFAULT_MAX_MINUTES;
    limitTimer = setTimeout(requestStop, maxMinutes * 60000);
    spaceTimer = setInterval(async () => { if ((await freeSpace()) < MIN_FREE_RUNNING) requestStop(); }, 15000);
    return rid;
  } catch (err) {
    release();
    throw err;
  }
}

function pause() {
  if (!recorder || recorder.state !== 'recording') return;
  recorder.pause();
  pausedAt = Date.now();
}

function resume() {
  if (!recorder || recorder.state !== 'paused') return;
  recorder.resume();
  pausedTotal += Date.now() - pausedAt;
  pausedAt = 0;
}

async function stop() {
  if (!recorder) throw new Error('Not recording');
  if (pausedAt) { pausedTotal += Date.now() - pausedAt; pausedAt = 0; }
  const duration = (Date.now() - startedAt - pausedTotal) / 1000;
  const id = rid;
  const type = mime.split(';')[0];
  if (recorder.state !== 'inactive') recorder.stop();
  await stopped;
  release();
  await writes;

  const parts = await OmniDB.chunks(id);
  const blob = new Blob(parts.map((p) => p.blob), { type });
  await OmniDB.put({ id, mime: type, size: blob.size, createdAt: startedAt, duration, blob });
  await OmniDB.deleteChunks(id);
  return id;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;
  const reply = (p, ok) => p.then((v) => sendResponse({ ok: true, ...ok(v) }), (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  if (msg.type === 'start') reply(start(msg), (id) => ({ id }));
  else if (msg.type === 'stop') reply(stop(), (id) => ({ id }));
  else if (msg.type === 'pause') reply(Promise.resolve(pause()), () => ({}));
  else if (msg.type === 'resume') reply(Promise.resolve(resume()), () => ({}));
  else return;
  return true;
});
