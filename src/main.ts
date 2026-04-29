import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { Amplify } from 'aws-amplify';
import outputs from '../amplify_outputs.json';

// Configure Amplify once at startup so the data client is ready everywhere
Amplify.configure(outputs);

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
