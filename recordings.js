const selectedId = new URLSearchParams(location.search).get('id');
const listEl = document.getElementById('list');

const fmtSize = (b) => (b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.ceil(b / 1e3) + ' KB');
const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;
const extOf = (mime) => (mime.includes('mp4') ? 'mp4' : 'webm');
const fileStem = (rec) => 'OmniClick-' + new Date(rec.createdAt).toISOString().slice(0, 16).replace(/[:T]/g, '-');

function el(tag, props = {}, ...kids) {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
}

function field(label, control) {
  return el('div', {}, el('label', { textContent: label }), control);
}

function buildCard(rec) {
  const url = URL.createObjectURL(rec.blob);
  const card = el('div', { className: 'card' + (rec.id === selectedId ? ' selected' : '') });
  const video = el('video', { src: url, controls: true, preload: 'metadata' });
  // WebM from MediaRecorder has no duration; seeking to the end once makes the browser compute it.
  video.addEventListener('loadedmetadata', () => {
    if (video.duration !== Infinity) return;
    video.currentTime = 1e101;
    video.addEventListener('timeupdate', () => { video.currentTime = 0; }, { once: true });
  });
  const meta = el('div', { className: 'meta' },
    el('span', { textContent: new Date(rec.createdAt).toLocaleString() }),
    el('span', { textContent: fmtDur(rec.duration) }),
    el('span', { textContent: fmtSize(rec.size) }),
    el('span', { textContent: extOf(rec.mime).toUpperCase() }));

  const download = el('button', { type: 'button', className: 'primary', textContent: 'Download' });
  download.addEventListener('click', () => {
    const a = el('a', { href: url, download: `${fileStem(rec)}.${extOf(rec.mime)}` });
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
  const del = el('button', { type: 'button', className: 'danger', textContent: 'Delete' });
  del.addEventListener('click', async () => {
    if (!confirm('Delete this recording? This cannot be undone.')) return;
    await OmniDB.delete(rec.id);
    URL.revokeObjectURL(url);
    card.remove();
    if (!listEl.children.length) document.getElementById('empty').hidden = false;
  });

  // YouTube upload form
  const title = el('input', { type: 'text', value: 'Screen recording ' + new Date(rec.createdAt).toLocaleDateString() });
  const desc = el('textarea', { rows: 3 });
  const privacy = el('select', {},
    el('option', { value: 'private', textContent: 'Private' }),
    el('option', { value: 'unlisted', textContent: 'Unlisted' }),
    el('option', { value: 'public', textContent: 'Public' }));
  const upload = el('button', { type: 'button', className: 'primary', textContent: 'Upload to YouTube' });
  const progress = el('progress', { max: 1, value: 0, hidden: true });
  const status = el('div', { className: 'status', role: 'status' });
  upload.addEventListener('click', async () => {
    if (!title.value.trim()) { status.className = 'status error'; status.textContent = 'Enter a title.'; return; }
    upload.disabled = true;
    status.className = 'status';
    status.textContent = 'Signing in to Google…';
    try {
      progress.hidden = false;
      const video = await YouTube.upload(rec.blob, { title: title.value.trim(), description: desc.value, privacy: privacy.value }, (p) => {
        progress.value = p;
        status.textContent = `Uploading… ${Math.round(p * 100)}%`;
      });
      const link = el('a', { href: 'https://youtu.be/' + video.id, target: '_blank', rel: 'noopener', textContent: 'https://youtu.be/' + video.id });
      status.replaceChildren('Uploaded: ', link, ' (YouTube may take a few minutes to process it)');
    } catch (err) {
      status.className = 'status error';
      status.textContent = 'Upload failed: ' + err.message;
      if (/Client ID/.test(err.message)) document.getElementById('setup').open = true;
    }
    upload.disabled = false;
  });
  const yt = el('div', { className: 'yt' },
    field('YouTube title', title), field('Description', desc), field('Visibility', privacy),
    el('div', { className: 'actions' }, upload), progress, status);

  card.append(video, meta, el('div', { className: 'actions' }, download, del), yt);
  return card;
}

// Recordings that never finished (crash or power loss) still have their chunks on disk; turn them into recordings.
async function recoverOrphans() {
  const { rec } = await chrome.storage.session.get('rec');
  for (const rid of await OmniDB.orphanIds()) {
    if (rec && rec.rid === rid) continue;
    const parts = await OmniDB.chunks(rid);
    if (!parts.length) continue;
    const blob = new Blob(parts.map((p) => p.blob), { type: parts[0].mime });
    await OmniDB.put({ id: rid, mime: parts[0].mime, size: blob.size, createdAt: parts[0].startedAt, duration: parts.length, blob, recovered: true });
    await OmniDB.deleteChunks(rid);
  }
}

async function render() {
  await recoverOrphans().catch(() => {});
  const all = (await OmniDB.all()).sort((a, b) => b.createdAt - a.createdAt);
  listEl.replaceChildren(...all.map(buildCard));
  document.getElementById('empty').hidden = all.length > 0;
  const selected = listEl.querySelector('.selected');
  if (selected) selected.scrollIntoView({ block: 'start' });
}

(async () => {
  document.getElementById('redirect').textContent = chrome.identity.getRedirectURL();
  document.getElementById('copyRedirect').addEventListener('click', () => navigator.clipboard.writeText(chrome.identity.getRedirectURL()));
  const clientInput = document.getElementById('clientId');
  clientInput.value = await YouTube.getClientId();
  document.getElementById('saveClient').addEventListener('click', async () => {
    await chrome.storage.sync.set({ ytClientId: clientInput.value.trim() });
    document.getElementById('clientStatus').textContent = 'Saved.';
  });
  await render();
})();
