const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const clone = (x) => x === undefined ? undefined : structuredClone(x);
class DriveMock {
  constructor() { this.files = new Map(); this.counter = 0; this.user = { emailAddress: 'igor@example.com', permissionId: 'user1' }; this.uploads = 0; }
  async fetch(input, options = {}) {
    if (this.offline) throw new Error('offline');
    if (this.failNext) { const status = this.failNext; this.failNext = null; return Response.json({ error: { message: 'Mock failure' } }, { status }); }
    const url = new URL(input), method = options.method || 'GET';
    assert.match(options.headers.Authorization, /^Bearer test-token$/);
    if (url.pathname.endsWith('/about')) return Response.json({ user: this.user });
    if (url.pathname.startsWith('/upload/')) {
      const boundary = options.headers['Content-Type'].split('boundary=')[1];
      const parts = options.body.split('--' + boundary).filter((p) => p.includes('Content-Type:'));
      const [metadata, data] = parts.map((p) => JSON.parse(p.slice(p.indexOf('\r\n\r\n') + 4).trim()));
      let file;
      if (method === 'PATCH') { file = this.files.get(url.pathname.split('/').at(-1)); assert.ok(file); Object.assign(file, metadata); }
      else { file = this.create(metadata); }
      file.data = data; file.size = String(Buffer.byteLength(JSON.stringify(data))); ++this.uploads;
      return Response.json(file);
    }
    if (url.pathname.endsWith('/files') && method === 'POST') return Response.json(this.create(JSON.parse(options.body)));
    if (url.pathname.endsWith('/files')) {
      const q = url.searchParams.get('q') || '';
      const props = [...q.matchAll(/key='([^']+)' and value='([^']+)'/g)];
      let files = [...this.files.values()].filter((f) => !f.trashed && props.every(([, k, v]) => f.properties?.[k] === v));
      if (q.includes("mimeType = 'application/vnd.google-apps.folder'")) files = files.filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
      return Response.json({ files: files.map(({ data, ...f }) => f) });
    }
    const file = this.files.get(url.pathname.split('/').at(-1));
    if (!file) return Response.json({ error: { message: 'Missing' } }, { status: 404 });
    if (url.searchParams.get('alt') === 'media') {
      if (this.beforeMedia) { const fn = this.beforeMedia; this.beforeMedia = null; await fn(); }
      return Response.json(file.data);
    }
    return Response.json(file);
  }
  create(metadata) {
    const file = { ...clone(metadata), id: 'file' + ++this.counter, createdTime: new Date(Date.now() + this.counter).toISOString() };
    this.files.set(file.id, file); return file;
  }
  current() { return [...this.files.values()].filter((f) => f.properties?.omniclick === 'note-v1'); }
  backups() { return [...this.files.values()].filter((f) => f.properties?.omniclick === 'backup-v1'); }
}
function client(cloud, configured = true) {
  const local = {}, calls = [];
  const storage = {
    async get(keys) { return clone(keys === null ? local : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((k) => [k, local[k]]))); },
    async set(data) { Object.assign(local, clone(data)); },
    async remove(key) { delete local[key]; },
  };
  const chrome = {
    storage: { local: storage }, runtime: { getManifest: () => configured ? { oauth2: { client_id: '123-test.apps.googleusercontent.com' } } : {} },
    identity: {
      async getAuthToken(request) { calls.push(request); return { token: 'test-token', grantedScopes: ['https://www.googleapis.com/auth/drive.file'] }; },
      async removeCachedAuthToken() { calls.push('removeToken'); }, async clearAllCachedAuthTokens() { calls.push('clearTokens'); },
    },
    alarms: { async create() {}, async clear() {} },
  };
  const sandbox = vm.createContext({ chrome, fetch: cloud.fetch.bind(cloud), crypto: webcrypto, TextEncoder, URLSearchParams, AbortSignal, AbortController, console, setTimeout, clearTimeout });
  for (const f of ['notes-store.js', 'drive-sync.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox);
  vm.runInContext('globalThis.store = OmniNotes; globalThis.drive = OmniDrive;', sandbox);
  return { store: sandbox.store, drive: sandbox.drive, local, calls };
}
const note = (text, time = Date.now()) => ({ version: 1, account: 'igor@example.com', thread: '18fedcba12345678', subject: 'Reservation', text, color: 'yellow', done: false, updatedAt: time });
module.exports = { DriveMock };
if (require.main === module) (async () => {
  const cloud = new DriveMock(), a = client(cloud), b = client(cloud);
  await a.store.put(note('Initial note'));
  await a.store.put({ ...note('Other mailbox'), account: 'other@example.com' });
  await a.drive.connect();
  assert.equal(cloud.current().length, 1); assert.equal(cloud.backups().length, 1);
  assert.equal(cloud.current()[0].data.note.account, 'igor@example.com');
  assert.equal([...cloud.files.values()].filter((f) => f.mimeType === 'application/vnd.google-apps.folder').length, 3);
  assert.equal(cloud.current()[0].name.endsWith('.json'), true);
  const uploads = cloud.uploads; await a.drive.sync(); assert.equal(cloud.uploads, uploads, 'unchanged notes do not upload again');
  await b.drive.connect();
  assert.equal((await b.store.all())[0].text, 'Initial note');
  // Both computers edit offline: preserve both versions and converge.
  const baseTime = Date.now() + 100;
  await a.store.put(note('Newer edit from A', baseTime + 200));
  await b.store.put(note('Older concurrent edit from B', baseTime + 100));
  await a.drive.sync(); await b.drive.sync();
  assert.equal((await b.store.all())[0].text, 'Newer edit from A');
  assert.equal((await b.drive.config()).conflicts, 1);
  assert.ok(cloud.backups().some((f) => f.data.note.text === 'Older concurrent edit from B'));
  assert.ok(cloud.backups().some((f) => f.data.note.text === 'Newer edit from A'));
  // Deletions remain tombstones and reach the other computer.
  await a.store.put({ ...(await a.store.all()).find((n) => n.account === 'igor@example.com'), text: '' });
  await a.drive.sync(); await b.drive.sync();
  assert.equal((await b.store.all()).length, 0);
  assert.equal(cloud.current()[0].data.note.deleted, true);
  const initialBackup = cloud.backups().find((f) => f.data.note.text === 'Initial note');
  await b.drive.restore(initialBackup.id); await a.drive.sync();
  assert.equal((await a.store.all()).find((n) => n.account === 'igor@example.com').text, 'Initial note');
  // Offline edits survive failed requests and upload on a later retry.
  cloud.offline = true;
  await b.store.put(note('Offline edit', baseTime + 1000));
  await assert.rejects(() => b.drive.sync(), /Could not reach/);
  assert.equal((await b.store.all())[0].text, 'Offline edit');
  assert.match((await b.drive.config()).error, /safe locally/);
  cloud.offline = false; await b.drive.sync();
  assert.equal(cloud.current()[0].data.note.text, 'Offline edit');
  // Expired tokens get one refresh; a different Drive identity never receives notes.
  cloud.failNext = 401; await b.drive.sync(); assert.ok(b.calls.includes('removeToken'));
  const uploadsBeforeMismatch = cloud.uploads;
  cloud.user = { emailAddress: 'other@example.com', permissionId: 'user2' };
  await assert.rejects(() => b.drive.sync(), /account changed/);
  assert.equal(cloud.uploads, uploadsBeforeMismatch);
  cloud.user = { emailAddress: 'igor@example.com', permissionId: 'user1' };
  // Remote data arriving after a fresh local edit cannot replace that edit.
  await a.drive.sync();
  await b.store.put(note('Remote new version', baseTime + 2000)); await b.drive.sync();
  cloud.beforeMedia = () => a.store.put(note('Typed while syncing', baseTime + 3000));
  await a.drive.sync();
  assert.equal((await a.store.all()).find((n) => n.account === 'igor@example.com').text, 'Typed while syncing');
  await a.drive.sync();
  assert.equal(cloud.current()[0].data.note.text, 'Typed while syncing');
  // Malformed remote files are skipped; valid notes still sync.
  cloud.create({ name: 'Invalid.json', properties: { omniclick: 'note-v1' }, data: { bad: true } });
  await a.drive.sync(); assert.equal((await a.drive.config()).skipped, 1);
  assert.ok((await a.drive.history()).length >= 5);
  assert.equal(JSON.stringify(a.local).includes('test-token'), false, 'tokens are not stored with note data');
  await a.drive.disconnect(); const afterDisconnect = cloud.uploads; await a.drive.sync();
  assert.equal(cloud.uploads, afterDisconnect); assert.ok(a.calls.includes('clearTokens'));
  assert.ok((await a.store.all()).length > 0, 'disconnect retains notes');
  await assert.rejects(() => client(cloud, false).drive.connect(), /OAuth client ID/);
  console.log('PASS: visible folders/files, initial upload and migration, second-computer download, no-op sync, account separation, offline retry, token refresh, conflicting edits preserved, deletion sync, saved-version restore, local edits during sync, malformed files, disconnect, missing OAuth setup.');
})().catch((error) => { console.error(error); process.exit(1); });
