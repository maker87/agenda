import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthComponent } from './auth/auth.component';
import { DashboardComponent } from './dashboard/dashboard.component';
import { MockAuthService } from './services/mock-auth.service';

function authGuard() {
  const auth = inject(MockAuthService);
  const router = inject(Router);
  return auth.isLoggedIn() ? true : router.createUrlTree(['/']);
}

function guestGuard() {
  const auth = inject(MockAuthService);
  const router = inject(Router);
  return auth.isLoggedIn() ? router.createUrlTree(['/dashboard']) : true;
}

export const routes: Routes = [
  { path: '', component: AuthComponent, canActivate: [guestGuard] },
  { path: 'dashboard', component: DashboardComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: '' },
];
