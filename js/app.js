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
   * `action` is { label, onClick } for the button on the right.
   */
  function setHeader({ title, back, action }) {
    headerTitle.textContent = title;
    document.title = title === 'Cookbook' ? 'Cookbook' : `${title} · Cookbook`;

    headerLeft.innerHTML = back
      ? `<a class="header-btn" href="${esc(back)}" aria-label="Back"><span aria-hidden="true">‹</span> Back</a>`
      : '';

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

  /** "Prep 10 min · Cook 20 min" style summary for cards. */
  function totalTime(r) {
    if (r.prepMinutes === null && r.cookMinutes === null) return '';
    return Model.formatMinutes((r.prepMinutes || 0) + (r.cookMinutes || 0));
  }

  /* ------------------------------------------------------------------ */
  /* Screen: recipe list                                                 */
  /* ------------------------------------------------------------------ */

  async function showList() {
    setHeader({ title: 'Cookbook', action: { label: '+ Add', onClick: () => go('#/new') } });

    const recipes = await DB.getAllRecipes();
    recipes.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));

    let filter = prefs.get('mealFilter', 'all');

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
      <nav class="chips" aria-label="Filter by meal type">${chips}</nav>
      <ul class="recipe-grid" id="recipe-grid"></ul>
    `;

    const grid = view.querySelector('#recipe-grid');

    function renderCards() {
      // Highlight the active chip.
      view.querySelectorAll('.chip').forEach((chip) => {
        chip.setAttribute('aria-pressed', String(chip.dataset.filter === filter));
      });

      const shown = filter === 'all' ? recipes : recipes.filter((r) => r.mealType === filter);

      if (!shown.length) {
        grid.innerHTML = `
          <li class="empty">
            ${recipes.length
              ? `<p>No ${esc(Model.mealLabel(filter).toLowerCase())} recipes yet.</p>`
              : '<p>Your cookbook is empty.</p>'}
            <a class="btn btn-primary" href="#/new">Add a recipe</a>
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
              ${r.tags.length ? `<span class="tags">${r.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</span>` : ''}
            </a>
          </li>`;
      }).join('');
    }

    view.querySelector('.chips').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      filter = chip.dataset.filter;
      prefs.set('mealFilter', filter);
      renderCards();
    });

    renderCards();
  }

  /* ------------------------------------------------------------------ */
  /* Screen: recipe detail                                               */
  /* ------------------------------------------------------------------ */

  async function showDetail(id) {
    const r = await DB.getRecipe(id);
    if (!r) return showNotFound();

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
          ${r.tags.length ? `<div class="tags">${r.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
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
          <button type="button" class="btn btn-danger" id="delete-btn">Delete recipe</button>
        </div>
      </article>
    `;

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
    const existing = id ? await DB.getRecipe(id) : null;
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

          <label class="field">
            <span class="field-label">Tags <span class="muted">(comma separated)</span></span>
            <input name="tags" type="text" autocomplete="off" autocapitalize="none"
                   value="${esc(draft.tags.join(', '))}" placeholder="quick, vegetarian">
          </label>
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
      draft.tags = Model.parseTags(data.get('tags'));

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
