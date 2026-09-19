/**
 * Turning a spoken day selection into concrete dates.
 *
 * "Monday to Friday" means five events, one per weekday — not one event that
 * starts on Monday and ends on Friday. This module is the single place that
 * decides which days a phrase covers and how far the pattern repeats, so the
 * local chat parser, the Bedrock action handler and the dashboard all agree.
 *
 * Pure functions with the reference date passed in, mirroring nl-datetime.util.
 */

/** Day-of-week numbers, matching Date.getDay(): 0 = Sunday. */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface Recurrence {
  /**
   * Days the event lands on, in the order the week should be walked. The first
   * entry anchors the pattern — for "Friday to Monday" that is Friday, so the
   * run wraps across the weekend instead of jumping backwards.
   */
  daysOfWeek: number[];
  /** How many weeks the pattern repeats for. */
  weeks: number;
  /** True when the user stated a span ("for 3 weeks") rather than defaulting. */
  explicitSpan: boolean;
  /**
   * True when the phrase asks for something repeating ("every Monday",
   * "daily") rather than naming days once. A single day that isn't ongoing —
   * "lunch on Monday" — is an ordinary one-off event, and callers should let
   * their normal date parsing handle it instead of treating it as a pattern.
   */
  ongoing: boolean;
}

const DAY_WORDS: Record<string, number> = {
  sunday: 0, sun: 0, sundays: 0,
  monday: 1, mon: 1, mondays: 1,
  tuesday: 2, tue: 2, tues: 2, tuesdays: 2,
  wednesday: 3, wed: 3, weds: 3, wednesdays: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, thursdays: 4,
  friday: 5, fri: 5, fridays: 5,
  saturday: 6, sat: 6, saturdays: 6,
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Matches any day word, longest alternatives first so "tues" beats "tue". */
const DAY_PATTERN = Object.keys(DAY_WORDS)
  .sort((a, b) => b.length - a.length)
  .join('|');

/**
 * Safety ceilings. "However long the user asks" is honoured up to a year, but
 * a single request should never be able to spawn an unbounded write storm.
 */
export const MAX_WEEKS = 52;
export const MAX_OCCURRENCES = 366;

/** Local "YYYY-MM-DD". Never toISOString(), which shifts the day in UTC+ zones. */
export function toLocalDateKey(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Inclusive run of weekdays from `start` to `end`, wrapping past Saturday. */
function dayRange(start: number, end: number): number[] {
  const days: number[] = [start];
  let cursor = start;
  // Bounded by 7 so a malformed range can't loop forever.
  for (let i = 0; i < 7 && cursor !== end; i++) {
    cursor = (cursor + 1) % 7;
    days.push(cursor);
  }
  return days;
}

/**
 * How many weeks a phrase asks for, or null when it doesn't say.
 *
 * Months are treated as four weeks, which is what people mean by "for a month"
 * when they're talking about a weekly pattern.
 */
export function parseSpanWeeks(text: string): number | null {
  const s = text.toLowerCase();

  const numeric = /\bfor\s+(\d+)\s*(day|days|week|weeks|month|months)\b/.exec(s);
  if (numeric) {
    const n = Number(numeric[1]);
    const unit = numeric[2];
    if (unit.startsWith('day')) return Math.max(1, Math.ceil(n / 7));
    if (unit.startsWith('month')) return n * 4;
    return n;
  }

  // "for a week", "for the next two months"
  const worded = /\bfor\s+(?:a|an|the\s+next\s+)?\s*(one|two|three|four|five|six)?\s*(week|month)s?\b/.exec(s);
  if (worded) {
    const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    const n = worded[1] ? words[worded[1]] : 1;
    return worded[2] === 'month' ? n * 4 : n;
  }

  return null;
}

/**
 * Read a day selection out of a sentence.
 *
 * Understands ranges ("monday to friday", "mon-fri", "monday through friday"),
 * shorthands ("weekdays", "every weekend"), lists ("monday and wednesday",
 * "mon, wed, fri") and the single-day recurring form ("every Tuesday").
 *
 * Returns null when no day is named, so the caller can fall back to its own
 * date parsing rather than being handed an invented pattern.
 */
export function parseRecurrence(text: string): Recurrence | null {
  const s = text.toLowerCase();
  // "every"/"each" means an ongoing pattern; a bare range is a one-off span.
  const isOngoing = /\b(every|each|weekly|recurring)\b/.test(s);

  let daysOfWeek: number[] | null = null;

  // Range: "monday to friday", "mon - fri", "monday through friday".
  const range = new RegExp(`\\b(${DAY_PATTERN})\\s*(?:to|through|thru|till|until|-|–|—)\\s*(${DAY_PATTERN})\\b`).exec(s);
  if (range) {
    daysOfWeek = dayRange(DAY_WORDS[range[1]], DAY_WORDS[range[2]]);
  }

  // Shorthands, checked before the list form so "weekdays" isn't missed.
  if (!daysOfWeek && /\b(week ?days?|working days|business days)\b/.test(s)) {
    daysOfWeek = [1, 2, 3, 4, 5];
  }
  if (!daysOfWeek && /\bweek ?ends?\b/.test(s)) {
    daysOfWeek = [6, 0];
  }
  if (!daysOfWeek && /\b(every|each)\s+day\b|\bdaily\b/.test(s)) {
    daysOfWeek = [1, 2, 3, 4, 5, 6, 0];
  }

  // List: "monday and wednesday", "mon, wed and fri".
  if (!daysOfWeek) {
    const found: number[] = [];
    const matcher = new RegExp(`\\b(${DAY_PATTERN})\\b`, 'g');
    let hit: RegExpExecArray | null;
    while ((hit = matcher.exec(s)) !== null) {
      const day = DAY_WORDS[hit[1]];
      if (!found.includes(day)) found.push(day);
    }
    if (found.length) daysOfWeek = found;
  }

  if (!daysOfWeek || !daysOfWeek.length) return null;

  const explicit = parseSpanWeeks(text);
  // A named span always wins. Otherwise "every Monday" keeps its open-ended
  // 12-week default, while a plain range covers just the week it describes.
  const weeks = explicit ?? (isOngoing ? 12 : 1);

  return {
    daysOfWeek,
    weeks: Math.min(Math.max(1, weeks), MAX_WEEKS),
    explicitSpan: explicit !== null,
    ongoing: isOngoing,
  };
}

/** Days forward from `from` to `weekday`, counting today as zero. */
function daysUntil(from: Date, weekday: number): number {
  return (weekday - from.getDay() + 7) % 7;
}

/**
 * Concrete dates for a pattern, as "YYYY-MM-DD".
 *
 * The run is anchored to the next occurrence of the first day in the selection
 * and every other day is placed relative to it, so a Monday-to-Friday request
 * made on a Wednesday yields a clean Mon–Fri week rather than a partial one
 * starting mid-range.
 */
export function expandRecurrence(
  daysOfWeek: readonly number[],
  weeks: number,
  from: Date,
): string[] {
  if (!daysOfWeek.length || weeks < 1) return [];

  const anchorDay = daysOfWeek[0];
  const anchor = new Date(from);
  anchor.setHours(0, 0, 0, 0);
  anchor.setDate(anchor.getDate() + daysUntil(anchor, anchorDay));

  // Offset of each day from the anchor, so a wrapping range stays in order.
  const offsets = daysOfWeek.map(d => (d - anchorDay + 7) % 7);

  const dates: string[] = [];
  for (let week = 0; week < weeks; week++) {
    for (const offset of offsets) {
      if (dates.length >= MAX_OCCURRENCES) return dates;
      const date = new Date(anchor);
      date.setDate(date.getDate() + week * 7 + offset);
      dates.push(toLocalDateKey(date));
    }
  }
  return dates;
}

/** "Monday", or "Monday–Friday" / "Monday, Wednesday and Friday" for a set. */
export function describeDays(daysOfWeek: readonly number[]): string {
  if (!daysOfWeek.length) return '';
  if (daysOfWeek.length === 1) return DAY_NAMES[daysOfWeek[0]];

  // Contiguous runs read better as a range than as a list.
  const isRun = daysOfWeek.every(
    (d, i) => i === 0 || d === (daysOfWeek[i - 1] + 1) % 7,
  );
  if (isRun && daysOfWeek.length > 2) {
    return `${DAY_NAMES[daysOfWeek[0]]}–${DAY_NAMES[daysOfWeek[daysOfWeek.length - 1]]}`;
  }

  const names = daysOfWeek.map(d => DAY_NAMES[d]);
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
