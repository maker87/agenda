import { Injectable } from '@angular/core';
import { CalendarEvent } from './events.service';
import { AiRemindersService, Reminder, ReminderSuggestion } from './ai-reminders.service';
import { AiSchedulerService } from './ai-scheduler.service';
import { I18nService, LangCode } from './i18n.service';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
  actions?: ChatAction[];
}

export interface ChatAction {
  label: string;
  type: 'create_event' | 'navigate' | 'create_reminder' | 'copy_text' | 'confirm_create_event' | 'pick_slot' | 'create_recurring';
  payload?: Partial<CalendarEvent>;
  tab?: string;
  reminderTitle?: string;
  reminderBody?: string;
  copyText?: string;
  slotIndex?: number;
}

/** Tracks the in-progress event being built through the chat wizard. */
export interface EventDraft {
  step: 'title' | 'duration' | 'date' | 'time' | 'endtime' | 'category' | 'location' | 'description' | 'reminder' | 'invite' | 'confirm';
  title?: string;
  durationMin?: number;
  date?: string;
  startTime?: string;
  endTime?: string;
  category?: string;
  description?: string;
  location?: string;
  reminderText?: string;
  color?: string;
  /** Suggested slots shown to the user so they can pick one. */
  suggestedSlots?: Array<{ date: string; startTime: string; endTime: string; reason: string }>;
}

/** A proactive reminder the AI wants to push into notifications. */
export interface ProactiveReminder {
  title: string;
  body: string;
  eventId: string;
  eventDate: string;
}

// ── Intent patterns ──────────────────────────────────────────────────────────

interface Intent {
  name: string;
  patterns: RegExp[];
}

