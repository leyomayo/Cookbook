/*
 * app.test.js — end-to-end checks in Chromium, emulating iPhone 13 and iPad Pro.
 *
 * Not part of the app (nothing loads it). To run:
 *   1. npm install playwright && npx playwright install chromium   (once)
 *   2. python3 -m http.server 8765        (from the repository root)
 *   3. node tests/app.test.js [screenshot-folder] [iphone|ipad]
 *
 * With no profile it runs the whole suite twice: once as iPhone 13, once as
 * iPad Pro 11 (landscape). Each run uses fresh browser storage. It covers:
 * the v1 → v2 data upgrade, the tag editor, the Tags filter screen, .recipe /
 * .cookbook export and the share-sheet fallbacks, import checks and the
 * "Import complete" counts, importing old .json files, offline loading with
 * the current cache, and recipe links (section G).
 */
const { chromium, devices } = require('playwright');
const fs = require('fs');
const SP = process.argv[2] || require('os').tmpdir(), URL0 = 'http://localhost:8765/';
const PROFILES = { iphone: 'iPhone 13', ipad: 'iPad Pro 11 landscape' };
const only = process.argv[3];
if (only && !PROFILES[only]) { console.error(`Unknown profile "${only}". Use iphone or ipad.`); process.exit(1); }
let fails = 0, passes = 0;
const ok = (cond, msg, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg + (extra !== undefined && !cond ? ' ' + JSON.stringify(extra) : '')); cond ? passes++ : fails++; };
const texts = (page, sel) => page.$$eval(sel, l => l.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
const cardTitles = (page) => page.$$eval('.card-title', l => l.map(x => x.textContent));

(async () => {
  const browser = await chromium.launch();
  for (const [tag, device] of Object.entries(PROFILES)) {
    if (only && only !== tag) continue;
    console.log(`\n===== ${device} =====`);
    await suite(browser, tag, device);
  }
  console.log(fails ? `${fails} FAILED, ${passes} passed` : `ALL ${passes} PASSED`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

async function suite(browser, tag, device) {
  const ctx = await browser.newContext({ ...devices[device], acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // ---------- A. v1 database upgrade (regression) ----------
  await page.goto(URL0 + 'README.md');
  await page.evaluate(() => new Promise((res, rej) => {
    const req = indexedDB.open('cookbook', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('recipes', { keyPath: 'id' });
    req.onsuccess = () => {
      const tx = req.result.transaction('recipes', 'readwrite'), s = tx.objectStore('recipes');
      const base = { schemaVersion: 1, mealType: 'dinner', prepMinutes: null, cookMinutes: null, servings: null, createdAt: 1, updatedAt: 1, steps: [] };
      s.put({ ...base, id: 'r1', title: 'Pancakes', mealType: 'breakfast', tags: ['sweet', 'quick'], ingredients: [{ id: 'i1', amount: '1', name: 'flour', recipeId: null }] });
      s.put({ ...base, id: 'r2', title: 'Odd', tags: 'Spicy, spicy, comfort FOOD, Weeknight', ingredients: [{ id: 'i2', amount: '', name: 'x', recipeId: null }] });
      s.put({ ...base, id: 'r3', title: 'Third', tags: ['Sweet', 'sweet', 'my Thing'], ingredients: [] });
      tx.oncomplete = () => { req.result.close(); res(); };
    };
    req.onerror = () => rej(req.error);
  }));
  await page.goto(URL0); await page.waitForSelector('.card');
  const mig = await page.evaluate(async () => ({ r: await DB.getAllRecipes(), t: await DB.getTagNames() }));
  const m = Object.fromEntries(mig.r.map(r => [r.id, r]));
  ok(JSON.stringify([m.r1.tags, m.r2.tags, m.r3.tags]) === JSON.stringify([['Sweet', 'Quick'], ['Spicy', 'Comfort food', 'Weeknight'], ['Sweet', 'My Thing']]), 'v1 tags converted and merged');
  ok(mig.t.length === 48, 'tag list = 46 starters + 2 found');

  // ---------- B. Tag editor (regression) ----------
  await page.goto(URL0 + '#/new'); await page.waitForSelector('.tag-input');
  await page.fill('input[name=title]', 'Chicken Tacos');
  await page.click('.tag-input');
  ok((await page.$$('[data-add]')).length === 15, 'editor: 15 suggestions on focus');
  await page.fill('.tag-input', 'CHICKEN'); await page.press('.tag-input', 'Enter');
  await page.fill('.tag-input', 'bbq night'); await page.press('.tag-input', 'Enter');
  await page.click('[data-add="Sweet"]');
  await page.fill('.tag-input', 'pending tag');
  await page.click('button[type=submit]'); await page.waitForSelector('.detail');
  const tacoId = decodeURIComponent(page.url().split('/').pop());
  ok(JSON.stringify((await page.evaluate(id => DB.getRecipe(id), tacoId)).tags) === '["Chicken","Bbq night","Sweet","Pending tag"]', 'editor: exact match, new tag, bubble, typed tag kept');
  await page.goto(URL0 + '#/edit/' + tacoId); await page.waitForSelector('.tag-input');
  await page.click('[aria-label="Remove tag Pending tag"]');
  await page.click('button[type=submit]'); await page.waitForSelector('.detail');
  ok((await page.evaluate(() => DB.getTagNames())).includes('Pending tag'), 'unused tag stays in the tag list');

  // ---------- C. Recipe list: meal row only, Tags screen ----------
  await page.goto(URL0 + '#/'); await page.waitForSelector('.card');
  const mealChips = await page.$$eval('[data-filter]', l => l.map(b => b.dataset.filter));
  ok(JSON.stringify(mealChips) === '["all","breakfast","lunch","snack","dinner","other"]', 'main filter row has only the meal types', mealChips);
  ok((await page.$$('#list-screen [data-tag]')).length === 0, 'no tag filter row on the list');
  ok((await page.$$('.card .tag')).length > 0, 'cards still show tags');
  await page.click('.tag-bar-btn');                                  // one tap
  await page.waitForSelector('#tag-search');
  ok(page.url().endsWith('#/tags'), 'Tags screen is one tap away (#/tags)');
  let opts = await page.$$eval('#tag-options [data-tag]', l => l.map(b => b.dataset.tag));
  ok(opts.length === 8 && !opts.includes('vegan') && !opts.includes('pending tag') && opts[0] === 'sweet', 'only tags used by a recipe, most used first', opts);
  await page.fill('#tag-search', 'ICK');
  opts = await page.$$eval('#tag-options [data-tag]', l => l.map(b => b.dataset.tag));
  ok(JSON.stringify(opts.sort()) === '["chicken","quick"]', 'search matches anywhere in the name, ignoring case', opts);
  await page.fill('#tag-search', 'eekn');
  ok(JSON.stringify(await page.$$eval('#tag-options [data-tag]', l => l.map(b => b.dataset.tag))) === '["weeknight"]', 'search in the middle of a name');
  await page.fill('#tag-search', 'zzz');
  ok((await page.textContent('#tag-options')).includes('No tags match'), 'no-match message');
  await page.fill('#tag-search', '');
  await page.click('[data-tag="sweet"]');
  ok((await page.textContent('#show-btn')) === 'Show 3 recipes', 'Sweet → 3 recipes', await page.textContent('#show-btn'));
  await page.fill('#tag-search', 'chi'); await page.click('[data-tag="chicken"]');
  ok((await page.textContent('#show-btn')) === 'Show 1 recipe', 'Sweet AND Chicken → 1 recipe');
  ok((await page.textContent('#tag-status')).includes('2 tags chosen'), 'Tags screen says filter is active');
  await page.fill('#tag-search', '');
  await page.screenshot({ path: SP + `/${tag}-v3-tags-iphone.png` });
  await page.click('#show-btn'); await page.waitForSelector('.card');
  ok(JSON.stringify(await cardTitles(page)) === '["Chicken Tacos"]', 'list applies both tags (AND)');
  ok(await page.$('.tag-bar-active') !== null && (await page.textContent('.tag-bar-count')) === '2', 'list shows an active tag filter with count');
  ok(JSON.stringify(await texts(page, '[data-untag]')) === '["Sweet ✕","Chicken ✕"]', 'active tags shown as removable pills', await texts(page, '[data-untag]'));
  await page.screenshot({ path: SP + `/${tag}-v3-list-active.png` });
  await page.click('[data-untag="chicken"]');
  ok(JSON.stringify(await cardTitles(page)) === '["Chicken Tacos","Pancakes","Third"]', 'removing one pill widens the list');
  await page.click('[data-filter=breakfast]');
  ok(JSON.stringify(await cardTitles(page)) === '["Pancakes"]', 'tag filter combines with meal type');
  await page.click('.tag-bar-btn'); await page.waitForSelector('#tag-search');
  ok((await page.textContent('#tag-status')).includes('Also filtered by meal type: Breakfast') && (await page.textContent('#show-btn')) === 'Show 1 recipe', 'Tags screen counts with the meal type');
  await page.reload(); await page.waitForSelector('#tag-search');
  ok(await page.getAttribute('[data-tag="sweet"]', 'aria-pressed') === 'true', 'choice survives a reload');
  await page.click('[data-clear-tags]');
  ok((await page.textContent('#show-btn')) === 'Show 1 recipe' && (await page.$$('[aria-pressed="true"]')).length === 0, 'Clear on Tags screen');
  await page.click('[data-tag="spicy"]');
  await page.click('.header-btn');                    // Back keeps the choice
  await page.waitForSelector('#recipe-grid .empty');
  ok((await page.textContent('#recipe-grid')).includes('No recipes match these filters'), 'Spicy + Breakfast: empty message with clear option');
  await page.click('[data-filter=all]');
  ok(JSON.stringify(await cardTitles(page)) === '["Odd"]', 'Back keeps choice');
  await page.click('.tag-bar-clear');
  ok((await cardTitles(page)).length === 4 && await page.$('.tag-bar-active') === null, 'Clear on the list removes the tag filter');

  // ---------- D. Files out: .recipe / .cookbook, share sheet + fallbacks ----------
  await page.evaluate(async (tacoId) => {
    const t = await DB.getRecipe(tacoId); t.ingredients = [Model.newIngredient({ name: 'pancake', recipeId: 'r1' })]; await DB.saveRecipe(t);
    const a = await DB.getRecipe('r1'); a.ingredients[0].recipeId = 'r2'; await DB.saveRecipe(a);
    const b = await DB.getRecipe('r2'); b.ingredients[0].recipeId = tacoId; await DB.saveRecipe(b);
  }, tacoId);
  const openDetail = async () => { await page.goto(URL0 + '#/recipe/' + tacoId); await page.reload(); await page.waitForSelector('#share-btn'); };

  await openDetail();
  await page.evaluate(() => {
    navigator.canShare = () => true;
    navigator.share = async (d) => { window.__shared = { name: d.files[0].name, type: d.files[0].type, text: await d.files[0].text(), count: d.files.length }; };
  });
  await page.click('#share-btn');                     // file was prepared before the tap
  await page.waitForFunction(() => window.__shared);
  const shared = await page.evaluate(() => window.__shared);
  const sd = JSON.parse(shared.text);
  ok(shared.name === 'chicken-tacos.recipe' && shared.type === 'application/json' && shared.count === 1, 'share sheet gets chicken-tacos.recipe (JSON inside)', shared);
  ok(sd.format === 'cookbook-recipes' && sd.formatVersion === 1 && sd.kind === 'share', 'format and formatVersion 1 unchanged');
  ok(JSON.stringify(sd.recipes.map(r => r.id)) === JSON.stringify([tacoId, 'r1', 'r2']), 'linked recipes included, loop safe');
  ok(!(await page.$('.toast')), 'no fallback message when share works');

  // Share sheet exists but refuses the file type → download + message
  await openDetail();
  await page.evaluate(() => { navigator.canShare = () => false; navigator.share = async () => { throw new Error('should not be called'); }; });
  let [dl] = await Promise.all([page.waitForEvent('download'), page.click('#share-btn')]);
  ok(dl.suggestedFilename() === 'chicken-tacos.recipe', 'refused by canShare → downloads .recipe', dl.suggestedFilename());
  await page.waitForSelector('.toast');
  ok((await page.textContent('.toast')).includes("share sheet wouldn't take this file"), 'tells you it downloaded instead', await page.textContent('.toast'));

  // Share sheet errors (e.g. NotAllowedError) → download + message
  await openDetail();
  await page.evaluate(() => { navigator.canShare = () => true; navigator.share = async () => { const e = new Error('no'); e.name = 'NotAllowedError'; throw e; }; });
  [dl] = await Promise.all([page.waitForEvent('download'), page.click('#share-btn')]);
  await page.waitForSelector('.toast');
  ok(dl.suggestedFilename() === 'chicken-tacos.recipe' && (await page.textContent('.toast')).includes("wouldn't take"), 'share error → download + message');

  // User closes the share sheet → nothing
  await openDetail();
  await page.evaluate(() => { navigator.canShare = () => true; navigator.share = async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; }; });
  let downloaded = false; page.once('download', () => { downloaded = true; });
  await page.click('#share-btn'); await page.waitForTimeout(500);
  ok(!downloaded && !(await page.$('.toast')), 'closing the share sheet does nothing');

  // Backup: share sheet name, then plain download (no share API)
  await page.goto(URL0 + '#/backup'); await page.reload(); await page.waitForSelector('#export-btn');
  await page.evaluate(() => { navigator.canShare = () => true; navigator.share = async (d) => { window.__shared = { name: d.files[0].name }; }; });
  await page.click('#export-btn'); await page.waitForFunction(() => window.__shared);
  ok(/^cookbook-backup-\d{4}-\d\d-\d\d\.cookbook$/.test((await page.evaluate(() => window.__shared)).name), 'share sheet gets cookbook-backup-<date>.cookbook');
  await page.reload(); await page.waitForSelector('#export-btn');
  [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-btn')]);
  const backup = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  ok(/\.cookbook$/.test(dl.suggestedFilename()) && (await page.textContent('.toast')) === 'Backup downloaded.', 'no share API → downloads .cookbook', dl.suggestedFilename());
  ok(backup.formatVersion === 1 && backup.kind === 'backup' && backup.recipes.length === 4 && backup.tags.includes('Pending tag'), 'backup contents unchanged (JSON, v1, full tag list)');

  // ---------- E. Import: picker, message, counts ----------
  ok(await page.getAttribute('#import-input', 'accept') === null, 'file picker has no type limit (iOS won\'t grey out .recipe/.cookbook)');
  const snapshot = () => page.evaluate(async () => JSON.stringify([await DB.getAllRecipes(), await DB.getTagNames()]));
  const importFile = (name, text) => page.setInputFiles('#import-input', { name, mimeType: '', buffer: Buffer.from(text) });
  const clear = () => page.evaluate(() => document.querySelector('#import-result').innerHTML = '');
  const counts = () => page.$$eval('#import-complete [data-count]', l => Object.fromEntries(l.map(d => [d.dataset.count, Number(d.querySelector('dd').textContent)])));
  const before = await snapshot();

  const bad = [
    ['broken.recipe', 'not json', "isn't valid JSON"],
    ['other.cookbook', JSON.stringify({ hello: 1 }), "isn't a Cookbook file"],
    ['old.json', JSON.stringify({ format: 'cookbook-recipes', formatVersion: 2, recipes: [] }), 'newer version'],
    ['dupe.cookbook', JSON.stringify({ ...backup, recipes: [backup.recipes[0], backup.recipes[0]] }), 'appears twice'],
    ['notitle.recipe', JSON.stringify({ ...backup, recipes: [{ ...backup.recipes[0], title: '' }] }), 'has no title'],
  ];
  for (const [name, text, expect] of bad) {
    await clear(); await importFile(name, text); await page.waitForSelector('#import-result .notice');
    const msg = await page.textContent('#import-result');
    ok(msg.includes(expect) && msg.includes('Nothing was changed') && !(await page.$('#import-complete')), `invalid ${name}: error shown, no "Import complete"`, msg.trim().slice(0, 80));
  }
  ok(await snapshot() === before, 'invalid files changed nothing');

  await clear(); await importFile('b.cookbook', JSON.stringify(backup));
  await page.waitForSelector('dialog[open]'); await page.keyboard.press('Escape');
  await page.waitForSelector('#import-result .notice');
  ok((await page.textContent('#import-result')).includes('Import cancelled') && !(await page.$('#import-complete')), 'cancel (Escape): no "Import complete"');
  await clear(); await importFile('b.cookbook', JSON.stringify(backup));
  await page.waitForSelector('dialog[open]'); await page.click('dialog button[value=cancel]');
  await page.waitForSelector('#import-result .notice');
  ok((await page.textContent('#import-result')).includes('Import cancelled') && !(await page.$('#import-complete')) && await snapshot() === before, 'Cancel import button: no message, nothing changed');

  // Apply-to-all ignore
  await clear(); await importFile('b.cookbook', JSON.stringify(backup));
  await page.waitForSelector('dialog[open]'); await page.check('dialog [name=all]'); await page.click('dialog button[value=ignore]');
  await page.waitForSelector('#import-complete[open]');
  ok(JSON.stringify(await counts()) === JSON.stringify({ 'Added': 0, 'Overwritten': 0, 'Ignored': 4, 'Renamed with “-new”': 0 }), '.cookbook, all ignored: counts', await counts());
  await page.click('#import-complete button[value=ok]');
  await page.waitForFunction(() => !document.querySelector('#import-complete'));
  ok(true, 'OK closes the message');

  // Mixed .recipe file
  const r = Object.fromEntries(backup.recipes.map(x => [x.id, x]));
  const mixed = { format: 'cookbook-recipes', formatVersion: 1, kind: 'share', recipes: [
    { ...r.r1, title: 'Pancakes v2' },
    { ...r.r2, title: 'Odd overwritten', tags: ['spicy', 'Brand new tag'] },
    { ...r.r3, title: 'Third from file' },
    { id: 'w1', title: 'pancakes', mealType: 'snack', tags: ['sweet'], ingredients: [{ id: 'wi1', amount: '1', name: 'pancakes', recipeId: 'r1' }], steps: [] },
    { id: 'w2', title: 'odd overwritten', tags: [], ingredients: [], steps: [] },
  ] };
  await clear(); await importFile('mixed.recipe', JSON.stringify(mixed));
  for (const choice of ['keep', 'overwrite', 'ignore']) {
    const d = await page.waitForSelector('dialog[open]');
    await page.click(`dialog button[value=${choice}]`); await d.waitForElementState('hidden');
  }
  await page.waitForSelector('#import-complete[open]');
  ok(JSON.stringify(await counts()) === JSON.stringify({ 'Added': 3, 'Overwritten': 1, 'Ignored': 1, 'Renamed with “-new”': 2 }), '.recipe mixed: added/overwritten/ignored/renamed counts', await counts());
  const dlgText = (await page.textContent('#import-complete')).replace(/\s+/g, ' ');
  ok(dlgText.includes('Import complete') && dlgText.includes('including 1 kept as a second copy') && dlgText.includes('“pancakes” was imported as “pancakes-new”'), 'message explains copies and lists renames');
  await page.screenshot({ path: SP + `/${tag}-v3-import-complete.png` });
  await page.click('#import-complete button[value=ok]');
  const after = await page.evaluate(() => DB.getAllRecipes());
  const A = Object.fromEntries(after.map(x => [x.id, x]));
  const copy = after.find(x => x.title === 'Pancakes v2');
  ok(after.length === 7 && A.w1.title === 'pancakes-new' && A.w2.title === 'odd overwritten-new' && A.w1.ingredients[0].recipeId === copy.id, 'saved data matches the message (renames, link remap)');

  // Old .json export, and content decides validity regardless of name
  const fresh = await browser.newContext({ ...devices['iPad Pro 11 landscape'] });
  const fp = await fresh.newPage(); fp.on('pageerror', e => errors.push(e.message));
  await fp.goto(URL0 + '#/backup'); await fp.waitForSelector('#import-input');
  const oldJson = { ...backup }; // same contents v2 wrote as cookbook-backup-<date>.json
  await fp.setInputFiles('#import-input', { name: 'cookbook-backup-2026-11-03.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(oldJson)) });
  await fp.waitForSelector('#import-complete[open]');
  const fc = await fp.$$eval('#import-complete [data-count]', l => Object.fromEntries(l.map(d => [d.dataset.count, Number(d.querySelector('dd').textContent)])));
  ok(fc.Added === 4 && (await fp.evaluate(() => DB.getTagNames())).includes('Pending tag'), 'old .json backup imports on a fresh iPad', fc);
  await fp.click('#import-complete button[value=ok]');
  await fp.setInputFiles('#import-input', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from(JSON.stringify({ ...mixed, recipes: [{ id: 'n1', title: 'From a txt', ingredients: [], steps: [] }] })) });
  await fp.waitForSelector('#import-complete[open]');
  ok((await fp.evaluate(() => DB.getRecipe('n1'))).title === 'From a txt', 'valid contents import whatever the file name');
  await fp.click('#import-complete button[value=ok]');
  await fp.goto(URL0 + '#/tags'); await fp.waitForSelector('#tag-search');
  await fp.click('[data-tag="sweet"]');
  await fp.screenshot({ path: SP + `/${tag}-v3-tags-ipad.png` });
  await fp.click('#show-btn'); await fp.waitForSelector('.card');
  await fp.screenshot({ path: SP + `/${tag}-v3-list-ipad.png` });

  await fresh.close();

  // ---------- F. Offline with cache v4 ----------
  await page.goto(URL0); await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.waitForSelector('.card');
  const keys = await page.evaluate(() => caches.keys());
  ok(JSON.stringify(keys) === '["cookbook-v4"]', 'only cache cookbook-v4', keys);
  await ctx.setOffline(true);
  for (const h of ['#/', '#/tags', '#/backup', '#/new']) {
    await page.goto(URL0 + h); await page.reload();
    await page.waitForSelector({ '#/': '.card', '#/tags': '#tag-search', '#/backup': '#export-btn', '#/new': '.tag-input' }[h]);
  }
  ok(true, 'offline: list, tags, backup and form screens load');
  await ctx.setOffline(false);

  await ctx.close();

  // ---------- G. Recipe links ----------
  await linkTests(browser, tag, device, errors);

  ok(errors.length === 0, `${tag}: no page errors`, errors);
}


/*
 * G. Recipe links: an ingredient can link to a recipe in the Other category.
 * Runs in its own fresh context so it starts from an empty cookbook.
 */
async function linkTests(browser, tag, device, errors) {
  const ctx = await browser.newContext({ ...devices[device], acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  const T = (msg) => `links (${tag}): ${msg}`;
  const get = (id) => page.evaluate(id => DB.getRecipe(id), id);
  const hashNow = () => decodeURIComponent(new URL(page.url()).hash);
  const pickerTitles = () => page.$$eval('#recipe-picker [data-pick] span:first-child', l => l.map(x => x.textContent));
  const openForm = async (id) => { await page.goto(URL0 + (id ? '#/edit/' + id : '#/new')); await page.reload(); await page.waitForSelector('#ingredient-rows .edit-row'); };
  const openDetail = async (hash) => { await page.goto(URL0 + hash); await page.reload(); await page.waitForSelector('.detail'); };
  const linkBtn = (n) => page.click(`[data-action="link-ingredient"][data-index="${n}"]`);
  const pick = async (title) => { await page.click(`#recipe-picker [data-pick]:has-text("${title}")`); await page.waitForSelector('#recipe-picker', { state: 'detached' }); };
  const save = async () => { await page.click('button[type=submit]'); await page.waitForSelector('.detail'); };
  // Tap Back and wait until the screen it leads to has rendered.
  const back = async () => {
    const before = await page.textContent('#header-title');
    await page.click('#header-left .header-btn');
    await page.waitForFunction((t) => document.querySelector('#header-title').textContent !== t, before);
    await page.waitForSelector('.detail, .card');
  };
  const tapHeight = (sel) => page.$eval(sel, el => el.getBoundingClientRect().height);

  await page.goto(URL0); await page.waitForSelector('#recipe-grid');

  // No Other recipes yet: the picker says so.
  await openForm(null);
  await linkBtn(0); await page.waitForSelector('#recipe-picker[open]');
  ok((await page.textContent('#picker-list')).includes('No recipes in the Other category yet'), T('picker with no Other recipes says so'));
  await page.click('#recipe-picker button[value=cancel]');
  await page.waitForSelector('#recipe-picker', { state: 'detached' });
  ok(!(await page.$('.link-info')), T('cancelling the picker leaves the row unlinked'));

  // Setup: three Other recipes, two dinners.
  await page.evaluate(async () => {
    const mk = (id, title, mealType, names) => ({ ...Model.newRecipe(), id, title, mealType, ingredients: names.map(n => Model.newIngredient({ name: n })) });
    await DB.saveRecipe(mk('rS', 'Tomato Sauce', 'other', ['tomatoes']));
    await DB.saveRecipe(mk('rB', 'Chicken Broth', 'other', ['bones']));
    await DB.saveRecipe(mk('rZ', 'Zesty Dressing', 'other', ['lemon']));
    await DB.saveRecipe({ ...mk('rP', 'Pizza', 'dinner', []), ingredients: [Model.newIngredient({ amount: '1 cup', name: 'sauce' })] });
    await DB.saveRecipe(mk('rD', 'Dal', 'dinner', ['lentils']));
  });

  // ---- Set a link; Other-only picker, A to Z, search ----
  await openForm('rP');
  await linkBtn(0); await page.waitForSelector('#recipe-picker[open]');
  ok(JSON.stringify(await pickerTitles()) === '["Chicken Broth","Tomato Sauce","Zesty Dressing"]', T('picker lists only Other recipes, A to Z, not the recipe being edited'), await pickerTitles());
  ok(await tapHeight('#recipe-picker [data-pick]') >= 44, T('picker rows are 44px tap targets'));
  await page.fill('#picker-search', 'SAU');
  ok(JSON.stringify(await pickerTitles()) === '["Tomato Sauce"]', T('picker search matches anywhere, ignoring case'));
  await page.press('#picker-search', 'Enter');
  ok(await page.$('#recipe-picker[open]') !== null, T('Return in the search box keeps the picker open'));
  await page.fill('#picker-search', 'zzz');
  ok((await page.textContent('#picker-list')).includes('No Other recipes match'), T('picker no-match message'));
  await page.fill('#picker-search', '');
  await page.screenshot({ path: SP + `/${tag}-links-picker.png` });
  await pick('Tomato Sauce');
  ok(await page.inputValue('.edit-row >> nth=0 >> .ing-name') === 'sauce', T('picking keeps a name that was already typed'));
  ok((await page.textContent('.edit-row >> nth=0 >> .link-info')).includes('Links to Tomato Sauce'), T('linked row shows which recipe it links to'));

  // Blank name → filled with the recipe title
  await page.click('[data-action="add-ingredient"]');
  await page.fill('.edit-row >> nth=1 >> .ing-amount', '2 cups');
  await linkBtn(1); await page.waitForSelector('#recipe-picker[open]');
  await pick('Chicken Broth');
  ok(await page.inputValue('.edit-row >> nth=1 >> .ing-name') === 'Chicken Broth' && await page.inputValue('.edit-row >> nth=1 >> .ing-amount') === '2 cups', T('picking fills a blank name with the recipe title, keeps the amount'));
  await page.click('[data-action="add-ingredient"]');
  await page.fill('.edit-row >> nth=2 >> .ing-name', 'salt');
  // Move the broth row down: its link moves with it.
  await page.click('[data-action="move-ingredient"][data-index="1"][data-dir="1"]');
  const rowsNow = await texts(page, '#ingredient-rows .edit-row .link-info-text');
  const names = await page.$$eval('.ing-name', l => l.map(x => x.value));
  ok(JSON.stringify(names) === '["sauce","salt","Chicken Broth"]' && rowsNow.length === 2 && rowsNow[1].includes('Chicken Broth') &&
     !(await page.$('.edit-row >> nth=1 >> .link-info')), T('link moves with its row'), { names, rowsNow });
  for (const sel of ['.link-btn', '.link-remove']) ok(await tapHeight(sel) >= 44, T(`${sel} is a 44px tap target`));
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), T('form with linked rows has no sideways scroll'));
  await page.screenshot({ path: SP + `/${tag}-links-form.png`, fullPage: true });
  await save();
  let P = await get('rP');
  ok(JSON.stringify(P.ingredients.map(i => [i.name, i.recipeId])) === '[["sauce","rS"],["salt",null],["Chicken Broth","rB"]]', T('links survive moving and saving'), P.ingredients);

  // ---- Remove a link: typed name stays ----
  await openForm('rP');
  await page.click('[data-action="unlink-ingredient"][data-index="2"]');
  ok(await page.inputValue('.edit-row >> nth=2 >> .ing-name') === 'Chicken Broth' && (await page.$$('.link-info')).length === 1, T('Remove link keeps the typed name'));
  await save();
  P = await get('rP');
  ok(P.ingredients[2].name === 'Chicken Broth' && P.ingredients[2].recipeId === null && P.ingredients[0].recipeId === 'rS', T('removed link saved as plain text'));

  // ---- Self-link blocked; loops between Other recipes allowed ----
  await openForm('rS');
  await linkBtn(0); await page.waitForSelector('#recipe-picker[open]');
  ok(JSON.stringify(await pickerTitles()) === '["Chicken Broth","Zesty Dressing"]', T('a recipe can\'t link to itself'), await pickerTitles());
  await page.click('#recipe-picker button[value=cancel]');
  await page.click('[data-action="add-ingredient"]');
  await page.fill('.edit-row >> nth=1 >> .ing-name', 'dressing');
  await linkBtn(1); await pick('Zesty Dressing'); await save();
  await openForm('rZ');
  await linkBtn(0); await pick('Tomato Sauce'); await save();
  ok((await get('rS')).ingredients[1].recipeId === 'rZ' && (await get('rZ')).ingredients[0].recipeId === 'rS', T('loop S → Z → S allowed'));

  // ---- Detail: open a link and go back ----
  await openDetail('#/recipe/rP');
  const links = await texts(page, '.ing-link span:first-child');
  ok(JSON.stringify(links) === '["sauce"]', T('only the linked ingredient is a link'), links);
  ok(await tapHeight('.ing-link') >= 44, T('ingredient link is a 44px tap target'));
  const lc = await page.$eval('.ing-link', el => [getComputedStyle(el).textDecorationLine, getComputedStyle(el).color]);
  ok(lc[0].includes('underline'), T('ingredient link is underlined'), lc);
  await page.screenshot({ path: SP + `/${tag}-links-detail.png` });
  await page.click('.ing-link'); await page.waitForSelector('.detail-title:has-text("Tomato Sauce")');
  ok(hashNow() === '#/recipe/rS?from=rP', T('link opens #/recipe/<id>'), hashNow());
  await page.click('.ing-link:has-text("dressing")'); await page.waitForSelector('.detail-title:has-text("Zesty Dressing")');
  ok(hashNow() === '#/recipe/rZ?from=rS&from=rP', T('links chain'), hashNow());
  await page.reload(); await page.waitForSelector('.detail-title:has-text("Zesty Dressing")');
  ok(await page.getAttribute('#header-left .header-btn', 'aria-label') === 'Back to Tomato Sauce', T('after a reload Back still names the recipe you came from'));
  await back();
  ok(hashNow() === '#/recipe/rS?from=rP' && (await page.textContent('.detail-title')) === 'Tomato Sauce', T('Back returns to the recipe you came from'), hashNow());
  // Edit and save keeps the way back
  await page.click('#header-right button'); await page.waitForSelector('#ingredient-rows');
  await save();
  ok(hashNow() === '#/recipe/rS?from=rP', T('editing a linked recipe keeps the way back'), hashNow());
  await back();
  ok(hashNow() === '#/recipe/rP' && (await page.textContent('.detail-title')) === 'Pizza', T('Back again returns to the first recipe'), hashNow());
  await back();
  ok(hashNow() === '#/' && (await page.$('.card')) !== null, T('Back from the first recipe goes to the list'));

  // ---- Rename: link keeps working, ingredient keeps its own name ----
  await openForm('rS');
  await page.fill('input[name=title]', 'Marinara'); await save();
  await openDetail('#/recipe/rP');
  ok(JSON.stringify(await texts(page, '.ing-link span:first-child')) === '["sauce"]', T('after rename the ingredient keeps its typed name'));
  await page.click('.ing-link'); await page.waitForSelector('.detail-title:has-text("Marinara")');
  ok((await page.textContent('.detail-title')) === 'Marinara' && hashNow() === '#/recipe/rS?from=rP', T('after rename the link opens the renamed recipe'));
  await openForm('rP');
  ok((await page.textContent('.edit-row >> nth=0 >> .link-info')).includes('Links to Marinara'), T('form shows the new title'));

  // ---- Meal type change: link keeps working, recipe leaves the picker ----
  await page.evaluate(async () => { const z = await DB.getRecipe('rZ'); z.mealType = 'dinner'; await DB.saveRecipe(z); });
  await openForm('rP');
  await linkBtn(1); await page.waitForSelector('#recipe-picker[open]');
  ok(JSON.stringify(await pickerTitles()) === '["Chicken Broth","Marinara"]', T('recipe moved out of Other leaves the picker'), await pickerTitles());
  await page.click('#recipe-picker button[value=cancel]');
  await openDetail('#/recipe/rS');
  ok((await texts(page, '.ing-link span:first-child')).some(t => t.startsWith('dressing')), T('existing link to it keeps working'));

  // ---- Link to a recipe that isn't on this device ----
  await page.evaluate(async () => { const d = await DB.getRecipe('rD'); d.ingredients[0].recipeId = 'r_elsewhere'; await DB.saveRecipe(d); });
  await openDetail('#/recipe/rD');
  ok((await page.$$('.ing-link')).length === 0 && (await page.textContent('.ingredient-list')).includes('lentils') && !(await page.$('.notice')), T('missing link shows plain text, no error'));
  ok((await get('rD')).ingredients[0].recipeId === 'r_elsewhere', T('viewing keeps the missing link'));
  await openForm('rD');
  ok((await page.textContent('.link-info')).includes('isn’t on this device'), T('form says the linked recipe isn\'t on this device'));
  await save();
  ok((await get('rD')).ingredients[0].recipeId === 'r_elsewhere', T('saving keeps the missing link'));

  // ---- Share and import with links ----
  await openDetail('#/recipe/rP');
  ok((await page.textContent('.detail-actions')).includes('Sharing includes 2 linked recipes'), T('share counts linked recipes'));
  await page.evaluate(() => { navigator.canShare = () => true; navigator.share = async (d) => { window.__shared = await d.files[0].text(); }; });
  await page.click('#share-btn'); await page.waitForFunction(() => window.__shared);
  const shareFile = JSON.parse(await page.evaluate(() => window.__shared));
  ok(JSON.stringify(shareFile.recipes.map(r => r.id)) === '["rP","rS","rZ"]', T('share file has the recipe and everything it links to'));
  const dalFile = { ...shareFile, recipes: [await get('rD')] };

  const other = await browser.newContext({ ...devices[device] });
  const op = await other.newPage(); op.on('pageerror', e => errors.push(e.message));
  await op.goto(URL0 + '#/backup'); await op.waitForSelector('#import-input');
  const imp = async (name, data, choice) => {
    await op.goto(URL0 + '#/backup'); await op.waitForSelector('#import-input');
    await op.setInputFiles('#import-input', { name, mimeType: '', buffer: Buffer.from(JSON.stringify(data)) });
    if (choice) { await op.waitForSelector('dialog[open] [name=all]'); await op.check('dialog [name=all]'); await op.click(`dialog button[value=${choice}]`); }
    await op.waitForSelector('#import-complete[open]'); await op.click('#import-complete button[value=ok]');
    await op.waitForSelector('#import-complete', { state: 'detached' });
  };
  await imp('pizza.recipe', shareFile);
  await op.goto(URL0 + '#/recipe/rP'); await op.waitForSelector('.ing-link');
  await op.click('.ing-link'); await op.waitForSelector('.detail-title:has-text("Marinara")');
  ok(decodeURIComponent(new URL(op.url()).hash) === '#/recipe/rS?from=rP', T('imported links open on the other device'));
  await imp('pizza.recipe', shareFile, 'keep');
  const all2 = await op.evaluate(() => DB.getAllRecipes());
  const copyP = all2.find(r => r.title === 'Pizza-new'), copyS = all2.find(r => r.title === 'Marinara-new'), copyZ = all2.find(r => r.title === 'Zesty Dressing-new');
  ok(copyP && copyS && copyZ && copyP.ingredients[0].recipeId === copyS.id && copyS.ingredients[1].recipeId === copyZ.id && copyZ.ingredients[0].recipeId === copyS.id,
     T('Keep both: copies link to each other\'s new ids'), all2.map(r => [r.title, r.ingredients.map(i => i.recipeId)]));
  ok((await op.evaluate(() => DB.getRecipe('rP'))).ingredients[0].recipeId === 'rS', T('Keep both: originals still link to originals'));
  await imp('dal.recipe', dalFile);
  ok((await op.evaluate(() => DB.getRecipe('rD'))).ingredients[0].recipeId === 'r_elsewhere', T('import keeps a link to a recipe not in the file'));
  await other.close();

  // ---- Delete: unlink in the same step, confirmation says how many ----
  await openDetail('#/recipe/rB');
  let msg = '';
  page.once('dialog', d => { msg = d.message(); d.dismiss(); });
  await page.click('#delete-btn'); await page.waitForTimeout(200);
  ok(msg.startsWith('Delete “Chicken Broth”?') && !msg.includes('link'), T('delete of an unlinked recipe: no link count'), msg);
  ok(await get('rB') !== null, T('dismissing the confirmation deletes nothing'));
  await openDetail('#/recipe/rS?from=rP');
  page.once('dialog', d => { msg = d.message(); d.accept(); });
  await page.click('#delete-btn');
  await page.waitForSelector('.detail-title:has-text("Pizza")');
  ok(msg.includes('2 recipes link to it') && msg.includes('Those ingredients stay, as plain text'), T('delete confirmation counts linking recipes'), msg);
  ok(hashNow() === '#/recipe/rP', T('after delete you go back where you came from'), hashNow());
  const left = await page.evaluate(() => DB.getAllRecipes());
  const L = Object.fromEntries(left.map(r => [r.id, r]));
  ok(!L.rS && L.rP.ingredients[0].recipeId === null && L.rP.ingredients[0].name === 'sauce' && L.rZ.ingredients[0].recipeId === null && L.rZ.ingredients[0].name === 'lemon',
     T('delete unlinks every ingredient that pointed at it, names kept'));
  ok(L.rD.ingredients[0].recipeId === 'r_elsewhere', T('delete leaves other links alone'));
  ok((await page.$$('.ing-link')).length === 0, T('unlinked ingredient shows as plain text'));
  // Same transaction: if the unlink can't be saved, the recipe isn't deleted either.
  const atomic = await page.evaluate(async () => {
    await DB.saveRecipe({ ...Model.newRecipe(), id: 'rX', title: 'X', mealType: 'other' });
    await DB.saveRecipe({ ...Model.newRecipe(), id: 'rY', title: 'Y', ingredients: [Model.newIngredient({ name: 'x', recipeId: 'rX' })] });
    const orig = IDBCursor.prototype.update;
    IDBCursor.prototype.update = function () { throw new Error('test: update refused'); };
    let failed = false;
    try { await DB.deleteRecipe('rX'); } catch { failed = true; }
    IDBCursor.prototype.update = orig;
    return { failed, x: !!(await DB.getRecipe('rX')), y: (await DB.getRecipe('rY')).ingredients[0].recipeId };
  });
  // The refused update surfaces as an uncaught error in the cursor callback; that's expected here.
  for (let n = errors.length - 1; n >= 0; n--) if (errors[n].includes('test: update refused')) errors.splice(n, 1);
  ok(atomic.failed && atomic.x && atomic.y === 'rX', T('delete and unlink happen in one transaction (all or nothing)'), atomic);
  await page.evaluate(() => DB.deleteRecipe('rX').then(() => DB.deleteRecipe('rY')));

  // ---- Dark mode ----
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(async () => { const p = await DB.getRecipe('rP'); p.ingredients[2].recipeId = 'rB'; await DB.saveRecipe(p); });
  await openDetail('#/recipe/rP');
  const dark = await page.$eval('.ing-link', el => getComputedStyle(el).color);
  ok(dark === 'rgb(224, 122, 75)', T('dark mode: link uses the dark accent color'), dark);
  await page.screenshot({ path: SP + `/${tag}-links-detail-dark.png` });
  await openForm('rP');
  await page.screenshot({ path: SP + `/${tag}-links-form-dark.png`, fullPage: true });
  await linkBtn(0); await page.waitForSelector('#recipe-picker[open]');
  await page.screenshot({ path: SP + `/${tag}-links-picker-dark.png` });
  await ctx.close();
}
