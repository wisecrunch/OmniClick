(async () => {
  const list = document.getElementById('features');
  const REC = 'tab-recorder';
  const recSection = document.getElementById('rec');
  const state = await OmniClickSettings.load();
  recSection.hidden = !state[REC];
  for (const f of OMNICLICK_FEATURES) {
    const li = document.createElement('li');
    const text = document.createElement('div');
    text.className = 'text';
    for (const [cls, value] of [['name', f.name], ['desc', f.description], ['site', f.site]]) {
      if (!value) continue;
      const el = document.createElement('div');
      el.className = cls;
      el.textContent = value;
      text.appendChild(el);
    }
    const label = document.createElement('label');
    label.className = 'switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = state[f.id];
    input.setAttribute('aria-label', f.name);
    input.addEventListener('change', async () => {
      await OmniClickSettings.set(f.id, input.checked);
      if (f.id === REC) {
        recSection.hidden = !input.checked;
        if (!input.checked) chrome.runtime.sendMessage({ type: 'rec-stop' });
      }
    });
    const track = document.createElement('span');
    track.className = 'track';
    label.append(input, track);
    li.append(text, label);
    list.appendChild(li);
  }
  // ---- Tab recorder panel ----
  const btn = document.getElementById('recBtn');
  const status = document.getElementById('recStatus');
  const optAudio = document.getElementById('optAudio');
  const optPointer = document.getElementById('optPointer');
  const optKeys = document.getElementById('optKeys');
  let timer = null;

  const { recOpts = { audio: true, pointer: true, keys: true } } = await chrome.storage.local.get('recOpts');
  optAudio.checked = recOpts.audio;
  optPointer.checked = recOpts.pointer;
  optKeys.checked = recOpts.keys;
  const readOpts = () => ({ audio: optAudio.checked, pointer: optPointer.checked, keys: optKeys.checked });
  [optAudio, optPointer, optKeys].forEach((o) => o.addEventListener('change', () => chrome.storage.local.set({ recOpts: readOpts() })));

  async function refreshRec() {
    const { rec } = await chrome.storage.session.get('rec');
    clearInterval(timer);
    [optAudio, optPointer, optKeys].forEach((o) => { o.disabled = !!rec; });
    if (rec) {
      btn.textContent = 'Stop and save';
      btn.classList.add('recording');
      const tick = () => {
        const s = Math.floor((Date.now() - rec.startedAt) / 1000);
        status.classList.remove('error');
        status.textContent = `Recording… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      };
      tick();
      timer = setInterval(tick, 1000);
    } else {
      btn.textContent = 'Start recording';
      btn.classList.remove('recording');
    }
    return !!rec;
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    if (await refreshRec()) {
      await chrome.runtime.sendMessage({ type: 'rec-stop' });
      window.close();
      return;
    }
    // Lets the cursor/typing overlay survive page navigation; recording works without it.
    // Must be requested straight from the click.
    await chrome.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const res = await chrome.runtime.sendMessage({ type: 'rec-start', tabId: tab.id, opts: readOpts() });
    if (res && res.ok) {
      window.close();
    } else {
      btn.disabled = false;
      status.textContent = (res && res.error) || 'Could not start recording.';
      status.classList.add('error');
    }
  });

  document.getElementById('openRecs').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('recordings.html') });
  });

  await refreshRec();
  btn.disabled = false;

  document.getElementById('manage-notes').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('notes.html') });
  });
  document.getElementById('drive-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
})();
