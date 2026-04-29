import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

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
    })
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
