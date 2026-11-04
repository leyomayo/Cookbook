/*
 * app.test.js — end-to-end checks in Chromium, emulating iPhone 13 and iPad Pro.
 *
 * Not part of the app (nothing loads it). To run:
 *   1. npm install playwright && npx playwright install chromium   (once)
 *   2. python3 -m http.server 8765        (from the repository root)
 *   3. node tests/app.test.js [screenshot-folder]
 *
 * Each run uses fresh browser storage. It covers: the v1 → v2 data upgrade,
 * the tag editor, the Tags filter screen, .recipe / .cookbook export and the
 * share-sheet fallbacks, import checks and the "Import complete" counts,
 * importing old .json files, and offline loading with the current cache.
 */
const { chromium, devices } = require('playwright');
const fs = require('fs');
const SP = process.argv[2] || require('os').tmpdir(), URL0 = 'http://localhost:8765/';
let fails = 0, passes = 0;
const ok = (cond, msg, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg + (extra !== undefined && !cond ? ' ' + JSON.stringify(extra) : '')); cond ? passes++ : fails++; };
const texts = (page, sel) => page.$$eval(sel, l => l.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
const cardTitles = (page) => page.$$eval('.card-title', l => l.map(x => x.textContent));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
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
  await page.screenshot({ path: SP + '/v3-tags-iphone.png' });
  await page.click('#show-btn'); await page.waitForSelector('.card');
  ok(JSON.stringify(await cardTitles(page)) === '["Chicken Tacos"]', 'list applies both tags (AND)');
  ok(await page.$('.tag-bar-active') !== null && (await page.textContent('.tag-bar-count')) === '2', 'list shows an active tag filter with count');
  ok(JSON.stringify(await texts(page, '[data-untag]')) === '["Sweet ✕","Chicken ✕"]', 'active tags shown as removable pills', await texts(page, '[data-untag]'));
  await page.screenshot({ path: SP + '/v3-list-active.png' });
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
  await page.screenshot({ path: SP + '/v3-import-complete.png' });
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
  await fp.screenshot({ path: SP + '/v3-tags-ipad.png' });
  await fp.click('#show-btn'); await fp.waitForSelector('.card');
  await fp.screenshot({ path: SP + '/v3-list-ipad.png' });

  // ---------- F. Offline with cache v3 ----------
  await page.goto(URL0); await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.waitForSelector('.card');
  const keys = await page.evaluate(() => caches.keys());
  ok(JSON.stringify(keys) === '["cookbook-v3"]', 'only cache cookbook-v3', keys);
  await ctx.setOffline(true);
  for (const h of ['#/', '#/tags', '#/backup', '#/new']) {
    await page.goto(URL0 + h); await page.reload();
    await page.waitForSelector({ '#/': '.card', '#/tags': '#tag-search', '#/backup': '#export-btn', '#/new': '.tag-input' }[h]);
  }
  ok(true, 'offline: list, tags, backup and form screens load');
  await ctx.setOffline(false);

  ok(errors.length === 0, 'no page errors', errors);
  console.log(fails ? `${fails} FAILED, ${passes} passed` : `ALL ${passes} PASSED`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
