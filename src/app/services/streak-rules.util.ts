/**
 * The rules for when a streak day counts, shared by the dashboard, the
 * assistant and anything else that logs a value. Pure functions on dates as
 * YYYY-MM-DD strings, so they can be tested without the app.
 */

/** "atLeast": reach the target (read 20 pages). "atMost": stay at or under it (≤ 2 coffees). */
export type StreakGoalType = 'atLeast' | 'atMost';

export interface StreakRuleFields {
  target: number;
  goalType?: StreakGoalType;
  /** Weekdays that count, 0 = Sunday … 6 = Saturday. Empty or absent means every day. */
  activeDays?: number[];
}

/** Weekday of a YYYY-MM-DD date. Read in UTC so it never shifts with the time zone. */
export function weekdayOf(dateStr: string): number {
  return new Date(dateStr + 'T00:00:00Z').getUTCDay();
}

/** Whether the streak is scheduled on this date. Days off can't break it. */
export function isActiveDay(activeDays: number[] | undefined, dateStr: string): boolean {
  if (!activeDays || activeDays.length === 0 || activeDays.length >= 7) return true;
  return activeDays.includes(weekdayOf(dateStr));
}

/**
 * Whether a logged value completes the day. For "at most" a logged 0 is a
 * success, which is why callers only ask once a value has actually been logged.
 */
export function isDayMet(streak: StreakRuleFields, value: number): boolean {
  return streak.goalType === 'atMost' ? value <= streak.target : value >= streak.target;
}

function previousDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Consecutive completed days ending today (or yesterday, while today is still
 * open). Days the streak isn't scheduled on are stepped over without breaking
 * it; doing the habit on one anyway still adds to the count.
 */
export function computeStreakCount(checkedDays: string[], activeDays: number[] | undefined, today: string): number {
  if (checkedDays.length === 0) return 0;
  const done = new Set(checkedDays);
  const earliest = [...checkedDays].sort()[0];
  let cursor = done.has(today) ? today : previousDay(today);
  let count = 0;
  while (cursor >= earliest) {
    if (done.has(cursor)) count++;
    else if (isActiveDay(activeDays, cursor)) break;
    cursor = previousDay(cursor);
  }
  return count;
}

/** Scheduled days from `from` to `to`, both included. Used to spread a total over a deadline. */
export function countActiveDays(from: string, to: string, activeDays: number[] | undefined): number {
  let n = 0;
  for (let d = to; d >= from; d = previousDay(d)) if (isActiveDay(activeDays, d)) n++;
  return n;
}
