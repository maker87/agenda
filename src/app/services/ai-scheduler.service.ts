import { Injectable } from '@angular/core';
import { CalendarEvent } from './events.service';

export interface AiSuggestion {
  date: string;       // YYYY-MM-DD
  startTime: string;  // HH:MM
  endTime: string;    // HH:MM
  reason: string;
}

// ── Title-based time-of-day preferences ──────────────────────────────────────
// Each entry maps keyword patterns to a preferred hour window [start, end)
const TIME_HINTS: { keywords: RegExp; label: string; preferHour: number; windowStart: number; windowEnd: number }[] = [
  { keywords: /gym|workout|exercise|run|jog|yoga|pilates|swim|cycling|crossfit|lift/i,
    label: 'morning workout', preferHour: 7, windowStart: 6, windowEnd: 10 },
  { keywords: /breakfast|morning coffee|standup|stand-up|daily sync/i,
    label: 'morning slot', preferHour: 8, windowStart: 7, windowEnd: 10 },
  { keywords: /lunch|midday|noon/i,
    label: 'lunch hour', preferHour: 12, windowStart: 11, windowEnd: 14 },
  { keywords: /dinner|supper|evening meal/i,
    label: 'evening slot', preferHour: 19, windowStart: 18, windowEnd: 21 },
  { keywords: /happy hour|drinks|bar|pub/i,
    label: 'after-work slot', preferHour: 18, windowStart: 17, windowEnd: 20 },
  { keywords: /sleep|nap|rest/i,
    label: 'rest time', preferHour: 22, windowStart: 21, windowEnd: 23 },
  { keywords: /study|homework|review|exam|test|quiz/i,
    label: 'study block', preferHour: 16, windowStart: 14, windowEnd: 20 },
  { keywords: /meeting|call|sync|interview|standup|1:1|one.on.one/i,
    label: 'work hours', preferHour: 10, windowStart: 9, windowEnd: 17 },
  { keywords: /doctor|dentist|appointment|checkup|therapy|clinic/i,
    label: 'morning appointment', preferHour: 9, windowStart: 8, windowEnd: 12 },
  { keywords: /walk|hike|outdoor|park|nature/i,
    label: 'outdoor time', preferHour: 9, windowStart: 7, windowEnd: 12 },
];

const DEFAULT_WINDOW = { label: 'work hours', windowStart: 9, windowEnd: 18, preferHour: 10 };
const BUFFER_MIN = 15; // minutes of breathing room around existing events

@Injectable({ providedIn: 'root' })
export class AiSchedulerService {

  /**
   * Pure local algorithm — no API key, no network call.
   * Finds the best available time slots for a new event.
   */
  getSuggestions(
    title: string,
    durationMin: number,
    events: CalendarEvent[],
    preferredDate?: string
  ): AiSuggestion[] {
    const today = new Date().toISOString().split('T')[0];
    const anchor = preferredDate ?? today;

    const hint = this.detectHint(title);
    const candidates = this.findCandidateSlots(events, anchor, durationMin, hint);

    return candidates.slice(0, 3);
  }

  // ── Hint detection ────────────────────────────────────────────────────────

  private detectHint(title: string) {
    for (const h of TIME_HINTS) {
      if (h.keywords.test(title)) return h;
    }
    return DEFAULT_WINDOW;
  }

  // ── Slot finder ───────────────────────────────────────────────────────────

