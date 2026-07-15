import { Component, OnInit, OnDestroy, AfterViewInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MockAuthService, UserProfile } from '../services/mock-auth.service';
import { EventsService } from '../services/events.service';
import { CategoryCountPipe } from '../pipes/category-count.pipe';
import { TranslateTitlePipe } from '../pipes/translate-title.pipe';
import { NotificationsService, AppNotification } from '../services/notifications.service';
import { FriendsService, Friend, FriendMessage } from '../services/friends.service';
import { CategoryTreeService, CategoryNode, CATEGORY_SEP } from '../services/category-tree.service';
import { GoogleCalendarService, GCalEvent, GCalCalendar } from '../services/google-calendar.service';
import { HolidaysService } from '../services/holidays.service';
import { AiSchedulerService, AiSuggestion } from '../services/ai-scheduler.service';
import { AiChatService, ChatMessage, EventDraft, getProactiveReminders } from '../services/ai-chat.service';
import { AiOrganizeService, OrganizedEvent, OrganizeResult } from '../services/ai-organize.service';
import { BedrockChatService, ChatAction as BedrockAction } from '../services/bedrock-chat.service';
import { StreaksService, Streak as StreakRecord } from '../services/streaks.service';
import { I18nService } from '../services/i18n.service';
import { signOut } from 'aws-amplify/auth';

interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  endDate?: string;
  startTime: string;
  endTime: string;
  description: string;
  color: string;
  category: string;
  location?: string;
  sharedWith: string[];
}

interface EventAttachment {
  name: string;
  dataUrl: string;
  type: string;
  size: number;
}

interface StreakDay {
  date: string; label: string; checked: boolean; isToday: boolean; isFuture: boolean; value: number;
}

// Streak's core fields/sync behavior live in StreaksService; this extends it
// with UI-only cached derived values, recomputed only when the streak's data
// changes (avoids re-sorting/re-scanning checkedDays on every change-detection cycle).
interface Streak extends StreakRecord {
  _count?: number;
  _week?: StreakDay[];
}

type HistoryAction = 'added' | 'deleted' | 'changed';

interface HistoryEntry {
  id: string;
  action: HistoryAction;
  timestamp: number; // ms since epoch
  snapshot: CalendarEvent;       // state of the event at the time of the action
  previousSnapshot?: CalendarEvent; // for 'changed': the before state
}

interface ScheduleForm {
  title: string;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  description: string;
  category: string;
  location: string;
  sharedWith: string[];  // emails to share with at creation time
  repeatType: 'none' | 'weekly' | 'multiday';  // recurring type
  repeatDays: boolean[];  // [Sun, Mon, Tue, Wed, Thu, Fri, Sat]
  repeatUntil: string;    // end date for weekly recurrence (YYYY-MM-DD)
  multiDates: string[];   // dates selected by clicking the multi-day picker (YYYY-MM-DD)
}

// Helper to build a date string relative to today
function relDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
}

