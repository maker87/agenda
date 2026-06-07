import { type ClientSchema, a, defineData, defineFunction } from '@aws-amplify/backend';

const bedrockChatHandler = defineFunction({
  name: 'bedrock-chat',
  entry: './bedrock-chat/handler.ts',
  timeoutSeconds: 30,
  memoryMB: 256,
});

const schema = a.schema({
  CalendarEvent: a
    .model({
      title:       a.string().required(),
      date:        a.string().required(), // ISO date: YYYY-MM-DD
      startTime:   a.string().required(), // HH:MM
      endTime:     a.string().required(), // HH:MM
      description: a.string(),
      color:       a.string(),
      ownerEmail:  a.string(),            // used to scope events per user
      category:    a.string(),            // e.g. "AP Calculus BC", "Soccer", "Personal"
      sharedWith:  a.string().array(),    // list of emails this event is shared with
      reminderMinutes: a.integer(),       // minutes before event to remind (null = no reminder)
    })
    .authorization((allow) => [allow.publicApiKey()]),

  Notification: a
    .model({
      recipientEmail: a.string().required(), // who receives this notification
      type:           a.string().required(),  // 'share' | 'reminder'
      title:          a.string().required(),  // display title
      body:           a.string(),             // detail text
      eventId:        a.string(),             // linked CalendarEvent id
      eventDate:      a.string(),             // YYYY-MM-DD of the event
      senderEmail:    a.string(),             // who triggered the share (for share type)
      read:           a.boolean(),            // false = unread
    })
    .authorization((allow) => [allow.publicApiKey()]),

  // Custom query for AI chat via Bedrock
  chat: a
    .query()
    .arguments({
      message: a.string().required(),
      events: a.string(),   // JSON stringified array of events
      today: a.string(),    // today's date YYYY-MM-DD
      conversationHistory: a.string(), // JSON stringified conversation
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
