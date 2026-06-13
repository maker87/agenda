import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';

interface FeatureSlide {
  tab: string;
  icon: string;
  title: string;
  description: string;
  highlights: string[];
}

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.css',
})
export class LandingComponent implements OnInit, OnDestroy {
  constructor(private router: Router) {}

  // ── Feature Slideshow ──
  slides: FeatureSlide[] = [
    {
      tab: 'Schedule',
      icon: '✦',
      title: 'Schedule',
      description: 'Your command center for managing events. Add new events, delete old ones, edit existing ones, or link your Google Calendar — all from one place.',
      highlights: ['Add, edit, or delete events', 'Link Google Calendar in one click', 'Quick action cards for common tasks'],
    },
    {
      tab: 'My Agenda',
      icon: '☰',
      title: 'My Agenda',
      description: 'See all your events organized by past, today, and upcoming. Filter by category, share events with friends, and set reminders with a single tap.',
      highlights: ['Events grouped by time', 'Category filter pills', 'Share & set reminders inline'],
    },
    {
      tab: 'Calendar',
      icon: '🗓',
      title: 'Calendar',
      description: 'Four powerful views — year, month, week, and day — so you always have the perspective you need. Color-coded dots show events at a glance.',
      highlights: ['Year overview with all 12 months', 'Month slideshow with event pills', 'Week & day timeline views'],
    },
    {
      tab: 'Notifications',
      icon: '🔔',
      title: 'Notifications',
      description: 'A unified notification center for reminders, event invites, and shared calendars. Accept or decline invites, mark as read, and filter by type.',
      highlights: ['Reminders, invites & shares', 'Accept / decline invite flow', 'Filter and manage notifications'],
    },
    {
      tab: 'Categories',
      icon: '🏷️',
      title: 'Categories',
      description: 'Create unlimited nested categories with custom colors. Organize events into work, personal, health, or any hierarchy that fits your life.',
      highlights: ['Nested sub-categories', 'Custom color per category', 'Drag-and-drop organization'],
    },
    {
      tab: 'Chat',
      icon: '✨',
      title: 'Smart Chat',
      description: 'Talk to your calendar in plain language. Ask when you\'re free, schedule events, move meetings, or get a summary of your week — just by typing.',
      highlights: ['Natural language commands', 'Find free time slots instantly', 'Schedule events conversationally'],
    },
    {
      tab: 'Weekly Summary',
      icon: '📊',
      title: 'Weekly Summary',
      description: 'Get a bird\'s-eye view of how you spent your week. See breakdowns by category, your busiest day, total meeting hours, and more.',
      highlights: ['Time breakdown by category', 'Busiest day & focus time', 'Plan next week smarter'],
    },
  ];

  activeSlide = 0;
  private slideInterval: ReturnType<typeof setInterval> | null = null;
  private readonly SLIDE_DURATION = 5000; // 5 seconds per slide

  ngOnInit() {
    this.startSlideshow();
  }

  ngOnDestroy() {
    this.stopSlideshow();
  }

  startSlideshow() {
    this.slideInterval = setInterval(() => {
      this.activeSlide = (this.activeSlide + 1) % this.slides.length;
    }, this.SLIDE_DURATION);
  }

  stopSlideshow() {
    if (this.slideInterval) {
      clearInterval(this.slideInterval);
      this.slideInterval = null;
    }
  }

  goToSlide(index: number) {
    this.activeSlide = index;
    // Reset the timer when user manually navigates
    this.stopSlideshow();
    this.startSlideshow();
  }

  nextSlide() {
    this.activeSlide = (this.activeSlide + 1) % this.slides.length;
    this.stopSlideshow();
    this.startSlideshow();
  }

  prevSlide() {
    this.activeSlide = (this.activeSlide - 1 + this.slides.length) % this.slides.length;
    this.stopSlideshow();
    this.startSlideshow();
  }

  goToLogin() {
    this.router.navigate(['/auth'], { queryParams: { mode: 'login' } });
  }

  goToSignup() {
    this.router.navigate(['/auth'], { queryParams: { mode: 'signup' } });
  }
}
