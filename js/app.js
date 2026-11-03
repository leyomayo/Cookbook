/*
 * app.js — screens, navigation and service worker registration.
 *
 * Navigation uses the URL hash so it works on GitHub Pages without any
 * server config, and the Home Screen app reopens on the last screen:
 *
 *   #/               recipe list (with meal type filter)
 *   #/recipe/<id>    recipe detail
 *   #/new            add recipe form
 *   #/edit/<id>      edit recipe form
 *   #/backup         export and import files
 *
 * Each screen is a function that fills <main id="view"> and sets the header.
 * User text is always passed through esc() before it goes into HTML.
 */

(() => {
  const view = document.getElementById('view');
  const headerLeft = document.getElementById('header-left');
  const headerTitle = document.getElementById('header-title');
  const headerRight = document.getElementById('header-right');

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
   * Fill the header. `back` is a hash to return to (shows a back button);
   * `left` is { label, href } for a plain link on the left instead;
   * `action` is { label, onClick } for the button on the right.
   */
  function setHeader({ title, back, left, action }) {
    headerTitle.textContent = title;
    document.title = title === 'Cookbook' ? 'Cookbook' : `${title} · Cookbook`;

    if (back) {
      headerLeft.innerHTML = `<a class="header-btn" href="${esc(back)}" aria-label="Back"><span aria-hidden="true">‹</span> Back</a>`;
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
  function toast(message) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = message;
    document.body.append(el);
    setTimeout(() => el.remove(), 3000);
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
      action: { label: '+ Add', onClick: () => go('#/new') },
    });

    const recipes = await DB.getAllRecipes();
    recipes.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));

    let filter = prefs.get('mealFilter', 'all');

    // Tag filter: only tags used by at least one recipe, most used first.
    // You can pick several; a recipe must have all of them to show.
    const counts = Tags.usageCounts(recipes);
    const usedTags = Tags.sortByUsage(
      [...new Map(recipes.flatMap((r) => r.tags).map((t) => [t.toLowerCase(), t])).values()], counts);
    let tagFilter;
    try { tagFilter = JSON.parse(prefs.get('tagFilter', '[]')); } catch { tagFilter = []; }
    tagFilter = (Array.isArray(tagFilter) ? tagFilter : []).filter((k) => counts.has(k));

    // Filter chips: "All" plus one per meal type, each with a count.
    const chips = [{ value: 'all', label: 'All' }, ...Model.MEAL_TYPES]
      .map((m) => {
        const count = m.value === 'all' ? recipes.length : recipes.filter((r) => r.mealType === m.value).length;
        return `<button type="button" class="chip" data-filter="${m.value}">
                  ${esc(m.label)} <span class="chip-count">${count}</span>
                </button>`;
      })
      .join('');

    const tagChips = usedTags.map((t) =>
      `<button type="button" class="chip chip-tag" data-tag="${esc(t.toLowerCase())}">${esc(t)}</button>`).join('');

    view.innerHTML = `
      <div id="list-screen">
        <nav class="chips" aria-label="Filter by meal type">${chips}</nav>
        ${usedTags.length ? `<nav class="chips chips-tags" aria-label="Filter by tag">${tagChips}</nav>` : ''}
        <ul class="recipe-grid" id="recipe-grid"></ul>
      </div>
    `;

    const screen = view.querySelector('#list-screen');
    const grid = view.querySelector('#recipe-grid');

    function renderCards() {
      // Highlight the active chips.
      view.querySelectorAll('[data-filter]').forEach((chip) => {
        chip.setAttribute('aria-pressed', String(chip.dataset.filter === filter));
      });
      view.querySelectorAll('[data-tag]').forEach((chip) => {
        chip.setAttribute('aria-pressed', String(tagFilter.includes(chip.dataset.tag)));
      });

      const shown = recipes
        .filter((r) => filter === 'all' || r.mealType === filter)
        .filter((r) => tagFilter.every((k) => r.tags.some((t) => t.toLowerCase() === k)));

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
            ${recipes.length ? '' : '<p><a href="#/backup">Import recipes from a file</a></p>'}
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
      const tag = e.target.closest('[data-tag]');
      if (meal) {
        filter = meal.dataset.filter;
      } else if (tag) {
        const key = tag.dataset.tag;
        tagFilter = tagFilter.includes(key) ? tagFilter.filter((k) => k !== key) : [...tagFilter, key];
      } else if (e.target.closest('[data-clear-tags]')) {
        tagFilter = [];
      } else {
        return;
      }
      prefs.set('mealFilter', filter);
      prefs.set('tagFilter', JSON.stringify(tagFilter));
      renderCards();
    });

    renderCards();
  }

  /* ------------------------------------------------------------------ */
  /* Screen: recipe detail                                               */
  /* ------------------------------------------------------------------ */

  async function showDetail(id) {
    const all = await DB.getAllRecipes();
    const r = all.find((x) => x.id === id);
    if (!r) return showNotFound();

    // Prepare the share file now: Safari only opens the share sheet if it's
    // called straight from the tap, with no waiting in between.
    const shareData = Transfer.share(r.id, all);
    const linked = shareData.recipes.length - 1;

    setHeader({
      title: r.title || 'Recipe',
      back: '#/',
      action: { label: 'Edit', onClick: () => go(`#/edit/${encodeURIComponent(r.id)}`) },
    });

    // Only show the facts that were filled in.
    const facts = [
      ['Prep', Model.formatMinutes(r.prepMinutes)],
      ['Cook', Model.formatMinutes(r.cookMinutes)],
      ['Total', totalTime(r)],
      ['Serves', r.servings ?? ''],
    ].filter(([, v]) => v !== '');

    view.innerHTML = `
      <article class="detail">
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
                  <li data-ingredient-id="${esc(i.id)}">
                    ${i.amount ? `<span class="amount">${esc(i.amount)}</span>` : ''}
                    <span>${esc(i.name)}</span>
                  </li>`).join('')}
              </ul>` : '<p class="muted">No ingredients listed.</p>'}
          </section>

          <section class="panel">
            <h3>Directions</h3>
            ${r.steps.length ? `
              <ol class="step-list">
                ${r.steps.map((s) => `<li data-step-id="${esc(s.id)}">${esc(s.text)}</li>`).join('')}
              </ol>` : '<p class="muted">No directions yet.</p>'}
          </section>
        </div>

        <div class="detail-actions">
          <button type="button" class="btn btn-secondary" id="share-btn">Share recipe</button>
          <button type="button" class="btn btn-danger" id="delete-btn">Delete recipe</button>
          ${linked ? `<p class="muted">Sharing includes ${linked} linked recipe${linked === 1 ? '' : 's'}.</p>` : ''}
        </div>
      </article>
    `;

    view.querySelector('#share-btn').addEventListener('click', () => {
      Transfer.deliver(Transfer.shareFileName(r), shareData, r.title)
        .then((result) => result === 'downloaded' && toast('Recipe file downloaded.'));
    });

    view.querySelector('#delete-btn').addEventListener('click', async () => {
      if (!confirm(`Delete “${r.title || 'Untitled'}”? This can't be undone.`)) return;
      await DB.deleteRecipe(r.id);
      go('#/');
    });
  }

  /* ------------------------------------------------------------------ */
  /* Screen: add / edit form                                             */
  /* ------------------------------------------------------------------ */

  /**
   * The form edits a working copy ("draft") of the recipe. Before any
   * add/remove/move we copy what's typed into the draft (syncFromForm),
   * change the draft, then redraw that list. Ingredient and step objects
   * keep their ids and any extra fields (recipeId, ingredientIds), so the
   * future linking features survive edits made in this version.
   */
  async function showForm(id) {
    const [existing, allRecipes, tagNames] = await Promise.all([
      id ? DB.getRecipe(id) : null, DB.getAllRecipes(), DB.getTagNames(),
    ]);
    if (id && !existing) return showNotFound();

    const draft = existing || Model.newRecipe();
    // Start new recipes with one empty row of each so the form isn't bare.
    if (!draft.ingredients.length) draft.ingredients.push(Model.newIngredient());
    if (!draft.steps.length) draft.steps.push(Model.newStep());

    const backTo = existing ? `#/recipe/${encodeURIComponent(existing.id)}` : '#/';
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
            ${moveButtons('ingredient', i, draft.ingredients.length)}
            <button type="button" class="icon-btn" data-action="remove-ingredient" data-index="${i}"
                    aria-label="Remove ingredient ${i + 1}">✕</button>
          </div>
        </li>`).join('');
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
      draft.ingredients = draft.ingredients.filter((i) => i.name || i.amount);
      const ingredientIds = new Set(draft.ingredients.map((i) => i.id));
      draft.steps = draft.steps
        .filter((s) => s.text)
        .map((s) => ({ ...s, ingredientIds: s.ingredientIds.filter((iid) => ingredientIds.has(iid)) }));

      const saved = await DB.saveRecipe(draft);
      // replace() so Back from the detail screen doesn't return to the form.
      location.replace(`#/recipe/${encodeURIComponent(saved.id)}`);
    }

    renderIngredients();
    renderSteps();
    if (!existing) form.elements.title.focus();
  }

  /* ------------------------------------------------------------------ */
  /* Screen: backup (export and import)                                  */
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
          <h3>Import</h3>
          <p>Add recipes from a Cookbook backup or a shared recipe file. If anything in
             the file is invalid, nothing is imported.</p>
          <label class="btn btn-secondary file-btn">
            Choose file…
            <input type="file" id="import-input" class="visually-hidden"
                   accept=".json,application/json,text/plain">
          </label>
          <div id="import-result" aria-live="polite"></div>
        </section>
      </div>
    `;

    view.querySelector('#export-btn').addEventListener('click', () => {
      Transfer.deliver(Transfer.backupFileName(), backupData, 'Cookbook backup')
        .then((result) => result === 'downloaded' && toast('Backup downloaded.'));
    });

    const input = view.querySelector('#import-input');
    const result = view.querySelector('#import-result');

    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.value = ''; // so choosing the same file again still triggers
      if (!file) return;
      result.innerHTML = '<p class="muted">Checking file…</p>';

      try {
        const parsed = Transfer.parse(await Transfer.readFile(file));
        const plan = await Transfer.plan(parsed.recipes, await DB.getAllRecipes(), askConflict);
        await DB.importRecipes(plan.recipes, parsed.tags);
        result.innerHTML = importReport(plan);
      } catch (err) {
        console.error(err);
        const message = err.name === 'ImportError' ? err.message
          : err.name === 'ImportCancelled' ? 'Import cancelled.'
          : `Something went wrong: ${err.message || err}`;
        result.innerHTML = `
          <div class="notice notice-error" role="alert">
            <p>${esc(message)}</p>
            <p>Nothing was changed.</p>
          </div>`;
      }
    });
  }

  /** What happened, plus any warnings, after a successful import. */
  function importReport({ summary, warnings }) {
    const parts = [
      summary.added && `${summary.added} added`,
      summary.overwritten && `${summary.overwritten} overwritten`,
      summary.keptBoth && `${summary.keptBoth} added as a second copy`,
      summary.ignored && `${summary.ignored} ignored`,
    ].filter(Boolean);
    return `
      <div class="notice notice-ok">
        <p><strong>Import finished:</strong> ${esc(parts.join(', ') || 'nothing to import')}.</p>
        <a class="btn btn-secondary" href="#/">View recipes</a>
      </div>
      ${warnings.length ? `
        <div class="notice notice-warn">
          <p><strong>Renamed:</strong></p>
          <ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
        </div>` : ''}`;
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
    // "#/edit/abc" → ["edit", "abc"]
    const [page, rawId] = location.hash.replace(/^#\/?/, '').split('/');
    const id = rawId ? decodeURIComponent(rawId) : null;

    try {
      if (!page) await showList();
      else if (page === 'recipe' && id) await showDetail(id);
      else if (page === 'new') await showForm(null);
      else if (page === 'edit' && id) await showForm(id);
      else if (page === 'backup') await showBackup();
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
  route();

  /* ------------------------------------------------------------------ */
  /* Offline support                                                     */
  /* ------------------------------------------------------------------ */

  DB.requestPersistence();

  // Service workers need https (GitHub Pages) or localhost.
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker failed:', err));
  }
})();
