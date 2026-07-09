import { Injectable } from '@angular/core';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../../amplify/data/resource';

export interface Friend {
  id: string;
  email: string;
  displayName: string;
  nickname: string;
}

export interface SharedEventSnapshot {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  description: string;
  color: string;
  category: string;
}

export interface FriendMessage {
  id: string;
  fromEmail: string;
  toEmail: string;
  text: string;
  createdAt: string;
  sharedEvent?: SharedEventSnapshot;
}

// Lazy — avoids crashing at module load when Amplify isn't configured
let _client: ReturnType<typeof generateClient<Schema>> | null = null;
function getClient() {
  if (!_client) _client = generateClient<Schema>();
  return _client;
}

@Injectable({ providedIn: 'root' })
export class FriendsService {

  async listFriends(ownerEmail: string): Promise<Friend[]> {
    const { data, errors } = await getClient().models.Friend.list({
      filter: { ownerEmail: { eq: ownerEmail } },
    });
    if (errors?.length) throw new Error(errors[0].message);
    return (data ?? []).map(this.toLocalFriend);
  }

  async addFriend(ownerEmail: string, friendEmail: string, nickname: string): Promise<Friend> {
    const { data, errors } = await getClient().models.Friend.create({
      ownerEmail, friendEmail, nickname: nickname || undefined,
    });
    if (errors?.length) throw new Error(errors[0].message);
    return this.toLocalFriend(data!);
  }

  async removeFriend(id: string): Promise<void> {
    const { errors } = await getClient().models.Friend.delete({ id });
    if (errors?.length) throw new Error(errors[0].message);
  }

  async updateNickname(id: string, nickname: string): Promise<void> {
    const { errors } = await getClient().models.Friend.update({ id, nickname });
    if (errors?.length) throw new Error(errors[0].message);
  }

  /** Every message the given user has sent or received, across all conversations. */
  async listAllMessages(userEmail: string): Promise<FriendMessage[]> {
    const { data, errors } = await getClient().models.FriendMessage.list({
      filter: {
        or: [
          { fromEmail: { eq: userEmail } },
          { toEmail: { eq: userEmail } },
        ],
      },
    });
    if (errors?.length) throw new Error(errors[0].message);
    return (data ?? [])
      .map(this.toLocalMessage)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async sendMessage(fromEmail: string, toEmail: string, text: string): Promise<FriendMessage> {
    const { data, errors } = await getClient().models.FriendMessage.create({
      fromEmail, toEmail, text,
    });
    if (errors?.length) throw new Error(errors[0].message);
    return this.toLocalMessage(data!);
  }

  /** Shares a calendar event as a message — the recipient gets a denormalized snapshot they can add to their own calendar. */
  async sendEventMessage(fromEmail: string, toEmail: string, event: SharedEventSnapshot): Promise<FriendMessage> {
    const { data, errors } = await getClient().models.FriendMessage.create({
      fromEmail, toEmail,
      text: `📅 Shared an event: ${event.title}`,
      eventTitle:       event.title,
      eventDate:        event.date,
      eventStartTime:   event.startTime,
      eventEndTime:     event.endTime,
      eventDescription: event.description || undefined,
      eventColor:       event.color || undefined,
      eventCategory:    event.category || undefined,
    });
    if (errors?.length) throw new Error(errors[0].message);
    return this.toLocalMessage(data!);
  }

  private toLocalFriend(r: Schema['Friend']['type']): Friend {
    const email = r.friendEmail ?? '';
    return {
      id: r.id,
      email,
      nickname: r.nickname ?? '',
      displayName: email.split('@')[0],
    };
  }

  private toLocalMessage(r: Schema['FriendMessage']['type']): FriendMessage {
    const msg: FriendMessage = {
      id: r.id,
      fromEmail: r.fromEmail ?? '',
      toEmail: r.toEmail ?? '',
      text: r.text ?? '',
      createdAt: r.createdAt ?? new Date().toISOString(),
    };
    if (r.eventTitle) {
      msg.sharedEvent = {
        title: r.eventTitle,
        date: r.eventDate ?? '',
        startTime: r.eventStartTime ?? '',
        endTime: r.eventEndTime ?? '',
        description: r.eventDescription ?? '',
        color: r.eventColor ?? '#6c63ff',
        category: r.eventCategory ?? '',
      };
    }
    return msg;
  }
}
