// Mailbox-scoped tab settings. Worker queues prevent simultaneous Gmail windows
// from overwriting unrelated tab edits. No email or Drive API is needed.
const OmniGmailTabsStore = (() => {
  const prefix = 'gmail-tabs:v1:';
  const queues = new Map();
  const colors = { blue: '#d9eaff', green: '#dff2d8', yellow: '#fff3b0', pink: '#fce0eb', gray: '#e8eaed' };
  const emailOK = value => typeof value === 'string' && /^[^\s@]+@[^\s@]+$/.test(value) && value.length <= 320;
  const key = email => prefix + encodeURIComponent(email.toLowerCase());
  const defaults = () => [
    { id: 'inbox', name: 'Inbox', kind: 'inbox', value: '', color: colors.gray, textColor: '#263247' },
    { id: 'unread', name: 'Unread', kind: 'search', value: 'is:unread', color: colors.blue, textColor: '#263247' },
    { id: 'starred', name: 'Starred', kind: 'search', value: 'is:starred', color: colors.yellow, textColor: '#263247' },
  ];
  function valid(tab) {
    return tab && typeof tab.id === 'string' && /^[\w-]{1,80}$/.test(tab.id) &&
      typeof tab.name === 'string' && tab.name.trim().length > 0 && tab.name.length <= 80 &&
      ['inbox', 'search', 'label'].includes(tab.kind) && typeof tab.value === 'string' && tab.value.length <= 1500 &&
      (tab.kind === 'inbox' || tab.value.trim().length > 0) && /^#[\da-f]{6}$/i.test(tab.color) &&
      /^#[\da-f]{6}$/i.test(tab.textColor) &&
      (tab.includeChildren === undefined || typeof tab.includeChildren === 'boolean') &&
      (tab.children === undefined || (Array.isArray(tab.children) && tab.children.length <= 100 &&
        tab.children.every(x => typeof x === 'string' && x.length <= 250 && x.startsWith(tab.value + '/'))));
  }
  async function get(email) {
    if (!emailOK(email)) throw new Error('Open a Gmail mailbox first.');
    const value = (await chrome.storage.local.get(key(email)))[key(email)];
    return value?.version === 1 && Array.isArray(value.tabs) && value.tabs.length <= 50 &&
      value.tabs.every(valid) ? value.tabs : defaults();
  }
  function update(email, operation) {
    if (!emailOK(email)) return Promise.reject(new Error('Invalid mailbox.'));
    if (typeof document !== 'undefined') {
      return chrome.runtime.sendMessage({ type: 'omniclick-tabs-update', account: email, operation }).then(result => {
        if (!result?.ok) throw new Error(result?.error || 'Could not save tabs.');
        return result.data;
      });
    }
    const queueKey = key(email);
    const task = (queues.get(queueKey) || Promise.resolve()).catch(() => {}).then(async () => {
      const tabs = await get(email);
      if (operation?.type === 'save' && valid(operation.tab)) {
        const index = tabs.findIndex(t => t.id === operation.tab.id);
        if (index < 0) {
          if (tabs.length >= 50) throw new Error('You can save up to 50 tabs per mailbox.');
          tabs.push(operation.tab);
        } else tabs[index] = operation.tab;
      } else if (operation?.type === 'remove' && typeof operation.id === 'string') {
        const index = tabs.findIndex(t => t.id === operation.id);
        if (index >= 0) tabs.splice(index, 1);
      } else if (operation?.type === 'move' && typeof operation.id === 'string' &&
          typeof operation.before === 'string') {
        const from = tabs.findIndex(t => t.id === operation.id);
        if (from >= 0 && operation.id !== operation.before) {
          const [tab] = tabs.splice(from, 1);
          const to = tabs.findIndex(t => t.id === operation.before);
          tabs.splice(to < 0 ? tabs.length : to, 0, tab);
        }
      } else throw new Error('Invalid tab change.');
      await chrome.storage.local.set({ [queueKey]: { version: 1, tabs } });
      return tabs;
    });
    queues.set(queueKey, task);
    task.finally(() => { if (queues.get(queueKey) === task) queues.delete(queueKey); }).catch(() => {});
    return task;
  }
  return { prefix, key, get, update, defaults, valid, colors };
})();
