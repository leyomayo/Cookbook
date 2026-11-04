/*
 * app.js — screens, navigation and service worker registration.
 *
 * Navigation uses the URL hash so it works on GitHub Pages without any
 * server config, and the Home Screen app reopens on the last screen:
 *
 *   #/               recipe list (with meal type filter)
 *   #/tags           pick tags to filter the recipe list
 *   #/recipe/<id>    recipe detail
 *                    (?from=<id>&from=<id>… is the trail of recipes you came
 *                    through by tapping linked ingredients, nearest first;
 *                    Back walks it, so it survives reloads and edits)
 *   #/new            add recipe form
 *   #/edit/<id>      edit recipe form (keeps the detail screen's ?from= trail)
 *   #/backup         export a backup, restore from a backup
 *                    (+ Add on the list adds recipes from any Cookbook file)
 *   #/grocery        the grocery list
 *
 * The bottom panel (Cookbook | Grocery List) shows on #/ and #/grocery only.
 *
 * Each screen is a function that fills <main id="view"> and sets the header.
 * User text is always passed through esc() before it goes into HTML.
 */

(() => {
  const view = document.getElementById('view');
  const headerLeft = document.getElementById('header-left');
  const headerTitle = document.getElementById('header-title');
  const headerRight = document.getElementById('header-right');
  const tabbar = document.getElementById('tabbar');

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  /** Escape text for safe use inside HTML. */
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function go(hash) {
    location.hash = hash;
  }

  // Following links that loop (A → B → A …) could grow the trail forever.
  const MAX_TRAIL = 20;

  /** "?from=b&from=a" for a trail of recipe ids, nearest first ("" if empty). */
  function trailQuery(trail) {
    const params = new URLSearchParams(trail.slice(0, MAX_TRAIL).map((id) => ['from', id]));
    return trail.length ? `?${params}` : '';
  }

  /** Hash for a recipe's detail screen, remembering how you got there. */
  function recipeHash(id, trail = []) {
    return `#/recipe/${encodeURIComponent(id)}${trailQuery(trail)}`;
  }

  /** A to Z by title, ignoring case and accents. */
  function byTitle(a, b) {
    return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  }

  /** Remember small UI preferences (like the filter). Never required to work. */
  const prefs = {
    get(key, fallback) {
      try { return localStorage.getItem(`cookbook.${key}`) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(`cookbook.${key}`, value); } catch { /* private mode etc. */ }
    },
  };

  /**
   * Fill the header. `back` is a hash to return to (shows a back button,
   * with `backLabel` as its spoken name if given);
   * `left` is { label, href } for a plain link on the left instead;
   * `action` is { label, onClick } for the button on the right.
   */
  function setHeader({ title, back, backLabel, left, action }) {
    headerTitle.textContent = title;
    document.title = title === 'Cookbook' ? 'Cookbook' : `${title} · Cookbook`;

    if (back) {
      headerLeft.innerHTML = `<a class="header-btn" href="${esc(back)}" aria-label="${esc(backLabel || 'Back')}"><span aria-hidden="true">‹</span> Back</a>`;
    } else if (left) {
      headerLeft.innerHTML = `<a class="header-btn" href="${esc(left.href)}">${esc(left.label)}</a>`;
    } else {
      headerLeft.innerHTML = '';
    }

    headerRight.innerHTML = '';
    if (action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'header-btn header-btn-strong';
      btn.textContent = action.label;
      btn.addEventListener('click', action.onClick);
      headerRight.append(btn);
    }
  }

  /** A short message that fades away, e.g. "Backup saved". */
  function toast(message, ms = 3000) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = message;
    document.body.append(el);
    setTimeout(() => el.remove(), ms);
  }

  /**
   * Tell the user how a file left the app (see Transfer.deliver). `what` is
   * "Recipe file" or "Backup".
   */
  function reportDelivery(result, what) {
    if (result === 'refused') {
      toast(`The share sheet wouldn't take this file, so ${what.toLowerCase()} was downloaded instead. Check your Downloads folder in Files.`, 8000);
    } else if (result === 'downloaded') {
      toast(`${what} downloaded.`);
    }
  }

  /* ---------- Filters shared by the list and the Tags screen ---------- */

  /**
   * The tag filter is a list of lower-case tag keys saved in prefs, so the
   * list and the Tags screen see the same choice. Keys for tags no recipe
   * uses any more are dropped. A recipe must have every chosen tag.
   */
  function getTagFilter(counts) {
    let keys;
    try { keys = JSON.parse(prefs.get('tagFilter', '[]')); } catch { keys = []; }
    return (Array.isArray(keys) ? keys : []).filter((k) => typeof k === 'string' && counts.has(k));
  }

  function setTagFilter(keys) {
    prefs.set('tagFilter', JSON.stringify(keys));
  }

  function getMealFilter() {
    const value = prefs.get('mealFilter', 'all');
    return value === 'all' || Model.MEAL_TYPES.some((m) => m.value === value) ? value : 'all';
  }

  /** Recipes that pass both the meal type filter and the tag filter. */
  function applyFilters(recipes, meal, tagKeys) {
    return recipes
      .filter((r) => meal === 'all' || r.mealType === meal)
      .filter((r) => tagKeys.every((k) => r.tags.some((t) => t.toLowerCase() === k)));
  }

  /** Every tag used by at least one recipe, most used first, then A to Z. */
  function usedTags(recipes, counts) {
    const byKey = new Map(recipes.flatMap((r) => r.tags).map((t) => [t.toLowerCase(), t]));
    return Tags.sortByUsage([...byKey.values()], counts);
  }

  function tagBubbles(tags) {
    return tags.length
      ? `<span class="tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</span>`
      : '';
  }

  /** Total of prep and cook time, for cards and the detail page. */
  function totalTime(r) {
    if (r.prepMinutes === null && r.cookMinutes === null) return '';
    return Model.formatMinutes((r.prepMinutes || 0) + (r.cookMinutes || 0));
  }

  /* ------------------------------------------------------------------ */
  /* Screen: recipe list                                                 */
  /* ------------------------------------------------------------------ */

  async function showList() {
    setHeader({
      title: 'Cookbook',
      left: { label: 'Backup', href: '#/backup' },
      action: { label: '+ Add', onClick: showAddChoice },
    });

    const recipes = await DB.getAllRecipes();
    recipes.sort(byTitle);

    let filter = getMealFilter();

    // The tag filter is chosen on the Tags screen (#/tags); here we only
    // show which tags are active and let you remove them.
    const counts = Tags.usageCounts(recipes);
    const nameOf = new Map(usedTags(recipes, counts).map((t) => [t.toLowerCase(), t]));
    let tagFilter = getTagFilter(counts);

    // Filter chips: "All" plus one per meal type, each with a count.
    const chips = [{ value: 'all', label: 'All' }, ...Model.MEAL_TYPES]
      .map((m) => {
        const count = m.value === 'all' ? recipes.length : recipes.filter((r) => r.mealType === m.value).length;
        return `<button type="button" class="chip" data-filter="${m.value}">
                  ${esc(m.label)} <span class="chip-count">${count}</span>
                </button>`;
      })
      .join('');

    view.innerHTML = `
      <div id="list-screen">
        <nav class="chips" aria-label="Filter by meal type">${chips}</nav>
        <div class="tag-bar" id="tag-bar"></div>
        <ul class="recipe-grid" id="recipe-grid"></ul>
      </div>
    `;

    const screen = view.querySelector('#list-screen');
    const tagBar = view.querySelector('#tag-bar');
    const grid = view.querySelector('#recipe-grid');

    /**
     * The row under the meal types: a Tags button (opens #/tags) and, when
     * tags are chosen, each one as a removable pill plus Clear.
     */
    function renderTagBar() {
      const active = tagFilter.length;
      tagBar.classList.toggle('tag-bar-active', active > 0);
      tagBar.innerHTML = `
        <a class="tag-bar-btn" href="#/tags" ${nameOf.size ? '' : 'aria-disabled="true"'}>
          <span aria-hidden="true">🏷</span> Tags${active ? ` <span class="tag-bar-count">${active}</span>` : ''}
        </a>
        ${active ? `
          <span class="tag-bar-label">Showing recipes tagged</span>
          ${tagFilter.map((k) => `
            <button type="button" class="bubble bubble-on" data-untag="${esc(k)}"
                    aria-label="Stop filtering by ${esc(nameOf.get(k))}">
              ${esc(nameOf.get(k))} <span aria-hidden="true">✕</span>
            </button>`).join('')}
          <button type="button" class="btn-link tag-bar-clear" data-clear-tags>Clear</button>` : ''}
      `;
    }

    function renderCards() {
      // Highlight the active meal type chip.
      view.querySelectorAll('[data-filter]').forEach((chip) => {
        chip.setAttribute('aria-pressed', String(chip.dataset.filter === filter));
      });
      renderTagBar();

      const shown = applyFilters(recipes, filter, tagFilter);

      if (!shown.length) {
        let message = '<p>Your cookbook is empty.</p>';
        if (recipes.length && tagFilter.length) message = '<p>No recipes match these filters.</p>';
        else if (recipes.length) message = `<p>No ${esc(Model.mealLabel(filter).toLowerCase())} recipes yet.</p>`;
        grid.innerHTML = `
          <li class="empty">
            ${message}
            ${tagFilter.length
              ? '<button type="button" class="btn btn-secondary" data-clear-tags>Clear tag filter</button>'
              : '<a class="btn btn-primary" href="#/new">Add a recipe</a>'}
            ${recipes.length ? '' : '<p><button type="button" class="btn-link btn-link-accent" data-add-choice>Add recipes from a file</button></p>'}
          </li>`;
        return;
      }

      grid.innerHTML = shown.map((r) => {
        const time = totalTime(r);
        const meta = [
          time && `⏱ ${esc(time)}`,
          r.servings && `🍽 ${r.servings}`,
        ].filter(Boolean).join('<span class="dot">·</span>');
        return `
          <li>
            <a class="card" href="#/recipe/${encodeURIComponent(r.id)}">
              <span class="badge badge-${r.mealType}">${esc(Model.mealLabel(r.mealType))}</span>
              <span class="card-title">${esc(r.title || 'Untitled')}</span>
              ${meta ? `<span class="card-meta">${meta}</span>` : ''}
              ${tagBubbles(r.tags)}
            </a>
          </li>`;
      }).join('');
    }

    screen.addEventListener('click', (e) => {
      const meal = e.target.closest('[data-filter]');
      const untag = e.target.closest('[data-untag]');
      if (meal) {
        filter = meal.dataset.filter;
      } else if (untag) {
        tagFilter = tagFilter.filter((k) => k !== untag.dataset.untag);
      } else if (e.target.closest('[data-clear-tags]')) {
        tagFilter = [];
      } else if (e.target.closest('[data-add-choice]')) {
        showAddChoice();
        return;
      } else {
        return;
      }
      prefs.set('mealFilter', filter);
      setTagFilter(tagFilter);
      renderCards();
    });

    renderCards();
  }

  /* ------------------------------------------------------------------ */
  /* Screen: tag filter                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Pick tags to filter the recipe list. Only tags used by at least one
   * recipe are listed; unused tags stay in the tag list but aren't shown
   * here. Choices are saved as you tap, so Back keeps them too.
   */
  async function showTags() {
    setHeader({ title: 'Filter by Tag', back: '#/' });

    const recipes = await DB.getAllRecipes();
    const counts = Tags.usageCounts(recipes);
    const tags = usedTags(recipes, counts);
    const meal = getMealFilter();
    let selected = getTagFilter(counts);

    view.innerHTML = `
      <div class="tag-screen" id="tag-screen">
        <input type="search" id="tag-search" class="tag-search" placeholder="Search tags"
               aria-label="Search tags" autocomplete="off" autocapitalize="none" enterkeyhint="search">
        <div class="tag-status" id="tag-status" aria-live="polite"></div>
        <div class="tag-options" id="tag-options"></div>
        <div class="tag-screen-actions">
          <a class="btn btn-primary" href="#/" id="show-btn"></a>
        </div>
      </div>
    `;

    const search = view.querySelector('#tag-search');
    const status = view.querySelector('#tag-status');
    const options = view.querySelector('#tag-options');
    const showBtn = view.querySelector('#show-btn');

    function render() {
      const query = search.value.trim().toLowerCase();
      // Matches the text anywhere in the tag name, ignoring case.
      const matches = query ? tags.filter((t) => t.toLowerCase().includes(query)) : tags;

      if (!tags.length) {
        options.innerHTML = '<p class="muted">No recipes have tags yet. Add tags in the recipe form.</p>';
      } else if (!matches.length) {
        options.innerHTML = '<p class="muted">No tags match your search.</p>';
      } else {
        options.innerHTML = matches.map((t) => {
          const key = t.toLowerCase();
          return `
            <button type="button" class="chip chip-tag" data-tag="${esc(key)}"
                    aria-pressed="${selected.includes(key)}">
              ${esc(t)} <span class="chip-count">${counts.get(key)}</span>
            </button>`;
        }).join('');
      }

      const n = applyFilters(recipes, meal, selected).length;
      status.innerHTML = `
        ${selected.length
          ? `<p><strong>${selected.length} tag${selected.length === 1 ? '' : 's'} chosen.</strong>
               Recipes must have all of them.
               <button type="button" class="btn-link" data-clear-tags>Clear</button></p>`
          : '<p class="muted">Tap tags to choose them. Pick several to narrow the list.</p>'}
        ${meal !== 'all' ? `<p class="muted">Also filtered by meal type: ${esc(Model.mealLabel(meal))}.</p>` : ''}
      `;
      showBtn.textContent = `Show ${n} recipe${n === 1 ? '' : 's'}`;
    }

    search.addEventListener('input', render);
    view.querySelector('#tag-screen').addEventListener('click', (e) => {
      const tag = e.target.closest('[data-tag]');
      if (tag) {
        const key = tag.dataset.tag;
        selected = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
      } else if (e.target.closest('[data-clear-tags]')) {
        selected = [];
      } else {
        return;
      }
      setTagFilter(selected);
      render();
    });

    render();
  }

  /* ------------------------------------------------------------------ */
  /* Screen: recipe detail                                               */
  /* ------------------------------------------------------------------ */

  /**
   * Checked-off direction steps: recipe id → Set of step ids. Kept in memory
   * only (never saved), so they last while you move between a recipe and its
   * linked recipes, and are cleared when you go back to the recipe list.
   */
  const stepChecks = new Map();
  /** The highlighted step per recipe (recipe id → step id), kept the same way. */
  const stepSelected = new Map();
  /**
   * "Add to grocery list" confirmations you left to look at a related
   * recipe: recipe id → Set of ingredient ids you removed. Coming back to
   * that recipe reopens the confirmation as you left it. Cleared by Cancel,
   * by adding, or by going back to the recipe list.
   */
  const pendingAdds = new Map();

  async function showDetail(id, trail = []) {
    const all = await DB.getAllRecipes();
    const byId = new Map(all.map((x) => [x.id, x]));
    const r = byId.get(id);
    if (!r) return showNotFound();

    // Back returns to the recipe you came from (skipping any deleted since).
    trail = trail.filter((t) => byId.has(t));
    const back = trail.length ? recipeHash(trail[0], trail.slice(1)) : '#/';
    // Recipes with an ingredient linking here, A to Z (for the delete message).
    const linkedFrom = all.filter((x) => x.id !== r.id && x.ingredients.some((i) => i.recipeId === r.id)).sort(byTitle);

    // Prepare the share file now: Safari only opens the share sheet if it's
    // called straight from the tap, with no waiting in between.
    const shareData = Transfer.share(r.id, all);
    const linked = shareData.recipes.length - 1;

    setHeader({
      title: r.title || 'Recipe',
      back,
      backLabel: trail.length ? `Back to ${byId.get(trail[0]).title || 'Untitled'}` : undefined,
      action: { label: 'Edit', onClick: () => go(`#/edit/${encodeURIComponent(r.id)}${trailQuery(trail)}`) },
    });

    // Only show the facts that were filled in.
    const facts = [
      ['Prep', Model.formatMinutes(r.prepMinutes)],
      ['Cook', Model.formatMinutes(r.cookMinutes)],
      ['Total', totalTime(r)],
      ['Serves', r.servings ?? ''],
    ].filter(([, v]) => v !== '');

    // A link to a recipe that isn't on this device shows as plain text; the
    // link is kept in case that recipe is imported later.
    const linkTarget = (i) => i.recipeId && byId.get(i.recipeId);
    const displayName = (i) => i.name || linkTarget(i)?.title || '';
    /** The ingredient's name: a link to its recipe when it has one, else text. */
    function ingredientName(i, linkClass) {
      const target = linkTarget(i);
      return target
        ? `<a class="${linkClass}" href="${esc(recipeHash(target.id, [r.id, ...trail]))}"
              aria-label="${esc(displayName(i))}, open recipe ${esc(target.title)}">
             ${esc(displayName(i))}
           </a>`
        : `<span>${esc(i.name)}</span>`;
    }

    // Ingredients each step mentions, found by keyword (see js/match.js).
    const stepMatches = new Map(r.steps.map((s) => [s.id, Match.byKeyword(s.text, r.ingredients, displayName)]));

    view.innerHTML = `
      <article class="detail">
        ${trail.length && pendingAdds.has(trail[0]) ? `
          <div class="notice notice-grocery" id="pending-add">
            <p>You're adding “${esc(byId.get(trail[0]).title || 'Untitled')}” to your grocery list.</p>
            <a class="btn btn-primary" href="${esc(back)}">Back to finish</a>
          </div>` : ''}
        <div class="detail-head">
          <span class="badge badge-${r.mealType}">${esc(Model.mealLabel(r.mealType))}</span>
          <h2 class="detail-title">${esc(r.title || 'Untitled')}</h2>
          ${tagBubbles(r.tags)}
          ${facts.length ? `
            <dl class="facts">
              ${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}
            </dl>` : ''}
        </div>

        <!-- On iPad (wide screens) these two sections sit side by side. -->
        <div class="detail-body">
          <section class="panel">
            <h3>Ingredients</h3>
            ${r.ingredients.length ? `
              <ul class="ingredient-list">
                ${r.ingredients.map((i) => `
                  <li data-ingredient-id="${esc(i.id)}"${linkTarget(i) ? ' class="is-linked"' : ''}>
                    ${i.amount ? `<span class="amount">${esc(i.amount)}</span>` : ''}
                    ${ingredientName(i, 'ing-link')}
                  </li>`).join('')}
              </ul>` : '<p class="muted">No ingredients listed.</p>'}
          </section>

          <section class="panel">
            <h3>Directions</h3>
            ${r.steps.length ? `
              <p class="muted step-hint">Tap a step to see its ingredients. Tap its number again to check it off.</p>
              <ol class="step-list">
                ${r.steps.map((s, n) => `
                  <li data-step-id="${esc(s.id)}">
                    <button type="button" class="step-num-btn" data-step="${esc(s.id)}" data-n="${n + 1}"
                            aria-label="Step ${n + 1}"><span class="step-num-mark" aria-hidden="true">${n + 1}</span></button>
                    <button type="button" class="step-btn" data-step="${esc(s.id)}" aria-pressed="false">${esc(s.text)}</button>
                  </li>`).join('')}
              </ol>` : '<p class="muted">No directions yet.</p>'}
          </section>
        </div>

        <!-- iPhone: the selected step's ingredients, fixed to the bottom of the screen. -->
        <div class="step-bar" id="step-bar" hidden></div>

        <div class="detail-actions">
          <button type="button" class="btn btn-secondary" id="share-btn">Share recipe</button>
          <button type="button" class="btn btn-secondary" id="grocery-btn" ${r.ingredients.length ? '' : 'disabled'}>Add to grocery list</button>
          <button type="button" class="btn btn-danger" id="delete-btn">Delete recipe</button>
          ${linked ? `<p class="muted">Sharing includes ${linked} linked recipe${linked === 1 ? '' : 's'}.</p>` : ''}
        </div>
      </article>
    `;

    /*
     * Step selection and checking. Each step has two tap targets: its number
     * and its text. The selected step's ingredients are highlighted in the
     * list (iPad) and shown in the bottom bar (iPhone); CSS decides which
     * one is visible at each width.
     *
     *   Tap a step that isn't selected (number or text) → select it
     *   Tap the selected step's text                    → clear the selection
     *   Tap the selected step's number                  → check it off and
     *                                                     select the next unchecked step
     *   Tap a checked step's number                     → uncheck it
     *
     * Checks and the highlighted step are kept per recipe while the app is
     * open (stepChecks, stepSelected), so they survive opening a linked
     * recipe and coming back. Going to the recipe list clears them (route()).
     */
    const stepBar = view.querySelector('#step-bar');
    // The step highlighted last time you were here (if it still exists).
    let selectedStep = r.steps.some((s) => s.id === stepSelected.get(r.id)) ? stepSelected.get(r.id) : null;
    if (!stepChecks.has(r.id)) stepChecks.set(r.id, new Set());
    const checked = stepChecks.get(r.id);

    /** The first unchecked step after `stepId`, or null at the end. */
    function nextUnchecked(stepId) {
      const from = r.steps.findIndex((s) => s.id === stepId);
      return r.steps.slice(from + 1).find((s) => !checked.has(s.id))?.id ?? null;
    }

    function tapStep(stepId, onNumber) {
      if (onNumber && checked.has(stepId)) {
        checked.delete(stepId);
      } else if (stepId !== selectedStep) {
        selectedStep = stepId;
      } else if (onNumber) {
        checked.add(stepId);
        selectedStep = nextUnchecked(stepId);
      } else {
        selectedStep = null;
      }
      stepSelected.set(r.id, selectedStep);
      renderStepSelection();
    }

    function renderStepSelection() {
      const matches = selectedStep ? stepMatches.get(selectedStep) : [];
      const matchIds = new Set(matches.map((i) => i.id));
      view.querySelectorAll('.step-list li').forEach((li) => {
        const id = li.dataset.stepId;
        const on = id === selectedStep;
        const done = checked.has(id);
        li.classList.toggle('is-selected', on);
        li.classList.toggle('is-checked', done);
        li.querySelector('.step-btn').setAttribute('aria-pressed', String(on));
        const num = li.querySelector('.step-num-btn');
        const n = num.dataset.n;
        num.querySelector('.step-num-mark').textContent = done ? '✓' : n;
        num.setAttribute('aria-label', done ? `Step ${n}, done. Tap to uncheck`
          : on ? `Step ${n}. Tap to check off` : `Step ${n}`);
      });
      view.querySelectorAll('.ingredient-list li').forEach((li) => {
        li.classList.toggle('is-match', matchIds.has(li.dataset.ingredientId));
      });

      stepBar.hidden = !matches.length;
      view.querySelector('.detail').classList.toggle('has-step-bar', matches.length > 0);
      if (!matches.length) { stepBar.innerHTML = ''; return; }
      const n = r.steps.findIndex((s) => s.id === selectedStep) + 1;
      stepBar.innerHTML = `
        <span class="step-bar-label">Step ${n}</span>
        <ul class="step-bar-list" aria-label="Ingredients for step ${n}">
          ${matches.map((i) => `
            <li class="step-chip${linkTarget(i) ? ' is-linked' : ''}">
              ${i.amount ? `<span class="amount">${esc(i.amount)}</span>` : ''}
              ${ingredientName(i, 'ing-link')}
            </li>`).join('')}
        </ul>`;
      stepBar.querySelector('.step-bar-list').scrollLeft = 0;
    }

    view.querySelector('.step-list')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.step-btn, .step-num-btn');
      if (btn) tapStep(btn.dataset.step, btn.classList.contains('step-num-btn'));
    });
    renderStepSelection(); // show checks and the highlight kept from earlier

    // Add to grocery list: confirm the items, with related recipes.
    const groceryName = (i) => i.name || (i.recipeId && byId.get(i.recipeId)?.title) || '';
    function openGroceryAdd() {
      if (!pendingAdds.has(r.id)) pendingAdds.set(r.id, new Set());
      confirmGroceryAdd({
        recipe: r,
        nameOf: groceryName,
        removed: pendingAdds.get(r.id),
        related: Foods.related(r, all, groceryName),
        onRelated: (id) => go(recipeHash(id, [r.id, ...trail])),
        onDone: () => pendingAdds.delete(r.id),
      });
    }
    view.querySelector('#grocery-btn').addEventListener('click', openGroceryAdd);
    if (pendingAdds.has(r.id)) openGroceryAdd(); // came back from a related recipe

    view.querySelector('#share-btn').addEventListener('click', () => {
      Transfer.deliver(Transfer.shareFileName(r), shareData, r.title)
        .then((result) => reportDelivery(result, 'Recipe file'));
    });

    view.querySelector('#delete-btn').addEventListener('click', async () => {
      // List the recipes that link here (at most 10 names, so the dialog fits).
      const n = linkedFrom.length;
      const shown = linkedFrom.slice(0, 10).map((x) => `• ${x.title || 'Untitled'}`);
      if (n > shown.length) shown.push(`• and ${n - shown.length} more`);
      const links = n
        ? `\n\n${n === 1 ? 'This recipe links' : `These ${n} recipes link`} to it:\n${shown.join('\n')}\n\n` +
          `Their linked ${n === 1 ? 'ingredient' : 'ingredients'} will become plain text.`
        : '';
      if (!confirm(`Delete “${r.title || 'Untitled'}”? This can't be undone.${links}`)) return;
      await DB.deleteRecipe(r.id); // also unlinks ingredients that point here
      go(back);
    });
  }

  /**
   * "Add to grocery list" confirmation. Lists the recipe's ingredients with
   * amounts; ✕ removes one (tap Undo to bring it back). Related recipes share
   * ingredients with this one (staples like salt and oil don't count).
   * Tapping one closes this without losing it: `removed` is the caller's
   * Set, kept in pendingAdds until you add or cancel. A linked homemade
   * ingredient is one item; its own recipe's ingredients aren't added.
   */
  async function confirmGroceryAdd({ recipe, nameOf, removed, related, onRelated, onDone }) {
    const already = (await DB.getGroceryItems()).some((g) => g.recipeId === recipe.id);
    const items = recipe.ingredients.filter((i) => nameOf(i) || i.amount);

    const dialog = document.createElement('dialog');
    dialog.className = 'dialog grocery-dialog';
    dialog.id = 'grocery-add';
    dialog.setAttribute('aria-labelledby', 'grocery-add-title');
    dialog.innerHTML = `
      <form method="dialog">
        <h3 id="grocery-add-title">Add to grocery list</h3>
        <p class="muted">${esc(recipe.title || 'Untitled')}: remove anything you already have.</p>
        ${already ? '<p class="dialog-note">This recipe is already on your grocery list. Adding it again adds these items again.</p>' : ''}
        <ul class="add-list">
          ${items.map((i) => `
            <li data-ing="${esc(i.id)}">
              <span class="amount">${esc(i.amount)}</span>
              <span class="add-name">${esc(nameOf(i))}</span>
              <button type="button" class="add-toggle" data-toggle="${esc(i.id)}"></button>
            </li>`).join('')}
        </ul>
        <section class="related" aria-labelledby="related-title">
          <h4 id="related-title">Related recipes</h4>
          ${related.length ? `
            <p class="muted">These share ingredients with this one, so they're good to cook the same week.</p>
            <ul class="related-list">
              ${related.map(({ recipe: x, shared }) => `
                <li>
                  <button type="button" class="related-btn" data-related="${esc(x.id)}">
                    <span class="related-title">${esc(x.title || 'Untitled')}</span>
                    <span class="related-shared">${shared.length} shared: ${esc(shared.join(', '))}</span>
                  </button>
                </li>`).join('')}
            </ul>` : '<p class="muted">No other recipes share ingredients with this one.</p>'}
        </section>
        <div class="dialog-buttons">
          <button class="btn btn-secondary" value="cancel">Cancel</button>
          <button class="btn btn-primary" value="add" id="grocery-add-btn"></button>
        </div>
      </form>`;
    document.body.append(dialog);

    const addBtn = dialog.querySelector('#grocery-add-btn');
    function render() {
      dialog.querySelectorAll('.add-list li').forEach((li) => {
        const off = removed.has(li.dataset.ing);
        li.classList.toggle('is-removed', off);
        const btn = li.querySelector('.add-toggle');
        const name = li.querySelector('.add-name').textContent;
        btn.textContent = off ? 'Undo' : '✕';
        btn.setAttribute('aria-label', off ? `Put back ${name}` : `Remove ${name}`);
      });
      const n = items.filter((i) => !removed.has(i.id)).length;
      addBtn.textContent = n ? `Add ${n} item${n === 1 ? '' : 's'}` : 'Nothing to add';
      addBtn.disabled = !n;
    }

    let leavingFor = null;
    dialog.addEventListener('click', (e) => {
      const toggle = e.target.closest('[data-toggle]');
      const rel = e.target.closest('[data-related]');
      if (toggle) {
        const id = toggle.dataset.toggle;
        if (removed.has(id)) removed.delete(id); else removed.add(id);
        render();
      } else if (rel) {
        leavingFor = rel.dataset.related;
        dialog.close('related');
      }
    });

    dialog.addEventListener('close', async () => {
      const choice = dialog.returnValue;
      dialog.remove();
      if (choice === 'related' && leavingFor) { onRelated(leavingFor); return; }
      onDone();
      if (choice !== 'add') return;
      const chosen = items.filter((i) => !removed.has(i.id));
      await DB.addGroceryItems(chosen.map((i) => ({
        name: nameOf(i), amount: i.amount, recipeId: recipe.id,
        recipeTitle: recipe.title || 'Untitled', ingredientId: i.id,
      })));
      toast(`Added ${chosen.length} item${chosen.length === 1 ? '' : 's'} to your grocery list.`);
    });

    render();
    dialog.showModal();
  }

  /* ------------------------------------------------------------------ */
  /* Screen: grocery list                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Grouped by food type (default) or by recipe; the choice is remembered.
   * In the food type view, the same food from several recipes is one line
   * with each amount listed ("butter: 1/2 cup, 2 tbsp"); amounts are never
   * added up. Ticking or removing a line ticks or removes all its items.
   */
  async function showGrocery() {
    let items = await DB.getGroceryItems();
    // The screen's own element, so its click handler goes away with it.
    view.innerHTML = '<div id="grocery-screen"></div>';
    const screen = view.querySelector('#grocery-screen');
    let group = prefs.get('groceryGroup', 'type') === 'recipe' ? 'recipe' : 'type';

    function header() {
      setHeader({
        title: 'Grocery List',
        action: items.length ? { label: 'Clear', onClick: clearAll } : undefined,
      });
    }

    async function clearAll() {
      if (!confirm('Clear the whole grocery list? This can\'t be undone.')) return;
      await DB.clearGrocery();
      items = [];
      render();
    }

    /** Lines for the food type view: { type, label, items } in list order. */
    function typeLines() {
      const lines = new Map();
      items.forEach((item) => {
        const type = Foods.typeOf(item.name);
        const id = `${type}|${Foods.key(item.name) || item.name.toLowerCase()}`;
        if (!lines.has(id)) lines.set(id, { type, key: Foods.key(item.name), items: [] });
        lines.get(id).items.push(item);
      });
      return [...lines.values()].map((line) => {
        const names = [...new Set(line.items.map((i) => i.name.toLowerCase()))];
        return { ...line, label: names.length === 1 ? line.items[0].name : line.key || line.items[0].name };
      });
    }

    function lineHtml({ label, items: its, from }) {
      const amounts = its.map((i) => i.amount).filter(Boolean);
      const done = its.every((i) => i.checked);
      const ids = its.map((i) => i.id).join(',');
      return `
        <li class="grocery-line${done ? ' is-checked' : ''}" data-ids="${esc(ids)}">
          <button type="button" class="grocery-tick" data-tick aria-pressed="${done}">
            <span class="tick-box" aria-hidden="true">${done ? '✓' : ''}</span>
            <span class="grocery-text">
              <span class="grocery-label"><span class="grocery-name">${esc(label)}</span>${amounts.length ? `<span class="grocery-amounts">: ${esc(amounts.join(', '))}</span>` : ''}</span>
              ${from ? `<span class="grocery-from">${esc(from)}</span>` : ''}
            </span>
          </button>
          <button type="button" class="icon-btn grocery-remove" data-remove aria-label="Remove ${esc(label)}">✕</button>
        </li>`;
    }

    function render() {
      header();
      if (!items.length) {
        screen.innerHTML = `
          <div class="empty grocery-empty">
            <p>Your grocery list is empty.</p>
            <p class="muted">Open a recipe and tap <strong>Add to grocery list</strong>.</p>
            <a class="btn btn-primary" href="#/">Go to recipes</a>
          </div>`;
        return;
      }
      const ticked = items.filter((i) => i.checked).length;
      let groups;
      if (group === 'type') {
        const lines = typeLines();
        groups = Foods.TYPES
          .map((type) => ({ title: type, lines: lines.filter((l) => l.type === type) }))
          .filter((g) => g.lines.length)
          .map((g) => ({
            title: g.title,
            lines: g.lines.map((l) => ({
              label: l.label, items: l.items,
              from: [...new Set(l.items.map((i) => i.recipeTitle))].join(', '),
            })),
          }));
      } else {
        const byRecipe = new Map();
        items.forEach((i) => {
          const k = `${i.recipeId}|${i.recipeTitle}`;
          if (!byRecipe.has(k)) byRecipe.set(k, { title: i.recipeTitle, lines: [] });
          byRecipe.get(k).lines.push({ label: i.name, items: [i] });
        });
        groups = [...byRecipe.values()];
      }
      screen.innerHTML = `
        <div class="grocery" id="grocery">
          <div class="grocery-top">
            <div class="grocery-switch" role="group" aria-label="Group items">
              <button type="button" class="chip" data-group="type" aria-pressed="${group === 'type'}">By food type</button>
              <button type="button" class="chip" data-group="recipe" aria-pressed="${group === 'recipe'}">By recipe</button>
            </div>
            <p class="muted grocery-count">${ticked} of ${items.length} ticked</p>
          </div>
          ${groups.map((g) => `
            <section class="panel grocery-group" data-group-title="${esc(g.title)}">
              <h3>${esc(g.title)}</h3>
              <ul class="grocery-items">${g.lines.map(lineHtml).join('')}</ul>
            </section>`).join('')}
        </div>`;
    }

    screen.addEventListener('click', async (e) => {
      const switchBtn = e.target.closest('[data-group]');
      const line = e.target.closest('.grocery-line');
      if (switchBtn) {
        group = switchBtn.dataset.group;
        prefs.set('groceryGroup', group);
      } else if (line && e.target.closest('[data-tick]')) {
        const ids = line.dataset.ids.split(',');
        const done = !items.filter((i) => ids.includes(i.id)).every((i) => i.checked);
        await DB.setGroceryChecked(ids, done);
        items = items.map((i) => (ids.includes(i.id) ? { ...i, checked: done } : i));
      } else if (line && e.target.closest('[data-remove]')) {
        const ids = line.dataset.ids.split(',');
        await DB.deleteGroceryItems(ids);
        items = items.filter((i) => !ids.includes(i.id));
      } else {
        return;
      }
      render();
    });

    render();
  }

  /* ------------------------------------------------------------------ */
  /* Screen: add / edit form                                             */
  /* ------------------------------------------------------------------ */

  /**
   * The form edits a working copy ("draft") of the recipe. Before any
   * add/remove/move we copy what's typed into the draft (syncFromForm),
   * change the draft, then redraw that list. Ingredient and step objects
   * keep their ids and any extra fields (recipeId, ingredientIds), so links
   * survive moving rows, and the future step links survive edits.
   */
  async function showForm(id, trail = []) {
    const [existing, allRecipes, tagNames] = await Promise.all([
      id ? DB.getRecipe(id) : null, DB.getAllRecipes(), DB.getTagNames(),
    ]);
    if (id && !existing) return showNotFound();

    const draft = existing || Model.newRecipe();
    // Start new recipes with one empty row of each so the form isn't bare.
    if (!draft.ingredients.length) draft.ingredients.push(Model.newIngredient());
    if (!draft.steps.length) draft.steps.push(Model.newStep());

    const backTo = existing ? recipeHash(existing.id, trail) : '#/';
    const recipeById = new Map(allRecipes.map((x) => [x.id, x]));
    setHeader({ title: existing ? 'Edit Recipe' : 'New Recipe', back: backTo, action: { label: 'Save', onClick: save } });

    const mealOptions = Model.MEAL_TYPES.map((m) => `
      <label class="segment">
        <input type="radio" name="mealType" value="${m.value}" ${draft.mealType === m.value ? 'checked' : ''}>
        <span>${esc(m.label)}</span>
      </label>`).join('');

    view.innerHTML = `
      <form class="form" id="recipe-form" novalidate>
        <section class="panel">
          <label class="field">
            <span class="field-label">Title</span>
            <input name="title" type="text" required autocomplete="off" enterkeyhint="next"
                   value="${esc(draft.title)}" placeholder="e.g. Buttermilk pancakes">
          </label>

          <fieldset class="field">
            <legend class="field-label">Meal type</legend>
            <div class="segments">${mealOptions}</div>
          </fieldset>

          <div class="field-row">
            <label class="field">
              <span class="field-label">Prep (min)</span>
              <input name="prepMinutes" type="number" inputmode="numeric" min="0" step="1"
                     value="${draft.prepMinutes ?? ''}" placeholder="0">
            </label>
            <label class="field">
              <span class="field-label">Cook (min)</span>
              <input name="cookMinutes" type="number" inputmode="numeric" min="0" step="1"
                     value="${draft.cookMinutes ?? ''}" placeholder="0">
            </label>
            <label class="field">
              <span class="field-label">Servings</span>
              <input name="servings" type="number" inputmode="numeric" min="0" step="1"
                     value="${draft.servings ?? ''}" placeholder="2">
            </label>
          </div>

          <div class="field">
            <span class="field-label">Tags</span>
            <div id="tag-editor"></div>
          </div>
        </section>

        <section class="panel">
          <h3>Ingredients</h3>
          <ul class="edit-list" id="ingredient-rows"></ul>
          <button type="button" class="btn btn-secondary" data-action="add-ingredient">+ Add ingredient</button>
        </section>

        <section class="panel">
          <h3>Directions</h3>
          <ol class="edit-list" id="step-rows"></ol>
          <button type="button" class="btn btn-secondary" data-action="add-step">+ Add step</button>
        </section>

        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Save recipe</button>
          <a class="btn btn-secondary" href="${esc(backTo)}">Cancel</a>
        </div>
      </form>
    `;

    const form = view.querySelector('#recipe-form');
    const ingredientRows = form.querySelector('#ingredient-rows');
    const stepRows = form.querySelector('#step-rows');

    // Tag bubbles. New tags are added to the tag list as soon as you create them.
    const tagList = [...tagNames];
    const tagEditor = Tags.mountEditor(form.querySelector('#tag-editor'), {
      tags: draft.tags,
      getList: () => tagList,
      counts: Tags.usageCounts(allRecipes),
      onCreate: async (name) => {
        const saved = await DB.addTag(name);
        if (!tagList.includes(saved)) tagList.push(saved);
        return saved;
      },
    });

    function renderIngredients() {
      ingredientRows.innerHTML = draft.ingredients.map((ing, i) => `
        <li class="edit-row" data-id="${esc(ing.id)}">
          <input class="ing-amount" type="text" autocomplete="off" placeholder="Amount"
                 aria-label="Amount for ingredient ${i + 1}" value="${esc(ing.amount)}">
          <input class="ing-name" type="text" autocomplete="off" placeholder="Ingredient" enterkeyhint="next"
                 aria-label="Ingredient ${i + 1}" value="${esc(ing.name)}">
          <div class="row-tools">
            <button type="button" class="icon-btn link-btn" data-action="link-ingredient" data-index="${i}"
                    aria-label="${ing.recipeId ? 'Change linked recipe' : 'Link to a recipe'} for ingredient ${i + 1}"
                    ${ing.recipeId ? 'data-linked' : ''}>🔗</button>
            ${moveButtons('ingredient', i, draft.ingredients.length)}
            <button type="button" class="icon-btn" data-action="remove-ingredient" data-index="${i}"
                    aria-label="Remove ingredient ${i + 1}">✕</button>
          </div>
          ${ing.recipeId ? linkInfo(ing, i) : ''}
        </li>`).join('');
    }

    /** "🔗 Links to Pizza Dough · Unlink" under a linked row. */
    function linkInfo(ing, i) {
      const target = recipeById.get(ing.recipeId);
      return `
        <div class="link-info">
          <span class="link-info-text">
            <span aria-hidden="true">🔗</span>
            ${target ? `Links to <strong>${esc(target.title || 'Untitled')}</strong>`
                     : 'Links to a recipe that isn’t on this device'}
          </span>
          <button type="button" class="btn-link link-remove" data-action="unlink-ingredient" data-index="${i}"
                  aria-label="Unlink ingredient ${i + 1}">Unlink</button>
        </div>`;
    }

    function renderSteps() {
      stepRows.innerHTML = draft.steps.map((step, i) => `
        <li class="edit-row edit-row-step" data-id="${esc(step.id)}">
          <span class="step-num" aria-hidden="true">${i + 1}</span>
          <textarea class="step-text" rows="2" placeholder="Describe this step"
                    aria-label="Step ${i + 1}">${esc(step.text)}</textarea>
          <div class="row-tools">
            ${moveButtons('step', i, draft.steps.length)}
            <button type="button" class="icon-btn" data-action="remove-step" data-index="${i}"
                    aria-label="Remove step ${i + 1}">✕</button>
          </div>
        </li>`).join('');
    }

    /** Up/down buttons for reordering; disabled at the ends. */
    function moveButtons(kind, i, length) {
      return `
        <button type="button" class="icon-btn" data-action="move-${kind}" data-index="${i}" data-dir="-1"
                aria-label="Move ${kind} ${i + 1} up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="icon-btn" data-action="move-${kind}" data-index="${i}" data-dir="1"
                aria-label="Move ${kind} ${i + 1} down" ${i === length - 1 ? 'disabled' : ''}>↓</button>`;
    }

    /** Copy everything typed in the form into `draft`. */
    function syncFromForm() {
      const data = new FormData(form);
      draft.title = data.get('title').trim();
      draft.mealType = data.get('mealType') || 'other';
      draft.prepMinutes = data.get('prepMinutes');
      draft.cookMinutes = data.get('cookMinutes');
      draft.servings = data.get('servings');
      draft.tags = tagEditor.getTags();

      // Rows are matched to draft objects by position (they're rendered in
      // draft order), so extra fields like recipeId are kept.
      ingredientRows.querySelectorAll('.edit-row').forEach((row, i) => {
        draft.ingredients[i].amount = row.querySelector('.ing-amount').value.trim();
        draft.ingredients[i].name = row.querySelector('.ing-name').value.trim();
      });
      stepRows.querySelectorAll('.edit-row').forEach((row, i) => {
        draft.steps[i].text = row.querySelector('.step-text').value.trim();
      });
    }

    function move(list, index, dir) {
      const to = index + dir;
      if (to < 0 || to >= list.length) return;
      [list[index], list[to]] = [list[to], list[index]];
    }

    /** Put the cursor in a row's first field after adding it. */
    function focusRow(container, index) {
      const row = container.querySelectorAll('.edit-row')[index];
      if (row) row.querySelector('input, textarea').focus();
    }

    // One click handler for every row button (event delegation).
    form.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      syncFromForm();
      const i = Number(btn.dataset.index);
      const dir = Number(btn.dataset.dir);

      switch (btn.dataset.action) {
        case 'add-ingredient':
          draft.ingredients.push(Model.newIngredient());
          renderIngredients();
          focusRow(ingredientRows, draft.ingredients.length - 1);
          break;
        case 'remove-ingredient':
          draft.ingredients.splice(i, 1);
          renderIngredients();
          break;
        case 'move-ingredient':
          move(draft.ingredients, i, dir);
          renderIngredients();
          break;
        case 'link-ingredient': {
          const ing = draft.ingredients[i];
          pickRecipe(allRecipes, { excludeId: draft.id, currentId: ing.recipeId }).then((picked) => {
            if (!picked) return;
            ing.recipeId = picked.id;
            if (!ing.name) ing.name = picked.title; // never overwrite a typed name
            renderIngredients();
            ingredientRows.querySelectorAll('.link-btn')[draft.ingredients.indexOf(ing)]?.focus();
          });
          break;
        }
        case 'unlink-ingredient':
          draft.ingredients[i].recipeId = null; // the typed name stays
          renderIngredients();
          ingredientRows.querySelectorAll('.link-btn')[i]?.focus();
          break;
        case 'add-step':
          draft.steps.push(Model.newStep());
          renderSteps();
          focusRow(stepRows, draft.steps.length - 1);
          break;
        case 'remove-step':
          draft.steps.splice(i, 1);
          renderSteps();
          break;
        case 'move-step':
          move(draft.steps, i, dir);
          renderSteps();
          break;
      }
    });

    // Pressing Return in the last ingredient name adds a new row — handy
    // when typing a list on the on-screen keyboard.
    ingredientRows.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !e.target.classList.contains('ing-name')) return;
      e.preventDefault();
      const rows = [...ingredientRows.querySelectorAll('.edit-row')];
      const index = rows.indexOf(e.target.closest('.edit-row'));
      if (index === rows.length - 1) {
        form.querySelector('[data-action="add-ingredient"]').click();
      } else {
        focusRow(ingredientRows, index + 1);
      }
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      save();
    });

    async function save() {
      await tagEditor.flush(); // keep a tag that was typed but not yet added
      syncFromForm();
      if (!draft.title) {
        const title = form.elements.title;
        title.setCustomValidity('Please give the recipe a title.');
        title.reportValidity();
        title.addEventListener('input', () => title.setCustomValidity(''), { once: true });
        title.focus();
        return;
      }

      // Drop blank rows, and drop step references to ingredients that no
      // longer exist (keeps the future step→ingredient links tidy).
      // A linked row left without a name takes the linked recipe's title.
      draft.ingredients.forEach((i) => {
        if (i.recipeId && !i.name && recipeById.has(i.recipeId)) i.name = recipeById.get(i.recipeId).title;
      });
      draft.ingredients = draft.ingredients.filter((i) => i.name || i.amount);
      const ingredientIds = new Set(draft.ingredients.map((i) => i.id));
      draft.steps = draft.steps
        .filter((s) => s.text)
        .map((s) => ({ ...s, ingredientIds: s.ingredientIds.filter((iid) => ingredientIds.has(iid)) }));

      const saved = await DB.saveRecipe(draft);
      // replace() so Back from the detail screen doesn't return to the form.
      location.replace(recipeHash(saved.id, trail));
    }

    renderIngredients();
    renderSteps();
    if (!existing) form.elements.title.focus();
  }

  /**
   * Choose a recipe for an ingredient to link to. Lists only recipes with
   * meal type Other, A to Z, never `excludeId` (the recipe being edited),
   * with a search box. Resolves to the chosen recipe, or null if cancelled.
   */
  function pickRecipe(recipes, { excludeId, currentId }) {
    const options = recipes
      .filter((x) => x.mealType === 'other' && x.id !== excludeId)
      .sort(byTitle);
    return new Promise((resolve) => {
      let picked = null;
      const dialog = document.createElement('dialog');
      dialog.className = 'dialog picker';
      dialog.id = 'recipe-picker';
      dialog.setAttribute('aria-labelledby', 'recipe-picker-title');
      dialog.innerHTML = `
        <form method="dialog">
          <h3 id="recipe-picker-title">Link to a recipe</h3>
          <p class="muted">Recipes in the Other category, like sauces and broths.</p>
          ${options.length ? `
            <input type="search" class="tag-search" id="picker-search" placeholder="Search recipes"
                   aria-label="Search recipes" autocomplete="off" enterkeyhint="search">` : ''}
          <div class="picker-list" id="picker-list" aria-live="polite"></div>
          <button class="btn btn-secondary" value="cancel">Cancel</button>
        </form>`;
      document.body.append(dialog);

      const search = dialog.querySelector('#picker-search');
      const list = dialog.querySelector('#picker-list');
      function render() {
        const query = search ? search.value.trim().toLowerCase() : '';
        const matches = query ? options.filter((x) => x.title.toLowerCase().includes(query)) : options;
        if (!options.length) {
          list.innerHTML = `<p class="picker-empty">No recipes in the Other category yet. Save a recipe
            with meal type <strong>Other</strong> (for example a sauce or broth) to link to it.</p>`;
        } else if (!matches.length) {
          list.innerHTML = '<p class="muted picker-empty">No Other recipes match your search.</p>';
        } else {
          list.innerHTML = `<ul>${matches.map((x) => `
            <li><button type="button" class="picker-option" data-pick="${esc(x.id)}"
                        ${x.id === currentId ? 'aria-current="true"' : ''}>
              <span>${esc(x.title || 'Untitled')}</span>
              ${x.id === currentId ? '<span class="muted">Linked</span>' : ''}
            </button></li>`).join('')}</ul>`;
        }
      }
      search?.addEventListener('input', render);
      // Return in the search box shouldn't close the picker.
      search?.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
      list.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-pick]');
        if (!btn) return;
        picked = options.find((x) => x.id === btn.dataset.pick) || null;
        dialog.close('pick');
      });
      dialog.addEventListener('close', () => {
        dialog.remove();
        resolve(picked);
      });
      render();
      dialog.showModal();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Screen: backup (export and restore)                                 */
  /* ------------------------------------------------------------------ */

  async function showBackup() {
    setHeader({ title: 'Backup', back: '#/' });

    const [recipes, tagNames] = await Promise.all([DB.getAllRecipes(), DB.getTagNames()]);
    // Prepared now so the tap can open the share sheet straight away.
    const backupData = Transfer.backup(recipes, tagNames);
    const count = recipes.length;

    view.innerHTML = `
      <div class="stack">
        <section class="panel">
          <h3>Export</h3>
          <p>Save all ${count} recipe${count === 1 ? '' : 's'} and your tag list in one backup file.
             On iPhone and iPad, choose <strong>Save to Files</strong> in the share sheet.</p>
          <button type="button" class="btn btn-primary" id="export-btn" ${count ? '' : 'disabled'}>Export all recipes</button>
        </section>

        <section class="panel">
          <h3>Restore from a backup</h3>
          <p>Add the recipes and tags from a backup (<code>.cookbook</code>, or an
             older <code>.json</code> backup). If anything in the file is invalid,
             nothing is restored.</p>
          <p class="muted">To add a recipe someone shared with you (<code>.recipe</code>),
             tap <strong>+ Add</strong> on the recipe list and choose <strong>Add from file</strong>.</p>
          <!-- No "accept" limit: iOS doesn't know .cookbook and would grey it
               out. The file's contents decide whether it's valid. -->
          <label class="btn btn-secondary file-btn">
            Choose backup…
            <input type="file" id="import-input" class="visually-hidden">
          </label>
          <div id="import-result" aria-live="polite"></div>
        </section>
      </div>
    `;

    view.querySelector('#export-btn').addEventListener('click', () => {
      Transfer.deliver(Transfer.backupFileName(), backupData, 'Cookbook backup')
        .then((result) => reportDelivery(result, 'Backup'));
    });

    const input = view.querySelector('#import-input');
    const result = view.querySelector('#import-result');

    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.value = ''; // so choosing the same file again still triggers
      if (!file) return;
      result.innerHTML = '<p class="muted">Checking file…</p>';
      const outcome = await importFile(file, { backupOnly: true });
      result.innerHTML = outcome.ok ? '' : `
        <div class="notice notice-error" role="alert">
          <p>${esc(outcome.message)}</p>
          <p>Nothing was changed.</p>
        </div>`;
    });
  }

  /**
   * Check and import one file: conflict questions, one all-or-nothing save,
   * then "Import complete". Used by "Add from file" (any Cookbook file) and
   * by the Backup screen (`backupOnly`: backups only). Resolves to
   * { ok: true } or { ok: false, cancelled, message } — nothing was saved.
   */
  async function importFile(file, { backupOnly = false } = {}) {
    try {
      const parsed = Transfer.parse(await Transfer.readFile(file));
      if (backupOnly && parsed.kind !== 'backup') {
        throw new Transfer.ImportError('This is a shared recipe file, not a backup. To add it, tap + Add on the recipe list and choose Add from file.');
      }
      const plan = await Transfer.plan(parsed.recipes, await DB.getAllRecipes(), askConflict);
      await DB.importRecipes(plan.recipes, parsed.tags);
      await showImportComplete(plan);
      return { ok: true };
    } catch (err) {
      console.error(err);
      const cancelled = err.name === 'ImportCancelled';
      const message = err.name === 'ImportError' ? err.message
        : cancelled ? 'Import cancelled.'
        : `Something went wrong: ${err.message || err}`;
      return { ok: false, cancelled, message };
    }
  }

  /**
   * The + Add choice on the recipe list: type a recipe in, or add one from
   * a file (.recipe, .cookbook or an older .json export).
   */
  function showAddChoice() {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog add-choice';
    dialog.id = 'add-choice';
    dialog.setAttribute('aria-labelledby', 'add-choice-title');
    dialog.innerHTML = `
      <form method="dialog">
        <h3 id="add-choice-title">Add a recipe</h3>
        <button class="btn btn-primary" value="manual">Add manually</button>
        <!-- A label around the file input opens the file picker straight from
             the tap, which iOS requires. No "accept" limit: iOS doesn't know
             .recipe or .cookbook and would grey them out. -->
        <label class="btn btn-secondary file-btn">
          Add from file
          <input type="file" id="add-file-input" class="visually-hidden">
        </label>
        <p class="muted dialog-note">A shared recipe (<code>.recipe</code>), a backup
           (<code>.cookbook</code>) or an older <code>.json</code> export.</p>
        <button class="btn-link" value="cancel">Cancel</button>
      </form>`;
    document.body.append(dialog);

    let file = null;
    const input = dialog.querySelector('#add-file-input');
    input.addEventListener('change', () => {
      file = input.files[0] || null;
      if (file) dialog.close('file');
    });
    dialog.addEventListener('close', () => {
      const choice = dialog.returnValue;
      dialog.remove();
      if (choice === 'manual') go('#/new');
      else if (choice === 'file' && file) addFromFile(file);
    });
    dialog.showModal();
  }

  /** "Add from file": import, then refresh the list so new recipes show. */
  async function addFromFile(file) {
    const outcome = await importFile(file);
    if (outcome.ok) {
      if (!location.hash || location.hash === '#/') route();
      else go('#/');
    } else if (outcome.cancelled) {
      toast('Import cancelled. Nothing was changed.');
    } else {
      showImportError(outcome.message);
    }
  }

  /** A file that couldn't be imported: say why, and that nothing changed. */
  function showImportError(message) {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    dialog.id = 'import-error';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-labelledby', 'import-error-title');
    dialog.innerHTML = `
      <form method="dialog">
        <h3 id="import-error-title">Couldn’t add from file</h3>
        <p>${esc(message)}</p>
        <p class="muted">Nothing was changed.</p>
        <button class="btn btn-primary" value="ok">OK</button>
      </form>`;
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
  }

  /**
   * "Import complete" message, shown only after recipes were saved (never
   * for a cancelled import or an invalid file). Resolves when OK is tapped.
   * "Added" counts new recipes plus Keep both copies.
   */
  function showImportComplete({ summary, warnings }) {
    const added = summary.added + summary.keptBoth;
    const rows = [
      ['Added', added, summary.keptBoth ? `including ${summary.keptBoth} kept as a second copy` : ''],
      ['Overwritten', summary.overwritten, ''],
      ['Ignored', summary.ignored, ''],
      ['Renamed with “-new”', warnings.length, ''],
    ];
    return new Promise((resolve) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'dialog';
      dialog.id = 'import-complete';
      dialog.setAttribute('aria-labelledby', 'import-complete-title');
      dialog.innerHTML = `
        <form method="dialog">
          <h3 id="import-complete-title">Import complete</h3>
          <dl class="import-counts">
            ${rows.map(([label, n, note]) => `
              <div data-count="${esc(label)}">
                <dt>${esc(label)}${note ? `<span class="muted"> (${esc(note)})</span>` : ''}</dt>
                <dd>${n}</dd>
              </div>`).join('')}
          </dl>
          ${warnings.length ? `
            <ul class="dialog-help muted">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
          <button class="btn btn-primary" value="ok">OK</button>
        </form>`;
      document.body.append(dialog);
      dialog.addEventListener('close', () => {
        dialog.remove();
        resolve();
      });
      dialog.showModal();
    });
  }

  /**
   * Ask what to do with a recipe from the file whose id is already on this
   * device. Resolves to { choice, applyToAll }; rejects if the import is
   * cancelled (Cancel button or Escape), in which case nothing is saved.
   */
  function askConflict(fileRecipe, deviceRecipe, remaining) {
    const date = (ms) => new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' });
    return new Promise((resolve, reject) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'dialog';
      dialog.innerHTML = `
        <form method="dialog">
          <h3>Already in your cookbook</h3>
          <p>“${esc(fileRecipe.title)}” in the file is the same recipe as
             “${esc(deviceRecipe.title)}” on this device.</p>
          <p class="muted">On this device: updated ${date(deviceRecipe.updatedAt)}<br>
             In the file: updated ${date(fileRecipe.updatedAt)}</p>
          <ul class="dialog-help muted">
            <li><strong>Ignore</strong> keeps yours and skips the file's copy.</li>
            <li><strong>Overwrite</strong> replaces yours with the file's copy.</li>
            <li><strong>Keep both</strong> adds the file's copy as a separate recipe.</li>
          </ul>
          ${remaining ? `
            <label class="check">
              <input type="checkbox" name="all">
              Do the same for the other ${remaining} matching recipe${remaining === 1 ? '' : 's'}
            </label>` : ''}
          <div class="dialog-actions">
            <button class="btn btn-secondary" value="ignore">Ignore</button>
            <button class="btn btn-secondary" value="overwrite">Overwrite</button>
            <button class="btn btn-secondary" value="keep">Keep both</button>
          </div>
          <button class="btn-link" value="cancel">Cancel import</button>
        </form>`;
      document.body.append(dialog);

      dialog.addEventListener('close', () => {
        const choice = dialog.returnValue;
        const applyToAll = Boolean(dialog.querySelector('[name="all"]')?.checked);
        dialog.remove();
        if (['ignore', 'overwrite', 'keep'].includes(choice)) {
          resolve({ choice, applyToAll });
        } else {
          const err = new Error('Import cancelled.');
          err.name = 'ImportCancelled';
          reject(err);
        }
      });
      dialog.showModal();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Fallback screen                                                     */
  /* ------------------------------------------------------------------ */

  function showNotFound() {
    setHeader({ title: 'Not found', back: '#/' });
    view.innerHTML = `
      <div class="empty">
        <p>That recipe isn't in this cookbook.</p>
        <a class="btn btn-primary" href="#/">Back to recipes</a>
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Router                                                              */
  /* ------------------------------------------------------------------ */

  async function route() {
    // "#/edit/abc?from=xyz" → ["edit", "abc"] and trail ["xyz"]
    const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
    const [page, rawId] = path.split('/');
    const id = rawId ? decodeURIComponent(rawId) : null;
    const trail = new URLSearchParams(query).getAll('from').filter(Boolean).slice(0, MAX_TRAIL);

    if (!page) { stepChecks.clear(); stepSelected.clear(); pendingAdds.clear(); }

    // Bottom panel: only on the recipe list and the grocery list.
    const tab = !page ? 'list' : page === 'grocery' ? 'grocery' : null;
    tabbar.hidden = !tab;
    document.body.classList.toggle('has-tabbar', Boolean(tab));
    tabbar.querySelectorAll('[data-tab]').forEach((a) => {
      if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });

    try {
      if (!page) await showList();
      else if (page === 'recipe' && id) await showDetail(id, trail);
      else if (page === 'new') await showForm(null);
      else if (page === 'edit' && id) await showForm(id, trail);
      else if (page === 'backup') await showBackup();
      else if (page === 'tags') await showTags();
      else if (page === 'grocery') await showGrocery();
      else showNotFound();
    } catch (err) {
      console.error(err);
      setHeader({ title: 'Cookbook', back: '#/' });
      view.innerHTML = `<div class="empty"><p>Something went wrong loading this screen.</p>
        <p class="muted">${esc(err.message || err)}</p></div>`;
    }
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', route);
  route().then(hideSplash);

  /**
   * Launch logo (#splash in index.html). It's part of the page, so it only
   * shows on a full launch; switching back to an app that's still open
   * doesn't reload the page, so it doesn't appear then. Fade it out once the
   * first screen is ready, but not before it has shown for about a second.
   */
  const SPLASH_MIN_MS = 1000;
  function hideSplash() {
    const splash = document.getElementById('splash');
    if (!splash) return;
    setTimeout(() => {
      splash.classList.add('splash-done');
      // Remove it once faded (or soon after, if transitions are off).
      const remove = () => splash.remove();
      splash.addEventListener('transitionend', remove, { once: true });
      setTimeout(remove, 600);
    }, Math.max(0, SPLASH_MIN_MS - performance.now()));
  }

  /* ------------------------------------------------------------------ */
  /* Offline support                                                     */
  /* ------------------------------------------------------------------ */

  DB.requestPersistence();

  // Service workers need https (GitHub Pages) or localhost.
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    setUpUpdates(navigator.serviceWorker);
  }

  /*
   * Automatic updates. sw.js takes over as soon as a new version installs.
   * When that happens while the app is open, reload onto the new files and
   * then say so. A first install isn't an update, so it's silent.
   *
   * The reload waits while you're on the add/edit form or a dialog is open,
   * so nothing you're typing is lost; it happens on your next screen change.
   */
  function setUpUpdates(sw) {
    const wasControlled = Boolean(sw.controller);
    let updateReady = false;

    const busy = () => /^#\/(new|edit)(\/|$)/.test(location.hash) || Boolean(document.querySelector('dialog[open]'));
    function reloadForUpdate() {
      if (!updateReady || busy()) return;
      updateReady = false;
      prefs.set('justUpdated', '1');
      location.reload();
    }

    sw.addEventListener('controllerchange', () => {
      if (!wasControlled) return; // first install
      updateReady = true;
      reloadForUpdate();
    });
    window.addEventListener('hashchange', reloadForUpdate);

    sw.register('sw.js')
      .then((reg) => {
        // Home Screen apps often resume instead of relaunching; check then too.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch((err) => console.warn('Service worker failed:', err));

    if (prefs.get('justUpdated', '') === '1') {
      prefs.set('justUpdated', '');
      askVersion(sw).then(showUpdated);
    }
  }

  /** The running version from sw.js, e.g. "v8", or "" if it doesn't answer. */
  function askVersion(sw) {
    return sw.ready.then((reg) => new Promise((resolve) => {
      const timer = setTimeout(() => resolve(''), 3000);
      sw.addEventListener('message', function onMessage(e) {
        if (e.data?.type !== 'version') return;
        sw.removeEventListener('message', onMessage);
        clearTimeout(timer);
        resolve(String(e.data.version || ''));
      });
      (sw.controller || reg.active).postMessage({ type: 'get-version' });
    }));
  }

  /** "Cookbook updated" message with the version number. */
  function showUpdated(version) {
    const number = version.replace(/^v/i, '');
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    dialog.id = 'update-notice';
    dialog.setAttribute('aria-labelledby', 'update-notice-title');
    dialog.innerHTML = `
      <form method="dialog">
        <h3 id="update-notice-title">Cookbook updated</h3>
        <p>${number ? `You're now on version ${esc(number)}.` : 'You\'re now on the latest version.'}
           Your recipes weren't changed.</p>
        <button class="btn btn-primary" value="ok">OK</button>
      </form>`;
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
  }
})();
