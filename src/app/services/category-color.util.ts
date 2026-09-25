/**
 * Category colours, and how sub-categories inherit them.
 *
 * A category's colour is the single source of truth for everything filed under
 * it — events don't carry their own. A sub-category inherits its parent's
 * colour as a lighter, slightly shifted shade, so "Work > Meetings" reads as a
 * kind of Work at a glance instead of an unrelated colour, while still being
 * told apart from its siblings.
 *
 * `buildCategoryColorMap` works the whole scheme out in one pass, which is what
 * makes it both clear and cheap:
 *
 *  - Clear, because seeing every category at once is the only way to guarantee
 *    that two top-level categories never come out the same colour, and that
 *    siblings are spread evenly apart rather than landing wherever a hash of
 *    their name happens to put them.
 *  - Cheap, because rendering then costs one lookup per event instead of a
 *    path split, a hash and two colour-space conversions — and the calendar
 *    asks for a colour once per event, per list, on every change-detection
 *    pass.
 *
 * Pure functions, no Angular, so the resolution rules can be tested directly.
 */

import { CATEGORY_SEP } from './category-tree.service';

/** Shown for anything with no category at all. */
export const UNCATEGORIZED_COLOR = '#64748b';

/**
 * The colours top-level categories are drawn from.
 *
 * Twelve hues roughly 30° apart — about as many as anyone can reliably tell
 * apart at the size of a calendar dot, so a longer list buys nothing. Two
 * properties of this list are load-bearing:
 *
 *  - Nothing in it is near `UNCATEGORIZED_COLOR`. The palette this replaces
 *    contained that exact grey, so a coloured category could be indis-
 *    tinguishable from one with no category at all. It also held three
 *    yellow-greens and two near-identical reds, which wasted slots that
 *    `claimRootColor` then handed out as if they were distinct.
 *  - Neighbouring entries sit on opposite sides of the wheel. Colours are
 *    claimed around this order and collisions probe forward, so an account
 *    with three categories gets three colours that could not be more
 *    different, and a displaced category lands far from whatever displaced it.
 */
export const CATEGORY_PALETTE: readonly string[] = [
  '#e11d48', // rose
  '#0ea5e9', // sky
  '#eab308', // yellow
  '#a855f7', // purple
  '#16a34a', // green
  '#f97316', // orange
  '#3b82f6', // blue
  '#84cc16', // lime
  '#d946ef', // fuchsia
  '#14b8a6', // teal
  '#6366f1', // indigo
  '#ec4899', // pink
];

/** How far to either side of its parent's hue a child may sit. */
const CHILD_HUE_SPREAD = 28;
/** How far a whole family may drift from the hue of its root. */
const CHILD_HUE_DRIFT_CAP = 40;
/** How much of the root's headroom to white each level of nesting takes. */
const CHILD_LIGHT_STEP = 0.17;
const CHILD_LIGHT_CAP = 0.55;
const CHILD_LIGHT_MAX = 0.8;
/** Alternating nudge so adjacent siblings differ in weight as well as hue. */
const CHILD_LIGHT_JITTER = 0.05;
/** A child is always at least this much lighter than its parent. */
const CHILD_LIGHT_MIN_GAP = 0.05;

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function hexToHsl(hex: string): Hsl | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return { h: 0, s: 0, l };

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return { h: h * 360, s, l };
}

