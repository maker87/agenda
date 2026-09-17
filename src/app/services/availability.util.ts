/**
 * Availability maths: merging busy blocks, detecting conflicts, and proposing
 * open slots inside a user's working hours.
 *
 * Pure functions over minutes-since-midnight, with no knowledge of where the
 * busy blocks came from. That is deliberate — the landing-page sandbox feeds
 * them from mock state today, and a multi-calendar aggregator can feed them
 * from several connected accounts later without changing anything here.
 */

import { minutesToTime, timeToMinutes } from './nl-datetime.util';

/** A span of time on a single day, as minutes since midnight. */
export interface BusyBlock {
  start: number;
  end: number;
  /** What occupies the span, for explaining a conflict back to the user. */
  label?: string;
}

export interface Slot {
  start: number;
  end: number;
}

export interface WorkingHours {
  /** Minutes since midnight. */
  start: number;
  end: number;
}

/** Build a BusyBlock from the "HH:MM" strings events are stored with. */
export function toBusyBlock(startTime: string, endTime: string, label?: string): BusyBlock | null {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start === null || end === null || end <= start) return null;
  return { start, end, label };
}

/**
 * Collapse overlapping and touching blocks into a minimal set.
 *
 * Merging first means a slot search never has to reason about two calendars
 * that happen to describe the same meeting, or a block that abuts another.
 */
export function mergeBusyBlocks(blocks: readonly BusyBlock[]): BusyBlock[] {
  const sorted = [...blocks].filter(b => b.end > b.start).sort((a, b) => a.start - b.start);
  const merged: BusyBlock[] = [];

  for (const block of sorted) {
    const last = merged[merged.length - 1];
    if (last && block.start <= last.end) {
      // Keep the earlier label — it names the first thing occupying the span.
      last.end = Math.max(last.end, block.end);
    } else {
      merged.push({ ...block });
    }
  }
  return merged;
}

/** Every block the proposed span runs into. */
export function findConflicts(
  proposed: Slot,
  blocks: readonly BusyBlock[],
): BusyBlock[] {
  return blocks.filter(b => proposed.start < b.end && b.start < proposed.end);
}

/**
 * Open gaps inside working hours, once busy blocks and buffers are removed.
 *
 * `buffer` is applied around each busy block rather than to the day as a
 * whole, so back-to-back meetings still leave a real break rather than a slot
 * that starts the moment the previous one ends.
 */
export function findFreeSlots(
  blocks: readonly BusyBlock[],
  hours: WorkingHours,
  durationMinutes: number,
  buffer = 0,
): Slot[] {
  if (durationMinutes <= 0) return [];

  const padded = mergeBusyBlocks(
    blocks.map(b => ({ start: b.start - buffer, end: b.end + buffer, label: b.label })),
  );

  const free: Slot[] = [];
  let cursor = hours.start;

  for (const block of padded) {
    if (block.start > cursor) {
      const gapEnd = Math.min(block.start, hours.end);
      if (gapEnd - cursor >= durationMinutes) free.push({ start: cursor, end: gapEnd });
    }
    cursor = Math.max(cursor, block.end);
    if (cursor >= hours.end) break;
  }

  if (cursor < hours.end && hours.end - cursor >= durationMinutes) {
    free.push({ start: cursor, end: hours.end });
  }
  return free;
}

/**
 * Up to `count` concrete start times for a conflicting request.
 *
 * Candidates are drawn from the open gaps and ranked by how close they sit to
 * what was originally asked for, so the first suggestion is the smallest move
 * from the user's intent rather than simply the earliest opening.
 */
export function suggestAlternativeSlots(
  preferredStart: number,
  durationMinutes: number,
  blocks: readonly BusyBlock[],
  hours: WorkingHours,
  buffer = 0,
  count = 3,
): Slot[] {
  const gaps = findFreeSlots(blocks, hours, durationMinutes, buffer);
  const candidates: Slot[] = [];

  for (const gap of gaps) {
    // The point in this gap nearest the requested time, clamped so the whole
    // event still fits inside it.
    const latestStart = gap.end - durationMinutes;
    const start = Math.max(gap.start, Math.min(preferredStart, latestStart));
    candidates.push({ start, end: start + durationMinutes });

    // Offer the top of the gap too when it is a distinctly different option,
    // so a long opening yields more than one suggestion.
    if (start !== gap.start && gap.start + durationMinutes <= gap.end) {
      candidates.push({ start: gap.start, end: gap.start + durationMinutes });
    }
  }

  const seen = new Set<number>();
  return candidates
    .filter(c => (seen.has(c.start) ? false : (seen.add(c.start), true)))
    .sort((a, b) => Math.abs(a.start - preferredStart) - Math.abs(b.start - preferredStart))
    .slice(0, count);
}

/** "9:30 AM" / "09:30", following the viewer's locale. */
export function formatSlotTime(minutes: number, locale = 'en-US'): string {
  const date = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
  try {
    return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date);
  } catch {
    return minutesToTime(minutes);
  }
}

/** "9:30 AM – 10:00 AM". */
export function formatSlotRange(slot: Slot, locale = 'en-US'): string {
  return `${formatSlotTime(slot.start, locale)} – ${formatSlotTime(slot.end, locale)}`;
}
