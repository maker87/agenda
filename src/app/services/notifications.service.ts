import { Injectable } from '@angular/core';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../../amplify/data/resource';

export interface AppNotification {
  id: string;
  recipientEmail: string;
  type: 'share' | 'reminder';
  title: string;
  body: string;
  eventId: string;
  eventDate: string;
  senderEmail: string;
  read: boolean;
  createdAt?: string; // ISO timestamp from DynamoDB
}

const client = generateClient<Schema>();

@Injectable({ providedIn: 'root' })
export class NotificationsService {

  async listForUser(email: string): Promise<AppNotification[]> {
    const { data, errors } = await client.models.Notification.list({
      filter: { recipientEmail: { eq: email } },
    });
    if (errors?.length) throw new Error(errors[0].message);
    return (data ?? [])
      .map(this.toLocal)
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  }

  async create(n: Omit<AppNotification, 'id' | 'createdAt'>): Promise<AppNotification> {
    const { data, errors } = await client.models.Notification.create({
      recipientEmail: n.recipientEmail,
      type:           n.type,
      title:          n.title,
      body:           n.body || undefined,
      eventId:        n.eventId || undefined,
      eventDate:      n.eventDate || undefined,
      senderEmail:    n.senderEmail || undefined,
      read:           false,
    });
    if (errors?.length) throw new Error(errors[0].message);
    return this.toLocal(data!);
  }

  async markRead(id: string): Promise<void> {
    await client.models.Notification.update({ id, read: true });
  }

  async markAllRead(email: string): Promise<void> {
    const all = await this.listForUser(email);
    await Promise.all(all.filter(n => !n.read).map(n => this.markRead(n.id)));
  }

  async delete(id: string): Promise<void> {
    await client.models.Notification.delete({ id });
  }

  private toLocal(r: Schema['Notification']['type']): AppNotification {
    return {
      id:             r.id,
      recipientEmail: r.recipientEmail ?? '',
      type:           (r.type ?? 'reminder') as 'share' | 'reminder',
      title:          r.title ?? '',
      body:           r.body ?? '',
      eventId:        r.eventId ?? '',
      eventDate:      r.eventDate ?? '',
      senderEmail:    r.senderEmail ?? '',
      read:           r.read ?? false,
      createdAt:      r.createdAt ?? undefined,
    };
  }
}
