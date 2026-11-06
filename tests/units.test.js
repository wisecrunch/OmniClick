// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(file, expr, globals = {}) {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  return vm.runInNewContext(`${src}\n;${expr}`, { console, BigInt, ...globals });
}

function wav(format, blocks, rate = 8000) {
  const align = 65, dataLen = blocks * align;
  const buf = new ArrayBuffer(44 + dataLen), dv = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, format, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint16(32, align, true);
  w(36, 'data'); dv.setUint32(40, dataLen, true);
  return buf;
}

test('gsm: non-GSM input is passed through as null', () => {
  const { toPcmWav } = load('gsm.js', 'GapGsm');
  assert.strictEqual(toPcmWav(new Uint8Array(100).buffer), null);
  assert.strictEqual(toPcmWav(wav(1, 2)), null);
});

test('gsm: WAV49 decodes to PCM WAV of the right size and rate', () => {
  const { toPcmWav } = load('gsm.js', 'GapGsm');
  const out = toPcmWav(wav(49, 3, 8000));
  assert.ok(out);
  const dv = new DataView(out);
  assert.strictEqual(String.fromCharCode(...new Uint8Array(out, 0, 4)), 'RIFF');
  assert.strictEqual(dv.getUint16(20, true), 1);
  assert.strictEqual(dv.getUint32(24, true), 8000);
  assert.strictEqual(dv.getUint32(40, true), 3 * 320 * 2);
  assert.strictEqual(out.byteLength, 44 + 3 * 320 * 2);
});

test('notes: thread ids normalise and notes validate', () => {
  const N = load('notes-store.js', 'OmniNotes', { chrome: { storage: { local: {} } } });
  assert.strictEqual(N.normalizeThread('#thread-f:255'), 'ff');
  assert.strictEqual(N.key('A@B.com', '#FF0012345678'), N.key('a@b.com', 'ff0012345678'));
  const note = { version: 1, account: 'a@b.com', thread: 'ff0012345678', text: 'hi', subject: 's', color: 'yellow', done: false, updatedAt: 1 };
  assert.ok(N.valid(note));
  assert.ok(!N.valid({ ...note, color: 'red' }));
  assert.ok(!N.valid({ ...note, account: 'nope' }));
  assert.ok(!N.valid({ ...note, text: 'x'.repeat(20001) }));
  assert.ok(!N.valid({ ...note, deleted: true }));
  assert.strictEqual(N.fingerprint(note), N.fingerprint({ ...note }));
});

test('tabs: validation and operations', async () => {
  const store = {};
  const chrome = { storage: { local: {
    get: async (k) => ({ [k]: store[k] }),
    set: async (o) => Object.assign(store, o),
  } } };
  const T = load('tabs-store.js', 'OmniGmailTabsStore', { chrome });
  const tab = { id: 'work', name: 'Work', kind: 'label', value: 'Work', color: '#d9eaff', textColor: '#263247' };
  assert.ok(T.valid(tab));
  assert.ok(!T.valid({ ...tab, color: 'blue' }));
  assert.ok(!T.valid({ ...tab, kind: 'other' }));
  assert.ok(!T.valid({ ...tab, value: '   ' }));
  let tabs = await T.update('a@b.com', { type: 'save', tab });
  assert.strictEqual(tabs.length, 4);
  tabs = await T.update('a@b.com', { type: 'move', id: 'work', before: 'inbox' });
  assert.strictEqual(tabs[0].id, 'work');
  tabs = await T.update('a@b.com', { type: 'remove', id: 'work' });
  assert.strictEqual(tabs.length, 3);
  await assert.rejects(T.update('a@b.com', { type: 'bogus' }));
  await assert.rejects(T.update('not-an-email', { type: 'remove', id: 'x' }));
});
