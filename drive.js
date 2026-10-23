(() => {
  const $ = (id) => document.getElementById(id);
  let state = {}, busy = false, versions = [], actionError = '';
  const manifest = chrome.runtime.getManifest();
  const configured = /^[\w-]+\.apps\.googleusercontent\.com$/.test(manifest.oauth2?.client_id || '');
  async function call(type, extra = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...extra });
    if (!response?.ok) throw new Error(response?.error || 'The extension did not respond. Reload OmniClick and try again.');
    return response.data;
  }
  function render() {
    $('connect').disabled = busy || state.syncing || !configured;
    $('connect').textContent = state.connected ? 'Sign in again' : 'Connect Google Drive';
    $('sync').disabled = busy || state.syncing || !state.connected;
    $('disconnect').disabled = busy || !state.connected;
    $('history-load').disabled = busy || !state.connected;
    $('drive-error').textContent = actionError || state.error || '';
    $('drive-state').textContent = state.connected ? `${state.email} · ${state.syncing ? 'Syncing…' :
      state.lastSync ? 'Last synced ' + new Date(state.lastSync).toLocaleString() : 'Waiting for first sync'}` :
      configured ? 'Not connected. Your notes are saved locally.' : 'Add your OAuth client ID below to enable Google sign-in.';
    if (state.connected && state.lastSync && !state.syncing) {
      $('drive-state').textContent += ` · ${state.uploaded || 0} uploaded, ${state.downloaded || 0} downloaded`;
      if (state.conflicts) $('drive-state').textContent += ` · ${state.conflicts} conflicts preserved in saved versions`;
      if (state.skipped) $('drive-state').textContent += ` · ${state.skipped} invalid Drive files skipped`;
    }
    $('folder').hidden = !state.connected || !state.folderId;
    if (state.folderId) $('folder').href = 'https://drive.google.com/drive/folders/' + encodeURIComponent(state.folderId);
  }
  async function load() {
    try { state = await call('drive-status'); render(); }
    catch (error) { $('drive-error').textContent = error.message; }
  }
  async function action(type) {
    busy = true; actionError = ''; render();
    try { state = await call(type); }
    catch (error) { await load(); actionError = error.message; }
    finally { busy = false; render(); }
  }
  $('connect').addEventListener('click', () => action('drive-connect'));
  $('sync').addEventListener('click', () => action('drive-sync'));
  $('disconnect').addEventListener('click', () => action('drive-disconnect'));
  $('extension-id').textContent = chrome.runtime.id;
  $('copy-id').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(chrome.runtime.id); $('setup-message').textContent = 'Extension ID copied.'; }
    catch { $('setup-message').textContent = 'Select the extension ID above and copy it.'; }
  });
  $('setup').open = !configured;
  $('configured-client').textContent = configured ? `Configured client: ${manifest.oauth2.client_id}` : 'No OAuth client ID has been configured yet.';
  $('client-id').value = manifest.oauth2?.client_id || '';
  $('configure').addEventListener('click', () => {
    const id = $('client-id').value.trim();
    if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)) {
      $('setup-message').textContent = 'Enter a valid OAuth client ID ending in .apps.googleusercontent.com.'; return;
    }
    const updated = { ...manifest, oauth2: { client_id: id, scopes: ['https://www.googleapis.com/auth/drive.file'] } };
    const url = URL.createObjectURL(new Blob([JSON.stringify(updated, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'manifest.json';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    $('setup-message').textContent = 'Replace manifest.json in your OmniClick folder with this file, then reload the extension. Downloading alone does not apply the configuration.';
  });
  function renderHistory() {
    const query = $('history-search').value.toLowerCase().trim();
    const nodes = versions.filter((file) => file.name.toLowerCase().includes(query)).map((file) => {
      const row = document.createElement('div'); row.className = 'version';
      const name = document.createElement('span'); name.textContent = file.name;
      const restore = document.createElement('button'); restore.type = 'button'; restore.textContent = 'Restore';
      restore.disabled = busy || !state.connected;
      restore.addEventListener('click', async () => {
        if (!confirm('Restore this saved version? It will become the current note and sync to your other computers.')) return;
        busy = true; render(); renderHistory();
        try { await call('drive-restore', { fileId: file.id }); $('history-message').textContent = 'Note restored and synced.'; await load(); }
        catch (error) { $('history-message').textContent = error.message; }
        finally { busy = false; render(); renderHistory(); }
      });
      row.append(name, restore); return row;
    });
    $('history').replaceChildren(...nodes);
  }
  $('history-search').addEventListener('input', renderHistory);
  $('history-load').addEventListener('click', async () => {
    busy = true; render();
    try { versions = await call('drive-history'); $('history-message').textContent = `${versions.length} saved versions.`; renderHistory(); }
    catch (error) { $('history-message').textContent = error.message; }
    finally { busy = false; render(); renderHistory(); }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['omniclick-drive:v1']) { state = changes['omniclick-drive:v1'].newValue || {}; render(); }
  });
  load();
})();
