import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MockAuthService } from '../services/mock-auth.service';

interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  description: string;
  color: string;
}

interface ScheduleForm {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  description: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent implements OnInit {
  userEmail = '';
  googleCalendarLinked = false;
  linkingGoogle = false;
  activeTab: 'schedule' | 'agenda' = 'schedule';
  showScheduleModal = false;
  scheduleSuccess = false;
  scheduleError = '';

  today = new Date().toISOString().split('T')[0];

  form: ScheduleForm = {
    title: '',
    date: this.today,
    startTime: '09:00',
    endTime: '10:00',
    description: '',
  };

  events: CalendarEvent[] = [
    {
      id: '1',
      title: 'Team Standup',
      date: this.today,
      startTime: '09:00',
      endTime: '09:30',
      description: 'Daily sync with the team',
      color: '#6c63ff',
    },
    {
      id: '2',
      title: 'Product Review',
      date: this.today,
      startTime: '14:00',
      endTime: '15:00',
      description: 'Review Q2 product roadmap',
      color: '#f59e0b',
    },
  ];

  eventColors = ['#6c63ff', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899'];
  selectedColor = '#6c63ff';

  constructor(private router: Router, private mockAuth: MockAuthService) {}

  ngOnInit() {
    const user = this.mockAuth.getCurrentUser();
    if (!user) {
      this.router.navigate(['/']);
      return;
    }
    this.userEmail = user.email;
  }

  logout() {
    this.mockAuth.logout();
    this.router.navigate(['/']);
  }

  linkGoogleCalendar() {
    this.linkingGoogle = true;
    setTimeout(() => {
      this.googleCalendarLinked = true;
      this.linkingGoogle = false;
    }, 1800);
  }

  unlinkGoogleCalendar() {
    this.googleCalendarLinked = false;
  }

  openScheduleModal() {
    this.form = {
      title: '',
      date: this.today,
      startTime: '09:00',
      endTime: '10:00',
      description: '',
    };
    this.selectedColor = '#6c63ff';
    this.scheduleError = '';
    this.scheduleSuccess = false;
    this.showScheduleModal = true;
  }

  closeModal() {
    this.showScheduleModal = false;
  }

  submitSchedule() {
    if (!this.form.title.trim()) {
      this.scheduleError = 'Please enter an event title.';
      return;
    }
    if (!this.form.date) {
      this.scheduleError = 'Please select a date.';
      return;
    }
    if (this.form.startTime >= this.form.endTime) {
      this.scheduleError = 'End time must be after start time.';
      return;
    }

    const newEvent: CalendarEvent = {
      id: Date.now().toString(),
      title: this.form.title.trim(),
      date: this.form.date,
      startTime: this.form.startTime,
      endTime: this.form.endTime,
      description: this.form.description.trim(),
      color: this.selectedColor,
    };

    this.events = [...this.events, newEvent].sort(
      (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)
    );

    this.scheduleSuccess = true;
    setTimeout(() => {
      this.showScheduleModal = false;
      this.scheduleSuccess = false;
    }, 1200);
  }

  deleteEvent(id: string) {
    this.events = this.events.filter((e) => e.id !== id);
  }

  get todayEvents() {
    return this.events.filter((e) => e.date === this.today);
  }

  get upcomingEvents() {
    return this.events.filter((e) => e.date > this.today);
  }

  get pastEvents() {
    return this.events.filter((e) => e.date < this.today);
  }

  formatDate(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  formatTime(t: string): string {
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour}:${m.toString().padStart(2, '0')} ${ampm}`;
  }

  get userInitial(): string {
    return this.userEmail ? this.userEmail[0].toUpperCase() : 'U';
  }
}
