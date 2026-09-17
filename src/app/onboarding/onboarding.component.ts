import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import {
  UserPreferencesService,
  type UserPreferences,
} from '../services/user-preferences.service';
import { EVENT_CATEGORIES, timeToMinutes, type EventCategory } from '../services/nl-datetime.util';

interface WizardStep {
  title: string;
  blurb: string;
}

/**
 * Three-step setup wizard.
 *
 * It collects only what the scheduler cannot guess: when the user is available,
 * how they want events colored, and when to be told about them. Everything is
 * pre-filled with a working default, so finishing without changing anything is
 * a valid outcome rather than an empty configuration.
 */
@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './onboarding.component.html',
  styleUrl: './onboarding.component.css',
})
export class OnboardingComponent implements OnInit {
  readonly steps: WizardStep[] = [
    { title: 'When do you work?', blurb: 'Agenda only proposes times inside these hours.' },
    { title: 'Colour your calendar', blurb: 'Each category gets its own colour across the app.' },
    { title: 'Stay in the loop', blurb: 'Choose how far ahead to be reminded, and confirm your timezone.' },
  ];

  /** Zero-based index of the visible step. */
  stepIndex = 0;
  error = '';

  // ── Step 1 ──
  workStart = '09:00';
  workEnd = '17:00';
  defaultDurationMinutes = 30;
  readonly durationChoices = [15, 30, 45, 60, 90];

  // ── Step 2 ──
  categoryColors: Record<EventCategory, string> = {
    Work: '#3b82f6',
    Personal: '#22c55e',
    Health: '#ec4899',
    Social: '#f59e0b',
    Finance: '#8b5cf6',
  };
  readonly categories: readonly EventCategory[] = EVENT_CATEGORIES;
  readonly palette = [
    '#3b82f6', '#22c55e', '#ec4899', '#f59e0b', '#8b5cf6',
    '#6c63ff', '#14b8a6', '#ef4444', '#0ea5e9', '#f97316',
  ];

  // ── Step 3 ──
  readonly leadTimeChoices = [0, 5, 10, 15, 30, 60];
  notificationLeadMinutes: number[] = [10];
  timezone = 'UTC';
  timezones: string[] = [];

  constructor(
    private prefs: UserPreferencesService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    const saved = this.prefs.get();
    this.workStart = saved.workStart;
    this.workEnd = saved.workEnd;
    this.defaultDurationMinutes = saved.defaultDurationMinutes;
    this.categoryColors = { ...saved.categoryColors };
    this.notificationLeadMinutes = [...saved.notificationLeadMinutes];
    this.timezone = saved.timezone;
    this.timezones = this.loadTimezones();
  }

  /**
   * The full IANA list when the runtime exposes it, otherwise a short common
   * set. `supportedValuesOf` is ES2022 and isn't in this project's lib target,
   * so it's reached through a narrowed cast rather than assumed present.
   */
  private loadTimezones(): string[] {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    let zones: string[] = [];
    try {
      zones = intl.supportedValuesOf?.('timeZone') ?? [];
    } catch {
      zones = [];
    }
    if (!zones.length) {
      zones = [
        'UTC', 'America/Los_Angeles', 'America/Denver', 'America/Chicago',
        'America/New_York', 'America/Sao_Paulo', 'Europe/London', 'Europe/Paris',
        'Europe/Berlin', 'Africa/Lagos', 'Asia/Dubai', 'Asia/Kolkata',
        'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
      ];
    }
    // Guarantee the detected zone is selectable even if it isn't in the list.
    if (this.timezone && !zones.includes(this.timezone)) zones = [this.timezone, ...zones];
    return zones;
  }

  // ── Step 2 helpers ──

  setCategoryColor(category: EventCategory, color: string): void {
    this.categoryColors = { ...this.categoryColors, [category]: color };
  }

  // ── Step 3 helpers ──

  isLeadSelected(minutes: number): boolean {
    return this.notificationLeadMinutes.includes(minutes);
  }

  toggleLead(minutes: number): void {
    this.notificationLeadMinutes = this.isLeadSelected(minutes)
      ? this.notificationLeadMinutes.filter(m => m !== minutes)
      : [...this.notificationLeadMinutes, minutes].sort((a, b) => a - b);
  }

  leadLabel(minutes: number): string {
    if (minutes === 0) return 'At start';
    if (minutes < 60) return `${minutes} min before`;
    return `${minutes / 60} hr before`;
  }

  // ── Navigation ──

  get isLastStep(): boolean {
    return this.stepIndex === this.steps.length - 1;
  }

  get progressPercent(): number {
    return ((this.stepIndex + 1) / this.steps.length) * 100;
  }

  next(): void {
    if (!this.validateCurrentStep()) return;
    this.error = '';
    if (this.isLastStep) {
      this.finish();
      return;
    }
    this.stepIndex++;
  }

  back(): void {
    this.error = '';
    if (this.stepIndex > 0) this.stepIndex--;
  }

  /** Leave the defaults in place and go straight to the app. */
  skip(): void {
    this.prefs.save({ onboardingComplete: true });
    this.router.navigate(['/dashboard']);
  }

  private validateCurrentStep(): boolean {
    if (this.stepIndex === 0) {
      const start = timeToMinutes(this.workStart);
      const end = timeToMinutes(this.workEnd);
      if (start === null || end === null) {
        this.error = 'Please enter both working hours as HH:MM.';
        return false;
      }
      if (end <= start) {
        this.error = 'Your working day has to end after it starts.';
        return false;
      }
      if (end - start < this.defaultDurationMinutes) {
        this.error = 'Your working day is shorter than the default event length.';
        return false;
      }
    }

    if (this.stepIndex === 2 && !this.notificationLeadMinutes.length) {
      this.error = 'Pick at least one reminder time, or choose "At start".';
      return false;
    }

    return true;
  }

  private finish(): void {
    const update: Partial<UserPreferences> = {
      workStart: this.workStart,
      workEnd: this.workEnd,
      defaultDurationMinutes: this.defaultDurationMinutes,
      categoryColors: this.categoryColors,
      notificationLeadMinutes: this.notificationLeadMinutes,
      timezone: this.timezone,
      onboardingComplete: true,
    };
    this.prefs.save(update);
    this.router.navigate(['/dashboard']);
  }
}