const INTENTS: Intent[] = [
  // ── Event creation — must come before suggest_time ──
  {
    name: 'add_event',
    patterns: [
      /\b(add (an?|a new|the) event|create (an?|a new|the) event|new event)\b/i,
      /\b(schedule (an?|a new|the) (event|meeting|appointment|class|session|practice|game|exam|test|workout|lunch|dinner|call))\b/i,
      /\b(put (an?|a) .+ on (my )?calendar|add .+ to (my )?calendar)\b/i,
      /\b(can you (add|create|schedule|put)|please (add|create|schedule))\b.*(event|meeting|appointment|class|session|practice|game|exam|test|workout|lunch|dinner|call)\b/i,
      /\b(book|set up|arrange) (an?|a new|the)? ?(event|meeting|appointment|session|call)\b/i,
      /^(add|create|schedule|new)\s+\w/i,  // bare "add X" / "schedule X" / "create X"
    ],
  },
  // ── Greetings ──
  {
    name: 'greeting',
    patterns: [/^(hi|hello|hey|good morning|good afternoon|good evening|howdy|sup|what'?s up)/i],
  },
  // ── Help ──
  {
    name: 'help',
    patterns: [/\b(help|what can you do|what do you know|commands|features|capabilities)\b/i],
  },
  // ── Reminders (all patterns merged into one entry) ──
  {
    name: 'set_reminder',
    patterns: [
      /\b(remind me to|set a reminder for|remind me at|remind me before|remind me when)\b/i,
      /\b(remind me|set (a )?reminder|don'?t let me forget|alert me|notify me)\b/i,
      /\b(reminder (for|about|to)|remind (me )?(to|about|for))\b/i,
    ],
  },
  {
    name: 'list_reminders',
    patterns: [/\b(what are my reminders|list my reminders|show my reminders|show reminders|my reminders)\b/i],
  },
  {
    name: 'delete_reminder',
    // Only match explicit reminder deletion — NOT bare "cancel" (that's the wizard)
    patterns: [/\b(remove reminder|delete reminder|stop reminding me|turn off reminder)\b/i],
  },
  {
    name: 'smart_suggestions',
    patterns: [/\b(should i set reminders|would you suggest|any reminders|smart suggestions)\b/i],
  },
  // ── Schedule queries ──
  {
    name: 'list_today',
    patterns: [/\b(today'?s? (events?|schedule|agenda|plans?)|what'?s? (on |happening )?(today|tonight)|do i have (anything|something) today)\b/i],
  },
  {
    name: 'list_tomorrow',
    patterns: [/\b(tomorrow'?s? (events?|schedule|agenda|plans?)|what'?s? (on |happening )?tomorrow|do i have (anything|something) tomorrow)\b/i],
  },
  {
    name: 'list_week',
    patterns: [/\b(this week'?s? (events?|schedule|agenda)|what'?s? (on |happening )?(this week|next 7 days)|week(ly)? schedule)\b/i],
  },
  {
    name: 'list_next_week',
    patterns: [/\b(next week'?s? (events?|schedule|agenda)|what'?s? (on |happening )?next week)\b/i],
  },
  {
    name: 'list_month',
    patterns: [/\b(this month'?s? (events?|schedule|agenda)|what'?s? (on |happening )?(this month)|monthly schedule)\b/i],
  },
  {
    name: 'count_events',
    patterns: [/\b(how many (events?|things|items)|count (my )?(events?|schedule))\b/i],
  },
  {
    name: 'busiest_day',
    patterns: [/\b(busiest day|most (events?|busy)|which day (has|is) (the )?most)\b/i],
  },
  {
    name: 'free_time',
    patterns: [/\b(free (time|slot|day|days?)|when am i free|available (time|slot|day)|open (slot|time|day))\b/i],
  },
  {
    name: 'next_event',
    patterns: [/\b(next event|upcoming event|what'?s? next|what'?s? coming up)\b/i],
  },
  {
    name: 'find_event',
    patterns: [
      /\b(find|search|look up|show me|where is|when is)\b.{1,60}\b(event|meeting|class|appointment|session|practice|game|exam|test)\b/i,
    ],
  },
  // ── suggest_time comes AFTER add_event so "schedule a meeting" hits add_event first ──
  {
    name: 'suggest_time',
    patterns: [/\b(suggest|recommend|best time|when should i)\b/i],
  },
  {
    name: 'category_summary',
    patterns: [/\b(categor(y|ies)|how many (events? )?(in|for|under)|breakdown|summary by)\b/i],
  },
  {
    name: 'weekend',
    patterns: [/\b(weekend|this saturday|this sunday)\b/i],
  },
  {
    name: 'thanks',
    patterns: [/^(thanks?|thank you|thx|ty|great|awesome|perfect|nice|cool|got it)\b/i],
  },
  // ── Proactive / smart features ──
  {
    name: 'check_inactivity',
    patterns: [
      /\b(haven'?t (had|been|gone|visited|seen)|last (time|appointment|visit|checkup)|overdue|been a while|long time since|when did i last)\b/i,
      /\b(check (my )?(health|doctor|dentist|gym|workout|study)|should i (go|schedule|book))\b/i,
    ],
  },
  {
    name: 'draft_email',
    patterns: [
      /\b(draft (an? )?email|write (an? )?email|compose (an? )?email|email (draft|template))\b/i,
      /\b(can'?t (make it|attend|come)|will miss|going to miss|won'?t be (there|able)|excuse (for|my))\b/i,
      /\b(apology email|absence email|miss(ing)? (the |my )?(event|meeting|class|appointment))\b/i,
      /\b(follow.?up email|thank.?you email|reschedule email|meeting request email|invitation email|cancellation email|confirmation email)\b/i,
      /\b(email.*(about|for|regarding|to confirm|to cancel|to reschedule|to follow up|to thank|to invite))\b/i,
    ],
  },
  {
    name: 'study_reminder',
    patterns: [
      /\b(study (for|reminder|schedule)|start studying|when (should|do) i study|prepare for (exam|test|quiz))\b/i,
      /\b(exam (prep|reminder)|test (prep|reminder)|quiz (prep|reminder))\b/i,
    ],
  },
];

// ── Day helpers ───────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().split('T')[0];
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function startOfWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - day);
  return d.toISOString().split('T')[0];
}

// Locale mapping for date/time formatting
const LANG_TO_LOCALE: Record<string, string> = {
  en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', pt: 'pt-BR',
  zh: 'zh-CN', ja: 'ja-JP', ar: 'ar-SA', hi: 'hi-IN', ko: 'ko-KR',
  it: 'it-IT', ru: 'ru-RU', nl: 'nl-NL', sv: 'sv-SE', pl: 'pl-PL', tr: 'tr-TR',
};

/** Module-level language state — set before each reply to avoid threading lang through every call */
let _currentLang = 'en';

function getLocale(lang?: string): string {
  return LANG_TO_LOCALE[lang || _currentLang] || 'en-US';
}

function formatDate(dateStr: string, lang?: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(getLocale(lang), { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(hhmm: string, lang?: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString(getLocale(lang), { hour: 'numeric', minute: '2-digit' });
}

function eventsInRange(events: CalendarEvent[], from: string, to: string): CalendarEvent[] {
  return events
    .filter(e => e.date >= from && e.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}

function bulletList(events: CalendarEvent[], maxItems = 8): string {
  const shown = events.slice(0, maxItems);
  const lines = shown.map(e =>
    `• **${e.title}** — ${formatDate(e.date)}, ${formatTime(e.startTime)}–${formatTime(e.endTime)}${e.category ? ` (${e.category})` : ''}`
  );
  if (events.length > maxItems) {
    lines.push(`…and ${events.length - maxItems} more.`);
  }
  return lines.join('\n');
}

// ── Category & color inference ────────────────────────────────────────────────

interface CategoryRule {
  keywords: RegExp;
  category: string;
  color: string;
}

const CATEGORY_RULES: CategoryRule[] = [
  { keywords: /\b(exam|test|quiz|midterm|final|ap |sat|act|clep|study|homework|essay|project|assignment|class|lecture|lab|school|college|university|course)\b/i,
    category: 'School', color: '#6c63ff' },
  { keywords: /\b(meeting|standup|sync|call|interview|presentation|demo|review|sprint|planning|1:1|one.on.one|conference|workshop|seminar|webinar|work|office|client|project)\b/i,
    category: 'Work', color: '#3b82f6' },
  { keywords: /\b(doctor|dentist|checkup|check-up|therapy|clinic|hospital|appointment|physical|prescription|optometrist|dermatologist|health|medical)\b/i,
    category: 'Health', color: '#10b981' },
  { keywords: /\b(gym|workout|exercise|run|jog|yoga|pilates|swim|cycling|crossfit|lift|weights|cardio|training|practice|game|match|tournament|soccer|football|basketball|baseball|tennis|track|field|sport)\b/i,
    category: 'Fitness', color: '#f59e0b' },
  { keywords: /\b(lunch|dinner|breakfast|brunch|coffee|drinks|happy hour|party|birthday|celebration|hangout|date|friend|family|social|gathering|event)\b/i,
    category: 'Social', color: '#ec4899' },
  { keywords: /\b(flight|travel|trip|vacation|hotel|airport|drive|road trip|cruise|tour|visit)\b/i,
    category: 'Travel', color: '#ef4444' },
  { keywords: /\b(grocery|shopping|errand|chore|laundry|cleaning|cooking|meal prep|haircut|bank|post office)\b/i,
    category: 'Personal', color: '#8b5cf6' },
  { keywords: /\b(concert|movie|show|theater|museum|game night|book club|hobby|music|art|reading)\b/i,
    category: 'Entertainment', color: '#d946ef' },
];

function inferCategory(title: string): { category: string; color: string } {
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.test(title)) {
      return { category: rule.category, color: rule.color };
    }
  }
  return { category: 'Personal', color: '#6c63ff' };
}

// ── Proactive reminder engine ─────────────────────────────────────────────────

interface PrepRule {
  /** Matches event titles that need prep reminders */
  keywords: RegExp;
  /** Days before the event to fire each reminder */
  daysBefore: number[];
  /** Function that builds the reminder text for a given days-before value */
  buildTitle: (eventTitle: string, days: number) => string;
  buildBody:  (eventTitle: string, eventDate: string, days: number) => string;
}

const PREP_RULES: PrepRule[] = [
  {
    // Tests, exams, quizzes
    keywords: /\b(exam|test|quiz|midterm|final|ap |sat|act|clep)\b/i,
    daysBefore: [5, 3, 1],
    buildTitle: (t, d) => d === 1 ? `Final review: ${t}` : `Start studying: ${t}`,
    buildBody:  (t, date, d) => d === 1
      ? `${t} is tomorrow (${date}). Do a final review tonight and get a good night's sleep!`
      : `${t} is in ${d} days (${date}). Start reviewing your notes and practice problems now.`,
  },
  {
    // Meetings, calls, presentations, demos
    keywords: /\b(meeting|presentation|demo|interview|standup|sync|call|conference|board|review)\b/i,
    daysBefore: [1],
    buildTitle: (t, _d) => `Prep for: ${t}`,
    buildBody:  (t, date, _d) => `${t} is tomorrow (${date}). Review your agenda, notes, and any materials you need.`,
  },
  {
    // Sports games and tournaments
    keywords: /\b(game|match|tournament|competition|meet|race)\b/i,
    daysBefore: [1],
    buildTitle: (t, _d) => `Get ready: ${t}`,
    buildBody:  (t, date, _d) => `${t} is tomorrow (${date}). Pack your gear, rest up, and stay hydrated!`,
  },
  {
    // Travel / flights
    keywords: /\b(flight|travel|trip|vacation|cruise)\b/i,
    daysBefore: [3, 1],
    buildTitle: (t, d) => d === 1 ? `Pack for: ${t}` : `Prepare for: ${t}`,
    buildBody:  (t, date, d) => d === 1
      ? `${t} is tomorrow (${date}). Finish packing, check your documents, and confirm your bookings.`
      : `${t} is in ${d} days (${date}). Start planning what to pack and confirm all reservations.`,
  },
  {
    // Concerts, shows, events
    keywords: /\b(concert|show|theater|performance|recital|ceremony|graduation|prom)\b/i,
    daysBefore: [1],
    buildTitle: (t, _d) => `Reminder: ${t} is tomorrow`,
    buildBody:  (t, date, _d) => `${t} is tomorrow (${date}). Plan your outfit, check the venue, and confirm your tickets.`,
  },
  {
    // Doctor / health appointments
    keywords: /\b(doctor|dentist|checkup|therapy|clinic|appointment|physical)\b/i,
    daysBefore: [1],
    buildTitle: (t, _d) => `Appointment tomorrow: ${t}`,
    buildBody:  (t, date, _d) => `${t} is tomorrow (${date}). Confirm the time, bring your insurance card, and note any questions for your provider.`,
  },
];

/**
 * Scan upcoming events and return proactive reminders that should be created.
 * Only returns reminders that haven't been seen before (caller tracks seen set).
 *
 * Generates personalized reminders based on the user's actual calendar:
 * - Prep reminders for exams, meetings, sports, travel, etc.
 * - Busy day warnings when schedule is packed
 * - Early morning heads-up when first event starts before 8 AM
 * - Back-to-back event alerts (no breaks between events)
 * - Long day wind-down reminders (6+ hours scheduled)
 * - Habit streak encouragement for recurring activities
 * - Free day suggestions when surrounded by busy days
 */
export function getProactiveReminders(
  events: CalendarEvent[],
  todayStr: string,
  alreadySeen: Set<string>,
): ProactiveReminder[] {
  const results: ProactiveReminder[] = [];

  // Helper: convert HH:MM to total minutes
  const toMinutes = (hhmm: string): number => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };

  // Helper: get events for a specific date
  const eventsOnDate = (date: string) =>
    events.filter(e => e.date === date).sort((a, b) => a.startTime.localeCompare(b.startTime));

  // Helper: count total scheduled hours on a date
  const scheduledMinutes = (date: string): number => {
    return eventsOnDate(date).reduce((sum, e) => {
      const dur = toMinutes(e.endTime) - toMinutes(e.startTime);
      return sum + Math.max(dur, 0);
    }, 0);
  };

  // ── 1. Standard prep reminders (exams, meetings, sports, etc.) ──
  for (const event of events) {
    const daysUntil = Math.ceil(
      (new Date(event.date + 'T00:00:00').getTime() - new Date(todayStr + 'T00:00:00').getTime())
      / (1000 * 60 * 60 * 24)
    );
    if (daysUntil < 0 || daysUntil > 7) continue;

    for (const rule of PREP_RULES) {
      if (!rule.keywords.test(`${event.title} ${event.category}`)) continue;

      for (const days of rule.daysBefore) {
        if (daysUntil !== days) continue;

        const key = `proactive_${event.id}_${days}d`;
        if (alreadySeen.has(key)) continue;

        results.push({
          title: rule.buildTitle(event.title, days),
          body:  rule.buildBody(event.title, formatDate(event.date), days),
          eventId:   event.id,
          eventDate: event.date,
        });
        alreadySeen.add(key);
      }
    }
  }

  // ── 2. Busy day warning — tomorrow has 5+ events ──
  const tomorrowStr = addDays(todayStr, 1);
  const tomorrowEvents = eventsOnDate(tomorrowStr);
  if (tomorrowEvents.length >= 5) {
    const key = `busy_day_${tomorrowStr}`;
    if (!alreadySeen.has(key)) {
      const totalHours = Math.round(scheduledMinutes(tomorrowStr) / 60);
      const categories = [...new Set(tomorrowEvents.map(e => e.category).filter(Boolean))];
      const catText = categories.length > 0 ? ` across ${categories.slice(0, 3).join(', ')}` : '';
      results.push({
        title: `Heads up: busy day tomorrow`,
        body: `You have ${tomorrowEvents.length} events (~${totalHours}h scheduled)${catText}. ` +
              `First up: ${tomorrowEvents[0].title} at ${formatTime(tomorrowEvents[0].startTime)}. ` +
              `Consider prepping tonight and getting good rest.`,
        eventId: tomorrowEvents[0].id,
        eventDate: tomorrowStr,
      });
      alreadySeen.add(key);
    }
  }

  // ── 3. Early morning alert — tomorrow's first event is before 8 AM ──
  if (tomorrowEvents.length > 0) {
    const firstEvent = tomorrowEvents[0];
    const firstStartMin = toMinutes(firstEvent.startTime);
    if (firstStartMin < 480) { // before 8:00 AM
      const key = `early_morning_${tomorrowStr}`;
      if (!alreadySeen.has(key)) {
        results.push({
          title: `Early start tomorrow: ${firstEvent.title}`,
          body: `${firstEvent.title} starts at ${formatTime(firstEvent.startTime)} tomorrow. ` +
                `Set your alarm early and prepare what you need tonight!`,
          eventId: firstEvent.id,
          eventDate: tomorrowStr,
        });
        alreadySeen.add(key);
      }
    }
  }

  // ── 4. Back-to-back events — no breaks today ──
  const todayEvents = eventsOnDate(todayStr);
  if (todayEvents.length >= 3) {
    let backToBackCount = 0;
    for (let i = 0; i < todayEvents.length - 1; i++) {
      const endMin = toMinutes(todayEvents[i].endTime);
      const nextStartMin = toMinutes(todayEvents[i + 1].startTime);
      if (nextStartMin - endMin < 15) backToBackCount++;
    }
    if (backToBackCount >= 2) {
      const key = `back_to_back_${todayStr}`;
      if (!alreadySeen.has(key)) {
        results.push({
          title: `Packed schedule today — find micro-breaks`,
          body: `You have ${backToBackCount + 1} events with less than 15 min between them. ` +
                `Try to grab water, stretch, or take a 5-min walk between activities.`,
          eventId: todayEvents[0].id,
          eventDate: todayStr,
        });
        alreadySeen.add(key);
      }
    }
  }

  // ── 5. Long day wind-down — today has 6+ hours of events ──
  const todayScheduledMin = scheduledMinutes(todayStr);
  if (todayScheduledMin >= 360) { // 6+ hours
    const key = `long_day_${todayStr}`;
    if (!alreadySeen.has(key)) {
      const lastEvent = todayEvents[todayEvents.length - 1];
      results.push({
        title: `Long day — don't forget to recharge`,
        body: `You have ~${Math.round(todayScheduledMin / 60)} hours scheduled today. ` +
              `Your last event (${lastEvent.title}) ends at ${formatTime(lastEvent.endTime)}. ` +
              `Plan some downtime after — you've earned it.`,
        eventId: lastEvent.id,
        eventDate: todayStr,
      });
      alreadySeen.add(key);
    }
  }

  // ── 6. Habit streak encouragement — detect recurring activity patterns ──
  // Look for activities the user does regularly and encourage maintaining the streak
  const weekAgo = addDays(todayStr, -7);
  const recentEvents = events.filter(e => e.date >= weekAgo && e.date < todayStr);
  const categoryFrequency: Record<string, number> = {};
  recentEvents.forEach(e => {
    if (e.category) categoryFrequency[e.category] = (categoryFrequency[e.category] ?? 0) + 1;
  });

  // Find categories with 3+ occurrences in the past week (active habits)
  const activeHabits = Object.entries(categoryFrequency)
    .filter(([_, count]) => count >= 3)
    .map(([cat]) => cat);

  for (const habit of activeHabits) {
    // Check if there's an instance of this habit scheduled today or tomorrow
    const hasToday = todayEvents.some(e => e.category === habit);
    const hasTomorrow = tomorrowEvents.some(e => e.category === habit);

    // If not scheduled today AND not scheduled tomorrow, nudge to keep the streak
    if (!hasToday && !hasTomorrow) {
      const key = `streak_${habit}_${todayStr}`;
      if (!alreadySeen.has(key)) {
        const count = categoryFrequency[habit];
        results.push({
          title: `Keep your ${habit} streak going!`,
          body: `You had ${count} ${habit} sessions this past week — great momentum! ` +
                `Nothing scheduled for today or tomorrow. Consider adding one to stay consistent.`,
          eventId: '',
          eventDate: todayStr,
        });
        alreadySeen.add(key);
      }
    }
  }

  // ── 7. Free day after busy stretch — suggest rest ──
  if (todayEvents.length === 0) {
    // Check if the past 2 days were busy (4+ events each)
    const yesterday = addDays(todayStr, -1);
    const dayBefore = addDays(todayStr, -2);
    const yesterdayCount = eventsOnDate(yesterday).length;
    const dayBeforeCount = eventsOnDate(dayBefore).length;

    if (yesterdayCount >= 4 && dayBeforeCount >= 4) {
      const key = `rest_day_${todayStr}`;
      if (!alreadySeen.has(key)) {
        results.push({
          title: `Free day — enjoy the break!`,
          body: `After ${yesterdayCount + dayBeforeCount} events over the last 2 days, ` +
                `today is clear. Great time for self-care, catching up on rest, or doing something fun.`,
          eventId: '',
          eventDate: todayStr,
        });
        alreadySeen.add(key);
      }
    }
  }

  // ── 8. Upcoming week overview — Sunday evening planning prompt ──
  const todayDate = new Date(todayStr + 'T00:00:00');
  if (todayDate.getDay() === 0) { // Sunday
    const nextMonday = addDays(todayStr, 1);
    const nextFriday = addDays(todayStr, 5);
    const nextWeekEvents = events.filter(e => e.date >= nextMonday && e.date <= nextFriday);
    if (nextWeekEvents.length > 0) {
      const key = `week_preview_${todayStr}`;
      if (!alreadySeen.has(key)) {
        const busyDays = new Set(nextWeekEvents.map(e => e.date));
        const busiestDate = [...busyDays].reduce((a, b) =>
          eventsOnDate(a).length >= eventsOnDate(b).length ? a : b
        );
        const busiestCount = eventsOnDate(busiestDate).length;
        results.push({
          title: `Week ahead: ${nextWeekEvents.length} events`,
          body: `You have ${nextWeekEvents.length} events across ${busyDays.size} days next week. ` +
                `Busiest day: ${formatDate(busiestDate)} (${busiestCount} events). ` +
                `Take a few minutes tonight to review and prepare.`,
          eventId: nextWeekEvents[0].id,
          eventDate: nextMonday,
        });
        alreadySeen.add(key);
      }
    }
  }

  return results;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class AiChatService {

  constructor(
    private remindersService: AiRemindersService,
    private scheduler: AiSchedulerService,
    private i18n: I18nService,
  ) {}

  private detectIntent(text: string): string {
    for (const intent of INTENTS) {
      if (intent.patterns.some(p => p.test(text))) return intent.name;
    }
    return 'unknown';
  }

  /** Get current language code for locale-aware formatting */
  private get lang(): string {
    return this.i18n.getLanguage();
  }

  /** Translate common AI phrases to the current language */
  private translateAiText(text: string): string {
    const lang = this.lang;
    if (lang === 'en') return text;

    const phrases: Record<string, Record<string, string>> = {
      'How can I help you?': { es: '¿Cómo puedo ayudarte?', fr: 'Comment puis-je vous aider ?', de: 'Wie kann ich helfen?', pt: 'Como posso ajudar?', it: 'Come posso aiutarti?', zh: '有什么我可以帮你的吗？', ja: 'どうお手伝いしましょうか？', ko: '무엇을 도와드릴까요?', ar: 'كيف يمكنني مساعدتك؟', hi: 'मैं आपकी कैसे मदद कर सकता हूं?', ru: 'Чем могу помочь?', nl: 'Hoe kan ik je helpen?', sv: 'Hur kan jag hjälpa dig?', pl: 'Jak mogę Ci pomóc?', tr: 'Size nasıl yardımcı olabilirim?' },
      'Good morning': { es: 'Buenos días', fr: 'Bonjour', de: 'Guten Morgen', pt: 'Bom dia', it: 'Buongiorno', zh: '早上好', ja: 'おはようございます', ko: '좋은 아침이에요', ar: 'صباح الخير', hi: 'सुप्रभात', ru: 'Доброе утро', nl: 'Goedemorgen', sv: 'God morgon', pl: 'Dzień dobry', tr: 'Günaydın' },
      'Good afternoon': { es: 'Buenas tardes', fr: 'Bon après-midi', de: 'Guten Tag', pt: 'Boa tarde', it: 'Buon pomeriggio', zh: '下午好', ja: 'こんにちは', ko: '좋은 오후에요', ar: 'مساء الخير', hi: 'नमस्ते', ru: 'Добрый день', nl: 'Goedemiddag', sv: 'God eftermiddag', pl: 'Dzień dobry', tr: 'İyi öğleden sonralar' },
      'Good evening': { es: 'Buenas noches', fr: 'Bonsoir', de: 'Guten Abend', pt: 'Boa noite', it: 'Buonasera', zh: '晚上好', ja: 'こんばんは', ko: '좋은 저녁이에요', ar: 'مساء الخير', hi: 'शुभ संध्या', ru: 'Добрый вечер', nl: 'Goedenavond', sv: 'God kväll', pl: 'Dobry wieczór', tr: 'İyi akşamlar' },
      'today': { es: 'hoy', fr: "aujourd'hui", de: 'heute', pt: 'hoje', it: 'oggi', zh: '今天', ja: '今日', ko: '오늘', ar: 'اليوم', hi: 'आज', ru: 'сегодня', nl: 'vandaag', sv: 'idag', pl: 'dziś', tr: 'bugün' },
      'tomorrow': { es: 'mañana', fr: 'demain', de: 'morgen', pt: 'amanhã', it: 'domani', zh: '明天', ja: '明日', ko: '내일', ar: 'غداً', hi: 'कल', ru: 'завтра', nl: 'morgen', sv: 'imorgon', pl: 'jutro', tr: 'yarın' },
      'this week': { es: 'esta semana', fr: 'cette semaine', de: 'diese Woche', pt: 'esta semana', it: 'questa settimana', zh: '本周', ja: '今週', ko: '이번 주', ar: 'هذا الأسبوع', hi: 'इस सप्ताह', ru: 'на этой неделе', nl: 'deze week', sv: 'den här veckan', pl: 'w tym tygodniu', tr: 'bu hafta' },
      'next week': { es: 'la próxima semana', fr: 'la semaine prochaine', de: 'nächste Woche', pt: 'próxima semana', it: 'la prossima settimana', zh: '下周', ja: '来週', ko: '다음 주', ar: 'الأسبوع القادم', hi: 'अगले सप्ताह', ru: 'на следующей неделе', nl: 'volgende week', sv: 'nästa vecka', pl: 'w przyszłym tygodniu', tr: 'gelecek hafta' },
      'event': { es: 'evento', fr: 'événement', de: 'Ereignis', pt: 'evento', it: 'evento', zh: '事件', ja: '予定', ko: '일정', ar: 'حدث', hi: 'इवेंट', ru: 'событие', nl: 'evenement', sv: 'händelse', pl: 'wydarzenie', tr: 'etkinlik' },
      'events': { es: 'eventos', fr: 'événements', de: 'Ereignisse', pt: 'eventos', it: 'eventi', zh: '事件', ja: '予定', ko: '일정', ar: 'أحداث', hi: 'इवेंट्स', ru: 'событий', nl: 'evenementen', sv: 'händelser', pl: 'wydarzeń', tr: 'etkinlik' },
      'Enjoy the free day!': { es: '¡Disfruta el día libre!', fr: 'Profitez de la journée libre !', de: 'Genieße den freien Tag!', pt: 'Aproveite o dia livre!', it: 'Goditi la giornata libera!', zh: '享受空闲的一天！', ja: '自由な一日を楽しんでください！', ko: '자유로운 하루를 즐기세요!', ar: 'استمتع بيومك الحر!', hi: 'खाली दिन का आनंद लें!', ru: 'Наслаждайтесь свободным днём!', nl: 'Geniet van de vrije dag!', sv: 'Njut av den lediga dagen!', pl: 'Ciesz się wolnym dniem!', tr: 'Boş gününün tadını çıkar!' },
      'Happy to help!': { es: '¡Con gusto!', fr: 'Avec plaisir !', de: 'Gerne!', pt: 'Com prazer!', it: 'Felice di aiutare!', zh: '很高兴能帮到你！', ja: 'お役に立てて嬉しいです！', ko: '도움이 되어 기뻐요!', ar: 'سعيد بالمساعدة!', hi: 'मदद करके खुशी हुई!', ru: 'Рад помочь!', nl: 'Graag gedaan!', sv: 'Glad att jag kunde hjälpa!', pl: 'Cieszę się, że mogłem pomóc!', tr: 'Yardımcı olmaktan mutluluk duyarım!' },
      'Anytime! Let me know if you need anything else.': { es: '¡Cuando quieras! Avísame si necesitas algo más.', fr: "N'hésitez pas si vous avez besoin d'autre chose.", de: 'Jederzeit! Sag mir, wenn du noch etwas brauchst.', pt: 'A qualquer hora! Me avise se precisar de mais alguma coisa.', it: 'Quando vuoi! Fammi sapere se hai bisogno di altro.', zh: '随时为你效劳！如果还需要其他帮助请告诉我。', ja: 'いつでもどうぞ！他に何かあれば教えてください。', ko: '언제든지요! 다른 것이 필요하시면 알려주세요.', ar: 'في أي وقت! أخبرني إذا كنت بحاجة لأي شيء آخر.', hi: 'कभी भी! अगर कुछ और चाहिए तो बताइए।', ru: 'Всегда пожалуйста! Обращайтесь, если что-то ещё нужно.', nl: 'Altijd! Laat me weten als je nog iets nodig hebt.', sv: 'När som helst! Hör av dig om du behöver något mer.', pl: 'Zawsze! Daj znać jeśli potrzebujesz czegoś jeszcze.', tr: 'Her zaman! Başka bir şeye ihtiyacın olursa haber ver.' },
      "You're welcome! Anything else I can help with?": { es: '¡De nada! ¿Algo más en lo que pueda ayudar?', fr: 'De rien ! Autre chose ?', de: 'Bitte! Kann ich sonst noch helfen?', pt: 'De nada! Algo mais em que eu possa ajudar?', it: 'Prego! Posso aiutarti con qualcos altro?', zh: '不客气！还有什么我可以帮忙的吗？', ja: 'どういたしまして！他にお手伝いできることはありますか？', ko: '천만에요! 다른 도움이 필요하신가요?', ar: 'على الرحب والسعة! هل هناك شيء آخر يمكنني المساعدة فيه؟', hi: 'कोई बात नहीं! और कुछ मदद कर सकता हूं?', ru: 'Пожалуйста! Могу ещё чем-то помочь?', nl: 'Graag gedaan! Kan ik nog ergens mee helpen?', sv: 'Varsågod! Kan jag hjälpa med något mer?', pl: 'Nie ma za co! Czy mogę jeszcze w czymś pomóc?', tr: 'Rica ederim! Başka yardımcı olabileceğim bir şey var mı?' },
      'Glad I could help!': { es: '¡Me alegra haber podido ayudar!', fr: 'Content de pouvoir aider !', de: 'Freut mich, dass ich helfen konnte!', pt: 'Fico feliz em ter ajudado!', it: 'Contento di aver potuto aiutare!', zh: '很高兴能帮到你！', ja: 'お役に立てて良かったです！', ko: '도움이 되어서 기뻐요!', ar: 'سعيد أنني استطعت المساعدة!', hi: 'खुशी है कि मैं मदद कर पाया!', ru: 'Рад, что смог помочь!', nl: 'Blij dat ik kon helpen!', sv: 'Glad att jag kunde hjälpa!', pl: 'Cieszę się, że mogłem pomóc!', tr: 'Yardımcı olabildiğime sevindim!' },
      "Sure! Let's add a new event. What's the title?": { es: '¡Claro! Vamos a agregar un nuevo evento. ¿Cuál es el título?', fr: "Bien sûr ! Ajoutons un nouvel événement. Quel est le titre ?", de: 'Klar! Lass uns ein neues Ereignis hinzufügen. Wie lautet der Titel?', pt: 'Claro! Vamos adicionar um novo evento. Qual é o título?', it: "Certo! Aggiungiamo un nuovo evento. Qual è il titolo?", zh: '当然！让我们添加一个新事件。标题是什么？', ja: 'もちろん！新しい予定を追加しましょう。タイトルは何ですか？', ko: '물론이죠! 새 일정을 추가합시다. 제목이 무엇인가요?', ar: 'بالطبع! لنضف حدثاً جديداً. ما هو العنوان؟', hi: 'ज़रूर! चलिए एक नया इवेंट जोड़ते हैं। शीर्षक क्या है?', ru: 'Конечно! Давайте добавим новое событие. Какое название?', nl: 'Natuurlijk! Laten we een nieuw evenement toevoegen. Wat is de titel?', sv: 'Visst! Låt oss lägga till en ny händelse. Vad är titeln?', pl: 'Jasne! Dodajmy nowe wydarzenie. Jaki jest tytuł?', tr: 'Tabii! Yeni bir etkinlik ekleyelim. Başlık ne?' },
      'You have nothing scheduled for today': { es: 'No tienes nada programado para hoy', fr: "Vous n'avez rien de prévu aujourd'hui", de: 'Du hast heute nichts geplant', pt: 'Você não tem nada agendado para hoje', it: 'Non hai nulla in programma per oggi', zh: '你今天没有安排', ja: '今日は予定がありません', ko: '오늘 예정된 일정이 없습니다', ar: 'لا شيء مجدول لليوم', hi: 'आज के लिए कुछ निर्धारित नहीं है', ru: 'На сегодня ничего не запланировано', nl: 'Je hebt vandaag niets gepland', sv: 'Du har inget schemalagt idag', pl: 'Nie masz nic zaplanowanego na dziś', tr: 'Bugün için planlanmış bir şey yok' },
      'Nothing scheduled for tomorrow': { es: 'Nada programado para mañana', fr: 'Rien de prévu pour demain', de: 'Morgen ist nichts geplant', pt: 'Nada agendado para amanhã', it: 'Niente in programma per domani', zh: '明天没有安排', ja: '明日は予定がありません', ko: '내일 예정된 것이 없습니다', ar: 'لا شيء مجدول لغد', hi: 'कल के लिए कुछ निर्धारित नहीं है', ru: 'На завтра ничего не запланировано', nl: 'Morgen niets gepland', sv: 'Inget schemalagt imorgon', pl: 'Nic nie zaplanowano na jutro', tr: 'Yarın için planlanmış bir şey yok' },
      'Your calendar is clear this week. Time to add something!': { es: '¡Tu calendario está vacío esta semana. Es hora de agregar algo!', fr: 'Votre calendrier est vide cette semaine. Ajoutez quelque chose !', de: 'Dein Kalender ist diese Woche leer. Zeit, etwas hinzuzufügen!', pt: 'Seu calendário está vazio esta semana. Hora de adicionar algo!', it: 'Il tuo calendario è vuoto questa settimana. È ora di aggiungere qualcosa!', zh: '你这周日程是空的。是时候添加一些安排了！', ja: '今週のカレンダーは空です。何か追加しましょう！', ko: '이번 주 캘린더가 비어있습니다. 무언가를 추가하세요!', ar: 'تقويمك فارغ هذا الأسبوع. حان الوقت لإضافة شيء!', hi: 'इस सप्ताह आपका कैलेंडर खाली है। कुछ जोड़ने का समय है!', ru: 'Ваш календарь на этой неделе пуст. Самое время что-то добавить!', nl: 'Je kalender is deze week leeg. Tijd om iets toe te voegen!', sv: 'Din kalender är tom den här veckan. Dags att lägga till något!', pl: 'Twój kalendarz jest pusty w tym tygodniu. Czas coś dodać!', tr: 'Bu hafta takviminiz boş. Bir şeyler eklemenin zamanı!' },
      'No upcoming events found. Time to add something to your calendar!': { es: 'No se encontraron eventos próximos. ¡Es hora de agregar algo!', fr: 'Aucun événement à venir. Ajoutez quelque chose !', de: 'Keine kommenden Ereignisse. Zeit, etwas hinzuzufügen!', pt: 'Nenhum evento futuro encontrado. Hora de adicionar algo!', it: 'Nessun evento in arrivo. È ora di aggiungere qualcosa!', zh: '没有找到即将到来的事件。是时候添加一些了！', ja: '今後の予定が見つかりません。何か追加しましょう！', ko: '예정된 일정이 없습니다. 무언가를 추가하세요!', ar: 'لم يتم العثور على أحداث قادمة. حان الوقت لإضافة شيء!', hi: 'कोई आगामी इवेंट नहीं मिला। कुछ जोड़ने का समय है!', ru: 'Предстоящих событий не найдено. Самое время что-то добавить!', nl: 'Geen aankomende evenementen gevonden. Tijd om iets toe te voegen!', sv: 'Inga kommande händelser hittades. Dags att lägga till något!', pl: 'Nie znaleziono nadchodzących wydarzeń. Czas coś dodać!', tr: 'Yaklaşan etkinlik bulunamadı. Takviminize bir şeyler eklemenin zamanı!' },
    };

    let result = text;
    // Replace exact phrase matches
    for (const [en, translations] of Object.entries(phrases)) {
      if (translations[lang] && result.includes(en)) {
        result = result.replace(en, translations[lang]);
      }
    }
    return result;
  }

  /**
   * Generate a reply given the user's message and their current events.
   * Pass `draft` when an event creation wizard is in progress.
   * Returns the reply message AND an updated draft (null = wizard finished/cancelled).
   */
  reply(
    userText: string,
    events: CalendarEvent[],
    userEmail: string,
    draft?: EventDraft | null,
  ): { message: ChatMessage; draft: EventDraft | null } {
    // Set module-level language so formatDate/formatTime use the correct locale
    _currentLang = this.i18n.getLanguage();

    const intent = this.detectIntent(userText);
    const t = today();
    let text = '';
    const actions: ChatAction[] = [];
    let newDraft: EventDraft | null = draft ?? null;

    // ── If a wizard is in progress, route to the wizard handler ──
    if (draft) {
      return this.continueWizard(userText, events, draft, t);
    }

    switch (intent) {

      case 'add_event': {
        // Try to parse what the user provided
        const parsed = this.parseNaturalEvent(userText, t);

        // Never skip the wizard — always confirm each field step by step.
        // Only pre-fill steps that the user explicitly provided.
        const stripped = userText
          .replace(/^(can you|please|could you|i want to|i need to|i'd like to)\s+/i, '')
          .replace(/^(add|create|schedule|put|book|set up|arrange|new|i have)\s+(an?\s+|a new\s+)?/i, '')
          .replace(/\s+(to|on|in|for)\s+(my\s+)?(calendar|agenda|schedule).*$/i, '')
          .replace(/\s+(event|called|named)$/i, '')
          .replace(/\s+(every|at|from)\s+.*$/i, '')
          .trim();

        const quickTitle = parsed?.title || (stripped.length > 1 ? stripped : null);

        if (quickTitle) {
          // We have a title — start at duration step
          // If duration was also provided, skip that too
          if (parsed?.durationMin && parsed?.startTime && parsed?.date) {
            // User gave title + duration + time + date — go to category step (ask to confirm)
            const endTime = parsed.endTime || this.addMinutesToTime(parsed.startTime, parsed.durationMin);
            newDraft = {
              step: 'category',
              title: quickTitle,
              durationMin: parsed.durationMin,
              date: parsed.date,
              startTime: parsed.startTime,
              endTime,
            };
            const inferred = inferCategory(quickTitle);
            text = `Got it — **"${quickTitle}"** on **${formatDate(parsed.date)}** at **${formatTime(parsed.startTime)}–${formatTime(endTime)}**.\n\nWhat category should this go under? (e.g. "Work", "Personal", "Health")\n\n_I'd suggest **${inferred.category}** based on the title. Type that, a different one, or "skip" to use my suggestion._`;
          } else if (parsed?.durationMin && parsed?.startTime) {
            // Has title + time + duration but no date — ask for date
            const endTime = parsed.endTime || this.addMinutesToTime(parsed.startTime, parsed.durationMin);
            newDraft = {
              step: 'date',
              title: quickTitle,
              durationMin: parsed.durationMin,
              startTime: parsed.startTime,
              endTime,
            };
            text = `Got it — **"${quickTitle}"** at **${formatTime(parsed.startTime)}–${formatTime(endTime)}**. What date? (e.g. "tomorrow", "next Monday", "July 15")`;
          } else if (parsed?.startTime && parsed?.date) {
            // Has title + time + date but no explicit duration — ask for duration
            newDraft = {
              step: 'duration',
              title: quickTitle,
              date: parsed.date,
              startTime: parsed.startTime,
            };
            text = `Got it — **"${quickTitle}"** on **${formatDate(parsed.date)}** starting at **${formatTime(parsed.startTime)}**. How long should it be? (e.g. "1 hour", "30 minutes")`;
          } else if (parsed?.durationMin) {
            // Has title + duration — suggest slots
            newDraft = { step: 'date', title: quickTitle, durationMin: parsed.durationMin };
            const slots = this.scheduler.getSuggestions(quickTitle, parsed.durationMin, events);
            if (slots.length > 0) {
              const slotLines = slots.map((s, i) =>
                `**${i + 1}.** ${formatDate(s.date)} · ${formatTime(s.startTime)}–${formatTime(s.endTime)} — _${s.reason}_`
              ).join('\n');
              const slotActions: ChatAction[] = slots.map((s, i) => ({
                label: `Pick option ${i + 1}`,
                type: 'pick_slot' as const,
                slotIndex: i,
              }));
              slotActions.push({ label: 'Enter a date instead', type: 'pick_slot', slotIndex: -1 });
              return {
                message: {
                  id: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                  role: 'assistant',
                  text: `Got it — **"${quickTitle}"** (${parsed.durationMin} min). Here are open slots:\n\n${slotLines}\n\nPick one, or tell me a specific date.`,
                  timestamp: new Date(),
                  actions: slotActions,
                },
                draft: { ...newDraft, suggestedSlots: slots },
              };
            }
            text = `Got it — **"${quickTitle}"** (${parsed.durationMin} min). What date works? (e.g. "tomorrow", "next Monday", "July 15")`;
          } else {
            // Only have title — no other details provided.
            // Ask for date first (most natural question: "when?")
            newDraft = { step: 'date', title: quickTitle };
            text = `Got it — **"${quickTitle}"**. I'll need a few details to add this to your calendar:\n\n📅 **What date is it on?** (e.g. "tomorrow", "next Monday", "July 15")`;
          }
        } else {
          // No title found — start from the beginning
          newDraft = { step: 'title' };
          text = `Sure! Let's add a new event. I'll need a few details:\n\n📌 **What's the event called?** (e.g. "Work", "Dentist appointment", "Soccer practice")`;
        }
        break;
      }

      case 'greeting': {
        const hour = new Date().getHours();
        const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
        const todayEvts = eventsInRange(events, t, t);
        text = `${greeting}! 👋 You have **${todayEvts.length}** event${todayEvts.length !== 1 ? 's' : ''} today. How can I help you?`;
        break;
      }

      case 'help': {
        text = `Here's what I can help you with:\n\n` +
          `• **Add an event** — "Add a new event" or "Schedule a dentist appointment"\n` +
          `• **Today / Tomorrow** — "What's on today?" or "Show me tomorrow's schedule"\n` +
          `• **This week / Next week** — "What's happening this week?"\n` +
          `• **This month** — "Show me this month's events"\n` +
          `• **Find events** — "Find my soccer practice" or "When is my exam?"\n` +
          `• **Free time** — "When am I free this week?"\n` +
          `• **Next event** — "What's coming up next?"\n` +
          `• **Busiest day** — "Which day is my busiest?"\n` +
          `• **Category summary** — "Show me a breakdown by category"\n` +
          `• **Set a reminder** — "Remind me to study for my AP Calc exam"\n` +
          `• **Study reminders** — "When should I start studying for my test?"\n` +
          `• **Planning advice** — "How should I plan my week?" or "Am I too busy?"\n` +
          `• **Schedule tips** — "Any suggestions for my schedule?" or "Help me organize my time"\n` +
          `• **Inactivity check** — "When did I last have a doctor appointment?"\n` +
          `• **Draft an email** — "Draft an absence email for my soccer practice"\n` +
          `• **More email types** — follow-up, thank you, reschedule, cancellation, invitation, confirmation\n\n` +
          `Just ask naturally — I'll do my best!`;
        break;
      }

      case 'list_today': {
        const evts = eventsInRange(events, t, t);
        if (evts.length === 0) {
          text = `You have nothing scheduled for today (${formatDate(t)}). Enjoy the free day! 🎉`;
        } else {
          text = `You have **${evts.length}** event${evts.length !== 1 ? 's' : ''} today (${formatDate(t)}):\n\n${bulletList(evts)}`;
        }
        actions.push({ label: 'Open Agenda', type: 'navigate', tab: 'agenda' });
        break;
      }

      case 'list_tomorrow': {
        const tom = addDays(t, 1);
        const evts = eventsInRange(events, tom, tom);
        if (evts.length === 0) {
          text = `Nothing scheduled for tomorrow (${formatDate(tom)}). A clear day ahead!`;
        } else {
          text = `**${evts.length}** event${evts.length !== 1 ? 's' : ''} tomorrow (${formatDate(tom)}):\n\n${bulletList(evts)}`;
        }
        actions.push({ label: 'Open Agenda', type: 'navigate', tab: 'agenda' });
        break;
      }

      case 'list_week': {
        const weekStart = startOfWeek(t);
        const weekEnd = addDays(weekStart, 6);
        const evts = eventsInRange(events, weekStart, weekEnd);
        if (evts.length === 0) {
          text = `Your calendar is clear this week. Time to add something!`;
        } else {
          text = `**${evts.length}** event${evts.length !== 1 ? 's' : ''} this week (${formatDate(weekStart)} – ${formatDate(weekEnd)}):\n\n${bulletList(evts, 10)}`;
        }
        actions.push({ label: 'Open Calendar', type: 'navigate', tab: 'calendar' });
        break;
      }

      case 'list_next_week': {
        const nextWeekStart = addDays(startOfWeek(t), 7);
        const nextWeekEnd = addDays(nextWeekStart, 6);
        const evts = eventsInRange(events, nextWeekStart, nextWeekEnd);
        if (evts.length === 0) {
          text = `Nothing scheduled for next week (${formatDate(nextWeekStart)} – ${formatDate(nextWeekEnd)}) yet.`;
        } else {
          text = `**${evts.length}** event${evts.length !== 1 ? 's' : ''} next week (${formatDate(nextWeekStart)} – ${formatDate(nextWeekEnd)}):\n\n${bulletList(evts, 10)}`;
        }
        actions.push({ label: 'Open Calendar', type: 'navigate', tab: 'calendar' });
        break;
      }

      case 'list_month': {
        const d = new Date();
        const monthStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        const monthEnd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        const evts = eventsInRange(events, monthStart, monthEnd);
        const monthName = d.toLocaleDateString('en-US', { month: 'long' });
        if (evts.length === 0) {
          text = `No events this month (${monthName}).`;
        } else {
          text = `**${evts.length}** event${evts.length !== 1 ? 's' : ''} in ${monthName}:\n\n${bulletList(evts, 12)}`;
        }
        actions.push({ label: 'Open Calendar', type: 'navigate', tab: 'calendar' });
        break;
      }

      case 'count_events': {
        const upcoming = events.filter(e => e.date >= t);
        const past = events.filter(e => e.date < t);
        text = `You have **${events.length}** total events — **${upcoming.length}** upcoming and **${past.length}** past.`;
        break;
      }

      case 'busiest_day': {
        const upcoming = events.filter(e => e.date >= t);
        if (upcoming.length === 0) {
          text = `No upcoming events to analyze yet.`;
          break;
        }
        const countByDay: Record<string, number> = {};
        upcoming.forEach(e => { countByDay[e.date] = (countByDay[e.date] ?? 0) + 1; });
        const busiest = Object.entries(countByDay).sort((a, b) => b[1] - a[1])[0];
        text = `Your busiest upcoming day is **${formatDate(busiest[0])}** with **${busiest[1]} event${busiest[1] !== 1 ? 's' : ''}**.`;
        actions.push({ label: 'Open Calendar', type: 'navigate', tab: 'calendar' });
        break;
      }

      case 'free_time': {
        const weekStart = t;
        const weekEnd = addDays(t, 6);
        const freeDays: string[] = [];
        for (let i = 0; i < 7; i++) {
          const day = addDays(t, i);
          const count = events.filter(e => e.date === day).length;
          if (count === 0) freeDays.push(day);
        }
        if (freeDays.length === 0) {
          text = `You have events every day this week — no completely free days. Try checking specific time slots!`;
        } else if (freeDays.length === 7) {
          text = `Your entire week is free! Nothing scheduled from ${formatDate(weekStart)} to ${formatDate(weekEnd)}.`;
        } else {
          const dayList = freeDays.map(d => formatDate(d)).join(', ');
          text = `Your free days this week: **${dayList}**. ${freeDays.length === 1 ? 'That\'s your only open day!' : `${freeDays.length} open days!`}`;
        }
        break;
      }

      case 'next_event': {
        const upcoming = events
          .filter(e => e.date > t || (e.date === t && e.startTime > new Date().toTimeString().slice(0, 5)))
          .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
        if (upcoming.length === 0) {
          text = `No upcoming events found. Time to add something to your calendar!`;
          actions.push({ label: 'Add Event', type: 'navigate', tab: 'schedule' });
        } else {
          const e = upcoming[0];
          text = `Your next event is **${e.title}** on ${formatDate(e.date)} at ${formatTime(e.startTime)}${e.category ? ` (${e.category})` : ''}.`;
          if (e.description) text += `\n\n_${e.description}_`;
        }
        break;
      }

      case 'find_event': {
        // Extract search keywords from the message (strip common words)
        const stopWords = /\b(find|search|look up|show me|where is|when is|my|the|a|an|for|event|meeting|class|appointment|session|practice|game|exam|test|is|are|do|i|have|any)\b/gi;
        const keywords = userText.replace(stopWords, ' ').trim().split(/\s+/).filter(w => w.length > 2);
        if (keywords.length === 0) {
          text = `What event are you looking for? Try: "Find my soccer practice" or "When is my AP Calc exam?"`;
          break;
        }
        const matches = events.filter(e => {
          const haystack = `${e.title} ${e.description} ${e.category}`.toLowerCase();
          return keywords.some(kw => haystack.includes(kw.toLowerCase()));
        }).sort((a, b) => a.date.localeCompare(b.date));
        if (matches.length === 0) {
          text = `I couldn't find any events matching "${keywords.join(' ')}". Try a different keyword.`;
        } else {
          text = `Found **${matches.length}** matching event${matches.length !== 1 ? 's' : ''}:\n\n${bulletList(matches, 8)}`;
        }
        break;
      }

      case 'suggest_time': {
        // Extract a potential event title from the message
        const titleMatch2 = userText.match(/(?:suggest|schedule|add|create|plan)\s+(?:a\s+)?(.+?)(?:\s+(?:for|on|at|in|this|next|tomorrow).*)?$/i);
        const suggestedTitle = titleMatch2?.[1]?.trim().replace(/\s*(event|meeting|appointment)$/i, '').trim();
        if (suggestedTitle && suggestedTitle.length > 1) {
          newDraft = { step: 'duration', title: suggestedTitle };
          text = `Sure! Let's add **"${suggestedTitle}"** to your calendar. How long should it be? (e.g. "1 hour", "30 minutes")`;
        } else {
          newDraft = { step: 'title' };
          text = `Let's add a new event. What's the title?`;
        }
        break;
      }

      case 'category_summary': {
        if (events.length === 0) {
          text = `No events yet to summarize.`;
          break;
        }
        const catCount: Record<string, number> = {};
        events.forEach(e => {
          const cat = e.category || 'Uncategorized';
          catCount[cat] = (catCount[cat] ?? 0) + 1;
        });
        const sorted = Object.entries(catCount).sort((a, b) => b[1] - a[1]);
        const lines = sorted.map(([cat, count]) => `• **${cat}**: ${count} event${count !== 1 ? 's' : ''}`);
        text = `Here's your event breakdown by category:\n\n${lines.join('\n')}`;
        actions.push({ label: 'Open Categories', type: 'navigate', tab: 'categories' });
        break;
      }

      case 'weekend': {
        // Find the upcoming Saturday and Sunday
        const d = new Date(t + 'T00:00:00');
        const dayOfWeek = d.getDay();
        const daysToSat = (6 - dayOfWeek + 7) % 7 || 7;
        const sat = addDays(t, daysToSat);
        const sun = addDays(sat, 1);
        const satEvts = eventsInRange(events, sat, sat);
        const sunEvts = eventsInRange(events, sun, sun);
        const total = satEvts.length + sunEvts.length;
        if (total === 0) {
          text = `Your weekend (${formatDate(sat)} – ${formatDate(sun)}) is completely free! 🎉`;
        } else {
          let lines = `**${total}** event${total !== 1 ? 's' : ''} this weekend:\n\n`;
          if (satEvts.length > 0) lines += `**Saturday (${formatDate(sat)}):**\n${bulletList(satEvts)}\n\n`;
          if (sunEvts.length > 0) lines += `**Sunday (${formatDate(sun)}):**\n${bulletList(sunEvts)}`;
          text = lines.trim();
        }
        break;
      }

      case 'thanks': {
        const replies = [
          'Happy to help! 😊',
          'Anytime! Let me know if you need anything else.',
          'You\'re welcome! Anything else I can help with?',
          'Glad I could help! 👍',
        ];
        text = replies[Math.floor(Math.random() * replies.length)];
        break;
      }

      case 'set_reminder': {
        // Extract what the reminder is about
        const reminderMatch = userText.match(
          /remind(?:er)?\s+(?:me\s+)?(?:to\s+|about\s+|for\s+)?(.+?)(?:\s+(?:at|on|by|before|in)\s+.+)?$/i
        );
        const subject = reminderMatch?.[1]?.trim() ?? userText;

        // Try to find a matching event
        const keywords = subject.split(/\s+/).filter(w => w.length > 2);
        const matchedEvent = events
          .filter(e => e.date >= t)
          .find(e => {
            const hay = `${e.title} ${e.description} ${e.category}`.toLowerCase();
            return keywords.some(k => hay.includes(k.toLowerCase()));
          });

        if (matchedEvent) {
          const daysUntil = Math.ceil(
            (new Date(matchedEvent.date + 'T00:00:00').getTime() - new Date(t + 'T00:00:00').getTime())
            / (1000 * 60 * 60 * 24)
          );
          const when = daysUntil === 0 ? 'today' : daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;
          text = `I found **${matchedEvent.title}** on ${formatDate(matchedEvent.date)} (${when}). Want me to set a reminder for it?`;
          actions.push({
            label: 'Set Reminder',
            type: 'create_reminder',
            reminderTitle: `Reminder: ${matchedEvent.title}`,
            reminderBody: `Don't forget: ${matchedEvent.title} on ${formatDate(matchedEvent.date)} at ${formatTime(matchedEvent.startTime)}.`,
          });
        } else {
          text = `Sure! I'll set a reminder for: **"${subject}"**. Tap below to save it to your notifications.`;
          actions.push({
            label: 'Save Reminder',
            type: 'create_reminder',
            reminderTitle: `Reminder: ${subject}`,
            reminderBody: `You asked me to remind you: ${subject}`,
          });
        }
        break;
      }

      case 'study_reminder': {
        // Find upcoming exams/tests/quizzes
        const studyKeywords = /exam|test|quiz|midterm|final|ap |sat|act/i;
        const upcomingExams = events
          .filter(e => e.date >= t && studyKeywords.test(`${e.title} ${e.category}`))
          .sort((a, b) => a.date.localeCompare(b.date));

        if (upcomingExams.length === 0) {
          text = `I don't see any upcoming exams or tests on your calendar. Add one and I can help you plan study sessions!`;
          actions.push({ label: 'Add Event', type: 'navigate', tab: 'schedule' });
        } else {
          const exam = upcomingExams[0];
          const daysUntil = Math.ceil(
            (new Date(exam.date + 'T00:00:00').getTime() - new Date(t + 'T00:00:00').getTime())
            / (1000 * 60 * 60 * 24)
          );
          const urgency = daysUntil <= 1 ? '🚨 That\'s very soon!' : daysUntil <= 3 ? '⚠️ Coming up fast!' : daysUntil <= 7 ? '📚 You have a week.' : '✅ Plenty of time to prepare.';
          text = `Your next upcoming exam/test is **${exam.title}** on ${formatDate(exam.date)} — **${daysUntil} day${daysUntil !== 1 ? 's' : ''} away**. ${urgency}\n\nWant me to set a study reminder?`;
          actions.push({
            label: 'Set Study Reminder',
            type: 'create_reminder',
            reminderTitle: `Study for ${exam.title}`,
            reminderBody: `Start studying for ${exam.title} on ${formatDate(exam.date)}. ${daysUntil} day${daysUntil !== 1 ? 's' : ''} to go!`,
          });
          if (upcomingExams.length > 1) {
            text += `\n\nYou also have ${upcomingExams.length - 1} more upcoming exam${upcomingExams.length > 2 ? 's' : ''}: ${upcomingExams.slice(1, 3).map(e => `**${e.title}** (${formatDate(e.date)})`).join(', ')}.`;
          }
        }
        break;
      }

      case 'check_inactivity': {
        // Look for health/wellness/appointment-type events in the past
        const healthKeywords = /doctor|dentist|checkup|check-up|appointment|therapy|clinic|gym|workout|exercise|physical/i;
        const pastHealthEvents = events
          .filter(e => e.date < t && healthKeywords.test(`${e.title} ${e.category} ${e.description}`))
          .sort((a, b) => b.date.localeCompare(a.date)); // most recent first

        const upcomingHealthEvents = events
          .filter(e => e.date >= t && healthKeywords.test(`${e.title} ${e.category} ${e.description}`));

        if (pastHealthEvents.length === 0 && upcomingHealthEvents.length === 0) {
          text = `I don't see any health or appointment events on your calendar. It might be worth scheduling a checkup or gym session!`;
          actions.push({ label: 'Schedule Appointment', type: 'navigate', tab: 'schedule' });
        } else if (upcomingHealthEvents.length > 0) {
          const next = upcomingHealthEvents.sort((a, b) => a.date.localeCompare(b.date))[0];
          text = `You have an upcoming **${next.title}** on ${formatDate(next.date)} — you're on top of it! 👍`;
        } else {
          const last = pastHealthEvents[0];
          const daysSince = Math.floor(
            (new Date(t + 'T00:00:00').getTime() - new Date(last.date + 'T00:00:00').getTime())
            / (1000 * 60 * 60 * 24)
          );
          const nudge = daysSince > 180 ? '⚠️ That\'s over 6 months ago — might be time to book one!' :
                        daysSince > 90  ? '💡 It\'s been a while. Consider scheduling soon.' :
                                          '✅ Fairly recent.';
          text = `Your last health/appointment event was **${last.title}** on ${formatDate(last.date)} — **${daysSince} days ago**. ${nudge}`;
          if (daysSince > 90) {
            actions.push({
              label: 'Set Reminder to Book',
              type: 'create_reminder',
              reminderTitle: `Book a follow-up: ${last.title}`,
              reminderBody: `It's been ${daysSince} days since your last ${last.title}. Time to schedule another one!`,
            });
            actions.push({ label: 'Schedule Now', type: 'navigate', tab: 'schedule' });
          }
        }
        break;
      }

      case 'draft_email': {
        // Determine which type of email the user wants
        const emailType = this.detectEmailType(userText);

        // Find the event they're referring to
        const emailKeywords = userText.replace(/draft|write|compose|email|can'?t|won'?t|miss|attend|make it|apology|absence|follow.?up|thank|reschedule|cancel|confirm|invite|request|meeting/gi, ' ').trim();
        const words = emailKeywords.split(/\s+/).filter(w => w.length > 2);

        const matchedForEmail = events.find(e => {
          const hay = `${e.title} ${e.description} ${e.category}`.toLowerCase();
          return words.some(w => hay.includes(w.toLowerCase()));
        }) ?? events.filter(e => e.date >= t).sort((a, b) => a.date.localeCompare(b.date))[0];

        if (!matchedForEmail && emailType !== 'general') {
          text = `I don't see a specific event to draft an email for. Try:\n\n` +
            `• "Draft an absence email for my soccer practice"\n` +
            `• "Write a follow-up email for my meeting"\n` +
            `• "Compose a reschedule email for AP Calculus"\n` +
            `• "Draft a thank you email for my interview"\n` +
            `• "Write a meeting request email"\n` +
            `• "Draft a cancellation email for lunch"\n` +
            `• "Write a confirmation email for the appointment"`;
        } else {
          let emailDraft: string;
          let emailLabel: string;

          switch (emailType) {
            case 'follow_up':
              emailDraft = this.buildFollowUpEmail(matchedForEmail!);
              emailLabel = 'follow-up';
              break;
            case 'thank_you':
              emailDraft = this.buildThankYouEmail(matchedForEmail!);
              emailLabel = 'thank you';
              break;
            case 'reschedule':
              emailDraft = this.buildRescheduleEmail(matchedForEmail!);
              emailLabel = 'reschedule request';
              break;
            case 'cancellation':
              emailDraft = this.buildCancellationEmail(matchedForEmail!);
              emailLabel = 'cancellation';
              break;
            case 'meeting_request':
              emailDraft = this.buildMeetingRequestEmail(matchedForEmail!);
              emailLabel = 'meeting request';
              break;
            case 'invitation':
              emailDraft = this.buildInvitationEmail(matchedForEmail!);
              emailLabel = 'invitation';
              break;
            case 'confirmation':
              emailDraft = this.buildConfirmationEmail(matchedForEmail!);
              emailLabel = 'confirmation';
              break;
            case 'absence':
            default:
              emailDraft = this.buildAbsenceEmail(matchedForEmail!);
              emailLabel = 'absence';
              break;
          }

          text = `Here's a draft **${emailLabel}** email for **${matchedForEmail!.title}** on ${formatDate(matchedForEmail!.date)}:\n\n---\n\n${emailDraft}\n\n---\n\nTap below to copy it to your clipboard.`;
          actions.push({
            label: '📋 Copy Email Draft',
            type: 'copy_text',
            copyText: emailDraft,
          });

          // Offer a reminder for absence/cancellation emails
          if (emailType === 'absence' || emailType === 'cancellation') {
            actions.push({
              label: '🔔 Set Absence Reminder',
              type: 'create_reminder',
              reminderTitle: `Absence: ${matchedForEmail!.title}`,
              reminderBody: `You marked yourself as absent for ${matchedForEmail!.title} on ${formatDate(matchedForEmail!.date)}.`,
            });
          }
        }
        break;
      }

      case 'smart_suggestions': {
        const suggestions = this.remindersService.suggestReminders(events, t);
        if (suggestions.length === 0) {
          text = `I don't have any smart reminder suggestions right now. Add more events to your calendar and I'll look for patterns!`;
        } else {
          text = `Here are some smart reminders I suggest based on your calendar:\n\n`;
          suggestions.forEach((s, i) => {
            text += `${i + 1}. **${s.text}** — ${s.reason}\n`;
            actions.push({
              label: `Set: ${s.text}`,
              type: 'create_reminder',
              reminderTitle: s.text,
              reminderBody: s.reason,
            });
          });
        }
        break;
      }

      case 'list_reminders': {
        const reminders = this.remindersService.getReminders();
        const active = reminders.filter(r => r.active);
        if (active.length === 0) {
          text = `You have no active reminders. Set one with: "Remind me to water the plants every Tuesday"`;
        } else {
          text = `You have **${active.length}** active reminder${active.length !== 1 ? 's' : ''}:\n\n`;
          active.forEach(r => {
            const due = this.remindersService.getNextDue(r, t);
            text += `• **${r.text}** — ${r.frequency === 'daily' ? 'every day' : `every ${r.daysOfWeek?.map(d => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ')}`} at ${formatTime(r.time)} (next: ${formatDate(due)})\n`;
          });
        }
        break;
      }

      case 'delete_reminder': {
        // Try to match a reminder text
        const reminders = this.remindersService.getReminders();
        const active = reminders.filter(r => r.active);
        const match = active.find(r => userText.toLowerCase().includes(r.text.toLowerCase()));
        if (match) {
          this.remindersService.toggleReminder(match.id, false);
          text = `I've disabled the reminder: **"${match.text}"**.`;
        } else {
          text = `I couldn't find that reminder. Type **list reminders** to see your active ones.`;
        }
        break;
      }

      default: {
        // Fallback: try a fuzzy search across all events
        const words = userText.split(/\s+/).filter(w => w.length > 3);
        const matches = events.filter(e => {
          const haystack = `${e.title} ${e.description} ${e.category}`.toLowerCase();
          return words.some(w => haystack.includes(w.toLowerCase()));
        }).sort((a, b) => a.date.localeCompare(b.date));

        if (matches.length > 0) {
          text = `I found **${matches.length}** event${matches.length !== 1 ? 's' : ''} that might be relevant:\n\n${bulletList(matches, 6)}`;
        } else {
          text = `I'm not sure I understood that. Try asking things like:\n\n` +
            `• "What's on today?"\n` +
            `• "Show me this week's schedule"\n` +
            `• "Find my soccer practice"\n` +
            `• "When am I free?"\n` +
            `• "What's my next event?"\n\n` +
            `Or type **help** to see everything I can do.`;
        }
        break;
      }
    }

    return {
      message: {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        role: 'assistant',
        text: this.translateAiText(text),
        timestamp: new Date(),
        actions: actions.length > 0 ? actions : undefined,
      },
      draft: newDraft,
    };
  }

  /**
   * Render markdown-style bold (**text**) and italic (_text_) to HTML.
   * Escapes HTML first — this text can come from user input, the AI (Bedrock),
   * or the translation model, none of which are trusted to emit raw markup,
   * and the result is injected via [innerHTML].
   */
  renderMarkdown(text: string): string {
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    return escaped
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/_(.+?)_/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
  }

  // ── Event creation wizard ─────────────────────────────────────────────────

  /**
   * Continue a multi-turn event creation wizard.
   * Each call advances the draft one step and returns the next prompt.
   */
  private continueWizard(
    userText: string,
    events: CalendarEvent[],
    draft: EventDraft,
    t: string,
  ): { message: ChatMessage; draft: EventDraft | null } {
    const lower = userText.toLowerCase().trim();

    // Allow cancellation at any step
    if (/\b(cancel|stop|never mind|forget it|abort|quit)\b/i.test(lower)) {
      return this.wizardMsg('No problem — event creation cancelled. Let me know if you need anything else!', null);
    }

    switch (draft.step) {

      case 'title': {
        const title = userText.trim();
        if (title.length < 2) {
          return this.wizardMsg('Please give the event a name (at least 2 characters).', draft);
        }
        // After getting the title, ask for the date
        return this.wizardMsg(
          `Got it — **"${title}"**. 📅 **What date is it on?** (e.g. "tomorrow", "next Monday", "July 15")`,
          { ...draft, step: 'date', title },
        );
      }

      case 'duration': {
        const dur = this.parseDuration(lower);
        if (!dur) {
          return this.wizardMsg(
            `I didn't catch that. How long is the event? Try something like "1 hour", "45 minutes", or "2.5 hours".`,
            draft,
          );
        }

        // If we already have a start time and date, compute endTime and move to category
        if (draft.startTime && draft.date) {
          const endTime = this.addMinutesToTime(draft.startTime, dur);
          return this.buildConfirmStep(
            { ...draft, durationMin: dur },
            draft.date, draft.startTime, endTime, t,
          );
        }

        // If we have a start time but no date, ask for the date
        if (draft.startTime) {
          const endTime = this.addMinutesToTime(draft.startTime, dur);
          return this.wizardMsg(
            `Got it — **${dur} minutes** (${formatTime(draft.startTime)}–${formatTime(endTime)}). What date? (e.g. "tomorrow", "next Monday", "July 15")`,
            { ...draft, step: 'date', durationMin: dur, endTime },
          );
        }

        // No pre-existing time — ask for the date and time
        // Don't auto-suggest slots; ask the user directly
        return this.wizardMsg(
          `Got it — **${dur} minutes**. What date do you want this on? (e.g. "tomorrow", "next Monday", "July 15")\n\n_Or say "suggest" if you'd like me to find an open slot._`,
          { ...draft, step: 'date', durationMin: dur },
        );
      }

      case 'date': {
        // Check if user typed a number to pick a slot (e.g. "1", "2", "option 1", "pick 2")
        const slotPick = lower.match(/^(?:option\s*|pick\s*|#\s*)?([123])\s*$/);
        if (slotPick && draft.suggestedSlots) {
          const idx = parseInt(slotPick[1]) - 1;
          if (idx >= 0 && idx < draft.suggestedSlots.length) {
            const slot = draft.suggestedSlots[idx];
            return this.buildConfirmStep(draft, slot.date, slot.startTime, slot.endTime, t);
          }
        }

        // Handle "suggest" — user explicitly asks for AI time suggestions
        if (/\b(suggest|find a slot|pick for me|any open slot|find me a time)\b/i.test(lower)) {
          const dur = draft.durationMin ?? 60;
          const slots = this.scheduler.getSuggestions(draft.title!, dur, events);
          if (slots.length === 0) {
            return this.wizardMsg(
              `I couldn't find a free slot in the next 3 weeks. Please tell me a specific date (e.g. "next Monday", "July 15").`,
              draft,
            );
          }
          const slotLines = slots.map((s, i) =>
            `**${i + 1}.** ${formatDate(s.date)} · ${formatTime(s.startTime)}–${formatTime(s.endTime)} — _${s.reason}_`
          ).join('\n');
          const slotActions: ChatAction[] = slots.map((s, i) => ({
            label: `Pick option ${i + 1}`,
            type: 'pick_slot' as const,
            slotIndex: i,
          }));
          slotActions.push({ label: 'Enter a date instead', type: 'pick_slot', slotIndex: -1 });
          return {
            message: {
              id: `msg_${Date.now()}_w`,
              role: 'assistant',
              text: `Here are open slots for **"${draft.title}"** (${dur} min):\n\n${slotLines}\n\nPick one, or tell me a specific date.`,
              timestamp: new Date(),
              actions: slotActions,
            },
            draft: { ...draft, suggestedSlots: slots },
          };
        }

        // Try to parse a natural date
        const parsedDate = this.parseDate(lower, t);
        if (!parsedDate) {
          const hint = draft.suggestedSlots?.length
            ? `Try typing **1**, **2**, or **3** to pick a slot, or a date like "tomorrow", "next Monday", "May 25".`
            : `Try a date like "tomorrow", "next Monday", "May 25", or "in 3 days". Or say "suggest" for me to find an open slot.`;
          return this.wizardMsg(hint, draft);
        }

        // If we already have a startTime (from initial parse), go straight to confirm steps
        if (draft.startTime) {
          const dur = draft.durationMin ?? 60;
          const endTime = draft.endTime || this.addMinutesToTime(draft.startTime, dur);
          return this.buildConfirmStep(draft, parsedDate, draft.startTime, endTime, t);
        }

        // No startTime yet — ask the user what time
        return this.wizardMsg(
          `Got it — **${formatDate(parsedDate)}**. 🕐 **What time?** You can say:\n• A range like **"9am to 5pm"**\n• Or just the start time like **"9am"** and I'll ask when it ends.`,
          { ...draft, step: 'time', date: parsedDate },
        );
      }

      case 'time': {
        // Check if user provided a range like "9am to 5pm" or "9-5"
        const rangeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|until|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
        if (rangeMatch) {
          const startTime = this.parseTimeStr(rangeMatch[1], rangeMatch[2], rangeMatch[3]);
          const endTime = this.parseTimeStr(rangeMatch[4], rangeMatch[5], rangeMatch[6]);
          const durMin = (parseInt(endTime.split(':')[0]) * 60 + parseInt(endTime.split(':')[1]))
            - (parseInt(startTime.split(':')[0]) * 60 + parseInt(startTime.split(':')[1]));
          return this.buildConfirmStep({ ...draft, durationMin: durMin }, draft.date!, startTime, endTime, t);
        }

        // Parse a single time
        const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
        if (!timeMatch) {
          return this.wizardMsg(
            `I didn't catch that. What time? You can say:\n• A range like **"9am to 5pm"**\n• Or just the start time like **"9am"** and I'll ask how long.`,
            draft,
          );
        }
        const startTime = this.parseTimeStr(timeMatch[1], timeMatch[2], timeMatch[3]);

        // If we already have a duration, compute end and move on
        if (draft.durationMin) {
          const endTime = this.addMinutesToTime(startTime, draft.durationMin);
          return this.buildConfirmStep(draft, draft.date!, startTime, endTime, t);
        }

        // No duration yet — ask for end time or duration
        return this.wizardMsg(
          `Starts at **${formatTime(startTime)}**. When does it end? (e.g. "5pm", "10:30am")\n\n_Or tell me how long: "1 hour", "8 hours", "30 minutes"._`,
          { ...draft, step: 'endtime', startTime },
        );
      }

      case 'endtime': {
        // Try parsing as a duration first
        const dur = this.parseDuration(lower);
        if (dur) {
          const endTime = this.addMinutesToTime(draft.startTime!, dur);
          return this.buildConfirmStep({ ...draft, durationMin: dur }, draft.date!, draft.startTime!, endTime, t);
        }

        // Try parsing as a time
        const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
        if (timeMatch) {
          const endTime = this.parseTimeStr(timeMatch[1], timeMatch[2], timeMatch[3]);
          const startMin = parseInt(draft.startTime!.split(':')[0]) * 60 + parseInt(draft.startTime!.split(':')[1]);
          const endMin = parseInt(endTime.split(':')[0]) * 60 + parseInt(endTime.split(':')[1]);
          if (endMin <= startMin) {
            return this.wizardMsg(
              `The end time needs to be after **${formatTime(draft.startTime!)}**. What time does it end?`,
              draft,
            );
          }
          const durationMin = endMin - startMin;
          return this.buildConfirmStep({ ...draft, durationMin }, draft.date!, draft.startTime!, endTime, t);
        }

        return this.wizardMsg(
          `I didn't catch that. When does it end? (e.g. "5pm", "10:30am") or how long is it? (e.g. "1 hour", "8 hours")`,
          draft,
        );
      }

      case 'category': {
        const inferred = inferCategory(draft.title ?? '');
        if (/\b(skip|default|same|sure|none)\b/i.test(lower)) {
          const updated = { ...draft, category: inferred.category, color: inferred.color };
          return this.buildFinalConfirm(updated);
        }
        const category = userText.trim();
        if (category.length < 1) {
          return this.wizardMsg(`Please enter a category name, or type "skip" to use **${inferred.category}**.`, draft);
        }
        const updated = { ...draft, category, color: draft.color || inferred.color };
        return this.buildFinalConfirm(updated);
      }

      case 'description': {
        if (/\b(skip|none|no|nope|nothing|n\/a)\b/i.test(lower)) {
          const updated = { ...draft, description: '' };
          return this.buildFinalConfirm(updated);
        }
        const description = userText.trim();
        const updated = { ...draft, description };
        return this.buildFinalConfirm(updated);
      }

      case 'confirm': {
        // Handle optional "category: ___" command
        const catMatch = userText.match(/^categor(?:y|ie)?[:\s]+(.+)$/i);
        if (catMatch) {
          const newCat = catMatch[1].trim();
          const updated = { ...draft, category: newCat };
          return this.buildFinalConfirm(updated);
        }

        // Handle optional "description: ___" or "note: ___" command
        const descMatch = userText.match(/^(?:description|desc|note|notes)[:\s]+(.+)$/i);
        if (descMatch) {
          const newDesc = descMatch[1].trim();
          const updated = { ...draft, description: newDesc };
          return this.buildFinalConfirm(updated);
        }

        // Handle optional "share: email" command
        const shareMatch = userText.match(/^share[:\s]+(.+)$/i);
        if (shareMatch) {
          const email = shareMatch[1].trim().toLowerCase();
          const existing = (draft as any).sharedWith ?? [];
          const updated = { ...draft, sharedWith: [...existing, email] } as any;
          return this.buildFinalConfirm(updated);
        }

        if (/\b(yes|yeah|yep|sure|ok|okay|confirm|add it|do it|looks good|perfect|great|sounds good|yup|correct)\b/i.test(lower)) {
          // Directly return the confirm action — no second tap needed
          return {
            message: {
              id: `msg_${Date.now()}_w`,
              role: 'assistant',
              text: `Adding it now…`,
              timestamp: new Date(),
              actions: [{
                label: '✅ Add to Calendar',
                type: 'confirm_create_event',
                payload: {
                  title:       draft.title!,
                  date:        draft.date!,
                  startTime:   draft.startTime!,
                  endTime:     draft.endTime!,
                  description: draft.description ?? '',
                  color:       draft.color ?? inferCategory(draft.title ?? '').color,
                  category:    draft.category ?? inferCategory(draft.title ?? '').category,
                  sharedWith:  (draft as any).sharedWith ?? [],
                },
              }],
            },
            draft: null,
          };
        }
        if (/\b(no|nope|cancel|change|edit|different|wrong|not right)\b/i.test(lower)) {
          return this.wizardMsg(
            `No problem! What would you like to change?\n\n• Say a new date like "next Friday"\n• Say a new time like "2pm"\n• Or say **cancel** to start over`,
            { ...draft, step: 'date' },
          );
        }
        return this.wizardMsg(`Say **yes** to add it, or you can:\n• **"category: Work"** to change category\n• **"description: some note"** to add details\n• **"share: friend@email.com"** to share it\n• **"change"** to pick a new date/time`, draft);
      }

      default:
        return this.wizardMsg(`Something went wrong with the wizard. Say **cancel** to start over.`, null);
    }
  }

  /** Pick a slot by index (called from dashboard when user taps a slot button). */
  pickSlot(
    slotIndex: number,
    draft: EventDraft,
    events: CalendarEvent[],
    t: string,
  ): { message: ChatMessage; draft: EventDraft | null } {
    _currentLang = this.i18n.getLanguage();
    if (slotIndex === -1) {
      // User wants to type a date manually
      return this.wizardMsg(
        `Sure! What date works for you? (e.g. "next Monday", "May 25", "tomorrow")`,
        { ...draft, step: 'date', suggestedSlots: draft.suggestedSlots },
      );
    }
    const slots = draft.suggestedSlots ?? [];
    if (slotIndex < 0 || slotIndex >= slots.length) {
      return this.wizardMsg(`That option doesn't exist. Please pick 1–${slots.length}.`, draft);
    }
    const slot = slots[slotIndex];
    return this.buildConfirmStep(draft, slot.date, slot.startTime, slot.endTime, t);
  }

  private buildConfirmStep(
    draft: EventDraft,
    date: string,
    startTime: string,
    endTime: string,
    _t: string,
  ): { message: ChatMessage; draft: EventDraft | null } {
    // Go directly to final confirm — category/description/sharing are optional
    const inferred = inferCategory(draft.title ?? '');
    const updated: EventDraft = {
      ...draft,
      date,
      startTime,
      endTime,
      category: draft.category || inferred.category,
      color: draft.color || inferred.color,
    };
    return this.buildFinalConfirm(updated);
  }

  private askForDescription(draft: EventDraft, _inferred: { category: string; color: string }): { message: ChatMessage; draft: EventDraft | null } {
    return this.wizardMsg(
      `Any description or notes? (e.g. "Meeting with client about Q3 goals")\n\n_Type "skip" or "none" if you don't need one._`,
      { ...draft, step: 'description' },
    );
  }

  private buildFinalConfirm(
    draft: EventDraft,
  ): { message: ChatMessage; draft: EventDraft | null } {
    const inferred = inferCategory(draft.title ?? '');
    const category = draft.category || inferred.category;
    const color    = draft.color    || inferred.color;

    const updated: EventDraft = { ...draft, step: 'confirm', category, color };
    const descLine = draft.description ? `\n📝 ${draft.description}` : '';
    const shareLine = (draft as any).sharedWith?.length ? `\n👥 Shared with: ${(draft as any).sharedWith.join(', ')}` : '';
    const actions: ChatAction[] = [
      {
        label: '✅ Add to Calendar',
        type: 'confirm_create_event',
        payload: {
          title:       draft.title!,
          date:        draft.date!,
          startTime:   draft.startTime!,
          endTime:     draft.endTime!,
          description: draft.description ?? '',
          color,
          category,
          sharedWith:  (draft as any).sharedWith ?? [],
        },
      },
      { label: 'Change date/time', type: 'pick_slot', slotIndex: -1 },
    ];
    return {
      message: {
        id: `msg_${Date.now()}_w`,
        role: 'assistant',
        text: `Here's the event I'll create:\n\n📌 **${draft.title}**\n📅 ${formatDate(draft.date!)}\n🕐 ${formatTime(draft.startTime!)} – ${formatTime(draft.endTime!)}\n🏷️ ${category}${descLine}${shareLine}\n\nSay **yes** to add it, or you can optionally:\n• Say **"category: ___"** to change the category\n• Say **"description: ___"** to add a note\n• Say **"share: email@example.com"** to share it with someone\n• Say **"change"** to pick a different date/time`,
        timestamp: new Date(),
        actions,
      },
      draft: updated,
    };
  }

  private wizardMsg(text: string, draft: EventDraft | null): { message: ChatMessage; draft: EventDraft | null } {
    return {
      message: {
        id: `msg_${Date.now()}_w`,
        role: 'assistant',
        text: this.translateAiText(text),
        timestamp: new Date(),
      },
      draft,
    };
  }

  // ── Parsing helpers ───────────────────────────────────────────────────────

  private parseDuration(text: string): number | null {
    // "1 hour", "2 hours", "30 minutes", "30 mins", "1.5 hours", "90 min", "1h30m", "1h"
    const hourMin = text.match(/(\d+(?:\.\d+)?)\s*h(?:our)?s?\s*(?:(\d+)\s*m(?:in)?s?)?/i);
    if (hourMin) {
      const h = parseFloat(hourMin[1]);
      const m = parseInt(hourMin[2] ?? '0');
      return Math.round(h * 60) + m;
    }
    const minOnly = text.match(/(\d+)\s*m(?:in(?:ute)?s?)?/i);
    if (minOnly) return parseInt(minOnly[1]);
    const numOnly = text.match(/^(\d+)$/);
    if (numOnly) {
      const n = parseInt(numOnly[1]);
      return n <= 8 ? n * 60 : n; // treat small numbers as hours
    }
    return null;
  }

  private parseDate(text: string, todayStr: string): string | null {
    const t = new Date(todayStr + 'T00:00:00');

    if (/\btoday\b/i.test(text)) return todayStr;
    if (/\btomorrow\b/i.test(text)) return addDays(todayStr, 1);
    if (/\bday after tomorrow\b/i.test(text)) return addDays(todayStr, 2);

    // "next Monday" / "this Friday" etc.
    const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const nextDay = text.match(/\b(?:next\s+|this\s+)?(\w+day)\b/i);
    if (nextDay) {
      const idx = dayNames.indexOf(nextDay[1].toLowerCase());
      if (idx !== -1) {
        const cur = t.getDay();
        let diff = idx - cur;
        if (diff <= 0) diff += 7;
        return addDays(todayStr, diff);
      }
    }

    // "in X days"
    const inDays = text.match(/\bin\s+(\d+)\s+days?\b/i);
    if (inDays) return addDays(todayStr, parseInt(inDays[1]));

    // "May 25", "25 May", "5/25", "05-25"
    const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const monthName = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\b/i);
    if (monthName) {
      const mIdx = months.findIndex(m => monthName[1].toLowerCase().startsWith(m));
      if (mIdx !== -1) {
        const day = parseInt(monthName[2]);
        const year = t.getFullYear();
        const candidate = `${year}-${String(mIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        return candidate >= todayStr ? candidate : `${year + 1}-${String(mIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
    // "25 May"
    const dayMonth = text.match(/\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i);
    if (dayMonth) {
      const mIdx = months.findIndex(m => dayMonth[2].toLowerCase().startsWith(m));
      if (mIdx !== -1) {
        const day = parseInt(dayMonth[1]);
        const year = t.getFullYear();
        const candidate = `${year}-${String(mIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        return candidate >= todayStr ? candidate : `${year + 1}-${String(mIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
    // "5/25" or "05-25"
    const slashDate = text.match(/\b(\d{1,2})[\/\-](\d{1,2})\b/);
    if (slashDate) {
      const m = parseInt(slashDate[1]);
      const d = parseInt(slashDate[2]);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        const year = t.getFullYear();
        const candidate = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        return candidate >= todayStr ? candidate : `${year + 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
    // ISO date
    const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (iso) return iso[1];

    return null;
  }

  private addMinutesToTime(hhmm: string, minutes: number): string {
    const [h, m] = hhmm.split(':').map(Number);
    const total = h * 60 + m + minutes;
    return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  /**
   * Parse a natural language event description in one shot.
   * Handles: "volleyball at 4 every Wednesday", "meeting tomorrow at 2pm for 1 hour",
   * "dentist appointment on June 5 at 9am", "soccer practice every Tuesday and Thursday at 3:30"
   */
  private parseNaturalEvent(text: string, todayStr: string): {
    title: string | null;
    date: string | null;
    startTime: string | null;
    endTime: string | null;
    durationMin: number | null;
    category: string | null;
    recurring: { dayOfWeek: number; weeks: number } | null;
  } | null {
    const lower = text.toLowerCase();

    // Extract time (e.g. "at 4", "at 4pm", "at 16:00", "from 3:30 to 5")
    let startTime: string | null = null;
    let endTime: string | null = null;
    let durationMin: number | null = null;

    // "from X to Y" pattern
    const fromTo = lower.match(/from\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|until|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (fromTo) {
      startTime = this.parseTimeStr(fromTo[1], fromTo[2], fromTo[3]);
      endTime = this.parseTimeStr(fromTo[4], fromTo[5], fromTo[6]);
    }

    // "at X" pattern
    if (!startTime) {
      const atTime = lower.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
      if (atTime) {
        startTime = this.parseTimeStr(atTime[1], atTime[2], atTime[3]);
      }
    }

    // Duration: "for 1 hour", "for 90 minutes"
    const durMatch = lower.match(/for\s+(\d+(?:\.\d+)?)\s*(hour|hr|h|minute|min|m)s?/i);
    if (durMatch) {
      const n = parseFloat(durMatch[1]);
      const unit = durMatch[2].charAt(0).toLowerCase();
      durationMin = unit === 'h' ? Math.round(n * 60) : Math.round(n);
    }

    if (startTime && !endTime && durationMin) {
      endTime = this.addMinutesToTime(startTime, durationMin);
    }

    // Recurring: "every Monday", "every Wednesday", "every Tue and Thu"
    let recurring: { dayOfWeek: number; weeks: number } | null = null;
    const dayNames: Record<string, number> = {
      'sunday': 0, 'sun': 0, 'monday': 1, 'mon': 1, 'tuesday': 2, 'tue': 2, 'tues': 2,
      'wednesday': 3, 'wed': 3, 'thursday': 4, 'thu': 4, 'thur': 4, 'thurs': 4,
      'friday': 5, 'fri': 5, 'saturday': 6, 'sat': 6,
    };
    const everyMatch = lower.match(/every\s+(\w+)/i);
    if (everyMatch) {
      const dayStr = everyMatch[1].toLowerCase();
      if (dayNames[dayStr] !== undefined) {
        // Check for "for X weeks"
        const weeksMatch = lower.match(/for\s+(\d+)\s*weeks?/i);
        const weeks = weeksMatch ? parseInt(weeksMatch[1]) : 12;
        recurring = { dayOfWeek: dayNames[dayStr], weeks };
      }
    }

    // Parse a specific date if not recurring
    let date: string | null = null;
    if (!recurring) {
      date = this.parseDate(lower, todayStr);
    }

    // Extract title — strip time/date/recurrence info to get the event name
    let title: string | null = text
      .replace(/^(can you|please|could you|i want to|i need to|i'd like to)\s+/i, '')
      .replace(/^(add|create|schedule|put|book|set up|arrange|new|i have)\s+(an?\s+|a new\s+)?/i, '')
      .replace(/\s+(to|on|in|for)\s+(my\s+)?(calendar|agenda|schedule)\s*$/i, '')
      .replace(/\s*(?:at|from)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?(?:\s*(?:to|until|-)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/i, '')
      .replace(/\s*every\s+\w+(?:\s+and\s+\w+)?/i, '')
      .replace(/\s*(?:on|this|next)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)/i, '')
      .replace(/\s*(?:on\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}/i, '')
      .replace(/\s*for\s+\d+(?:\.\d+)?\s*(?:hour|hr|h|minute|min|m)s?/i, '')
      .replace(/\s*for\s+\d+\s*weeks?/i, '')
      .replace(/\s+(event|called|named)$/i, '')
      .trim();

    // Clean up leftover prepositions
    title = title.replace(/\s+(at|on|from|to|for|in|every)\s*$/i, '').trim();

    if (!title || title.length < 2) title = null;

    // Only return if we got at least a title
    if (!title && !startTime && !recurring) return null;

    return { title, date, startTime, endTime, durationMin, category: null, recurring };
  }

  private parseTimeStr(hourStr: string, minStr: string | undefined, ampm: string | undefined): string {
    let h = parseInt(hourStr);
    const m = minStr ? parseInt(minStr) : 0;
    if (ampm) {
      const ap = ampm.toLowerCase();
      if (ap === 'pm' && h !== 12) h += 12;
      if (ap === 'am' && h === 12) h = 0;
    } else {
      // No am/pm — guess: if hour <= 6, assume PM (e.g. "at 4" = 4 PM)
      if (h >= 1 && h <= 6) h += 12;
    }
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /** Build a polite absence/excuse email for a given event. */
  private buildAbsenceEmail(event: CalendarEvent): string {
    const dateStr = formatDate(event.date);
    const timeStr = `${formatTime(event.startTime)}–${formatTime(event.endTime)}`;
    const subject = `Unable to Attend: ${event.title}`;
    return `Subject: ${subject}\n\nHello,\n\nI hope this message finds you well. I'm writing to let you know that I will unfortunately be unable to attend ${event.title} scheduled for ${dateStr} from ${timeStr}.\n\nI apologize for any inconvenience this may cause. Please let me know if there is anything I can do to prepare in advance or if there are materials I should review afterward.\n\nThank you for your understanding.\n\nBest regards`;
  }

  /** Detect the type of email the user wants to draft. */
  private detectEmailType(text: string): string {
    const lower = text.toLowerCase();
    if (/follow.?up/i.test(lower)) return 'follow_up';
    if (/thank.?(you|s)/i.test(lower)) return 'thank_you';
    if (/reschedul/i.test(lower)) return 'reschedule';
    if (/cancel/i.test(lower)) return 'cancellation';
    if (/meeting request/i.test(lower) || /request.*(meeting|call)/i.test(lower)) return 'meeting_request';
    if (/invit/i.test(lower)) return 'invitation';
    if (/confirm/i.test(lower)) return 'confirmation';
    if (/absence|can'?t (make|attend)|won'?t be|miss|excuse/i.test(lower)) return 'absence';
    return 'absence'; // default
  }

  /** Build a follow-up email after an event. */
  private buildFollowUpEmail(event: CalendarEvent): string {
    const dateStr = formatDate(event.date);
    const subject = `Following Up: ${event.title}`;
    return `Subject: ${subject}\n\nHello,\n\nI wanted to follow up regarding ${event.title} that took place on ${dateStr}.\n\nThank you for your time and the discussion we had. I wanted to check in on the next steps we discussed and see if there's anything else I can help with or prepare for.\n\nPlease let me know if you'd like to schedule a follow-up or if there's any additional information you need from me.\n\nLooking forward to hearing from you.\n\nBest regards`;
  }

  /** Build a thank you email for an event. */
  private buildThankYouEmail(event: CalendarEvent): string {
    const dateStr = formatDate(event.date);
    const subject = `Thank You — ${event.title}`;
    return `Subject: ${subject}\n\nHello,\n\nI wanted to take a moment to thank you for ${event.title} on ${dateStr}. I really appreciated the time and effort that went into it.\n\nIt was a valuable experience and I'm grateful for the opportunity. I look forward to any future sessions or events.\n\nThank you again for everything.\n\nBest regards`;
  }

  /** Build a reschedule request email. */
  private buildRescheduleEmail(event: CalendarEvent): string {
    const dateStr = formatDate(event.date);
    const timeStr = `${formatTime(event.startTime)}–${formatTime(event.endTime)}`;
    const subject = `Reschedule Request: ${event.title}`;
    return `Subject: ${subject}\n\nHello,\n\nI hope this message finds you well. I'm writing to request a reschedule for ${event.title}, currently planned for ${dateStr} from ${timeStr}.\n\nDue to an unavoidable conflict, I'm unable to make the originally scheduled time. Would it be possible to move this to a different date or time? I'm flexible and happy to work around your availability.\n\nI apologize for any inconvenience and appreciate your understanding.\n\nBest regards`;
  }

  /** Build a cancellation email. */
  private buildCancellationEmail(event: CalendarEvent): string {
    const dateStr = formatDate(event.date);
    const timeStr = `${formatTime(event.startTime)}–${formatTime(event.endTime)}`;
    const subject = `Cancellation Notice: ${event.title}`;
    return `Subject: ${subject}\n\nHello,\n\nI'm writing to inform you that I need to cancel ${event.title} scheduled for ${dateStr} from ${timeStr}.\n\nI sincerely apologize for the late notice and any inconvenience this may cause. If possible, I'd be happy to reschedule at a time that works for everyone.\n\nPlease let me know how you'd like to proceed.\n\nBest regards`;
  }

  /** Build a meeting request email. */
  private buildMeetingRequestEmail(event: CalendarEvent): string {
    const dateStr = formatDate(event.date);
    const timeStr = `${formatTime(event.startTime)}–${formatTime(event.endTime)}`;
    const subject = `Meeting Request: ${event.title}`;
    return `Subject: ${subject}\n\nHello,\n\nI'd like to request a meeting regarding ${event.title}. I have it tentatively scheduled for ${dateStr} from ${timeStr}.\n\nThe purpose of this meeting is to discuss ${event.description || 'the relevant topics and next steps'}.\n\nPlease let me know if this time works for you, or suggest an alternative that fits your schedule better.\n\nThank you, and I look forward to connecting.\n\nBest regards`;
  }

  /** Build an invitation email for an event. */
  private buildInvitationEmail(event: CalendarEvent): string {
    const dateStr = formatDate(event.date);
    const timeStr = `${formatTime(event.startTime)}–${formatTime(event.endTime)}`;
    const subject = `You're Invited: ${event.title}`;
    return `Subject: ${subject}\n\nHello,\n\nI'd like to invite you to ${event.title} on ${dateStr} from ${timeStr}.\n\n${event.description ? `Details: ${event.description}\n\n` : ''}I hope you can make it! Please let me know if you're available and I'll send over any additional details you might need.\n\nLooking forward to seeing you there.\n\nBest regards`;
  }

  /** Build a confirmation email for an event. */
  private buildConfirmationEmail(event: CalendarEvent): string {
    const dateStr = formatDate(event.date);
    const timeStr = `${formatTime(event.startTime)}–${formatTime(event.endTime)}`;
    const subject = `Confirmed: ${event.title}`;
    return `Subject: ${subject}\n\nHello,\n\nI'm writing to confirm my attendance at ${event.title} on ${dateStr} from ${timeStr}.\n\n${event.description ? `I understand the details are: ${event.description}\n\n` : ''}Please let me know if there's anything I should prepare or bring. I'm looking forward to it.\n\nThank you.\n\nBest regards`;
  }
}
