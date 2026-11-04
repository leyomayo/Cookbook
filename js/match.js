/*
 * match.js — keyword matching between free text and named things.
 *
 * Used by the recipe screen to find the ingredients a direction step
 * mentions ("Combine butter with salt" → "1/2 cup butter", "1 tsp salt").
 * Kept separate and generic so other features (the planned grocery list:
 * food types, related recipes) can reuse the same rules.
 *
 * Rules:
 *   - Words are compared in lower case. Numbers and punctuation are ignored,
 *     so amounts like "1/2" never match anything.
 *   - Simple plurals match their singular: "onions" ~ "onion",
 *     "tomatoes" ~ "tomato", "berries" ~ "berry", "apples" ~ "apple".
 *   - In a name, filler words (units like "cup" or "tsp", and words like
 *     "fresh", "chopped", "large") don't count, so "fresh basil" matches a
 *     step that says "basil" but not one that only says "fresh".
 *     If a name is made only of such words ("cloves"), they all count.
 *   - A name matches when any of its remaining words appears in the text.
 */

const Match = (() => {
  // Filler words: units, sizes, preparation and small linking words.
  const FILLER = new Set(`
    a an and or of the to in into on onto for with without from at by as plus
    about approx approximately each per some any few more less extra optional
    taste divided needed
    c cup cups tsp teaspoon teaspoons tbsp tbs tablespoon tablespoons
    g gram grams kg ml l liter liters litre litres oz ounce ounces lb lbs pound pounds
    pinch pinches dash dashes can cans package packages pkg jar jars bottle bag box
    clove cloves slice slices piece pieces stick sticks bunch bunches handful sprig sprigs
    large small medium big fresh freshly dried
    chopped diced minced sliced grated shredded crushed ground whole halved quartered
    peeled finely roughly thinly cut softened melted room temperature cold hot warm
    baking
  `.split(/\s+/).filter(Boolean));

  /**
   * Reduce a lower-case word to a stem so simple plurals and their singular
   * come out the same: "berries"/"berry" → "berri", "apples"/"apple" → "appl",
   * "tomatoes"/"tomato" → "tomato", "eggs"/"egg" → "egg".
   */
  function stem(word) {
    let w = word;
    if (w.length > 3) {
      if (w.endsWith('ies')) w = `${w.slice(0, -3)}i`;
      else if (w.endsWith('es')) w = w.slice(0, -2);
      else if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
    }
    if (w.length > 2) {
      if (w.endsWith('y')) w = `${w.slice(0, -1)}i`;
      else if (w.endsWith('e')) w = w.slice(0, -1);
    }
    return w;
  }

  /** Lower-case words of at least two letters, in order. */
  function splitWords(text) {
    return String(text ?? '').toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length > 1);
  }

  /** Every word in `text`, stemmed. Use for the text being searched. */
  function words(text) {
    return new Set(splitWords(text).map(stem));
  }

  /** The words that identify a name, stemmed (filler words left out). */
  function keywords(name) {
    const all = splitWords(name);
    const kept = all.filter((w) => !FILLER.has(w));
    return new Set((kept.length ? kept : all).map(stem));
  }

  /** True when any keyword of `name` appears among `textWords` (from words()). */
  function nameInWords(name, textWords) {
    for (const k of keywords(name)) if (textWords.has(k)) return true;
    return false;
  }

  /**
   * The items whose name is mentioned in `text`, in their original order.
   * `nameOf(item)` gives the name to match (default: item.name).
   *   byKeyword('Combine butter with salt', recipe.ingredients)
   */
  function byKeyword(text, items, nameOf = (item) => item.name) {
    const textWords = words(text);
    return items.filter((item) => nameInWords(nameOf(item), textWords));
  }

  return { stem, words, keywords, nameInWords, byKeyword };
})();