// Format a YYYY-MM-DD string for display (used in notification bodies)
function formatDate2(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// Helper to build a fixed date string for a given month/day in the current year
function fixedDate(month: number, day: number, yearOffset = 0): string {
  const y = new Date().getFullYear() + yearOffset;
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Generate the student's full academic-year events
function buildStudentEvents(): CalendarEvent[] {
  let id = 1000;
  const next = () => String(id++);

  // Recurring weekly class helper — generates every occurrence for a date range
  function weekly(
    title: string, weekday: number, startTime: string, endTime: string,
    description: string, color: string, category: string,
    fromMonth: number, fromDay: number,
    toMonth: number, toDay: number
  ): CalendarEvent[] {
    const evts: CalendarEvent[] = [];
    const y = new Date().getFullYear();
    const start = new Date(y, fromMonth - 1, fromDay);
    const end   = new Date(y, toMonth - 1, toDay);
    const cur   = new Date(start);
    while (cur <= end) {
      if (cur.getDay() === weekday) {
        evts.push({
          id: next(), title, color, description, startTime, endTime, category, sharedWith: [],
          date: cur.toISOString().split('T')[0],
        });
      }
      cur.setDate(cur.getDate() + 1);
    }
    return evts;
  }

  const events: CalendarEvent[] = [];

  // ── FALL SEMESTER (Sep – Dec) ──
  // Classes — Mon/Wed/Fri
  const fallClasses = [
    { title: 'AP Calculus BC',      color: '#6c63ff', desc: 'Limits, derivatives, integrals, series' },
    { title: 'AP English Lit',      color: '#ec4899', desc: 'Literary analysis and essay writing' },
    { title: 'AP US History',       color: '#f59e0b', desc: 'Colonial era through modern America' },
    { title: 'AP Chemistry',        color: '#3b82f6', desc: 'Atomic structure, bonding, reactions' },
    { title: 'Spanish III',         color: '#10b981', desc: 'Advanced grammar and conversation' },
  ];
  const fallTimes = [
    { start: '08:00', end: '08:55' },
    { start: '09:05', end: '10:00' },
    { start: '10:10', end: '11:05' },
    { start: '11:15', end: '12:10' },
    { start: '13:00', end: '13:55' },
  ];
  fallClasses.forEach((cls, i) => {
    const t = fallTimes[i];
    [1, 3, 5].forEach(wd => { // Mon, Wed, Fri
      events.push(...weekly(cls.title, wd, t.start, t.end, cls.desc, cls.color, cls.title, 9, 3, 12, 13));
    });
  });

  // Classes — Tue/Thu
  const fallLabClasses = [
    { title: 'AP Chemistry Lab',    color: '#3b82f6', desc: 'Hands-on lab experiments' },
    { title: 'PE / Health',         color: '#10b981', desc: 'Physical education and wellness' },
  ];
  const fallLabTimes = [
    { start: '08:00', end: '09:30' },
    { start: '09:40', end: '10:30' },
  ];
  fallLabClasses.forEach((cls, i) => {
    const t = fallLabTimes[i];
    [2, 4].forEach(wd => { // Tue, Thu
      events.push(...weekly(cls.title, wd, t.start, t.end, cls.desc, cls.color, cls.title, 9, 3, 12, 13));
    });
  });

  // ── SPRING SEMESTER (Jan – May) ──
  const springClasses = [
    { title: 'AP Calculus BC',      color: '#6c63ff', desc: 'Sequences, series, and multivariable intro' },
    { title: 'AP English Lit',      color: '#ec4899', desc: 'Poetry, drama, and long-form essays' },
    { title: 'AP US History',       color: '#f59e0b', desc: 'Civil War through the 21st century' },
    { title: 'AP Chemistry',        color: '#3b82f6', desc: 'Thermodynamics, kinetics, equilibrium' },
    { title: 'Spanish III',         color: '#10b981', desc: 'Literature and cultural studies' },
  ];
  springClasses.forEach((cls, i) => {
    const t = fallTimes[i];
    [1, 3, 5].forEach(wd => {
      events.push(...weekly(cls.title, wd, t.start, t.end, cls.desc, cls.color, cls.title, 1, 13, 5, 16));
    });
  });
  fallLabClasses.forEach((cls, i) => {
    const t = fallLabTimes[i];
    [2, 4].forEach(wd => {
      events.push(...weekly(cls.title, wd, t.start, t.end, cls.desc, cls.color, cls.title, 1, 13, 5, 16));
    });
  });

  // ── EXTRACURRICULARS ──

  // Robotics Club — every Tuesday after school, Sep–Apr
  events.push(...weekly('Robotics Club', 2, '15:30', '17:30', 'Build and program competition robots', '#ef4444', 'Robotics Club', 9, 3, 4, 29));

  // Debate Team — every Thursday, Sep–Mar
  events.push(...weekly('Debate Team', 4, '15:30', '17:00', 'Competitive debate practice and prep', '#6c63ff', 'Debate Team', 9, 3, 3, 27));

  // Orchestra — every Wednesday, Sep–May
  events.push(...weekly('Orchestra Rehearsal', 3, '15:30', '17:00', 'String section rehearsal', '#ec4899', 'Orchestra', 9, 3, 5, 14));

  // Soccer — Mon/Wed/Fri, Sep–Nov (fall season)
  events.push(...weekly('Soccer Practice', 1, '16:00', '17:30', 'Varsity soccer practice', '#10b981', 'Soccer', 9, 3, 11, 8));
  events.push(...weekly('Soccer Practice', 3, '16:00', '17:30', 'Varsity soccer practice', '#10b981', 'Soccer', 9, 3, 11, 8));
  events.push(...weekly('Soccer Practice', 5, '16:00', '17:30', 'Varsity soccer practice', '#10b981', 'Soccer', 9, 3, 11, 8));

  // Track & Field — Mon/Wed/Fri, Mar–May (spring season)
  events.push(...weekly('Track & Field Practice', 1, '15:45', '17:15', 'Sprints, hurdles, and field events', '#f59e0b', 'Track & Field', 3, 3, 5, 16));
  events.push(...weekly('Track & Field Practice', 3, '15:45', '17:15', 'Sprints, hurdles, and field events', '#f59e0b', 'Track & Field', 3, 3, 5, 16));
  events.push(...weekly('Track & Field Practice', 5, '15:45', '17:15', 'Sprints, hurdles, and field events', '#f59e0b', 'Track & Field', 3, 3, 5, 16));

  // NHS — first Monday of each month
  [9, 10, 11, 12, 1, 2, 3, 4, 5].forEach(m => {
    const y = new Date().getFullYear();
    const d = new Date(y, m - 1, 1);
    while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
    events.push({
      id: next(), title: 'NHS Meeting', color: '#6c63ff',
      date: d.toISOString().split('T')[0],
      startTime: '14:00', endTime: '15:00',
      description: 'National Honor Society monthly meeting',
      category: 'NHS', sharedWith: [],
    });
  });

  // ── ONE-OFF EVENTS ──

  // Tests & Exams
  const tests = [
    { title: 'AP Calc BC — Unit 1 Test',    m: 9,  d: 20, s: '08:00', e: '08:55', color: '#6c63ff', desc: 'Limits and continuity',          cat: 'AP Calculus BC' },
    { title: 'AP Chem — Unit 1 Test',       m: 9,  d: 25, s: '10:10', e: '11:05', color: '#3b82f6', desc: 'Atomic structure',               cat: 'AP Chemistry' },
    { title: 'AP US History — Essay',       m: 10, d: 5,  s: '11:15', e: '12:10', color: '#f59e0b', desc: 'DBQ on colonial America',         cat: 'AP US History' },
    { title: 'AP English — Midterm',        m: 10, d: 18, s: '09:05', e: '10:00', color: '#ec4899', desc: 'Poetry analysis midterm',         cat: 'AP English Lit' },
    { title: 'AP Calc BC — Midterm',        m: 10, d: 22, s: '08:00', e: '09:30', color: '#6c63ff', desc: 'Derivatives and integrals',       cat: 'AP Calculus BC' },
    { title: 'AP Chem — Midterm',           m: 10, d: 29, s: '10:10', e: '11:40', color: '#3b82f6', desc: 'Bonding and reactions',           cat: 'AP Chemistry' },
    { title: 'Spanish III — Oral Exam',     m: 11, d: 8,  s: '13:00', e: '13:55', color: '#10b981', desc: 'Conversational assessment',       cat: 'Spanish III' },
    { title: 'AP US History — Final',       m: 12, d: 10, s: '11:15', e: '13:00', color: '#f59e0b', desc: 'Fall semester final exam',        cat: 'AP US History' },
    { title: 'AP Calc BC — Final',          m: 12, d: 12, s: '08:00', e: '09:30', color: '#6c63ff', desc: 'Fall semester final exam',        cat: 'AP Calculus BC' },
    { title: 'AP Chem — Final',             m: 12, d: 13, s: '10:10', e: '11:40', color: '#3b82f6', desc: 'Fall semester final exam',        cat: 'AP Chemistry' },
    { title: 'AP English — Final',          m: 12, d: 11, s: '09:05', e: '10:35', color: '#ec4899', desc: 'Fall semester final exam',        cat: 'AP English Lit' },
    // Spring
    { title: 'AP Calc BC — Unit 5 Test',    m: 2,  d: 10, s: '08:00', e: '08:55', color: '#6c63ff', desc: 'Series and sequences',           cat: 'AP Calculus BC' },
    { title: 'AP Chem — Unit 5 Test',       m: 2,  d: 18, s: '10:10', e: '11:05', color: '#3b82f6', desc: 'Thermodynamics',                 cat: 'AP Chemistry' },
    { title: 'AP US History — Midterm',     m: 3,  d: 5,  s: '11:15', e: '12:45', color: '#f59e0b', desc: 'Reconstruction through WWI',     cat: 'AP US History' },
    { title: 'AP English — Spring Midterm', m: 3,  d: 12, s: '09:05', e: '10:35', color: '#ec4899', desc: 'Drama and long-form essay',       cat: 'AP English Lit' },
    { title: 'AP Calc BC Exam (AP)',        m: 5,  d: 6,  s: '08:00', e: '11:30', color: '#6c63ff', desc: 'College Board AP Exam',          cat: 'AP Calculus BC' },
    { title: 'AP English Lit Exam (AP)',    m: 5,  d: 7,  s: '08:00', e: '11:00', color: '#ec4899', desc: 'College Board AP Exam',          cat: 'AP English Lit' },
    { title: 'AP US History Exam (AP)',     m: 5,  d: 9,  s: '08:00', e: '11:30', color: '#f59e0b', desc: 'College Board AP Exam',          cat: 'AP US History' },
    { title: 'AP Chemistry Exam (AP)',      m: 5,  d: 12, s: '08:00', e: '12:00', color: '#3b82f6', desc: 'College Board AP Exam',          cat: 'AP Chemistry' },
  ];
  tests.forEach(t => {
    events.push({ id: next(), title: t.title, date: fixedDate(t.m, t.d), startTime: t.s, endTime: t.e, description: t.desc, color: t.color, category: t.cat, sharedWith: [] });
  });

  // Sports games
  const soccerGames = [
    { m: 9, d: 14 }, { m: 9, d: 21 }, { m: 9, d: 28 },
    { m: 10, d: 5 }, { m: 10, d: 12 }, { m: 10, d: 19 }, { m: 10, d: 26 },
    { m: 11, d: 2 },
  ];
  soccerGames.forEach(g => {
    events.push({ id: next(), title: 'Soccer Game', date: fixedDate(g.m, g.d), startTime: '16:00', endTime: '18:00', description: 'Varsity soccer match', color: '#10b981', category: 'Soccer', sharedWith: [] });
  });

  const trackMeets = [
    { m: 3, d: 22 }, { m: 4, d: 5 }, { m: 4, d: 19 }, { m: 5, d: 3 }, { m: 5, d: 10 },
  ];
  trackMeets.forEach(g => {
    events.push({ id: next(), title: 'Track & Field Meet', date: fixedDate(g.m, g.d), startTime: '09:00', endTime: '14:00', description: 'Invitational track meet', color: '#f59e0b', category: 'Track & Field', sharedWith: [] });
  });

  // Debate tournaments
  [
    { m: 10, d: 7,  desc: 'Regional qualifier round' },
    { m: 11, d: 18, desc: 'State qualifier tournament' },
    { m: 2,  d: 3,  desc: 'Winter invitational tournament' },
    { m: 3,  d: 17, desc: 'State championship tournament' },
  ].forEach(t => {
    events.push({ id: next(), title: 'Debate Tournament', date: fixedDate(t.m, t.d), startTime: '08:00', endTime: '17:00', description: t.desc, color: '#6c63ff', category: 'Debate Team', sharedWith: [] });
  });

  // Orchestra concerts
  [
    { m: 12, d: 5,  desc: 'Winter holiday concert — school auditorium' },
    { m: 5,  d: 15, desc: 'Spring showcase concert — school auditorium' },
  ].forEach(c => {
    events.push({ id: next(), title: 'Orchestra Concert', date: fixedDate(c.m, c.d), startTime: '19:00', endTime: '21:00', description: c.desc, color: '#ec4899', category: 'Orchestra', sharedWith: [] });
  });

  // Robotics competition
  [
    { m: 11, d: 16, desc: 'Regional robotics competition' },
    { m: 3,  d: 8,  desc: 'State robotics championship' },
  ].forEach(c => {
    events.push({ id: next(), title: 'Robotics Competition', date: fixedDate(c.m, c.d), startTime: '08:00', endTime: '18:00', description: c.desc, color: '#ef4444', category: 'Robotics Club', sharedWith: [] });
  });

  const milestones = [
    { title: 'First Day of School',          m: 9,  d: 3,  s: '07:45', e: '14:30', color: '#10b981', desc: 'Welcome back assembly and homeroom',          cat: 'School' },
    { title: 'Homecoming Dance',             m: 10, d: 11, s: '19:00', e: '23:00', color: '#ec4899', desc: 'Annual homecoming dance',                     cat: 'School' },
    { title: 'SAT Exam',                     m: 10, d: 4,  s: '07:45', e: '13:00', color: '#ef4444', desc: 'SAT at school testing center',                cat: 'School' },
    { title: 'Thanksgiving Break Starts',    m: 11, d: 25, s: '14:30', e: '15:00', color: '#f59e0b', desc: 'No school Nov 25 – Nov 29',                   cat: 'School' },
    { title: 'Winter Break Starts',          m: 12, d: 20, s: '14:30', e: '15:00', color: '#3b82f6', desc: 'No school Dec 20 – Jan 5',                    cat: 'School' },
    { title: 'Back from Winter Break',       m: 1,  d: 6,  s: '07:45', e: '14:30', color: '#3b82f6', desc: 'Spring semester begins',                      cat: 'School' },
    { title: 'SAT Exam',                     m: 3,  d: 8,  s: '07:45', e: '13:00', color: '#ef4444', desc: 'SAT at school testing center',                cat: 'School' },
    { title: 'Spring Break Starts',          m: 4,  d: 7,  s: '14:30', e: '15:00', color: '#10b981', desc: 'No school Apr 7 – Apr 11',                    cat: 'School' },
    { title: 'Back from Spring Break',       m: 4,  d: 14, s: '07:45', e: '14:30', color: '#10b981', desc: 'Classes resume',                              cat: 'School' },
    { title: 'Prom',                         m: 5,  d: 2,  s: '18:00', e: '23:00', color: '#ec4899', desc: 'Junior/Senior Prom — Grand Ballroom',         cat: 'School' },
    { title: 'Senior Awards Night',          m: 5,  d: 20, s: '18:00', e: '20:00', color: '#6c63ff', desc: 'Academic and extracurricular awards',         cat: 'School' },
    { title: 'Graduation Ceremony',          m: 6,  d: 7,  s: '10:00', e: '13:00', color: '#f59e0b', desc: 'Class of 2026 graduation — stadium',          cat: 'School' },
    { title: 'College Application Deadline', m: 11, d: 1,  s: '23:00', e: '23:59', color: '#ef4444', desc: 'Early Decision deadline — check each school', cat: 'School' },
    { title: 'College App Regular Deadline', m: 1,  d: 1,  s: '23:00', e: '23:59', color: '#ef4444', desc: 'Regular Decision deadline — most schools',    cat: 'School' },
  ];
  milestones.forEach(ev => {
    events.push({ id: next(), title: ev.title, date: fixedDate(ev.m, ev.d), startTime: ev.s, endTime: ev.e, description: ev.desc, color: ev.color, category: ev.cat, sharedWith: [] });
  });

  return events.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}

// Generate the fitness coach's weekly schedule events
function buildCoachEvents(): CalendarEvent[] {
  let id = 2000;
  const next = () => String(id++);

  function weekly(
    title: string, weekday: number, startTime: string, endTime: string,
    description: string, color: string, category: string,
    fromMonth: number, fromDay: number,
    toMonth: number, toDay: number
  ): CalendarEvent[] {
    const evts: CalendarEvent[] = [];
    const y = new Date().getFullYear();
    const start = new Date(y, fromMonth - 1, fromDay);
    const end   = new Date(y, toMonth - 1, toDay);
    const cur   = new Date(start);
    while (cur <= end) {
      if (cur.getDay() === weekday) {
        evts.push({
          id: next(), title, color, description, startTime, endTime, category, sharedWith: [],
          date: cur.toISOString().split('T')[0],
        });
      }
      cur.setDate(cur.getDate() + 1);
    }
    return evts;
  }

  const events: CalendarEvent[] = [];

  // ── Recurring client sessions (Mon–Fri) ──
  // 6 AM early-bird client — Mon/Wed/Fri
  events.push(...weekly('Client: Marcus T.', 1, '06:00', '07:00', '1-on-1 strength training session', '#ef4444', 'Clients', 1, 6, 12, 19));
  events.push(...weekly('Client: Marcus T.', 3, '06:00', '07:00', '1-on-1 strength training session', '#ef4444', 'Clients', 1, 6, 12, 19));
  events.push(...weekly('Client: Marcus T.', 5, '06:00', '07:00', '1-on-1 strength training session', '#ef4444', 'Clients', 1, 6, 12, 19));

  // 7 AM client — Tue/Thu
  events.push(...weekly('Client: Priya S.', 2, '07:00', '08:00', 'Weight loss & cardio program', '#ec4899', 'Clients', 1, 6, 12, 19));
  events.push(...weekly('Client: Priya S.', 4, '07:00', '08:00', 'Weight loss & cardio program', '#ec4899', 'Clients', 1, 6, 12, 19));

  // 8 AM group bootcamp — Mon/Wed/Fri
  events.push(...weekly('Bootcamp Class (Group)', 1, '08:00', '09:00', 'High-intensity group bootcamp — 8 participants', '#f59e0b', 'Clients', 1, 6, 12, 19));
  events.push(...weekly('Bootcamp Class (Group)', 3, '08:00', '09:00', 'High-intensity group bootcamp — 8 participants', '#f59e0b', 'Clients', 1, 6, 12, 19));
  events.push(...weekly('Bootcamp Class (Group)', 5, '08:00', '09:00', 'High-intensity group bootcamp — 8 participants', '#f59e0b', 'Clients', 1, 6, 12, 19));

  // 9 AM client — Tue/Thu
  events.push(...weekly('Client: Derek W.', 2, '09:00', '10:00', 'Post-injury rehab & mobility work', '#3b82f6', 'Clients', 1, 6, 12, 19));
  events.push(...weekly('Client: Derek W.', 4, '09:00', '10:00', 'Post-injury rehab & mobility work', '#3b82f6', 'Clients', 1, 6, 12, 19));

  // ── Own gym training — daily ──
  events.push(...weekly('Own Training: Strength', 1, '10:30', '12:00', 'Upper body — bench, rows, overhead press', '#6c63ff', 'Gym', 1, 6, 12, 19));
  events.push(...weekly('Own Training: Cardio',   2, '10:30', '11:30', 'Zone 2 cardio — 60 min steady state', '#6c63ff', 'Gym', 1, 6, 12, 19));
  events.push(...weekly('Own Training: Strength', 3, '10:30', '12:00', 'Lower body — squats, deadlifts, lunges', '#6c63ff', 'Gym', 1, 6, 12, 19));
  events.push(...weekly('Own Training: Mobility', 4, '10:30', '11:15', 'Yoga flow & deep stretch', '#6c63ff', 'Gym', 1, 6, 12, 19));
  events.push(...weekly('Own Training: Strength', 5, '10:30', '12:00', 'Full body compound lifts', '#6c63ff', 'Gym', 1, 6, 12, 19));

  // ── Nutrition check-ins — every Monday ──
  events.push(...weekly('Nutrition Check-in: Marcus T.', 1, '12:30', '13:00', 'Review macro tracking & meal plan adjustments', '#10b981', 'Nutrition', 1, 6, 12, 19));

  // ── Admin — every Friday afternoon ──
  events.push(...weekly('Admin: Client Progress Reports', 5, '13:00', '14:00', 'Write weekly progress notes for all active clients', '#f59e0b', 'Admin', 1, 6, 12, 19));
  events.push(...weekly('Admin: Invoice & Billing',       5, '14:00', '14:30', 'Send invoices and reconcile payments', '#f59e0b', 'Admin', 1, 6, 12, 19));

  // ── Personal ──
  events.push(...weekly('Meal Prep', 0, '11:00', '13:00', 'Batch cook for the week — proteins, grains, veggies', '#10b981', 'Personal', 1, 6, 12, 19));
  events.push(...weekly('Rest & Recovery', 6, '09:00', '10:00', 'Foam rolling, sauna, and light walk', '#10b981', 'Personal', 1, 6, 12, 19));

  // ── One-off events ──
  const oneOffs = [
    // Nutrition
    { title: 'Nutrition Cert Renewal Exam',    m: 3,  d: 15, s: '09:00', e: '12:00', color: '#10b981', desc: 'NASM nutrition certification renewal',          cat: 'Nutrition' },
    { title: 'Nutrition Workshop',             m: 6,  d: 7,  s: '10:00', e: '16:00', color: '#10b981', desc: 'Sports nutrition seminar — downtown convention', cat: 'Nutrition' },
    { title: 'Meal Plan Overhaul: Priya S.',   m: 2,  d: 3,  s: '12:30', e: '13:30', color: '#10b981', desc: 'Redesign 12-week cutting plan',                 cat: 'Nutrition' },
    // Gym / Competitions
    { title: 'Powerlifting Meet',              m: 4,  d: 12, s: '08:00', e: '17:00', color: '#6c63ff', desc: 'Regional open powerlifting competition',         cat: 'Gym' },
    { title: 'Fitness Expo',                   m: 5,  d: 17, s: '09:00', e: '18:00', color: '#6c63ff', desc: 'Annual fitness expo — booth & networking',       cat: 'Gym' },
    { title: 'CPR / First Aid Recertification',m: 7,  d: 19, s: '09:00', e: '13:00', color: '#6c63ff', desc: 'Annual CPR recertification class',               cat: 'Gym' },
    // Clients
    { title: 'New Client Consult: Lisa M.',    m: 2,  d: 10, s: '11:00', e: '12:00', color: '#ef4444', desc: 'Initial assessment and goal-setting session',    cat: 'Clients' },
    { title: 'New Client Consult: Tom R.',     m: 4,  d: 22, s: '11:00', e: '12:00', color: '#ef4444', desc: 'Initial assessment and goal-setting session',    cat: 'Clients' },
    { title: 'Client Appreciation BBQ',        m: 8,  d: 9,  s: '12:00', e: '16:00', color: '#ec4899', desc: 'Annual client appreciation event at the park',   cat: 'Clients' },
    // Admin
    { title: 'Business Tax Filing',            m: 4,  d: 15, s: '10:00', e: '12:00', color: '#f59e0b', desc: 'File quarterly taxes with accountant',           cat: 'Admin' },
    { title: 'Website Refresh Meeting',        m: 3,  d: 5,  s: '14:00', e: '15:00', color: '#f59e0b', desc: 'Review new website design with web dev',         cat: 'Admin' },
    { title: 'Social Media Content Day',       m: 2,  d: 24, s: '13:00', e: '17:00', color: '#f59e0b', desc: 'Batch-record reels and posts for the month',     cat: 'Admin' },
    { title: 'Social Media Content Day',       m: 5,  d: 26, s: '13:00', e: '17:00', color: '#f59e0b', desc: 'Batch-record reels and posts for the month',     cat: 'Admin' },
    // Personal
    { title: 'Annual Physical',                m: 3,  d: 28, s: '09:00', e: '10:30', color: '#10b981', desc: 'Yearly bloodwork and check-up',                  cat: 'Personal' },
    { title: 'Vacation: Costa Rica',           m: 7,  d: 4,  s: '06:00', e: '23:00', color: '#10b981', desc: 'Week off — surf, hike, recharge',                cat: 'Personal' },
    { title: 'Vacation: Costa Rica',           m: 7,  d: 5,  s: '08:00', e: '20:00', color: '#10b981', desc: 'Beach day & zip-lining',                         cat: 'Personal' },
    { title: 'Vacation: Costa Rica',           m: 7,  d: 6,  s: '08:00', e: '20:00', color: '#10b981', desc: 'Volcano hike',                                   cat: 'Personal' },
    { title: 'Vacation: Costa Rica',           m: 7,  d: 7,  s: '08:00', e: '20:00', color: '#10b981', desc: 'Surfing lessons',                                cat: 'Personal' },
    { title: 'Vacation: Costa Rica',           m: 7,  d: 8,  s: '08:00', e: '20:00', color: '#10b981', desc: 'Snorkeling & free day',                          cat: 'Personal' },
    { title: 'Vacation: Costa Rica',           m: 7,  d: 9,  s: '08:00', e: '20:00', color: '#10b981', desc: 'Travel day home',                                cat: 'Personal' },
  ];
  oneOffs.forEach(ev => {
    const y = new Date().getFullYear();
    const dateStr = `${y}-${String(ev.m).padStart(2, '0')}-${String(ev.d).padStart(2, '0')}`;
    events.push({ id: next(), title: ev.title, date: dateStr, startTime: ev.s, endTime: ev.e, description: ev.desc, color: ev.color, category: ev.cat, sharedWith: [] });
  });

  return events.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, CategoryCountPipe, TranslateTitlePipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
  // Modals render as siblings of .app-shell (not descendants of it), so theme CSS
  // variables — which used to live only on .app-shell — never reached them. Mirroring
  // the data-theme attribute onto the host makes :host a valid variable source for
  // everything the component renders, modals included.
  host: { '[attr.data-theme]': "isDarkMode ? 'dark' : 'light'" },
})
export class DashboardComponent implements OnInit, AfterViewInit, OnDestroy {
  userEmail = '';

  // ── Profile panel ──
  profile: UserProfile = { email: '', username: '', avatarUrl: null, language: 'en', region: '' };

  // Animal avatar options
  readonly ANIMAL_AVATARS = [
    { emoji: '🐶', label: 'Dog' },
    { emoji: '🐱', label: 'Cat' },
    { emoji: '🐭', label: 'Mouse' },
    { emoji: '🐹', label: 'Hamster' },
    { emoji: '🐰', label: 'Rabbit' },
    { emoji: '🦊', label: 'Fox' },
    { emoji: '🐻', label: 'Bear' },
    { emoji: '🐼', label: 'Panda' },
    { emoji: '🐨', label: 'Koala' },
    { emoji: '🐯', label: 'Tiger' },
    { emoji: '🦁', label: 'Lion' },
    { emoji: '🐮', label: 'Cow' },
    { emoji: '🐸', label: 'Frog' },
    { emoji: '🐧', label: 'Penguin' },
    { emoji: '🐦', label: 'Bird' },
    { emoji: '🦆', label: 'Duck' },
    { emoji: '🦉', label: 'Owl' },
    { emoji: '🦋', label: 'Butterfly' },
    { emoji: '🐢', label: 'Turtle' },
    { emoji: '🦄', label: 'Unicorn' },
  ];
  showAnimalPicker = false;

  // Profile form fields
  profileUsernameInput = '';
  profileOldPassword = '';
  profileNewPassword = '';
  profileConfirmPassword = '';
  profileLanguage = 'en';
  profileCountry = '';
  profileRegion = '';
  profileRegionMsg = '';
  availableCountries: { code: string; name: string }[] = [];
  availableRegions: string[] = [];
  profileAvatarPreview: string | null = null;

  // Profile feedback
  profileUsernameMsg = '';
  profileUsernameError = '';
  profilePasswordMsg = '';
  profilePasswordError = '';
  profileAvatarMsg = '';
  profileDeleteConfirm = false;
  profileDeletePassword = '';
  profileDeleteError = '';

  // Profile change tracking
  profileSaveMsg = '';
  private originalUsername = '';
  private originalLanguage = 'en';
  private originalAvatarUrl: string | null = null;

  get profileHasChanges(): boolean {
    return (
      this.profileUsernameInput.trim() !== this.originalUsername ||
      this.profileLanguage !== this.originalLanguage ||
      this.profileAvatarPreview !== this.originalAvatarUrl
    );
  }

  readonly LANGUAGES = [
    { code: 'en', label: 'English' },
    { code: 'es', label: 'Español' },
    { code: 'fr', label: 'Français' },
    { code: 'de', label: 'Deutsch' },
    { code: 'pt', label: 'Português' },
    { code: 'it', label: 'Italiano' },
    { code: 'nl', label: 'Nederlands' },
    { code: 'sv', label: 'Svenska' },
    { code: 'pl', label: 'Polski' },
    { code: 'tr', label: 'Türkçe' },
    { code: 'ru', label: 'Русский' },
    { code: 'zh', label: '中文' },
    { code: 'ja', label: '日本語' },
    { code: 'ko', label: '한국어' },
    { code: 'ar', label: 'العربية' },
    { code: 'hi', label: 'हिन्दी' },
  ];

  openProfileTab() {
    this.profile = this.mockAuth.getProfile(this.userEmail);
    this.profileUsernameInput = this.profile.username;
    this.profileLanguage = this.profile.language;
    this.profileAvatarPreview = this.profile.avatarUrl;
    this.profileOldPassword = '';
    this.profileNewPassword = '';
    this.profileConfirmPassword = '';
    this.profileUsernameMsg = '';
    this.profileUsernameError = '';
    this.profilePasswordMsg = '';
    this.profilePasswordError = '';
    this.profileAvatarMsg = '';
    this.profileSaveMsg = '';
    this.profileDeleteConfirm = false;
    this.profileDeletePassword = '';
    this.profileDeleteError = '';
    this.showAnimalPicker = false;
    // Store original values for change detection
    this.originalUsername = this.profile.username;
    this.originalLanguage = this.profile.language;
    this.originalAvatarUrl = this.profile.avatarUrl;
    // Region/holidays
    this.availableCountries = this.holidaysService.getCountries();
    this.profileCountry = this.profile.region?.split(':')[0] ?? '';
    this.profileRegion = this.profile.region?.split(':')[1] ?? '';
    this.availableRegions = this.profileCountry ? this.holidaysService.getRegions(this.profileCountry) : [];
    this.profileRegionMsg = '';
    this.activeTab = 'profile';
  }

  saveProfile() {
    this.profileUsernameMsg = '';
    this.profileUsernameError = '';
    this.profileSaveMsg = '';

    // Validate username
    const name = this.profileUsernameInput.trim();
    if (!name) { this.profileUsernameError = 'Username cannot be empty.'; return; }
    if (name.length < 3) { this.profileUsernameError = 'Username must be at least 3 characters.'; return; }

    // Apply all changes
    this.profile.username = name;
    this.profile.language = this.profileLanguage;
    this.profile.avatarUrl = this.profileAvatarPreview;
    this.mockAuth.saveProfile(this.profile);
    this.i18n.setLanguage(this.profileLanguage);

    // Update original values so the button hides
    this.originalUsername = name;
    this.originalLanguage = this.profileLanguage;
    this.originalAvatarUrl = this.profileAvatarPreview;

    this.profileSaveMsg = 'Profile saved successfully.';
    setTimeout(() => { this.profileSaveMsg = ''; }, 3000);
  }

  saveUsername() {
    this.saveProfile();
  }

  savePassword() {
    this.profilePasswordMsg = '';
    this.profilePasswordError = '';
    if (!this.profileOldPassword) { this.profilePasswordError = 'Enter your current password.'; return; }
    if (!this.profileNewPassword) { this.profilePasswordError = 'Enter a new password.'; return; }
    if (this.profileNewPassword.length < 8) { this.profilePasswordError = 'New password must be at least 8 characters.'; return; }
    if (this.profileNewPassword !== this.profileConfirmPassword) { this.profilePasswordError = 'Passwords do not match.'; return; }
    const ok = this.mockAuth.changePassword(this.userEmail, this.profileOldPassword, this.profileNewPassword);
    if (!ok) { this.profilePasswordError = 'Current password is incorrect.'; return; }
    this.profileOldPassword = '';
    this.profileNewPassword = '';
    this.profileConfirmPassword = '';
    this.profilePasswordMsg = 'Password changed successfully.';
    setTimeout(() => { this.profilePasswordMsg = ''; }, 3000);
  }

  onAvatarFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { this.profileAvatarMsg = 'Please select an image file.'; return; }
    if (file.size > 2 * 1024 * 1024) { this.profileAvatarMsg = 'Image must be under 2 MB.'; return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      this.profileAvatarPreview = result;
      this.profileAvatarMsg = '';
    };
    reader.readAsDataURL(file);
  }

  removeAvatar() {
    this.profileAvatarPreview = null;
    this.profileAvatarMsg = '';
    this.showAnimalPicker = false;
  }

  selectAnimalAvatar(emoji: string) {
    // Convert emoji to a data URL by drawing it on a canvas
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    // Purple gradient background
    const grad = ctx.createLinearGradient(0, 0, 128, 128);
    grad.addColorStop(0, '#6c63ff');
    grad.addColorStop(1, '#764ba2');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(64, 64, 64, 0, Math.PI * 2);
    ctx.fill();
    // Draw emoji
    ctx.font = '72px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 64, 68);
    const dataUrl = canvas.toDataURL('image/png');
    this.profileAvatarPreview = dataUrl;
    this.profileAvatarMsg = '';
    this.showAnimalPicker = false;
  }

  saveLanguage() {
    // Language change is now tracked by profileHasChanges and saved via saveProfile()
  }

  onCountryChange() {
    this.availableRegions = this.profileCountry ? this.holidaysService.getRegions(this.profileCountry) : [];
    this.profileRegion = '';
    this.profileRegionMsg = '';
  }

  saveRegionAndLoadHolidays() {
    if (!this.profileCountry) return;

    // Save region to profile (stored as "CC:Region")
    this.profile.region = this.profileRegion
      ? `${this.profileCountry}:${this.profileRegion}`
      : this.profileCountry;
    this.mockAuth.saveProfile(this.profile);

    // Remove any previously-added holiday events
    this.events = this.events.filter(e => e.category !== 'Holidays');
    // Also clean from localStorage
    const cacheWithoutHolidays = this.events;
    this.eventsService.bulkAddToCache([], this.userEmail); // we'll re-add below

    // Generate holidays for this year and next year
    const thisYear = new Date().getFullYear();
    const holidays = [
      ...this.holidaysService.getHolidays(this.profileCountry, this.profileRegion, thisYear),
      ...this.holidaysService.getHolidays(this.profileCountry, this.profileRegion, thisYear + 1),
    ];

    // Convert to CalendarEvent
    const newEvents: CalendarEvent[] = holidays.map(h => ({
      id: `holiday_${h.date}_${h.title.replace(/\s/g, '_')}`,
      title: h.title,
      date: h.date,
      startTime: '00:00',
      endTime: '23:59',
      description: h.type === 'national' ? 'National Holiday' : 'Regional Holiday',
      color: '#ef4444',
      category: 'Holidays',
      sharedWith: [],
    }));

    // Merge into events
    const existingIds = new Set(cacheWithoutHolidays.map(e => e.id));
    const toAdd = newEvents.filter(e => !existingIds.has(e.id));
    this.events = [...cacheWithoutHolidays, ...toAdd].sort(
      (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)
    );

    // Persist to localStorage
    this.eventsService.bulkAddToCache(this.events, this.userEmail);

    const countryName = this.availableCountries.find(c => c.code === this.profileCountry)?.name ?? this.profileCountry;
    const regionLabel = this.profileRegion ? ` (${this.profileRegion})` : '';
    this.profileRegionMsg = `Added ${toAdd.length} holidays for ${countryName}${regionLabel}.`;
  }

  confirmDeleteAccount() {
    this.profileDeleteConfirm = true;
    this.profileDeleteError = '';
    this.profileDeletePassword = '';
  }

  cancelDeleteAccount() {
    this.profileDeleteConfirm = false;
    this.profileDeleteError = '';
    this.profileDeletePassword = '';
  }

  executeDeleteAccount() {
    if (!this.profileDeletePassword) { this.profileDeleteError = 'Enter your password to confirm.'; return; }
    const ok = this.mockAuth.verifyPassword(this.userEmail, this.profileDeletePassword);
    if (!ok) { this.profileDeleteError = 'Incorrect password.'; return; }
    this.mockAuth.deleteAccount(this.userEmail);
    this.router.navigate(['/']);
  }

  googleCalendarLinked = false;
  linkingGoogle = false;
  googleSyncError = '';

  // ── Google Calendar picker ──
  showGcalPicker = false;
  gcalCalendars: GCalCalendar[] = [];
  gcalPickerLoading = false;
  gcalImporting = false;
  gcalFutureOnly = true;
  gcalImportCount = 0;
  activeTab: 'schedule' | 'agenda' | 'calendar' | 'history' | 'notifications' | 'categories' | 'profile' | 'ai' | 'weekly' | 'friends' = 'schedule';

  // ── Streaks ──
  // Legacy pre-sync storage keys — read once to migrate any existing local-only
  // streaks into the signed-in account, then never written to again.
  private readonly LEGACY_STREAKS_KEY = 'agenda_streaks';
  private readonly LEGACY_STREAK_HISTORY_KEY = 'agenda_streak_history';

  streaks: Streak[] = [];

  streakHistory: (Streak & { deletedAt: string })[] = [];

  showStreakModal = false;
  streakStep: 'name' | 'deadline' | 'details' | 'planning' | 'ready' = 'name';
  streakFormName = '';
  streakFormError = '';
  streakFormTarget = 0;
  streakFormUnit = '';
  streakAiPlan = '';
  streakAiLoading = false;
  showStreakHistory = false;

  // Smart-goal detection: when the habit name implies a finite total (e.g. "500 page
  // book", "run a marathon"), we ask for a deadline and back-calculate the daily target.
  streakGoalTotal: number | null = null;
  streakGoalUnit = '';
  streakDeadline = '';

  async loadStreaks() {
    // Awaited so the one-time migration (below) lands in the backend before
    // the first listStreaks() call, instead of racing it and showing an
    // empty streak list until the next refresh.
    await this.migrateLegacyStreaksIfNeeded();

    const cached = this.streaksService.listStreaks(this.userEmail, (synced) => {
      this.applySyncedStreaks(synced);
    });
    this.applySyncedStreaks(cached);
  }

  private applySyncedStreaks(all: Streak[]) {
    const active: Streak[] = [];
    const history: (Streak & { deletedAt: string })[] = [];
    for (const s of all) {
      if (s.deletedAt) {
        history.push(s as Streak & { deletedAt: string });
      } else {
        this.recomputeStreakDerived(s);
        active.push(s);
      }
    }
    this.streaks = active;
    this.streakHistory = history;
  }

  /**
   * One-time import, per account, of streaks created before backend sync
   * existed (they lived only in this browser's localStorage under a flat,
   * account-independent key — which is exactly why they didn't follow the
   * user to a different login/device). Guarded so it only ever runs once.
   */
  private async migrateLegacyStreaksIfNeeded() {
    if (!this.userEmail) return;
    const migratedFlag = `agenda_streaks_migrated_${this.userEmail}`;
    if (localStorage.getItem(migratedFlag)) return;
    try {
      const rawActive = localStorage.getItem(this.LEGACY_STREAKS_KEY);
      const rawHistory = localStorage.getItem(this.LEGACY_STREAK_HISTORY_KEY);
      const legacyActive: Streak[] = rawActive ? JSON.parse(rawActive) : [];
      const legacyHistory: (Streak & { deletedAt: string })[] = rawHistory ? JSON.parse(rawHistory) : [];
      const combined = [...legacyActive, ...legacyHistory];
      if (combined.length) {
        await this.streaksService.migrateLegacyStreaks(combined, this.userEmail);
      }
    } catch (err) {
      console.error('[Dashboard] Failed to migrate legacy streaks:', err);
    }
    localStorage.setItem(migratedFlag, '1');
  }

  openStreakModal() {
    this.showStreakModal = true;
    this.streakStep = 'name';
    this.streakFormName = '';
    this.streakFormError = '';
    this.streakFormTarget = 0;
    this.streakFormUnit = '';
    this.streakAiPlan = '';
    this.streakGoalTotal = null;
    this.streakGoalUnit = '';
    this.streakDeadline = '';
  }

  closeStreakModal() {
    this.showStreakModal = false;
  }

  /** Fallback keyword defaults for open-ended habits (no finite total detected). */
  private applyStreakDefaults(name: string) {
    const lower = name.toLowerCase();
    if (lower.includes('read')) { this.streakFormUnit = 'pages'; this.streakFormTarget = 20; }
    else if (lower.includes('water') || lower.includes('drink')) { this.streakFormUnit = 'glasses'; this.streakFormTarget = 8; }
    else if (lower.includes('run') || lower.includes('walk') || lower.includes('exercise') || lower.includes('workout')) { this.streakFormUnit = 'minutes'; this.streakFormTarget = 30; }
    else if (lower.includes('meditat')) { this.streakFormUnit = 'minutes'; this.streakFormTarget = 10; }
    else if (lower.includes('code') || lower.includes('study')) { this.streakFormUnit = 'minutes'; this.streakFormTarget = 60; }
    else { this.streakFormUnit = 'minutes'; this.streakFormTarget = 30; }
  }

  /**
   * Detects a finite goal in a free-text habit description, e.g. "500 page book",
   * "read War and Peace (1225 pages)", "run a marathon". Returns the total quantity
   * and its unit so the daily target can be back-calculated from a deadline.
   */
  private parseStreakGoal(name: string): { total: number; unit: string } | null {
    const lower = name.toLowerCase();

    // Explicit "<number> <unit>" anywhere in the text (allows a hyphen, e.g. "500-page").
    const match = lower.match(
      /(\d+(?:\.\d+)?)\s*[-\s]?\s*(pages?|words?|chapters?|miles?|mi\b|kilometers?|kilometres?|km\b|laps?|reps?|sets?|books?)/
    );
    if (match) {
      const total = parseFloat(match[1]);
      const rawUnit = match[2].replace(/\.$/, '');
      const unit = /s$/.test(rawUnit) || rawUnit === 'mi' || rawUnit === 'km' ? rawUnit : rawUnit + 's';
      if (total > 0) return { total, unit: unit === 'mi' ? 'miles' : unit === 'km' ? 'km' : unit };
    }

    // Common named distances that don't spell out a number.
    if (/half[\s-]?marathon/.test(lower)) return { total: 13.1, unit: 'miles' };
    if (/\bmarathon\b/.test(lower)) return { total: 26.2, unit: 'miles' };
    if (/\b10\s?k\b/.test(lower)) return { total: 6.2, unit: 'miles' };
    if (/\b5\s?k\b/.test(lower)) return { total: 3.1, unit: 'miles' };

    return null;
  }

  streakNextFromName() {
    const name = this.streakFormName.trim();
    if (!name) { this.streakFormError = 'Give your streak a name.'; return; }
    if (this.streaks.find(s => s.name === name)) { this.streakFormError = 'A streak with that name already exists.'; return; }
    this.streakFormError = '';

    const goal = this.parseStreakGoal(name);
    if (goal) {
      // Finite goal detected (e.g. "500 page book") — ask when they want to finish
      // so the daily target can be calculated for them, instead of guessing.
      this.streakGoalTotal = goal.total;
      this.streakGoalUnit = goal.unit;
      this.streakDeadline = '';
      this.streakStep = 'deadline';
    } else {
      this.applyStreakDefaults(name);
      this.streakStep = 'details';
    }
  }

  /** User picked a finish date for a finite goal — back-calculate the daily target. */
  streakDeadlineContinue() {
    if (!this.streakDeadline) { this.streakFormError = 'Pick a date, or skip to set a target manually.'; return; }
    if (this.streakDeadline < this.today) { this.streakFormError = 'Pick a date in the future.'; return; }
    this.streakFormError = '';
    const days = Math.max(1, this.daysBetween(this.today, this.streakDeadline));
    const total = this.streakGoalTotal ?? 0;
    this.streakFormTarget = Math.max(1, Math.ceil(total / days));
    this.streakFormUnit = this.streakGoalUnit;
    this.streakStep = 'details';
  }

  /** No deadline — fall back to a generic open-ended target for this habit. */
  streakDeadlineSkip() {
    this.streakGoalTotal = null;
    this.streakGoalUnit = '';
    this.streakDeadline = '';
    this.applyStreakDefaults(this.streakFormName.trim());
    this.streakStep = 'details';
  }

  private daysBetween(a: string, b: string): number {
    const ms = new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime();
    return Math.round(ms / 86400000);
  }

  async streakAskAi() {
    this.streakFormError = '';
    if (!this.streakFormTarget || this.streakFormTarget <= 0) { this.streakFormError = 'Set a daily target above 0.'; return; }
    if (!this.streakFormUnit.trim()) { this.streakFormError = 'Specify a unit.'; return; }
    this.streakStep = 'planning';
    this.streakAiLoading = true;
    try {
      const goalContext = this.streakGoalTotal
        ? ` My overall goal is ${this.streakGoalTotal} ${this.streakGoalUnit} total, finishing by ${this.streakDeadline}.`
        : '';
      const prompt = `I want to build a daily habit: "${this.streakFormName}". My daily goal is ${this.streakFormTarget} ${this.streakFormUnit}.${goalContext} Give me a short 2-3 sentence motivational plan for maintaining this streak. Include a tip for consistency. Be concise and encouraging.`;
      const { text } = await this.bedrockChat.sendMessage(prompt, this.events, []);
      this.streakAiPlan = text.trim();
    } catch {
      this.streakAiPlan = `Aim for ${this.streakFormTarget} ${this.streakFormUnit} every day. Start small if needed — consistency beats intensity. Try pairing it with an existing habit to make it stick.`;
    }
    this.streakAiLoading = false;
    this.streakStep = 'ready';
  }

  async createStreak() {
    const name = this.streakFormName.trim();
    if (!name) return;
    const streak: Omit<Streak, 'id'> = {
      name,
      target: this.streakFormTarget || 1,
      unit: this.streakFormUnit.trim() || 'times',
      checkedDays: [], loggedValues: {},
      aiPlan: this.streakAiPlan,
      createdAt: new Date().toISOString().split('T')[0],
      ...(this.streakGoalTotal ? { goalTotal: this.streakGoalTotal, goalDeadline: this.streakDeadline } : {}),
    };
    const saved = await this.streaksService.createStreak(streak, this.userEmail);
    this.recomputeStreakDerived(saved);
    this.streaks = [...this.streaks, saved];
    this.closeStreakModal();
  }

  /** Progress toward a finite streak goal (e.g. "180 / 500 pages"), or null if this streak has no goal. */
  getStreakGoalProgress(streak: Streak): { current: number; total: number; percent: number; daysLeft: number } | null {
    if (!streak.goalTotal) return null;
    const current = Object.values(streak.loggedValues).reduce((sum, v) => sum + v, 0);
    const percent = Math.min(100, Math.round((current / streak.goalTotal) * 100));
    const daysLeft = streak.goalDeadline ? Math.max(0, this.daysBetween(this.today, streak.goalDeadline)) : 0;
    return { current, total: streak.goalTotal, percent, daysLeft };
  }

  async deleteStreak(id: string) {
    const streak = this.streaks.find(s => s.id === id);
    if (streak) {
      const deletedAt = new Date().toISOString();
      const updated = { ...streak, deletedAt } as Streak & { deletedAt: string };
      this.streakHistory = [...this.streakHistory, updated];
      await this.streaksService.updateStreak(updated, this.userEmail);
    }
    this.streaks = this.streaks.filter(s => s.id !== id);
  }

  async restoreStreak(id: string) {
    const entry = this.streakHistory.find(s => s.id === id);
    if (!entry) return;
    const { deletedAt: _d, ...rest } = entry;
    const streak = rest as Streak;
    this.recomputeStreakDerived(streak);
    this.streaks = [...this.streaks, streak];
    this.streakHistory = this.streakHistory.filter(s => s.id !== id);
    await this.streaksService.updateStreak({ ...streak, deletedAt: undefined }, this.userEmail);
  }

  async permanentlyDeleteStreak(id: string) {
    this.streakHistory = this.streakHistory.filter(s => s.id !== id);
    await this.streaksService.deleteStreak(id, this.userEmail);
  }

  logStreakValue(streak: Streak, dateStr: string, value: number) {
    if (dateStr > new Date().toISOString().split('T')[0]) return;
    streak.loggedValues[dateStr] = value;
    if (value >= streak.target && !streak.checkedDays.includes(dateStr)) {
      streak.checkedDays = [...streak.checkedDays, dateStr].sort();
    } else if (value < streak.target) {
      streak.checkedDays = streak.checkedDays.filter(d => d !== dateStr);
    }
    this.recomputeStreakDerived(streak);
    this.streaksService.updateStreak(streak, this.userEmail).catch(err =>
      console.error('[Dashboard] Failed to persist streak log:', err)
    );
  }

  /** Which date each streak's log row is currently editing (defaults to today, never a future date). */
  private selectedLogDate: Record<string, string> = {};

  getSelectedLogDate(streak: Streak): string {
    return this.selectedLogDate[streak.id] || this.today;
  }

  /** Clicking a day in the week strip selects it for logging — it no longer marks the day complete by itself. */
  selectLogDate(streak: Streak, dateStr: string) {
    if (dateStr > this.today) return;
    this.selectedLogDate[streak.id] = dateStr;
  }

  adjustStreakLog(streak: Streak, delta: number) {
    const dateStr = this.getSelectedLogDate(streak);
    const current = streak.loggedValues[dateStr] || 0;
    this.logStreakValue(streak, dateStr, Math.max(0, current + delta));
  }

  // Recomputes the cached streak count/week after a mutation, instead of
  // recalculating (sort + scan) on every template read / change-detection cycle.
  private recomputeStreakDerived(streak: Streak) {
    streak._count = this.computeStreakCount(streak.checkedDays);
    streak._week = this.computeStreakWeek(streak);
  }

  private computeStreakCount(checkedDays: string[]): number {
    const today = new Date().toISOString().split('T')[0];
    const sorted = [...checkedDays].sort().reverse();
    if (sorted.length === 0) return 0;
    let count = 0;
    const cursor = new Date(today + 'T12:00:00');
    if (!sorted.includes(today)) { cursor.setDate(cursor.getDate() - 1); }
    for (const day of sorted) {
      const expected = cursor.toISOString().split('T')[0];
      if (day === expected) { count++; cursor.setDate(cursor.getDate() - 1); }
      else if (day < expected) break;
    }
    return count;
  }

  private computeStreakWeek(streak: { checkedDays: string[]; loggedValues?: Record<string, number> }): StreakDay[] {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const checkedSet = new Set(streak.checkedDays);
    const days: StreakDay[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      // Derive the weekday from dateStr itself (UTC), not d.getDay() (local) — those
      // can disagree by a day in the evening for timezones behind UTC, which showed
      // up as e.g. a cell labeled "Thu" actually pointing at Friday's data.
      const label = dayNames[new Date(dateStr + 'T00:00:00Z').getUTCDay()];
      days.push({ date: dateStr, label, checked: checkedSet.has(dateStr), isToday: dateStr === todayStr, isFuture: dateStr > todayStr, value: streak.loggedValues?.[dateStr] ?? 0 });
    }
    return days;
  }

  /** Returns the current streak count, using the cached value kept up to date by recomputeStreakDerived. */
  getStreakCount(streak: Streak): number {
    return streak._count ?? this.computeStreakCount(streak.checkedDays);
  }

  /** Returns the last-7-days view, using the cached value kept up to date by recomputeStreakDerived. */
  getStreakWeek(streak: Streak): StreakDay[] {
    return streak._week ?? this.computeStreakWeek(streak);
  }

  getStreakDayTitle(streak: Streak, day: StreakDay): string {
    if (day.checked) return this.i18n.t('streakDayComplete');
    if (day.value > 0) return `${day.value} / ${streak.target} ${streak.unit} — ${this.i18n.t('streakDayNotYetComplete')}`;
    return this.i18n.t('streakDayClickToLog');
  }

  getStreakReminders(): { title: string; body: string }[] {
    const today = new Date().toISOString().split('T')[0];
    const reminders: { title: string; body: string }[] = [];
    for (const streak of this.streaks) {
      if (!streak.checkedDays.includes(today)) {
        reminders.push({
          title: `Don't break your streak: ${streak.name}`,
          body: `Goal: ${streak.target} ${streak.unit} today. Current streak: ${this.getStreakCount(streak)} days!`,
        });
      }
    }
    return reminders;
  }

  // ── History ──
  private readonly HISTORY_KEY_PREFIX = 'agenda_event_history_';
  private readonly HISTORY_TTL_DAYS = 7;
  history: HistoryEntry[] = [];

  private get historyKey(): string {
    return this.HISTORY_KEY_PREFIX + (this.userEmail || 'default');
  }
  historyFilter: 'all' | HistoryAction = 'all';
  historySearch = '';
  historyRestoreMsg = '';
  showScheduleModal = false;

  // ── AI Organize ──
  showOrganizeModal = false;
  organizeInput = '';
  organizeLoading = false;
  organizeError = '';
  organizeResult: OrganizeResult | null = null;
  organizePreview: OrganizedEvent[] = [];
  organizeAccepted = false;
  organizeRemovedIndexes = new Set<number>();

  openOrganizeModal() {
    this.organizeInput = '';
    this.organizeLoading = false;
    this.organizeError = '';
    this.organizeResult = null;
    this.organizePreview = [];
    this.organizeAccepted = false;
    this.organizeRemovedIndexes = new Set();
    this.showOrganizeModal = true;
  }

  closeOrganizeModal() {
    this.showOrganizeModal = false;
  }

  async submitOrganize() {
    const input = this.organizeInput.trim();
    if (!input) {
      this.organizeError = 'Please describe your schedule or activities.';
      return;
    }
    this.organizeLoading = true;
    this.organizeError = '';
    this.organizeResult = null;
    this.organizePreview = [];
    this.organizeRemovedIndexes = new Set();

    try {
      const result = await this.aiOrganize.organize(
        input,
        this.events,
        this.allCategories,
      );
      this.organizeResult = result;
      this.organizePreview = result.events;
      if (result.events.length === 0) {
        this.organizeError = 'Could not parse any events from your description. Try being more specific with times and days.';
      }
    } catch (err: any) {
      this.organizeError = err?.message || 'Something went wrong. Please try again.';
    } finally {
      this.organizeLoading = false;
    }
  }

  removeOrganizedEvent(index: number) {
    this.organizeRemovedIndexes.add(index);
  }

  resetOrganizePreview() {
    this.organizeResult = null;
    this.organizePreview = [];
    this.organizeRemovedIndexes = new Set<number>();
  }

  get organizeVisibleEvents(): OrganizedEvent[] {
    return this.organizePreview.filter((_, i) => !this.organizeRemovedIndexes.has(i));
  }

  async acceptOrganizedEvents() {
    const eventsToAdd = this.organizeVisibleEvents;
    if (eventsToAdd.length === 0) return;

    const newEvents: CalendarEvent[] = eventsToAdd.map((ev, i) => ({
      id: `${Date.now()}_org_${i}`,
      title: ev.title,
      date: ev.date,
      startTime: ev.startTime,
      endTime: ev.endTime,
      description: ev.description || '',
      color: ev.color || '#6c63ff',
      category: ev.category || '',
      sharedWith: [],
    }));

    // Add categories to saved list
    if (this.organizeResult?.categories) {
      for (const cat of this.organizeResult.categories) {
        if (cat && !this.savedCategories.includes(cat)) {
          this.savedCategories = [...this.savedCategories, cat];
        }
      }
      this.persistCategories();
    }

    // Optimistically update UI
    this.events = [...this.events, ...newEvents].sort(
      (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)
    );
    for (const ev of newEvents) {
      this.recordHistory('added', ev);
    }

    this.organizeAccepted = true;

    // Persist to DB in background
    try {
      const toCreate = newEvents.map(({ id: _id, ...rest }) => rest);
      const saved = await this.eventsService.seedEvents(toCreate, this.userEmail);
      const savedMap = new Map(saved.map((s, i) => [newEvents[i].id, s]));
      this.events = this.events.map(e => savedMap.get(e.id) || e);
    } catch (err) {
      console.error('[AiOrganize] Failed to persist events:', err);
    }

    setTimeout(() => {
      this.showOrganizeModal = false;
      this.organizeAccepted = false;
    }, 1500);
  }

  // ── AI Chat ──
  chatMessages: ChatMessage[] = [];
  chatInput = '';
  chatTyping = false;
  showFloatingChat = false;
  chatEventDraft: EventDraft | null = null;
  /** Tracks which proactive reminders have already been created this session. */
  private seenProactiveKeys = new Set<string>();

  // ── AI Login Banner ──
  loginBannerItems: { title: string; body: string }[] = [];
  showLoginBanner = false;
  private loginBannerTimer: any = null;

  // ── AI Tab (saved conversations) ──
  aiConversations: { id: string; title: string; messages: ChatMessage[]; createdAt: string }[] = [];
  activeConversationId: string | null = null;

  get activeConversation() {
    return this.aiConversations.find(c => c.id === this.activeConversationId) || null;
  }

  loadAiConversations() {
    try {
      const raw = localStorage.getItem(`agenda_ai_chats_${this.userEmail}`);
      this.aiConversations = raw ? JSON.parse(raw) : [];
    } catch { this.aiConversations = []; }
  }

  saveAiConversations() {
    localStorage.setItem(`agenda_ai_chats_${this.userEmail}`, JSON.stringify(this.aiConversations));
  }

  startNewAiConversation() {
    const conv = {
      id: `conv_${Date.now()}`,
      title: 'New Chat',
      messages: [] as ChatMessage[],
      createdAt: new Date().toISOString(),
    };
    this.aiConversations.unshift(conv);
    this.activeConversationId = conv.id;
    this.chatMessages = [];
    this.saveAiConversations();
  }

  openAiConversation(id: string) {
    this.activeConversationId = id;
    const conv = this.activeConversation;
    this.chatMessages = conv ? [...conv.messages] : [];
    this.scrollChatToBottom();
  }

  deleteAiConversation(id: string) {
    this.aiConversations = this.aiConversations.filter(c => c.id !== id);
    if (this.activeConversationId === id) {
      this.activeConversationId = this.aiConversations[0]?.id || null;
      this.chatMessages = this.activeConversation?.messages || [];
    }
    this.saveAiConversations();
  }

  private syncConversationMessages() {
    if (this.activeConversationId) {
      const conv = this.aiConversations.find(c => c.id === this.activeConversationId);
      if (conv) {
        conv.messages = [...this.chatMessages];
        // Update title from first user message
        const firstUser = conv.messages.find(m => m.role === 'user');
        if (firstUser) {
          conv.title = firstUser.text.slice(0, 40) + (firstUser.text.length > 40 ? '...' : '');
        }
        this.saveAiConversations();
      }
    }
  }

  // ── Weekly Summary Tab ──
  weeklySummaryDays: { date: string; label: string; events: any[]; isToday: boolean }[] = [];
  weeklyAiSuggestions: string = '';
  weeklyAiLoading = false;

  loadWeeklySummary() {
    const todayStr = new Date().toISOString().split('T')[0];
    const days: typeof this.weeklySummaryDays = [];

    for (let i = 0; i < 7; i++) {
      const d = new Date(todayStr + 'T00:00:00');
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const dayEvents = this.events
        .filter(e => e.date === dateStr)
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
      days.push({
        date: dateStr,
        label: d.toLocaleDateString(this.i18n.getLocale(), { weekday: 'long', month: 'short', day: 'numeric' }),
        events: dayEvents,
        isToday: i === 0,
      });
    }

    this.weeklySummaryDays = days;
    this.getWeeklyAiSuggestions();
  }

  async getWeeklyAiSuggestions() {
    this.weeklyAiLoading = true;
    this.weeklyAiSuggestions = '';

    const totalEvents = this.weeklySummaryDays.reduce((sum, d) => sum + d.events.length, 0);
    const busyDays = this.weeklySummaryDays.filter(d => d.events.length >= 3);
    const freeDays = this.weeklySummaryDays.filter(d => d.events.length === 0);

    try {
      const prompt = `Give me 3-4 brief scheduling tips for this week. My schedule: ${totalEvents} events total, ${busyDays.length} busy days, ${freeDays.length} free days. Events include: ${this.events.filter(e => e.date >= this.weeklySummaryDays[0]?.date && e.date <= this.weeklySummaryDays[6]?.date).slice(0, 10).map(e => e.title).join(', ') || 'nothing scheduled'}.`;

      const { text } = await this.bedrockChat.sendMessage(prompt, this.events, []);
      this.weeklyAiSuggestions = text;
    } catch {
      // Fallback to local suggestions
      const tips: string[] = [];
      if (freeDays.length > 0) {
        tips.push(`You have **${freeDays.length} free day${freeDays.length > 1 ? 's' : ''}** this week (${freeDays.map(d => d.label.split(',')[0]).join(', ')}). Great time for personal projects or self-care.`);
      }
      if (busyDays.length > 0) {
        tips.push(`**${busyDays[0].label}** is your busiest day with ${busyDays[0].events.length} events. Plan breaks between them.`);
      }
      if (totalEvents === 0) {
        tips.push(`Your week is completely open! Consider adding some structure — workouts, study time, or social activities.`);
      }
      if (totalEvents > 15) {
        tips.push(`You have ${totalEvents} events this week — that's a lot! Make sure to schedule downtime.`);
      }
      this.weeklyAiSuggestions = tips.join('\n\n') || 'Your week looks good! No specific suggestions.';
    }
    this.weeklyAiLoading = false;
  }

  sendChatMessage() {
    const text = this.chatInput.trim();
    if (!text) return;
    this.chatInput = '';

    // Add user message
    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}_u`,
      role: 'user',
      text,
      timestamp: new Date(),
    };
    this.chatMessages = [...this.chatMessages, userMsg];

    // Check if we're in a local event creation wizard (e.g. mid slot-pick flow)
    if (this.chatEventDraft) {
      this.handleEventWizardStep(text);
      return;
    }

    // Event creation/scheduling requests go to Bedrock AI too — its system
    // prompt already runs the full gather-info -> confirm -> act flow, so
    // routing these into the local step-by-step wizard instead just threw
    // away everything the user said except the title and re-asked for it.
    this.chatTyping = true;
    this.scrollChatToBottom();

    this.bedrockChat.sendMessage(text, this.events, this.chatMessages).then(({ text: reply, actions }) => {
      console.log('[AI Chat] Actions found:', actions.length, actions);
      
      // If no actions were parsed but the AI's reply opens with completion
      // phrasing (e.g. "Adding Basketball...", "Removed Dentist..."), it
      // believes it just made a change that never actually landed. Anchored
      // to the start of a line so this doesn't false-positive on prose that
      // merely mentions "scheduled" — e.g. quoting back a list of existing
      // events while asking the user to confirm a deletion.
      let displayText = reply;
      if (actions.length === 0 && /^(adding|added|done\b|removed|deleted|moved|rescheduled|scheduling)\b/im.test(reply)) {
        displayText = reply + '\n\n⚠️ _That change could not be saved automatically. Please try again or make it manually._';
      }

      const assistantMsg: ChatMessage = {
        id: `msg_${Date.now()}_a`,
        role: 'assistant',
        text: displayText,
        timestamp: new Date(),
      };
      this.chatMessages = [...this.chatMessages, assistantMsg];
      this.chatTyping = false;
      this.scrollChatToBottom();
      this.syncConversationMessages();

      // The Lambda only ever emits create_event / create_recurring /
      // create_reminder after the user has already explicitly confirmed the
      // proposed details on a prior chat turn (see bedrock-chat SYSTEM_PROMPT
      // rules 3-4), so by the time an action reaches the frontend it's meant
      // to happen — execute it immediately instead of waiting on a second,
      // redundant button click the user has no reason to expect.
      for (const action of actions) {
        this.executeBedrockAction(action);
      }
    }).catch((err) => {
      console.error('[AI Chat] Error:', err);
      this.chatMessages = [...this.chatMessages, {
        id: `msg_${Date.now()}_err`,
        role: 'assistant',
        text: 'Sorry, I had trouble responding. Please try again.',
        timestamp: new Date(),
      }];
      this.chatTyping = false;
      this.scrollChatToBottom();
    });
  }

  private async executeBedrockAction(action: BedrockAction) {
    if (action.type === 'create_event' && action.title && action.date && action.startTime && action.endTime) {
      await this.createEventFromChat({
        title: action.title,
        date: action.date,
        startTime: action.startTime,
        endTime: action.endTime,
        category: action.category || '',
        color: '#6c63ff',
        description: '',
        sharedWith: [],
      });
    }
    if (action.type === 'create_recurring' && action.title && action.startTime && action.endTime && action.dayOfWeek !== undefined) {
      await this.createEventFromChat({
        title: action.title,
        date: '',
        startTime: action.startTime,
        endTime: action.endTime,
        category: action.category || '',
        color: '#6c63ff',
        description: '',
        sharedWith: [],
        _recurring: { dayOfWeek: action.dayOfWeek, weeks: action.weeks || 12 },
      } as any);
    }
    if (action.type === 'create_reminder' && action.title) {
      await this.createAiReminder(action.title, action.body || '');
    }
    if (action.type === 'navigate' && action.tab) {
      this.switchTab(action.tab as any);
    }
    if (action.type === 'delete_event' && action.title && action.date) {
      const match = this.findEventForAiAction(action.title, action.date);
      if (match) {
        this.deleteEvent(match.id);
      } else {
        this.reportAiActionMismatch(action.title, action.date);
      }
    }
    if (action.type === 'reschedule_event' && action.title && action.date && action.newDate && action.newStartTime && action.newEndTime) {
      const before = this.findEventForAiAction(action.title, action.date);
      if (before) {
        const after = { ...before, date: action.newDate, startTime: action.newStartTime, endTime: action.newEndTime };
        this.events = this.events
          .map(e => e.id === before.id ? after : e)
          .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
        this.recordHistory('changed', after, before);
        this.eventsService.updateEvent(after).catch(err =>
          console.error('[Dashboard] Failed to persist AI reschedule:', err)
        );
      } else {
        this.reportAiActionMismatch(action.title, action.date);
      }
    }
  }

  /**
   * Resolves the event an AI delete/reschedule action refers to. Falls back
   * past an exact title+date match — whitespace differences or slight
   * rewording from the model shouldn't turn a correct, unambiguous request
   * into a silent no-op — but only when the fallback is itself unambiguous.
   */
  private findEventForAiAction(title: string, date: string): CalendarEvent | undefined {
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
    const wantTitle = norm(title);

    const exact = this.events.find(e => norm(e.title) === wantTitle && e.date === date);
    if (exact) return exact;

    // Same date, title merely reworded/mistranscribed — only safe if that date has exactly one event.
    const onDate = this.events.filter(e => e.date === date);
    if (onDate.length === 1) return onDate[0];

    // Same (normalized) title on a different date — only safe if the title is unique across the calendar.
    const byTitle = this.events.filter(e => norm(e.title) === wantTitle);
    if (byTitle.length === 1) return byTitle[0];

    return undefined;
  }

  /** Tells the user exactly why an AI delete/reschedule couldn't be applied, instead of a generic "try again". */
  private reportAiActionMismatch(title: string, date: string) {
    const onDate = this.events.filter(e => e.date === date);
    const listing = onDate.length > 0
      ? `Here's what's on your calendar for ${this.formatDate(date)}: ${onDate.map(e => `"${e.title}"`).join(', ')}.`
      : `You don't have anything on your calendar for ${this.formatDate(date)}.`;
    this.chatMessages = [...this.chatMessages, {
      id: `msg_${Date.now()}_mismatch`,
      role: 'assistant',
      text: `⚠️ I couldn't find **"${title}"** on ${this.formatDate(date)} to update. ${listing} Try naming it exactly as it appears above.`,
      timestamp: new Date(),
    }];
    this.scrollChatToBottom();
  }

  handleChatAction(action: { label: string; type: string; tab?: string; reminderTitle?: string; reminderBody?: string; copyText?: string; payload?: any; slotIndex?: number }) {
    if (action.type === 'navigate' && action.tab) {
      this.switchTab(action.tab as any);
      this.showFloatingChat = false;
    }
    if (action.type === 'create_reminder' && action.reminderTitle) {
      this.createAiReminder(action.reminderTitle, action.reminderBody ?? '');
    }
    // Bedrock-suggested event/recurring/reminder actions carry their fields
    // directly on the action (title/date/startTime/...), not wrapped in
    // `payload` or `reminderTitle`. These only ever execute here, on an
    // explicit user click of the confirmation button — never automatically.
    if (
      (action.type === 'create_event' || action.type === 'create_recurring') &&
      !action.payload
    ) {
      this.executeBedrockAction(action as any as BedrockAction);
    }
    if (action.type === 'create_reminder' && !action.reminderTitle && (action as any).title) {
      this.executeBedrockAction(action as any as BedrockAction);
    }
    if (action.type === 'copy_text' && action.copyText) {
      navigator.clipboard.writeText(action.copyText).then(() => {
        this.chatMessages = [...this.chatMessages, {
          id: `msg_${Date.now()}_copy`,
          role: 'assistant',
          text: '✅ Copied to clipboard!',
          timestamp: new Date(),
        }];
      }).catch(() => {
        this.chatMessages = [...this.chatMessages, {
          id: `msg_${Date.now()}_copy`,
          role: 'assistant',
          text: '⚠️ Could not copy automatically. Please select and copy the text above manually.',
          timestamp: new Date(),
        }];
      });
    }
    if (action.type === 'confirm_create_event' && action.payload) {
      this.createEventFromChat(action.payload);
    }
    if (action.type === 'pick_slot' && this.chatEventDraft) {
      const t = new Date().toISOString().split('T')[0];
      const { message, draft } = this.aiChatService.pickSlot(action.slotIndex ?? -1, this.chatEventDraft, this.events, t);
      this.chatMessages = [...this.chatMessages, message];
      this.chatEventDraft = draft;
      this.scrollChatToBottom();
      // If picking a slot produced a confirm_create_event action, auto-fire it
      if (message.actions?.length === 1 && message.actions[0].type === 'confirm_create_event') {
        this.createEventFromChat(message.actions[0].payload);
      }
    }
  }

  async createEventFromChat(payload: any) {
    this.chatTyping = true;
    try {
      // Check if this is a recurring event
      if (payload._recurring) {
        const { dayOfWeek, weeks: requestedWeeks } = payload._recurring;
        const weeks = Math.min(requestedWeeks || 12, 12); // Cap at 12 weeks
        const todayStr = new Date().toISOString().split('T')[0];

        // Find the next occurrence of the target day
        const startDate = new Date(todayStr + 'T00:00:00');
        while (startDate.getDay() !== dayOfWeek) {
          startDate.setDate(startDate.getDate() + 1);
        }

        // Build all dates first
        const dates: string[] = [];
        for (let w = 0; w < weeks; w++) {
          const date = new Date(startDate);
          date.setDate(date.getDate() + w * 7);
          dates.push(date.toISOString().split('T')[0]);
        }

        // Create events in parallel batches of 5
        for (let i = 0; i < dates.length; i += 5) {
          const batch = dates.slice(i, i + 5);
          await Promise.all(batch.map(dateStr =>
            this.eventsService.createEvent({
              title:       payload.title,
              date:        dateStr,
              startTime:   payload.startTime,
              endTime:     payload.endTime,
              description: payload.description ?? '',
              color:       payload.color ?? '#6c63ff',
              category:    payload.category ?? '',
              sharedWith:  payload.sharedWith ?? [],
            }, this.userEmail)
          ));
        }

        // Refresh events
        this.events = this.eventsService.listEvents(this.userEmail, (synced) => {
          this.events = synced;
        });
        // Force a fresh read from localStorage
        const freshEvents = this.eventsService.listEvents(this.userEmail);
        if (freshEvents.length > this.events.length) {
          this.events = freshEvents;
        }

        this.chatEventDraft = null;
        const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dayOfWeek];
        this.chatMessages = [...this.chatMessages, {
          id: `msg_${Date.now()}_created`,
          role: 'assistant',
          text: `✅ Added **${weeks}** occurrences of **"${payload.title}"** every ${dayName} at ${this.formatTime(payload.startTime)}!`,
          timestamp: new Date(),
          actions: [{ label: 'View in Agenda', type: 'navigate', tab: 'agenda' }],
        }];
      } else {
        // Single event
        console.log('[CreateEvent] Calling eventsService.createEvent with:', payload);
        const created = await this.eventsService.createEvent({
          title:       payload.title,
          date:        payload.date,
          startTime:   payload.startTime,
          endTime:     payload.endTime,
          description: payload.description ?? '',
          color:       payload.color ?? '#6c63ff',
          category:    payload.category ?? '',
          sharedWith:  payload.sharedWith ?? [],
        }, this.userEmail);
        console.log('[CreateEvent] Result:', created);
        console.log('[CreateEvent] userEmail:', this.userEmail);

        // Force refresh the events list by re-reading from cache
        this.events = this.eventsService.listEvents(this.userEmail, (synced) => {
          this.events = synced;
        });
        // Also push the created event directly into the array if not already there
        if (!this.events.find(e => e.id === created.id)) {
          this.events = [...this.events, created].sort((a, b) =>
            a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)
          );
        }

        this.chatEventDraft = null;
        this.chatMessages = [...this.chatMessages, {
          id: `msg_${Date.now()}_created`,
          role: 'assistant',
          text: `✅ **"${created.title}"** has been added to your calendar on ${this.formatDate(created.date)} at ${this.formatTime(created.startTime)}!`,
          timestamp: new Date(),
          actions: [{ label: 'View in Agenda', type: 'navigate', tab: 'agenda' }],
        }];
      }
    } catch {
      this.chatMessages = [...this.chatMessages, {
        id: `msg_${Date.now()}_err`,
        role: 'assistant',
        text: `⚠️ Something went wrong saving the event. Please try again.`,
        timestamp: new Date(),
      }];
    } finally {
      this.chatTyping = false;
      this.scrollChatToBottom();
    }
  }
  async createAiReminder(title: string, body: string) {
    try {
      await this.notificationsService.create({
        recipientEmail: this.userEmail,
        type: 'reminder',
        title,
        body,
        eventId: '',
        eventDate: new Date().toISOString().split('T')[0],
        senderEmail: 'ai-assistant',
        read: false,
      });
      await this.loadNotifications(this.userEmail);
      this.chatMessages = [...this.chatMessages, {
        id: `msg_${Date.now()}_r`,
        role: 'assistant',
        text: `✅ Reminder saved! You can find it in your **Notifications** tab.`,
        timestamp: new Date(),
        actions: [{ label: 'View Notifications', type: 'navigate', tab: 'notifications' }],
      }];
      this.scrollChatToBottom();
    } catch {
      this.chatMessages = [...this.chatMessages, {
        id: `msg_${Date.now()}_r`,
        role: 'assistant',
        text: `⚠️ Couldn't save the reminder right now. Try again in a moment.`,
        timestamp: new Date(),
      }];
    }
  }

  renderChatMarkdown(text: string): string {
    return this.aiChatService.renderMarkdown(text);
  }

  /**
   * Scans upcoming events and silently creates prep reminders in Notifications
   * for anything important (tests, meetings, travel, etc.) that is 1, 3, or 5
   * days away. Runs once after events load and is idempotent within a session.
   * Returns the list of reminders that were newly created so the UI can show a banner.
   */
  async runProactiveReminders(): Promise<{ title: string; body: string }[]> {
    const todayStr = new Date().toISOString().split('T')[0];
    const reminders = getProactiveReminders(this.events, todayStr, this.seenProactiveKeys);
    for (const r of reminders) {
      try {
        await this.notificationsService.create({
          recipientEmail: this.userEmail,
          type: 'reminder',
          title: r.title,
          body: r.body,
          eventId: r.eventId,
          eventDate: r.eventDate,
          senderEmail: 'ai-assistant',
          read: false,
        });
      } catch {
        // Non-fatal — best effort
      }
    }
    if (reminders.length > 0) {
      await this.loadNotifications(this.userEmail);
    }
    return reminders;
  }

  private scrollChatToBottom() {
    setTimeout(() => {
      const el = document.querySelector('.float-chat-messages');
      if (el) el.scrollTop = el.scrollHeight;
    }, 50);
  }

  onChatKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendChatMessage();
    }
  }

  cancelEventCreation() {
    this.chatEventDraft = null;
    this.chatMessages = [...this.chatMessages, {
      id: `msg_${Date.now()}_cancel`,
      role: 'assistant' as const,
      text: 'Event creation cancelled. Let me know if you need anything else!',
      timestamp: new Date(),
    }];
    this.scrollChatToBottom();
  }

  private startEventWizard(text: string) {
    // Try to extract a title from the message
    const stripped = text
      .replace(/^(can you|please|could you|i want to|i need to|i'd like to)\s+/i, '')
      .replace(/^(add|create|schedule|put|book|set up|arrange|new|i have)\s+(an?\s+|a new\s+)?/i, '')
      .replace(/\s+(to|on|in|for)\s+(my\s+)?(calendar|agenda|schedule).*$/i, '')
      .replace(/\s+(event|called|named)$/i, '')
      .trim();

    if (stripped.length > 1) {
      this.chatEventDraft = { step: 'date', title: stripped };
      this.addAssistantMsg(`Got it — **"${stripped}"**. What date? (e.g. "tomorrow", "next Monday", "June 20")`);
    } else {
      this.chatEventDraft = { step: 'title' };
      this.addAssistantMsg(`Sure! Let's add a new event. What's the title?`);
    }
  }

  private handleEventWizardStep(text: string) {
    const lower = text.toLowerCase().trim();
    const draft = this.chatEventDraft!;

    // Allow cancel at any step
    if (/\b(cancel|stop|never mind|forget it)\b/i.test(lower)) {
      this.cancelEventCreation();
      return;
    }

    switch (draft.step) {
      case 'title':
        if (text.trim().length < 2) {
          this.addAssistantMsg('Please give the event a name (at least 2 characters).');
          return;
        }
        this.chatEventDraft = { ...draft, step: 'date', title: text.trim() };
        this.addAssistantMsg(`**"${text.trim()}"** — got it. What date? (e.g. "tomorrow", "next Monday", "June 20")`);
        break;

      case 'date':
        // Parse the date
        const todayStr = new Date().toISOString().split('T')[0];
        const parsed = this.parseDateFromText(lower, todayStr);
        if (!parsed) {
          this.addAssistantMsg(`I couldn't understand that date. Try "tomorrow", "next Monday", "June 20", or "2026-06-15".`);
          return;
        }
        this.chatEventDraft = { ...draft, step: 'time', date: parsed };
        this.addAssistantMsg(`📅 ${this.formatDate(parsed)}. What time? (e.g. "2pm to 4pm", "10:00-11:30", "at 3pm for 1 hour")`);
        break;

      case 'time':
        const times = this.parseTimesFromText(lower);
        if (!times) {
          this.addAssistantMsg(`I couldn't parse that time. Try "2pm to 4pm", "10:00-11:30", or "at 3pm for 1 hour".`);
          return;
        }
        this.chatEventDraft = { ...draft, step: 'category', startTime: times.start, endTime: times.end };
        this.addAssistantMsg(`🕐 ${this.formatTime(times.start)} – ${this.formatTime(times.end)}.\n\nNow a few optional questions to make this event perfect. You can **skip** any of them.\n\n🏷️ What category? (Work, Personal, Fitness, School, Social, Health) or **skip**`);
        break;

      case 'category':
        let category = text.trim();
        if (/skip|auto|none|no/i.test(lower)) {
          // Auto-detect from title
          const cats: Record<string, RegExp> = {
            'Work': /meeting|work|call|sync|interview|presentation/i,
            'School': /exam|test|class|study|homework|lecture/i,
            'Fitness': /gym|workout|run|yoga|swim|sport|practice|game|basketball|soccer|tennis|track/i,
            'Health': /doctor|dentist|therapy|appointment|checkup/i,
            'Social': /lunch|dinner|party|drinks|hangout|date/i,
          };
          category = 'Personal';
          for (const [cat, regex] of Object.entries(cats)) {
            if (regex.test(draft.title || '')) { category = cat; break; }
          }
        }
        this.chatEventDraft = { ...draft, step: 'location', category };
        this.addAssistantMsg(`🏷️ ${category}.\n\n📍 Where is it? (e.g. "Room 204", "Zoom", "Central Park") or **skip**`);
        break;

      case 'location':
        const location = /skip|no|none|nope/i.test(lower) ? '' : text.trim();
        this.chatEventDraft = { ...draft, step: 'description', location };
        this.addAssistantMsg(`${location ? '📍 ' + location + '.' : '📍 No location.'}\n\n📝 Any notes or description? or **skip**`);
        break;

      case 'description':
        const description = /skip|no|none|nope/i.test(lower) ? '' : text.trim();
        this.chatEventDraft = { ...draft, step: 'reminder', description };
        this.addAssistantMsg(`${description ? '📝 Noted.' : '📝 No description.'}\n\n🔔 Want a reminder? (e.g. "15 min before", "1 hour before", "day before") or **skip**`);
        break;

      case 'reminder':
        const reminderText = /skip|no|none|nope/i.test(lower) ? '' : text.trim();
        this.chatEventDraft = { ...draft, step: 'invite', reminderText };
        this.addAssistantMsg(`${reminderText ? '🔔 Reminder: ' + reminderText + '.' : '🔔 No reminder.'}\n\n👥 Invite anyone? (type emails separated by commas) or **skip**`);
        break;

      case 'invite':
        const inviteText = /skip|no|none|nope/i.test(lower) ? '' : text.trim();
        const sharedWith = inviteText
          ? inviteText.split(',').map((e: string) => e.trim()).filter((e: string) => e.includes('@'))
          : [];
        // Show final summary and create
        this.chatEventDraft = null;
        const loc = draft.location || '';
        const desc = draft.description || '';
        const reminder = draft.reminderText || '';
        const summaryLines = [
          `📌 **${draft.title}**`,
          `📅 ${this.formatDate(draft.date!)}`,
          `🕐 ${this.formatTime(draft.startTime!)} – ${this.formatTime(draft.endTime!)}`,
          `🏷️ ${draft.category || 'Personal'}`,
        ];
        if (loc) summaryLines.push(`📍 ${loc}`);
        if (desc) summaryLines.push(`📝 ${desc}`);
        if (reminder) summaryLines.push(`🔔 ${reminder}`);
        if (sharedWith.length) summaryLines.push(`👥 ${sharedWith.join(', ')}`);

        this.addAssistantMsg(`Here's your event:\n\n${summaryLines.join('\n')}\n\nAdding it now…`);

        this.createEventFromChat({
          title: draft.title,
          date: draft.date,
          startTime: draft.startTime,
          endTime: draft.endTime,
          category: draft.category || 'Personal',
          color: '#6c63ff',
          description: [desc, loc ? `Location: ${loc}` : ''].filter(Boolean).join('\n'),
          sharedWith,
        });

        // Create a reminder notification if requested
        if (reminder) {
          this.createAiReminder(
            `Reminder: ${draft.title}`,
            `${reminder} — ${this.formatDate(draft.date!)} at ${this.formatTime(draft.startTime!)}`
          );
        }
        break;
    }
  }

  private addAssistantMsg(text: string) {
    this.chatMessages = [...this.chatMessages, {
      id: `msg_${Date.now()}_a`,
      role: 'assistant' as const,
      text,
      timestamp: new Date(),
    }];
    this.scrollChatToBottom();
    this.syncConversationMessages();
  }

  private parseDateFromText(text: string, todayStr: string): string | null {
    if (/\btoday\b/.test(text)) return todayStr;
    if (/\btomorrow\b/.test(text)) {
      const d = new Date(todayStr + 'T00:00:00');
      d.setDate(d.getDate() + 1);
      return d.toISOString().split('T')[0];
    }
    const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const nextDay = text.match(/(?:next\s+|this\s+)?(\w+day)/i);
    if (nextDay) {
      const idx = dayNames.indexOf(nextDay[1].toLowerCase());
      if (idx !== -1) {
        const d = new Date(todayStr + 'T00:00:00');
        const cur = d.getDay();
        let diff = idx - cur;
        if (diff <= 0) diff += 7;
        d.setDate(d.getDate() + diff);
        return d.toISOString().split('T')[0];
      }
    }
    const inDays = text.match(/in\s+(\d+)\s+days?/i);
    if (inDays) {
      const d = new Date(todayStr + 'T00:00:00');
      d.setDate(d.getDate() + parseInt(inDays[1]));
      return d.toISOString().split('T')[0];
    }
    const months: Record<string, string> = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
    const monthDay = text.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{1,2})/i);
    if (monthDay) {
      const m = months[monthDay[1].toLowerCase().slice(0, 3)];
      const day = monthDay[2].padStart(2, '0');
      const y = todayStr.slice(0, 4);
      return `${y}-${m}-${day}`;
    }
    const iso = text.match(/(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    return null;
  }

  private parseTimesFromText(text: string): { start: string; end: string } | null {
    // "2pm to 4pm", "2:00-4:00", "at 3pm for 1 hour"
    const parseTime = (s: string): string | null => {
      const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
      if (!m) return null;
      let h = parseInt(m[1]);
      const min = m[2] ? parseInt(m[2]) : 0;
      const ap = m[3]?.toLowerCase();
      if (ap === 'pm' && h !== 12) h += 12;
      if (ap === 'am' && h === 12) h = 0;
      if (!ap && h >= 1 && h <= 6) h += 12; // assume PM for small numbers
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    };

    // "from X to Y" or "X to Y" or "X-Y"
    const range = text.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:to|-|until)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
    if (range) {
      const start = parseTime(range[1]);
      const end = parseTime(range[2]);
      if (start && end) return { start, end };
    }

    // "at Xpm for Y hours"
    const atFor = text.match(/(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+for\s+(\d+(?:\.\d+)?)\s*(hour|hr|h|min)/i);
    if (atFor) {
      const start = parseTime(atFor[1]);
      if (start) {
        const dur = atFor[3].startsWith('h') ? parseFloat(atFor[2]) * 60 : parseFloat(atFor[2]);
        const [sh, sm] = start.split(':').map(Number);
        const total = sh * 60 + sm + dur;
        const end = `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(Math.round(total % 60)).padStart(2, '0')}`;
        return { start, end };
      }
    }

    // Just "at Xpm" — default 1 hour
    const atOnly = text.match(/(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
    if (atOnly) {
      const start = parseTime(atOnly[1]);
      if (start) {
        const [sh, sm] = start.split(':').map(Number);
        const end = `${String((sh + 1) % 24).padStart(2, '0')}:${String(sm).padStart(2, '0')}`;
        return { start, end };
      }
    }

    return null;
  }

  toggleFloatingChat() {
    this.showFloatingChat = !this.showFloatingChat;
    if (this.showFloatingChat && this.chatMessages.length === 0) {
      // Welcome message on first open
      const hour = new Date().getHours();
      const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
      const todayCount = this.events.filter(e => e.date === new Date().toISOString().split('T')[0]).length;
      this.chatMessages = [{
        id: 'welcome',
        role: 'assistant',
        text: `${greeting}! 👋 I'm your Agenda AI assistant. You have **${todayCount}** event${todayCount !== 1 ? 's' : ''} today.\n\nI can **add events for you**, set reminders, check if you're overdue for an appointment, or draft an absence email. Type **help** to see everything I can do.`,
        timestamp: new Date(),
      }];
    }
    if (this.showFloatingChat) {
      this.scrollChatToBottom();
    }
  }

  // ── Notifications ──
  notifications: AppNotification[] = [];
  notifFilter: 'all' | 'share' | 'reminder' | 'event_invite' = 'all';
  notifSearch = '';

  // ── Notifications sub-tab ──
  notifSubTab: 'notifications' | 'friends' | 'share' = 'notifications';

  // ── Add Friend ──
  friendSearch = '';
  friendNickname = '';
  friendSearchResults: { email: string; displayName: string; nickname: string }[] = [];
  friends: Friend[] = [];
  friendRequestsSent: Set<string> = new Set();
  friendSearchLoading = false;
  friendSearchError = '';

  async loadFriends() {
    try {
      this.friends = await this.friendsService.listFriends(this.userEmail);
    } catch (err) {
      console.warn('[Dashboard] Could not load friends:', err);
      this.friends = [];
    }
  }

  /** Adding a friend only works by exact email — there's no user directory to browse. */
  searchFriends() {
    const q = this.friendSearch.trim().toLowerCase();
    this.friendSearchError = '';
    if (!q) { this.friendSearchResults = []; return; }

    this.friendSearchLoading = true;
    setTimeout(() => {
      const friendEmails = new Set(this.friends.map(f => f.email));
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      this.friendSearchResults =
        emailRegex.test(q) && q !== this.userEmail.toLowerCase() && !friendEmails.has(q)
          ? [{ email: q, displayName: q.split('@')[0], nickname: '' }]
          : [];
      this.friendSearchLoading = false;
    }, 300);
  }

  /** Sends a real friend-request notification to `email` and records it as pending locally. */
  private async createFriendRequest(email: string, nickname: string): Promise<boolean> {
    const pending: { email: string; displayName: string; nickname: string; notificationId?: string } =
      { email, displayName: email.split('@')[0], nickname };
    this.pendingFriendRequests.push(pending);
    try {
      const n = await this.notificationsService.create({
        recipientEmail: email,
        type: 'friend_request',
        title: `${this.userEmail} wants to be your friend`,
        body: `From: ${this.userEmail}`,
        eventId: this.userEmail, // requester's email, so the recipient knows who to friend back
        eventDate: '',
        senderEmail: this.userEmail,
        read: false,
        status: 'pending',
      });
      pending.notificationId = n.id;
      // If the recipient is the current user (demo/testing), show it immediately
      if (email === this.userEmail) {
        this.notifications = [n, ...this.notifications];
      }
      return true;
    } catch (err) {
      console.warn('[Dashboard] Could not send friend request:', err);
      this.pendingFriendRequests = this.pendingFriendRequests.filter(p => p.email !== email);
      return false;
    }
  }

  async sendFriendRequest(email: string) {
    const nickname = this.friendNickname.trim();
    if (!nickname) {
      this.friendSearchError = 'Please enter a nickname for this friend.';
      return;
    }
    this.friendSearchError = '';
    this.friendRequestsSent.add(email);
    this.friendSearchResults = this.friendSearchResults.filter(u => u.email !== email);
    this.friendNickname = '';

    const ok = await this.createFriendRequest(email, nickname);
    if (!ok) {
      this.friendSearchError = 'Could not send the friend request. Please try again.';
      this.friendRequestsSent.delete(email);
    }
  }

  // Pending outgoing friend requests (waiting for the other person to accept)
  pendingFriendRequests: { email: string; displayName: string; nickname: string; notificationId?: string }[] = [];

  /** Cancel/delete an outgoing friend request that hasn't been accepted yet. */
  async cancelFriendRequest(email: string) {
    const pending = this.pendingFriendRequests.find(p => p.email === email);
    this.pendingFriendRequests = this.pendingFriendRequests.filter(p => p.email !== email);
    this.friendRequestsSent.delete(email);
    if (pending?.notificationId) {
      try {
        await this.notificationsService.delete(pending.notificationId);
      } catch (err) {
        console.warn('[Dashboard] Could not delete friend request notification:', err);
      }
    }
  }

  async removeFriend(email: string) {
    const friend = this.friends.find(f => f.email === email);
    if (!friend) return;
    this.friends = this.friends.filter(f => f.email !== email);
    try {
      await this.friendsService.removeFriend(friend.id);
    } catch (err) {
      console.error('[Dashboard] Failed to remove friend:', err);
    }
  }

  /** Update a friend's nickname. */
  async updateFriendNickname(email: string, newNickname: string) {
    const friend = this.friends.find(f => f.email === email);
    if (!friend || !newNickname.trim()) return;
    friend.nickname = newNickname.trim();
    try {
      await this.friendsService.updateNickname(friend.id, friend.nickname);
    } catch (err) {
      console.error('[Dashboard] Failed to update friend nickname:', err);
    }
  }

  /** Get friend display (nickname or email) for sharing UI. */
  getFriendLabel(email: string): string {
    const friend = this.friends.find(f => f.email === email);
    return friend ? `${friend.nickname} (${friend.email})` : email;
  }

  /** Accept an incoming friend-request notification. */
  async acceptFriendNotif(n: AppNotification) {
    n.status = 'accepted';
    n.read = true;
    const requesterEmail = n.eventId; // stored in eventId
    this.notificationsService.updateStatus(n.id, 'accepted').catch(() => {});

    if (requesterEmail && !this.friends.some(f => f.email === requesterEmail)) {
      try {
        const friend = await this.friendsService.addFriend(
          this.userEmail, requesterEmail, requesterEmail.split('@')[0]
        );
        this.friends = [...this.friends, friend];
      } catch (err) {
        console.error('[Dashboard] Failed to save accepted friend:', err);
      }
    }
    this.pendingFriendRequests = this.pendingFriendRequests.filter(p => p.email !== requesterEmail);

    // Let the requester know so they can add us back on their side
    try {
      const responseNotif = await this.notificationsService.create({
        recipientEmail: requesterEmail,
        type: 'friend_response',
        title: `${this.userEmail} accepted your friend request`,
        body: `You can now message each other from the Friends tab.`,
        eventId: this.userEmail,
        eventDate: '',
        senderEmail: this.userEmail,
        read: false,
        status: 'accepted',
      });
      if (requesterEmail === this.userEmail) {
        this.notifications = [responseNotif, ...this.notifications];
      }
    } catch (err) {
      console.warn('[Dashboard] Could not notify requester of acceptance:', err);
    }
  }

  /** Reject an incoming friend-request notification. */
  rejectFriendNotif(n: AppNotification) {
    n.status = 'rejected';
    n.read = true;
    this.notificationsService.updateStatus(n.id, 'rejected').catch(() => {});
  }

  // ── Friends messaging (Friends tab) ──
  selectedFriendEmail: string | null = null;
  friendMessageDraft = '';
  allFriendMessages: FriendMessage[] = [];
  friendMessagesUnread: { [friendEmail: string]: number } = {};
  private messagePollHandle: ReturnType<typeof setInterval> | null = null;

  @ViewChild('friendMessagesScroll') private friendMessagesScrollRef?: ElementRef<HTMLDivElement>;

  get selectedFriend(): Friend | null {
    return this.friends.find(f => f.email === this.selectedFriendEmail) ?? null;
  }

  get selectedFriendMessages(): FriendMessage[] {
    if (!this.selectedFriendEmail) return [];
    return this.allFriendMessages.filter(
      m => m.fromEmail === this.selectedFriendEmail || m.toEmail === this.selectedFriendEmail
    );
  }

  /** Preview text shown in the friend list row. */
  getLastMessagePreview(friendEmail: string): string {
    const msgs = this.allFriendMessages.filter(m => m.fromEmail === friendEmail || m.toEmail === friendEmail);
    if (!msgs.length) return 'No messages yet — say hi!';
    const last = msgs[msgs.length - 1];
    return (last.fromEmail === this.userEmail ? 'You: ' : '') + last.text;
  }

  getUnreadMessageCount(friendEmail: string): number {
    return this.friendMessagesUnread[friendEmail] ?? 0;
  }

  openFriendChat(friendEmail: string) {
    this.selectedFriendEmail = friendEmail;
    this.friendMessagesUnread[friendEmail] = 0;
    setTimeout(() => this.scrollFriendMessagesToBottom(), 0);
  }

  async sendFriendMessage() {
    const text = this.friendMessageDraft.trim();
    const friendEmail = this.selectedFriendEmail;
    if (!text || !friendEmail) return;
    this.friendMessageDraft = '';

    try {
      const msg = await this.friendsService.sendMessage(this.userEmail, friendEmail, text);
      this.allFriendMessages = [...this.allFriendMessages, msg];
      setTimeout(() => this.scrollFriendMessagesToBottom(), 0);
    } catch (err) {
      console.error('[Dashboard] Failed to send message:', err);
      this.friendMessageDraft = text;
    }
  }

  // ── Send an event via message ──
  showSendEventModal = false;
  sendEventSearch = '';
  /** Message ids whose shared event has already been added to the calendar this session. */
  addedSharedEventIds = new Set<string>();

  get sendEventCandidates(): CalendarEvent[] {
    const q = this.sendEventSearch.trim().toLowerCase();
    const todayStr = new Date().toISOString().split('T')[0];
    const list = q
      ? this.events.filter(e => e.title.toLowerCase().includes(q) || e.category.toLowerCase().includes(q))
      : this.events;
    // Upcoming events first (soonest first), then past events (most recent first)
    return [...list].sort((a, b) => {
      const aFuture = a.date >= todayStr, bFuture = b.date >= todayStr;
      if (aFuture !== bFuture) return aFuture ? -1 : 1;
      return aFuture ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date);
    });
  }

  openSendEventModal() {
    if (!this.selectedFriendEmail) return;
    this.sendEventSearch = '';
    this.showSendEventModal = true;
  }

  closeSendEventModal() {
    this.showSendEventModal = false;
  }

  async sendEventToFriend(event: CalendarEvent) {
    const friendEmail = this.selectedFriendEmail;
    if (!friendEmail) return;
    this.showSendEventModal = false;

    try {
      const msg = await this.friendsService.sendEventMessage(this.userEmail, friendEmail, {
        title: event.title,
        date: event.date,
        startTime: event.startTime,
        endTime: event.endTime,
        description: event.description,
        color: event.color,
        category: event.category,
      });
      this.allFriendMessages = [...this.allFriendMessages, msg];
      setTimeout(() => this.scrollFriendMessagesToBottom(), 0);
    } catch (err) {
      console.error('[Dashboard] Failed to share event via message:', err);
    }
  }

  /** Recipient adds a shared-event message to their own calendar, then gets the same AI category prompt as an accepted invite. */
  async addSharedEventToCalendar(msg: FriendMessage) {
    if (!msg.sharedEvent || this.addedSharedEventIds.has(msg.id)) return;
    const ev = msg.sharedEvent;
    this.addedSharedEventIds.add(msg.id);

    const newEvent: Omit<CalendarEvent, 'id'> = {
      title: ev.title,
      date: ev.date,
      startTime: ev.startTime,
      endTime: ev.endTime,
      description: ev.description || `Shared by ${msg.fromEmail}`,
      color: ev.color || '#6c63ff',
      category: '', // set via the AI category suggestion modal below
      sharedWith: [],
    };

    try {
      const created = await this.eventsService.createEvent(newEvent, this.userEmail);
      this.events = [...this.events, created];
      this.openInviteCategoryModal(created);
    } catch (err) {
      console.error('[Dashboard] Failed to add shared event:', err);
      this.addedSharedEventIds.delete(msg.id);
    }
  }

  /** Refreshes the full message history and bumps unread badges for new incoming messages. */
  private async refreshAllFriendMessages() {
    try {
      const previousIds = new Set(this.allFriendMessages.map(m => m.id));
      const all = await this.friendsService.listAllMessages(this.userEmail);
      const newIncoming = all.filter(m => !previousIds.has(m.id) && m.fromEmail !== this.userEmail);
      this.allFriendMessages = all;
      for (const m of newIncoming) {
        if (m.fromEmail !== this.selectedFriendEmail) {
          this.friendMessagesUnread[m.fromEmail] = (this.friendMessagesUnread[m.fromEmail] ?? 0) + 1;
        }
      }
      if (this.selectedFriendEmail && newIncoming.some(m => m.fromEmail === this.selectedFriendEmail)) {
        setTimeout(() => this.scrollFriendMessagesToBottom(), 0);
      }
    } catch (err) {
      console.warn('[Dashboard] Could not refresh messages:', err);
    }
  }

  /** Polls for new messages while the Friends tab is open (the app has no live subscriptions). */
  private startMessagePolling() {
    if (this.messagePollHandle) return;
    this.messagePollHandle = setInterval(() => {
      if (this.activeTab === 'friends') this.refreshAllFriendMessages();
    }, 4000);
  }

  private stopMessagePolling() {
    if (this.messagePollHandle) {
      clearInterval(this.messagePollHandle);
      this.messagePollHandle = null;
    }
  }

  private scrollFriendMessagesToBottom() {
    const el = this.friendMessagesScrollRef?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }

  // ── Event attachments (upload beside Share) ──
  eventAttachments: { [eventId: string]: EventAttachment[] } = {};
  attachmentUploadTargetEvent: CalendarEvent | null = null;

  @ViewChild('attachmentFileInput') private attachmentFileInputRef?: ElementRef<HTMLInputElement>;

  private readonly ATTACHMENTS_KEY = () => `agenda_attachments_${this.userEmail}`;

  loadEventAttachments() {
    try {
      const raw = localStorage.getItem(this.ATTACHMENTS_KEY());
      this.eventAttachments = raw ? JSON.parse(raw) : {};
    } catch { this.eventAttachments = {}; }
  }

  private persistEventAttachments() {
    localStorage.setItem(this.ATTACHMENTS_KEY(), JSON.stringify(this.eventAttachments));
  }

  getEventAttachments(eventId: string): EventAttachment[] {
    return this.eventAttachments[eventId] ?? [];
  }

  /** Opens the file picker for the given event; on selection the file is attached and the
   *  Share modal opens automatically so sending it to a friend is a single extra click. */
  triggerAttachmentUpload(event: CalendarEvent) {
    this.attachmentUploadTargetEvent = event;
    this.attachmentFileInputRef?.nativeElement.click();
  }

  onAttachmentFileChange(evt: Event) {
    const input = evt.target as HTMLInputElement;
    const file = input.files?.[0];
    const targetEvent = this.attachmentUploadTargetEvent;
    input.value = '';
    if (!file || !targetEvent) return;
    if (file.size > 5 * 1024 * 1024) {
      console.warn('[Dashboard] Attachment too large (max 5MB):', file.name);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const list = [...this.getEventAttachments(targetEvent.id), { name: file.name, dataUrl, type: file.type, size: file.size }];
      this.eventAttachments = { ...this.eventAttachments, [targetEvent.id]: list };
      this.persistEventAttachments();
      this.attachmentUploadTargetEvent = null;
      // Jump straight into sharing now that there's something to send (unless the
      // Share modal for this event is already open — don't reset the in-progress form).
      if (!(this.showShareModal && this.shareTargetEvent?.id === targetEvent.id)) {
        this.openShareModal(targetEvent);
      }
    };
    reader.readAsDataURL(file);
  }

  removeEventAttachment(eventId: string, index: number) {
    const list = this.getEventAttachments(eventId).filter((_, i) => i !== index);
    this.eventAttachments = { ...this.eventAttachments, [eventId]: list };
    this.persistEventAttachments();
  }

  // ── Share sub-tab ──
  shareSubTabEmail = '';
  shareType: 'event' | 'calendar' | 'category' | 'subcategory' | 'friend' | '' = '';
  shareSubTabError = '';
  shareSubTabSuccess = '';
  sentShareRequests: { username: string; type: string; label?: string }[] = [];

  /** Selected category/subcategory path for share sub-tab */
  shareSelectedCategory = '';

  /** Top-level categories (no " > " in path) */
  get shareTopLevelCategories(): string[] {
    return this.allCategories.filter(c => !c.includes(CATEGORY_SEP));
  }

  /** Subcategories under the selected top-level category */
  get shareSubcategories(): string[] {
    if (!this.shareSelectedCategory) return [];
    return this.allCategories.filter(
      c => c.startsWith(this.shareSelectedCategory + CATEGORY_SEP)
    );
  }

  onShareTypeChange() {
    // Reset category selection when switching types
    this.shareSelectedCategory = '';
  }

  submitShareSubTab() {
    this.shareSubTabError = '';
    this.shareSubTabSuccess = '';

    const email = this.shareSubTabEmail.trim().toLowerCase();
    if (!email) {
      this.shareSubTabError = 'Please enter an email address.';
      return;
    }
    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      this.shareSubTabError = 'Please enter a valid email address.';
      return;
    }
    if (email === this.userEmail) {
      this.shareSubTabError = 'You cannot share with yourself.';
      return;
    }
    if (!this.shareType) {
      this.shareSubTabError = 'Please select a share type.';
      return;
    }
    if ((this.shareType === 'category' || this.shareType === 'subcategory') && !this.shareSelectedCategory) {
      this.shareSubTabError = `Please select a ${this.shareType} to share.`;
      return;
    }

    const recipientEmail = email;
    let label = '';

    if (this.shareType === 'calendar') {
      label = 'Entire Calendar';
      // Share all events with the recipient
      const eventsToShare = this.events;
      this.shareEventsWithUser(eventsToShare, recipientEmail);
      this.createCalendarShareNotification(recipientEmail, eventsToShare.length);

    } else if (this.shareType === 'category') {
      label = this.shareSelectedCategory;
      const eventsToShare = this.events.filter(e =>
        this.categoryTreeService.isUnderPath(e.category, this.shareSelectedCategory)
      );
      this.shareEventsWithUser(eventsToShare, recipientEmail);
      this.createCategoryShareNotification(recipientEmail, this.shareSelectedCategory, eventsToShare.length, false);

    } else if (this.shareType === 'subcategory') {
      label = this.shareSelectedCategory;
      const eventsToShare = this.events.filter(e =>
        this.categoryTreeService.isUnderPath(e.category, this.shareSelectedCategory)
      );
      this.shareEventsWithUser(eventsToShare, recipientEmail);
      this.createCategoryShareNotification(recipientEmail, this.shareSelectedCategory, eventsToShare.length, true);

    } else if (this.shareType === 'friend') {
      label = 'Friend Request';
      this.createFriendRequest(email, email.split('@')[0]);
    }

    // Check if already sent
    const alreadySent = this.sentShareRequests.some(
      r => r.username === email && r.type === this.shareType &&
           (this.shareType !== 'category' && this.shareType !== 'subcategory' || r.label === label)
    );
    if (alreadySent) {
      this.shareSubTabError = `You already sent this share request to ${email}.`;
      return;
    }

    this.sentShareRequests = [{ username: email, type: this.shareType, label }, ...this.sentShareRequests];

    const typeLabel =
      this.shareType === 'friend'      ? 'Friend request' :
      this.shareType === 'calendar'    ? 'Calendar share' :
      this.shareType === 'category'    ? `Category "${label}" share` :
      this.shareType === 'subcategory' ? `Subcategory "${label}" share` :
                                         'Event share';
    this.shareSubTabSuccess = `${typeLabel} sent to ${email}.`;
    this.shareSubTabEmail = '';
    this.shareType = '';
    this.shareSelectedCategory = '';

    setTimeout(() => { this.shareSubTabSuccess = ''; }, 3000);
  }

  /** Add recipientEmail to sharedWith for a list of events and persist. */
  private shareEventsWithUser(eventsToShare: CalendarEvent[], recipientEmail: string) {
    this.events = this.events.map(e => {
      if (eventsToShare.find(t => t.id === e.id)) {
        return e.sharedWith.includes(recipientEmail)
          ? e
          : { ...e, sharedWith: [...e.sharedWith, recipientEmail] };
      }
      return e;
    });
    const updated = this.events.filter(e => eventsToShare.find(t => t.id === e.id));
    for (const ev of updated) {
      this.eventsService.updateEvent(ev).catch(err =>
        console.error('[Dashboard] Failed to persist share:', err)
      );
    }
  }

  /** Create a notification for a full-calendar share. */
  private async createCalendarShareNotification(recipientEmail: string, eventCount: number) {
    try {
      const n = await this.notificationsService.create({
        recipientEmail,
        type: 'share',
        title: `${this.userEmail} shared their entire calendar with you`,
        body: `You now have access to all ${eventCount} event${eventCount !== 1 ? 's' : ''} in their calendar.`,
        eventId: '',
        eventDate: '',
        senderEmail: this.userEmail,
        read: false,
      });
      if (recipientEmail === this.userEmail) {
        this.notifications = [n, ...this.notifications];
      }
    } catch (err) {
      console.warn('[Dashboard] Could not create calendar share notification:', err);
    }
  }

  /** Create a notification for a category or subcategory share. */
  private async createCategoryShareNotification(
    recipientEmail: string,
    categoryPath: string,
    eventCount: number,
    isSubcategory: boolean
  ) {
    const kind = isSubcategory ? 'subcategory' : 'category';
    try {
      const n = await this.notificationsService.create({
        recipientEmail,
        type: 'share',
        title: `${this.userEmail} shared the "${categoryPath}" ${kind} with you`,
        body: `You now have access to ${eventCount} event${eventCount !== 1 ? 's' : ''} in "${categoryPath}".`,
        eventId: '',
        eventDate: '',
        senderEmail: this.userEmail,
        read: false,
      });
      if (recipientEmail === this.userEmail) {
        this.notifications = [n, ...this.notifications];
      }
    } catch (err) {
      console.warn('[Dashboard] Could not create category share notification:', err);
    }
  }
  // Reminder set modal
  showReminderModal = false;
  reminderTargetEvent: CalendarEvent | null = null;
  reminderMinutes = 30;
  reminderSuccess = '';
  reminderOptions = [
    { label: '5 minutes before',  value: 5 },
    { label: '10 minutes before', value: 10 },
    { label: '15 minutes before', value: 15 },
    { label: '30 minutes before', value: 30 },
    { label: '1 hour before',     value: 60 },
    { label: '2 hours before',    value: 120 },
    { label: '1 day before',      value: 1440 },
  ];
  scheduleSuccess = false;
  scheduleError = '';

  // ── AI Scheduler state ────────────────────────────────────────────────────
  showAiPanel = false;
  aiLoading = false;
  aiError = '';
  aiSuggestions: AiSuggestion[] = [];
  aiDurationMin = 60;

  today = new Date().toISOString().split('T')[0];
  currentYear = new Date().getFullYear();
  currentMonthIndex = new Date().getMonth(); // 0-based

  /** Locale-aware month names — updates when language changes. */
  get monthNames(): string[] {
    return this.i18n.getMonthNames();
  }

  /** Locale-aware short day labels — updates when language changes. */
  get dayLabels(): string[] {
    return this.i18n.getDayLabels();
  }

  // ── Calendar view state ──
  calendarView: 'year' | 'month' | 'week' | 'day' = 'year';

  // Month view: user can type a month name or number
  viewMonthInput = '';
  get viewMonthIndex(): number {
    const trimmed = this.viewMonthInput.trim().toLowerCase();
    const byName = this.monthNames.findIndex(m => m.toLowerCase().startsWith(trimmed));
    if (byName !== -1) return byName;
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 1 && num <= 12) return num - 1;
    return new Date().getMonth();
  }

  // Week view: derived from a selected date
  viewWeekDateInput = this.today;
  get viewWeekStart(): Date {
    const d = new Date(this.viewWeekDateInput + 'T00:00:00');
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    return d;
  }
  get viewWeekDays(): { dateStr: string; label: string; isToday: boolean; events: CalendarEvent[] }[] {
    const days = [];
    const start = new Date(this.viewWeekStart);
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      days.push({
        dateStr,
        label: d.toLocaleDateString(this.i18n.getLocale(), { weekday: 'short', month: 'short', day: 'numeric' }),
        isToday: dateStr === this.today,
        events: this.eventsForDate(dateStr).map(e => ({
          ...e,
          color: this.getCategoryColor(e.category) || e.color,
        })),
      });
    }
    return days;
  }

  // Day view
  viewDayInput = this.today;
  get viewDayEvents(): CalendarEvent[] {
    return this.eventsForDate(this.viewDayInput).map(e => ({
      ...e,
      color: this.getCategoryColor(e.category) || e.color,
    }));
  }
  get viewDayLabel(): string {
    const d = new Date(this.viewDayInput + 'T00:00:00');
    return d.toLocaleDateString(this.i18n.getLocale(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  // ── Year view slideshow ──
  slideMonthIndex = new Date().getMonth();
  slideAnimating = false;
  slideDirection: 'left' | 'right' = 'left';

  goToSlideMonth(idx: number) {
    if (idx === this.slideMonthIndex || this.slideAnimating) return;
    this.slideDirection = idx > this.slideMonthIndex ? 'left' : 'right';
    this.slideAnimating = true;
    setTimeout(() => {
      this.slideMonthIndex = idx;
      this.slideAnimating = false;
    }, 320);
  }

  prevSlideMonth() {
    const next = (this.slideMonthIndex - 1 + 12) % 12;
    this.goToSlideMonth(next);
  }

  nextSlideMonth() {
    const next = (this.slideMonthIndex + 1) % 12;
    this.goToSlideMonth(next);
  }

  get slideMonthWeeks() {
    return this.buildWeeks(this.currentYear, this.slideMonthIndex);
  }

  // Single month grid (month view)
  get viewMonthWeeks() {
    return this.buildWeeks(this.currentYear, this.viewMonthIndex);
  }

  // All 12 months (used by jump dropdown)
  get calendarMonths() {
    const realYear = new Date().getFullYear();
    return this.monthNames.map((name, monthIdx) => ({
      name,
      monthIdx,
      isCurrent: this.currentYear === realYear && monthIdx === this.currentMonthIndex,
      weeks: this.buildWeeks(this.currentYear, monthIdx),
    }));
  }

  buildWeeks(year: number, month: number): ({ day: number; dateStr: string; isToday: boolean; isPast: boolean; events: CalendarEvent[] } | null)[][] {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: ({ day: number; dateStr: string; isToday: boolean; isPast: boolean; events: CalendarEvent[] } | null)[] = [];

    for (let i = 0; i < firstDay; i++) cells.push(null);

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayEvents = this.eventsForDate(dateStr).map(e => ({
        ...e,
        color: this.getCategoryColor(e.category) || e.color,
      }));
      cells.push({
        day: d,
        dateStr,
        isToday: dateStr === this.today,
        isPast: dateStr < this.today,
        events: dayEvents,
      });
    }

    const weeks: (typeof cells[0])[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      const week = cells.slice(i, i + 7);
      while (week.length < 7) week.push(null);
      weeks.push(week);
    }
    return weeks;
  }

  form: ScheduleForm = {
    title: '',
    date: this.today,
    endDate: '',
    startTime: '09:00',
    endTime: '10:00',
    description: '',
    category: '',
    location: '',
    sharedWith: [],
    repeatType: 'none',
    repeatDays: [false, false, false, false, false, false, false],
    repeatUntil: '',
    multiDates: [],
  };

  dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  get repeatHintVisible(): boolean {
    return this.form.repeatDays.some(d => d) && !!this.form.repeatUntil;
  }

  get repeatDaysSummary(): string {
    return this.form.repeatDays
      .map((d, i) => d ? this.dayNames[i] : '')
      .filter(d => d)
      .join(', ');
  }

  isMultiDay = false;

  // ── Multi-day date picker (click dates on a mini calendar) ──
  multiDayPickerYear = new Date().getFullYear();
  multiDayPickerMonth = new Date().getMonth();

  // buildWeeks() rebuilds every day cell (incl. per-day event lookups) from scratch,
  // so calling it from a plain getter meant *ngFor tore down and recreated every
  // calendar button on EVERY change-detection cycle (e.g. the friend-messages poll
  // ticking in the background) — not just when the visible month changed. That churn
  // could eat a click mid-DOM-swap. Cache it and only rebuild when year/month move.
  private _multiDayPickerWeeksCache: { year: number; month: number; weeks: ReturnType<DashboardComponent['buildWeeks']> } | null = null;

  get multiDayPickerWeeks() {
    const cache = this._multiDayPickerWeeksCache;
    if (cache && cache.year === this.multiDayPickerYear && cache.month === this.multiDayPickerMonth) {
      return cache.weeks;
    }
    const weeks = this.buildWeeks(this.multiDayPickerYear, this.multiDayPickerMonth);
    this._multiDayPickerWeeksCache = { year: this.multiDayPickerYear, month: this.multiDayPickerMonth, weeks };
    return weeks;
  }

  get multiDatesSorted(): string[] {
    return [...this.form.multiDates].sort();
  }

  isMultiDateSelected(dateStr: string): boolean {
    return this.form.multiDates.includes(dateStr);
  }

  toggleMultiDate(dateStr: string) {
    this.form.multiDates = this.isMultiDateSelected(dateStr)
      ? this.form.multiDates.filter(d => d !== dateStr)
      : [...this.form.multiDates, dateStr];
  }

  prevMultiDayPickerMonth() {
    const d = new Date(this.multiDayPickerYear, this.multiDayPickerMonth - 1, 1);
    this.multiDayPickerYear = d.getFullYear();
    this.multiDayPickerMonth = d.getMonth();
  }

  nextMultiDayPickerMonth() {
    const d = new Date(this.multiDayPickerYear, this.multiDayPickerMonth + 1, 1);
    this.multiDayPickerYear = d.getFullYear();
    this.multiDayPickerMonth = d.getMonth();
  }

  /** Switches the New Event form into multi-day mode and seeds the picker from the chosen start date. */
  selectMultiDayMode() {
    this.form.repeatType = 'multiday';
    if (this.form.multiDates.length === 0 && this.form.date) {
      this.form.multiDates = [this.form.date];
    }
    const base = new Date((this.form.date || this.today) + 'T00:00:00');
    this.multiDayPickerYear = base.getFullYear();
    this.multiDayPickerMonth = base.getMonth();
  }

  events: CalendarEvent[] = [];

  eventColors = [
    // Purples & Blues
    '#6c63ff', '#764ba2', '#3b82f6', '#0ea5e9', '#06b6d4',
    // Greens
    '#10b981', '#22c55e', '#84cc16', '#a3e635', '#65a30d',
    // Warm
    '#f59e0b', '#f97316', '#ef4444', '#e11d48', '#ec4899',
    // Neutrals & Misc
    '#8b5cf6', '#d946ef', '#14b8a6', '#64748b', '#1a1a2e',
  ];
  selectedColor = '#6c63ff';

  // ── Category color map: assigns a unique color to each category ──
  categoryColors: { [category: string]: string } = {
    'AP Calculus BC': '#6c63ff',
    'AP English Lit': '#ec4899',
    'AP US History': '#f59e0b',
    'AP Chemistry': '#3b82f6',
    'Spanish III': '#10b981',
    'PE / Health': '#22c55e',
    'Robotics Club': '#ef4444',
    'Debate Team': '#764ba2',
    'Orchestra': '#d946ef',
    'Soccer': '#14b8a6',
    'Track & Field': '#f97316',
    'NHS': '#0ea5e9',
    'School': '#64748b',
    'Clients': '#e11d48',
    'Gym': '#8b5cf6',
    'Nutrition': '#22c55e',
    'Admin': '#f59e0b',
    'Personal': '#06b6d4',
  };

  // Palette used to auto-assign colors to new/unknown categories
  private readonly categoryColorPalette = [
    '#6c63ff', '#ec4899', '#f59e0b', '#3b82f6', '#10b981',
    '#ef4444', '#764ba2', '#d946ef', '#14b8a6', '#f97316',
    '#0ea5e9', '#8b5cf6', '#22c55e', '#e11d48', '#06b6d4',
    '#84cc16', '#64748b', '#a3e635', '#65a30d', '#1a1a2e',
  ];

  /** Returns a consistent color for a given category. Auto-assigns one if not yet mapped. */
  getCategoryColor(category: string): string {
    if (!category) return '#64748b'; // default gray for uncategorized
    if (this.categoryColors[category]) return this.categoryColors[category];
    // Auto-assign based on hash of category name for consistency
    let hash = 0;
    for (let i = 0; i < category.length; i++) {
      hash = category.charCodeAt(i) + ((hash << 5) - hash);
    }
    const idx = Math.abs(hash) % this.categoryColorPalette.length;
    this.categoryColors[category] = this.categoryColorPalette[idx];
    return this.categoryColors[category];
  }

  /** Change a category's color and update all events using that category. */
  pickCategoryColor(color: string) {
    if (this.form.category) {
      // Update the category color map
      this.categoryColors[this.form.category] = color;
      // Update all existing events in this category to use the new color
      this.events = this.events.map(e =>
        e.category === this.form.category ? { ...e, color } : e
      );
      this.showCategoryColorPicker = false;
      // Persist color mapping
      this.saveCategoryColors();
    } else {
      // No category selected — just update the standalone color
      this.selectedColor = color;
    }
  }

  /** Save category colors to localStorage for persistence. */
  private saveCategoryColors() {
    try {
      localStorage.setItem('agenda_category_colors', JSON.stringify(this.categoryColors));
    } catch { /* ignore */ }
  }

  /** Load category colors from localStorage. */
  private loadCategoryColors() {
    try {
      const stored = localStorage.getItem('agenda_category_colors');
      if (stored) {
        const parsed = JSON.parse(stored);
        Object.assign(this.categoryColors, parsed);
      }
    } catch { /* ignore */ }
  }

  // ── Category & sharing state ──
  activeCategoryFilter = ''; // '' = show all
  showShareModal = false;
  shareTargetEvent: CalendarEvent | null = null;
  shareEmail = '';
  shareCategoryOnly = false; // true = share whole category, false = single event
  shareSuccess = '';
  shareError = '';
  shareFriendSuggestions: Friend[] = [];
  shareShowSuggestions = false;

  // DB sync state
  dbLoading = false;
  dbError = '';

  // ── Category tree picker state ──
  /** The tree built from all existing category paths. */
  get categoryTree(): CategoryNode[] {
    return this.categoryTreeService.buildTree(this.allCategories);
  }

  /** Segments the user has selected so far in the picker (breadcrumb). */
  categoryPickerPath: string[] = [];

  /** Search query inside the category picker dropdown. */
  categoryPickerSearch = '';

  /** The current level of the tree being browsed. */
  get categoryPickerLevel(): CategoryNode[] {
    let level = this.categoryTree;
    for (const seg of this.categoryPickerPath) {
      const node = level.find(n => n.name === seg);
      if (!node) return [];
      level = node.children;
    }
    return level;
  }

  /** categoryPickerLevel filtered by the search query. */
  get categoryPickerFiltered(): CategoryNode[] {
    const q = this.categoryPickerSearch.trim().toLowerCase();
    if (!q) return this.categoryPickerLevel;
    return this.categoryPickerLevel.filter(n => n.name.toLowerCase().includes(q));
  }

  /** The full path string assembled from the picker breadcrumb. */
  get categoryPickerFullPath(): string {
    return this.categoryTreeService.joinPath(this.categoryPickerPath);
  }

  /** Whether the user is typing a new sub-category name. */
  showNewCategoryInput = false;
  newCategoryName = '';

  /** Open the picker and pre-populate from the current form value. */
  openCategoryPicker() {
    const existing = this.form.category.trim();
    if (existing) {
      this.categoryPickerPath = this.categoryTreeService.splitPath(existing);
    } else {
      this.categoryPickerPath = [];
    }
    this.showCategoryPicker = true;
    this.showNewCategoryInput = false;
    this.newCategoryName = '';
    this.categoryPickerSearch = '';
  }

  showCategoryPicker = false;
  showCategoryColorPicker = false;

  closeCategoryPicker() {
    this.showCategoryPicker = false;
    this.showNewCategoryInput = false;
    this.newCategoryName = '';
    this.categoryPickerSearch = '';
  }

  /** Navigate into a child node. */
  categoryPickerDrillDown(node: CategoryNode) {
    this.categoryPickerPath = this.categoryTreeService.splitPath(node.fullPath);
    this.showNewCategoryInput = false;
    this.newCategoryName = '';
    this.categoryPickerSearch = '';
  }

  /** Go up one level in the picker. */
  categoryPickerGoUp() {
    this.categoryPickerPath = this.categoryPickerPath.slice(0, -1);
    this.showNewCategoryInput = false;
    this.newCategoryName = '';
    this.categoryPickerSearch = '';
  }

  /** Select the current path as the category. */
  categoryPickerSelect() {
    this.form.category = this.categoryPickerFullPath;
    this.closeCategoryPicker();
  }

  /** Select a specific node's path as the category. */
  categoryPickerSelectNode(node: CategoryNode) {
    this.form.category = node.fullPath;
    this.closeCategoryPicker();
  }

  /** Add a new sub-category at the current level. */
  categoryPickerAddNew() {
    const name = this.newCategoryName.trim();
    if (!name) return;
    const newPath = this.categoryPickerPath.length
      ? this.categoryTreeService.joinPath([...this.categoryPickerPath, name])
      : name;
    this.form.category = newPath;
    this.closeCategoryPicker();
  }

  /** Clear the category on the form. */
  clearCategory() {
    this.form.category = '';
  }

  /** Get the display label for a category path (last segment + breadcrumb). */
  getCategoryDisplayLabel(path: string): string {
    const segs = this.categoryTreeService.splitPath(path);
    return segs.join(' › ');
  }

  // ── Saved Categories (Categories tab) ──
  private get CATEGORIES_KEY() { return `agenda_saved_categories_${this.userEmail}`; }

  /** All user-defined category paths (persisted to localStorage). */
  savedCategories: string[] = [];

  /** Form state for the "Create Category" panel. */
  catForm = {
    parentPath: '',   // '' = top-level, otherwise the full path of the parent
    name: '',         // the new segment name
    color: '#6c63ff',
  };
  catFormError = '';
  catFormSuccess = '';

  /** Which node is expanded in the categories tree view. */
  expandedCatNodes = new Set<string>();

  loadSavedCategories() {
    try {
      const raw = localStorage.getItem(this.CATEGORIES_KEY);
      this.savedCategories = raw ? JSON.parse(raw) : [];
    } catch {
      this.savedCategories = [];
    }
  }

  private persistCategories() {
    localStorage.setItem(this.CATEGORIES_KEY, JSON.stringify(this.savedCategories));
  }

  /** All category paths: saved + those inferred from events. */
  get allCategoryPaths(): string[] {
    const fromEvents = this.events.map(e => e.category).filter(c => !!c);
    const merged = new Set([...this.savedCategories, ...fromEvents]);
    return Array.from(merged).sort();
  }

  get categoryTabTree(): CategoryNode[] {
    return this.categoryTreeService.buildTree(this.allCategoryPaths);
  }

  /** Events that have no category assigned. */
  get unassignedEvents(): CalendarEvent[] {
    return this.events.filter(e => !e.category);
  }

  toggleCatNode(path: string) {
    if (this.expandedCatNodes.has(path)) {
      this.expandedCatNodes.delete(path);
    } else {
      this.expandedCatNodes.add(path);
    }
  }

  isCatNodeExpanded(path: string): boolean {
    return this.expandedCatNodes.has(path);
  }

  // ── Category color picker (in categories tab) ──
  catColorPickerPath = '';

  toggleCatColorPicker(path: string) {
    this.catColorPickerPath = this.catColorPickerPath === path ? '' : path;
  }

  setCategoryColorFromTree(path: string, color: string) {
    this.categoryColors[path] = color;
    // Update all events in this category to use the new color
    this.events = this.events.map(e => {
      if (e.category === path) {
        const updated = { ...e, color };
        this.eventsService.updateEvent(updated).catch(err =>
          console.error('[Dashboard] Failed to update event color:', err)
        );
        return updated;
      }
      return e;
    });
    this.catColorPickerPath = '';
    this.saveCategoryColors();
  }

  /** Count events under a category path (including descendants). */
  countEventsUnder(path: string): number {
    return this.events.filter(e => this.categoryTreeService.isUnderPath(e.category, path)).length;
  }

  /** Start creating a subcategory under the given parent path. */
  startAddSubcategory(parentPath: string) {
    this.catForm.parentPath = parentPath;
    this.catForm.name = '';
    this.catFormError = '';
    this.catFormSuccess = '';
  }

  /** Start creating a top-level category. */
  startAddTopLevel() {
    this.catForm.parentPath = '';
    this.catForm.name = '';
    this.catFormError = '';
    this.catFormSuccess = '';
  }

  submitCatForm() {
    const name = this.catForm.name.trim();
    if (!name) {
      this.catFormError = 'Category name is required.';
      return;
    }
    if (name.includes(' > ')) {
      this.catFormError = 'Category name cannot contain " > ".';
      return;
    }
    const newPath = this.catForm.parentPath
      ? this.categoryTreeService.joinPath([...this.categoryTreeService.splitPath(this.catForm.parentPath), name])
      : name;

    if (this.allCategoryPaths.includes(newPath)) {
      this.catFormError = `"${newPath}" already exists.`;
      return;
    }

    this.savedCategories = [...this.savedCategories, newPath].sort();
    this.persistCategories();
    // Expand the parent so the new node is visible
    if (this.catForm.parentPath) {
      this.expandedCatNodes.add(this.catForm.parentPath);
    }
    this.catFormSuccess = `"${newPath}" created.`;
    this.catFormError = '';
    this.catForm.name = '';
    setTimeout(() => { this.catFormSuccess = ''; }, 3000);
  }

  // ── Rename category state ──
  renamingCatPath: string | null = null;
  renameCatInput = '';
  renameCatError = '';

  /** Start inline-renaming a category node. */
  startRenameCategory(path: string, currentName: string) {
    this.renamingCatPath = path;
    this.renameCatInput = currentName;
    this.renameCatError = '';
  }

  cancelRenameCategory() {
    this.renamingCatPath = null;
    this.renameCatInput = '';
    this.renameCatError = '';
  }

  /** Commit the rename: updates savedCategories and reassigns events. */
  submitRenameCategory(oldPath: string) {
    const newName = this.renameCatInput.trim();
    if (!newName) {
      this.renameCatError = 'Name cannot be empty.';
      return;
    }
    if (newName.includes(' > ')) {
      this.renameCatError = 'Name cannot contain " > ".';
      return;
    }

    // Build the new full path
    const segments = this.categoryTreeService.splitPath(oldPath);
    segments[segments.length - 1] = newName;
    const newPath = this.categoryTreeService.joinPath(segments);

    // If unchanged, just cancel
    if (newPath === oldPath) {
      this.cancelRenameCategory();
      return;
    }

    // Check for conflicts
    if (this.allCategoryPaths.includes(newPath)) {
      this.renameCatError = `"${newPath}" already exists.`;
      return;
    }

    // Update savedCategories: rename the path and all descendants
    this.savedCategories = this.savedCategories.map(p => {
      if (p === oldPath) return newPath;
      if (p.startsWith(oldPath + CATEGORY_SEP)) {
        return newPath + p.slice(oldPath.length);
      }
      return p;
    });
    this.persistCategories();

    // Reassign events that used this category (or a descendant)
    for (const event of this.events) {
      if (event.category === oldPath) {
        event.category = newPath;
      } else if (event.category.startsWith(oldPath + CATEGORY_SEP)) {
        event.category = newPath + event.category.slice(oldPath.length);
      }
    }

    // Update expanded-node tracking
    if (this.expandedCatNodes.has(oldPath)) {
      this.expandedCatNodes.delete(oldPath);
      this.expandedCatNodes.add(newPath);
    }

    this.cancelRenameCategory();
    this.catFormSuccess = `Renamed to "${newPath}".`;
    setTimeout(() => { this.catFormSuccess = ''; }, 3000);
  }

  // ── Delete category state ──
  deletingCatPath: string | null = null;
  deleteCatConfirmInput = '';

  /** Start delete flow — if category has events, show confirmation. */
  startDeleteCategory(path: string) {
    this.deletingCatPath = path;
    this.deleteCatConfirmInput = '';
  }

  cancelDeleteCategory() {
    this.deletingCatPath = null;
    this.deleteCatConfirmInput = '';
  }

  /** Delete category and optionally reassign its events to another category. */
  confirmDeleteCategory(path: string, reassignTo: string) {
    // Reassign events that used this category (or a descendant)
    for (const event of this.events) {
      if (event.category === path || event.category.startsWith(path + CATEGORY_SEP)) {
        event.category = reassignTo;
      }
    }

    // Remove from saved categories
    this.savedCategories = this.savedCategories.filter(
      p => p !== path && !p.startsWith(path + CATEGORY_SEP)
    );
    this.persistCategories();
    this.expandedCatNodes.delete(path);
    this.deletingCatPath = null;
    this.catFormSuccess = `"${path}" deleted.`;
    setTimeout(() => { this.catFormSuccess = ''; }, 3000);
  }

  deleteSavedCategory(path: string) {
    // Remove the path and all descendants
    this.savedCategories = this.savedCategories.filter(
      p => p !== path && !p.startsWith(path + ' > ')
    );
    this.persistCategories();
  }

  // ── Category filter tree state ──
  /** Expanded nodes in the sidebar filter tree. */
  expandedFilterNodes = new Set<string>();

  toggleFilterNode(path: string) {
    if (this.expandedFilterNodes.has(path)) {
      this.expandedFilterNodes.delete(path);
    } else {
      this.expandedFilterNodes.add(path);
    }
  }

  isFilterNodeExpanded(path: string): boolean {
    return this.expandedFilterNodes.has(path);
  }

  constructor(
    private router: Router,
    private mockAuth: MockAuthService,
    private eventsService: EventsService,
    private notificationsService: NotificationsService,
    private friendsService: FriendsService,
    private categoryTreeService: CategoryTreeService,
    private googleCalendarService: GoogleCalendarService,
    private holidaysService: HolidaysService,
    private aiScheduler: AiSchedulerService,
    private aiChatService: AiChatService,
    private aiOrganize: AiOrganizeService,
    private bedrockChat: BedrockChatService,
    private streaksService: StreaksService,
    public i18n: I18nService,
  ) {}

  async ngOnInit() {
    const user = this.mockAuth.getCurrentUser();
    if (!user) {
      this.router.navigate(['/']);
      return;
    }
    this.userEmail = user.email;
    this.profile = this.mockAuth.getProfile(user.email);
    this.i18n.setLanguage(this.profile.language);
    this.viewMonthInput = this.monthNames[new Date().getMonth()];
    this.googleCalendarLinked = this.googleCalendarService.isLinked;
    this.loadHistory();
    this.loadSavedCategories();
    this.loadStreaks();
    this.loadCategoryColors();
    this.loadAiConversations();
    await this.loadFriends();
    this.refreshAllFriendMessages();
    this.startMessagePolling();
    this.loadEventAttachments();
    await this.loadEventsFromDb(user.email);
    await this.loadNotifications(user.email);
  }

  ngAfterViewInit() {
    // Scroll to current month when calendar tab is first opened
  }

  ngOnDestroy() {
    this.stopMessagePolling();
  }

  /**
   * Load events from the Amplify/DynamoDB backend.
   * Falls back to local seed data if the backend isn't reachable
   * (e.g. placeholder amplify_outputs.json during local dev).
   */
  private async loadEventsFromDb(email: string) {
    this.dbLoading = true;
    this.dbError = '';

    // Step 1 — load from localStorage immediately (instant, offline-safe)
    const cached = this.eventsService.listEvents(email, async (synced) => {
      // Step 3 — called when background Amplify sync completes
      // Also merge shared events from other users
      const shared = await this.eventsService.listSharedEvents(email);
      const ownIds = new Set(synced.map(e => e.id));
      const uniqueShared = shared.filter(e => !ownIds.has(e.id));
      this.events = [...synced, ...uniqueShared];
      this.dbLoading = false;
      this.dbError = this.eventsService.syncWarning ?? '';
      this.showProactiveBanner(await this.runProactiveReminders());
    });

    if (cached.length > 0) {
      // Show cached data right away while sync runs in background
      this.events = cached;
      this.dbLoading = false;
      this.showProactiveBanner(await this.runProactiveReminders());
    } else {
      // Step 2 — nothing in cache: start with empty calendar for new users
      // Only seed demo events for the demo accounts
      if (email === 'alex.student@school.edu') {
        const seedData = buildStudentEvents().map(({ id: _id, ...rest }) => rest);
        this.events = await this.eventsService.seedEvents(seedData, email);
      } else if (email === 'jordan.coach@fitlife.com') {
        const seedData = buildCoachEvents().map(({ id: _id, ...rest }) => rest);
        this.events = await this.eventsService.seedEvents(seedData, email);
      }
      // For all users (including new ones), also load shared events
      const shared = await this.eventsService.listSharedEvents(email);
      if (shared.length > 0) {
        const ownIds = new Set(this.events.map(e => e.id));
        const uniqueShared = shared.filter(e => !ownIds.has(e.id));
        this.events = [...this.events, ...uniqueShared];
      }
      // All other users start with a blank calendar (plus any shared events)
      this.dbLoading = false;
      this.showProactiveBanner(await this.runProactiveReminders());
    }
  }

  dismissLoginBanner() {
    this.showLoginBanner = false;
    if (this.loginBannerTimer) clearTimeout(this.loginBannerTimer);
  }

  private showProactiveBanner(reminders: { title: string; body: string }[]) {
    const todayStr = new Date().toISOString().split('T')[0];
    const todayEvents = this.events.filter(e => e.date === todayStr).sort((a, b) => a.startTime.localeCompare(b.startTime));
    const upcomingEvents = this.events.filter(e => e.date > todayStr);

    // Build the always-present greeting line
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const name = this.profile?.username || this.userEmail.split('@')[0];

    const items: { title: string; body: string }[] = [];

    // 1. Personalized greeting + today summary with context
    if (todayEvents.length === 0) {
      // Check if yesterday was busy — personalize the "free day" message
      const yesterday = new Date(todayStr + 'T00:00:00');
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      const yesterdayCount = this.events.filter(e => e.date === yesterdayStr).length;

      if (yesterdayCount >= 4) {
        items.push({
          title: `${greeting}, ${name}!`,
          body: `Nothing scheduled today after ${yesterdayCount} events yesterday — a well-deserved break.`,
        });
      } else {
        items.push({
          title: `${greeting}, ${name}!`,
          body: `You have nothing scheduled today — enjoy the free day.`,
        });
      }
    } else {
      const first = todayEvents[0];
      // Calculate total scheduled hours for context
      const totalMin = todayEvents.reduce((sum, e) => {
        const s = e.startTime.split(':').map(Number);
        const en = e.endTime.split(':').map(Number);
        return sum + Math.max((en[0] * 60 + en[1]) - (s[0] * 60 + s[1]), 0);
      }, 0);
      const totalHours = Math.round(totalMin / 60 * 10) / 10;

      // Detect the dominant category for today
      const catCounts: Record<string, number> = {};
      todayEvents.forEach(e => { if (e.category) catCounts[e.category] = (catCounts[e.category] ?? 0) + 1; });
      const topCategory = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0];
      const catNote = topCategory && topCategory[1] >= 2
        ? ` Mostly ${topCategory[0].toLowerCase()} today.`
        : '';

      items.push({
        title: `${greeting}, ${name}!`,
        body: `${todayEvents.length} event${todayEvents.length !== 1 ? 's' : ''} today (~${totalHours}h).${catNote} First up: ${first.title} at ${this.formatTime(first.startTime)}.`,
      });
    }

    // 2. Next upcoming event with personalized context
    const nextUp = upcomingEvents.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))[0];
    if (nextUp) {
      const daysUntil = Math.ceil(
        (new Date(nextUp.date + 'T00:00:00').getTime() - new Date(todayStr + 'T00:00:00').getTime())
        / (1000 * 60 * 60 * 24)
      );
      const when = daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;

      // Check how many events share that same day for context
      const sameDayCount = upcomingEvents.filter(e => e.date === nextUp.date).length;
      const contextNote = sameDayCount > 1 ? ` (${sameDayCount} events that day)` : '';

      items.push({
        title: `Coming up ${when}`,
        body: `${nextUp.title} on ${this.formatDate(nextUp.date)} at ${this.formatTime(nextUp.startTime)}${contextNote}.`,
      });
    }

    // 3. Week-at-a-glance insight (only if we have upcoming events)
    if (upcomingEvents.length > 0) {
      const weekEnd = new Date(todayStr + 'T00:00:00');
      weekEnd.setDate(weekEnd.getDate() + 7);
      const weekEndStr = weekEnd.toISOString().split('T')[0];
      const thisWeekEvents = this.events.filter(e => e.date >= todayStr && e.date < weekEndStr);

      if (thisWeekEvents.length >= 5) {
        const daysWithEvents = new Set(thisWeekEvents.map(e => e.date)).size;
        const freeDaysThisWeek = 7 - daysWithEvents;
        if (freeDaysThisWeek <= 1) {
          items.push({
            title: `Busy week ahead`,
            body: `${thisWeekEvents.length} events across ${daysWithEvents} days this week. Only ${freeDaysThisWeek} free day${freeDaysThisWeek !== 1 ? 's' : ''} — pace yourself.`,
          });
        }
      }
    }

    // 4. AI prep reminders (if any)
    for (const r of reminders) {
      items.push({ title: r.title, body: r.body });
    }

    this.loginBannerItems = items;
    this.showLoginBanner = true;

    // Auto-dismiss after 15 seconds (a bit longer since there's more useful info)
    if (this.loginBannerTimer) clearTimeout(this.loginBannerTimer);
    this.loginBannerTimer = setTimeout(() => { this.showLoginBanner = false; }, 15000);
  }

  scrollToYearMonth(idx: number) {
    setTimeout(() => {
      const el = document.getElementById('year-month-' + idx);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }

  prevYear() {
    this.currentYear--;
  }

  nextYear() {
    this.currentYear++;
  }

  switchTab(tab: 'schedule' | 'agenda' | 'calendar' | 'history' | 'notifications' | 'categories' | 'profile' | 'ai' | 'weekly' | 'friends') {
    this.activeTab = tab;
    if (tab === 'calendar') {
      this.slideMonthIndex = this.currentMonthIndex;
      setTimeout(() => this.scrollToYearMonth(this.currentMonthIndex), 80);
    }
    if (tab === 'history') {
      this.historyRestoreMsg = '';
      this.historySearch = '';
    }
    if (tab === 'notifications') {
      this.notifSearch = '';
    }
    if (tab === 'ai') {
      // Auto-open the last conversation or start a new one
      if (this.aiConversations.length === 0) {
        this.startNewAiConversation();
      } else if (!this.activeConversationId) {
        this.openAiConversation(this.aiConversations[0].id);
      }
    }
    if (tab === 'weekly') {
      this.loadWeeklySummary();
    }
  }

  async logout() {
    // Global sign-out revokes the refresh token server-side, so a cached
    // Cognito token can't silently re-authenticate the guard afterward.
    try { await signOut({ global: true }); } catch { /* no active Cognito session */ }
    this.mockAuth.logout();
    sessionStorage.clear();
    // Hard navigation (not the Angular router) guarantees a fresh app load,
    // clearing any in-memory auth state left over from the current session.
    window.location.href = '/';
  }

  linkGoogleCalendar() {
    this.linkingGoogle = true;
    this.googleSyncError = '';

    this.googleCalendarService.authorize()
      .then(() => this.openGcalPicker())
      .catch((err: any) => {
        console.error('[Google Calendar] Auth failed:', err);
        this.googleSyncError = 'Could not connect to Google Calendar. Make sure pop-ups are allowed and try again.';
        this.linkingGoogle = false;
      });
  }

  /** After auth — fetch the user's calendar list and show the picker. */
  private async openGcalPicker() {
    try {
      this.gcalPickerLoading = true;
      this.gcalCalendars = await this.googleCalendarService.listCalendars();
      // Pre-select all calendars
      this.gcalCalendars.forEach(c => c.selected = true);
      this.showGcalPicker = true;
    } catch (err: any) {
      console.error('[Google Calendar] Could not list calendars:', err);
      this.googleSyncError = 'Signed in but could not load your calendars. Please try again.';
    } finally {
      this.gcalPickerLoading = false;
      this.linkingGoogle = false;
    }
  }

  /** Called when the user confirms the calendar picker. */
  async importFromPicker() {
    const selectedCalendars = this.gcalCalendars.filter(c => c.selected);
    if (selectedCalendars.length === 0) {
      this.googleSyncError = 'Please select at least one calendar.';
      return;
    }

    this.gcalImporting = true;
    this.googleSyncError = '';

    try {
      const existingIds = new Set(this.events.map(e => e.id));
      const allNewEvents: CalendarEvent[] = [];

      // Fetch per-calendar so we can assign categories based on calendar name
      for (const cal of selectedCalendars) {
        const gcalEvents = await this.googleCalendarService.fetchEventsFromCalendars([cal.id], this.gcalFutureOnly);
        const toAdd = gcalEvents.filter(g => !existingIds.has(g.id));

        for (const g of toAdd) {
          const category = this.categorizeGCalEvent(g.title, g.description, cal.name);
          const ev: CalendarEvent = {
            id:          `local_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            title:       g.title,
            date:        g.date,
            startTime:   g.startTime,
            endTime:     g.endTime,
            description: g.description,
            color:       g.color,
            category,
            sharedWith:  [],
          };
          allNewEvents.push(ev);
          existingIds.add(ev.id);
        }
      }

      if (allNewEvents.length === 0) {
        this.googleCalendarLinked = true;
        this.showGcalPicker = false;
        console.log('[Google Calendar] No new events to import.');
        return;
      }

      this.eventsService.bulkAddToCache(allNewEvents, this.userEmail);

      this.events = [...this.events, ...allNewEvents].sort(
        (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)
      );

      // Auto-save any new categories that were created
      const newCategories = [...new Set(allNewEvents.map(e => e.category).filter(c => !!c))];
      const existingCategories = new Set(this.savedCategories);
      const categoriesToAdd = newCategories.filter(c => !existingCategories.has(c));
      if (categoriesToAdd.length > 0) {
        this.savedCategories = [...this.savedCategories, ...categoriesToAdd];
        this.persistCategories();
      }

      this.googleCalendarLinked = true;
      this.showGcalPicker = false;
      this.googleSyncError = '';
      console.log(`[Google Calendar] Imported ${allNewEvents.length} events across ${newCategories.length} categories.`);
    } catch (err: any) {
      console.error('[Google Calendar] Fetch failed:', err);
      this.googleSyncError = 'Could not fetch events. Please try again.';
    } finally {
      this.gcalImporting = false;
    }
  }

  /**
   * Auto-categorize a Google Calendar event based on its title, description,
   * and the source calendar name.
   * Returns a category path like "Google Calendar > Work > Meetings".
   */
  private categorizeGCalEvent(title: string, description: string, calendarName: string): string {
    const text = `${title} ${description}`.toLowerCase();
    const calBase = `Google Calendar > ${calendarName}`;

    // Keyword-based subcategory detection
    const rules: { keywords: string[]; subcategory: string }[] = [
      { keywords: ['meeting', 'standup', 'stand-up', 'sync', '1:1', 'one-on-one', 'huddle', 'retro', 'sprint'], subcategory: 'Meetings' },
      { keywords: ['deadline', 'due', 'submit', 'delivery', 'milestone'], subcategory: 'Deadlines' },
      { keywords: ['birthday', 'anniversary', 'celebration', 'party'], subcategory: 'Celebrations' },
      { keywords: ['doctor', 'dentist', 'appointment', 'checkup', 'therapy', 'medical', 'health'], subcategory: 'Health' },
      { keywords: ['gym', 'workout', 'run', 'yoga', 'fitness', 'exercise', 'training', 'swim'], subcategory: 'Fitness' },
      { keywords: ['flight', 'hotel', 'travel', 'trip', 'vacation', 'airport', 'booking'], subcategory: 'Travel' },
      { keywords: ['class', 'lecture', 'exam', 'homework', 'study', 'tutorial', 'school', 'university', 'course'], subcategory: 'Education' },
      { keywords: ['lunch', 'dinner', 'breakfast', 'coffee', 'brunch', 'restaurant'], subcategory: 'Social' },
      { keywords: ['interview', 'review', 'performance', 'onboarding'], subcategory: 'Work' },
      { keywords: ['bill', 'payment', 'invoice', 'tax', 'rent', 'mortgage'], subcategory: 'Finance' },
      { keywords: ['reminder', 'todo', 'task', 'errand', 'pickup', 'drop off'], subcategory: 'Reminders' },
    ];

    for (const rule of rules) {
      if (rule.keywords.some(kw => text.includes(kw))) {
        return `${calBase} > ${rule.subcategory}`;
      }
    }

    // Default: just use the calendar name as the category
    return calBase;
  }

  closeGcalPicker() {
    this.showGcalPicker = false;
    this.gcalCalendars = [];
    this.googleSyncError = '';
    // If user closes without importing, revoke so they're not in a half-linked state
    if (!this.googleCalendarLinked) {
      this.googleCalendarService.revoke();
    }
  }

  unlinkGoogleCalendar() {
    this.googleCalendarService.revoke();
    this.googleCalendarLinked = false;
    this.googleSyncError = '';
  }

  // ── Theme ──
  isDarkMode = false;

  toggleTheme() {
    this.isDarkMode = !this.isDarkMode;
  }

  // ── Top-right notification panel ──
  showNotifPanel = false;
  notifPanelFilter: 'all' | 'share' | 'reminder' | 'event_invite' = 'all';

  /** Notifications shown in the top-right panel (max 20, filtered by type). */
  get panelNotifications(): AppNotification[] {
    const list = this.notifPanelFilter === 'all'
      ? this.notifications
      : this.notifications.filter(n => n.type === this.notifPanelFilter);
    return list.slice(0, 20);
  }

  toggleNotifPanel() {
    this.showNotifPanel = !this.showNotifPanel;
    if (this.showNotifPanel) {
      this.notifPanelFilter = 'all';
    }
  }

  // ── Inline share (inside New Event modal) ──

  /** The email currently being typed in the share field. */
  formShareInput = '';
  /** Filtered suggestions shown in the dropdown. */
  formShareSuggestions: string[] = [];

  /** All unique emails ever shared with, used as the suggestion pool. */
  get knownContacts(): string[] {
    const all = new Set<string>();
    for (const ev of this.events) {
      for (const email of ev.sharedWith) {
        if (email && email !== this.userEmail) all.add(email);
      }
    }
    return Array.from(all).sort();
  }

  onFormShareInput() {
    const q = this.formShareInput.trim().toLowerCase();
    if (!q) {
      this.formShareSuggestions = [];
      return;
    }
    this.formShareSuggestions = this.knownContacts.filter(
      c => c.toLowerCase().includes(q) && !this.form.sharedWith.includes(c)
    );
  }

  addFormShareEmail(email?: string) {
    const raw = (email ?? this.formShareInput).trim().toLowerCase();
    if (!raw || !raw.includes('@')) return;
    if (this.form.sharedWith.includes(raw)) {
      this.formShareInput = '';
      this.formShareSuggestions = [];
      return;
    }
    this.form.sharedWith = [...this.form.sharedWith, raw];
    this.formShareInput = '';
    this.formShareSuggestions = [];
  }

  removeFormShareEmail(email: string) {
    this.form.sharedWith = this.form.sharedWith.filter(e => e !== email);
  }

  onFormShareKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      this.addFormShareEmail();
    } else if (event.key === 'Escape') {
      this.formShareSuggestions = [];
    }
  }

  openScheduleModal() {
    this.form = {
      title: '',
      date: this.today,
      endDate: '',
      startTime: '',
      endTime: '',
      description: '',
      category: this.activeCategoryFilter || '',
      location: '',
      sharedWith: [],
      repeatType: 'none',
      repeatDays: [false, false, false, false, false, false, false],
      repeatUntil: '',
      multiDates: [],
    };
    this.isMultiDay = false;
    this.formShareInput = '';
    this.formShareSuggestions = [];
    this.selectedColor = '#6c63ff';
    this.scheduleError = '';
    this.scheduleSuccess = false;
    this.showCategoryColorPicker = false;
    // Reset AI panel state
    this.showAiPanel = false;
    this.aiSuggestions = [];
    this.aiError = '';
    this.aiLoading = false;
    this.showScheduleModal = true;
    this.initLocationAutocomplete();
  }

  // ── AI Scheduler methods ──────────────────────────────────────────────────

  toggleAiPanel() {
    this.showAiPanel = !this.showAiPanel;
    if (this.showAiPanel && this.aiSuggestions.length === 0 && !this.aiLoading) {
      this.requestAiSuggestions();
    }
  }

  requestAiSuggestions() {
    this.aiLoading = true;
    this.aiError = '';
    this.aiSuggestions = [];
    try {
      const title = this.form.title.trim() || 'New Event';
      this.aiSuggestions = this.aiScheduler.getSuggestions(
        title,
        this.aiDurationMin,
        this.events,
        this.form.date || this.today
      );
      if (this.aiSuggestions.length === 0) {
        this.aiError = 'No free slots found in the next 21 days. Try a shorter duration.';
      }
    } catch (err: any) {
      this.aiError = err?.message ?? 'Could not generate suggestions. Please try again.';
    } finally {
      this.aiLoading = false;
    }
  }

  applyAiSuggestion(s: AiSuggestion) {
    this.form.date = s.date;
    this.form.startTime = s.startTime;
    this.form.endTime = s.endTime;
    this.showAiPanel = false;
    this.aiSuggestions = [];
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
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!this.form.startTime || !timeRegex.test(this.form.startTime)) {
      this.scheduleError = 'Please enter a valid start time (HH:MM).';
      return;
    }
    if (!this.form.endTime || !timeRegex.test(this.form.endTime)) {
      this.scheduleError = 'Please enter a valid end time (HH:MM).';
      return;
    }
    // Normalize single-digit hour (e.g. "9:00" → "09:00")
    this.form.startTime = this.form.startTime.padStart(5, '0');
    this.form.endTime = this.form.endTime.padStart(5, '0');

    if (this.form.startTime >= this.form.endTime) {
      this.scheduleError = 'End time must be after start time.';
      return;
    }

    // ── Weekly recurring: generate events for each selected day until repeatUntil ──
    if (this.form.repeatType === 'weekly') {
      if (!this.form.repeatDays.some(d => d)) {
        this.scheduleError = 'Please select at least one day of the week.';
        return;
      }
      if (!this.form.repeatUntil) {
        this.scheduleError = 'Please select an end date for the recurring event.';
        return;
      }
      if (this.form.repeatUntil < this.form.date) {
        this.scheduleError = 'Repeat until date must be after the start date.';
        return;
      }

      const events: CalendarEvent[] = [];
      const start = new Date(this.form.date + 'T00:00:00');
      const end = new Date(this.form.repeatUntil + 'T00:00:00');
      const cur = new Date(start);

      while (cur <= end) {
        if (this.form.repeatDays[cur.getDay()]) {
          events.push({
            id: `${Date.now()}_${events.length}`,
            title: this.form.title.trim(),
            date: cur.toISOString().split('T')[0],
            startTime: this.form.startTime,
            endTime: this.form.endTime,
            description: this.form.description.trim(),
            color: this.form.category ? this.getCategoryColor(this.form.category.trim()) : this.selectedColor,
            category: this.form.category.trim(),
            location: this.form.location.trim(),
            sharedWith: [...this.form.sharedWith],
          });
        }
        cur.setDate(cur.getDate() + 1);
      }

      if (events.length === 0) {
        this.scheduleError = 'No events would be created with the selected days and date range.';
        return;
      }

      this.addMultipleEventsAndClose(events);
      return;
    }

    // ── Multi-day: create one event on each date picked from the calendar ──
    if (this.form.repeatType === 'multiday') {
      if (this.form.multiDates.length === 0) {
        this.scheduleError = 'Please click at least one date on the calendar.';
        return;
      }

      const events: CalendarEvent[] = this.multiDatesSorted.map((dateStr, i) => ({
        id: `${Date.now()}_${i}`,
        title: this.form.title.trim(),
        date: dateStr,
        startTime: this.form.startTime,
        endTime: this.form.endTime,
        description: this.form.description.trim(),
        color: this.form.category ? this.getCategoryColor(this.form.category.trim()) : this.selectedColor,
        category: this.form.category.trim(),
        location: this.form.location.trim(),
        sharedWith: [...this.form.sharedWith],
      }));

      this.addMultipleEventsAndClose(events);
      return;
    }

    // ── Single event (default) ──
    if (this.isMultiDay) {
      if (!this.form.endDate) {
        this.scheduleError = 'Please select an end date.';
        return;
      }
      if (this.form.endDate < this.form.date) {
        this.scheduleError = 'End date must be on or after the start date.';
        return;
      }
    }

    const newEvent: CalendarEvent = {
      id: Date.now().toString(),
      title: this.form.title.trim(),
      date: this.form.date,
      endDate: this.isMultiDay && this.form.endDate ? this.form.endDate : undefined,
      startTime: this.form.startTime,
      endTime: this.form.endTime,
      description: this.form.description.trim(),
      color: this.form.category ? this.getCategoryColor(this.form.category.trim()) : this.selectedColor,
      category: this.form.category.trim(),
      location: this.form.location.trim(),
      sharedWith: [...this.form.sharedWith],
    };

    // Check for overlapping events on the same date/time
    const overlaps = this.getOverlappingEvents(newEvent);
    if (overlaps.length > 0) {
      this.pendingNewEvent = newEvent;
      this.overlapConflicts = overlaps;
      this.showScheduleModal = false;
      this.showOverlapModal = true;
      this.overlapStep = 'ask';
      this.overlapSelectedEventId = '';
      this.overlapSuggestedDate = '';
      this.overlapSearchOffset = 1;
      this.overlapManualDate = '';
      this.overlapManualError = '';
      this.overlapFinalDate = '';
      this.overlapTimeStart = '';
      this.overlapTimeEnd = '';
      this.overlapTimeError = '';
      return;
    }

    this.addEventAndClose(newEvent);
  }

  private async addEventAndClose(event: CalendarEvent) {
    // Optimistically update the UI first
    this.events = [...this.events, event].sort(
      (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)
    );
    this.recordHistory('added', event);
    this.scheduleSuccess = true;
    setTimeout(() => {
      this.showScheduleModal = false;
      this.scheduleSuccess = false;
    }, 1200);

    // Persist to DB (fire-and-forget; errors are logged but don't block the UI)
    try {
      const { id: _tempId, ...fields } = event;
      const saved = await this.eventsService.createEvent(fields, this.userEmail);
      // Swap the temp id for the real DB id
      this.events = this.events.map(e => e.id === event.id ? saved : e);

      // Fire share notifications for any recipients added at creation time
      for (const email of saved.sharedWith) {
        this.createShareNotification(email, saved, false);
      }
    } catch (err) {
      console.error('[Dashboard] Failed to save event to DB:', err);
    }
  }

  /** Add multiple events at once (for recurring/multi-day). */
  private async addMultipleEventsAndClose(events: CalendarEvent[]) {
    // Optimistically update the UI
    this.events = [...this.events, ...events].sort(
      (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)
    );
    for (const ev of events) {
      this.recordHistory('added', ev);
    }
    this.scheduleSuccess = true;
    setTimeout(() => {
      this.showScheduleModal = false;
      this.scheduleSuccess = false;
    }, 1200);

    // Persist to DB in chunks
    try {
      const toCreate = events.map(({ id: _id, ...rest }) => rest);
      const saved = await this.eventsService.seedEvents(toCreate, this.userEmail);
      // Replace temp IDs with real DB IDs
      const savedMap = new Map(saved.map((s, i) => [events[i].id, s]));
      this.events = this.events.map(e => savedMap.get(e.id) || e);
    } catch (err) {
      console.error('[Dashboard] Failed to save recurring events to DB:', err);
    }
  }

  // ── Overlap detection helpers ──
  private timesToMinutes(t: string): number {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }

  private eventsOverlap(a: CalendarEvent, b: CalendarEvent): boolean {
    if (a.date !== b.date) return false;
    const aStart = this.timesToMinutes(a.startTime);
    const aEnd   = this.timesToMinutes(a.endTime);
    const bStart = this.timesToMinutes(b.startTime);
    const bEnd   = this.timesToMinutes(b.endTime);
    return aStart < bEnd && bStart < aEnd;
  }

  getOverlappingEvents(candidate: CalendarEvent): CalendarEvent[] {
    return this.events.filter(e => e.id !== candidate.id && this.eventsOverlap(candidate, e));
  }

  // ── Overlap modal state ──
  showOverlapModal = false;
  overlapStep: 'ask' | 'pick' | 'mode' | 'suggest' | 'manual' | 'timepick' = 'ask';
  pendingNewEvent: CalendarEvent | null = null;
  overlapConflicts: CalendarEvent[] = [];
  overlapSelectedEventId = '';
  overlapSuggestedDate = '';
  overlapSearchOffset = 1;
  overlapManualDate = '';
  overlapManualError = '';
  // Time-pick step state
  overlapFinalDate = '';          // the date we're committing to
  overlapTimeStart = '09:00';
  overlapTimeEnd   = '10:00';
  overlapTimeError = '';

  get overlapSelectedEvent(): CalendarEvent | undefined {
    return [...this.events, ...(this.pendingNewEvent ? [this.pendingNewEvent] : [])]
      .find(e => e.id === this.overlapSelectedEventId);
  }

  /** Events on a given date, excluding the event being moved */
  eventsOnDate(dateStr: string): CalendarEvent[] {
    const ev = this.overlapSelectedEvent;
    return this.events.filter(e => e.date === dateStr && e.id !== ev?.id);
  }

  overlapDecline() {
    if (this.pendingNewEvent) {
      this.addEventAndClose(this.pendingNewEvent);
    }
    this.showOverlapModal = false;
    this.pendingNewEvent = null;
    this.overlapConflicts = [];
  }

  overlapAccept() {
    this.overlapStep = 'pick';
  }

  overlapPickEvent(id: string) {
    this.overlapSelectedEventId = id;
  }

  overlapProceedToMode() {
    if (!this.overlapSelectedEventId) return;
    this.overlapStep = 'mode';
  }

  overlapChooseComputer() {
    this.overlapSuggestions = this.findAvailableSlots();
    this.overlapStep = 'suggest';
  }

  // ── Multiple slot suggestions for rescheduling ──
  overlapSuggestions: { date: string; startTime: string; endTime: string; reason: string }[] = [];

  private findAvailableSlots(): { date: string; startTime: string; endTime: string; reason: string }[] {
    const ev = this.overlapSelectedEvent;
    if (!ev) return [];

    // Calculate duration of the event being rescheduled
    const startMin = this.toMinHelper(ev.startTime);
    const endMin = this.toMinHelper(ev.endTime);
    const durationMin = endMin - startMin > 0 ? endMin - startMin : 60;

    // Use the AI scheduler to find open slots starting from the event's original date
    const aiSlots = this.aiScheduler.getSuggestions(
      ev.title,
      durationMin,
      this.events.filter(e => e.id !== ev.id),
      ev.date,
    );

    // Also find gaps on the SAME day
    const sameDayEvents = this.events
      .filter(e => e.date === ev.date && e.id !== ev.id)
      .map(e => ({ start: this.toMinHelper(e.startTime), end: this.toMinHelper(e.endTime) }))
      .sort((a, b) => a.start - b.start);

    const sameDaySlots = this.findGapsOnDay(sameDayEvents, durationMin, ev.date);

    // Combine: same-day slots first, then AI suggestions (deduplicated)
    const all = [...sameDaySlots, ...aiSlots];
    const seen = new Set<string>();
    const unique: typeof all = [];
    for (const s of all) {
      const key = `${s.date}_${s.startTime}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(s);
      }
    }
    return unique.slice(0, 5);
  }

  private findGapsOnDay(
    dayEvents: { start: number; end: number }[],
    durationMin: number,
    date: string,
  ): { date: string; startTime: string; endTime: string; reason: string }[] {
    const results: { date: string; startTime: string; endTime: string; reason: string }[] = [];
    const BUFFER = 15;
    const dayStart = 8 * 60;
    const dayEnd = 22 * 60;

    const blocked = dayEvents.map(e => ({
      start: Math.max(0, e.start - BUFFER),
      end: Math.min(24 * 60, e.end + BUFFER),
    }));

    // Build sorted list of occupied intervals
    const intervals = [...blocked].sort((a, b) => a.start - b.start);

    // Find gaps
    let cursor = dayStart;
    for (const interval of intervals) {
      if (interval.start > cursor && interval.start - cursor >= durationMin) {
        const gapStart = Math.max(cursor, dayStart);
        if (gapStart + durationMin <= dayEnd) {
          results.push({
            date,
            startTime: this.fromMinHelper(gapStart),
            endTime: this.fromMinHelper(gapStart + durationMin),
            reason: `Same day — open slot between events`,
          });
          if (results.length >= 2) break;
        }
      }
      cursor = Math.max(cursor, interval.end);
    }
    // Check gap after last event
    if (results.length < 2 && cursor + durationMin <= dayEnd) {
      results.push({
        date,
        startTime: this.fromMinHelper(cursor),
        endTime: this.fromMinHelper(cursor + durationMin),
        reason: `Same day — open slot after last event`,
      });
    }
    return results;
  }

  private toMinHelper(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + (m || 0);
  }

  private fromMinHelper(min: number): string {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  overlapPickSuggestion(slot: { date: string; startTime: string; endTime: string }) {
    this.applyOverlapReschedule(slot.date, slot.startTime, slot.endTime);
  }

  overlapChooseManual() {
    const ev = this.overlapSelectedEvent;
    this.overlapManualDate = ev ? ev.date : this.today;
    this.overlapManualError = '';
    this.overlapStep = 'manual';
  }

  // Search both before and after the original date, returning the closest free day
  private findClosestAvailableDate(): string {
    const ev = this.overlapSelectedEvent;
    if (!ev) return '';
    const baseDate = new Date(ev.date + 'T00:00:00');

    for (let radius = this.overlapSearchOffset; radius <= 365; radius++) {
      for (const sign of [1, -1]) {
        const candidate = new Date(baseDate);
        candidate.setDate(baseDate.getDate() + sign * radius);
        const dateStr = candidate.toISOString().split('T')[0];
        const tempEv: CalendarEvent = { ...ev, date: dateStr };
        const conflicts = this.events.filter(e =>
          e.id !== ev.id && this.eventsOverlap(tempEv, e)
        );
        if (conflicts.length === 0) {
          this.overlapSearchOffset = radius;
          return dateStr;
        }
      }
    }
    return '';
  }

  overlapConfirmSuggest() {
    this.proceedToTimepickOrApply(this.overlapSuggestedDate);
  }

  overlapRejectSuggest() {
    this.overlapSearchOffset++;
    this.overlapSuggestedDate = this.findClosestAvailableDate();
  }

  overlapConfirmManual() {
    this.overlapManualError = '';
    if (!this.overlapManualDate) {
      this.overlapManualError = 'Please select a date.';
      return;
    }
    const ev = this.overlapSelectedEvent;
    if (ev) {
      const tempEv: CalendarEvent = { ...ev, date: this.overlapManualDate };
      const conflicts = this.events.filter(e =>
        e.id !== ev.id && this.eventsOverlap(tempEv, e)
      );
      if (conflicts.length > 0) {
        this.overlapManualError = `This date still conflicts with: ${conflicts.map(c => c.title).join(', ')}. Please pick a different date.`;
        return;
      }
    }
    this.proceedToTimepickOrApply(this.overlapManualDate);
  }

  /** Always go to time-pick so the user can adjust the time on the new date */
  private proceedToTimepickOrApply(date: string) {
    const ev = this.overlapSelectedEvent;
    this.overlapFinalDate  = date;
    this.overlapTimeStart  = ev ? ev.startTime : '09:00';
    this.overlapTimeEnd    = ev ? ev.endTime   : '10:00';
    this.overlapTimeError  = '';
    this.overlapStep = 'timepick';
  }

  overlapConfirmTime() {
    this.overlapTimeError = '';
    if (this.overlapTimeStart >= this.overlapTimeEnd) {
      this.overlapTimeError = 'End time must be after start time.';
      return;
    }
    // Check the new time doesn't conflict with anything on that day
    const ev = this.overlapSelectedEvent;
    if (ev) {
      const tempEv: CalendarEvent = {
        ...ev,
        date: this.overlapFinalDate,
        startTime: this.overlapTimeStart,
        endTime: this.overlapTimeEnd,
      };
      const conflicts = this.events.filter(e =>
        e.id !== ev.id && this.eventsOverlap(tempEv, e)
      );
      if (conflicts.length > 0) {
        this.overlapTimeError = `This time still conflicts with: ${conflicts.map(c => `${c.title} (${this.formatTime(c.startTime)}–${this.formatTime(c.endTime)})`).join(', ')}.`;
        return;
      }
    }
    this.applyOverlapReschedule(this.overlapFinalDate, this.overlapTimeStart, this.overlapTimeEnd);
  }

  overlapSkipTime() {
    // Keep original times, just move the date
    this.applyOverlapReschedule(this.overlapFinalDate, null, null);
  }

  private applyOverlapReschedule(newDate: string, newStart: string | null, newEnd: string | null) {
    const ev = this.overlapSelectedEvent;
    if (!ev || !newDate) return;

    const isPending = this.pendingNewEvent?.id === this.overlapSelectedEventId;

    if (isPending && this.pendingNewEvent) {
      const rescheduled: CalendarEvent = {
        ...this.pendingNewEvent,
        date: newDate,
        startTime: newStart ?? this.pendingNewEvent.startTime,
        endTime:   newEnd   ?? this.pendingNewEvent.endTime,
      };
      this.addEventAndClose(rescheduled);
    } else {
      const before = { ...ev };
      this.events = this.events.map(e =>
        e.id === ev.id
          ? { ...e, date: newDate, startTime: newStart ?? e.startTime, endTime: newEnd ?? e.endTime }
          : e
      ).sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
      const after = this.events.find(e => e.id === ev.id)!;
      this.recordHistory('changed', after, before);
      // Persist rescheduled event to DB
      this.eventsService.updateEvent(after).catch(err =>
        console.error('[Dashboard] Failed to update rescheduled event in DB:', err)
      );
      if (this.pendingNewEvent) {
        this.addEventAndClose(this.pendingNewEvent);
      }
    }

    this.showOverlapModal = false;
    this.pendingNewEvent = null;
    this.overlapConflicts = [];
  }

  closeOverlapModal() {
    this.showOverlapModal = false;
    this.pendingNewEvent = null;
    this.overlapConflicts = [];
  }

  deleteEvent(id: string) {
    const ev = this.events.find(e => e.id === id);
    if (ev) this.recordHistory('deleted', ev);
    // Optimistic remove
    this.events = this.events.filter((e) => e.id !== id);
    // Persist to DB
    this.eventsService.deleteEvent(id).catch(err =>
      console.error('[Dashboard] Failed to delete event from DB:', err)
    );
  }

  // ── Year view event popup ──
  popupEvent: CalendarEvent | null = null;
  popupX = 0;
  popupY = 0;

  openEventPopup(event: CalendarEvent, mouseEvent: MouseEvent) {
    mouseEvent.stopPropagation();
    this.popupEvent = event;
    const rect = (mouseEvent.target as HTMLElement).getBoundingClientRect();
    this.popupX = rect.left + rect.width / 2;
    this.popupY = rect.bottom + 8;
  }

  closeEventPopup() {
    this.popupEvent = null;
  }

  // ── Day detail panel (click a date cell) ──
  showDayPanel = false;
  dayPanelDate = '';

  get dayPanelLabel(): string {
    if (!this.dayPanelDate) return '';
    const d = new Date(this.dayPanelDate + 'T00:00:00');
    return d.toLocaleDateString(this.i18n.getLocale(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  get dayPanelEvents(): CalendarEvent[] {
    return this.eventsForDate(this.dayPanelDate);
  }

  openDayPanel(dateStr: string, mouseEvent?: MouseEvent) {
    if (mouseEvent) mouseEvent.stopPropagation();
    this.dayPanelDate = dateStr;
    this.showDayPanel = true;
    this.closeEventPopup();
  }

  closeDayPanel() {
    this.showDayPanel = false;
  }

  addEventOnDate(dateStr: string) {
    this.form = {
      title: '',
      date: dateStr,
      endDate: '',
      startTime: '09:00',
      endTime: '10:00',
      description: '',
      category: this.activeCategoryFilter || '',
      location: '',
      sharedWith: [],
      repeatType: 'none',
      repeatDays: [false, false, false, false, false, false, false],
      repeatUntil: '',
      multiDates: [],
    };
    this.isMultiDay = false;
    this.formShareInput = '';
    this.formShareSuggestions = [];
    this.selectedColor = '#6c63ff';
    this.scheduleError = '';
    this.scheduleSuccess = false;
    // Reset AI panel state
    this.showAiPanel = false;
    this.aiSuggestions = [];
    this.aiError = '';
    this.aiLoading = false;
    this.showScheduleModal = true;
    this.initLocationAutocomplete();
  }

  editEventFromPanel(ev: CalendarEvent) {
    this.selectedEventId = ev.id;
    this.changeForm = { date: ev.date, startTime: ev.startTime, endTime: ev.endTime, category: ev.category };
    this.changeError = '';
    this.changeStep = 'edit';
    this.showChangeModal = true;
  }

  // ── Delete modal ──
  showDeleteModal = false;
  searchQuery = '';
  searchResults: CalendarEvent[] = [];
  selectedEventId = '';
  deleteError = '';

  // ── Mini calendar browser (shared for delete & change modals) ──
  browseMode: 'search' | 'calendar' = 'search';
  browseMonth = new Date().getMonth();
  browseYear = new Date().getFullYear();
  browseSelectedDate = '';
  browseDayEvents: CalendarEvent[] = [];

  get browseMonthName(): string {
    return this.monthNames[this.browseMonth];
  }

  get browseWeeks() {
    return this.buildWeeks(this.browseYear, this.browseMonth);
  }

  toggleBrowseMode() {
    if (this.browseMode === 'search') {
      this.browseMode = 'calendar';
      this.browseMonth = new Date().getMonth();
      this.browseYear = new Date().getFullYear();
      this.browseSelectedDate = '';
      this.browseDayEvents = [];
    }
  }

  browsePrevMonth() {
    if (this.browseMonth === 0) {
      this.browseMonth = 11;
      this.browseYear--;
    } else {
      this.browseMonth--;
    }
    this.browseSelectedDate = '';
    this.browseDayEvents = [];
  }

  browseNextMonth() {
    if (this.browseMonth === 11) {
      this.browseMonth = 0;
      this.browseYear++;
    } else {
      this.browseMonth++;
    }
    this.browseSelectedDate = '';
    this.browseDayEvents = [];
  }

  browseSelectDay(dateStr: string) {
    this.browseSelectedDate = dateStr;
    this.browseDayEvents = this.eventsForDate(dateStr);
  }

  browseSelectEvent(id: string) {
    this.selectedEventId = id;
  }

  openDeleteModal() {
    this.searchQuery = '';
    this.searchResults = [];
    this.selectedEventId = '';
    this.deleteError = '';
    this.browseMode = 'search';
    this.browseSelectedDate = '';
    this.browseDayEvents = [];
    this.showDeleteModal = true;
  }

  closeDeleteModal() { this.showDeleteModal = false; }

  onSearchChange() {
    const q = this.searchQuery.trim().toLowerCase();
    this.selectedEventId = '';
    this.searchResults = q.length < 1 ? [] :
      this.events.filter(e => e.title.toLowerCase().includes(q));
  }

  selectEvent(id: string) { this.selectedEventId = id; }

  confirmDelete() {
    if (!this.selectedEventId) { this.deleteError = 'Please select an event.'; return; }
    const ev = this.events.find(e => e.id === this.selectedEventId);
    if (ev) this.recordHistory('deleted', ev);
    this.events = this.events.filter(e => e.id !== this.selectedEventId);
    this.showDeleteModal = false;
    // Persist to DB
    this.eventsService.deleteEvent(this.selectedEventId).catch(err =>
      console.error('[Dashboard] Failed to delete event from DB:', err)
    );
  }

  // ── Change modal ──
  showChangeModal = false;
  changeStep: 'search' | 'edit' | 'done' = 'search';
  changeError = '';
  changeForm = { date: '', startTime: '', endTime: '', category: '' };

  // Category picker state for the change modal
  showChangeCategoryPicker = false;
  changeCategoryPickerPath: string[] = [];
  changeCategoryPickerSearch = '';
  showChangeNewCategoryInput = false;
  changeNewCategoryName = '';

  get changeCategoryPickerLevel(): CategoryNode[] {
    let level = this.categoryTree;
    for (const seg of this.changeCategoryPickerPath) {
      const node = level.find(n => n.name === seg);
      if (!node) return [];
      level = node.children;
    }
    return level;
  }

  get changeCategoryPickerFiltered(): CategoryNode[] {
    const q = this.changeCategoryPickerSearch.trim().toLowerCase();
    if (!q) return this.changeCategoryPickerLevel;
    return this.changeCategoryPickerLevel.filter(n => n.name.toLowerCase().includes(q));
  }

  get changeCategoryPickerFullPath(): string {
    return this.categoryTreeService.joinPath(this.changeCategoryPickerPath);
  }

  openChangeCategoryPicker() {
    const existing = this.changeForm.category.trim();
    if (existing) {
      this.changeCategoryPickerPath = this.categoryTreeService.splitPath(existing);
    } else {
      this.changeCategoryPickerPath = [];
    }
    this.showChangeCategoryPicker = true;
    this.showChangeNewCategoryInput = false;
    this.changeNewCategoryName = '';
    this.changeCategoryPickerSearch = '';
  }

  closeChangeCategoryPicker() {
    this.showChangeCategoryPicker = false;
    this.showChangeNewCategoryInput = false;
    this.changeNewCategoryName = '';
    this.changeCategoryPickerSearch = '';
  }

  changeCategoryPickerDrillDown(node: CategoryNode) {
    this.changeCategoryPickerPath = this.categoryTreeService.splitPath(node.fullPath);
    this.showChangeNewCategoryInput = false;
    this.changeNewCategoryName = '';
    this.changeCategoryPickerSearch = '';
  }

  changeCategoryPickerGoUp() {
    this.changeCategoryPickerPath = this.changeCategoryPickerPath.slice(0, -1);
    this.showChangeNewCategoryInput = false;
    this.changeNewCategoryName = '';
    this.changeCategoryPickerSearch = '';
  }

  changeCategoryPickerSelect() {
    this.changeForm.category = this.changeCategoryPickerFullPath;
    this.closeChangeCategoryPicker();
  }

  changeCategoryPickerSelectNode(node: CategoryNode) {
    this.changeForm.category = node.fullPath;
    this.closeChangeCategoryPicker();
  }

  changeCategoryPickerAddNew() {
    const name = this.changeNewCategoryName.trim();
    if (!name) return;
    const newPath = this.changeCategoryPickerPath.length
      ? this.categoryTreeService.joinPath([...this.changeCategoryPickerPath, name])
      : name;
    this.changeForm.category = newPath;
    this.closeChangeCategoryPicker();
  }

  clearChangeCategory() {
    this.changeForm.category = '';
  }

  get selectedEvent(): CalendarEvent | undefined {
    return this.events.find(e => e.id === this.selectedEventId);
  }

  openChangeModal() {
    this.searchQuery = '';
    this.searchResults = [];
    this.selectedEventId = '';
    this.changeError = '';
    this.changeStep = 'search';
    this.browseMode = 'search';
    this.browseSelectedDate = '';
    this.browseDayEvents = [];
    this.showChangeModal = true;
  }

  closeChangeModal() { this.showChangeModal = false; }

  proceedToChange() {
    if (!this.selectedEventId) return;
    const ev = this.selectedEvent!;
    this.changeForm = { date: ev.date, startTime: ev.startTime, endTime: ev.endTime, category: ev.category };
    this.changeError = '';
    this.changeStep = 'edit';
  }

  confirmChange() {
    if (!this.changeForm.date) { this.changeError = 'Please select a date.'; return; }
    if (this.changeForm.startTime >= this.changeForm.endTime) {
      this.changeError = 'End time must be after start time.'; return;
    }
    const before = this.events.find(e => e.id === this.selectedEventId);
    const newColor = this.changeForm.category ? this.getCategoryColor(this.changeForm.category) : undefined;
    this.events = this.events.map(e =>
      e.id === this.selectedEventId
        ? { ...e, date: this.changeForm.date, startTime: this.changeForm.startTime, endTime: this.changeForm.endTime, category: this.changeForm.category, ...(newColor ? { color: newColor } : {}) }
        : e
    ).sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
    const after = this.events.find(e => e.id === this.selectedEventId);
    if (before && after) this.recordHistory('changed', after, before);
    this.changeStep = 'done';
    setTimeout(() => this.showChangeModal = false, 1200);

    // Persist to DB
    if (after) {
      this.eventsService.updateEvent(after).catch(err =>
        console.error('[Dashboard] Failed to update event in DB:', err)
      );
    }
  }

  get todayEvents() {
    return this.filteredEvents.filter((e) => this.eventSpansDate(e, this.today));
  }

  get upcomingEvents() {
    const weekAhead = new Date();
    weekAhead.setDate(weekAhead.getDate() + 7);
    const weekAheadStr = weekAhead.toISOString().split('T')[0];
    return this.filteredEvents.filter((e) => {
      const effectiveEnd = e.endDate || e.date;
      // Event starts after today OR spans into the future (ends after today)
      return (e.date > this.today || effectiveEnd > this.today) && e.date <= weekAheadStr;
    });
  }

  get pastEvents() {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString().split('T')[0];
    return this.filteredEvents.filter((e) => {
      const effectiveEnd = e.endDate || e.date;
      // Event is fully in the past (end date < today)
      return effectiveEnd < this.today && e.date >= weekAgoStr;
    });
  }

  // ── Category helpers ──

  /** Unique sorted list of all category paths across all events. */
  get allCategories(): string[] {
    const cats = new Set(this.events.map(e => e.category).filter(c => !!c));
    return Array.from(cats).sort();
  }

  /** Events filtered by the active category pill (or all if none selected).
   *  Selecting a parent path also includes all descendant paths. */
  get filteredEvents(): CalendarEvent[] {
    const base = this.activeCategoryFilter
      ? this.events.filter(e => this.categoryTreeService.isUnderPath(e.category, this.activeCategoryFilter))
      : this.events;
    return base.map(e => ({
      ...e,
      color: this.getCategoryColor(e.category) || e.color,
    }));
  }

  setCategoryFilter(cat: string) {
    this.activeCategoryFilter = this.activeCategoryFilter === cat ? '' : cat;
  }

  // ── Share modal ──

  openShareModal(event: CalendarEvent) {
    this.shareTargetEvent = event;
    this.shareEmail = '';
    this.shareCategoryOnly = false;
    this.shareSuccess = '';
    this.shareError = '';
    this.shareFriendSuggestions = [];
    this.shareShowSuggestions = false;
    this.showShareModal = true;
  }

  closeShareModal() {
    this.showShareModal = false;
    this.shareTargetEvent = null;
    this.shareFriendSuggestions = [];
    this.shareShowSuggestions = false;
  }

  /** Filter friends list as user types in share modal — matches nickname, displayName, or email */
  onShareInputChange() {
    const q = this.shareEmail.trim().toLowerCase();
    if (!q) {
      this.shareFriendSuggestions = [];
      this.shareShowSuggestions = false;
      return;
    }
    this.shareFriendSuggestions = this.friends.filter(f =>
      f.nickname.toLowerCase().includes(q) ||
      f.displayName.toLowerCase().includes(q) ||
      f.email.toLowerCase().includes(q)
    );
    this.shareShowSuggestions = this.shareFriendSuggestions.length > 0;
  }

  /** Select a friend from the suggestions dropdown */
  selectShareFriend(friend: Friend) {
    this.shareEmail = friend.email;
    this.shareFriendSuggestions = [];
    this.shareShowSuggestions = false;
  }

  /** Dismiss suggestions when clicking outside */
  dismissShareSuggestions() {
    setTimeout(() => {
      this.shareShowSuggestions = false;
    }, 200);
  }

  async confirmShare() {
    this.shareError = '';
    this.shareSuccess = '';
    // Resolve friend nickname to email if needed
    let email = this.shareEmail.trim().toLowerCase();
    if (email && !email.includes('@')) {
      const matchedFriend = this.friends.find(f =>
        f.nickname.toLowerCase() === email ||
        f.displayName.toLowerCase() === email
      );
      if (matchedFriend) {
        email = matchedFriend.email;
      } else {
        this.shareError = 'Please enter a valid email address or select a friend.';
        return;
      }
    }
    if (!email || !email.includes('@')) {
      this.shareError = 'Please enter a valid email address or select a friend.';
      return;
    }
    if (!this.shareTargetEvent) return;

    const targets: CalendarEvent[] = this.shareCategoryOnly && this.shareTargetEvent.category
      ? this.events.filter(e => e.category === this.shareTargetEvent!.category)
      : [this.shareTargetEvent];

    const label = this.shareCategoryOnly && this.shareTargetEvent.category
      ? `all "${this.shareTargetEvent.category}" events (${targets.length})`
      : `"${this.shareTargetEvent.title}"`;

    // Send an event invitation (pending) instead of immediately sharing
    try {
      const n = await this.notificationsService.create({
        recipientEmail: email,
        type: 'event_invite',
        title: `${this.userEmail} invited you to ${label}`,
        body: this.shareCategoryOnly
          ? `Category: ${this.shareTargetEvent.category} (${targets.length} events)`
          : `${formatDate2(this.shareTargetEvent.date)} · ${this.shareTargetEvent.startTime}–${this.shareTargetEvent.endTime}`,
        eventId: this.shareTargetEvent.id,
        eventDate: this.shareTargetEvent.date,
        senderEmail: this.userEmail,
        read: false,
        status: 'pending',
      });
      // If the recipient is the current user (demo/testing), show it immediately
      if (email === this.userEmail) {
        this.notifications = [n, ...this.notifications];
      }
    } catch (err) {
      console.warn('[Dashboard] Could not create event invite notification:', err);
    }

    this.shareSuccess = `Invitation sent to ${email} for ${label}. They'll need to accept it.`;
    this.shareEmail = '';

    setTimeout(() => this.closeShareModal(), 2000);
  }

  removeShare(event: CalendarEvent, email: string) {
    this.events = this.events.map(e =>
      e.id === event.id ? { ...e, sharedWith: e.sharedWith.filter(x => x !== email) } : e
    );
    const updated = this.events.find(e => e.id === event.id);
    if (updated) {
      this.eventsService.updateEvent(updated).catch(err =>
        console.error('[Dashboard] Failed to remove share:', err)
      );
    }
  }

  /** Accept an event invitation — adds event to calendar with AI category suggestion, notifies the sender. */
  async acceptInvite(n: AppNotification) {
    n.status = 'accepted';
    n.read = true;

    // Persist the status change
    this.notificationsService.updateStatus(n.id, 'accepted').catch(() => {});

    // Find the original event from sharedWith listing or local events
    const eventId = n.eventId;
    let sourceEvent: CalendarEvent | undefined;
    if (eventId) {
      sourceEvent = this.events.find(e => e.id === eventId);
    }

    // If the event doesn't exist locally yet, create a copy on the user's calendar
    if (sourceEvent) {
      // Also update sharedWith so the relationship is tracked
      if (!sourceEvent.sharedWith.includes(this.userEmail)) {
        this.events = this.events.map(e => {
          if (e.id === eventId) {
            return { ...e, sharedWith: [...e.sharedWith, this.userEmail] };
          }
          return e;
        });
        const updated = this.events.find(e => e.id === eventId);
        if (updated) {
          this.eventsService.updateEvent(updated).catch(err =>
            console.error('[Dashboard] Failed to persist invite accept:', err)
          );
        }
      }

      // Create a personal copy of the event on this user's calendar
      const newEvent: Omit<CalendarEvent, 'id'> = {
        title: sourceEvent.title,
        date: sourceEvent.date,
        startTime: sourceEvent.startTime,
        endTime: sourceEvent.endTime,
        description: sourceEvent.description || `Invited by ${n.senderEmail}`,
        color: sourceEvent.color,
        category: '', // Will be set by AI suggestion
        sharedWith: [],
      };

      try {
        const created = await this.eventsService.createEvent(newEvent, this.userEmail);
        this.events = [...this.events, created];

        // Open the AI category suggestion modal for the newly added event
        this.openInviteCategoryModal(created);
      } catch (err) {
        console.error('[Dashboard] Failed to create accepted event copy:', err);
      }
    }

    // Notify the sender that the invite was accepted
    try {
      const responseNotif = await this.notificationsService.create({
        recipientEmail: n.senderEmail,
        type: 'invite_response',
        title: `${this.userEmail} accepted your event invitation`,
        body: `They accepted the invite for "${n.title.replace(/^.*invited you to /, '')}"`,
        eventId: n.eventId,
        eventDate: n.eventDate,
        senderEmail: this.userEmail,
        read: false,
        status: 'accepted',
      });
      // If the sender is the current user (demo/testing), show it immediately
      if (n.senderEmail === this.userEmail) {
        this.notifications = [responseNotif, ...this.notifications];
      }
    } catch (err) {
      console.warn('[Dashboard] Could not notify sender of acceptance:', err);
    }
  }

  // ── AI Category Suggestion Modal (for accepted invites) ──
  showInviteCategoryModal = false;
  inviteCategoryEvent: CalendarEvent | null = null;
  inviteCategorySuggestion = '';
  inviteCategoryCustom = '';
  inviteCategoryLoading = false;

  /** Open modal to let AI suggest a category for an accepted invite event. */
  private async openInviteCategoryModal(event: CalendarEvent) {
    this.inviteCategoryEvent = event;
    this.inviteCategorySuggestion = '';
    this.inviteCategoryCustom = '';
    this.inviteCategoryLoading = true;
    this.showInviteCategoryModal = true;

    // Ask AI to suggest a category based on the event and the user's existing categories
    try {
      const existingCats = this.allCategories.length > 0
        ? this.allCategories.join(', ')
        : 'Personal, Work, School, Health, Social';

      const prompt = `I just accepted an event invitation. The event is titled "${event.title}" on ${event.date} from ${event.startTime} to ${event.endTime}. Description: "${event.description || 'none'}". My existing calendar categories are: ${existingCats}. Which ONE category best fits this event? Reply with ONLY the category name, nothing else.`;

      const { text } = await this.bedrockChat.sendMessage(prompt, this.events, []);
      this.inviteCategorySuggestion = text.trim().replace(/["""]/g, '');
    } catch (err) {
      // Fallback — suggest based on simple heuristics
      this.inviteCategorySuggestion = this.allCategories.length > 0
        ? this.allCategories[0]
        : 'Personal';
      console.warn('[Dashboard] AI category suggestion failed, using fallback:', err);
    } finally {
      this.inviteCategoryLoading = false;
    }
  }

  /** User accepts the AI-suggested category. */
  async confirmInviteCategory(category: string) {
    if (!this.inviteCategoryEvent || !category.trim()) return;
    const cat = category.trim();

    // Update the event with the chosen category
    this.events = this.events.map(e =>
      e.id === this.inviteCategoryEvent!.id ? { ...e, category: cat } : e
    );
    const updated = this.events.find(e => e.id === this.inviteCategoryEvent!.id);
    if (updated) {
      this.eventsService.updateEvent(updated).catch(err =>
        console.error('[Dashboard] Failed to update invite event category:', err)
      );
    }

    // Add to saved categories if it's a new one
    if (cat && !this.savedCategories.includes(cat) && !this.allCategories.includes(cat)) {
      this.savedCategories = [...this.savedCategories, cat].sort();
      this.persistCategories();
    }

    this.closeInviteCategoryModal();
  }

  /** Skip categorization — leave it uncategorized. */
  skipInviteCategory() {
    this.closeInviteCategoryModal();
  }

  private closeInviteCategoryModal() {
    this.showInviteCategoryModal = false;
    this.inviteCategoryEvent = null;
    this.inviteCategorySuggestion = '';
    this.inviteCategoryCustom = '';
  }

  /** Decline an event invitation — notifies the sender. */
  async declineInvite(n: AppNotification) {
    n.status = 'rejected';
    n.read = true;

    // Persist the status change
    this.notificationsService.updateStatus(n.id, 'rejected').catch(() => {});

    // Notify the sender that the invite was declined
    try {
      const responseNotif = await this.notificationsService.create({
        recipientEmail: n.senderEmail,
        type: 'invite_response',
        title: `${this.userEmail} declined your event invitation`,
        body: `They declined the invite for "${n.title.replace(/^.*invited you to /, '')}"`,
        eventId: n.eventId,
        eventDate: n.eventDate,
        senderEmail: this.userEmail,
        read: false,
        status: 'rejected',
      });
      // If the sender is the current user (demo/testing), show it immediately
      if (n.senderEmail === this.userEmail) {
        this.notifications = [responseNotif, ...this.notifications];
      }
    } catch (err) {
      console.warn('[Dashboard] Could not notify sender of decline:', err);
    }
  }

  // ── Notifications ──────────────────────────────────────────────────────────

  private async loadNotifications(email: string) {
    try {
      this.notifications = await this.notificationsService.listForUser(email);
      this.checkDueReminders();
      await this.processFriendResponses();
    } catch (err) {
      // Fallback: keep empty array, no crash
      console.warn('[Dashboard] Could not load notifications:', err);
    }
  }

  /**
   * Completes the friend-request handshake on the requester's side: when the
   * other person accepts, they send us a 'friend_response' notification —
   * only WE can write to our own Friend list, so we do it here.
   */
  private async processFriendResponses() {
    const toProcess = this.notifications.filter(
      n => n.type === 'friend_response' && n.status === 'accepted' && !n.read
    );
    for (const n of toProcess) {
      const friendEmail = n.eventId;
      if (friendEmail && !this.friends.some(f => f.email === friendEmail)) {
        const pending = this.pendingFriendRequests.find(p => p.email === friendEmail);
        const nickname = pending?.nickname || friendEmail.split('@')[0];
        try {
          const friend = await this.friendsService.addFriend(this.userEmail, friendEmail, nickname);
          this.friends = [...this.friends, friend];
        } catch (err) {
          console.error('[Dashboard] Failed to add accepted friend:', err);
        }
      }
      this.pendingFriendRequests = this.pendingFriendRequests.filter(p => p.email !== friendEmail);
      this.friendRequestsSent.delete(friendEmail);
      n.read = true;
      this.notificationsService.markRead(n.id).catch(() => {});
    }
  }

  /** Unread count shown as badge on the sidebar button. */
  get unreadCount(): number {
    return this.notifications.filter(n => !n.read).length;
  }

  get filteredNotifications(): AppNotification[] {
    let list = this.notifFilter === 'all'
      ? this.notifications
      : this.notifications.filter(n => n.type === this.notifFilter);
    const q = this.notifSearch.trim().toLowerCase();
    if (q) list = list.filter(n => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q));
    return list;
  }

  async markNotifRead(n: AppNotification) {
    if (n.read) return;
    n.read = true; // optimistic
    this.notificationsService.markRead(n.id).catch(() => { n.read = false; });
  }

  async markAllNotifsRead() {
    this.notifications.forEach(n => n.read = true);
    this.notificationsService.markAllRead(this.userEmail).catch(err =>
      console.error('[Dashboard] markAllRead failed:', err)
    );
  }

  async deleteNotif(n: AppNotification) {
    this.notifications = this.notifications.filter(x => x.id !== n.id);
    this.notificationsService.delete(n.id).catch(err =>
      console.error('[Dashboard] deleteNotif failed:', err)
    );
  }

  async clearAllNotifs() {
    const all = [...this.notifications];
    this.notifications = [];
    await Promise.all(all.map(n => this.notificationsService.delete(n.id).catch(() => {})));
  }

  /** Called after a share — creates a notification for the recipient. */
  private async createShareNotification(recipientEmail: string, event: CalendarEvent, isCategoryShare: boolean) {
    const label = isCategoryShare && event.category
      ? `${event.category} (${this.events.filter(e => e.category === event.category).length} events)`
      : event.title;
    try {
      const n = await this.notificationsService.create({
        recipientEmail,
        type: 'share',
        title: `${this.userEmail} shared "${label}" with you`,
        body: isCategoryShare
          ? `You now have access to all events in the "${event.category}" category.`
          : `${formatDate2(event.date)} · ${event.startTime}–${event.endTime}`,
        eventId: event.id,
        eventDate: event.date,
        senderEmail: this.userEmail,
        read: false,
      });
      // If the recipient is the current user (demo/testing), show it immediately
      if (recipientEmail === this.userEmail) {
        this.notifications = [n, ...this.notifications];
      }
    } catch (err) {
      console.warn('[Dashboard] Could not create share notification:', err);
    }
  }

  // ── Reminder modal ──────────────────────────────────────────────────────────

  openReminderModal(event: CalendarEvent) {
    this.reminderTargetEvent = event;
    this.reminderMinutes = 30;
    this.reminderSuccess = '';
    this.showReminderModal = true;
  }

  closeReminderModal() {
    this.showReminderModal = false;
    this.reminderTargetEvent = null;
  }

  async confirmReminder() {
    if (!this.reminderTargetEvent) return;
    const ev = this.reminderTargetEvent;

    // Persist reminder setting on the event
    const updated = { ...ev, reminderMinutes: this.reminderMinutes } as CalendarEvent & { reminderMinutes: number };
    this.events = this.events.map(e => e.id === ev.id ? { ...e } : e);
    this.eventsService.updateEvent(updated).catch(err =>
      console.error('[Dashboard] Failed to save reminder:', err)
    );

    // Create a local notification entry
    const label = this.reminderOptions.find(o => o.value === this.reminderMinutes)?.label ?? `${this.reminderMinutes} min before`;
    try {
      const n = await this.notificationsService.create({
        recipientEmail: this.userEmail,
        type: 'reminder',
        title: `Reminder: ${ev.title}`,
        body: `${label} — ${formatDate2(ev.date)} at ${ev.startTime}`,
        eventId: ev.id,
        eventDate: ev.date,
        senderEmail: this.userEmail,
        read: false,
      });
      this.notifications = [n, ...this.notifications];
    } catch (err) {
      console.warn('[Dashboard] Could not create reminder notification:', err);
    }

    this.reminderSuccess = `Reminder set: ${label}`;
    setTimeout(() => this.closeReminderModal(), 1400);
  }

  /** Check if any reminder notifications are due (within the next 24h) and mark them unread. */
  private checkDueReminders() {
    const now = Date.now();
    this.notifications.forEach(n => {
      if (n.type !== 'reminder' || n.read || !n.eventDate) return;
      const ev = this.events.find(e => e.id === n.eventId);
      if (!ev) return;
      const eventMs = new Date(`${ev.date}T${ev.startTime}:00`).getTime();
      if (eventMs - now <= 24 * 60 * 60 * 1000 && eventMs > now) {
        // Due within 24h — keep unread so it shows in badge
      }
    });
  }

  formatNotifTime(iso: string | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString(this.i18n.getLocale(), { month: 'short', day: 'numeric' })
      + ' · ' + d.toLocaleTimeString(this.i18n.getLocale(), { hour: 'numeric', minute: '2-digit' });
  }


  private loadHistory() {
    try {
      const raw = localStorage.getItem(this.historyKey);
      if (!raw) { this.history = []; return; }
      const parsed: HistoryEntry[] = JSON.parse(raw);
      const cutoff = Date.now() - this.HISTORY_TTL_DAYS * 24 * 60 * 60 * 1000;
      this.history = parsed.filter(h => h.timestamp >= cutoff);
      this.saveHistory();
    } catch {
      this.history = [];
    }
  }

  private saveHistory() {
    localStorage.setItem(this.historyKey, JSON.stringify(this.history));
  }

  private recordHistory(action: HistoryAction, snapshot: CalendarEvent, previousSnapshot?: CalendarEvent) {
    const entry: HistoryEntry = {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      action,
      timestamp: Date.now(),
      snapshot: { ...snapshot },
      previousSnapshot: previousSnapshot ? { ...previousSnapshot } : undefined,
    };
    this.history = [entry, ...this.history];
    this.saveHistory();
  }

  get filteredHistory(): HistoryEntry[] {
    let result = this.historyFilter === 'all'
      ? this.history
      : this.history.filter(h => h.action === this.historyFilter);
    const q = this.historySearch.trim().toLowerCase();
    if (q) {
      result = result.filter(h => h.snapshot.title.toLowerCase().includes(q));
    }
    return result;
  }

  restoreEvent(entry: HistoryEntry) {
    if (entry.action === 'deleted') {
      // Re-add the deleted event (give it a fresh id to avoid conflicts)
      const restored: CalendarEvent = { ...entry.snapshot, id: Date.now().toString() };
      this.events = [...this.events, restored].sort(
        (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)
      );
      this.recordHistory('added', restored);
      this.historyRestoreMsg = `"${restored.title}" has been restored.`;
    } else if (entry.action === 'changed' && entry.previousSnapshot) {
      // Revert to the before state
      const reverted = { ...entry.previousSnapshot };
      const exists = this.events.find(e => e.id === reverted.id);
      if (exists) {
        this.events = this.events.map(e => e.id === reverted.id ? reverted : e)
          .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
        this.recordHistory('changed', reverted, entry.snapshot);
        this.historyRestoreMsg = `"${reverted.title}" reverted to previous time.`;
      } else {
        // Event no longer exists — restore it
        this.events = [...this.events, reverted].sort(
          (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)
        );
        this.recordHistory('added', reverted);
        this.historyRestoreMsg = `"${reverted.title}" has been restored.`;
      }
    } else if (entry.action === 'added') {
      // Undo an add = delete it
      const ev = this.events.find(e => e.id === entry.snapshot.id);
      if (ev) {
        this.recordHistory('deleted', ev);
        this.events = this.events.filter(e => e.id !== ev.id);
        this.historyRestoreMsg = `"${ev.title}" has been removed (add undone).`;
      } else {
        this.historyRestoreMsg = 'Event no longer exists in your calendar.';
      }
    }
    setTimeout(() => this.historyRestoreMsg = '', 3500);
  }

  formatHistoryTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleDateString(this.i18n.getLocale(), { month: 'short', day: 'numeric', year: 'numeric' })
      + ' · ' + d.toLocaleTimeString(this.i18n.getLocale(), { hour: 'numeric', minute: '2-digit' });
  }

  historyActionLabel(action: HistoryAction): string {
    return action === 'added' ? this.i18n.t('added') : action === 'deleted' ? this.i18n.t('deleted') : this.i18n.t('changed');
  }

  historyActionColor(action: HistoryAction): string {
    return action === 'added' ? '#10b981' : action === 'deleted' ? '#ef4444' : '#f59e0b';
  }

  clearHistory() {
    this.history = [];
    this.saveHistory();
  }

  formatDate(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(this.i18n.getLocale(), { weekday: 'short', month: 'short', day: 'numeric' });
  }

  /** Check if an event occurs on a given date (including multi-day spans). */
  eventSpansDate(event: CalendarEvent, dateStr: string): boolean {
    if (event.date === dateStr) return true;
    if (event.endDate && event.endDate >= dateStr && event.date <= dateStr) return true;
    return false;
  }

  /** Get all events that occur on a specific date (including multi-day). */
  eventsForDate(dateStr: string): CalendarEvent[] {
    return this.events.filter(e => this.eventSpansDate(e, dateStr));
  }

  /** Format date range for display (handles multi-day events). */
  formatEventDateRange(event: CalendarEvent): string {
    if (event.endDate && event.endDate !== event.date) {
      return `${this.formatDate(event.date)} – ${this.formatDate(event.endDate)} · ${this.formatTime(event.startTime)} – ${this.formatTime(event.endTime)}`;
    }
    return `${this.formatDate(event.date)} · ${this.formatTime(event.startTime)} – ${this.formatTime(event.endTime)}`;
  }

  formatTime(t: string): string {
    const [h, m] = t.split(':').map(Number);
    const d = new Date(2000, 0, 1, h, m);
    return d.toLocaleTimeString(this.i18n.getLocale(), { hour: 'numeric', minute: '2-digit' });
  }

  encodeLocation(location: string): string {
    return encodeURIComponent(location);
  }

  getLocationMapsUrl(location: string): string {
    return `https://www.google.com/maps/search/${encodeURIComponent(location)}`;
  }

  /** Initialize Google Places Autocomplete on the location input. */
  private initLocationAutocomplete() {
    // Plain text input — no autocomplete API needed.
    // The location is linked to Google Maps via a simple URL when displayed.
  }

  get userInitial(): string {
    return this.userEmail ? this.userEmail[0].toUpperCase() : 'U';
  }
}
