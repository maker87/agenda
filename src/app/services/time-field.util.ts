/**
 * Times while they are being typed or picked.
 *
 * Events always store 24-hour "HH:MM". Everything here is about the shape the
 * input shows on the way in and out of that, so the same rules apply wherever a
 * time is entered — the event form, the reschedule step and the conflict step.
 *
 * Pure functions with the clock format passed in, so they can be tested without
 * a locale or a component.
 */

export type Meridiem = 'AM' | 'PM';

/**
 * On a 12-hour clock `text` is the clock part ("9:30") and `meridiem` is the
 * half of the day; on a 24-hour clock `text` is the whole value and `meridiem`
 * is unused.
 */
export interface TimeField {
  text: string;
  meridiem: Meridiem;
}

/** One entry in the time dropdown. */
export interface TimeOption {
  /** 24-hour "HH:MM" — what gets stored. */
  value: string;
  /** How it reads on this locale's clock, e.g. "9:30 AM" or "09:30". */
  label: string;
}

// A trailing half-of-day marker, however it gets typed: "pm", "PM", "p.m.", "p".
const MERIDIEM_SUFFIX = /\s*([ap])\.?\s*m?\.?$/i;

// An hour, then optionally minutes — separated by ":", "." or nothing at all,
// so "9", "9:30", "9.30" and "930" all land on the same time.
const TYPED_TIME = /^(\d{1,2})(?:[:. ]?([0-5]\d))?$/;

// A stored time: 24-hour "HH:MM", the only shape events are ever saved in.
const STORED_TIME = /^(\d{1,2}):([0-5]\d)$/;

export function emptyTimeField(): TimeField {
  return { text: '', meridiem: 'AM' };
}

/** Split a stored 24-hour "HH:MM" into the shape the input shows. */
export function toTimeField(hhmm: string, twelveHour: boolean): TimeField {
  const parts = STORED_TIME.exec(hhmm ?? '');
  if (!parts) return emptyTimeField();
  const hour = Number(parts[1]);
  if (hour > 23) return emptyTimeField();

  const meridiem: Meridiem = hour < 12 ? 'AM' : 'PM';
  if (!twelveHour) return { text: `${String(hour).padStart(2, '0')}:${parts[2]}`, meridiem };
  return { text: `${hour % 12 === 0 ? 12 : hour % 12}:${parts[2]}`, meridiem };
}

/**
 * Reshape a time as it is being typed, so the colon appears on its own and
 * digits are all anyone has to enter: "930" becomes "9:30", "0930" becomes
 * "09:30". Text that is not a bare clock time — a typed "pm", say — is handed
 * back untouched, for parseTimeField to make sense of on the way out.
 */
export function formatTypedTime(raw: string): string {
  const text = raw ?? '';
  if (/[^\d:.\s]/.test(text)) return text;

  const separator = text.search(/[:.]/);
  if (separator >= 0) {
    // The user placed the split themselves; leave it exactly where they put it.
    const hh = text.slice(0, separator).replace(/\D/g, '').slice(0, 2);
    const mm = text.slice(separator + 1).replace(/\D/g, '').slice(0, 2);
    return `${hh}:${mm}`;
  }

  const digits = text.replace(/\D/g, '').slice(0, 4);
  // Under three digits there is no telling the hour from the minutes yet, so
  // leave the keystrokes alone rather than have the colon jump around.
  if (digits.length < 3) return digits;
  return `${digits.slice(0, digits.length - 2)}:${digits.slice(-2)}`;
}

/**
 * Read a typed time back as 24-hour "HH:MM", or null if it isn't a time.
 *
 * A marker typed into the text itself outranks the AM/PM toggle, so "9:30pm"
 * means half past nine in the evening even while the toggle still says AM. On a
 * 12-hour clock an hour past 12 is read as the 24-hour time it can only be, so
 * someone who types "14:00" out of habit still gets 2 PM rather than an error.
 */
export function parseTimeField(field: TimeField, twelveHour: boolean): string | null {
  let text = (field.text ?? '').trim();
  if (!text) return null;

  const suffix = MERIDIEM_SUFFIX.exec(text);
  let meridiem: Meridiem | null = null;
  if (suffix) {
    meridiem = suffix[1].toUpperCase() === 'P' ? 'PM' : 'AM';
    text = text.slice(0, suffix.index).trim();
  }

  const parts = TYPED_TIME.exec(text);
  if (!parts) return null;
  let hour = Number(parts[1]);
  const minute = parts[2] ?? '00';

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === 'PM' ? 12 : 0);
  } else if (twelveHour && hour >= 1 && hour <= 12) {
    hour = (hour % 12) + (field.meridiem === 'PM' ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }

  return `${String(hour).padStart(2, '0')}:${minute}`;
}

/** True when this locale writes times on a 12-hour clock (9:30 PM). */
export function isTwelveHourLocale(locale: string): boolean {
  try {
    return new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hour12 ?? false;
  } catch {
    return false;
  }
}

/** The locale's own word for a half of the day ("PM", "p. m.", "오후"). */
export function meridiemLabelFor(locale: string, meridiem: Meridiem): string {
  const hour = meridiem === 'AM' ? 9 : 21;
  try {
    const parts = new Intl.DateTimeFormat(locale, { hour: 'numeric', hour12: true })
      .formatToParts(new Date(2000, 0, 1, hour, 0));
    return parts.find(p => p.type === 'dayPeriod')?.value ?? meridiem;
  } catch {
    return meridiem;
  }
}

/** A stored "HH:MM" written the way this locale reads times. */
export function formatStoredTime(hhmm: string, locale: string): string {
  const parts = STORED_TIME.exec(hhmm ?? '');
  if (!parts) return hhmm ?? '';
  const date = new Date(2000, 0, 1, Number(parts[1]), Number(parts[2]));
  try {
    return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date);
  } catch {
    return hhmm;
  }
}

/**
 * Every time of day at `stepMinutes` intervals, for the dropdown.
 *
 * Built once per locale rather than per keystroke — the list is the same
 * whatever is typed, and filtering happens over it.
 */
export function buildTimeOptions(locale: string, stepMinutes = 30): TimeOption[] {
  const step = stepMinutes > 0 ? stepMinutes : 30;
  const options: TimeOption[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += step) {
    const value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    options.push({ value, label: formatStoredTime(value, locale) });
  }
  return options;
}

/**
 * Narrow the dropdown to what has been typed so far.
 *
 * Matching is on the digits alone, so "9" offers every nine o'clock on either
 * half of the day and "930" narrows to half past. Typed text that isn't digits
 * falls back to matching the visible label, which is what makes "pm" work.
 */
export function filterTimeOptions(options: readonly TimeOption[], typed: string): TimeOption[] {
  const text = (typed ?? '').trim().toLowerCase();
  if (!text) return [...options];

  const digits = text.replace(/\D/g, '');
  if (digits) {
    const matches = options.filter(o => o.value.replace(':', '').startsWith(digits)
      || o.label.toLowerCase().replace(/[^\d]/g, '').startsWith(digits));
    if (matches.length) return matches;
  }

  const byLabel = options.filter(o => o.label.toLowerCase().includes(text));
  // An empty result would read as "no such time"; showing everything is the
  // more useful answer while someone is still mid-word.
  return byLabel.length ? byLabel : [...options];
}
