import { Component, ElementRef, HostListener, Input, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { I18nService } from '../../services/i18n.service';
import {
  buildTimeOptions,
  filterTimeOptions,
  formatTypedTime,
  isTwelveHourLocale,
  meridiemLabelFor,
  parseTimeField,
  toTimeField,
  type Meridiem,
  type TimeField,
  type TimeOption,
} from '../../services/time-field.util';

/**
 * A time input that can be typed into or picked from a list.
 *
 * Clicking the field opens every half hour of the day; typing narrows that list
 * rather than replacing it, so neither way of entering a time gets in the
 * other's way. The value is held in the caller's TimeField, which is the same
 * object the form reads back when it saves — this component only ever reshapes
 * what that field already holds.
 */
@Component({
  selector: 'app-time-picker',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './time-picker.component.html',
  styleUrl: './time-picker.component.css',
})
export class TimePickerComponent {
  /** The field this input edits, owned by the parent form. */
  @Input({ required: true }) field!: TimeField;
  /** Passed through so an external <label for="..."> still works. */
  @Input() inputId = '';
  @Input() name = 'time';
  @Input() required = false;

  @ViewChild('input') inputRef?: ElementRef<HTMLInputElement>;

  open = false;
  /** Index the arrow keys are on, or -1 when nothing is highlighted. */
  activeIndex = -1;

  private cachedLocale = '';
  private allOptions: TimeOption[] = [];
  private meridiemLabels: Record<Meridiem, string> = { AM: 'AM', PM: 'PM' };
  private twelveHour = false;

  constructor(private i18n: I18nService, private host: ElementRef<HTMLElement>) {}

  /** Recomputed only when the language changes; read on every change pass. */
  private refresh(): void {
    const locale = this.i18n.getLocale();
    if (locale === this.cachedLocale) return;
    this.cachedLocale = locale;
    this.twelveHour = isTwelveHourLocale(locale);
    this.meridiemLabels = { AM: meridiemLabelFor(locale, 'AM'), PM: meridiemLabelFor(locale, 'PM') };
    this.allOptions = buildTimeOptions(locale);
  }

  get usesTwelveHourClock(): boolean {
    this.refresh();
    return this.twelveHour;
  }

  get placeholder(): string {
    return this.usesTwelveHourClock ? this.i18n.t('timePlaceholder12') : this.i18n.t('timePlaceholder24');
  }

  get toggleLabel(): string {
    return this.i18n.t('toggleMeridiem');
  }

  get pickLabel(): string {
    return this.i18n.t('pickATime');
  }

  meridiemLabel(meridiem: Meridiem): string {
    this.refresh();
    return this.meridiemLabels[meridiem];
  }

  /** The list as it currently stands, narrowed by whatever has been typed. */
  get options(): TimeOption[] {
    this.refresh();
    return filterTimeOptions(this.allOptions, this.field?.text ?? '');
  }

  /** Marks the entry matching the current value, so it reads as selected. */
  isCurrent(option: TimeOption): boolean {
    return !!this.field && parseTimeField(this.field, this.usesTwelveHourClock) === option.value;
  }

  // ── Opening and closing ───────────────────────────────────────────────────

  openList(): void {
    if (this.open) return;
    this.open = true;
    // Start on the current value so the keyboard picks up where the field is.
    this.activeIndex = this.options.findIndex(o => this.isCurrent(o));
  }

  closeList(): void {
    this.open = false;
    this.activeIndex = -1;
  }

  /**
   * Close when the click lands outside this component.
   *
   * Bound on the document rather than the input's own blur so that clicking an
   * option counts as inside — a blur handler would close the list before the
   * click that opened it could register.
   */
  @HostListener('document:mousedown', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.open) return;
    if (!this.host.nativeElement.contains(event.target as Node)) this.closeList();
  }

  // ── Editing ──────────────────────────────────────────────────────────────

  onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const shaped = formatTypedTime(input.value);
    this.field.text = shaped;
    // Keep the element in step when the colon was inserted for the user.
    if (input.value !== shaped) input.value = shaped;
    this.openList();
    this.activeIndex = -1;
  }

  choose(option: TimeOption): void {
    const next = toTimeField(option.value, this.usesTwelveHourClock);
    this.field.text = next.text;
    this.field.meridiem = next.meridiem;
    this.closeList();
    this.inputRef?.nativeElement.focus();
  }

  toggleMeridiem(): void {
    this.field.meridiem = this.field.meridiem === 'AM' ? 'PM' : 'AM';
  }

  /** Re-render a typed time in its canonical shape once focus leaves. */
  normalize(): void {
    const stored = parseTimeField(this.field, this.usesTwelveHourClock);
    if (!stored) return;
    const next = toTimeField(stored, this.usesTwelveHourClock);
    this.field.text = next.text;
    this.field.meridiem = next.meridiem;
  }

  onKeydown(event: KeyboardEvent): void {
    const list = this.options;

    if (event.key === 'Escape') {
      if (this.open) {
        event.stopPropagation(); // don't also close the modal behind it
        this.closeList();
      }
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!this.open) {
        this.openList();
        return;
      }
      if (!list.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.activeIndex = (this.activeIndex + step + list.length) % list.length;
      return;
    }

    if (event.key === 'Enter' && this.open && this.activeIndex >= 0 && list[this.activeIndex]) {
      // Only swallow Enter when it is choosing from the list, so otherwise it
      // still submits the form it sits in.
      event.preventDefault();
      this.choose(list[this.activeIndex]);
      return;
    }

    if (event.key === 'Tab') this.closeList();
  }

  trackByValue(_index: number, option: TimeOption): string {
    return option.value;
  }
}
