import { Injectable } from '@angular/core';

const MOCK_USERS = [
  { email: 'demo@agenda.com', password: 'Demo1234!' },
  { email: 'alex.student@school.edu', password: 'Student1234!' },
  { email: 'jordan.coach@fitlife.com', password: 'Coach1234!' },
];

const SESSION_KEY = 'agenda_mock_session';
const PROFILE_KEY = 'agenda_user_profile';

export interface UserProfile {
  email: string;
  username: string;
  avatarUrl: string | null;
  language: string;
  region: string;
}

@Injectable({ providedIn: 'root' })
export class MockAuthService {
  login(email: string, password: string): boolean {
    const match = MOCK_USERS.find(u => u.email === email && u.password === password);
    if (match) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ email }));
      return true;
    }
    return false;
  }

  logout() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  isLoggedIn(): boolean {
    return !!sessionStorage.getItem(SESSION_KEY);
  }

  getCurrentUser(): { email: string } | null {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  // ── Profile helpers ──

  getProfile(email: string): UserProfile {
    try {
      const raw = localStorage.getItem(PROFILE_KEY + '_' + email);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return {
      email,
      username: email.split('@')[0],
      avatarUrl: null,
      language: 'en',
      region: '',
    };
  }

  saveProfile(profile: UserProfile): void {
    localStorage.setItem(PROFILE_KEY + '_' + profile.email, JSON.stringify(profile));
  }

  /** Returns true if the given password matches the stored mock password for the email. */
  verifyPassword(email: string, password: string): boolean {
    return MOCK_USERS.some(u => u.email === email && u.password === password);
  }

  /** Simulates changing the password (no-op in mock, just validates old password). */
  changePassword(email: string, oldPassword: string, _newPassword: string): boolean {
    return this.verifyPassword(email, oldPassword);
  }

  /** Simulates deleting the account. */
  deleteAccount(email: string): void {
    localStorage.removeItem(PROFILE_KEY + '_' + email);
    this.logout();
  }
}
