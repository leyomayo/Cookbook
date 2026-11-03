# Cookbook

A personal cookbook web app for iPhone and iPad. It's plain HTML, CSS and
JavaScript with no build step, so GitHub Pages can serve it as is. Once you
add it to your Home Screen, it opens full screen like an app and works offline.

**Your recipes stay on your device.** They're saved in the browser's
IndexedDB storage. No servers, no accounts, no cloud services.

## What's in this version

- **Recipe list** with a meal type filter (All, Breakfast, Lunch, Snack, Dinner, Other)
- **Add / edit form**: title, meal type, prep time, cook time, servings, tags,
  an ingredient list, and numbered directions you can reorder
- **Recipe detail** page. On iPad the ingredients and directions sit side by side.

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
> Home Screen icon may also delete its recipes. Export and backup aren't built
> yet.

## Updating the app

The service worker (`sw.js`) caches the app files so the app works offline.
When you change any file:

1. Bump `CACHE_VERSION` in `sw.js` (for example `'v1'` → `'v2'`).
2. Commit and push.
3. Open the app once online. It downloads the new version in the background
   and uses it the next time you open the app.

Recipes aren't affected by updates, because they live in IndexedDB, not in the cache.

## Running it locally

Any static file server works, for example:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>. The service worker only runs over HTTPS or
on `localhost`.

## Project layout

```
index.html             App shell: header, main view, script tags
manifest.webmanifest   Name, icons and display mode for installing
sw.js                  Service worker: offline caching of the app files
css/styles.css         All styles. Mobile first, with a wider layout for iPad.
js/model.js            Recipe data shape, defaults and helpers
js/db.js               IndexedDB storage (get, save, delete)
js/app.js              Screens and hash-based navigation (#/, #/recipe/<id>, #/new, #/edit/<id>)
icons/                 Home Screen and manifest icons
```

## Data model

Each recipe is stored as one object (described in full in `js/model.js`).
Two fields are stored now but not used yet, so later features won't need a
data migration:

- **`ingredient.recipeId`**: will link an ingredient to another recipe
  (for example "pizza dough" → your Pizza Dough recipe).
- **`step.ingredientIds`**: will list the ingredients a direction step uses,
  for a tap-to-see-ingredients popup.

Every ingredient and step has a stable `id`, so these links keep working when
you reorder the lists. Editing a recipe keeps whatever values these fields
already hold.