  private findCandidateSlots(
    events: CalendarEvent[],
    anchor: string,
    durationMin: number,
    hint: typeof DEFAULT_WINDOW
  ): AiSuggestion[] {
    const results: AiSuggestion[] = [];
    const usedDates = new Set<string>();

    // Search up to 21 days ahead
    for (let dayOffset = 0; dayOffset < 21 && results.length < 3; dayOffset++) {
      const date = this.addDays(anchor, dayOffset);

      // Prefer spreading across different days
      if (usedDates.has(date)) continue;

      const dayEvents = events
        .filter(e => e.date === date)
        .map(e => ({ start: this.toMin(e.startTime), end: this.toMin(e.endTime) }))
        .sort((a, b) => a.start - b.start);

      const slot = this.bestSlotOnDay(dayEvents, durationMin, hint, date, anchor);
      if (slot) {
        results.push(slot);
        usedDates.add(date);
      }
    }

    // If we couldn't find 3 spread across days, allow same-day repeats
    if (results.length < 3) {
      for (let dayOffset = 0; dayOffset < 21 && results.length < 3; dayOffset++) {
        const date = this.addDays(anchor, dayOffset);
        if (usedDates.has(date)) continue; // already has one from this day

        const dayEvents = events
          .filter(e => e.date === date)
          .map(e => ({ start: this.toMin(e.startTime), end: this.toMin(e.endTime) }))
          .sort((a, b) => a.start - b.start);

        // Try secondary slots on the same day
        const slots = this.allSlotsOnDay(dayEvents, durationMin, hint, date, anchor);
        for (const s of slots) {
          if (results.length >= 3) break;
          const alreadyUsed = results.some(r => r.date === s.date && r.startTime === s.startTime);
          if (!alreadyUsed) results.push(s);
        }
      }
    }

    return results;
  }

  private bestSlotOnDay(
    dayEvents: { start: number; end: number }[],
    durationMin: number,
    hint: typeof DEFAULT_WINDOW,
    date: string,
    anchor: string
  ): AiSuggestion | null {
    const slots = this.allSlotsOnDay(dayEvents, durationMin, hint, date, anchor);
    return slots[0] ?? null;
  }

  private allSlotsOnDay(
    dayEvents: { start: number; end: number }[],
    durationMin: number,
    hint: typeof DEFAULT_WINDOW,
    date: string,
    anchor: string
  ): AiSuggestion[] {
    // Build blocked intervals (with buffer)
    const blocked = dayEvents.map(e => ({
      start: Math.max(0, e.start - BUFFER_MIN),
      end: Math.min(24 * 60, e.end + BUFFER_MIN),
    }));

    // Candidate start times: every 15 min within the preferred window
    const winStart = hint.windowStart * 60;
    const winEnd   = hint.windowEnd   * 60;
    const preferMin = hint.preferHour * 60;

    const candidates: { startMin: number; score: number }[] = [];

    for (let t = winStart; t + durationMin <= winEnd; t += 15) {
      const slotEnd = t + durationMin;
      const overlaps = blocked.some(b => t < b.end && slotEnd > b.start);
      if (overlaps) continue;

      // Also check we're not before "now" on the anchor day
      if (date === anchor) {
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes() + 30; // 30 min from now
        if (t < nowMin) continue;
      }

      // Score: closer to preferred hour = higher score; earlier in day = slight bonus
      const distFromPrefer = Math.abs(t - preferMin);
      const score = 1000 - distFromPrefer - t * 0.01;
      candidates.push({ startMin: t, score });
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    return candidates.map(c => {
      const startTime = this.fromMin(c.startMin);
      const endTime   = this.fromMin(c.startMin + durationMin);
      return {
        date,
        startTime,
        endTime,
        reason: this.buildReason(date, startTime, endTime, hint, dayEvents.length, anchor),
      };
    });
  }

  // ── Reason builder ────────────────────────────────────────────────────────

  private buildReason(
    date: string,
    startTime: string,
    endTime: string,
    hint: typeof DEFAULT_WINDOW,
    existingCount: number,
    anchor: string
  ): string {
    const d = new Date(date + 'T00:00:00');
    const dayName = d.toLocaleDateString('en-US', { weekday: 'long' });
    const isToday = date === anchor;
    const isTomorrow = date === this.addDays(anchor, 1);

    const dayLabel = isToday ? 'today' : isTomorrow ? 'tomorrow' : `${dayName}`;
    const busyNote = existingCount === 0
      ? 'no other events that day'
      : existingCount === 1
        ? '1 other event, plenty of breathing room'
        : `${existingCount} events but this slot is clear`;

    return `Good ${hint.label} on ${dayLabel} (${busyNote}).`;
  }

  // ── Time helpers ──────────────────────────────────────────────────────────

  private toMin(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + (m || 0);
  }

  private fromMin(min: number): string {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  private addDays(dateStr: string, days: number): string {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  }
}
