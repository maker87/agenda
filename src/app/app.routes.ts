import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { LandingComponent } from './landing/landing.component';
import { AuthComponent } from './auth/auth.component';
import { DashboardComponent } from './dashboard/dashboard.component';
import { OnboardingComponent } from './onboarding/onboarding.component';
import { TermsComponent } from './terms/terms.component';
import { PrivacyComponent } from './privacy/privacy.component';
import { MockAuthService } from './services/mock-auth.service';
import { fetchAuthSession } from 'aws-amplify/auth';
import { environment } from '../environments/environment';

async function authGuard() {
  const auth = inject(MockAuthService);
  const router = inject(Router);

  // Who you are comes from the signed-in Cognito session, never from the
  // email the tab has stored. That stored value is what the app loads data
  // for, and it used to be accepted on its own — so editing it in the browser
  // was enough to open someone else's calendar.
  try {
    const session = await fetchAuthSession();
    const verified = session.tokens?.idToken?.payload?.['email'];
    if (typeof verified === 'string' && verified) {
      // Keep the stored spelling when it is the same address in another case:
      // events were saved under the email as typed at sign-in, and swapping
      // it for the token's casing would hide them.
      const stored = auth.getCurrentUser()?.email;
      const email = stored && stored.toLowerCase() === verified.toLowerCase() ? stored : verified;
      sessionStorage.setItem('agenda_mock_session', JSON.stringify({ email }));
      return true;
    }
  } catch { /* no Cognito session */ }

  // Demo accounts have no Cognito session; they exist only outside production.
  if (!environment.production && auth.isLoggedIn()) return true;

  auth.logout();
  return router.createUrlTree(['/auth']);
}

async function guestGuard() {
  const auth = inject(MockAuthService);
  const router = inject(Router);

  if (auth.isLoggedIn()) {
    return router.createUrlTree(['/dashboard']);
  }

  // Also check if there's a valid Cognito session
  try {
    const session = await fetchAuthSession();
    if (session.tokens?.idToken) {
      return router.createUrlTree(['/dashboard']);
    }
  } catch { /* no active session */ }

  return true;
}

export const routes: Routes = [
  { path: '', component: LandingComponent, canActivate: [guestGuard] },
  { path: 'auth', component: AuthComponent, canActivate: [guestGuard] },
  { path: 'dashboard', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'onboarding', component: OnboardingComponent, canActivate: [authGuard] },
  { path: 'terms', component: TermsComponent },
  { path: 'privacy', component: PrivacyComponent },
  { path: '**', redirectTo: '' },
];
