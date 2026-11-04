/*
 * transfer.js — export, share and import recipe files.
 *
 * File names: a shared recipe is "<name>.recipe" and a backup is
 * "cookbook-backup-<date>.cookbook". Inside, both are plain JSON. Older
 * exports ended in ".json"; those still import. Import decides whether a
 * file is valid from its contents only, never from its name.
 *
 * File format (JSON):
 *
 *   {
 *     "format": "cookbook-recipes",   identifies a Cookbook file
 *     "formatVersion": 1,             bump if the file layout changes
 *     "kind": "backup" | "share",     backup = everything, share = one recipe + its links
 *     "exportedAt": "2026-11-03T…Z",
 *     "recipes": [ … ],               full recipe objects, ids included (see model.js)
 *     "tags": [ "Chicken", … ]        backup only: the whole tag list
 *   }
 *
 * Importing never writes anything until the whole file has been checked
 * and every question answered; then everything is saved in one step.
 */

const Transfer = (() => {
  const FORMAT = 'cookbook-recipes';
  const FORMAT_VERSION = 1;
  const MAX_FILE_BYTES = 20 * 1024 * 1024;

  /** An import problem worth showing to the user as is. */
  class ImportError extends Error {
    constructor(message) {
      super(message);
      this.name = 'ImportError';
    }
  }

  /* ------------------------------------------------------------------ */
  /* Building files                                                      */
  /* ------------------------------------------------------------------ */

  function makeFile(kind, recipes, extra = {}) {
    return {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      kind,
      exportedAt: new Date().toISOString(),
      recipes,
      ...extra,
    };
  }

  /** Every recipe plus the whole tag list (including unused tags). */
  function backup(recipes, tagNames) {
    return makeFile('backup', recipes, { tags: tagNames });
  }

  /**
   * The recipe `rootId` first, then every recipe it links to through
   * ingredient.recipeId, then the ones those link to, and so on. Each
   * recipe appears once, even if links loop back. Missing links are skipped.
   */
  function withLinked(rootId, recipes) {
    const byId = new Map(recipes.map((r) => [r.id, r]));
    const out = [];
    const seen = new Set();
    const queue = [rootId];
    while (queue.length) {
      const id = queue.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      const recipe = byId.get(id);
      if (!recipe) continue;
      out.push(recipe);
      recipe.ingredients.forEach((i) => i.recipeId && queue.push(i.recipeId));
    }
    return out;
  }

  /** One recipe and everything it links to, ready to send to someone. */
  function share(rootId, recipes) {
    return makeFile('share', withLinked(rootId, recipes));
  }

  /** "Buttermilk Pancakes" → "buttermilk-pancakes.recipe" */
  function shareFileName(recipe) {
    const slug = recipe.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `${slug || 'recipe'}.recipe`;
  }

  /** "cookbook-backup-2026-11-04.cookbook" */
  function backupFileName() {
    return `cookbook-backup-${new Date().toISOString().slice(0, 10)}.cookbook`;
  }

  /* ------------------------------------------------------------------ */
  /* Getting a file off the device                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Hand a file to the user. On iPhone and iPad this opens the share sheet
   * (Save to Files, AirDrop, Messages, Mail…), which is the reliable way to
   * get a file out of a Home Screen app. Elsewhere it downloads the file.
   *
   * Call this directly from a tap handler, with the data already prepared:
   * Safari only opens the share sheet in direct response to a tap.
   *
   * Resolves to:
   *   "shared"      the share sheet took the file
   *   "cancelled"   the share sheet was closed without choosing anything
   *   "refused"     the share sheet exists but wouldn't take the file, so
   *                 it was downloaded instead (the caller tells the user)
   *   "downloaded"  no share sheet here (e.g. a desktop browser), so it was
   *                 downloaded
   */
  function deliver(filename, data, title) {
    const text = JSON.stringify(data, null, 2);
    if (navigator.share && navigator.canShare) {
      // The name keeps its .recipe / .cookbook ending whatever the type.
      // Some browsers only share certain types, so try JSON, then plain text.
      for (const type of ['application/json', 'text/plain']) {
        const file = new File([text], filename, { type });
        if (navigator.canShare({ files: [file] })) {
          return navigator.share({ files: [file], title }).then(
            () => 'shared',
            (err) => {
              if (err.name === 'AbortError') return 'cancelled'; // closed the share sheet
              console.warn('Share sheet failed, downloading instead:', err);
              download(filename, text);
              return 'refused';
            },
          );
        }
      }
      // A share sheet exists but won't accept this file.
      download(filename, text);
      return Promise.resolve('refused');
    }
    download(filename, text);
    return Promise.resolve('downloaded');
  }

  function download(filename, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  /* ------------------------------------------------------------------ */
  /* Reading and checking a file                                         */
  /* ------------------------------------------------------------------ */

  async function readFile(file) {
    if (file.size > MAX_FILE_BYTES) throw new ImportError('This file is too large to be a Cookbook file.');
    return file.text();
  }

  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isId = (v) => typeof v === 'string' && v.trim() !== '';

  /** Check an ingredient or step list. Throws ImportError if it's malformed. */
  function checkItems(items, what, label) {
    if (items === undefined) return;
    if (!Array.isArray(items)) throw new ImportError(`${label} has a broken ${what} list.`);
    const ids = new Set();
    items.forEach((item, n) => {
      const where = `${label}, ${what} ${n + 1},`;
      if (!isObject(item)) throw new ImportError(`${where} isn't valid.`);
      if (!isId(item.id)) throw new ImportError(`${where} has no id.`);
      if (ids.has(item.id)) throw new ImportError(`${label} uses the same ${what} id twice.`);
      ids.add(item.id);
      for (const field of what === 'ingredient' ? ['amount', 'name'] : ['text']) {
        if (item[field] !== undefined && typeof item[field] !== 'string') {
          throw new ImportError(`${where} has an invalid ${field}.`);
        }
      }
      if (item.recipeId !== undefined && item.recipeId !== null && !isId(item.recipeId)) {
        throw new ImportError(`${where} has an invalid recipe link.`);
      }
      if (item.ingredientIds !== undefined &&
          (!Array.isArray(item.ingredientIds) || !item.ingredientIds.every(isId))) {
        throw new ImportError(`${where} has an invalid ingredient list.`);
      }
    });
  }

  /**
   * Parse and check a file's text. Returns { kind, recipes, tags } with the
   * recipes normalized, or throws ImportError explaining what's wrong.
   */
  function parse(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ImportError("This file isn't a Cookbook file (it isn't valid JSON).");
    }
    if (!isObject(data) || data.format !== FORMAT) {
      throw new ImportError("This file isn't a Cookbook file.");
    }
    if (!Number.isInteger(data.formatVersion) || data.formatVersion < 1) {
      throw new ImportError('This Cookbook file has no valid format version.');
    }
    if (data.formatVersion > FORMAT_VERSION) {
      throw new ImportError('This file was made by a newer version of Cookbook. Update the app (open it online, then reopen it) and try again.');
    }
    if (!Array.isArray(data.recipes)) throw new ImportError('This Cookbook file has no recipe list.');
    if (!data.recipes.length) throw new ImportError('This Cookbook file has no recipes in it.');
    if (data.tags !== undefined && (!Array.isArray(data.tags) || !data.tags.every((t) => typeof t === 'string'))) {
      throw new ImportError('This Cookbook file has a broken tag list.');
    }

    const ids = new Set();
    const recipes = data.recipes.map((r, n) => {
      let label = `Recipe ${n + 1}`;
      if (!isObject(r)) throw new ImportError(`${label} isn't valid.`);
      if (typeof r.title !== 'string' || !r.title.trim()) throw new ImportError(`${label} has no title.`);
      label = `“${r.title.trim()}”`;
      if (!isId(r.id)) throw new ImportError(`${label} has no id.`);
      if (ids.has(r.id)) throw new ImportError(`${label} appears twice in the file (same id).`);
      ids.add(r.id);
      if (Number.isInteger(r.schemaVersion) && r.schemaVersion > Model.SCHEMA_VERSION) {
        throw new ImportError(`${label} was made by a newer version of Cookbook. Update the app and try again.`);
      }
      if (r.tags !== undefined && typeof r.tags !== 'string' &&
          !(Array.isArray(r.tags) && r.tags.every((t) => typeof t === 'string'))) {
        throw new ImportError(`${label} has invalid tags.`);
      }
      checkItems(r.ingredients, 'ingredient', label);
      checkItems(r.steps, 'step', label);
      return Model.normalizeRecipe(r);
    });

    return { kind: data.kind, recipes, tags: data.tags || [] };
  }

  /* ------------------------------------------------------------------ */
  /* Deciding what to import                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Work out what to save, without saving anything.
   *
   *   incoming  recipes from the file
   *   existing  recipes already on the device
   *   decide    async (fileRecipe, deviceRecipe, remaining) →
   *               { choice: "ignore" | "overwrite" | "keep", applyToAll }
   *             Called for each recipe whose id is already on the device.
   *             If it throws, the import stops and nothing is saved.
   *
   * Returns { recipes, summary, warnings }: the recipes to save, counts of
   * what happened, and messages about renamed recipes.
   */
  async function plan(incoming, existing, decide) {
    const deviceById = new Map(existing.map((r) => [r.id, r]));
    const total = incoming.filter((r) => deviceById.has(r.id)).length;
    const summary = { added: 0, overwritten: 0, keptBoth: 0, ignored: 0 };
    const accepted = []; // { recipe, action }
    const newIds = new Map(); // old id → new id, for "Keep both"
    let asked = 0;
    let rememberedChoice = null;

    // 1. Same id as a recipe on the device: ask what to do.
    for (const recipe of incoming) {
      const current = deviceById.get(recipe.id);
      if (!current) {
        accepted.push({ recipe, action: 'added' });
        continue;
      }
      asked += 1;
      let choice = rememberedChoice;
      if (!choice) {
        const answer = await decide(recipe, current, total - asked);
        choice = answer.choice;
        if (answer.applyToAll) rememberedChoice = choice;
      }
      if (choice === 'overwrite') {
        accepted.push({ recipe, action: 'overwritten' });
      } else if (choice === 'keep') {
        const id = Model.newId('r');
        newIds.set(recipe.id, id);
        accepted.push({ recipe: { ...recipe, id }, action: 'keptBoth' });
      } else {
        summary.ignored += 1;
      }
    }

    // 2. Names: a recipe whose name is already used by a different recipe
    //    (ignoring case) gets "-new" added. Recipes being overwritten give
    //    up their old name.
    const overwrittenIds = new Set(accepted.filter((a) => a.action === 'overwritten').map((a) => a.recipe.id));
    const names = new Set(existing.filter((r) => !overwrittenIds.has(r.id)).map((r) => r.title.toLowerCase()));
    const warnings = [];

    for (const a of accepted) {
      // 3. Links: point at the new id of any recipe that got one.
      a.recipe = {
        ...a.recipe,
        ingredients: a.recipe.ingredients.map((i) =>
          newIds.has(i.recipeId) ? { ...i, recipeId: newIds.get(i.recipeId) } : i),
      };

      let title = a.recipe.title;
      while (names.has(title.toLowerCase())) title += '-new';
      if (title !== a.recipe.title) {
        warnings.push(`“${a.recipe.title}” was imported as “${title}” because a recipe with that name already exists.`);
        a.recipe.title = title;
      }
      names.add(title.toLowerCase());
      summary[a.action] += 1;
    }

    return { recipes: accepted.map((a) => a.recipe), summary, warnings };
  }

  return {
    FORMAT, FORMAT_VERSION, ImportError,
    backup, share, withLinked, shareFileName, backupFileName,
    deliver, readFile, parse, plan,
  };
})();
