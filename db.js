// IndexedDB for recordings; shared by the offscreen recorder and the recordings page
// (both run on the extension origin, so they see the same database).
// 'chunks' holds the pieces of an in-progress recording so they live on disk, not in memory.
const OmniDB = (() => {
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open('omniclick', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('recordings')) db.createObjectStore('recordings', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: ['rid', 'seq'] });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  async function run(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = fn(tx.objectStore(store));
      tx.oncomplete = () => { db.close(); resolve(request && request.result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    });
  }

  const range = (rid) => IDBKeyRange.bound([rid, 0], [rid, Infinity]);
  const rec = (mode, fn) => run('recordings', mode, fn);
  const chunk = (mode, fn) => run('chunks', mode, fn);

  return {
    put: (r) => rec('readwrite', (s) => s.put(r)),
    get: (id) => rec('readonly', (s) => s.get(id)),
    all: () => rec('readonly', (s) => s.getAll()),
    delete: (id) => rec('readwrite', (s) => s.delete(id)),
    putChunk: (rid, seq, blob, meta) => chunk('readwrite', (s) => s.put({ rid, seq, blob, ...meta })),
    chunks: (rid) => chunk('readonly', (s) => s.getAll(range(rid))),
    deleteChunks: (rid) => chunk('readwrite', (s) => s.delete(range(rid))),
    // Recordings that never finished (browser or extension crashed mid-recording).
    async orphanIds() {
      const keys = await chunk('readonly', (s) => s.getAllKeys());
      return [...new Set(keys.map((k) => k[0]))];
    },
  };
})();