function hslToHex({ h, s, l }: Hsl): string {
  const hue = ((h % 360) + 360) % 360 / 360;
  const sat = Math.min(1, Math.max(0, s));
  const lum = Math.min(1, Math.max(0, l));

  if (sat === 0) {
    const v = Math.round(lum * 255).toString(16).padStart(2, '0');
    return `#${v}${v}${v}`;
  }

  const q = lum < 0.5 ? lum * (1 + sat) : lum + sat - lum * sat;
  const p = 2 * lum - q;
  const channel = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };

  const to255 = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${to255(channel(hue + 1 / 3))}${to255(channel(hue))}${to255(channel(hue - 1 / 3))}`;
}

/** Stable small integer from a string, for picking a colour deterministically. */
export function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

/** Shortest signed distance from `from` to `to` around the wheel. */
function hueDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/** Pull `hue` back to within `cap` degrees of `anchor`. */
function clampHue(hue: number, anchor: number, cap: number): number {
  const delta = hueDelta(anchor, hue);
  return anchor + Math.min(cap, Math.max(-cap, delta));
}

export interface ChildShadeOptions {
  /** Position among the siblings sharing this parent. */
  index: number;
  /** How many siblings there are, so the band can be divided evenly. */
  count: number;
  /** Levels below the root, used to decide how far to lighten. */
  depth: number;
  /**
   * The family's root colour.
   *
   * Lightness and saturation are measured from here rather than from the
   * immediate parent, because measuring from the parent compounds: each level
   * lightened what was already lightened, so by the third level everything had
   * piled up against the ceiling and a category, its child and its grandchild
   * were the same washed-out colour. Anchoring to the root instead gives each
   * depth a fixed place on the ramp. Defaults to `base`, which is correct for
   * the first level.
   */
  root?: string;
}

/**
 * A child shade of `base`.
 *
 * Siblings are placed at evenly spaced points across a band centred on the
 * parent's hue, so two children of the same parent cannot come out the same
 * colour. Deriving the shift from a hash of the child's name instead — as this
 * did before — routinely gave siblings shifts a few degrees apart, which is no
 * difference at all on a calendar dot; the spread is what makes a sub-category
 * legible as itself rather than only as "something under Work".
 *
 * Each level is also clearly lighter than the one above it, and adjacent
 * siblings alternate a little lighter and darker, so a parent with many
 * children stays readable once the hue steps get small.
 */
export function deriveChildColor(base: string, opts: ChildShadeOptions): string {
  const parent = hexToHsl(base);
  if (!parent) return base;
  const anchor = (opts.root ? hexToHsl(opts.root) : null) ?? parent;

  const count = Math.max(1, opts.count);
  const index = Math.min(Math.max(opts.index, 0), count - 1);
  const depth = Math.max(1, opts.depth);

  // Hue is spread evenly across ±CHILD_HUE_SPREAD around the immediate parent,
  // then pulled back to within sight of the root so deep nesting can't wander
  // into the next family's colours.
  const step = (2 * CHILD_HUE_SPREAD) / Math.max(count, 2);
  const spread = parent.h + (index - (count - 1) / 2) * step;
  const hue = clampHue(spread, anchor.h, CHILD_HUE_DRIFT_CAP);

  // Lighten toward (not to) white, by depth, so every level is legible and a
  // child is always lighter than the parent it sits under.
  const rise = Math.min(CHILD_LIGHT_STEP * depth, CHILD_LIGHT_CAP);
  const lifted = anchor.l + (1 - anchor.l) * rise;
  const jittered = lifted + (index % 2 === 0 ? CHILD_LIGHT_JITTER : -CHILD_LIGHT_JITTER);

  return hslToHex({
    h: hue,
    // Only a mild fade with depth. Pulling saturation down by 40% washed
    // sub-categories out until they read as grey rather than as a shade of
    // their parent, which is the one thing the shading exists to convey. It
    // keeps easing past the point where lightness runs out of headroom, so
    // the deepest levels still separate.
    s: anchor.s * Math.max(0.55, 1 - 0.1 * depth),
    l: Math.min(Math.max(jittered, parent.l + CHILD_LIGHT_MIN_GAP), CHILD_LIGHT_MAX),
  });
}

/**
 * Give `root` a palette colour nothing else is already using.
 *
 * Hashing alone picked a slot per name and lived with the clashes: across 20
 * ordinary category names four pairs came out the same colour, even though the
 * palette had a free slot for every one of them. Widening the palette doesn't
 * help — the hash clusters differently against each modulus — and once there
 * are more names than slots some sharing is unavoidable anyway. So the hash
 * still chooses where to *start*, which keeps a name's colour predictable, and
 * a slot that is taken probes forward to the next free one instead of doubling
 * up. Distinct colours are then guaranteed until the palette genuinely runs out.
 */
export function claimRootColor(
  root: string,
  assigned: ReadonlyMap<string, string>,
  palette: readonly string[],
): string {
  if (!palette.length) return UNCATEGORIZED_COLOR;

  const taken = new Set<number>();
  for (const color of assigned.values()) {
    const slot = palette.indexOf(color);
    if (slot >= 0) taken.add(slot);
  }

  let slot = hashString(root) % palette.length;
  for (let step = 0; step < palette.length && taken.has(slot); step++) {
    slot = (slot + 1) % palette.length;
  }
  return palette[slot];
}

/**
 * Colour every root category, from the set of names rather than the order they
 * happened to be discovered in — the same categories always come out the same
 * way, including after a reload. Hand-picked colours are placed first, so
 * probing never displaces one.
 *
 * `remembered` is what this returned for these roots last time, and is what
 * makes the result stable as categories come and go. Probing cannot be stable
 * on its own: whichever order it runs in, a new category that lands on an
 * occupied slot pushes its occupant along, and that push cascades — adding one
 * category re-coloured five others and everything filed under them. Handing a
 * root back the colour it already had stops the cascade at the source.
 *
 * Anything left over is placed in order of the slot it wants, then by name, so
 * a first run is deterministic too.
 */
export function seedRootColors(
  roots: readonly string[],
  explicit: Readonly<Record<string, string>>,
  palette: readonly string[] = CATEGORY_PALETTE,
  remembered: Readonly<Record<string, string>> = {},
): Map<string, string> {
  const assigned = new Map<string, string>();
  const unique = [...new Set(roots.filter(Boolean))].sort();
  if (!palette.length) {
    for (const root of unique) assigned.set(root, explicit[root] || UNCATEGORIZED_COLOR);
    return assigned;
  }

  // Hand-picked colours go down first, so nothing else can take one.
  const taken = new Set<number>();
  for (const root of unique) {
    const chosen = explicit[root];
    if (!chosen) continue;
    assigned.set(root, chosen);
    const slot = palette.indexOf(chosen);
    if (slot >= 0) taken.add(slot);
  }

  // Then colours these roots already had. A remembered colour that is no
  // longer in the palette is dropped rather than honoured, so changing the
  // palette re-colours the tree instead of stranding it half in the old one.
  const pending: { name: string; pref: number }[] = [];
  for (const root of unique) {
    if (assigned.has(root)) continue;
    const slot = palette.indexOf(remembered[root] ?? '');
    if (slot >= 0 && !taken.has(slot)) {
      assigned.set(root, palette[slot]);
      taken.add(slot);
    } else {
      pending.push({ name: root, pref: hashString(root) % palette.length });
    }
  }

  pending.sort((a, b) => a.pref - b.pref || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const { name } of pending) {
    assigned.set(name, claimRootColor(name, assigned, palette));
  }
  return assigned;
}

/** parent path → child paths, with every implied ancestor filled in. */
function indexByParent(paths: readonly string[]): Map<string, string[]> {
  const children = new Map<string, string[]>();
  const seen = new Set<string>();

  for (const raw of paths) {
    if (!raw) continue;
    const segments = raw.split(CATEGORY_SEP).map(s => s.trim()).filter(Boolean);

    let parent = '';
    let accumulated = '';
    for (const segment of segments) {
      accumulated = accumulated ? `${accumulated}${CATEGORY_SEP}${segment}` : segment;
      if (!seen.has(accumulated)) {
        seen.add(accumulated);
        const siblings = children.get(parent);
        if (siblings) siblings.push(accumulated);
        else children.set(parent, [accumulated]);
      }
      parent = accumulated;
    }
  }

  // Sorted so a category's position among its siblings — and so its shade —
  // does not depend on the order events happened to load in.
  for (const siblings of children.values()) siblings.sort();
  return children;
}

/**
 * Work out the colour of every known category in one pass.
 *
 * Returns a plain map of path → colour, covering the given paths and every
 * ancestor they imply. Paths that aren't in it — a category being typed into
 * the event form, say — fall back to `resolveCategoryColor`.
 */
export function buildCategoryColorMap(
  paths: readonly string[],
  explicit: Readonly<Record<string, string>>,
  palette: readonly string[] = CATEGORY_PALETTE,
  /** Root colours already settled by `seedRootColors`; seeded here if absent. */
  rootColors?: ReadonlyMap<string, string>,
): Record<string, string> {
  const children = indexByParent(paths);
  const roots = children.get('') ?? [];
  const out: Record<string, string> = {};

  const seeded = rootColors ?? seedRootColors(roots, explicit, palette);
  for (const root of roots) {
    out[root] = seeded.get(root) ?? claimRootColor(root, new Map(seeded), palette);
  }

  const walk = (parent: string, parentColor: string, rootColor: string, depth: number) => {
    const kids = children.get(parent);
    if (!kids?.length) return;

    // Children the user coloured by hand keep that colour and sit outside the
    // even spread, so they don't push their siblings' shades around.
    const derived = kids.filter(path => !explicit[path]);
    derived.forEach((path, index) => {
      out[path] = deriveChildColor(parentColor, {
        index,
        count: derived.length,
        depth,
        root: rootColor,
      });
    });

    for (const path of kids) {
      const chosen = explicit[path];
      if (chosen) out[path] = chosen;
      // A hand-picked colour starts a family of its own: its descendants are
      // measured from it, rather than from the root it was pulled out of.
      if (chosen) walk(path, chosen, chosen, 1);
      else walk(path, out[path], rootColor, depth + 1);
    }
  };

  for (const root of roots) {
    walk(root, out[root], out[root], 1);
  }

  return out;
}

/**
 * Resolve the colour for a category path on its own.
 *
 * `buildCategoryColorMap` is the real scheme; this is the fallback for a path
 * that isn't in it yet. It follows the same rules, but with no view of the
 * siblings it has to guess at the spread, so the shade can shift slightly once
 * the category is known.
 *
 * Order: an explicit colour for the exact path wins; otherwise the nearest
 * ancestor that has one is shaded down to this depth; otherwise the whole
 * family is seeded from the root so a tree that was never coloured by hand
 * still comes out internally consistent.
 *
 * `explicit` is not mutated — callers decide whether to cache the result.
 */
export function resolveCategoryColor(
  path: string,
  explicit: Readonly<Record<string, string>>,
  palette: readonly string[] = CATEGORY_PALETTE,
  /** Pre-assigned root colours; without it, roots fall back to a plain hash. */
  rootColors?: ReadonlyMap<string, string>,
): string {
  if (!path) return UNCATEGORIZED_COLOR;

  const exact = explicit[path];
  if (exact) return exact;

  const segments = path.split(CATEGORY_SEP).map(s => s.trim()).filter(Boolean);
  if (!segments.length) return UNCATEGORIZED_COLOR;

  // Stand-in for "which sibling is this": spreading the guess over a handful
  // of slots keeps two unknown children of the same parent usually distinct.
  const leaf = segments[segments.length - 1];
  const guess = { index: hashString(leaf) % 6, count: 6 };

  // Walk up looking for the nearest ancestor with a colour of its own.
  for (let depth = 1; depth < segments.length; depth++) {
    const ancestorPath = segments.slice(0, segments.length - depth).join(CATEGORY_SEP);
    const ancestor = explicit[ancestorPath];
    if (ancestor) return deriveChildColor(ancestor, { ...guess, depth, root: ancestor });
  }

  // Nothing above it is coloured — seed from the root so the family matches.
  const root = segments[0];
  const seeded = rootColors?.get(root)
    ?? (palette.length ? palette[hashString(root) % palette.length] : UNCATEGORIZED_COLOR);
  if (segments.length === 1) return seeded;
  return deriveChildColor(seeded, { ...guess, depth: segments.length - 1, root: seeded });
}
