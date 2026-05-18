import { Injectable } from '@angular/core';

export interface Reminder {
  id: string;
  text: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  daysOfWeek?: number[]; // 0=Sun, 1=Mon, ..., 6=Sat (for weekly)
  time: string; // HH:MM
  nextDue: string; // YYYY-MM-DD
  active: boolean;
  createdAt: string;
  lastTriggered?: string;
}

export interface ReminderSuggestion {
  text: string;
  frequency: 'daily' | 'weekly';
  daysOfWeek?: number[];
  time: string;
  reason: string;
}

// ── Recurring reminder patterns ──────────────────────────────────────────────

interface ReminderPattern {
  regex: RegExp;
  handler: (match: RegExpMatchArray, today: string) => Reminder | null;
}

const REMINDER_PATTERNS: ReminderPattern[] = [
  // "Remind me to water the plants every Tuesday"
  {
    regex: /remind me to (.+?) every (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
    handler: (m, today) => {
      const days: Record<string, number> = {
        'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4,
        'friday': 5, 'saturday': 6, 'sunday': 0
      };
      const dayName = m[2].toLowerCase();
      const dayNum = days[dayName];
      const nextDate = getNextDay(today, dayNum);
      return {
        id: `rem_${Date.now()}`,
        text: m[1].trim(),
        frequency: 'weekly',
        daysOfWeek: [dayNum],
        time: '09:00',
        nextDue: nextDate,
        active: true,
        createdAt: today,
      };
    },
  },
  // "Remind me to water the plants every Monday and Friday"
  {
    regex: /remind me to (.+?) every (monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?: and (monday|tuesday|wednesday|thursday|friday|saturday|sunday))?/i,
    handler: (m, today) => {
      const days: Record<string, number> = {
        'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4,
        'friday': 5, 'saturday': 6, 'sunday': 0
      };
      const day1 = days[m[2].toLowerCase()];
      const day2 = m[3] ? days[m[3].toLowerCase()] : null;
      const daysOfWeek = day2 !== null ? [day1, day2].sort() : [day1];
      const nextDate = getNextDay(today, daysOfWeek[0]);
      return {
        id: `rem_${Date.now()}`,
        text: m[1].trim(),
        frequency: 'weekly',
        daysOfWeek,
        time: '09:00',
        nextDue: nextDate,
        active: true,
        createdAt: today,
      };
    },
  },
  // "Remind me to call John at 2pm on Friday"
  {
    regex: /remind me to (.+?) at (\d{1,2})(?::(\d{2}))? (am|pm) on (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
    handler: (m, today) => {
      const days: Record<string, number> = {
        'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4,
        'friday': 5, 'saturday': 6, 'sunday': 0
      };
      const dayNum = days[m[6].toLowerCase()];
      const hour = parseInt(m[2], 10);
      const minute = m[3] ? parseInt(m[3], 10) : 0;
      const ampm = m[4].toLowerCase();
      const time = formatTime24(hour, minute, ampm);
      const nextDate = getNextDay(today, dayNum);
      return {
        id: `rem_${Date.now()}`,
        text: m[1].trim(),
        frequency: 'weekly',
        daysOfWeek: [dayNum],
        time,
        nextDue: nextDate,
        active: true,
        createdAt: today,
      };
    },
  },
  // "Remind me every weekday at 9am"
  {
    regex: /remind me to (.+?) every weekday at (\d{1,2})(?::(\d{2}))? (am|pm)/i,
    handler: (m, today) => {
      const hour = parseInt(m[2], 10);
      const minute = m[3] ? parseInt(m[3], 10) : 0;
      const ampm = m[4].toLowerCase();
      const time = formatTime24(hour, minute, ampm);
      const nextDate = getNextWeekday(today);
      return {
        id: `rem_${Date.now()}`,
        text: m[1].trim(),
        frequency: 'weekly',
        daysOfWeek: [1, 2, 3, 4, 5], // Mon-Fri
        time,
        nextDue: nextDate,
        active: true,
        createdAt: today,
      };
    },
  },
  // "Remind me every day at 8am"
  {
    regex: /remind me to (.+?) every day at (\d{1,2})(?::(\d{2}))? (am|pm)/i,
    handler: (m, today) => {
      const hour = parseInt(m[2], 10);
      const minute = m[3] ? parseInt(m[3], 10) : 0;
      const ampm = m[4].toLowerCase();
      const time = formatTime24(hour, minute, ampm);
      return {
        id: `rem_${Date.now()}`,
        text: m[1].trim(),
        frequency: 'daily',
        time,
        nextDue: today,
        active: true,
        createdAt: today,
      };
    },
  },
  // "Remind me 30 minutes before my next event"
  {
    regex: /remind me (\d+) minutes before my (next event|upcoming event|appointment|meeting|class|game|practice)/i,
    handler: (m, today) => {
      const minutes = parseInt(m[1], 10);
      // This would need access to actual events — return a placeholder
      return null;
    },
  },
];

// ── Smart suggestion patterns ────────────────────────────────────────────────

interface SuggestionPattern {
  regex?: RegExp;
  handler: (events: any[], today: string) => ReminderSuggestion[] | null;
}

const SUGGESTION_PATTERNS: SuggestionPattern[] = [
  // AP Exam / Test pattern — suggest study reminders 1 week, 3 days, 1 day before
  {
    handler: (events, today) => {
      const testKeywords = ['exam', 'test', 'quiz', 'final', 'midterm', 'sat', 'act', 'ap ', 'clep'];
      const tests = events.filter(e => {
        const title = e.title.toLowerCase();
        return testKeywords.some(kw => title.includes(kw));
      });

      const suggestions: ReminderSuggestion[] = [];
      tests.forEach(test => {
        const testDate = new Date(test.date + 'T00:00:00');
        const testDay = testDate.getDay();
        const daysUntil = Math.ceil((testDate.getTime() - new Date(today + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24));

        if (daysUntil > 0 && daysUntil <= 7) {
          // 1 week before
          if (daysUntil === 7) {
            suggestions.push({
              text: `Start studying for ${test.title}`,
              frequency: 'daily',
              time: '20:00',
              reason: `AP test is in 7 days — time to review`,
            });
          }
          // 3 days before
          if (daysUntil === 3) {
            suggestions.push({
              text: `Review for ${test.title} tomorrow`,
              frequency: 'daily',
              time: '20:00',
              reason: `AP test is in 3 days — review key concepts`,
            });
          }
          // 1 day before
          if (daysUntil === 1) {
            suggestions.push({
              text: `Prepare for ${test.title} tomorrow`,
              frequency: 'daily',
              time: '21:00',
              reason: `AP test is tomorrow — gather supplies and relax`,
            });
          }
          // Morning of test
          if (daysUntil === 0) {
            suggestions.push({
              text: `Good luck on ${test.title} today!`,
              frequency: 'daily',
              time: '07:00',
              reason: `Test day — eat breakfast and stay calm`,
            });
          }
        }
      });

      return suggestions.length > 0 ? suggestions : null;
    },
  },
  // Soccer/Practice pattern — suggest reminder 30 min before
  {
    handler: (events, today) => {
      const sportsKeywords = ['soccer', 'football', 'basketball', 'baseball', 'hockey', 'lacrosse', 'tennis', 'golf', 'swimming', 'track', 'field', 'practice', 'game', 'meet', 'tournament'];
      const sportsEvents = events.filter(e => {
        const title = e.title.toLowerCase();
        return sportsKeywords.some(kw => title.includes(kw));
      });

      const suggestions: ReminderSuggestion[] = [];
      sportsEvents.forEach(e => {
        const eventDate = new Date(e.date + 'T00:00:00');
        const daysUntil = Math.ceil((eventDate.getTime() - new Date(today + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24));

        if (daysUntil >= 0 && daysUntil <= 3) {
          const whenStr = daysUntil === 0 ? 'today' : daysUntil === 1 ? 'tomorrow' : daysUntil + ' days away';
          suggestions.push({
            text: `Get ready for ${e.title}`,
            frequency: 'daily',
            time: addMinutes(e.startTime, -30),
            reason: `${e.title} is ${whenStr}`,
          });
        }
      });

      return suggestions.length > 0 ? suggestions : null;
    },
  },
  // Back-to-back meetings — suggest break reminders
  {
    handler: (events, today) => {
      const dayEvents = events.filter(e => e.date === today).sort((a, b) => a.startTime.localeCompare(b.startTime));
      const suggestions: ReminderSuggestion[] = [];

      for (let i = 0; i < dayEvents.length - 1; i++) {
        const end = toMinutes(dayEvents[i].endTime);
        const start = toMinutes(dayEvents[i + 1].startTime);
        const gap = start - end;

        if (gap < 30 && gap >= 0) {
          suggestions.push({
            text: `Take a ${gap}-min break between ${dayEvents[i].title} and ${dayEvents[i + 1].title}`,
            frequency: 'daily',
            time: addMinutes(dayEvents[i].endTime, Math.max(5, Math.floor(gap / 2))),
            reason: 'Back-to-back events with less than 30 min gap',
          });
        }
      }

      return suggestions.length > 0 ? suggestions : null;
    },
  },
  // Morning routine suggestion — if first event is after 9am
  {
    handler: (events, today) => {
      const dayEvents = events.filter(e => e.date === today).sort((a, b) => a.startTime.localeCompare(b.startTime));
      if (dayEvents.length === 0) return null;

      const firstEventStart = toMinutes(dayEvents[0].startTime);
      if (firstEventStart >= 540) { // 9:00 AM
        return [{
          text: `Morning routine before ${dayEvents[0].title}`,
          frequency: 'daily',
          time: '07:30',
          reason: `First event is at ${dayEvents[0].startTime} — good time for coffee and prep`,
        }];
      }
      return null;
    },
  },
  // Friday afternoon wrap-up suggestion
  {
    handler: (events, today) => {
      const d = new Date(today + 'T00:00:00');
      if (d.getDay() === 5) { // Friday
        const weekEvents = events.filter(e => {
          const ed = new Date(e.date + 'T00:00:00');
          return ed >= d && ed <= new Date(d.getTime() + 6 * 24 * 60 * 60 * 1000);
        });
        if (weekEvents.length > 0) {
          return [{
            text: `Weekly review: What did you accomplish this week?`,
            frequency: 'weekly',
            daysOfWeek: [5],
            time: '16:30',
            reason: `You have ${weekEvents.length} event${weekEvents.length !== 1 ? 's' : ''} this week`,
          }];
        }
      }
      return null;
    },
  },
  // Sunday evening planning suggestion
  {
    handler: (events, today) => {
      const d = new Date(today + 'T00:00:00');
      if (d.getDay() === 0) { // Sunday
        const nextWeekStart = new Date(d.getTime() + 1 * 24 * 60 * 60 * 1000);
        const nextWeekEnd = new Date(d.getTime() + 7 * 24 * 60 * 60 * 1000);
        const nextWeekEvents = events.filter(e => {
          const ed = new Date(e.date + 'T00:00:00');
          return ed >= nextWeekStart && ed <= nextWeekEnd;
        });
        if (nextWeekEvents.length > 0) {
          return [{
            text: `Plan your week: Review next week's schedule`,
            frequency: 'weekly',
            daysOfWeek: [0],
            time: '20:00',
            reason: `You have ${nextWeekEvents.length} event${nextWeekEvents.length !== 1 ? 's' : ''} next week`,
          }];
        }
      }
      return null;
    },
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function getNextDay(today: string, targetDay: number): string {
  const d = new Date(today + 'T00:00:00');
  const currentDay = d.getDay();
  const daysUntil = (targetDay - currentDay + 7) % 7;
  d.setDate(d.getDate() + (daysUntil === 0 ? 7 : daysUntil));
  return d.toISOString().split('T')[0];
}

function getNextWeekday(today: string): string {
  const d = new Date(today + 'T00:00:00');
  const day = d.getDay();
  const daysUntil = day === 5 ? 3 : day === 6 ? 2 : 1;
  d.setDate(d.getDate() + daysUntil);
  return d.toISOString().split('T')[0];
}

function formatTime24(hour: number, minute: number, ampm: string): string {
  let h = hour;
  if (ampm === 'pm' && h !== 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function addMinutes(hhmm: string, minutes: number): string {
  const total = toMinutes(hhmm) + minutes;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class AiRemindersService {

  private STORAGE_KEY = 'agenda_recurring_reminders';

  getReminders(): Reminder[] {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  saveReminders(reminders: Reminder[]): void {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(reminders));
  }

  addReminder(reminder: Reminder): void {
    const reminders = this.getReminders();
    reminders.push(reminder);
    this.saveReminders(reminders);
  }

  removeReminder(id: string): void {
    const reminders = this.getReminders();
    this.saveReminders(reminders.filter(r => r.id !== id));
  }

  toggleReminder(id: string, active: boolean): void {
    const reminders = this.getReminders();
    const r = reminders.find(rem => rem.id === id);
    if (r) {
      r.active = active;
      this.saveReminders(reminders);
    }
  }

  getNextDue(reminder: Reminder, today: string): string {
    if (reminder.frequency === 'daily') {
      return today;
    }
    if (reminder.frequency === 'weekly' && reminder.daysOfWeek) {
      for (let i = 0; i < 7; i++) {
        const d = new Date(today + 'T00:00:00');
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];
        if (reminder.daysOfWeek.includes(d.getDay())) {
          return dateStr;
        }
      }
    }
    return today;
  }

  /**
   * Parse a natural language reminder request and return a Reminder object.
   * Returns null if no pattern matches.
   */
  parseReminder(request: string, today: string): Reminder | null {
    for (const pattern of REMINDER_PATTERNS) {
      const match = request.match(pattern.regex);
      if (match) {
        const reminder = pattern.handler(match, today);
        if (reminder) return reminder;
      }
    }
    return null;
  }

  /**
   * Suggest reminders based on the user's events.
   */
  suggestReminders(events: any[], today: string): ReminderSuggestion[] {
    const suggestions: ReminderSuggestion[] = [];
    for (const pattern of SUGGESTION_PATTERNS) {
      const suggestion = pattern.handler(events, today);
      if (suggestion) suggestions.push(...suggestion);
    }
    return suggestions;
  }

  /**
   * Check if any reminders are due today and haven't been triggered yet.
   */
  getDueReminders(reminders: Reminder[], today: string): Reminder[] {
    return reminders.filter(r => {
      if (!r.active) return false;
      if (r.frequency === 'daily') {
        return r.nextDue === today && !r.lastTriggered?.startsWith(today);
      }
      if (r.frequency === 'weekly' && r.daysOfWeek) {
        const day = new Date(today + 'T00:00:00').getDay();
        if (!r.daysOfWeek.includes(day)) return false;
        return r.nextDue === today && !r.lastTriggered?.startsWith(today);
      }
      return false;
    });
  }
}
