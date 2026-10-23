// One storage item per account/thread prevents unrelated edits from overwriting each other.
const OmniNotes = (() => {
  const prefix = 'gmail-note:v1:';
  const colors = { yellow: '#fff3b0', blue: '#d9eaff', green: '#dff2d8', pink: '#fce0eb' };
  const queues = new Map();
  function normalizeThread(value) {
    const id = String(value || '').replace(/^#/, '');
    const decimal = /^thread-f:(\d+)$/.exec(id);
    if (decimal) return BigInt(decimal[1]).toString(16);
    return /^[a-f\d]{12,}$/i.test(id) ? id.toLowerCase() : id;
  }
  const key = (account, thread) => prefix + encodeURIComponent(account.toLowerCase()) + ':' + encodeURIComponent(normalizeThread(thread));
  function valid(note) {
    return note && note.version === 1 && typeof note.account === 'string' &&
      /^[^\s@]+@[^\s@]+$/.test(note.account) && note.account.length <= 320 &&
      typeof note.thread === 'string' && /^[\w:#-]{1,200}$/.test(note.thread) &&
      typeof note.text === 'string' && note.text.length <= 20000 &&
      typeof note.subject === 'string' && note.subject.length <= 1000 &&
      Object.hasOwn(colors, note.color) && typeof note.done === 'boolean' &&
      Number.isFinite(note.updatedAt) && note.updatedAt >= 0 && note.updatedAt <= 8640000000000000 &&
      (note.deleted === undefined || typeof note.deleted === 'boolean') &&
      (!note.deleted || !note.text.trim());
  }
  async function records() {
    const items = await chrome.storage.local.get(null);
    return Object.entries(items).filter(([k, v]) => k.startsWith(prefix) && valid(v) && key(v.account, v.thread) === k)
      .map(([, v]) => v);
  }
  async function all() { return (await records()).filter((note) => !note.deleted); }
  async function get(account, thread) {
    const k = key(account, thread);
    const items = await chrome.storage.local.get(k);
    return valid(items[k]) && !items[k].deleted ? items[k] : null;
  }
  const fingerprint = (note) => note ? JSON.stringify([note.account.toLowerCase(), normalizeThread(note.thread),
    note.subject, note.text, note.color, note.done, note.deleted === true, note.updatedAt]) : '';
  function enqueue(k, operation) {
    const next = (queues.get(k) || Promise.resolve()).catch(() => {}).then(operation);
    queues.set(k, next);
    next.finally(() => { if (queues.get(k) === next) queues.delete(k); }).catch(() => {});
    return next;
  }
  function put(note) {
    if (!valid(note)) return Promise.reject(new Error('Invalid note'));
    // All production writes go through the worker, where sync and editor writes share a queue.
    if (typeof document !== 'undefined' && chrome.runtime.sendMessage) {
      return chrome.runtime.sendMessage({ type: 'omniclick-note-put', note }).then((result) => {
        if (!result?.ok) throw new Error(result?.error || 'Could not save note');
      });
    }
    const k = key(note.account, note.thread);
    const snapshot = clean(note);
    if (!snapshot.text.trim()) { snapshot.deleted = true; snapshot.updatedAt = Date.now(); }
    return enqueue(k, async () => {
      const previous = (await chrome.storage.local.get(k))[k];
      if (snapshot.deleted && !valid(previous)) return;
      if (valid(previous)) snapshot.updatedAt = Math.min(8640000000000000, Math.max(snapshot.updatedAt, previous.updatedAt + 1));
      await chrome.storage.local.set({ [k]: snapshot });
    });
  }
  function clean(note) {
    return { version: 1, account: note.account.toLowerCase(), thread: normalizeThread(note.thread),
      subject: note.subject, text: note.text, color: note.color, done: note.done,
      updatedAt: note.updatedAt, deleted: note.deleted === true };
  }
  function replaceIf(note, expected) {
    const k = key(note.account, note.thread);
    return enqueue(k, async () => {
      const item = (await chrome.storage.local.get(k))[k];
      if (fingerprint(valid(item) ? item : null) !== expected) return false;
      await chrome.storage.local.set({ [k]: clean(note) });
      return true;
    });
  }
  return { prefix, colors, key, valid, clean, all, records, get, put, normalizeThread, fingerprint, replaceIf };
})();
