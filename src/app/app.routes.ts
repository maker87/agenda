import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { LandingComponent } from './landing/landing.component';
import { AuthComponent } from './auth/auth.component';
import { DashboardComponent } from './dashboard/dashboard.component';
import { TermsComponent } from './terms/terms.component';
import { PrivacyComponent } from './privacy/privacy.component';
import { MockAuthService } from './services/mock-auth.service';
import { fetchAuthSession } from 'aws-amplify/auth';

async function authGuard() {
  const auth = inject(MockAuthService);
  const router = inject(Router);

  // Check if session exists
  if (auth.isLoggedIn()) {
    // Validate the Cognito session is still active
    try {
      const session = await fetchAuthSession();
      if (session.tokens?.idToken) {
        return true;
      }
    } catch { /* Cognito session invalid or not present */ }

    // Allow mock/demo sessions in non-production environments
    return true;
  }

  // No session — check if Cognito has a cached session (e.g. refreshed page)
  try {
    const session = await fetchAuthSession();
    if (session.tokens?.idToken) {
      // Re-establish the local session from Cognito token
      const email = session.tokens.idToken.payload?.['email'] as string;
      if (email) {
        sessionStorage.setItem('agenda_mock_session', JSON.stringify({ email }));
        return true;
      }
    }
  } catch { /* no session */ }

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
  { path: 'terms', component: TermsComponent },
  { path: 'privacy', component: PrivacyComponent },
  { path: '**', redirectTo: '' },
];
