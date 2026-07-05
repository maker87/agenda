


import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

export interface GCalEvent {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  description: string;
  color: string;
}

export interface GCalCalendar {
  id: string;
  name: string;
  color: string;       // background color from Google
  primary: boolean;
  selected: boolean;   // user's checkbox state in the picker
}

const GCAL_COLORS: Record<string, string> = {
  '1': '#a4bdfc', '2': '#7ae7bf', '3': '#dbadff', '4': '#ff887c',
  '5': '#fbd75b', '6': '#ffb878', '7': '#46d6db', '8': '#e1e1e1',
  '9': '#5484ed', '10': '#51b749', '11': '#dc2127',
};

const CLIENT_ID = environment.googleCalendarClientId;
const SCOPES    = 'https://www.googleapis.com/auth/calendar.readonly';
const TOKEN_KEY = 'agenda_gcal_token';

declare const google: any;

@Injectable({ providedIn: 'root' })
export class GoogleCalendarService {

  // In-memory token store — not persisted to localStorage to prevent XSS theft
  private _cachedToken: { token: string; expiry: number } | null = null;

  get isLinked(): boolean { return !!this.loadStoredToken(); }

  // ── Auth ──────────────────────────────────────────────────────────────────

  authorize(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.waitForGIS()
        .then(() => {
          const client = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: (resp: any) => {
              if (resp.error) { reject(new Error(resp.error_description ?? resp.error)); return; }
              const expiry = Date.now() + (Number(resp.expires_in) - 60) * 1000;
              // Store token in memory only — sessionStorage as fallback for same-tab persistence
              this._cachedToken = { token: resp.access_token, expiry };
              sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token: resp.access_token, expiry }));
              resolve(resp.access_token);
            },
          });
          client.requestAccessToken({ prompt: 'consent' });
        })
        .catch(reject);
    });
  }

  revoke() {
    const stored = this.loadStoredToken();
    if (stored && typeof google !== 'undefined') google.accounts.oauth2.revoke(stored, () => {});
    this._cachedToken = null;
    sessionStorage.removeItem(TOKEN_KEY);
  }

  // ── Calendar list ─────────────────────────────────────────────────────────

  /** Fetch all calendars the user has access to. */
  async listCalendars(): Promise<GCalCalendar[]> {
    const token = this.requireToken();
    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      if (res.status === 401) {
        this._cachedToken = null;
        sessionStorage.removeItem(TOKEN_KEY);
      }
      throw new Error(`Google Calendar API ${res.status}: ${res.statusText}`);
    }
    const data = await res.json();
    return (data.items ?? []).map((c: any): GCalCalendar => ({
      id:       c.id,
      name:     c.summary ?? c.id,
      color:    c.backgroundColor ?? '#6c63ff',
      primary:  !!c.primary,
      selected: !!c.selected,   // Google's own "selected" flag (shown in sidebar)
    }));
  }

  // ── Fetch events from one or more calendars ───────────────────────────────

  async fetchEventsFromCalendars(calendarIds: string[], futureOnly = false): Promise<GCalEvent[]> {
    const token = this.requireToken();
    const now  = new Date();
    const tMin = futureOnly
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      : new Date(now.getFullYear() - 1, 0, 1).toISOString();
    const tMax = new Date(now.getFullYear() + 2, 0, 1).toISOString();

    const allEvents: GCalEvent[] = [];

    for (const calId of calendarIds) {
      const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`
      );
      url.searchParams.set('timeMin', tMin);
      url.searchParams.set('timeMax', tMax);
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('orderBy', 'startTime');
      url.searchParams.set('maxResults', '2500');

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        console.warn(`[GCal] Could not fetch calendar ${calId}: ${res.status}`);
        continue;
      }

      const data = await res.json();
      const events = (data.items ?? [])
        .map((item: any) => this.toLocal(item))
        .filter((e: GCalEvent | null): e is GCalEvent => e !== null);

      allEvents.push(...events);
      console.log(`[GCal] Calendar "${calId}": ${events.length} events`);
    }

    return allEvents;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private requireToken(): string {
    const t = this.loadStoredToken();
    if (!t) throw new Error('No access token — please re-link Google Calendar.');
    return t;
  }

  private loadStoredToken(): string | null {
    // Check in-memory cache first
    if (this._cachedToken && Date.now() < this._cachedToken.expiry) {
      return this._cachedToken.token;
    }
    this._cachedToken = null;

    // Fallback to sessionStorage (same-tab only, not vulnerable to cross-tab XSS)
    try {
      const raw = sessionStorage.getItem(TOKEN_KEY);
      if (!raw) return null;
      const { token, expiry } = JSON.parse(raw);
      if (Date.now() < expiry) {
        this._cachedToken = { token, expiry };
        return token;
      }
      sessionStorage.removeItem(TOKEN_KEY);
      return null;
    } catch { return null; }
  }

  private waitForGIS(timeoutMs = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        if (typeof google !== 'undefined' && google?.accounts?.oauth2) { resolve(); }
        else if (Date.now() - start > timeoutMs) { reject(new Error('Google Identity Services did not load.')); }
        else { setTimeout(check, 100); }
      };
      check();
    });
  }

  private toLocal(item: any): GCalEvent | null {
    if (item.status === 'cancelled') return null;
    const title       = item.summary ?? '(No title)';
    const description = item.description ?? '';
    const color       = GCAL_COLORS[item.colorId ?? ''] ?? '#6c63ff';
    const startRaw    = item.start?.dateTime ?? item.start?.date ?? '';
    const endRaw      = item.end?.dateTime   ?? item.end?.date   ?? '';
    if (!startRaw) return null;

    if (!item.start?.dateTime) {
      return { id: `gcal_${item.id}`, title, date: startRaw, startTime: '00:00', endTime: '23:59', description, color };
    }
    const s = new Date(startRaw);
    const e = new Date(endRaw || startRaw);
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
      id: `gcal_${item.id}`, title, description, color,
      date:      `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`,
      startTime: `${pad(s.getHours())}:${pad(s.getMinutes())}`,
      endTime:   `${pad(e.getHours())}:${pad(e.getMinutes())}`,
    };
  }
}
