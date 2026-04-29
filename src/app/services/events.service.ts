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
}

// Amplify client — typed against our schema
const client = generateClient<Schema>();

@Injectable({ providedIn: 'root' })
export class EventsService {
  // ── Read ──────────────────────────────────────────────────────────────────

  /** Fetch all events for a given owner email, sorted by date then startTime. */
  async listEvents(ownerEmail: string): Promise<CalendarEvent[]> {
    const { data, errors } = await client.models.CalendarEvent.list({
      filter: { ownerEmail: { eq: ownerEmail } },
    });

    if (errors?.length) {
      console.error('[EventsService] listEvents errors:', errors);
      throw new Error(errors[0].message);
    }

    return (data ?? [])
      .map(this.toLocal)
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async createEvent(event: Omit<CalendarEvent, 'id'>, ownerEmail: string): Promise<CalendarEvent> {
    const { data, errors } = await client.models.CalendarEvent.create({
      title:       event.title,
      date:        event.date,
      startTime:   event.startTime,
      endTime:     event.endTime,
      description: event.description,
      color:       event.color,
      ownerEmail,
    });

    if (errors?.length) {
      console.error('[EventsService] createEvent errors:', errors);
      throw new Error(errors[0].message);
    }

    return this.toLocal(data!);
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async updateEvent(event: CalendarEvent): Promise<CalendarEvent> {
    const { data, errors } = await client.models.CalendarEvent.update({
      id:          event.id,
      title:       event.title,
      date:        event.date,
      startTime:   event.startTime,
      endTime:     event.endTime,
      description: event.description,
      color:       event.color,
    });

    if (errors?.length) {
      console.error('[EventsService] updateEvent errors:', errors);
      throw new Error(errors[0].message);
    }

    return this.toLocal(data!);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async deleteEvent(id: string): Promise<void> {
    const { errors } = await client.models.CalendarEvent.delete({ id });

    if (errors?.length) {
      console.error('[EventsService] deleteEvent errors:', errors);
      throw new Error(errors[0].message);
    }
  }

  // ── Bulk seed (used for the student account's initial data) ───────────────

  /**
   * Writes a batch of events to the database.
   * Fires requests in parallel chunks of 10 to avoid overwhelming the API.
   */
  async seedEvents(events: Omit<CalendarEvent, 'id'>[], ownerEmail: string): Promise<CalendarEvent[]> {
    const CHUNK = 10;
    const results: CalendarEvent[] = [];

    for (let i = 0; i < events.length; i += CHUNK) {
      const chunk = events.slice(i, i + CHUNK);
      const created = await Promise.all(chunk.map(e => this.createEvent(e, ownerEmail)));
      results.push(...created);
    }

    return results.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private toLocal(record: Schema['CalendarEvent']['type']): CalendarEvent {
    return {
      id:          record.id,
      title:       record.title ?? '',
      date:        record.date ?? '',
      startTime:   record.startTime ?? '',
      endTime:     record.endTime ?? '',
      description: record.description ?? '',
      color:       record.color ?? '#6c63ff',
    };
  }
}
