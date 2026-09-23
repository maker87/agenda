import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  extractTitle,
  inferCategory,
  minutesToTime,
  parseDateTime,
  parseDuration,
  timeToMinutes,
  toDateKey,
  type EventCategory,
} from '../../services/nl-datetime.util';
import {
  findConflicts,
  findFreeSlots,
  formatSlotRange,
  formatSlotTime,
  suggestAlternativeSlots,
  toBusyBlock,
  type BusyBlock,
  type Slot,
  type WorkingHours,
} from '../../services/availability.util';
import { DEFAULT_PREFERENCES } from '../../services/user-preferences.service';

/** An event living only in the sandbox's in-memory calendar. */
interface SandboxEvent {
  id: number;
  title: string;
  /** Which day it sits on, as a "YYYY-MM-DD" key. */
  date: string;
  /** Minutes since midnight. */
  start: number;
  end: number;
  category: EventCategory;
  /** True for the seeded events, so a reset can restore just those. */
  seeded: boolean;
}

interface SandboxMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  /** Tappable alternative times offered when a request hit a conflict. */
  options?: Slot[];
}

/**
 * A working conversational scheduler for the landing page.
 *
 * Everything runs in memory against a seeded day: no sign-in, no OAuth, no
 * network. The point is that a visitor can type a real sentence and watch a
 * real conflict get resolved, so the parsing and availability logic here is
 * the same code the app uses rather than a scripted demo.
 *
 * The calendar spans days rather than one day: "tomorrow at noon" books on
 * tomorrow and the agenda panel follows, showing whichever date was last
 * talked about. Conflicts and free slots are therefore always asked of a
 * single date.
 */
@Component({
  selector: 'app-interactive-sandbox',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './interactive-sandbox.component.html',
  styleUrl: './interactive-sandbox.component.css',
})
export class InteractiveSandboxComponent implements OnInit {
  readonly quickActions = [
    { label: '+ Quick Event', prompt: 'Schedule a project sync tomorrow at 2pm for 45 minutes' },
    { label: "Check Today's Agenda", prompt: "What's on my agenda today?" },
    { label: 'Find Free Slot', prompt: 'Find me a free 30 minute slot today' },
  ];

  messages: SandboxMessage[] = [];
  events: SandboxEvent[] = [];
  input = '';

  /** The day the agenda panel shows. Every reply that names a date moves it. */
  activeDate = '';

  /** The event a follow-up like "actually, make it 4pm" would act on. */
  private lastEventId: number | null = null;
  /** Set aside while the user picks one of the offered alternative times. */
  private pending: { title: string; category: EventCategory; duration: number; date: string } | null = null;

  private nextId = 1;
  private readonly today = new Date();
  private readonly todayKey = toDateKey(this.today);
  private readonly tomorrowKey = toDateKey(
    new Date(this.today.getFullYear(), this.today.getMonth(), this.today.getDate() + 1),
  );

  private readonly hours: WorkingHours = {
    start: timeToMinutes(DEFAULT_PREFERENCES.workStart) ?? 9 * 60,
    end: timeToMinutes(DEFAULT_PREFERENCES.workEnd) ?? 17 * 60,
  };
  private readonly buffer = DEFAULT_PREFERENCES.bufferMinutes;
  private readonly defaultDuration = DEFAULT_PREFERENCES.defaultDurationMinutes;

  ngOnInit(): void {
    this.reset();
  }

  // ── Seeded state ──────────────────────────────────────────────────────────

  reset(): void {
    this.nextId = 1;
    this.lastEventId = null;
    this.pending = null;
    this.activeDate = this.todayKey;
    this.events = [
      this.seed('Team standup', 9 * 60, 9 * 60 + 30, 'Work'),
      this.seed('Design review', 11 * 60, 12 * 60, 'Work'),
      this.seed('Gym session', 13 * 60, 14 * 60, 'Health'),
    ];
    this.messages = [
      {
        id: this.nextId++,
        role: 'assistant',
        text:
          "Hi — this is a live sandbox on a sample day. Try \"book lunch with Priya tomorrow at noon\", " +
          'or tap a chip below. The agenda follows whichever day you name. ' +
          'Nothing here touches a real calendar.',
      },
    ];
  }

  private seed(title: string, start: number, end: number, category: EventCategory): SandboxEvent {
    return { id: this.nextId++, title, date: this.todayKey, start, end, category, seeded: true };
  }

  // ── Template helpers ──────────────────────────────────────────────────────

  /** The shown day's events in start order, which is how the agenda reads. */
  get sortedEvents(): SandboxEvent[] {
    return this.eventsOn(this.activeDate);
  }

  get showingToday(): boolean {
    return this.activeDate === this.todayKey;
  }

  /** "Today · Tue, Sep 23" — how the agenda panel names the day it shows. */
  get activeDateLabel(): string {
    const day = this.formatDay(this.activeDate);
    if (this.activeDate === this.todayKey) return `Today · ${day}`;
    if (this.activeDate === this.tomorrowKey) return `Tomorrow · ${day}`;
    return day;
  }

  goToToday(): void {
    this.activeDate = this.todayKey;
  }

