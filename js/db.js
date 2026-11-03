/*
 * db.js — on-device storage using IndexedDB.
 *
 * One database ("cookbook") with one object store ("recipes"), keyed by
 * recipe id. Nothing ever leaves the device. Every function returns a
 * Promise, so callers can use async/await.
 */

const DB = (() => {
  const DB_NAME = 'cookbook';
  const DB_VERSION = 1; // bump to add stores or indexes (see onupgradeneeded)
  const STORE = 'recipes';

  let dbPromise = null;

  /** Open the database once and reuse the connection. */
  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  /** Run one request inside a transaction and resolve with its result. */
  async function run(mode, makeRequest) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = makeRequest(tx.objectStore(STORE));
      // Resolve on transaction complete so writes are durable before we move on.
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async function getAllRecipes() {
    const rows = await run('readonly', (s) => s.getAll());
    return rows.map(Model.normalizeRecipe);
  }

  async function getRecipe(id) {
    const row = await run('readonly', (s) => s.get(id));
    return row ? Model.normalizeRecipe(row) : null;
  }

  async function saveRecipe(recipe) {
    const clean = Model.normalizeRecipe({ ...recipe, updatedAt: Date.now() });
    await run('readwrite', (s) => s.put(clean));
    return clean;
  }

  function deleteRecipe(id) {
    return run('readwrite', (s) => s.delete(id));
  }

  /**
   * Ask the browser not to clear our data under storage pressure.
   * Safari grants this to Home Screen apps; elsewhere it's best effort.
   */
  function requestPersistence() {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
  }

  return { getAllRecipes, getRecipe, saveRecipe, deleteRecipe, requestPersistence };
})();
