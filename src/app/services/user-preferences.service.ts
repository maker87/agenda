import { Injectable } from '@angular/core';
import { EVENT_CATEGORIES, type EventCategory } from './nl-datetime.util';

/**
 * Scheduling preferences captured by the onboarding wizard.
 *
 * These are the inputs the scheduler needs before it can propose a time:
 * which hours count as available, how long an event runs by default, and how
 * much breathing room to leave between events.
 */
export interface UserPreferences {
  /** Start of the working day, 24-hour "HH:MM". */
  workStart: string;
  /** End of the working day, 24-hour "HH:MM". */
  workEnd: string;
  /** Length of an event when the request doesn't say. */
  defaultDurationMinutes: number;
  /** Minimum gap to leave either side of an event when proposing slots. */
  bufferMinutes: number;
  /** Per-category event colors, keyed by the canonical category names. */
  categoryColors: Record<EventCategory, string>;
  /** How many minutes ahead to notify, one entry per reminder. */
  notificationLeadMinutes: number[];
  /** IANA zone, e.g. "America/New_York". */
  timezone: string;
  /** False until the wizard has been completed or skipped. */
  onboardingComplete: boolean;
}

const STORAGE_KEY = 'agenda_preferences';

/**
 * Written alongside the app's own preferences so colors picked in the wizard
 * show up in the dashboard, which reads this key directly.
 */
const CATEGORY_COLORS_KEY = 'agenda_category_colors';

export const DEFAULT_PREFERENCES: UserPreferences = {
  workStart: '09:00',
  workEnd: '17:00',
  defaultDurationMinutes: 30,
  bufferMinutes: 10,
  categoryColors: {
    Work: '#3b82f6',
    Personal: '#22c55e',
    Health: '#ec4899',
    Social: '#f59e0b',
    Finance: '#8b5cf6',
  },
  notificationLeadMinutes: [10],
  // Resolved per-browser at first read; this literal is only the fallback for
  // environments where Intl can't report a zone.
  timezone: 'UTC',
  onboardingComplete: false,
};

@Injectable({ providedIn: 'root' })
export class UserPreferencesService {
  private cached: UserPreferences | null = null;

  /** The browser's own zone, or the default when it can't be determined. */
  static detectTimezone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_PREFERENCES.timezone;
    } catch {
      return DEFAULT_PREFERENCES.timezone;
    }
  }

  /**
   * Current preferences, falling back to defaults for anything missing.
   *
   * Stored values are merged field-by-field rather than replacing the object,
   * so preferences saved before a new field existed still load cleanly.
   */
  get(): UserPreferences {
    if (this.cached) return this.cached;

    const base: UserPreferences = {
      ...DEFAULT_PREFERENCES,
      timezone: UserPreferencesService.detectTimezone(),
      categoryColors: { ...DEFAULT_PREFERENCES.categoryColors },
      notificationLeadMinutes: [...DEFAULT_PREFERENCES.notificationLeadMinutes],
    };

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<UserPreferences>;
        Object.assign(base, saved, {
          // Nested values are merged separately — a plain Object.assign would
          // drop any category the saved copy happens not to mention.
          categoryColors: { ...base.categoryColors, ...(saved.categoryColors ?? {}) },
          notificationLeadMinutes: Array.isArray(saved.notificationLeadMinutes)
            ? saved.notificationLeadMinutes
            : base.notificationLeadMinutes,
        });
      }
    } catch {
      /* Unreadable or blocked storage — the defaults above still stand. */
    }

    this.cached = base;
    return base;
  }

  /** Merge a partial update into the stored preferences and persist. */
  save(update: Partial<UserPreferences>): UserPreferences {
    const next: UserPreferences = { ...this.get(), ...update };
    this.cached = next;

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      // Mirror the colors into the key the dashboard already reads, so a
      // category picked here is the color the calendar actually draws.
      const existing = JSON.parse(localStorage.getItem(CATEGORY_COLORS_KEY) ?? '{}');
      localStorage.setItem(
        CATEGORY_COLORS_KEY,
        JSON.stringify({ ...existing, ...next.categoryColors }),
      );
    } catch {
      /* Storage unavailable — preferences stay in memory for this session. */
    }

    return next;
  }

  isOnboardingComplete(): boolean {
    return this.get().onboardingComplete;
  }

  /** Reset to defaults, mainly so the wizard can be replayed from settings. */
  reset(): void {
    this.cached = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* Nothing to clear. */
    }
  }

  /** The canonical categories, for building color pickers. */
  get categories(): readonly EventCategory[] {
    return EVENT_CATEGORIES;
  }
}
