import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { defineFunction } from '@aws-amplify/backend';

const bedrockChatHandler = defineFunction({
  name: 'bedrock-chat',
  entry: '../functions/bedrock-chat/handler.js',
  timeoutSeconds: 30,
  memoryMB: 256,
});

const schema = a.schema({
  CalendarEvent: a
    .model({
      title:       a.string().required(),
      date:        a.string().required(),
      startTime:   a.string().required(),
      endTime:     a.string().required(),
      description: a.string(),
      color:       a.string(),
      ownerEmail:  a.string(),
      category:    a.string(),
      location:    a.string(),
      sharedWith:  a.string().array(),
      reminderMinutes: a.integer(),
    })
    .authorization((allow) => [
      allow.owner().identityClaim('sub'),
      allow.authenticated().to(['read']),
    ]),

  Notification: a
    .model({
      recipientEmail: a.string().required(),
      type:           a.string().required(),
      title:          a.string().required(),
      body:           a.string(),
      eventId:        a.string(),
      eventDate:      a.string(),
      senderEmail:    a.string(),
      read:           a.boolean(),
      status:         a.string(),
    })
    .authorization((allow) => [
      allow.owner().identityClaim('sub'),
      // Notifications are created by the sender but acted on (read/accepted/
      // rejected/deleted) by the recipient, who is never the owner — without
      // this, updateStatus()/markRead()/delete() from the recipient silently
      // fail auth and the notification (e.g. a friend request) reverts to
      // pending every time the app reloads.
      allow.authenticated().to(['create', 'read', 'update', 'delete']),
    ]),

  Friend: a
    .model({
      ownerEmail:  a.string().required(),
      friendEmail: a.string().required(),
      nickname:    a.string(),
    })
    .authorization((allow) => [
      allow.owner().identityClaim('sub'),
    ]),

  FriendMessage: a
    .model({
      fromEmail: a.string().required(),
      toEmail:   a.string().required(),
      text:      a.string().required(),
      // Present when this message shares a calendar event (denormalized snapshot,
      // so the recipient can view/add it without needing access to the sender's event).
      eventTitle:       a.string(),
      eventDate:        a.string(),
      eventStartTime:   a.string(),
      eventEndTime:     a.string(),
      eventDescription: a.string(),
      eventColor:       a.string(),
      eventCategory:    a.string(),
    })
    .authorization((allow) => [
      allow.owner().identityClaim('sub'),
      allow.authenticated().to(['create', 'read']),
    ]),

  chat: a
    .query()
    .arguments({
      message: a.string().required(),
      events: a.string(),
      today: a.string(),
      conversationHistory: a.string(),
    })
    .returns(a.string())
    .handler(a.handler.function(bedrockChatHandler))
    .authorization((allow) => [allow.authenticated()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
    apiKeyAuthorizationMode: {
      expiresInDays: 30,
    },
  },
});
