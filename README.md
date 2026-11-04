# Cookbook

A personal cookbook web app for iPhone and iPad. It's plain HTML, CSS and
JavaScript with no build step, so GitHub Pages can serve it as is. Once you
add it to your Home Screen, it opens full screen like an app and works offline.

**Your recipes stay on your device.** They're saved in the browser's
IndexedDB storage. No servers, no accounts, no cloud services.

## What's in this version

- **Recipe list** with a meal type filter (All, Breakfast, Lunch, Snack, Dinner, Other).
  Tap **Tags** under it to filter by tag as well.
- **+ Add** (top right of the recipe list): **Add manually** or **Add from file**
- **Add / edit form**: title, meal type, prep time, cook time, servings, tags,
  an ingredient list, and numbered directions you can reorder
- **Recipe detail** page. On iPad the ingredients and directions sit side by side.
  Tap a direction step to see the ingredients it uses.
- **Tag list** that starts with 46 common tags and grows as you add your own
- **Recipe links**: an ingredient can link to a recipe in the Other category,
  so a homemade sauce or broth opens its own recipe
- **Backup, sharing and adding from a file**

## Tags

- Tap into the **Tags** field to see 15 suggestions, most used first, then A to Z.
  Tap a suggestion to add it. Tap an added tag (✕) to remove it.
- Type to search the whole list. Your text can appear anywhere in the tag,
  in any case ("ick" finds "Chicken").
- Press **Return** to add the tag that matches your text exactly (ignoring
  case). If there's no exact match, a new tag is created and saved to the list.
  Only the first letter is capitalized; the rest stays as you typed it.
- Tags stay in the list even when no recipe uses them.

### Filtering by tag

- On the recipe list, tap **Tags** (under the meal types) to open the tag filter.
- Search for a tag: your text can appear anywhere in its name, in any case.
  Only tags used by at least one recipe are listed, with how many recipes use each.
- Tap tags to choose them. Pick several and a recipe must have all of them.
  The tag filter works together with the meal type filter. **Show N recipes**
  takes you back to the list.
- While a tag filter is on, the list shows a highlighted bar with the chosen
  tags. Tap a tag's ✕ to remove it, or **Clear** to remove them all.

## Recipe links

Use recipe links for homemade ingredients, like a sauce, broth or dough
that has its own recipe. Save that recipe with the meal type **Other**
first.

- In the add / edit form, tap **🔗** on an ingredient row. The picker lists
  your **Other** recipes A to Z, with a search box. It never lists the recipe
  you're editing. If you have no Other recipes yet, the picker says so.
- Pick a recipe to link it. If the ingredient's name is blank, it's filled in
  with the recipe's title. A name you already typed is never changed.
- A linked row shows **Links to** and the recipe's name. Tap **Unlink** to make it plain
  text again (the name stays). Links move with their row and are saved with
  the recipe.
- On the recipe page a linked ingredient's name is underlined in the accent
  color. Tap the name to open that recipe. **Back** returns to the recipe you came from, even after a
  reload or an edit.

How links behave:

- **Rename** the linked recipe: the link still works (it uses the recipe's id).
  The ingredient keeps its own name.
- **Delete** the linked recipe: the delete confirmation lists the recipes
  that link to it. Their linked ingredients become plain text, in the same
  step as the delete.
- The browser's own back (or swipe back) also works, because each link is a
  normal page change in the app's address.
- **Change the meal type** of a linked recipe away from Other: links to it keep
  working. It just stops appearing in the picker.
- Other recipes can link to each other, even in a loop. A recipe can't link
  to itself.
- If a link points to a recipe that isn't on this device (for example a shared
  recipe whose linked recipe you didn't import), the ingredient shows as plain
  text. The link is kept, so it works again if you import that recipe later.

## Step ingredients

On a recipe page, tap a direction step to see the ingredients it uses. Its
number turns a lighter orange. Tap it again to clear it, or tap another step.

- **iPad** (side by side): the step's ingredients are highlighted in the
  ingredient list.
- **iPhone**: a bar at the bottom of the screen shows the step's ingredients
  with their amounts. Swipe it sideways if they don't all fit. It's hidden when
  no step is selected or the step mentions no ingredient.

Linked ingredients (see "Recipe links") are still links in both places.

### Checking off steps

The step's number and its text are both part of the step, so tapping anywhere
on a step selects it.

- Tap the selected step's **number** again to check it off. It shows a tick,
  its text dims, and the next unchecked step is selected.
- Tap the selected step's **text** again to clear the highlight. Checks stay.
- Tap a checked step's **number** to uncheck it.

Checks are kept while you open a linked recipe and come back (each recipe
keeps its own). They're cleared when you go back to the recipe list, and
they're never saved with the recipe.

Ingredients are found by keyword, so nothing needs to be set up and existing
recipes work as they are. A step mentions an ingredient when it contains any
word of the ingredient's name, ignoring case, amounts and simple plurals
("onions" finds "onion"). Filler words in the name, such as units ("cup",
"tsp") and words like "fresh", "chopped" or "large", don't count on their own.
Because it's word based, a step that says "pepper" finds both "black pepper"
and "bell pepper", and a step that says "the sauce" finds nothing unless an
ingredient is called sauce. The rules live in `js/match.js` so other features
can reuse them.

## Backup, sharing and adding from a file

### Adding recipes from a file

Tap **+ Add** on the recipe list, then **Add from file**. It takes a shared
recipe (`.recipe`), a backup (`.cookbook`), or an older `.json` export. To add
a file someone sent you, save it to Files first, then pick it here. The
picker doesn't limit file types (otherwise iOS greys out `.recipe` and
`.cookbook` files); the app checks the file's contents. If the file can't be
added, a message says why, and nothing changes. **Add manually** opens the
new recipe form.

### Backup screen

Open **Backup** (top left of the recipe list).

- **Export all recipes** makes one backup file, `cookbook-backup-<date>.cookbook`,
  with every recipe and your tag list.
- **Share recipe** (at the bottom of a recipe) makes `<recipe-name>.recipe`
  with that recipe and every recipe it links to, including recipes those link to.
- On iPhone and iPad both open the **share sheet**. Choose **Save to Files**
  to keep a backup, or AirDrop, Messages or Mail to send it. On a computer the
  file downloads. If the share sheet won't take the file, the app downloads it
  instead and tells you.
- **Restore from a backup → Choose backup…** adds the recipes and tags from a
  `.cookbook` backup (or an older `.json` backup). A shared `.recipe` file is
  refused here with a pointer to **+ Add → Add from file**.

When adding from a file or restoring (both work the same way):

- If anything in the file is invalid, you see an error and nothing changes.
- If a recipe in the file is already in your cookbook (same id), you choose
  **Ignore** (skip it), **Overwrite** (replace yours) or **Keep both** (import it
  as a separate recipe). You can apply the same answer to the rest of the file.
  **Cancel import** stops without changing anything.
- If a different recipe has the same name (ignoring case), the imported one is
  renamed with "-new" on the end, and a warning tells you.
- Links between imported recipes are updated when a recipe gets a new id.
- Imported tags join your tag list.
- When it's done, an **Import complete** message shows how many recipes were
  added, overwritten, ignored, and renamed with "-new". Tap **OK** to close it.
  It doesn't appear if you cancel or the file is invalid.

**Make a backup now and then.** Recipes live only on the device, so a backup
in Files (or iCloud Drive) is the only copy if the app is deleted.

## Turn on GitHub Pages

1. Push this repository to GitHub (the app files are in the repository root).
2. On GitHub, open the repository and go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Choose the branch (for example `main`), choose the **/ (root)** folder, and click **Save**.
5. Wait a minute or two. The page shows your site address, usually
   `https://<your-username>.github.io/<repository-name>/`.

GitHub Pages serves over HTTPS, which the offline support (service worker) needs.

## Add it to your Home Screen

### iPhone or iPad (Safari)

1. Open your GitHub Pages address in **Safari**.
2. Tap the **Share** button (the square with an arrow pointing up). On iPad
   it's at the top of the screen. On iPhone it's at the bottom.
3. Scroll down and tap **Add to Home Screen**.
4. Keep the name "Cookbook" or change it, then tap **Add**.

Open the app once while you're online so it can save its files for offline use.

