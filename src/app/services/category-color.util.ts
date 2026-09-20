/**
 * Category colours, and how sub-categories inherit them.
 *
 * A category's colour is the single source of truth for everything filed under
 * it — events don't carry their own. A sub-category inherits its parent's
 * colour as a lighter shade, so "Work > Meetings" reads as a kind of Work at a
 * glance instead of an unrelated colour, while still being distinguishable
 * from its siblings.
 *
 * Pure functions, no Angular, so the resolution rules can be tested directly.
 */

import { CATEGORY_SEP } from './category-tree.service';

/** Shown for anything with no category at all. */
export const UNCATEGORIZED_COLOR = '#64748b';

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

/**
 * A child shade of `base`.
 *
 * Lightness steps up with each level so depth is visible, and the hue nudges a
 * few degrees either side based on the child's own name so that two children of
 * the same parent don't come out identical. The nudge is deliberately small —
 * the family resemblance matters more than telling siblings apart by colour,
 * which the label already does.
 */
export function deriveChildColor(base: string, childName: string, depth: number): string {
  const hsl = hexToHsl(base);
  if (!hsl) return base;

  // Lighten toward (not to) white, so even deep nesting stays legible.
  const lightened = hsl.l + (1 - hsl.l) * Math.min(0.18 * depth, 0.45);
  // ±10° of hue, so siblings separate without drifting into another family.
  const nudge = ((hashString(childName) % 21) - 10);

  return hslToHex({
    h: hsl.h + nudge,
    // Pull saturation down slightly with depth so parents stay the boldest.
    s: hsl.s * Math.max(0.6, 1 - 0.1 * depth),
    l: Math.min(lightened, 0.78),
  });
}

/**
 * Resolve the colour for a category path.
 *
 * Order: an explicit colour for the exact path wins; otherwise the nearest
 * ancestor that has one is shaded down to this depth; otherwise the whole
 * family is seeded from the root's name so a tree that was never coloured by
 * hand still comes out internally consistent.
 *
 * `explicit` is not mutated — callers decide whether to cache the result.
 */
export function resolveCategoryColor(
  path: string,
  explicit: Readonly<Record<string, string>>,
  palette: readonly string[],
): string {
  if (!path) return UNCATEGORIZED_COLOR;

  const exact = explicit[path];
  if (exact) return exact;

  const segments = path.split(CATEGORY_SEP).map(s => s.trim()).filter(Boolean);
  if (!segments.length) return UNCATEGORIZED_COLOR;

  // Walk up looking for the nearest ancestor with a colour of its own.
  for (let depth = 1; depth < segments.length; depth++) {
    const ancestorPath = segments.slice(0, segments.length - depth).join(CATEGORY_SEP);
    const ancestor = explicit[ancestorPath];
    if (ancestor) {
      return deriveChildColor(ancestor, segments[segments.length - 1], depth);
    }
  }

  // Nothing above it is coloured — seed from the root so the family matches.
  const root = segments[0];
  const seeded = palette.length ? palette[hashString(root) % palette.length] : UNCATEGORIZED_COLOR;
  if (segments.length === 1) return seeded;
  return deriveChildColor(seeded, segments[segments.length - 1], segments.length - 1);
}
