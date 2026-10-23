(async () => {
  const list = document.getElementById('features');
  const state = await OmniClickSettings.load();
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
    input.addEventListener('change', () => OmniClickSettings.set(f.id, input.checked));
    const track = document.createElement('span');
    track.className = 'track';
    label.append(input, track);
    li.append(text, label);
    list.appendChild(li);
  }
  document.getElementById('manage-notes').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('notes.html') });
  });
  document.getElementById('drive-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
})();
