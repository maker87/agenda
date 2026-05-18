import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MockAuthService } from '../services/mock-auth.service';

type AuthView = 'login' | 'signup' | 'confirm';

/** Simple in-memory store for pending sign-ups (simulates Cognito) */
const PENDING_SIGNUPS: Map<string, { password: string; code: string }> = new Map();

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6-digit code
}

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './auth.component.html',
  styleUrl: './auth.component.css',
})
export class AuthComponent {
  view: AuthView = 'login';
  email = '';
  password = '';
  confirmPassword = '';
  confirmationCode = '';
  errorMessage = '';
  successMessage = '';
  loading = false;
  resending = false;

  constructor(private router: Router, private mockAuth: MockAuthService) {}

  switchView(v: AuthView) {
    this.view = v;
    this.errorMessage = '';
    this.successMessage = '';
  }

  fillDemo(email: string, password: string) {
    this.email = email;
    this.password = password;
    this.errorMessage = '';
  }

  async onLogin() {
    if (!this.email || !this.password) {
      this.errorMessage = 'Please fill in all fields.';
      return;
    }
    this.loading = true;
    this.errorMessage = '';

    await new Promise((r) => setTimeout(r, 600));

    // Check demo accounts
    const isDemoLogin = this.mockAuth.login(this.email, this.password);
    if (isDemoLogin) {
      this.router.navigate(['/dashboard']);
      this.loading = false;
      return;
    }

    // Check if this email was registered via sign-up
    const stored = localStorage.getItem('agenda_registered_' + this.email);
    if (stored) {
      const user = JSON.parse(stored);
      if (user.password === this.password && user.verified) {
        sessionStorage.setItem('agenda_mock_session', JSON.stringify({ email: this.email }));
        this.router.navigate(['/dashboard']);
        this.loading = false;
        return;
      } else if (!user.verified) {
        this.errorMessage = 'Please verify your email first. Check your inbox for the code.';
        this.view = 'confirm';
        this.loading = false;
        return;
      }
    }

    this.errorMessage = 'Invalid email or password.';
    this.loading = false;
  }

  async onSignUp() {
    if (!this.email || !this.password || !this.confirmPassword) {
      this.errorMessage = 'Please fill in all fields.';
      return;
    }
    if (this.password !== this.confirmPassword) {
      this.errorMessage = 'Passwords do not match.';
      return;
    }
    if (this.password.length < 8) {
      this.errorMessage = 'Password must be at least 8 characters.';
      return;
    }

    // Check if already registered
    const existing = localStorage.getItem('agenda_registered_' + this.email);
    if (existing) {
      const user = JSON.parse(existing);
      if (user.verified) {
        this.errorMessage = 'An account with this email already exists. Try signing in.';
        this.loading = false;
        return;
      }
    }

    this.loading = true;
    this.errorMessage = '';

    await new Promise((r) => setTimeout(r, 800));

    // Generate verification code and store pending sign-up
    const code = generateCode();
    PENDING_SIGNUPS.set(this.email, { password: this.password, code });

    // Store in localStorage (unverified)
    localStorage.setItem('agenda_registered_' + this.email, JSON.stringify({
      email: this.email,
      password: this.password,
      verified: false,
    }));

    // "Send" the code — log to console and show in a browser alert for demo purposes
    console.log(`[Agenda] Verification code for ${this.email}: ${code}`);

    // Use the Notification API if available, otherwise alert
    this.sendVerificationEmail(this.email, code);

    this.loading = false;
    this.view = 'confirm';
    this.successMessage = `Verification code sent to ${this.email}. Check your email!`;
  }

  async onConfirm() {
    if (!this.confirmationCode) {
      this.errorMessage = 'Please enter the confirmation code.';
      return;
    }
    this.loading = true;
    this.errorMessage = '';

    await new Promise((r) => setTimeout(r, 600));

    const pending = PENDING_SIGNUPS.get(this.email);
    if (!pending) {
      this.errorMessage = 'No pending verification for this email. Please sign up again.';
      this.loading = false;
      return;
    }

    if (this.confirmationCode !== pending.code) {
      this.errorMessage = 'Invalid code. Please check and try again.';
      this.loading = false;
      return;
    }

    // Mark as verified
    localStorage.setItem('agenda_registered_' + this.email, JSON.stringify({
      email: this.email,
      password: pending.password,
      verified: true,
    }));
    PENDING_SIGNUPS.delete(this.email);

    // Auto sign-in
    sessionStorage.setItem('agenda_mock_session', JSON.stringify({ email: this.email }));
    this.router.navigate(['/dashboard']);
    this.loading = false;
  }

  async resendCode() {
    this.resending = true;
    this.errorMessage = '';
    this.successMessage = '';

    await new Promise((r) => setTimeout(r, 500));

    const code = generateCode();
    const pending = PENDING_SIGNUPS.get(this.email);
    if (pending) {
      pending.code = code;
    } else {
      // Re-create pending entry from localStorage
      const stored = localStorage.getItem('agenda_registered_' + this.email);
      if (stored) {
        const user = JSON.parse(stored);
        PENDING_SIGNUPS.set(this.email, { password: user.password, code });
      }
    }

    console.log(`[Agenda] New verification code for ${this.email}: ${code}`);
    this.sendVerificationEmail(this.email, code);

    this.successMessage = `New code sent to ${this.email}!`;
    this.resending = false;
  }

  /**
   * Simulates sending a verification email.
   * In production this would be handled by Cognito.
   * For demo: shows a browser notification + logs to console.
   */
  private sendVerificationEmail(email: string, code: string) {
    // Try browser Notification API
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Agenda - Verification Code', {
        body: `Your code for ${email} is: ${code}`,
        icon: '📅',
      });
    } else if ('Notification' in window && Notification.permission !== 'denied') {
      Notification.requestPermission().then(perm => {
        if (perm === 'granted') {
          new Notification('Agenda - Verification Code', {
            body: `Your code for ${email} is: ${code}`,
            icon: '📅',
          });
        }
      });
    }

    // Always show an alert as fallback so the user can see the code
    setTimeout(() => {
      alert(`📧 Verification code for ${email}:\n\n${code}\n\n(In production, this would be sent to your email via AWS Cognito)`);
    }, 300);
  }
}
