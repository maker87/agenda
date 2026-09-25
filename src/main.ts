import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { Amplify } from 'aws-amplify';
import { fetchAuthSession } from 'aws-amplify/auth';
import outputs from '../amplify_outputs.json';

// Configure Amplify once at startup so the data client is ready everywhere.
//
// Requests carry the Cognito ID token rather than the access token Amplify
// sends by default. The data rules decide who may read an event, notification
// or message by the caller's email (see amplify/data/resource.ts), and only the
// ID token has an email claim. Header values set here override the default
// Authorization header.
Amplify.configure(outputs, {
  API: {
    GraphQL: {
      headers: async () => {
        try {
          const idToken = (await fetchAuthSession()).tokens?.idToken?.toString();
          return idToken ? { Authorization: idToken } : {};
        } catch {
          return {};
        }
      },
    },
  },
});

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
