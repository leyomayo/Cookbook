/*
 * model.js — the shape of a recipe, in one place.
 *
 * A recipe is stored as a single plain object:
 *
 *   {
 *     id:          "r_…"            unique id (string)
 *     schemaVersion: 1               bump when the shape changes, migrate in normalizeRecipe()
 *     title:       "Pancakes"
 *     mealType:    "breakfast"       one of MEAL_TYPES
 *     prepMinutes: 10                number or null
 *     cookMinutes: 15                number or null
 *     servings:    4                 number or null
 *     tags:        ["sweet", "quick"]
 *     ingredients: [Ingredient, …]   in display order
 *     steps:       [Step, …]         in cooking order
 *     createdAt / updatedAt:         ms timestamps
 *   }
 *
 *   Ingredient = {
 *     id:       "i_…"   stable id, so steps can point at it even if the list is reordered
 *     amount:   "2 cups" free text: quantity + unit, as you'd write it
 *     name:     "flour"
 *     recipeId: null     FUTURE: id of another recipe this ingredient is made from
 *                        (e.g. "pizza dough" → the Pizza Dough recipe). Not used by the UI yet.
 *   }
 *
 *   Step = {
 *     id:            "s_…"
 *     text:          "Whisk the dry ingredients."
 *     ingredientIds: []   FUTURE: ids of ingredients used in this step, for a
 *                         tap-to-see-ingredients popup. Not used by the UI yet.
 *   }
 *
 * The future fields are stored now (as null / empty) so that adding those
 * features later needs no data migration, and editing a recipe in this
 * version keeps whatever values they already hold.
 */

const Model = (() => {
  const SCHEMA_VERSION = 1;

  // Order here is the order shown in the filter and the form.
  const MEAL_TYPES = [
    { value: 'breakfast', label: 'Breakfast' },
    { value: 'lunch', label: 'Lunch' },
    { value: 'snack', label: 'Snack' },
    { value: 'dinner', label: 'Dinner' },
    { value: 'other', label: 'Other' },
  ];

  /** Short random id with a type prefix, e.g. "r_lq2x9k3f8a". */
  function newId(prefix) {
    const rand = (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2))
      .slice(0, 10);
    return `${prefix}_${Date.now().toString(36)}${rand}`;
  }

  function newIngredient(fields = {}) {
    return { id: newId('i'), amount: '', name: '', recipeId: null, ...fields };
  }

  function newStep(fields = {}) {
    return { id: newId('s'), text: '', ingredientIds: [], ...fields };
  }

  function newRecipe() {
    const now = Date.now();
    return {
      id: newId('r'),
      schemaVersion: SCHEMA_VERSION,
      title: '',
      mealType: 'dinner',
      prepMinutes: null,
      cookMinutes: null,
      servings: null,
      tags: [],
      ingredients: [],
      steps: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Turn "" / "abc" / "-3" into null, otherwise a whole non-negative number. */
  function toCount(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  /**
   * Fill in any missing fields and fix types. Run on everything read from
   * storage, so older or hand-edited records never break the screens.
   * This is also where future schema migrations go.
   */
  function normalizeRecipe(raw) {
    const r = { ...newRecipe(), ...raw };
    r.schemaVersion = SCHEMA_VERSION;
    r.title = String(r.title || '').trim();
    if (!MEAL_TYPES.some((m) => m.value === r.mealType)) r.mealType = 'other';
    r.prepMinutes = toCount(r.prepMinutes);
    r.cookMinutes = toCount(r.cookMinutes);
    r.servings = toCount(r.servings);
    r.tags = Array.isArray(r.tags) ? r.tags.map((t) => String(t).trim()).filter(Boolean) : [];
    r.ingredients = (Array.isArray(r.ingredients) ? r.ingredients : []).map((i) => ({
      ...newIngredient(),
      ...i,
      recipeId: i.recipeId || null,
    }));
    r.steps = (Array.isArray(r.steps) ? r.steps : []).map((s) => ({
      ...newStep(),
      ...s,
      ingredientIds: Array.isArray(s.ingredientIds) ? s.ingredientIds : [],
    }));
    return r;
  }

  /** "sweet, Quick ,sweet" → ["sweet", "quick"] (lower-case, no duplicates). */
  function parseTags(text) {
    const seen = new Set();
    return String(text)
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t && !seen.has(t) && seen.add(t));
  }

  /** 75 → "1 h 15 min", 20 → "20 min", null → "". */
  function formatMinutes(mins) {
    if (mins === null || mins === undefined) return '';
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }

  function mealLabel(value) {
    const m = MEAL_TYPES.find((t) => t.value === value);
    return m ? m.label : 'Other';
  }

  return {
    SCHEMA_VERSION,
    MEAL_TYPES,
    newId,
    newRecipe,
    newIngredient,
    newStep,
    normalizeRecipe,
    parseTags,
    formatMinutes,
    mealLabel,
  };
})();
