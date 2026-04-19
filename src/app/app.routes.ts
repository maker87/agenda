import { Routes } from '@angular/router';
import { AuthComponent } from './auth/auth.component';
import { DashboardComponent } from './dashboard/dashboard.component';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { getCurrentUser } from 'aws-amplify/auth';

async function authGuard() {
  try {
    await getCurrentUser();
    return true;
  } catch {
    return inject(Router).createUrlTree(['/']);
  }
}

async function guestGuard() {
  try {
    await getCurrentUser();
    return inject(Router).createUrlTree(['/dashboard']);
  } catch {
    return true;
  }
}

export const routes: Routes = [
  { path: '', component: AuthComponent, canActivate: [guestGuard] },
  { path: 'dashboard', component: DashboardComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: '' },
];
