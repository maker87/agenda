import { Component, OnInit, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MockAuthService, UserProfile } from '../services/mock-auth.service';
import { EventsService } from '../services/events.service';
import { CategoryCountPipe } from '../pipes/category-count.pipe';
import { NotificationsService, AppNotification } from '../services/notifications.service';
import { CategoryTreeService, CategoryNode, CATEGORY_SEP } from '../services/category-tree.service';
import { GoogleCalendarService, GCalEvent, GCalCalendar } from '../services/google-calendar.service';
import { AiSchedulerService, AiSuggestion } from '../services/ai-scheduler.service';
import { AiChatService, ChatMessage, EventDraft, getProactiveReminders } from '../services/ai-chat.service';
import { I18nService } from '../services/i18n.service';

interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  description: string;
  color: string;
  category: string;
  sharedWith: string[];
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
  startTime: string;
  endTime: string;
  description: string;
  category: string;
  sharedWith: string[];  // emails to share with at creation time
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
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
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
  imports: [CommonModule, FormsModule, CategoryCountPipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent implements OnInit, AfterViewInit {
  userEmail = '';

  // ── Profile panel ──
  profile: UserProfile = { email: '', username: '', avatarUrl: null, language: 'en' };

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
    this.profileDeleteConfirm = false;
    this.profileDeletePassword = '';
    this.profileDeleteError = '';
    this.showAnimalPicker = false;
    this.activeTab = 'profile';
  }

  saveUsername() {
    this.profileUsernameMsg = '';
    this.profileUsernameError = '';
    const name = this.profileUsernameInput.trim();
    if (!name) { this.profileUsernameError = 'Username cannot be empty.'; return; }
    if (name.length < 3) { this.profileUsernameError = 'Username must be at least 3 characters.'; return; }
    this.profile.username = name;
    this.mockAuth.saveProfile(this.profile);
    this.profileUsernameMsg = 'Username updated.';
    setTimeout(() => { this.profileUsernameMsg = ''; }, 3000);
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
      this.profile.avatarUrl = result;
      this.mockAuth.saveProfile(this.profile);
      this.profileAvatarMsg = 'Avatar updated.';
      setTimeout(() => { this.profileAvatarMsg = ''; }, 3000);
    };
    reader.readAsDataURL(file);
  }

  removeAvatar() {
    this.profileAvatarPreview = null;
    this.profile.avatarUrl = null;
    this.mockAuth.saveProfile(this.profile);
    this.profileAvatarMsg = 'Avatar removed.';
    this.showAnimalPicker = false;
    setTimeout(() => { this.profileAvatarMsg = ''; }, 3000);
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
    this.profile.avatarUrl = dataUrl;
    this.mockAuth.saveProfile(this.profile);
    this.profileAvatarMsg = 'Avatar updated.';
    this.showAnimalPicker = false;
    setTimeout(() => { this.profileAvatarMsg = ''; }, 3000);
  }

  saveLanguage() {
    this.profile.language = this.profileLanguage;
    this.mockAuth.saveProfile(this.profile);
    this.i18n.setLanguage(this.profileLanguage);
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
  gcalImportCount = 0;
  activeTab: 'schedule' | 'agenda' | 'calendar' | 'history' | 'notifications' | 'categories' | 'profile' = 'schedule';

  // ── History ──
  private readonly HISTORY_KEY = 'agenda_event_history';
  private readonly HISTORY_TTL_DAYS = 7;
  history: HistoryEntry[] = [];
  historyFilter: 'all' | HistoryAction = 'all';
  historySearch = '';
  historyRestoreMsg = '';
  showScheduleModal = false;

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

    // Simulate a brief typing delay for a natural feel
    this.chatTyping = true;
    setTimeout(() => {
      const { message, draft } = this.aiChatService.reply(text, this.events, this.userEmail, this.chatEventDraft);
      this.chatMessages = [...this.chatMessages, message];
      this.chatEventDraft = draft;
      this.chatTyping = false;
      this.scrollChatToBottom();
      // Auto-fire confirm_create_event if the AI returned it directly (user said "yes")
      if (message.actions?.length && message.actions[0].type === 'confirm_create_event') {
        this.createEventFromChat(message.actions[0].payload);
      }
    }, 400 + Math.random() * 300);
  }

  handleChatAction(action: { label: string; type: string; tab?: string; reminderTitle?: string; reminderBody?: string; copyText?: string; payload?: any; slotIndex?: number }) {
    if (action.type === 'navigate' && action.tab) {
      this.switchTab(action.tab as any);
      this.showFloatingChat = false;
    }
    if (action.type === 'create_reminder' && action.reminderTitle) {
      this.createAiReminder(action.reminderTitle, action.reminderBody ?? '');
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
        const { dayOfWeek, weeks } = payload._recurring;
        const todayStr = new Date().toISOString().split('T')[0];
        const created: any[] = [];

        // Find the next occurrence of the target day
        const startDate = new Date(todayStr + 'T00:00:00');
        while (startDate.getDay() !== dayOfWeek) {
          startDate.setDate(startDate.getDate() + 1);
        }

        // Create one event per week
        for (let w = 0; w < weeks; w++) {
          const date = new Date(startDate);
          date.setDate(date.getDate() + w * 7);
          const dateStr = date.toISOString().split('T')[0];

          const evt = await this.eventsService.createEvent({
            title:       payload.title,
            date:        dateStr,
            startTime:   payload.startTime,
            endTime:     payload.endTime,
            description: payload.description ?? '',
            color:       payload.color ?? '#6c63ff',
            category:    payload.category ?? '',
            sharedWith:  payload.sharedWith ?? [],
          }, this.userEmail);
          created.push(evt);
        }

        // Refresh events
        this.events = this.eventsService.listEvents(this.userEmail, (synced) => {
          this.events = synced;
        });

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

        // Refresh the events list
        this.events = this.eventsService.listEvents(this.userEmail, (synced) => {
          this.events = synced;
        });

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
  notifFilter: 'all' | 'share' | 'reminder' = 'all';
  notifSearch = '';

  // ── Notifications sub-tab ──
  notifSubTab: 'notifications' | 'friends' | 'share' = 'notifications';

  // ── Add Friend ──
  friendSearch = '';
  friendSearchResults: { username: string; displayName: string; mutual: number }[] = [];
  friends: { username: string; displayName: string; mutual: number }[] = [];
  friendRequestsSent: Set<string> = new Set();
  friendSearchLoading = false;

  // Mock user pool for demo
  private readonly MOCK_USERS = [
    { username: 'alex_j',      displayName: 'Alex Johnson',    mutual: 3 },
    { username: 'priya_s',     displayName: 'Priya Sharma',    mutual: 1 },
    { username: 'marcus_t',    displayName: 'Marcus Thompson', mutual: 5 },
    { username: 'lisa_m',      displayName: 'Lisa Martinez',   mutual: 0 },
    { username: 'derek_w',     displayName: 'Derek Williams',  mutual: 2 },
    { username: 'sarah_k',     displayName: 'Sarah Kim',       mutual: 4 },
    { username: 'tom_r',       displayName: 'Tom Rivera',      mutual: 1 },
    { username: 'nina_p',      displayName: 'Nina Patel',      mutual: 6 },
    { username: 'james_o',     displayName: 'James O\'Brien',  mutual: 0 },
    { username: 'chloe_b',     displayName: 'Chloe Bennett',   mutual: 2 },
  ];

  searchFriends() {
    const q = this.friendSearch.trim().toLowerCase();
    if (!q) { this.friendSearchResults = []; return; }
    this.friendSearchLoading = true;
    // Simulate async search
    setTimeout(() => {
      const friendUsernames = new Set(this.friends.map(f => f.username));
      this.friendSearchResults = this.MOCK_USERS.filter(u =>
        (u.username.includes(q) || u.displayName.toLowerCase().includes(q)) &&
        !friendUsernames.has(u.username)
      );
      this.friendSearchLoading = false;
    }, 300);
  }

  sendFriendRequest(username: string) {
    this.friendRequestsSent.add(username);
    // Find the mock user to get their display name / email
    const user = this.MOCK_USERS.find(u => u.username === username);
    // Simulate: the target user sends a friend request notification back to the current user (demo)
    const mockEmail = `${username}@demo.com`;
    const displayName = user?.displayName ?? username;
    const incomingNotif: AppNotification = {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      recipientEmail: this.userEmail,
      type: 'friend_request',
      title: `${displayName} wants to be your friend`,
      body: `From: ${mockEmail}`,
      eventId: username,        // reuse eventId to store sender username
      eventDate: '',
      senderEmail: mockEmail,
      read: false,
      createdAt: new Date().toISOString(),
      status: 'pending',
    };
    this.notifications = [incomingNotif, ...this.notifications];
  }

  acceptFriendRequest(user: { username: string; displayName: string; mutual: number }) {
    this.friends.push(user);
    this.friendRequestsSent.delete(user.username);
    this.friendSearchResults = this.friendSearchResults.filter(u => u.username !== user.username);
  }

  removeFriend(username: string) {
    this.friends = this.friends.filter(f => f.username !== username);
  }

  /** Accept an incoming friend-request notification. */
  acceptFriendNotif(n: AppNotification) {
    n.status = 'accepted';
    n.read = true;
    // Add to friends list if not already there
    const username = n.eventId; // stored in eventId
    const mockUser = this.MOCK_USERS.find(u => u.username === username);
    const alreadyFriend = this.friends.some(f => f.username === username);
    if (!alreadyFriend) {
      this.friends.push({
        username,
        displayName: mockUser?.displayName ?? username,
        mutual: mockUser?.mutual ?? 0,
      });
    }
    this.notificationsService.markRead(n.id).catch(() => {});
  }

  /** Reject an incoming friend-request notification. */
  rejectFriendNotif(n: AppNotification) {
    n.status = 'rejected';
    n.read = true;
    this.notificationsService.markRead(n.id).catch(() => {});
  }

  // ── Share sub-tab ──
  shareUsername = '';
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

    const username = this.shareUsername.trim();
    if (!username) {
      this.shareSubTabError = 'Please enter a username.';
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

    const recipientEmail = `${username}@demo.com`;
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
      const mockUser = this.MOCK_USERS.find(u => u.username === username);
      const displayName = mockUser?.displayName ?? username;
      const mockEmail = `${username}@demo.com`;
      const incomingNotif: AppNotification = {
        id: Date.now().toString() + Math.random().toString(36).slice(2),
        recipientEmail: this.userEmail,
        type: 'friend_request',
        title: `${displayName} wants to be your friend`,
        body: `From: ${mockEmail}`,
        eventId: username,
        eventDate: '',
        senderEmail: mockEmail,
        read: false,
        createdAt: new Date().toISOString(),
        status: 'pending',
      };
      this.notifications = [incomingNotif, ...this.notifications];
    }

    // Check if already sent
    const alreadySent = this.sentShareRequests.some(
      r => r.username === username && r.type === this.shareType &&
           (this.shareType !== 'category' && this.shareType !== 'subcategory' || r.label === label)
    );
    if (alreadySent) {
      this.shareSubTabError = `You already sent this share request to @${username}.`;
      return;
    }

    this.sentShareRequests = [{ username, type: this.shareType, label }, ...this.sentShareRequests];

    const typeLabel =
      this.shareType === 'friend'      ? 'Friend request' :
      this.shareType === 'calendar'    ? 'Calendar share' :
      this.shareType === 'category'    ? `Category "${label}" share` :
      this.shareType === 'subcategory' ? `Subcategory "${label}" share` :
                                         'Event share';
    this.shareSubTabSuccess = `${typeLabel} sent to @${username}.`;
    this.shareUsername = '';
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

  monthNames = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];
  dayLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // ── Calendar view state ──
  calendarView: 'year' | 'month' | 'week' | 'day' = 'year';

  // Month view: user can type a month name or number
  viewMonthInput = this.monthNames[new Date().getMonth()];
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
        label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        isToday: dateStr === this.today,
        events: this.events.filter(e => e.date === dateStr),
      });
    }
    return days;
  }

  // Day view
  viewDayInput = this.today;
  get viewDayEvents(): CalendarEvent[] {
    return this.events.filter(e => e.date === this.viewDayInput);
  }
  get viewDayLabel(): string {
    const d = new Date(this.viewDayInput + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
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
    return this.monthNames.map((name, monthIdx) => ({
      name,
      monthIdx,
      isCurrent: monthIdx === this.currentMonthIndex,
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
      cells.push({
        day: d,
        dateStr,
        isToday: dateStr === this.today,
        isPast: dateStr < this.today,
        events: this.events.filter((e) => e.date === dateStr),
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
    startTime: '09:00',
    endTime: '10:00',
    description: '',
    category: '',
    sharedWith: [],
  };

  events: CalendarEvent[] = [
    // ── Today ──
    { id: '1',  title: 'Morning Standup',        date: relDate(0),  startTime: '09:00', endTime: '09:30', description: 'Daily sync with the engineering team', color: '#6c63ff', category: 'Work', sharedWith: [] },
    { id: '2',  title: 'Design Review',           date: relDate(0),  startTime: '10:30', endTime: '11:30', description: 'Review new onboarding flow mockups', color: '#ec4899', category: 'Work', sharedWith: [] },
    { id: '3',  title: 'Lunch with Sarah',        date: relDate(0),  startTime: '12:30', endTime: '13:30', description: 'Catch up at The Rooftop Café', color: '#10b981', category: 'Personal', sharedWith: [] },
    { id: '4',  title: 'Product Roadmap Q3',      date: relDate(0),  startTime: '14:00', endTime: '15:00', description: 'Align on Q3 priorities with stakeholders', color: '#f59e0b', category: 'Work', sharedWith: [] },
    { id: '5',  title: 'Code Review Session',     date: relDate(0),  startTime: '15:30', endTime: '16:30', description: 'Review PRs for the auth module', color: '#3b82f6', category: 'Work', sharedWith: [] },
    { id: '6',  title: 'Team Happy Hour',         date: relDate(0),  startTime: '17:00', endTime: '18:30', description: 'End-of-week wind-down 🍻', color: '#ef4444', category: 'Social', sharedWith: [] },

    // ── Tomorrow ──
    { id: '7',  title: 'Investor Call',           date: relDate(1),  startTime: '09:00', endTime: '10:00', description: 'Series A update with Sequoia', color: '#6c63ff', category: 'Work', sharedWith: [] },
    { id: '8',  title: 'Sprint Planning',         date: relDate(1),  startTime: '10:30', endTime: '12:00', description: 'Plan sprint 24 tasks and story points', color: '#3b82f6', category: 'Work', sharedWith: [] },
    { id: '9',  title: 'UX Workshop',             date: relDate(1),  startTime: '13:00', endTime: '15:00', description: 'User journey mapping session', color: '#ec4899', category: 'Work', sharedWith: [] },
    { id: '10', title: 'Dentist Appointment',     date: relDate(1),  startTime: '16:00', endTime: '17:00', description: 'Annual check-up at City Dental', color: '#10b981', category: 'Personal', sharedWith: [] },

    // ── Day after tomorrow ──
    { id: '11', title: 'All-Hands Meeting',       date: relDate(2),  startTime: '10:00', endTime: '11:30', description: 'Company-wide Q2 results presentation', color: '#f59e0b', category: 'Work', sharedWith: [] },
    { id: '12', title: 'Backend Architecture',    date: relDate(2),  startTime: '13:00', endTime: '14:30', description: 'Discuss microservices migration plan', color: '#6c63ff', category: 'Work', sharedWith: [] },
    { id: '13', title: 'Yoga Class',              date: relDate(2),  startTime: '18:00', endTime: '19:00', description: 'Vinyasa flow at Studio Zen', color: '#10b981', category: 'Health', sharedWith: [] },

    // ── +3 days ──
    { id: '14', title: 'Client Demo',             date: relDate(3),  startTime: '11:00', endTime: '12:00', description: 'Live demo for Acme Corp', color: '#ef4444', category: 'Work', sharedWith: [] },
    { id: '15', title: 'Marketing Sync',          date: relDate(3),  startTime: '14:00', endTime: '15:00', description: 'Campaign performance review', color: '#ec4899', category: 'Work', sharedWith: [] },

    // ── +5 days ──
    { id: '16', title: 'Conference: Day 1',       date: relDate(5),  startTime: '09:00', endTime: '18:00', description: 'AngularConf 2026 — keynote & workshops', color: '#3b82f6', category: 'Conference', sharedWith: [] },
    { id: '17', title: 'Conference Dinner',       date: relDate(5),  startTime: '19:00', endTime: '21:00', description: 'Networking dinner at The Grand Hotel', color: '#6c63ff', category: 'Conference', sharedWith: [] },

    // ── +6 days ──
    { id: '18', title: 'Conference: Day 2',       date: relDate(6),  startTime: '09:00', endTime: '17:00', description: 'AngularConf 2026 — deep-dive sessions', color: '#3b82f6', category: 'Conference', sharedWith: [] },

    // ── +10 days ──
    { id: '19', title: 'Performance Reviews',     date: relDate(10), startTime: '10:00', endTime: '12:00', description: 'Mid-year 1:1 reviews with direct reports', color: '#f59e0b', category: 'Work', sharedWith: [] },
    { id: '20', title: 'Flight to NYC',           date: relDate(10), startTime: '15:00', endTime: '18:00', description: 'AA 204 — JFK arrival 6 PM', color: '#ef4444', category: 'Travel', sharedWith: [] },

    // ── +14 days ──
    { id: '21', title: 'Board Meeting',           date: relDate(14), startTime: '09:00', endTime: '12:00', description: 'Quarterly board review — NYC office', color: '#6c63ff', category: 'Work', sharedWith: [] },
    { id: '22', title: 'Team Offsite Kickoff',    date: relDate(14), startTime: '14:00', endTime: '17:00', description: 'Q3 planning offsite at Hudson Yards', color: '#10b981', category: 'Work', sharedWith: [] },

    // ── Past events ──
    { id: '23', title: 'Kickoff Meeting',         date: relDate(-1), startTime: '09:00', endTime: '10:00', description: 'Project kickoff for new dashboard', color: '#6c63ff', category: 'Work', sharedWith: [] },
    { id: '24', title: 'User Research Session',   date: relDate(-1), startTime: '14:00', endTime: '16:00', description: 'Interviews with 5 beta users', color: '#ec4899', category: 'Work', sharedWith: [] },
    { id: '25', title: 'Weekly Retrospective',    date: relDate(-3), startTime: '16:00', endTime: '17:00', description: 'Sprint 23 retro', color: '#3b82f6', category: 'Work', sharedWith: [] },
    { id: '26', title: 'Onboarding: New Hire',    date: relDate(-5), startTime: '10:00', endTime: '12:00', description: 'Welcome Alex to the team', color: '#10b981', category: 'Work', sharedWith: [] },
    { id: '27', title: 'Quarterly OKR Review',    date: relDate(-7), startTime: '13:00', endTime: '15:00', description: 'Q1 OKR scoring and Q2 goal setting', color: '#f59e0b', category: 'Work', sharedWith: [] },
  ].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

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

  // ── Category & sharing state ──
  activeCategoryFilter = ''; // '' = show all
  showShareModal = false;
  shareTargetEvent: CalendarEvent | null = null;
  shareEmail = '';
  shareCategoryOnly = false; // true = share whole category, false = single event
  shareSuccess = '';
  shareError = '';

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
  private readonly CATEGORIES_KEY = 'agenda_saved_categories';

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
    private categoryTreeService: CategoryTreeService,
    private googleCalendarService: GoogleCalendarService,
    private aiScheduler: AiSchedulerService,
    private aiChatService: AiChatService,
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
    this.googleCalendarLinked = this.googleCalendarService.isLinked;
    this.loadHistory();
    this.loadSavedCategories();
    await this.loadEventsFromDb(user.email);
    this.loadNotifications(user.email);
  }

  ngAfterViewInit() {
    // Scroll to current month when calendar tab is first opened
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
      this.events = synced;
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
      // Step 2 — nothing in cache yet: seed defaults then let sync take over
      const seedData = email === 'alex.student@school.edu'
        ? buildStudentEvents().map(({ id: _id, ...rest }) => rest)
        : email === 'jordan.coach@fitlife.com'
        ? buildCoachEvents().map(({ id: _id, ...rest }) => rest)
        : this.events.map(({ id: _id, ...rest }) => rest);

      if (seedData.length > 0) {
        // seedEvents writes to localStorage first, then pushes to Amplify in background
        this.events = await this.eventsService.seedEvents(seedData, email);
      }
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
    const todayEvents = this.events.filter(e => e.date === todayStr);
    const upcomingEvents = this.events.filter(e => e.date > todayStr);

    // Build the always-present greeting line
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const name = this.profile?.username || this.userEmail.split('@')[0];

    const items: { title: string; body: string }[] = [];

    // 1. Greeting + today summary
    if (todayEvents.length === 0) {
      items.push({
        title: `${greeting}, ${name}!`,
        body: `You have nothing scheduled today — enjoy the free day.`,
      });
    } else {
      const first = todayEvents[0];
      items.push({
        title: `${greeting}, ${name}!`,
        body: `You have ${todayEvents.length} event${todayEvents.length !== 1 ? 's' : ''} today. First up: ${first.title} at ${this.formatTime(first.startTime)}.`,
      });
    }

    // 2. Next upcoming event (if not today)
    const nextUp = upcomingEvents.sort((a, b) => a.date.localeCompare(b.date))[0];
    if (nextUp) {
      const daysUntil = Math.ceil(
        (new Date(nextUp.date + 'T00:00:00').getTime() - new Date(todayStr + 'T00:00:00').getTime())
        / (1000 * 60 * 60 * 24)
      );
      const when = daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;
      items.push({
        title: `Coming up ${when}`,
        body: `${nextUp.title} on ${this.formatDate(nextUp.date)} at ${this.formatTime(nextUp.startTime)}.`,
      });
    }

    // 3. AI prep reminders (if any)
    for (const r of reminders) {
      items.push({ title: r.title, body: r.body });
    }

    this.loginBannerItems = items;
    this.showLoginBanner = true;

    // Auto-dismiss after 12 seconds
    if (this.loginBannerTimer) clearTimeout(this.loginBannerTimer);
    this.loginBannerTimer = setTimeout(() => { this.showLoginBanner = false; }, 12000);
  }

  scrollToYearMonth(idx: number) {
    setTimeout(() => {
      const el = document.getElementById('year-month-' + idx);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }

  switchTab(tab: 'schedule' | 'agenda' | 'calendar' | 'history' | 'notifications' | 'categories' | 'profile') {
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
  }

  logout() {
    this.mockAuth.logout();
    this.router.navigate(['/']);
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
    const selectedIds = this.gcalCalendars.filter(c => c.selected).map(c => c.id);
    if (selectedIds.length === 0) {
      this.googleSyncError = 'Please select at least one calendar.';
      return;
    }

    this.gcalImporting = true;
    this.googleSyncError = '';

    try {
      const gcalEvents = await this.googleCalendarService.fetchEventsFromCalendars(selectedIds);

      // Merge: skip any event whose gcal id is already in our list
      const existingIds = new Set(this.events.map(e => e.id));
      const toAdd = gcalEvents.filter(g => !existingIds.has(g.id));

      if (toAdd.length === 0) {
        this.googleCalendarLinked = true;
        this.showGcalPicker = false;
        console.log('[Google Calendar] No new events to import.');
        return;
      }

      // Convert to CalendarEvent and write directly to localStorage + this.events
      const newEvents: CalendarEvent[] = toAdd.map(g => ({
        id:          `local_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        title:       g.title,
        date:        g.date,
        startTime:   g.startTime,
        endTime:     g.endTime,
        description: g.description,
        color:       g.color,
        category:    'Google Calendar',
        sharedWith:  [],
      }));

      this.eventsService.bulkAddToCache(newEvents, this.userEmail);

      this.events = [...this.events, ...newEvents].sort(
        (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)
      );

      this.googleCalendarLinked = true;
      this.showGcalPicker = false;
      this.googleSyncError = '';
      console.log(`[Google Calendar] Imported ${toAdd.length} events.`);
    } catch (err: any) {
      console.error('[Google Calendar] Fetch failed:', err);
      this.googleSyncError = 'Could not fetch events. Please try again.';
    } finally {
      this.gcalImporting = false;
    }
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
  notifPanelFilter: 'all' | 'share' | 'reminder' = 'all';

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
      startTime: '09:00',
      endTime: '10:00',
      description: '',
      category: this.activeCategoryFilter || '',
      sharedWith: [],
    };
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
      category: this.form.category.trim(),
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
      this.overlapTimeStart = '09:00';
      this.overlapTimeEnd = '10:00';
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
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  get dayPanelEvents(): CalendarEvent[] {
    return this.events.filter(e => e.date === this.dayPanelDate);
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
      startTime: '09:00',
      endTime: '10:00',
      description: '',
      category: this.activeCategoryFilter || '',
      sharedWith: [],
    };
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

  openDeleteModal() {
    this.searchQuery = '';
    this.searchResults = [];
    this.selectedEventId = '';
    this.deleteError = '';
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
    this.events = this.events.map(e =>
      e.id === this.selectedEventId
        ? { ...e, date: this.changeForm.date, startTime: this.changeForm.startTime, endTime: this.changeForm.endTime, category: this.changeForm.category }
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
    return this.filteredEvents.filter((e) => e.date === this.today);
  }

  get upcomingEvents() {
    const weekAhead = new Date();
    weekAhead.setDate(weekAhead.getDate() + 7);
    const weekAheadStr = weekAhead.toISOString().split('T')[0];
    return this.filteredEvents.filter((e) => e.date > this.today && e.date <= weekAheadStr);
  }

  get pastEvents() {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString().split('T')[0];
    return this.filteredEvents.filter((e) => e.date < this.today && e.date >= weekAgoStr);
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
    if (!this.activeCategoryFilter) return this.events;
    return this.events.filter(e =>
      this.categoryTreeService.isUnderPath(e.category, this.activeCategoryFilter)
    );
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
    this.showShareModal = true;
  }

  closeShareModal() {
    this.showShareModal = false;
    this.shareTargetEvent = null;
  }

  async confirmShare() {
    this.shareError = '';
    this.shareSuccess = '';
    const email = this.shareEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      this.shareError = 'Please enter a valid email address.';
      return;
    }
    if (!this.shareTargetEvent) return;

    const targets: CalendarEvent[] = this.shareCategoryOnly && this.shareTargetEvent.category
      ? this.events.filter(e => e.category === this.shareTargetEvent!.category)
      : [this.shareTargetEvent];

    // Optimistic update
    this.events = this.events.map(e => {
      if (targets.find(t => t.id === e.id)) {
        const already = e.sharedWith.includes(email);
        return already ? e : { ...e, sharedWith: [...e.sharedWith, email] };
      }
      return e;
    });

    // Persist each updated event to DB
    const updated = this.events.filter(e => targets.find(t => t.id === e.id));
    for (const ev of updated) {
      this.eventsService.updateEvent(ev).catch(err =>
        console.error('[Dashboard] Failed to persist share:', err)
      );
    }

    const label = this.shareCategoryOnly && this.shareTargetEvent.category
      ? `all "${this.shareTargetEvent.category}" events (${targets.length})`
      : `"${this.shareTargetEvent.title}"`;
    this.shareSuccess = `Shared ${label} with ${email}.`;
    this.shareEmail = '';

    // Create a notification for the recipient
    this.createShareNotification(email, this.shareTargetEvent, this.shareCategoryOnly);

    setTimeout(() => this.closeShareModal(), 1800);
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

  // ── Notifications ──────────────────────────────────────────────────────────

  private async loadNotifications(email: string) {
    try {
      this.notifications = await this.notificationsService.listForUser(email);
      this.checkDueReminders();
    } catch (err) {
      // Fallback: keep empty array, no crash
      console.warn('[Dashboard] Could not load notifications:', err);
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
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }


  private loadHistory() {
    try {
      const raw = localStorage.getItem(this.HISTORY_KEY);
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
    localStorage.setItem(this.HISTORY_KEY, JSON.stringify(this.history));
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
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  historyActionLabel(action: HistoryAction): string {
    return action === 'added' ? 'Added' : action === 'deleted' ? 'Deleted' : 'Changed';
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
