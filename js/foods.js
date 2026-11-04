/*
 * foods.js — a built-in list of common foods, with the food type (grocery
 * aisle) of each. Used by the grocery list to sort items by food type, to
 * merge the same food from different recipes into one line, and to find
 * related recipes (recipes that share ingredients).
 *
 * An ingredient is matched to a food with Match.bestPhrase (js/match.js):
 * the longest food name found in the ingredient's name wins, so
 * "extra virgin olive oil" is olive oil, "red bell peppers" is bell pepper,
 * and "garlic cloves" is garlic. Anything not in the list is "Other".
 * A name with the word "frozen" ("frozen peas") always goes in Frozen.
 *
 * To add a food, add its name (singular, lower case) to the right type below.
 * "a=b" makes a another way of writing b, so they merge on the grocery list
 * and count as the same food for related recipes ("garlic clove=garlic").
 */

const Foods = (() => {
  /** Food types, in the order the grocery list shows them. */
  const TYPES = ['Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Bakery', 'Pantry', 'Spices', 'Frozen', 'Other'];

  // Comma-separated so the list is easy to read and edit.
  const LIST = {
    Produce: `apple, apricot, artichoke, arugula, asparagus, avocado, banana, basil, bean sprout, beet,
      bell pepper, red pepper, green pepper, blackberry, blueberry, bok choy, broccoli, brussels sprout,
      cabbage, cantaloupe, carrot, cauliflower, celery, chard, cherry, chili, chili pepper, chive,
      cilantro, collard green, corn, cranberry, cucumber, dill, eggplant, endive, fennel, fig, garlic,
      garlic clove=garlic, ginger, grape, grapefruit, green bean, green onion, herb, jalapeño, jalapeño pepper=jalapeño,
      jalapeno=jalapeño, jalapeno pepper=jalapeño, kale, kiwi, leek, lemon, lemongrass, lettuce, lime, mango, melon, mint,
      mushroom, nectarine, okra, onion, red onion, orange, parsley, parsnip, pea, snap pea, peach, pear,
      pineapple, plum, pomegranate, potato, sweet potato, pumpkin, radish, raspberry, rosemary, romaine,
      sage, salad green, scallion, shallot, spinach, squash, butternut squash, strawberry, thyme, tomato,
      cherry tomato, turnip, watermelon, zucchini`,
    'Meat & Seafood': `anchovy, bacon, beef, ground beef, steak, chicken, chicken breast, chicken thigh,
      chicken wing, chorizo, clam, cod, crab, duck, fish, halibut, ham, lamb, lobster, mussel, pancetta,
      pepperoni, pork, pork chop, prosciutto, salami, salmon, sausage, scallop, shrimp, prawn, tilapia,
      trout, tuna, turkey, ground turkey, veal`,
    'Dairy & Eggs': `butter, buttermilk, cheese, cheddar, cheddar cheese=cheddar, mozzarella, mozzarella cheese=mozzarella,
      parmesan, parmesan cheese=parmesan, feta, feta cheese=feta, ricotta, ricotta cheese=ricotta, cream cheese, cottage cheese, goat cheese, swiss cheese, gruyere, brie, provolone,
      mascarpone, monterey jack, cream, heavy cream, whipping cream, sour cream, half and half,
      crème fraîche, egg, egg yolk, egg white, milk, yogurt, greek yogurt, ghee`,
    Bakery: `bread, baguette, bun, hamburger bun, hot dog bun, roll, dinner roll, tortilla, pita, naan,
      croissant, bagel, english muffin, muffin, sourdough, ciabatta, brioche, flatbread`,
    Pantry: `flour, sugar, brown sugar, powdered sugar, honey, maple syrup, syrup, molasses, rice,
      brown rice, pasta, spaghetti, penne, macaroni, lasagna, noodle, rice noodle, ramen, oat, oatmeal,
      quinoa, couscous, polenta, cornmeal, lentil, chickpea, bean, black bean, kidney bean, broth,
      chicken broth, beef broth, vegetable broth, stock, chicken stock, bouillon, tomato paste,
      tomato sauce, canned tomato, soy sauce, fish sauce, oyster sauce, hoisin sauce, hot sauce,
      worcestershire sauce, sriracha, salsa, sauce, pesto, curry paste, vinegar, balsamic vinegar,
      oil, olive oil, vegetable oil, canola oil, sesame oil, coconut oil, cooking spray, coconut milk,
      peanut butter, jam, mustard, ketchup, mayonnaise, mayo=mayonnaise, tahini, baking powder, baking soda,
      yeast, cornstarch, cocoa, cocoa powder, chocolate, chocolate chip, vanilla, vanilla extract,
      almond, walnut, pecan, peanut, cashew, pine nut, pistachio, nut, raisin, dried fruit,
      breadcrumb, bread crumb=breadcrumb, panko, cracker, cereal, olive, caper, pickle, wine, red wine,
      white wine, beer, coffee, tea, gelatin, sesame seed, chia seed, flaxseed, seed, chip,
      tortilla chip, water`,
    Spices: `salt, kosher salt, sea salt, pepper, black pepper, peppercorn, cumin, paprika,
      smoked paprika, chili powder, chili flake, red pepper flake, cayenne, cayenne pepper=cayenne, cinnamon,
      nutmeg, clove, ground clove, oregano, bay leaf, curry powder, turmeric, ground ginger,
      garlic powder, onion powder, coriander, cardamom, allspice, italian seasoning, seasoning,
      garam masala, mustard seed, fennel seed, saffron, star anise, spice`,
    Frozen: `ice, ice cream, sorbet, frozen yogurt, puff pastry, phyllo`,
  };

  // Staples: in nearly every recipe, so they don't count when finding
  // related recipes (they'd make everything look related).
  const STAPLES = new Set(`salt, kosher salt, sea salt, pepper, black pepper, peppercorn, oil, olive oil,
    vegetable oil, canola oil, cooking spray, water`.split(',').map((s) => s.trim()));

  const FOODS = Object.entries(LIST).flatMap(([type, names]) =>
    names.split(',').map((n) => n.trim()).filter(Boolean).map((entry) => {
      const [name, same] = entry.split('=').map((x) => x.trim());
      return { name, key: same || name, type, staple: STAPLES.has(name) };
    }));

  /** The food an ingredient name refers to, or null if it isn't in the list. */
  function find(name) {
    return Match.bestPhrase(name, FOODS, (f) => f.name);
  }

  /** The food type for an ingredient name ("Other" if not in the list). */
  function typeOf(name) {
    if (Match.words(name).has('frozen')) return 'Frozen';
    return find(name)?.type || 'Other';
  }

  /**
   * What counts as "the same food" when merging grocery lines and comparing
   * recipes: the matched food's name, or for unknown foods the name's
   * keywords ("Ras el hanout" and "ras el hanout" match each other).
   */
  function key(name) {
    const food = find(name);
    return food ? food.key : [...Match.keywords(name)].join(' ');
  }

  function isStaple(name) {
    return Boolean(find(name)?.staple);
  }

  /**
   * Other recipes that share non-staple foods with `recipe`, most shared
   * first, then A to Z. Each result is { recipe, shared: [food names] }
   * (the food list's name, e.g. "garlic", or the ingredient's keywords).
   * `nameOf(ingredient, recipe)` gives an ingredient's name (a linked
   * ingredient with a blank name uses its recipe's title).
   */
  function related(recipe, all, nameOf = (i) => i.name, limit = 5) {
    const foodsOf = (r) => {
      const map = new Map();
      r.ingredients.forEach((i) => {
        const name = nameOf(i, r);
        if (!name || isStaple(name)) return;
        const k = key(name);
        if (k && !map.has(k)) map.set(k, k);
      });
      return map;
    };
    const mine = foodsOf(recipe);
    return all
      .filter((r) => r.id !== recipe.id)
      .map((r) => ({ recipe: r, shared: [...foodsOf(r).keys()].filter((k) => mine.has(k)) }))
      .filter((x) => x.shared.length)
      .sort((a, b) => b.shared.length - a.shared.length
        || a.recipe.title.localeCompare(b.recipe.title, undefined, { sensitivity: 'base' }))
      .slice(0, limit);
  }

  return { TYPES, FOODS, find, typeOf, key, isStaple, related };
})();
