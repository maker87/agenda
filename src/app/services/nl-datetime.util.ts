/**
 * Natural-language date and time parsing.
 *
 * Pure functions, no Angular dependencies and no clock of their own — every
 * entry point takes the "now" to resolve against. That keeps them testable and
 * lets the same code run in the browser (the landing-page sandbox) and later
 * inside the Bedrock Lambda, where "today" arrives as a string from the caller.
 *
 * Dates are returned as "YYYY-MM-DD" and times as 24-hour "HH:MM", matching the
 * shapes CalendarEvent already stores.
 */

/** The canonical event categories the scheduler understands. */
export const EVENT_CATEGORIES = ['Work', 'Personal', 'Health', 'Social', 'Finance'] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export interface ParsedDateTime {
  /** "YYYY-MM-DD", or null when the text named no day. */
  date: string | null;
  /** 24-hour "HH:MM", or null when the text named no time. */
  startTime: string | null;
  /** True when the phrasing was a vague part of the day ("this weekend"). */
  approximate: boolean;
}

const WEEKDAYS = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];

/** Local "YYYY-MM-DD" for a Date — never toISOString(), which shifts by timezone. */
export function toDateKey(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** "HH:MM" for a count of minutes since midnight, wrapping at 24h. */
export function minutesToTime(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const h = String(Math.floor(wrapped / 60)).padStart(2, '0');
  const m = String(wrapped % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/** Minutes since midnight for a 24-hour "HH:MM", or null if it isn't one. */
export function timeToMinutes(time: string): number | null {
  const parts = /^(\d{1,2}):([0-5]\d)$/.exec(time ?? '');
  if (!parts) return null;
  const h = Number(parts[1]);
  if (h > 23) return null;
  return h * 60 + Number(parts[2]);
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Days forward from `from` to the next named weekday.
 *
 * `includeToday` is what separates "this Friday" (today counts, if today is
 * Friday) from "next Friday", which always means the Friday of the week after
 * the one we are in.
 */
function daysUntilWeekday(from: Date, weekday: number, includeToday: boolean): number {
  const diff = (weekday - from.getDay() + 7) % 7;
  if (diff === 0) return includeToday ? 0 : 7;
  return diff;
}

/**
 * Resolve a day reference inside `text`.
 *
 * Handles "today", "tomorrow", "tonight", "the day after tomorrow", bare and
 * "next"/"this"-qualified weekday names, "in N days/weeks", "this weekend", and
 * explicit "YYYY-MM-DD". Returns null when the text names no day at all, so the
 * caller can apply its own default rather than being handed a wrong guess.
 */
export function parseRelativeDate(text: string, now: Date): { date: string; approximate: boolean } | null {
  const s = text.toLowerCase();

  const explicit = /\b(\d{4}-\d{2}-\d{2})\b/.exec(s);
  if (explicit) return { date: explicit[1], approximate: false };

  // Checked before "tomorrow" so the longer phrase wins the match.
  if (/\bday after tomorrow\b/.test(s)) return { date: toDateKey(addDays(now, 2)), approximate: false };
  if (/\btomorrow\b/.test(s)) return { date: toDateKey(addDays(now, 1)), approximate: false };
  if (/\b(today|tonight|this morning|this afternoon|this evening|later today)\b/.test(s)) {
    return { date: toDateKey(now), approximate: /later today/.test(s) };
  }

  const inDays = /\bin (\d+) (day|days|week|weeks)\b/.exec(s);
  if (inDays) {
    const n = Number(inDays[1]) * (inDays[2].startsWith('week') ? 7 : 1);
    return { date: toDateKey(addDays(now, n)), approximate: false };
  }

  // "this weekend" lands on Saturday — the first weekend day still ahead.
  if (/\b(this |next )?weekend\b/.test(s)) {
    const saturday = daysUntilWeekday(now, 6, true);
    const offset = /next weekend/.test(s) ? saturday + 7 : saturday;
    return { date: toDateKey(addDays(now, offset)), approximate: true };
  }

  for (let i = 0; i < WEEKDAYS.length; i++) {
    const name = WEEKDAYS[i];
    const pattern = new RegExp(`\\b(next |this |on |coming )?${name}\\b`);
    const hit = pattern.exec(s);
    if (!hit) continue;
    const qualifier = (hit[1] ?? '').trim();
    if (qualifier === 'next') {
      // "next Friday" = the Friday of the following week, not the nearest one.
      return { date: toDateKey(addDays(now, daysUntilWeekday(now, i, false) + 7)), approximate: false };
    }
    return { date: toDateKey(addDays(now, daysUntilWeekday(now, i, false))), approximate: false };
  }

  return null;
}

/**
 * Resolve a clock time inside `text`.
 *
 * Handles "3pm", "3:30 pm", "15:00", "noon"/"midnight", and the vague parts of
 * the day ("this morning", "tonight"), which resolve to a sensible hour and are
 * reported as approximate so the caller can surface them as a suggestion rather
 * than a decision.
 */
export function parseTimeOfDay(text: string): { startTime: string; approximate: boolean } | null {
  const s = text.toLowerCase();

  if (/\bnoon|midday\b/.test(s)) return { startTime: '12:00', approximate: false };
  if (/\bmidnight\b/.test(s)) return { startTime: '00:00', approximate: false };

  // "at 3", "3pm", "3:30pm", "15:00" — the meridiem is optional, and so is the
  // "at", but one of them has to be there or a bare number like "2 reminders"
  // would read as a time.
  const explicit = /\b(?:at\s+)?(\d{1,2})(?::([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)?\b/.exec(s);
  if (explicit) {
    const hasMeridiem = !!explicit[3];
    const hasMinutes = explicit[2] !== undefined;
    const saidAt = /\bat\s+\d/.test(s);
    if (hasMeridiem || hasMinutes || saidAt) {
      let hour = Number(explicit[1]);
      const minute = explicit[2] ?? '00';
      if (hasMeridiem) {
        const pm = explicit[3]!.startsWith('p');
        if (hour < 1 || hour > 12) return null;
        hour = (hour % 12) + (pm ? 12 : 0);
      } else if (hour > 23) {
        return null;
      }
      return { startTime: `${String(hour).padStart(2, '0')}:${minute}`, approximate: false };
    }
  }

  // Vague parts of the day, resolved to the middle of each range.
  if (/\b(this morning|morning)\b/.test(s)) return { startTime: '09:00', approximate: true };
  if (/\b(this afternoon|afternoon)\b/.test(s)) return { startTime: '14:00', approximate: true };
  if (/\b(this evening|evening|tonight)\b/.test(s)) return { startTime: '19:00', approximate: true };
  if (/\blater today\b/.test(s)) return { startTime: '16:00', approximate: true };

  return null;
}

/** Resolve both halves at once. */
export function parseDateTime(text: string, now: Date): ParsedDateTime {
  const day = parseRelativeDate(text, now);
  const time = parseTimeOfDay(text);
  return {
    date: day?.date ?? null,
    startTime: time?.startTime ?? null,
    approximate: !!day?.approximate || !!time?.approximate,
  };
}

/** An explicit duration ("for 45 minutes", "2 hours"), in minutes. */
export function parseDuration(text: string): number | null {
  const s = text.toLowerCase();
  const m = /\b(?:for\s+)?(\d+(?:\.\d+)?)\s*(min|mins|minute|minutes|h|hr|hrs|hour|hours)\b/.exec(s);
  if (!m) return null;
  const value = Number(m[1]);
  const minutes = m[2].startsWith('h') ? value * 60 : value;
  return minutes > 0 && minutes <= 24 * 60 ? Math.round(minutes) : null;
}

/** Keyword mapping onto the canonical categories, defaulting to Personal. */
const CATEGORY_HINTS: ReadonlyArray<readonly [EventCategory, RegExp]> = [
  ['Health', /\b(gym|workout|run|running|yoga|doctor|dentist|therapy|checkup|training)\b/],
  ['Finance', /\b(invoice|budget|tax|taxes|payroll|bank|accountant|billing|expenses)\b/],
  ['Work', /\b(meeting|standup|stand-up|sync|review|1:1|one-on-one|client|interview|deadline|sprint|deep work|presentation)\b/],
  ['Social', /\b(coffee|lunch|dinner|drinks|party|birthday|brunch|catch up|catch-up|date night)\b/],
];

export function inferCategory(text: string): EventCategory {
  const s = text.toLowerCase();
  for (const [category, pattern] of CATEGORY_HINTS) {
    if (pattern.test(s)) return category;
  }
  return 'Personal';
}

/**
 * Strip the scheduling scaffolding out of a phrase so what remains reads as a
 * title: "schedule coffee with Sam tomorrow at 3pm" -> "Coffee with Sam".
 */
export function extractTitle(text: string): string {
  let s = ` ${text.trim()} `;

  // Order matters: each pattern must be given its chance before a broader one
  // can eat part of the phrase it was meant to match. "for 1 hour" has to be
  // removed whole, or the generic preposition rule takes "for 1" and strands
  // the word "hour" in the title.
  const noise: RegExp[] = [
    /\b(please|can you|could you|i want to|i need to|let's|lets)\b/gi,
    /\b(schedule|book|add|create|set up|set-up|setup|put|plan|make)\b/gi,
    /\b(a|an|the)\s+(?=(meeting|call|event|reminder)\b)/gi,
    // Durations and explicit clock times — the most specific shapes.
    /\b(?:for\s+)?\d+(?:\.\d+)?\s*(min|mins|minute|minutes|h|hr|hrs|hour|hours)\b/gi,
    /\b(?:at\s+)?\d{1,2}(?::[0-5]\d)?\s*(am|pm|a\.m\.|p\.m\.)\b/gi,
    /\bat\s+\d{1,2}(?::[0-5]\d)?\b/gi,
    /\b(noon|midday|midnight)\b/gi,
    // Whatever preposition-plus-number is left over.
    /\b(on|at|for|from|to|next|this|coming|in)\s+\d[\w:.]*\s*(am|pm)?/gi,
    /\b(today|tonight|tomorrow|day after tomorrow|this morning|this afternoon|this evening|later today|weekend|this weekend|next weekend)\b/gi,
    new RegExp(`\\b(next |this |on |coming )?(${WEEKDAYS.join('|')})\\b`, 'gi'),
  ];
  for (const pattern of noise) s = s.replace(pattern, ' ');

  s = s.replace(/\s+/g, ' ').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '');
  if (!s) return 'New event';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
