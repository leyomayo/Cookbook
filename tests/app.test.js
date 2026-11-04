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
 * the current cache, recipe links (section G) and step ingredient
 * highlighting and step checking (section H), the update notice and the
 * launch reveal (section I).
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

/** On the recipe list, tap + Add and wait for the choice. */
async function openAddChoice(pg) {
  if (!/#\/$/.test(pg.url())) { await pg.goto(URL0 + '#/'); }
  await pg.waitForSelector('#recipe-grid');
  await pg.click('#header-right button');
  await pg.waitForSelector('#add-choice[open]');
}
/** + Add → Add from file, choosing a file with this name and text. */
async function addFromFile(pg, name, text, mimeType = '') {
  await openAddChoice(pg);
  await pg.setInputFiles('#add-file-input', { name, mimeType, buffer: Buffer.from(text) });
}
/** Close "Import complete" and wait for the refreshed list. */
async function addFromFileDone(pg) {
  await pg.click('#import-complete button[value=ok]');
  await pg.waitForSelector('#import-complete', { state: 'detached' });
  await pg.waitForSelector('.card');
}

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

  // ---------- E. Import: + Add → Add from file, Backup → restore ----------
  ok(await page.getAttribute('#import-input', 'accept') === null, 'restore picker has no type limit (iOS won\'t grey out .cookbook)');
  ok((await page.textContent('#view')).includes('Restore from a backup') && (await page.textContent('#view')).includes('Add from file'), 'Backup screen: export + restore, points to + Add for shared recipes');
  const snapshot = () => page.evaluate(async () => JSON.stringify([await DB.getAllRecipes(), await DB.getTagNames()]));
  const importFile = (name, text) => page.setInputFiles('#import-input', { name, mimeType: '', buffer: Buffer.from(text) });
  const clear = () => page.evaluate(() => document.querySelector('#import-result').innerHTML = '');
  const counts = () => page.$$eval('#import-complete [data-count]', l => Object.fromEntries(l.map(d => [d.dataset.count, Number(d.querySelector('dd').textContent)])));
  const before = await snapshot();

  // The + Add choice
  await openAddChoice(page);
  ok(JSON.stringify(await texts(page, '#add-choice .btn')) === '["Add manually","Add from file"]', '+ Add offers Add manually and Add from file');
  ok(await page.getAttribute('#add-file-input', 'accept') === null, 'Add from file has no type limit (iOS won\'t grey out .recipe/.cookbook)');
  const heights = await page.$$eval('#add-choice .btn, #add-choice .btn-link', l => l.map(b => b.getBoundingClientRect().height));
  ok(heights.length === 3 && heights.every(h => h >= 44), '+ Add choices are 44px tap targets', heights);
  await page.screenshot({ path: SP + `/${tag}-add-choice.png` });
  await page.click('#add-choice button[value=cancel]');
  await page.waitForSelector('#add-choice', { state: 'detached' });
  ok(page.url().endsWith('#/'), 'Cancel closes the choice and stays on the list');
  await openAddChoice(page);
  await page.click('#add-choice button[value=manual]');
  await page.waitForSelector('.tag-input');
  ok(page.url().endsWith('#/new') && !(await page.$('#add-choice')), 'Add manually opens the new recipe form');

  const bad = [
    ['broken.recipe', 'not json', "isn't valid JSON"],
    ['other.cookbook', JSON.stringify({ hello: 1 }), "isn't a Cookbook file"],
    ['old.json', JSON.stringify({ format: 'cookbook-recipes', formatVersion: 2, recipes: [] }), 'newer version'],
    ['dupe.cookbook', JSON.stringify({ ...backup, recipes: [backup.recipes[0], backup.recipes[0]] }), 'appears twice'],
    ['notitle.recipe', JSON.stringify({ ...backup, recipes: [{ ...backup.recipes[0], title: '' }] }), 'has no title'],
  ];
  for (const [name, text, expect] of bad) {
    await addFromFile(page, name, text);
    await page.waitForSelector('#import-error[open]');
    const msg = await page.textContent('#import-error');
    ok(msg.includes(expect) && msg.includes('Nothing was changed') && !(await page.$('#import-complete')), `Add from file, invalid ${name}: error shown, no "Import complete"`, msg.trim().slice(0, 80));
    await page.click('#import-error button[value=ok]');
    await page.waitForSelector('#import-error', { state: 'detached' });
  }
  ok(await snapshot() === before, 'invalid files changed nothing');

  // Backup screen: invalid files and shared recipes are refused there
  await page.goto(URL0 + '#/backup'); await page.waitForSelector('#import-input');
  await importFile('broken.cookbook', 'not json'); await page.waitForSelector('#import-result .notice');
  ok((await page.textContent('#import-result')).includes("isn't valid JSON"), 'restore: invalid file shows an error');
  await clear(); await importFile('shared.recipe', JSON.stringify({ ...backup, kind: 'share' }));
  await page.waitForSelector('#import-result .notice');
  ok((await page.textContent('#import-result')).includes('not a backup') && !(await page.$('dialog[open]')) && await snapshot() === before, 'restore: a .recipe file is pointed to + Add, nothing changed');

  await clear(); await importFile('b.cookbook', JSON.stringify(backup));
  await page.waitForSelector('dialog[open]'); await page.keyboard.press('Escape');
  await page.waitForSelector('#import-result .notice');
  ok((await page.textContent('#import-result')).includes('Import cancelled') && !(await page.$('#import-complete')), 'restore cancel (Escape): no "Import complete"');
  await clear(); await importFile('b.cookbook', JSON.stringify(backup));
  await page.waitForSelector('dialog[open]'); await page.click('dialog button[value=cancel]');
  await page.waitForSelector('#import-result .notice');
  ok((await page.textContent('#import-result')).includes('Import cancelled') && !(await page.$('#import-complete')) && await snapshot() === before, 'restore Cancel import button: no message, nothing changed');

  // Apply-to-all ignore (restore)
  await clear(); await importFile('b.cookbook', JSON.stringify(backup));
  await page.waitForSelector('dialog[open]'); await page.check('dialog [name=all]'); await page.click('dialog button[value=ignore]');
  await page.waitForSelector('#import-complete[open]');
  ok(JSON.stringify(await counts()) === JSON.stringify({ 'Added': 0, 'Overwritten': 0, 'Ignored': 4, 'Renamed with “-new”': 0 }), '.cookbook restore, all ignored: counts', await counts());
  await page.click('#import-complete button[value=ok]');
  await page.waitForFunction(() => !document.querySelector('#import-complete'));
  ok(true, 'OK closes the message');

  // Add from file: cancel at the conflict question
  await addFromFile(page, 'b.cookbook', JSON.stringify(backup));
  await page.waitForSelector('dialog[open] button[value=cancel]'); await page.click('dialog button[value=cancel]');
  await page.waitForSelector('.toast:has-text("Import cancelled. Nothing was changed.")');
  ok(!(await page.$('#import-complete')) && await snapshot() === before, 'Add from file, cancelled: says so, nothing changed');

  // Mixed .recipe file through + Add
  const r = Object.fromEntries(backup.recipes.map(x => [x.id, x]));
  const mixed = { format: 'cookbook-recipes', formatVersion: 1, kind: 'share', recipes: [
    { ...r.r1, title: 'Pancakes v2' },
    { ...r.r2, title: 'Odd overwritten', tags: ['spicy', 'Brand new tag'] },
    { ...r.r3, title: 'Third from file' },
    { id: 'w1', title: 'pancakes', mealType: 'snack', tags: ['sweet'], ingredients: [{ id: 'wi1', amount: '1', name: 'pancakes', recipeId: 'r1' }], steps: [] },
    { id: 'w2', title: 'odd overwritten', tags: [], ingredients: [], steps: [] },
  ] };
  await addFromFile(page, 'mixed.recipe', JSON.stringify(mixed));
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
  await page.waitForSelector('.card-title:has-text("pancakes-new")');
  ok(page.url().endsWith('#/'), 'after Add from file the list shows the new recipes');
  const after = await page.evaluate(() => DB.getAllRecipes());
  const A = Object.fromEntries(after.map(x => [x.id, x]));
  const copy = after.find(x => x.title === 'Pancakes v2');
  ok(after.length === 7 && A.w1.title === 'pancakes-new' && A.w2.title === 'odd overwritten-new' && A.w1.ingredients[0].recipeId === copy.id, 'saved data matches the message (renames, link remap)');

  // Old .json backup restores; + Add takes any valid file whatever its name
  const fresh = await browser.newContext({ ...devices['iPad Pro 11 landscape'] });
  const fp = await fresh.newPage(); fp.on('pageerror', e => errors.push(e.message));
  await fp.goto(URL0 + '#/backup'); await fp.waitForSelector('#import-input');
  const oldJson = { ...backup }; // same contents v2 wrote as cookbook-backup-<date>.json
  await fp.setInputFiles('#import-input', { name: 'cookbook-backup-2026-11-03.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(oldJson)) });
  await fp.waitForSelector('#import-complete[open]');
  const fc = await fp.$$eval('#import-complete [data-count]', l => Object.fromEntries(l.map(d => [d.dataset.count, Number(d.querySelector('dd').textContent)])));
  ok(fc.Added === 4 && (await fp.evaluate(() => DB.getTagNames())).includes('Pending tag'), 'old .json backup restores on a fresh iPad', fc);
  await fp.click('#import-complete button[value=ok]');
  await addFromFile(fp, 'notes.txt', JSON.stringify({ ...mixed, recipes: [{ id: 'n1', title: 'From a txt', ingredients: [], steps: [] }] }), 'text/plain');
  await fp.waitForSelector('#import-complete[open]');
  ok((await fp.evaluate(() => DB.getRecipe('n1'))).title === 'From a txt', 'valid contents import whatever the file name');
  await addFromFileDone(fp);
  await fresh.close();
  const fresh2 = await browser.newContext({ ...devices[device] });
  const fp2 = await fresh2.newPage(); fp2.on('pageerror', e => errors.push(e.message));
  await addFromFile(fp2, 'cookbook-backup-2026-11-03.json', JSON.stringify(oldJson), 'application/json');
  await fp2.waitForSelector('#import-complete[open]');
  ok((await fp2.evaluate(() => DB.getAllRecipes())).length === 4, 'Add from file also takes a .cookbook / older .json backup');
  await addFromFileDone(fp2);
  await fresh2.close();
  await fp.close().catch(() => {});
  await page.goto(URL0 + '#/tags'); await page.waitForSelector('#tag-search');
  await page.click('[data-tag="sweet"]');
  await page.screenshot({ path: SP + `/${tag}-v3-tags-2.png` });
  await page.click('#show-btn'); await page.waitForSelector('.card');
  await page.screenshot({ path: SP + `/${tag}-v3-list-2.png` });


  // ---------- F. Offline with cache v8 ----------
  await page.goto(URL0); await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.waitForSelector('.card');
  const keys = await page.evaluate(() => caches.keys());
  ok(JSON.stringify(keys) === '["cookbook-v8"]', 'only cache cookbook-v8', keys);
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

  // ---------- H. Step ingredients ----------
  await stepTests(browser, tag, device, errors);

  // ---------- I. Update notice and launch ----------
  await updateTests(browser, tag, device, errors);

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
  ok(await page.inputValue('.edit-row >> nth=2 >> .ing-name') === 'Chicken Broth' && (await page.$$('.link-info')).length === 1, T('Unlink keeps the typed name'));
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
  const links = await texts(page, '.ing-link');
  ok(JSON.stringify(links) === '["sauce"]', T('only the linked ingredient is a link'), links);
  ok(await tapHeight('.ing-link') >= 44, T('ingredient link is a 44px tap target'));
  const linkRow = await page.$eval('li.is-linked', li => ({ links: li.querySelectorAll('a').length, kids: li.querySelector('.ing-link').children.length, text: li.textContent }));
  ok(linkRow.links === 1 && linkRow.kids === 0 && !linkRow.text.includes('›'), T('linked ingredient: the name is the only link, no arrow'), linkRow);
  const lc = await page.$eval('.ing-link', el => [getComputedStyle(el).textDecorationLine, getComputedStyle(el).color]);
  ok(lc[0].includes('underline'), T('ingredient link is underlined'), lc);
  await page.screenshot({ path: SP + `/${tag}-links-detail.png` });
  await page.click('.ing-link'); await page.waitForSelector('.detail-title:has-text("Tomato Sauce")');
  ok(hashNow() === '#/recipe/rS?from=rP', T('link opens #/recipe/<id>'), hashNow());
  await page.click('.ing-link:has-text("dressing")'); await page.waitForSelector('.detail-title:has-text("Zesty Dressing")');
  ok(hashNow() === '#/recipe/rZ?from=rS&from=rP', T('links chain'), hashNow());
  // The browser's own back (swipe back on iOS) works too: links are normal hash changes.
  await page.goBack(); await page.waitForSelector('.detail-title:has-text("Tomato Sauce")');
  ok(hashNow() === '#/recipe/rS?from=rP', T('browser back returns to the parent recipe'), hashNow());
  await page.goForward(); await page.waitForSelector('.detail-title:has-text("Zesty Dressing")');
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
  ok(JSON.stringify(await texts(page, '.ing-link')) === '["sauce"]', T('after rename the ingredient keeps its typed name'));
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
  ok((await texts(page, '.ing-link')).some(t => t.startsWith('dressing')), T('existing link to it keeps working'));

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
  await op.goto(URL0); await op.waitForSelector('#recipe-grid');
  const imp = async (name, data, choice) => {
    await addFromFile(op, name, JSON.stringify(data));
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
  ok(msg.includes('These 2 recipes link to it:\n• Pizza\n• Zesty Dressing\n') && msg.includes('Their linked ingredients will become plain text.'),
     T('delete confirmation lists the linking recipes, A to Z'), msg);
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
  // One linking recipe: singular wording, and the name is listed.
  await openDetail('#/recipe/rX');
  page.once('dialog', d => { msg = d.message(); d.dismiss(); });
  await page.click('#delete-btn'); await page.waitForTimeout(200);
  ok(msg.includes('This recipe links to it:\n• Y\n') && msg.includes('Their linked ingredient will become plain text.'), T('delete confirmation, one linking recipe'), msg);
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


/*
 * H. Step ingredients: tap a direction step to see the ingredients it uses.
 * iPad highlights them in the list; iPhone shows them in a bar at the bottom.
 * Uses realistic recipes saved in the existing shape (no step.ingredientIds).
 */
async function stepTests(browser, tag, device, errors) {
  const ctx = await browser.newContext({ ...devices[device] });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  const T = (msg) => `steps (${tag}): ${msg}`;
  const wide = tag === 'ipad';
  await page.goto(URL0); await page.waitForSelector('#recipe-grid');

  // ---- The matching function on its own ----
  const m = await page.evaluate(() => {
    const ing = [
      { id: 'a', amount: '1/2 cup', name: 'butter' }, { id: 'b', amount: '1 tsp', name: 'salt' },
      { id: 'c', amount: '2', name: 'onions' }, { id: 'd', amount: '1 lb', name: 'Tomatoes' },
      { id: 'e', amount: '1 cup', name: 'blueberries' }, { id: 'f', amount: '', name: 'fresh basil' },
      { id: 'g', amount: '3', name: 'cloves' }, { id: 'h', amount: '1 tbsp', name: 'baking powder' },
    ];
    const ids = (text) => Match.byKeyword(text, ing).map(i => i.id).join('');
    return {
      example: ids('Combine butter with salt'),
      plural: ids('Chop the onion.'), case: ids('Add the TOMATO.'), berry: ids('Fold in a blueberry'),
      filler: ids('Add fresh water'), fillerOnly: ids('Stud the ham with cloves'),
      amounts: ids('Add 1/2 cup and 1 tsp of water'), salted: ids('Boil in salted water'),
      baking: ids('Pour into a baking dish'), powder: ids('Sift in the baking powder'),
      reuse: Match.byKeyword('Tomato basil soup', ['Tomato', 'Basil', 'Beef'], x => x),
    };
  });
  ok(m.example === 'ab', T('"Combine butter with salt" matches butter and salt'), m.example);
  ok(m.plural === 'c' && m.case === 'd' && m.berry === 'e', T('plurals and case are ignored'), m);
  ok(m.filler === '' && m.fillerOnly === 'g', T('filler words (fresh, units) don\'t match on their own'), m);
  ok(m.amounts === '', T('amounts and units in the step match nothing'), m.amounts);
  ok(m.salted === '' && m.baking === '' && m.powder === 'h', T('"salted" ≠ salt; "baking dish" ≠ baking powder'), m);
  ok(JSON.stringify(m.reuse) === '["Tomato","Basil"]', T('works on plain names too (for reuse)'), m.reuse);

  // ---- Real recipes, stored in the existing shape ----
  await page.evaluate(async () => {
    const ing = (id, amount, name, recipeId = null) => ({ id, amount, name, recipeId });
    const step = (id, text) => ({ id, text, ingredientIds: [] });
    const base = { ...Model.newRecipe(), mealType: 'dinner' };
    await DB.saveRecipe({ ...base, id: 'rPesto', title: 'Basil Pesto', mealType: 'other',
      ingredients: [ing('p1', '2 cups', 'fresh basil'), ing('p2', '1/3 cup', 'pine nuts')], steps: [step('ps1', 'Blend the basil and pine nuts.')] });
    await DB.saveRecipe({ ...base, id: 'rPasta', title: 'Garlic Butter Pasta', ingredients: [
      ing('a1', '8 oz', 'spaghetti'), ing('a2', '1/2 cup', 'butter'), ing('a3', '4 cloves', 'garlic, minced'),
      ing('a4', '1 tsp', 'salt'), ing('a5', '1/4 cup', 'fresh parsley'), ing('a6', '1/2 cup', 'grated parmesan cheese'),
      ing('a7', '3 tbsp', '', 'rPesto'),
    ], steps: [
      step('s1', 'Boil the spaghetti in salted water until al dente.'),
      step('s2', 'Combine butter with salt in a pan and melt.'),
      step('s3', 'Add the garlic and cook for 1 minute.'),
      step('s4', 'Toss the pasta with the pesto, then sprinkle with parsley and cheese.'),
      step('s5', 'Serve right away.'),
    ] });
    await DB.saveRecipe({ ...base, id: 'rSoup', title: 'Tomato Soup', mealType: 'lunch', ingredients: [
      ing('t1', '2 lb', 'ripe tomatoes'), ing('t2', '1', 'yellow onion'), ing('t3', '2 cups', 'vegetable broth'),
      ing('t4', '1 tbsp', 'olive oil'), ing('t5', '2', 'carrots'), ing('t6', '1 tsp', 'smoked paprika'),
    ], steps: [
      step('u1', 'Chop the onions and the carrot.'),
      step('u2', 'Put the tomatoes, broth, oil, onion, carrots and paprika in a pot and simmer for 20 minutes.'),
      step('u3', 'Blend until smooth.'),
    ] });
  });
  const before = await page.evaluate(() => DB.getAllRecipes());
  const open = async (id) => { await page.goto(URL0 + '#/recipe/' + id); await page.reload(); await page.waitForSelector('.step-btn'); };
  const tapStep = (n) => page.click(`.step-list li:nth-child(${n}) .step-btn`);
  const state = () => page.evaluate(() => {
    const bar = document.querySelector('#step-bar');
    const r = bar.getBoundingClientRect();
    return {
      selected: [...document.querySelectorAll('.step-list li')].map((li, n) => li.classList.contains('is-selected') ? n + 1 : 0).filter(Boolean),
      pressed: [...document.querySelectorAll('.step-btn[aria-pressed=true]')].length,
      listMatches: [...document.querySelectorAll('.ingredient-list li.is-match')].map(li => li.dataset.ingredientId),
      barShown: getComputedStyle(bar).display !== 'none',
      barChips: [...bar.querySelectorAll('.step-chip')].map(c => c.textContent.replace(/\s+/g, ' ').trim()),
      barAtBottom: Math.round(r.bottom) === innerHeight && getComputedStyle(bar).position === 'fixed',
      numberColor: (() => { const li = document.querySelector('.step-list li.is-selected'); return li && getComputedStyle(li.querySelector('.step-num-mark')).backgroundColor; })(),
      plainColor: getComputedStyle(document.querySelector('.step-list li:not(.is-selected) .step-num-mark')).backgroundColor,
    };
  });

  await open('rPasta');
  let s = await state();
  ok(!s.selected.length && !s.barShown && !s.listMatches.length, T('nothing selected at first, no bar'), s);

  await tapStep(2); s = await state();
  ok(s.selected.join() === '2' && s.pressed === 1, T('tapping a step selects it'), s);
  ok(s.listMatches.join() === 'a2,a4', T('step 2 finds butter and salt'), s.listMatches);
  ok(s.plainColor === 'rgb(180, 83, 42)' && s.numberColor === 'rgb(240, 179, 147)', T('selected step number turns a lighter orange'), s);
  if (wide) {
    ok(!s.barShown, T('iPad: no bottom bar'), s);
    const bg = await page.$eval('.ingredient-list li.is-match', li => getComputedStyle(li).backgroundColor);
    const plain = await page.$eval('.ingredient-list li:not(.is-match)', li => getComputedStyle(li).backgroundColor);
    ok(bg !== plain && bg === 'rgb(251, 227, 212)', T('iPad: matched ingredients are highlighted'), { bg, plain });
  } else {
    ok(s.barShown && s.barAtBottom, T('iPhone: bar fixed to the bottom of the screen'), s);
    ok(JSON.stringify(s.barChips) === '["1/2 cup butter","1 tsp salt"]', T('iPhone: bar lists each ingredient with its amount'), s.barChips);
  }
  await page.screenshot({ path: SP + `/${tag}-steps-selected.png` });

  await tapStep(2); s = await state();
  ok(!s.selected.length && !s.barShown && !s.listMatches.length, T('tapping it again clears the selection'), s);
  await tapStep(1); await tapStep(3); s = await state();
  ok(s.selected.join() === '3' && s.pressed === 1 && s.listMatches.join() === 'a3', T('tapping another step moves the selection'), s);
  ok(!wide ? JSON.stringify(s.barChips) === '["4 cloves garlic, minced"]' : true, T('step 3 shows the garlic'), s.barChips);
  await tapStep(1); s = await state();
  ok(s.listMatches.join() === 'a1', T('"salted water" doesn\'t match salt'), s.listMatches);
  await tapStep(5); s = await state();
  ok(s.selected.join() === '5' && !s.barShown && !s.listMatches.length, T('step with no matches: selected, bar hidden'), s);

  // Linked homemade ingredient (pesto, name blank → recipe title) stays a link.
  await tapStep(4); s = await state();
  ok(s.listMatches.join() === 'a5,a6,a7', T('step 4 finds parsley, cheese and the linked pesto'), s.listMatches);
  const linkSel = wide ? '.ingredient-list li.is-match .ing-link' : '#step-bar .ing-link';
  ok((await page.$$(linkSel)).length === 1, T('linked ingredient is still a link when highlighted'));
  await page.click(linkSel); await page.waitForSelector('.detail-title:has-text("Basil Pesto")');
  ok(/#\/recipe\/rPesto\?from=rPasta/.test(page.url()), T('tapping it opens the linked recipe'), page.url());
  ok((await page.$$('#step-bar:not([hidden])')).length === 0, T('selection doesn\'t carry over to the linked recipe'));
  await page.click('#header-left a'); await page.waitForSelector('.detail-title:has-text("Garlic Butter Pasta")');

  // Second recipe: plurals both ways, long step scrolls sideways on iPhone.
  await open('rSoup');
  await tapStep(1); s = await state();
  ok(s.listMatches.join() === 't2,t5', T('"onions"/"carrot" match "onion"/"carrots"'), s.listMatches);
  await tapStep(2); s = await state();
  ok(s.listMatches.join() === 't1,t2,t3,t4,t5,t6', T('long step finds all six ingredients, in list order'), s.listMatches);
  if (!wide) {
    const scroll = await page.$eval('.step-bar-list', el => ({ sw: el.scrollWidth, cw: el.clientWidth, ox: getComputedStyle(el).overflowX }));
    ok(scroll.sw > scroll.cw && scroll.ox === 'auto', T('iPhone: bar scrolls sideways when the chips don\'t fit'), scroll);
    await page.$eval('.step-bar-list', el => { el.scrollLeft = 9999; });
    ok(await page.$eval('.step-bar-list', el => el.scrollLeft > 0), T('iPhone: bar can be scrolled'));
    const pageScroll = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    ok(pageScroll, T('iPhone: page itself doesn\'t scroll sideways'));
    // Bar doesn't cover the last buttons when scrolled to the bottom.
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    const cover = await page.evaluate(() => document.querySelector('#delete-btn').getBoundingClientRect().bottom <= document.querySelector('#step-bar').getBoundingClientRect().top);
    ok(cover, T('iPhone: bar doesn\'t cover Delete at the bottom of the page'));
  }
  await page.screenshot({ path: SP + `/${tag}-steps-soup.png` });

  // Keyboard: steps are buttons, so Enter selects.
  await page.focus('.step-list li:nth-child(1) .step-btn'); await page.keyboard.press('Enter'); s = await state();
  ok(s.selected.join() === '1', T('a step can be selected with the keyboard'), s);

  // ---- Whole step is one tap target, number included ----
  await open('rPasta');
  await page.$eval('.step-list li:nth-child(4)', li => li.scrollIntoView({ block: 'center' }));
  const geo = await page.evaluate(() => {
    const li = document.querySelector('.step-list li:nth-child(4)'), r = li.getBoundingClientRect();
    const num = li.querySelector('.step-num-btn').getBoundingClientRect(), txt = li.querySelector('.step-btn').getBoundingClientRect();
    // Sample points across the step, including the gap by the number and below it.
    const pts = [[r.left + 4, r.top + 4], [r.left + 15, r.top + 14], [r.left + 38, r.top + 10], [r.left + 15, r.bottom - 4], [r.left + 40, r.bottom - 4], [r.right - 4, r.bottom - 4], [r.left + 100, r.top + 10]];
    const hits = pts.map(([x, y]) => { const el = document.elementFromPoint(x, y); return el && el.closest('li') === li && !!el.closest('.step-num-btn, .step-btn'); });
    const next = document.querySelector('.step-list li:nth-child(5)').getBoundingClientRect();
    return { hits, numW: num.width, numH: Math.round(num.height), liH: Math.round(r.height), gap: Math.round(next.top - r.bottom), txtBottom: Math.round(txt.bottom), liBottom: Math.round(r.bottom) };
  });
  ok(geo.hits.every(Boolean), T('every point of a step is a tap target (number column, gap, below the number, end of the text)'), geo);
  ok(geo.numW >= 44 && geo.numH === geo.liH && geo.gap === 0 && geo.txtBottom === geo.liBottom, T('number column is 44px wide and full height; no dead space between steps'), geo);
  const tapNum = (n) => page.click(`.step-list li:nth-child(${n}) .step-num-btn`);
  const marks = () => page.$$eval('.step-num-mark', l => l.map(x => x.textContent).join(''));
  const checkedSteps = () => page.$$eval('.step-list li', l => l.map((li, n) => li.classList.contains('is-checked') ? n + 1 : 0).filter(Boolean).join());
  await tapNum(2); s = await state();
  ok(s.selected.join() === '2' && s.listMatches.join() === 'a2,a4', T('tapping the number of an unselected step selects it'), s);

  // ---- Check off and uncheck ----
  ok(await page.getAttribute('.step-list li:nth-child(2) .step-num-btn', 'aria-label') === 'Step 2. Tap to check off', T('selected number says it checks off'));
  await tapNum(2); s = await state();
  ok(await checkedSteps() === '2' && s.selected.join() === '3', T('tapping the selected step\'s number checks it and selects the next step'), { c: await checkedSteps(), s });
  ok(await marks() === '1✓345' && await page.getAttribute('.step-list li:nth-child(2) .step-num-btn', 'aria-label') === 'Step 2, done. Tap to uncheck', T('checked step shows a tick'), await marks());
  ok(s.listMatches.join() === 'a3', T('next step\'s ingredients are shown'), s.listMatches);
  await page.click('.step-list li:nth-child(3) .step-btn'); s = await state();
  ok(!s.selected.length && await checkedSteps() === '2', T('tapping the selected step\'s text clears the highlight only'), s);
  await page.click('.step-list li:nth-child(1) .step-btn'); await tapNum(1); s = await state();
  ok(await checkedSteps() === '1,2' && s.selected.join() === '3', T('next step skips steps already checked'), { c: await checkedSteps(), s });
  await tapNum(2); s = await state();
  ok(await checkedSteps() === '1' && s.selected.join() === '3', T('tapping a checked step\'s number unchecks it, selection stays'), { c: await checkedSteps(), s });
  await page.click('.step-list li:nth-child(5) .step-btn'); await tapNum(5); s = await state();
  ok(await checkedSteps() === '1,5' && !s.selected.length, T('checking the last step clears the highlight'), { c: await checkedSteps(), s });
  await page.click('.step-list li:nth-child(1) .step-btn'); s = await state();
  ok(s.selected.join() === '1' && await checkedSteps() === '1,5', T('tapping a checked step\'s text selects it and keeps the check'), s);
  await page.click('.step-list li:nth-child(1) .step-btn');
  const doneColor = await page.$eval('.step-list li:nth-child(1) .step-btn', el => getComputedStyle(el).color);
  const plainText = await page.$eval('.step-list li:nth-child(2) .step-btn', el => getComputedStyle(el).color);
  ok(doneColor !== plainText, T('checked step text is dimmed'), { doneColor, plainText });
  await page.screenshot({ path: SP + `/${tag}-steps-checked.png` });

  // ---- Checks persist through a linked recipe; cleared by the recipe list ----
  await tapNum(4); // select step 4 (has the pesto link)
  const link = wide ? '.ingredient-list .ing-link' : '#step-bar .ing-link';
  await page.click(link); await page.waitForSelector('.detail-title:has-text("Basil Pesto")');
  await page.click('.step-list li:nth-child(1) .step-num-btn'); await page.click('.step-list li:nth-child(1) .step-num-btn');
  ok(await checkedSteps() === '1', T('linked recipe has its own checks'));
  await page.click('#header-left a'); await page.waitForSelector('.detail-title:has-text("Garlic Butter Pasta")');
  ok(await checkedSteps() === '1,5' && await marks() === '✓234✓', T('checks are still there after opening a linked recipe and coming back'), await marks());
  await page.click('.ingredient-list .ing-link'); await page.waitForSelector('.detail-title:has-text("Basil Pesto")');
  ok(await checkedSteps() === '1', T('linked recipe keeps its checks too'));
  await page.click('#header-left a'); await page.waitForSelector('.detail-title:has-text("Garlic Butter Pasta")');
  await page.click('#header-left a'); await page.waitForSelector('#recipe-grid .card');
  await page.click('.card:has-text("Garlic Butter Pasta")'); await page.waitForSelector('.step-num-btn');
  ok(await checkedSteps() === '' && await marks() === '12345', T('returning to the recipe list clears the checks'), await marks());
  // Checks aren't saved anywhere.
  ok(JSON.stringify(await page.evaluate(() => DB.getAllRecipes())) === JSON.stringify(before), T('checking steps doesn\'t change stored recipes'));

  // Dark mode: selected number is still lighter than the others.
  await page.click('.step-list li:nth-child(2) .step-btn');
  await page.emulateMedia({ colorScheme: 'dark' }); s = await state();
  ok(s.plainColor === 'rgb(224, 122, 75)' && s.numberColor === 'rgb(246, 195, 168)', T('dark mode: selected number is lighter'), s);
  await page.screenshot({ path: SP + `/${tag}-steps-dark.png` });

  // Viewing and selecting never changes stored recipes.
  const after = await page.evaluate(() => DB.getAllRecipes());
  ok(JSON.stringify(after) === JSON.stringify(before), T('recipes are unchanged in storage'));
  await ctx.close();
}


/*
 * I. Automatic update with an "updated" message, and the launch reveal.
 * A new version is simulated with a small server of our own (port 8766) that
 * serves sw.js with a different CACHE_VERSION. (Playwright can't intercept
 * the service worker script itself.)
 */
async function updateTests(browser, tag, device, errors) {
  const path = require('path'), root = path.join(__dirname, '..');
  const real = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  let swVersion = null; // null = serve sw.js as it is
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  const server = require('http').createServer((req, res) => {
    let file = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (file.endsWith('/')) file += 'index.html';
    const full = path.join(root, file);
    if (!full.startsWith(root) || !fs.existsSync(full)) { res.writeHead(404); return res.end(); }
    let body = fs.readFileSync(full);
    if (file === '/sw.js' && swVersion) body = real.replace(/CACHE_VERSION = 'v\d+'/, `CACHE_VERSION = '${swVersion}'`);
    res.writeHead(200, { 'Content-Type': types[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  });
  await new Promise(r => server.listen(8766, r));
  const URL1 = 'http://localhost:8766/';
  const ctx = await browser.newContext({ ...devices[device] });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  const T = (msg) => `update (${tag}): ${msg}`;

  // Launch: page hidden until the first screen is drawn, then shown.
  await page.goto(URL1);
  await page.waitForSelector('#recipe-grid');
  await page.waitForFunction(() => !document.documentElement.classList.contains('booting'));
  const shown = await page.evaluate(() => [getComputedStyle(document.querySelector('.view')).opacity, getComputedStyle(document.querySelector('.app-header')).opacity, visualViewport.scale]);
  ok(shown[0] === '1' && shown[1] === '1' && shown[2] === 1, T('page is revealed after the first screen, at normal zoom'), shown);
  // Fallback: even if the app's script never runs, CSS reveals the page.
  const noJs = await browser.newContext({ ...devices[device], javaScriptEnabled: false });
  const nj = await noJs.newPage(); await nj.goto(URL1);
  const hiddenAtStart = await nj.evaluate(() => getComputedStyle(document.querySelector('.view')).opacity);
  await nj.waitForTimeout(1800);
  const later = await nj.evaluate(() => getComputedStyle(document.querySelector('.view')).opacity);
  ok(hiddenAtStart === '0' && later === '1', T('without the script, the page still appears after 1.5 s'), { hiddenAtStart, later });
  await noJs.close();

  // First install: no message.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.reload(); await page.waitForSelector('#recipe-grid'); await page.waitForTimeout(300);
  ok((await page.$$('#update-notice')).length === 0, T('no message on first install or a normal launch'));

  // A new version: served with a different CACHE_VERSION.
  swVersion = 'v99';

  // While on the form, the reload waits so typing isn't lost.
  await page.goto(URL1 + '#/new'); await page.waitForSelector('input[name=title]');
  await page.fill('input[name=title]', 'Half typed');
  await page.evaluate(() => { window.__still = true; });
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
  await page.waitForFunction(() => caches.keys().then(k => k.join() === 'cookbook-v99'), null, { timeout: 10000 });
  await page.waitForTimeout(800);
  const stayed = await page.evaluate(() => [window.__still === true, document.querySelector('input[name=title]')?.value]);
  ok(stayed[0] && stayed[1] === 'Half typed', T('update waits while the form is open (nothing typed is lost)'), stayed);

  // Leaving the form: reload onto the new version, then the message.
  const nav = page.waitForNavigation();
  await page.click('#header-left a');
  await nav;
  await page.waitForSelector('#update-notice[open]', { timeout: 10000 });
  const msg = await page.textContent('#update-notice');
  ok(/Cookbook updated/.test(msg) && /version 99\./.test(msg), T('after updating, a message shows the new version number'), msg.replace(/\s+/g, ' '));
  const keys = await page.evaluate(() => caches.keys());
  ok(JSON.stringify(keys) === '["cookbook-v99"]', T('new version\'s files are in use (old cache removed)'), keys);
  await page.screenshot({ path: SP + `/${tag}-update-notice.png` });
  await page.click('#update-notice button[value=ok]');
  await page.waitForSelector('#update-notice', { state: 'detached' });
  await page.reload(); await page.waitForSelector('#recipe-grid'); await page.waitForTimeout(500);
  ok((await page.$$('#update-notice')).length === 0, T('message shows only once'));

  // Update while on the list: reloads straight away.
  swVersion = 'v100';
  const nav2 = page.waitForNavigation({ timeout: 10000 });
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
  await nav2;
  await page.waitForSelector('#update-notice[open]', { timeout: 10000 });
  ok(/version 100\./.test(await page.textContent('#update-notice')), T('on other screens the update applies straight away'));
  await ctx.close();
  await new Promise(r => server.close(r));
}
