const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
(async () => {
  const items = {};
  const context = vm.createContext({ chrome: { storage: { local: {
    get: async key => ({ [key]: items[key] }),
    set: async value => { await new Promise(resolve => setTimeout(resolve, 5)); Object.assign(items, JSON.parse(JSON.stringify(value))); },
  } } } });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../tabs-store.js'), 'utf8') + '\nthis.store = OmniGmailTabsStore;', context);
  const store = context.store, account = 'demo@example.com';
  const original = await store.get(account);
  assert.equal(original.length, 3);
  const first = { ...original[0], id: 'a', name: 'Atlas', kind: 'label', value: 'Projects', includeChildren: true, children: ['Projects/Atlas'] };
  const second = { ...original[1], id: 'b', name: 'Clients', value: 'from:client@example.com' };
  // Worker queue preserves separate edits arriving from multiple Gmail tabs.
  await Promise.all([store.update(account, { type: 'save', tab: first }), store.update(account, { type: 'save', tab: second })]);
  assert.equal((await store.get(account)).length, 5);
  assert.equal((await store.get('other@example.com')).length, 3);
  await store.update(account, { type: 'move', id: 'b', before: 'inbox' });
  assert.equal((await store.get(account))[0].id, 'b');
  await store.update(account, { type: 'save', tab: { ...second, name: 'Updated clients' } });
  assert.equal((await store.get(account))[0].name, 'Updated clients');
  await store.update(account, { type: 'remove', id: 'a' });
  assert.equal((await store.get(account)).length, 4);
  for (const tab of [{ ...first, color: 'url(https://example.com)' }, { ...first, kind: 'javascript' },
    { ...first, children: ['Different/Label'] }, { ...first, name: ' ' }]) {
    await assert.rejects(store.update(account, { type: 'save', tab }), /Invalid/);
  }
  await assert.rejects(store.update('bad mailbox', { type: 'remove', id: 'b' }), /Invalid mailbox/);
  assert.equal((await store.get(account)).length, 4, 'invalid writes preserve settings');
  console.log('PASS: tab validation, mailbox isolation, concurrent writes, reorder, edit, delete, invalid-input rejection.');
})().catch(error => { console.error(error); process.exitCode = 1; });
