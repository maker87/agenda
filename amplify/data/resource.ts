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
      sharedWith:  a.string().array(),
      reminderMinutes: a.integer(),
    })
    .authorization((allow) => [allow.publicApiKey()]),

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
    .authorization((allow) => [allow.publicApiKey()]),

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
    .authorization((allow) => [allow.publicApiKey()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'apiKey',
    apiKeyAuthorizationMode: {
      expiresInDays: 365,
    },
  },
});
