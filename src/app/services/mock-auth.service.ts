import { Injectable } from '@angular/core';

const MOCK_USER = {
  email: 'demo@agenda.com',
  password: 'Demo1234!',
};

const SESSION_KEY = 'agenda_mock_session';

@Injectable({ providedIn: 'root' })
export class MockAuthService {
  login(email: string, password: string): boolean {
    if (email === MOCK_USER.email && password === MOCK_USER.password) {
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
}
