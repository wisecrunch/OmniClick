// Worker only: access tokens remain in Chrome's identity cache.
const OmniDrive = (() => {
  const scope = 'https://www.googleapis.com/auth/drive.file';
  const configKey = 'omniclick-drive:v1', basePrefix = 'omniclick-drive-base:v1:';
  const api = 'https://www.googleapis.com/drive/v3/', upload = 'https://www.googleapis.com/upload/drive/v3/';
  let syncing = null, debounce, epoch = 0, controller = null, configWrites = Promise.resolve();
  const config = async () => (await chrome.storage.local.get(configKey))[configKey] || { connected: false };
  const saveConfig = (value) => {
    const writeEpoch = epoch;
    configWrites = configWrites.catch(() => {}).then(() => {
      if (writeEpoch === epoch) return chrome.storage.local.set({ [configKey]: value });
    });
    return configWrites;
  };
  const configured = () => /^[\w-]+\.apps\.googleusercontent\.com$/.test(chrome.runtime.getManifest().oauth2?.client_id || '');
  async function token(interactive) {
    if (!configured()) throw new Error('Add your Google OAuth client ID in Drive setup, then reload OmniClick.');
    const result = await chrome.identity.getAuthToken({ interactive, scopes: [scope], enableGranularPermissions: true });
    const value = typeof result === 'string' ? result : result?.token;
    if (!value) throw new Error('Google sign-in is required. Click Connect Google Drive.');
    if (result.grantedScopes && !result.grantedScopes.includes(scope)) throw new Error('Allow access to files created by OmniClick to enable Drive sync.');
    return value;
  }
  async function request(path, options = {}, context) {
    if (context.epoch !== epoch) throw new Error('Sync stopped.');
    let auth = context.token;
    for (let attempt = 0; attempt < 2; ++attempt) {
      let response;
      try {
        response = await fetch((options.upload ? upload : api) + path, {
          method: options.method || 'GET', body: options.body,
          headers: { Authorization: `Bearer ${auth}`, ...options.headers },
          signal: AbortSignal.any([context.signal, AbortSignal.timeout(25000)]), cache: 'no-store', redirect: 'error',
        });
      } catch {
        if (context.epoch !== epoch) throw new Error('Sync stopped.');
        throw new Error('Could not reach Google Drive. Notes are safe locally; sync will retry.');
      }
      if (context.epoch !== epoch) throw new Error('Sync stopped.');
      if (response.status === 401 && !attempt) {
        await chrome.identity.removeCachedAuthToken({ token: auth }); context.token = auth = await token(false); continue;
      }
      if (!response.ok) {
        const details = await response.json().catch(() => ({}));
        const error = new Error(response.status === 401 ? 'Sign in again to reconnect Google Drive.' :
          `Google Drive (${response.status}): ${details.error?.message || response.statusText}`);
        error.status = response.status; throw error;
      }
      return response;
    }
  }
  async function json(path, options, context) { return (await request(path, options, context)).json(); }
  async function list(query, context) {
    const files = []; let pageToken;
    do {
      const params = new URLSearchParams({ q: query, pageSize: '1000', fields: 'nextPageToken,files(id,name,size,createdTime,modifiedTime,properties,parents,webViewLink)' });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await json('files?' + params, {}, context);
      files.push(...(page.files || [])); pageToken = page.nextPageToken;
    } while (pageToken);
    return files;
  }
  const marker = (kind) => `trashed = false and properties has { key='omniclick' and value='${kind}' }`;
  async function folder(kind, name, parent, context) {
    const matches = await list(marker(kind) + " and mimeType = 'application/vnd.google-apps.folder'", context);
    if (matches.length) return matches.sort((a, b) => (a.createdTime || '').localeCompare(b.createdTime || '') || a.id.localeCompare(b.id))[0].id;
    const created = await json('files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', properties: { omniclick: kind }, ...(parent ? { parents: [parent] } : {}) }) }, context);
    return created.id;
  }
  async function writeFile(metadata, data, context, fileId) {
    const boundary = 'omniclick_' + crypto.randomUUID().replaceAll('-', '');
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(data, null, 2)}\r\n--${boundary}--`;
    return json(`files${fileId ? '/' + encodeURIComponent(fileId) : ''}?uploadType=multipart&fields=id,name,webViewLink`, {
      upload: true, method: fileId ? 'PATCH' : 'POST', body, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    }, context);
  }
  function filename(note) {
    const title = (note.subject || 'No subject').replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').slice(0, 70);
    return `${note.deleted ? '[Deleted] ' : ''}${note.account} - ${title} - ${note.thread.slice(-16)}.json`;
  }
  const wrap = (note) => ({ format: 'omniclick-drive-note', version: 1, note: OmniNotes.clean(note) });
  async function hash(value) {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map((n) => n.toString(16).padStart(2, '0')).join('');
  }
  const compare = (a, b) => a.updatedAt - b.updatedAt || OmniNotes.fingerprint(a).localeCompare(OmniNotes.fingerprint(b));
  async function archive(note, keyHash, parent, context) {
    const digest = await hash(OmniNotes.fingerprint(note));
    if ((await list(marker('backup-v1') + ` and properties has { key='digest' and value='${digest}' }`, context)).length) return;
    await writeFile({ name: `${new Date(note.updatedAt).toISOString().replaceAll(':', '-')} - ${filename(note)}`,
      parents: [parent], properties: { omniclick: 'backup-v1', noteKey: keyHash, digest } }, wrap(note), context);
  }
  async function readNote(file, context) {
    if (Number(file.size) > 150000) throw new Error('Note file is too large.');
    const raw = await (await request(`files/${encodeURIComponent(file.id)}?alt=media`, {}, context)).text();
    if (raw.length > 150000) throw new Error('Note file is too large.');
    const data = JSON.parse(raw);
    if (data.format !== 'omniclick-drive-note' || data.version !== 1 || !OmniNotes.valid(data.note)) throw new Error('Invalid OmniClick note file.');
    return OmniNotes.clean(data.note);
  }
  async function run(context, state) {
    const root = await folder('root-v1', 'OmniClick Notes', null, context);
    const notesFolder = await folder('notes-folder-v1', 'Notes', root, context);
    const backupFolder = await folder('backups-folder-v1', 'Backups', root, context);
    state.folderId = root;
    const local = new Map((await OmniNotes.records()).filter((n) => n.account === state.email).map((n) => [OmniNotes.key(n.account, n.thread), n]));
    const remote = new Map(); let skipped = 0, conflicts = 0, uploaded = 0, downloaded = 0;
    for (const file of await list(marker('note-v1'), context)) {
      try {
        const note = await readNote(file, context);
        if (note.account !== state.email) continue;
        const k = OmniNotes.key(note.account, note.thread), records = remote.get(k) || [];
        records.push({ file, note }); remote.set(k, records);
      } catch (error) {
        if (error.status || context.epoch !== epoch || error.message.startsWith('Could not reach')) throw error;
        ++skipped;
      }
    }
    for (const k of new Set([...local.keys(), ...remote.keys()])) {
      if (context.epoch !== epoch) throw new Error('Sync stopped.');
      const keyHash = await hash(k), baseKey = `${basePrefix}${state.permissionId}:${keyHash}`;
      const base = (await chrome.storage.local.get(baseKey))[baseKey], localNote = local.get(k), remoteItems = remote.get(k) || [];
      const remoteNote = [...remoteItems].sort((a, b) => compare(b.note, a.note))[0]?.note;
      const localPrint = OmniNotes.fingerprint(localNote), remotePrint = OmniNotes.fingerprint(remoteNote);
      if (localPrint && remotePrint && localPrint !== remotePrint && (!base || (localPrint !== base.fingerprint && remotePrint !== base.fingerprint))) ++conflicts;
      // Archive every upload BEFORE updating current files, preserving concurrent edits.
      if (localNote && localPrint !== remotePrint) await archive(localNote, keyHash, backupFolder, context);
      const winner = [...(localNote ? [localNote] : []), ...remoteItems.map((item) => item.note)].sort((a, b) => compare(b, a))[0];
      if (!winner) continue;
      const winnerPrint = OmniNotes.fingerprint(winner);
      if (winnerPrint !== remotePrint || remoteItems.some((item) => OmniNotes.fingerprint(item.note) !== winnerPrint)) {
        for (const item of remoteItems) if (OmniNotes.fingerprint(item.note) !== winnerPrint) await archive(item.note, keyHash, backupFolder, context);
        await archive(winner, keyHash, backupFolder, context);
        const destinations = remoteItems.filter((item) => OmniNotes.fingerprint(item.note) !== winnerPrint);
        if (!remoteItems.length) destinations.push({ file: null });
        for (const destination of destinations) {
          const metadata = { name: filename(winner), properties: { omniclick: 'note-v1', noteKey: keyHash } };
          if (!destination.file) metadata.parents = [notesFolder];
          await writeFile(metadata, wrap(winner), context, destination.file?.id); ++uploaded;
        }
      }
      // An edit arriving while Drive loads must not be overwritten by its older snapshot.
      if (winnerPrint !== localPrint && await OmniNotes.replaceIf(winner, localPrint)) ++downloaded;
      if (context.epoch !== epoch) throw new Error('Sync stopped.');
      await chrome.storage.local.set({ [baseKey]: { fingerprint: winnerPrint } });
    }
    return { uploaded, downloaded, conflicts, skipped };
  }
  async function sync() {
    if (syncing) return syncing;
    const thisEpoch = epoch;
    syncing = (async () => {
      const state = await config();
      if (!state.connected) return state;
      const context = { epoch: thisEpoch, signal: (controller = new AbortController()).signal };
      try {
        await saveConfig({ ...state, syncing: true, error: '' });
        context.token = await token(false);
        const about = await json('about?fields=user(emailAddress,permissionId)', {}, context);
        if (about.user?.permissionId !== state.permissionId) throw new Error('Google account changed. Disconnect and connect the correct account.');
        const counts = await run(context, state);
        if (thisEpoch === epoch) await saveConfig({ ...state, ...counts, syncing: false, error: '', lastSync: Date.now() });
      } catch (error) {
        if (thisEpoch === epoch) await saveConfig({ ...state, syncing: false, error: String(error?.message || 'Drive sync failed.').slice(0, 400) });
        throw error;
      }
      return config();
    })().finally(() => { syncing = null; controller = null; });
    return syncing;
  }
  async function connect() {
    if (syncing) throw new Error('Wait for the current sync to finish.');
    const thisEpoch = ++epoch;
    const context = { epoch: thisEpoch, signal: new AbortController().signal, token: await token(true) };
    const user = (await json('about?fields=user(emailAddress,permissionId)', {}, context)).user;
    if (!user?.emailAddress || !user.permissionId) throw new Error('Could not identify your Google Drive account.');
    await saveConfig({ connected: true, email: user.emailAddress.toLowerCase(), permissionId: user.permissionId, syncing: false, error: '' });
    await chrome.alarms.create('omniclick-drive-sync', { periodInMinutes: 5, delayInMinutes: 5 });
    return sync();
  }
  async function disconnect() {
    ++epoch; if (controller) controller.abort(); clearTimeout(debounce);
    await chrome.alarms.clear('omniclick-drive-sync'); await saveConfig({ connected: false });
    await chrome.identity.clearAllCachedAuthTokens(); return config();
  }
  async function historyContext() {
    const state = await config();
    if (!state.connected) throw new Error('Connect Google Drive first.');
    const context = { epoch, signal: new AbortController().signal, token: await token(false) };
    const user = (await json('about?fields=user(permissionId)', {}, context)).user;
    if (user?.permissionId !== state.permissionId) throw new Error('Reconnect the correct Google account.');
    return { context, state };
  }
  async function history() {
    const { context } = await historyContext();
    return (await list(marker('backup-v1'), context)).sort((a, b) => (b.createdTime || '').localeCompare(a.createdTime || ''));
  }
  async function restore(fileId) {
    if (!/^[\w-]{1,200}$/.test(fileId || '')) throw new Error('Invalid backup file.');
    const { context, state } = await historyContext();
    const file = await json(`files/${encodeURIComponent(fileId)}?fields=id,size,properties,trashed`, {}, context);
    if (file.trashed || file.properties?.omniclick !== 'backup-v1') throw new Error('Not an OmniClick backup file.');
    const note = await readNote(file, context);
    if (note.account !== state.email) throw new Error('This backup belongs to another mailbox.');
    if (note.deleted) throw new Error('This version records a deletion. Select an earlier version containing text.');
    await sync();
    if (context.epoch !== epoch || !(await config()).connected) throw new Error('Drive disconnected. Reconnect before restoring a version.');
    const previous = (await OmniNotes.records()).find((n) => OmniNotes.key(n.account, n.thread) === OmniNotes.key(note.account, note.thread));
    await OmniNotes.put({ ...note, updatedAt: Math.max(Date.now(), (previous?.updatedAt || 0) + 1), deleted: false });
    await sync(); return { restored: true };
  }
  function schedule() { clearTimeout(debounce); debounce = setTimeout(() => sync().catch(() => {}), 4000); }
  async function init() {
    if ((await config()).connected) {
      await chrome.alarms.create('omniclick-drive-sync', { periodInMinutes: 5, delayInMinutes: 1 }); schedule();
    }
  }
  return { configKey, configured, config, sync, connect, disconnect, history, restore, schedule, init };
})();
