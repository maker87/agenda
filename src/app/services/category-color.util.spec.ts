import {
  buildCategoryColorMap,
  seedRootColors,
  CATEGORY_PALETTE,
  UNCATEGORIZED_COLOR,
} from './category-color.util';

/** Lightness of a hex colour, 0–1. */
function lightnessOf(hex: string): number {
  const int = parseInt(hex.slice(1), 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
}

const TREE = [
  'Work', 'Work > Meetings', 'Work > Reviews', 'Work > Deep Work',
  'School', 'School > Clubs', 'School > Exams',
  'Health', 'Health > Gym',
  'Personal', 'Finance', 'Travel', 'Social',
];

const rootsOf = (paths: string[]) => [...new Set(paths.map(p => p.split(' > ')[0]))];

describe('category colours', () => {

  it('never gives two root categories the same colour', () => {
    const plan = buildCategoryColorMap(TREE, {});
    const roots = rootsOf(TREE).map(r => plan[r]);
    expect(new Set(roots).size).toBe(roots.length);
  });

  it('never offers a category colour that reads as "no category"', () => {
    expect(CATEGORY_PALETTE).not.toContain(UNCATEGORIZED_COLOR);
  });

  it('gives siblings colours of their own', () => {
    const plan = buildCategoryColorMap(TREE, {});
    const siblings = ['Work > Meetings', 'Work > Reviews', 'Work > Deep Work'].map(p => plan[p]);
    expect(new Set(siblings).size).toBe(siblings.length);
  });

  it('draws a sub-category lighter than the category above it', () => {
    const plan = buildCategoryColorMap(TREE, {});
    for (const child of ['Work > Meetings', 'Work > Reviews', 'Work > Deep Work']) {
      expect(lightnessOf(plan[child])).toBeGreaterThan(lightnessOf(plan['Work']));
    }
  });

  it('keeps lightening as nesting deepens', () => {
    const deep = ['A', 'A > B', 'A > B > C'];
    const plan = buildCategoryColorMap(deep, {});
    expect(lightnessOf(plan['A > B'])).toBeGreaterThan(lightnessOf(plan['A']));
    expect(lightnessOf(plan['A > B > C'])).toBeGreaterThan(lightnessOf(plan['A > B']));
  });

  it('lets a hand-picked colour win, and flows it down to the sub-categories', () => {
    const plan = buildCategoryColorMap(TREE, { Work: '#ff0000' });
    expect(plan['Work']).toBe('#ff0000');
    // Derived from red now, so every child is lighter than it and none of them
    // is the colour Work would have been given automatically.
    for (const child of ['Work > Meetings', 'Work > Reviews']) {
      expect(lightnessOf(plan[child])).toBeGreaterThan(lightnessOf('#ff0000'));
    }
  });

  it('re-colours the whole family when the parent is re-coloured', () => {
    const before = buildCategoryColorMap(TREE, { Work: '#ff0000' });
    const after = buildCategoryColorMap(TREE, { Work: '#0000ff' });
    expect(after['Work > Meetings']).not.toBe(before['Work > Meetings']);
  });

  it('leaves the existing categories alone when a new one is added', () => {
    const roots = rootsOf(TREE);
    const remembered: Record<string, string> = {};
    const first = seedRootColors(roots, {}, CATEGORY_PALETTE, remembered);
    for (const [name, color] of first) remembered[name] = color;
    const before = buildCategoryColorMap(TREE, {}, CATEGORY_PALETTE, first);

    const grown = [...TREE, 'Volunteering', 'Volunteering > Shelter'];
    const second = seedRootColors(rootsOf(grown), {}, CATEGORY_PALETTE, remembered);
    const after = buildCategoryColorMap(grown, {}, CATEGORY_PALETTE, second);

    for (const path of TREE) expect(after[path]).toBe(before[path]);
    expect(after['Volunteering']).toBeTruthy();
    expect(rootsOf(grown).map(r => after[r]).length)
      .toBe(new Set(rootsOf(grown).map(r => after[r])).size);
  });

  it('frees a colour when the category using it goes away', () => {
    const remembered: Record<string, string> = {};
    for (const [name, color] of seedRootColors(rootsOf(TREE), {}, CATEGORY_PALETTE)) {
      remembered[name] = color;
    }
    const freed = remembered['Finance'];

    const left = TREE.filter(p => p !== 'Finance');
    const live = new Set(rootsOf(left));
    // What the dashboard does when a root disappears.
    for (const name of Object.keys(remembered)) if (!live.has(name)) delete remembered[name];

    const seeded = seedRootColors(rootsOf(left), {}, CATEGORY_PALETTE, remembered);
    expect([...seeded.values()]).not.toContain(freed);
    expect(seedRootColors([...rootsOf(left), 'Budget'], {}, CATEGORY_PALETTE, remembered).get('Budget'))
      .toBeTruthy();
  });

  it('is the same on every build for the same set of categories', () => {
    const once = buildCategoryColorMap(TREE, {});
    const again = buildCategoryColorMap([...TREE].reverse(), {});
    for (const path of TREE) expect(again[path]).toBe(once[path]);
  });

  it('colours a category whose parent was never saved on its own', () => {
    const plan = buildCategoryColorMap(['Orphan > Child'], {});
    expect(plan['Orphan']).toBeTruthy();
    expect(lightnessOf(plan['Orphan > Child'])).toBeGreaterThan(lightnessOf(plan['Orphan']));
  });
});
