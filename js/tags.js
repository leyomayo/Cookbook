/*
 * tags.js — the tag list and the tag editor used in the recipe form.
 *
 * The tag list is stored in IndexedDB (see db.js) as { key, name } rows,
 * where key is the lower-case name. It starts with STARTER, grows when you
 * create a tag or import recipes, and keeps tags even when no recipe uses
 * them. Recipes store tag names spelled exactly as they are in the list.
 */

const Tags = (() => {
  const STARTER = [
    'Heavy', 'Light', 'Comfort food', 'Healthy', 'Weeknight', 'Weekend', 'Meal prep',
    'Make ahead', 'Holiday', 'Party', 'Vegetarian', 'Vegan', 'Gluten-free', 'Dairy-free',
    'Low-carb', 'High-protein', 'Chicken', 'Beef', 'Pork', 'Seafood', 'Pasta', 'Rice',
    'Beans', 'Vegetables', 'Eggs', 'American', 'Italian', 'Mexican', 'Asian', 'Indian',
    'Mediterranean', 'One-pot', 'Slow cooker', 'Grill', 'Oven', 'No-cook', 'Air fryer',
    'Spicy', 'Sweet', 'Savory', 'Soup', 'Salad', 'Sandwich', 'Casserole', 'Dessert', 'Side',
  ];

  /** How many suggestions to show before you type anything. */
  const SUGGESTION_COUNT = 15;

  /** Build a Map of key → name from a list of names. The first spelling wins. */
  function toMap(names) {
    const map = new Map();
    for (const n of names) {
      const name = Model.cleanTag(n);
      if (name && !map.has(name.toLowerCase())) map.set(name.toLowerCase(), name);
    }
    return map;
  }

  /**
   * Respell `names` the way the tag list (`map`) spells them, and add any
   * names the list doesn't have yet. Returns the respelled names and the
   * ones that were added. `map` is updated in place.
   */
  function canonicalize(names, map) {
    const tags = [];
    const added = [];
    for (const n of names) {
      const name = Model.cleanTag(n);
      if (!name) continue;
      const key = name.toLowerCase();
      if (!map.has(key)) {
        map.set(key, name);
        added.push(name);
      }
      if (!tags.includes(map.get(key))) tags.push(map.get(key));
    }
    return { tags, added };
  }

  /** Map of tag key → number of recipes that use it. */
  function usageCounts(recipes) {
    const counts = new Map();
    for (const r of recipes) {
      for (const t of r.tags) counts.set(t.toLowerCase(), (counts.get(t.toLowerCase()) || 0) + 1);
    }
    return counts;
  }

  /** Most used first, then A to Z. Returns a new array. */
  function sortByUsage(names, counts) {
    return [...names].sort((a, b) =>
      (counts.get(b.toLowerCase()) || 0) - (counts.get(a.toLowerCase()) || 0) ||
      a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  /**
   * Tag editor: the recipe's tags as bubbles (tap one to remove it), a text
   * field, and suggestion bubbles under it while the field is in use.
   *
   *   root       element to draw into
   *   tags       the recipe's current tag names
   *   getList()  returns every name in the tag list
   *   counts     usage counts, from usageCounts()
   *   onCreate   async (name) → saves a new tag to the list and returns its name
   *
   * Returns { getTags(), flush() }. flush() adds whatever is still typed in
   * the field, so a tag isn't lost if you tap Save without pressing Return.
   */
  function mountEditor(root, { tags, getList, counts, onCreate }) {
    const selected = [...tags];
    let active = false; // true while the suggestions are showing

    root.classList.add('tag-editor');
    root.innerHTML = `
      <div class="tag-box">
        <span class="tag-applied"></span>
        <input class="tag-input" type="text" autocomplete="off" autocapitalize="sentences"
               enterkeyhint="enter" placeholder="Add a tag" aria-label="Add a tag">
      </div>
      <div class="tag-suggestions" hidden></div>
    `;
    const applied = root.querySelector('.tag-applied');
    const input = root.querySelector('.tag-input');
    const suggestions = root.querySelector('.tag-suggestions');

    const has = (name) => selected.some((t) => t.toLowerCase() === name.toLowerCase());

    function renderApplied() {
      applied.innerHTML = selected.map((t, i) => `
        <button type="button" class="bubble bubble-on" data-remove="${i}" aria-label="Remove tag ${esc(t)}">
          ${esc(t)} <span aria-hidden="true">✕</span>
        </button>`).join('');
    }

    function renderSuggestions() {
      suggestions.hidden = !active;
      if (!active) return;

      const query = input.value.trim().toLowerCase();
      let pool = getList().filter((n) => !has(n));
      // Typing filters the whole list: the text can appear anywhere in the tag.
      if (query) pool = pool.filter((n) => n.toLowerCase().includes(query));
      pool = sortByUsage(pool, counts);
      if (!query) pool = pool.slice(0, SUGGESTION_COUNT);

      // No tag spelled exactly like the text? Offer to create it.
      const typed = Model.cleanTag(input.value);
      const exact = typed && getList().some((n) => n.toLowerCase() === typed.toLowerCase());
      const create = typed && !exact
        ? `<button type="button" class="bubble bubble-new" data-create>+ Add “${esc(typed)}”</button>`
        : '';

      suggestions.innerHTML = pool.length || create
        ? pool.map((n) => `<button type="button" class="bubble" data-add="${esc(n)}">${esc(n)}</button>`).join('') + create
        : `<span class="muted">${query ? 'No matching tags.' : 'Every tag is already added.'}</span>`;
    }

    function addName(name) {
      if (name && !has(name)) selected.push(name);
      input.value = '';
      renderApplied();
      renderSuggestions();
    }

    /** Return in the field: use the exact match from the list, or create a new tag. */
    async function commit() {
      const typed = Model.cleanTag(input.value);
      if (!typed) return;
      const existing = getList().find((n) => n.toLowerCase() === typed.toLowerCase());
      addName(existing || await onCreate(typed));
    }

    input.addEventListener('focus', () => { active = true; renderSuggestions(); });
    input.addEventListener('input', renderSuggestions);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault(); // don't submit the form or type the comma
        commit();
      } else if (e.key === 'Backspace' && !input.value && selected.length) {
        selected.pop();
        renderApplied();
        renderSuggestions();
      }
    });

    // Keep the keyboard up when tapping bubbles (stops the field losing focus).
    root.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) e.preventDefault();
    });

    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.remove !== undefined) {
        selected.splice(Number(btn.dataset.remove), 1);
        renderApplied();
        renderSuggestions();
        return;
      }
      if (btn.dataset.add !== undefined) addName(btn.dataset.add);
      else if (btn.dataset.create !== undefined) await commit();
      input.focus();
    });

    // Hide the suggestions when you tap or tab anywhere outside the editor.
    const outside = (e) => {
      if (!root.isConnected) {
        document.removeEventListener('pointerdown', outside);
        document.removeEventListener('focusin', outside);
        return;
      }
      if (active && !root.contains(e.target)) { active = false; renderSuggestions(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);

    renderApplied();

    return {
      getTags: () => [...selected],
      flush: commit,
    };
  }

  return { STARTER, toMap, canonicalize, usageCounts, sortByUsage, mountEditor };
})();
