// Offscreen document: owns the MediaRecorder, because service workers can't use getUserMedia.
let recorder = null;
let stopped = null;
let stream = null;
let audioCtx = null;
let chunks = [];
let mime = '';
let startedAt = 0;

// MP4 (H.264) first: YouTube accepts it as-is and every editor opens it. WebM is the fallback.
const WITH_AUDIO = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2',
  'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm',
];
const VIDEO_ONLY = [
  'video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4',
  'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm',
];

async function start({ streamId, opts }) {
  if (recorder) throw new Error('Already recording');
  const source = { chromeMediaSource: 'tab', chromeMediaSourceId: streamId };
  const constraints = {
    video: { mandatory: { ...source, maxWidth: 3840, maxHeight: 2160, maxFrameRate: 30 } },
  };
  if (opts.audio) constraints.audio = { mandatory: source };
  stream = await navigator.mediaDevices.getUserMedia(constraints);

  const hasAudio = stream.getAudioTracks().length > 0;
  if (hasAudio) {
    // Capturing a tab mutes it for the user; play it back so they still hear it.
    audioCtx = new AudioContext();
    audioCtx.createMediaStreamSource(stream).connect(audioCtx.destination);
  }
  mime = (hasAudio ? WITH_AUDIO : VIDEO_ONLY).find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error('This browser cannot record video');

  chunks = [];
  recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 128_000 });
  stopped = new Promise((resolve) => { recorder.onstop = resolve; });
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.start(1000);
  startedAt = Date.now();
}

async function stop() {
  if (!recorder) throw new Error('Not recording');
  if (recorder.state !== 'inactive') recorder.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  if (audioCtx) audioCtx.close();

  const type = mime.split(';')[0];
  const blob = new Blob(chunks, { type });
  const id = crypto.randomUUID();
  await OmniDB.put({
    id,
    mime: type,
    size: blob.size,
    createdAt: startedAt,
    duration: (Date.now() - startedAt) / 1000,
    blob,
  });
  recorder = stopped = stream = audioCtx = null;
  chunks = [];
  return id;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;
  const reply = (p, ok) => p.then((v) => sendResponse({ ok: true, ...ok(v) }), (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  if (msg.type === 'start') reply(start(msg), () => ({}));
  else if (msg.type === 'stop') reply(stop(), (id) => ({ id }));
  else return;
  return true;
});
