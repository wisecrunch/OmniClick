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
  const pauseBtn = document.getElementById('pauseBtn');
  const status = document.getElementById('recStatus');
  const checks = {
    audio: document.getElementById('optAudio'), pointer: document.getElementById('optPointer'),
    keys: document.getElementById('optKeys'), mic: document.getElementById('optMic'),
    allSites: document.getElementById('optAllSites'),
  };
  let timer = null;

  const { recOpts = {} } = await chrome.storage.local.get('recOpts');
  const saved = { audio: true, pointer: true, keys: true, mic: false, allSites: false, ...recOpts };
  for (const [k, input] of Object.entries(checks)) input.checked = saved[k];
  const readOpts = () => Object.fromEntries(Object.entries(checks).map(([k, input]) => [k, input.checked]));
  Object.values(checks).forEach((o) => o.addEventListener('change', () => chrome.storage.local.set({ recOpts: readOpts() })));

  async function refreshRec() {
    const { rec } = await chrome.storage.session.get('rec');
    clearInterval(timer);
    Object.values(checks).forEach((o) => { o.disabled = !!rec; });
    pauseBtn.hidden = !rec;
    if (rec) {
      btn.textContent = 'Stop and save';
      btn.classList.add('recording');
      pauseBtn.textContent = rec.paused ? 'Resume' : 'Pause';
      const tick = () => {
        const s = Math.max(0, Math.floor(((rec.pausedSince || Date.now()) - rec.startedAt - rec.pausedMs) / 1000));
        status.classList.remove('error');
        status.textContent = `${rec.paused ? 'Paused' : 'Recording…'} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      };
      tick();
      timer = setInterval(tick, 1000);
    } else {
      btn.textContent = 'Start recording';
      btn.classList.remove('recording');
    }
    return rec || null;
  }

  const fail = (text) => {
    status.textContent = text;
    status.classList.add('error');
  };

  pauseBtn.addEventListener('click', async () => {
    const rec = await refreshRec();
    if (!rec) return;
    pauseBtn.disabled = true;
    const res = await chrome.runtime.sendMessage({ type: rec.paused ? 'rec-resume' : 'rec-pause' });
    pauseBtn.disabled = false;
    if (res && res.ok) await refreshRec();
    else fail((res && res.error) || 'Could not change recording state.');
  });

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    if (await refreshRec()) {
      await chrome.runtime.sendMessage({ type: 'rec-stop' });
      window.close();
      return;
    }
    const opts = readOpts();
    // Permission prompts must be requested straight from the click.
    if (opts.allSites) await chrome.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
    if (opts.mic) {
      const perm = await navigator.permissions.query({ name: 'microphone' }).catch(() => null);
      if (!perm || perm.state !== 'granted') {
        chrome.tabs.create({ url: chrome.runtime.getURL('mic.html') });
        btn.disabled = false;
        fail('Allow the microphone in the tab that just opened, then start again.');
        return;
      }
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const res = await chrome.runtime.sendMessage({ type: 'rec-start', tabId: tab.id, opts });
    if (res && res.ok) {
      window.close();
    } else {
      btn.disabled = false;
      fail((res && res.error) || 'Could not start recording.');
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
