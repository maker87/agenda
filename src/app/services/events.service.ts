import { Injectable } from '@angular/core';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../../amplify/data/resource';

export interface CalendarEvent {
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

interface PendingWrite {
  op: 'create' | 'update' | 'delete';
  event: CalendarEvent;
  ownerEmail: string;
}

// Lazy client — only instantiated on first use so a missing Amplify config
// does not crash the service at module load time.
let _client: ReturnType<typeof generateClient<Schema>> | null = null;
function getClient() {
  if (!_client) _client = generateClient<Schema>();
  return _client;
}

@Injectable({ providedIn: 'root' })
export class EventsService {

  private cacheKey(ownerEmail: string) { return `agenda_events_${ownerEmail}`; }
  private pendingKey(ownerEmail: string) { return `agenda_pending_${ownerEmail}`; }

  syncing = false;
  syncWarning: string | null = null;

  // ── localStorage helpers ──────────────────────────────────────────────────

  private readCache(ownerEmail: string): CalendarEvent[] {
    try {
      const raw = localStorage.getItem(this.cacheKey(ownerEmail));
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  private writeCache(ownerEmail: string, events: CalendarEvent[]) {
    try { localStorage.setItem(this.cacheKey(ownerEmail), JSON.stringify(events)); }
    catch (e) { console.warn('[EventsService] localStorage write failed:', e); }
  }

  private readPending(ownerEmail: string): PendingWrite[] {
    try {
      const raw = localStorage.getItem(this.pendingKey(ownerEmail));
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  private writePending(ownerEmail: string, queue: PendingWrite[]) {
    try { localStorage.setItem(this.pendingKey(ownerEmail), JSON.stringify(queue)); }
    catch (e) { console.warn('[EventsService] pending write failed:', e); }
  }

  private enqueuePending(ownerEmail: string, entry: PendingWrite) {
    const queue = this.readPending(ownerEmail);
    const filtered = queue.filter(p => !(p.event.id === entry.event.id && p.op === entry.op));
    filtered.push(entry);
    this.writePending(ownerEmail, filtered);
  }

  private sort(events: CalendarEvent[]): CalendarEvent[] {
    return [...events].sort(
      (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)
    );
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Directly add events to the localStorage cache without going through Amplify. */
  bulkAddToCache(events: CalendarEvent[], ownerEmail: string) {
    const cache = this.readCache(ownerEmail);
    const existingIds = new Set(cache.map(e => e.id));
    const toAdd = events.filter(e => !existingIds.has(e.id));
    if (toAdd.length) {
      this.writeCache(ownerEmail, this.sort([...cache, ...toAdd]));
    }
  }

  listEvents(
    ownerEmail: string,
    onSyncComplete?: (events: CalendarEvent[]) => void
  ): CalendarEvent[] {
    const cached = this.sort(this.readCache(ownerEmail));
    this.backgroundSync(ownerEmail, onSyncComplete);
    return cached;
  }

  async createEvent(
    event: Omit<CalendarEvent, 'id'>,
    ownerEmail: string
  ): Promise<CalendarEvent> {
    const tempId = `local_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const local: CalendarEvent = { id: tempId, ...event };

    // 1. Save to localStorage immediately
    const cache = this.readCache(ownerEmail);
    this.writeCache(ownerEmail, this.sort([...cache, local]));

    // 2. Try Amplify
    try {
      const { data, errors } = await getClient().models.CalendarEvent.create({
        title:       event.title,
        date:        event.date,
        startTime:   event.startTime,
        endTime:     event.endTime,
        description: event.description,
        color:       event.color,
        category:    event.category || undefined,
        sharedWith:  event.sharedWith?.length ? event.sharedWith : undefined,
        ownerEmail,
      });
      if (errors?.length) throw new Error(errors[0].message);
      const saved = this.toLocal(data!);
      // Re-read cache and either replace the temp entry or append the saved event
      const currentCache = this.readCache(ownerEmail);
      const hasTemp = currentCache.some(e => e.id === tempId);
      const updated = hasTemp
        ? currentCache.map(e => e.id === tempId ? saved : e)
        : [...currentCache, saved];
      this.writeCache(ownerEmail, this.sort(updated));
      this.syncWarning = null;
      return saved;
    } catch (err) {
      console.warn('[EventsService] createEvent offline, queued:', err);
      this.syncWarning = 'Working offline — changes will sync when connection is restored.';
      this.enqueuePending(ownerEmail, { op: 'create', event: local, ownerEmail });
      return local;
    }
  }

  async updateEvent(event: CalendarEvent, ownerEmail = ''): Promise<CalendarEvent> {
    const resolvedOwner = ownerEmail || this.ownerFromCache(event.id);
    const cache = this.readCache(resolvedOwner);
    this.writeCache(resolvedOwner, this.sort(cache.map(e => e.id === event.id ? event : e)));

    if (event.id.startsWith('local_')) {
      this.enqueuePending(resolvedOwner, { op: 'update', event, ownerEmail: resolvedOwner });
      return event;
    }

    try {
      const { data, errors } = await getClient().models.CalendarEvent.update({
        id:          event.id,
        title:       event.title,
        date:        event.date,
        startTime:   event.startTime,
        endTime:     event.endTime,
        description: event.description,
        color:       event.color,
        category:    event.category || undefined,
        sharedWith:  event.sharedWith?.length ? event.sharedWith : undefined,
      });
      if (errors?.length) throw new Error(errors[0].message);
      const saved = this.toLocal(data!);
      const refreshed = this.readCache(resolvedOwner).map(e => e.id === saved.id ? saved : e);
      this.writeCache(resolvedOwner, this.sort(refreshed));
      this.syncWarning = null;
      return saved;
    } catch (err) {
      console.warn('[EventsService] updateEvent offline, queued:', err);
      this.syncWarning = 'Working offline — changes will sync when connection is restored.';
      this.enqueuePending(resolvedOwner, { op: 'update', event, ownerEmail: resolvedOwner });
      return event;
    }
  }

  async deleteEvent(id: string, ownerEmail = ''): Promise<void> {
    const resolvedOwner = ownerEmail || this.ownerFromCache(id);
    this.writeCache(resolvedOwner, this.readCache(resolvedOwner).filter(e => e.id !== id));

    if (id.startsWith('local_')) {
      this.writePending(resolvedOwner, this.readPending(resolvedOwner).filter(p => p.event.id !== id));
      return;
    }

    try {
      const { errors } = await getClient().models.CalendarEvent.delete({ id });
      if (errors?.length) throw new Error(errors[0].message);
      this.syncWarning = null;
    } catch (err) {
      console.warn('[EventsService] deleteEvent offline, queued:', err);
      this.syncWarning = 'Working offline — changes will sync when connection is restored.';
      const deleted = this.readCache(resolvedOwner).find(e => e.id === id)
        ?? { id, title: '', date: '', startTime: '', endTime: '', description: '', color: '', category: '', sharedWith: [] };
      this.enqueuePending(resolvedOwner, { op: 'delete', event: deleted, ownerEmail: resolvedOwner });
    }
  }

  async seedEvents(events: Omit<CalendarEvent, 'id'>[], ownerEmail: string): Promise<CalendarEvent[]> {
    const locals: CalendarEvent[] = events.map(e => ({
      id: `local_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      ...e,
    }));
    this.writeCache(ownerEmail, this.sort(locals));

    const CHUNK = 10;
    const results: CalendarEvent[] = [...locals];
    (async () => {
      for (let i = 0; i < events.length; i += CHUNK) {
        try {
          const saved = await Promise.all(events.slice(i, i + CHUNK).map(e => this.createEvent(e, ownerEmail)));
          saved.forEach((s, idx) => { results[i + idx] = s; });
        } catch (err) { console.warn('[EventsService] seedEvents chunk failed:', err); }
      }
      this.writeCache(ownerEmail, this.sort(results));
    })();

    return this.sort(locals);
  }

  // ── Background sync ───────────────────────────────────────────────────────

  private async backgroundSync(ownerEmail: string, onSyncComplete?: (events: CalendarEvent[]) => void) {
    if (this.syncing) return;
    this.syncing = true;
    try {
      await this.flushPending(ownerEmail);
      const { data, errors } = await getClient().models.CalendarEvent.list({
        filter: { ownerEmail: { eq: ownerEmail } },
      });
      if (errors?.length) throw new Error(errors[0].message);
      const remote = (data ?? []).map(this.toLocal);
      const cache = this.readCache(ownerEmail);
      const localOnly = cache.filter(e => e.id.startsWith('local_') && !remote.find(r => r.id === e.id));
      const merged = this.sort([...remote, ...localOnly]);
      this.writeCache(ownerEmail, merged);
      this.syncWarning = null;
      if (onSyncComplete) onSyncComplete(merged);
    } catch (err) {
      console.warn('[EventsService] backgroundSync failed:', err);
      this.syncWarning = 'Working offline — changes will sync when connection is restored.';
      if (onSyncComplete) onSyncComplete(this.sort(this.readCache(ownerEmail)));
    } finally {
      this.syncing = false;
    }
  }

  private async flushPending(ownerEmail: string) {
    const queue = this.readPending(ownerEmail);
    if (!queue.length) return;
    const remaining: PendingWrite[] = [];
    for (const entry of queue) {
      try {
        if (entry.op === 'create') {
          const { data, errors } = await getClient().models.CalendarEvent.create({
            title: entry.event.title, date: entry.event.date,
            startTime: entry.event.startTime, endTime: entry.event.endTime,
            description: entry.event.description, color: entry.event.color,
            category: entry.event.category || undefined,
            sharedWith: entry.event.sharedWith?.length ? entry.event.sharedWith : undefined,
            ownerEmail: entry.ownerEmail,
          });
          if (errors?.length) throw new Error(errors[0].message);
          const saved = this.toLocal(data!);
          const cache = this.readCache(ownerEmail).map(e => e.id === entry.event.id ? saved : e);
          this.writeCache(ownerEmail, cache);
        } else if (entry.op === 'update' && !entry.event.id.startsWith('local_')) {
          const { errors } = await getClient().models.CalendarEvent.update({
            id: entry.event.id, title: entry.event.title, date: entry.event.date,
            startTime: entry.event.startTime, endTime: entry.event.endTime,
            description: entry.event.description, color: entry.event.color,
            category: entry.event.category || undefined,
            sharedWith: entry.event.sharedWith?.length ? entry.event.sharedWith : undefined,
          });
          if (errors?.length) throw new Error(errors[0].message);
        } else if (entry.op === 'delete' && !entry.event.id.startsWith('local_')) {
          const { errors } = await getClient().models.CalendarEvent.delete({ id: entry.event.id });
          if (errors?.length) throw new Error(errors[0].message);
        }
      } catch (err) {
        console.warn('[EventsService] flushPending entry failed:', err);
        remaining.push(entry);
      }
    }
    this.writePending(ownerEmail, remaining);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private ownerFromCache(id: string): string {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) ?? '';
        if (!key.startsWith('agenda_events_')) continue;
        const events: CalendarEvent[] = JSON.parse(localStorage.getItem(key) ?? '[]');
        if (events.find(e => e.id === id)) return key.replace('agenda_events_', '');
      }
    } catch { /* ignore */ }
    return '';
  }

  private toLocal(record: Schema['CalendarEvent']['type']): CalendarEvent {
    return {
      id:          record.id,
      title:       record.title ?? '',
      date:        record.date ?? '',
      startTime:   record.startTime ?? '',
      endTime:     record.endTime ?? '',
      description: record.description ?? '',
      color:       record.color ?? '#6c63ff',
      category:    record.category ?? '',
      sharedWith:  (record.sharedWith ?? []).filter((e): e is string => e !== null),
    };
  }
}
