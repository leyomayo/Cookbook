/*
 * db.js — on-device storage using IndexedDB.
 *
 * One database ("cookbook") with three object stores:
 *   recipes  one object per recipe, keyed by recipe id
 *   tags     the tag list: { key: "comfort food", name: "Comfort food" }
 *   grocery  the grocery list, one object per item, keyed by item id:
 *            { id: "g_…", name: "butter", amount: "1/2 cup",
 *              recipeId: "r_…", recipeTitle: "Garlic Butter Pasta",
 *              ingredientId: "i_…", checked: false, addedAt: 1730000000000 }
 *            The recipe title is copied in, so the list still reads well if
 *            the recipe is renamed or deleted. Not part of backups or shares.
 *
 * Nothing ever leaves the device. Every function returns a Promise.
 */

const DB = (() => {
  const DB_NAME = 'cookbook';
  // 1: recipes store. 2: tags store, and recipes converted to schema 2.
  // 3: grocery store (empty). Recipes and tags aren't touched.
  const DB_VERSION = 3;
  const RECIPES = 'recipes';
  const TAGS = 'tags';
  const GROCERY = 'grocery';

  let dbPromise = null;

  /** Open the database once and reuse the connection. */
  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      // Runs on first launch, and once after an update that raises DB_VERSION.
      req.onupgradeneeded = (event) => {
        const db = req.result;
        const tx = req.transaction;
        if (!db.objectStoreNames.contains(RECIPES)) {
          db.createObjectStore(RECIPES, { keyPath: 'id' });
        }
        if (event.oldVersion < 2) upgradeToV2(db, tx);
        if (event.oldVersion < 3 && !db.objectStoreNames.contains(GROCERY)) {
          db.createObjectStore(GROCERY, { keyPath: 'id' });
        }
      };

      req.onsuccess = () => {
        const db = req.result;
        // If a newer version of the app opens the database in another tab,
        // let it upgrade instead of blocking it.
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  /**
   * Version 2: create the tag list from the starter tags, convert every
   * recipe to schema 2 (see Model.normalizeRecipe), and add each recipe's
   * tags to the list. Tags that differ only by case become one tag, spelled
   * the way the list spells it (so "sweet" becomes the starter tag "Sweet").
   */
  function upgradeToV2(db, tx) {
    const tagStore = db.createObjectStore(TAGS, { keyPath: 'key' });
    const map = Tags.toMap(Tags.STARTER);

    tx.objectStore(RECIPES).openCursor().onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const recipe = Model.normalizeRecipe(cursor.value);
        recipe.tags = Tags.canonicalize(recipe.tags, map).tags;
        cursor.update(recipe);
        cursor.continue();
      } else {
        // All recipes done: save the starter tags plus any found in recipes.
        map.forEach((name, key) => tagStore.put({ key, name }));
      }
    };
  }

  /** Read every row of one store. */
  async function readAll(store) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Run writes on one or more stores in a single transaction. Either every
   * write is saved or none is. Resolves once the data is safely stored.
   */
  async function write(stores, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, 'readwrite');
      work(tx);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Saving was cancelled.'));
    });
  }

  /* ---------- Recipes ---------- */

  async function getAllRecipes() {
    return (await readAll(RECIPES)).map(Model.normalizeRecipe);
  }

  async function getRecipe(id) {
    const db = await open();
    const row = await new Promise((resolve, reject) => {
      const req = db.transaction(RECIPES, 'readonly').objectStore(RECIPES).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return row ? Model.normalizeRecipe(row) : null;
  }

  /**
   * Save recipes together with any tags they use that aren't in the list
   * yet. The tags are respelled the way the list spells them. Pass
   * `touch: false` to keep the recipes' updatedAt (used by import).
   */
  async function putRecipes(recipes, { extraTags = [], touch = true } = {}) {
    const map = await getTagMap();
    const added = Tags.canonicalize(extraTags, map).added;
    const clean = recipes.map((r) => {
      const recipe = Model.normalizeRecipe(touch ? { ...r, updatedAt: Date.now() } : r);
      const result = Tags.canonicalize(recipe.tags, map);
      recipe.tags = result.tags;
      added.push(...result.added);
      return recipe;
    });

    await write([RECIPES, TAGS], (tx) => {
      clean.forEach((r) => tx.objectStore(RECIPES).put(r));
      added.forEach((name) => tx.objectStore(TAGS).put({ key: name.toLowerCase(), name }));
    });
    return clean;
  }

  async function saveRecipe(recipe) {
    return (await putRecipes([recipe]))[0];
  }

  /** Save imported recipes and tags in one transaction: all or nothing. */
  function importRecipes(recipes, extraTags) {
    return putRecipes(recipes, { extraTags, touch: false });
  }

  /**
   * Delete a recipe and, in the same transaction, unlink every ingredient
   * that points at it (recipeId → null), so those ingredients become plain
   * text. Either both happen or neither does. Resolves to the number of
   * recipes that were unlinked.
   */
  async function deleteRecipe(id) {
    let unlinked = 0;
    await write([RECIPES], (tx) => {
      const store = tx.objectStore(RECIPES);
      store.delete(id);
      store.openCursor().onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) return;
        const row = cursor.value;
        const ingredients = Array.isArray(row.ingredients) ? row.ingredients : [];
        if (ingredients.some((i) => i && i.recipeId === id)) {
          unlinked += 1;
          cursor.update({
            ...row,
            ingredients: ingredients.map((i) => (i && i.recipeId === id ? { ...i, recipeId: null } : i)),
            updatedAt: Date.now(),
          });
        }
        cursor.continue();
      };
    });
    return unlinked;
  }

  /* ---------- Tag list ---------- */

  async function getTagMap() {
    const rows = await readAll(TAGS);
    return new Map(rows.map((row) => [row.key, row.name]));
  }

  /** Every tag name in the list, A to Z. */
  async function getTagNames() {
    return [...(await getTagMap()).values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  /** Add a tag to the list (if it isn't there) and return the list's spelling. */
  async function addTag(name) {
    const map = await getTagMap();
    const { tags, added } = Tags.canonicalize([name], map);
    if (added.length) {
      await write([TAGS], (tx) => tx.objectStore(TAGS).put({ key: added[0].toLowerCase(), name: added[0] }));
    }
    return tags[0];
  }

  /* ---------- Grocery list ---------- */

  /** Every grocery item, oldest first (the order they were added). */
  async function getGroceryItems() {
    return (await readAll(GROCERY)).sort((a, b) => a.addedAt - b.addedAt || a.id.localeCompare(b.id));
  }

  /** Add items; each needs name, amount, recipeId, recipeTitle, ingredientId. */
  async function addGroceryItems(items) {
    const now = Date.now();
    const rows = items.map((item, n) => ({
      checked: false, ...item, id: Model.newId('g'), addedAt: now + n,
    }));
    await write([GROCERY], (tx) => rows.forEach((row) => tx.objectStore(GROCERY).put(row)));
    return rows;
  }

  /** Tick or untick items by id. */
  async function setGroceryChecked(ids, checked) {
    await write([GROCERY], (tx) => {
      const store = tx.objectStore(GROCERY);
      ids.forEach((id) => {
        store.get(id).onsuccess = (e) => {
          if (e.target.result) store.put({ ...e.target.result, checked });
        };
      });
    });
  }

  async function deleteGroceryItems(ids) {
    await write([GROCERY], (tx) => ids.forEach((id) => tx.objectStore(GROCERY).delete(id)));
  }

  async function clearGrocery() {
    await write([GROCERY], (tx) => tx.objectStore(GROCERY).clear());
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

  return {
    getAllRecipes, getRecipe, saveRecipe, importRecipes, deleteRecipe,
    getTagNames, addTag, requestPersistence,
    getGroceryItems, addGroceryItems, setGroceryChecked, deleteGroceryItems, clearGrocery,
  };
})();