> **About storage:** Safari keeps each Home Screen app's data separate from the
> regular Safari tab. Recipes you add in the Home Screen app appear only there,
> and recipes you add in a Safari tab appear only in that tab. Deleting the
> Home Screen icon may also delete its recipes, so keep a backup (see above).
> To move recipes from a Safari tab into the Home Screen app, export a backup
> in the tab and restore it in the app (Backup → Restore from a backup).

## Updating the app

The service worker (`sw.js`) caches the app files so the app works offline.
When you change any file:

1. Bump `CACHE_VERSION` in `sw.js` (for example `'v1'` → `'v2'`).
2. Commit and push.
3. Open the app online. It checks for a new version when it opens and when
   you switch back to it. The new version installs in the background and takes
   over by itself: the app reloads and shows **Cookbook updated** with the
   version number (`CACHE_VERSION` without the "v", for example "version 8").
   If you're on the add/edit form or a message is open, the reload waits
   until you move to another screen, so nothing you're typing is lost.

Recipes aren't affected by updates, because they live in IndexedDB, not in the cache.
When the data shape changes, the update converts existing recipes the first
time it opens (see "Data model" below).

## Running it locally

Any static file server works, for example:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>. The service worker only runs over HTTPS or
on `localhost`.

### Automated tests

`tests/app.test.js` drives the app in Chromium (emulating iPhone 13 and iPad
Pro) with [Playwright](https://playwright.dev). It isn't part of the app.
Serve the repository on port 8765 (`python3 -m http.server 8765`), then run
`node tests/app.test.js`. It runs every check on both profiles; add a
screenshot folder and `iphone` or `ipad` to run one. See the top of that
file for setup.

## Project layout

```
index.html             App shell: header, main view, script tags
manifest.webmanifest   Name, icons and display mode for installing
sw.js                  Service worker: offline caching of the app files
css/styles.css         All styles. Mobile first, with a wider layout for iPad.
js/model.js            Recipe data shape, defaults, schema upgrades (normalizeRecipe)
js/match.js            Keyword matching (which ingredients a step mentions), reusable
js/tags.js             Starter tags, tag list helpers, the tag editor
js/transfer.js         Export/share/import: file names and format, checks, conflict handling
js/db.js               IndexedDB storage: recipes and the tag list
js/app.js              Screens and hash-based navigation (#/, #/tags, #/recipe/<id>, #/new, #/edit/<id>, #/backup).
                       Following a recipe link adds ?from=<id> to the hash so Back can return.
icons/                 Home Screen and manifest icons
tests/app.test.js      Browser tests (not loaded by the app)
```

## Data model

Each recipe is stored as one object (described in full in `js/model.js`).

- **`ingredient.recipeId`**: the id of the recipe this ingredient links to
  (for example "pizza dough" → your Pizza Dough recipe), or `null`. See
  "Recipe links" above. Deleting a recipe sets links to it back to `null`.
- **`step.ingredientIds`**: stored but not used. Step ingredients are found by
  keyword instead (see "Step ingredients"). Kept so existing data and files
  stay valid.

Every ingredient and step has a stable `id`, so these links keep working when
you reorder the lists. Editing a recipe keeps whatever values these fields
already hold.

Schema changes go in `normalizeRecipe()` in `js/model.js`, which runs on every
recipe read from storage or from a file.

- **Schema 1**: first version.
- **Schema 2**: tags are names from the tag list. Updating converts existing
  tags (including comma-separated text), capitalizes the first letter, and
  merges tags that differ only by case.

The tag list is a separate IndexedDB store (`tags`), keyed by the lower-case name.

### File format

Export files are JSON, whatever the file ending (`.cookbook` for backups,
`.recipe` for shared recipes, `.json` for exports from older versions):

```json
{
  "format": "cookbook-recipes",
  "formatVersion": 1,
  "kind": "backup",
  "exportedAt": "2026-11-03T18:00:00.000Z",
  "recipes": [ { "id": "r_…", "title": "…", "ingredients": [ … ], "steps": [ … ] } ],
  "tags": [ "Chicken", "Weeknight" ]
}
```

`kind` is `backup` (every recipe, plus the whole tag list in `tags`) or `share`
(one recipe followed by the recipes it links to). Recipe, ingredient and step
ids are kept as they are. Files from a newer `formatVersion` or schema are
rejected with a message to update the app.
