// IndexedDB store for finished recordings; shared by the offscreen recorder and the recordings page
// (both run on the extension origin, so they see the same database).
const OmniDB = (() => {
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open('omniclick', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('recordings', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('recordings', mode);
      const request = fn(tx.objectStore('recordings'));
      tx.oncomplete = () => { db.close(); resolve(request && request.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  return {
    put: (rec) => run('readwrite', (s) => s.put(rec)),
    get: (id) => run('readonly', (s) => s.get(id)),
    all: () => run('readonly', (s) => s.getAll()),
    delete: (id) => run('readwrite', (s) => s.delete(id)),
  };
})();