  formatRange(ev: SandboxEvent): string {
    return formatSlotRange({ start: ev.start, end: ev.end });
  }

  formatOption(slot: Slot): string {
    return formatSlotTime(slot.start);
  }

  categoryColor(category: EventCategory): string {
    return DEFAULT_PREFERENCES.categoryColors[category];
  }

  trackById(_index: number, item: { id: number }): number {
    return item.id;
  }

  // ── Days ──────────────────────────────────────────────────────────────────

  /** A date key back to a Date, built locally so it lands on the day meant. */
  private dateFromKey(key: string): Date {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  private formatDay(key: string): string {
    return this.dateFromKey(key).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }

  /** How a sentence refers to a day: "today", "tomorrow", "on Wed, Sep 24". */
  private daySentence(key: string): string {
    if (key === this.todayKey) return 'today';
    if (key === this.tomorrowKey) return 'tomorrow';
    return `on ${this.formatDay(key)}`;
  }

  /**
   * The date a message is about: the one it names, or else the day already on
   * screen, so "find me a slot" after "what's on tomorrow" stays on tomorrow.
   */
  private dateFor(text: string): string {
    return parseDateTime(text, this.today).date ?? this.activeDate;
  }

  private eventsOn(date: string): SandboxEvent[] {
    return this.events.filter(e => e.date === date).sort((a, b) => a.start - b.start);
  }

  // ── Conversation ──────────────────────────────────────────────────────────

  runQuickAction(prompt: string): void {
    this.input = prompt;
    this.send();
  }

  send(): void {
    const text = this.input.trim();
    if (!text) return;
    this.say('user', text);
    this.input = '';
    this.respond(text);
  }

  /** Accept one of the alternative times offered after a conflict. */
  chooseOption(slot: Slot): void {
    if (!this.pending) return;
    const { title, category, date } = this.pending;
    this.pending = null;
    const created = this.addEvent(title, slot.start, slot.end, category, date);
    this.activeDate = date;
    this.say(
      'assistant',
      `Done — "${created.title}" is booked for ${this.formatRange(created)} ${this.daySentence(date)}.`,
    );
  }

  private say(role: SandboxMessage['role'], text: string, options?: Slot[]): void {
    this.messages = [...this.messages, { id: this.nextId++, role, text, options }];
  }

  /**
   * Route a message to the right handler.
   *
   * Order matters: an edit ("make it 4pm") and a cancellation both look like
   * scheduling requests once you strip the verb, so they are matched first and
   * creating an event is what's left over.
   */
  private respond(text: string): void {
    const s = text.toLowerCase();

    if (/\b(agenda|what'?s on|schedule for|what do i have|my day)\b/.test(s)) {
      this.replyWithAgenda(text);
      return;
    }
    if (/\b(free|open|available|find (me )?(a )?(\d+ ?\w* )?slot|find time)\b/.test(s)) {
      this.replyWithFreeSlots(text);
      return;
    }
    if (/\b(cancel|delete|remove|clear)\b/.test(s)) {
      this.cancelEvent(text);
      return;
    }
    if (/\b(actually|instead|change it|move it|make it|reschedule|push it|shift it)\b/.test(s)) {
      this.editLastEvent(text);
      return;
    }
    this.createEvent(text);
  }

  private replyWithAgenda(text: string): void {
    const date = this.dateFor(text);
    this.activeDate = date;

    const onDay = this.eventsOn(date);
    const when = this.daySentence(date);
    if (!onDay.length) {
      this.say('assistant', `Nothing scheduled ${when} — that day is completely clear.`);
      return;
    }
    const lines = onDay.map(e => `• ${this.formatRange(e)} — ${e.title}`).join('\n');
    const count = onDay.length;
    this.say('assistant', `You have ${count} ${count === 1 ? 'event' : 'events'} ${when}:\n${lines}`);
  }

  private replyWithFreeSlots(text: string): void {
    const date = this.dateFor(text);
    this.activeDate = date;

    const duration = parseDuration(text) ?? this.defaultDuration;
    const slots = findFreeSlots(this.busyBlocks(date), this.hours, duration, this.buffer).slice(0, 3);
    const when = this.daySentence(date);

    if (!slots.length) {
      this.say('assistant', `There's no ${duration}-minute gap left in your working hours ${when}.`);
      return;
    }
    const lines = slots.map(s => `• ${formatSlotRange(s)}`).join('\n');
    this.say('assistant', `Here's where ${duration} minutes would fit ${when}:\n${lines}`);
  }

  private cancelEvent(text: string): void {
    const target = this.matchEvent(text) ?? this.events.find(e => e.id === this.lastEventId);
    if (!target) {
      this.say('assistant', "I couldn't tell which event to cancel — try naming it, e.g. \"cancel the design review\".");
      return;
    }
    this.events = this.events.filter(e => e.id !== target.id);
    if (this.lastEventId === target.id) this.lastEventId = null;
    this.activeDate = target.date;
    this.say(
      'assistant',
      `Cancelled "${target.title}". That frees up ${this.formatRange(target)} ${this.daySentence(target.date)}.`,
    );
  }

  private editLastEvent(text: string): void {
    const target = this.matchEvent(text) ?? this.events.find(e => e.id === this.lastEventId);
    if (!target) {
      this.say('assistant', 'Add something first and I can move it — try "schedule coffee at 3pm".');
      return;
    }

    const parsed = parseDateTime(text, this.today);
    const date = parsed.date ?? target.date;
    const newStart = parsed.startTime ? timeToMinutes(parsed.startTime) : null;
    // A new day on its own is a move too ("push it to Thursday"), so the time
    // is only missing when neither a day nor a time was named.
    if (newStart === null && date === target.date) {
      this.say('assistant', 'What time should I move it to?');
      return;
    }

    const start = newStart ?? target.start;
    const duration = parseDuration(text) ?? target.end - target.start;
    const proposed: Slot = { start, end: start + duration };
    // The event being moved can't block its own new position.
    const others = this.busyBlocks(date, target.id);
    const clashes = findConflicts(proposed, others);

    if (clashes.length) {
      this.offerAlternatives(target.title, target.category, duration, date, start, clashes, others);
      return;
    }

    target.date = date;
    target.start = proposed.start;
    target.end = proposed.end;
    this.events = [...this.events];
    this.lastEventId = target.id;
    this.activeDate = date;
    this.say('assistant', `Moved "${target.title}" to ${this.formatRange(target)} ${this.daySentence(date)}.`);
  }

  private createEvent(text: string): void {
    const parsed = parseDateTime(text, this.today);
    const date = parsed.date ?? this.activeDate;
    const duration = parseDuration(text) ?? this.defaultDuration;
    const title = extractTitle(text);
    const category = inferCategory(text);
    const when = this.daySentence(date);

    if (parsed.startTime === null) {
      // No time named — treat it as "find me somewhere for this".
      const slots = findFreeSlots(this.busyBlocks(date), this.hours, duration, this.buffer).slice(0, 3);
      if (!slots.length) {
        this.say('assistant', `I couldn't find ${duration} free minutes ${when} for "${title}".`);
        return;
      }
      this.pending = { title, category, duration, date };
      this.activeDate = date;
      this.say('assistant', `When should "${title}" go? Here's what's open ${when}:`, slots);
      return;
    }

    const start = timeToMinutes(parsed.startTime);
    if (start === null) {
      this.say('assistant', "I didn't catch the time — try something like \"3pm\" or \"15:00\".");
      return;
    }

    const proposed: Slot = { start, end: start + duration };
    const blocks = this.busyBlocks(date);
    const clashes = findConflicts(proposed, blocks);

    if (clashes.length) {
      this.offerAlternatives(title, category, duration, date, start, clashes, blocks);
      return;
    }

    const created = this.addEvent(title, proposed.start, proposed.end, category, date);
    this.activeDate = date;
    this.say(
      'assistant',
      `Added "${created.title}" — ${this.formatRange(created)} ${when}, filed under ${category}.`,
    );
  }

  /** The polite conflict response: name the clash, offer concrete openings. */
  private offerAlternatives(
    title: string,
    category: EventCategory,
    duration: number,
    date: string,
    preferredStart: number,
    clashes: readonly BusyBlock[],
    blocks: readonly BusyBlock[],
  ): void {
    const names = clashes.map(c => c.label).filter((l): l is string => !!l);
    const clash = names.length ? `"${names[0]}"` : 'something already booked';
    const options = suggestAlternativeSlots(preferredStart, duration, blocks, this.hours, this.buffer, 3);
    const when = this.daySentence(date);
    // Show the day being argued over, so the clash named here is on screen.
    this.activeDate = date;

    if (!options.length) {
      this.say(
        'assistant',
        `That overlaps ${clash}, and there's no other ${duration}-minute gap in your working hours ${when}.`,
      );
      return;
    }

    this.pending = { title, category, duration, date };
    this.say(
      'assistant',
      `${formatSlotTime(preferredStart)} ${when} overlaps ${clash}. Here are the closest openings — tap one and I'll book "${title}".`,
      options,
    );
  }

  // ── Calendar state ────────────────────────────────────────────────────────

  private addEvent(
    title: string,
    start: number,
    end: number,
    category: EventCategory,
    date: string,
  ): SandboxEvent {
    const event: SandboxEvent = { id: this.nextId++, title, date, start, end, category, seeded: false };
    this.events = [...this.events, event];
    this.lastEventId = event.id;
    return event;
  }

  /** Busy blocks for one day, optionally ignoring one event. */
  private busyBlocks(date: string, exceptId?: number): BusyBlock[] {
    return this.events
      .filter(e => e.date === date && e.id !== exceptId)
      .map(e => toBusyBlock(minutesToTime(e.start), minutesToTime(e.end), e.title))
      .filter((b): b is BusyBlock => b !== null);
  }

  /** The event whose title best matches words in the message. */
  private matchEvent(text: string): SandboxEvent | undefined {
    const s = text.toLowerCase();
    return this.events.find(e =>
      e.title
        .toLowerCase()
        .split(/\s+/)
        .some(word => word.length > 3 && s.includes(word)),
    );
  }
}
