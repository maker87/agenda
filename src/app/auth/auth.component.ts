import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { MockAuthService } from '../services/mock-auth.service';
import { signUp, confirmSignUp, signIn, resendSignUpCode, signOut, resetPassword, confirmResetPassword } from 'aws-amplify/auth';

type AuthView = 'login' | 'signup' | 'confirm' | 'forgot' | 'resetPassword';

const AUTH_STATE_KEY = 'agenda_auth_pending';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './auth.component.html',
  styleUrl: './auth.component.css',
})
export class AuthComponent implements OnInit {
  view: AuthView = 'login';
  email = '';
  password = '';
  confirmPassword = '';
  confirmationCode = '';
  errorMessage = '';
  successMessage = '';
  loading = false;
  resending = false;

  constructor(private router: Router, private route: ActivatedRoute, private mockAuth: MockAuthService) {}

  ngOnInit() {
    // Check query param to determine initial view (login or signup)
    const mode = this.route.snapshot.queryParamMap.get('mode');
    if (mode === 'signup') {
      this.view = 'signup';
    } else {
      this.view = 'login';
    }

    // Restore auth state if user navigated away (e.g. to check email on mobile)
    this.restoreAuthState();
  }

  /** Save pending signup state so users can switch apps and come back. */
  private saveAuthState() {
    try {
      sessionStorage.setItem(AUTH_STATE_KEY, JSON.stringify({
        view: this.view,
        email: this.email,
        // Never store password — user will re-enter after returning
      }));
    } catch { /* ignore */ }
  }

  /** Restore saved auth state (e.g. after returning from email app on mobile). */
  private restoreAuthState() {
    try {
      const raw = sessionStorage.getItem(AUTH_STATE_KEY);
      if (!raw) return;
      const state = JSON.parse(raw);
      if (state.view === 'confirm' && state.email) {
        this.view = 'confirm';
        this.email = state.email;
        this.successMessage = `Enter the verification code sent to ${this.email}`;
      } else if (state.view === 'resetPassword' && state.email) {
        this.view = 'resetPassword';
        this.email = state.email;
        this.successMessage = `Enter the reset code sent to ${this.email}`;
      }
    } catch { /* ignore */ }
  }

  /** Clear saved auth state (on successful login or when going back). */
  private clearAuthState() {
    try { sessionStorage.removeItem(AUTH_STATE_KEY); } catch { /* ignore */ }
  }

  switchView(v: AuthView) {
    this.view = v;
    this.errorMessage = '';
    this.successMessage = '';
    if (v !== 'confirm' && v !== 'resetPassword') {
      this.clearAuthState();
    }
  }

  fillDemo(email: string, password: string) {
    this.email = email;
    this.password = password;
    this.errorMessage = '';
  }

  goHome() {
    this.router.navigate(['/']);
  }

  async onLogin() {
    if (!this.email || !this.password) {
      this.errorMessage = 'Please fill in all fields.';
      return;
    }
    this.loading = true;
    this.errorMessage = '';

    // Check demo accounts first (instant, no network)
    const isDemoLogin = this.mockAuth.login(this.email, this.password);
    if (isDemoLogin) {
      this.router.navigate(['/dashboard']);
      this.loading = false;
      return;
    }

    // Real Amplify sign-in
    try {
      // Clear any stale Cognito session first
      try { await signOut(); } catch { /* ignore */ }

      const result = await signIn({ username: this.email, password: this.password });
      if (result.isSignedIn) {
        this.clearAuthState();
        sessionStorage.setItem('agenda_mock_session', JSON.stringify({ email: this.email }));
        this.router.navigate(['/dashboard']);
      } else if (result.nextStep?.signInStep === 'CONFIRM_SIGN_UP') {
        this.view = 'confirm';
        this.errorMessage = 'Please verify your email first.';
        this.saveAuthState();
      } else {
        this.errorMessage = 'Additional steps required. Please try again.';
      }
    } catch (err: any) {
      if (err?.name === 'UserNotConfirmedException') {
        this.view = 'confirm';
        this.errorMessage = 'Your email is not verified. Enter the code we sent.';
        this.saveAuthState();
      } else if (err?.name === 'NotAuthorizedException') {
        this.errorMessage = 'Invalid email or password.';
      } else if (err?.name === 'UserNotFoundException') {
        this.errorMessage = 'No account found with this email.';
      } else {
        this.errorMessage = err?.message || 'Sign-in failed. Please try again.';
      }
    }
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
    this.loading = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      const { nextStep } = await signUp({
        username: this.email,
        password: this.password,
        options: {
          userAttributes: { email: this.email },
        },
      });

      if (nextStep.signUpStep === 'CONFIRM_SIGN_UP') {
        // If Cognito still requires confirmation, auto-sign-in anyway
        // (This happens if the user pool hasn't been redeployed yet)
        this.view = 'confirm';
        this.successMessage = `Verification code sent to ${this.email}. Check your inbox (and spam folder)!`;
        this.saveAuthState();
      } else if (nextStep.signUpStep === 'DONE') {
        // No verification needed — sign in directly
        try {
          await signOut();
          const signInResult = await signIn({ username: this.email, password: this.password });
          if (signInResult.isSignedIn) {
            sessionStorage.setItem('agenda_mock_session', JSON.stringify({ email: this.email }));
            this.router.navigate(['/dashboard']);
            this.loading = false;
            return;
          }
        } catch {
          // Fallback — just store session and navigate
        }
        sessionStorage.setItem('agenda_mock_session', JSON.stringify({ email: this.email }));
        this.router.navigate(['/dashboard']);
      } else {
        // COMPLETE_AUTO_SIGN_IN or other — try to sign in
        try {
          await signOut();
          const signInResult = await signIn({ username: this.email, password: this.password });
          if (signInResult.isSignedIn) {
            sessionStorage.setItem('agenda_mock_session', JSON.stringify({ email: this.email }));
            this.router.navigate(['/dashboard']);
            this.loading = false;
            return;
          }
        } catch { /* ignore */ }
        sessionStorage.setItem('agenda_mock_session', JSON.stringify({ email: this.email }));
        this.router.navigate(['/dashboard']);
      }
    } catch (err: any) {
      if (err?.name === 'UsernameExistsException') {
        this.errorMessage = 'An account with this email already exists. Try signing in.';
      } else if (err?.message?.toLowerCase().includes('password')) {
        this.errorMessage = 'Password must include uppercase, lowercase, numbers, and a special character.';
      } else {
        this.errorMessage = err?.message || 'Sign-up failed. Please try again.';
      }
    }
    this.loading = false;
  }

  async onConfirm() {
    if (!this.confirmationCode) {
      this.errorMessage = 'Please enter the confirmation code.';
      return;
    }
    this.loading = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      const { nextStep } = await confirmSignUp({
        username: this.email,
        confirmationCode: this.confirmationCode,
      });

      if (nextStep.signUpStep === 'DONE') {
        // Sign in after verification
        try {
          const signInResult = await signIn({ username: this.email, password: this.password });
          if (signInResult.isSignedIn) {
            this.clearAuthState();
            sessionStorage.setItem('agenda_mock_session', JSON.stringify({ email: this.email }));
            this.router.navigate(['/dashboard']);
            this.loading = false;
            return;
          }
        } catch {
          // If auto sign-in fails, send to login
        }
        this.clearAuthState();
        this.successMessage = 'Email verified! You can now sign in.';
        this.view = 'login';
      }
    } catch (err: any) {
      if (err?.name === 'CodeMismatchException') {
        this.errorMessage = 'Invalid code. Please check and try again.';
      } else if (err?.name === 'ExpiredCodeException') {
        this.errorMessage = 'Code expired. Click "Resend code" to get a new one.';
      } else {
        this.errorMessage = err?.message || 'Verification failed. Please try again.';
      }
    }
    this.loading = false;
  }

  async resendCode() {
    this.resending = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      await resendSignUpCode({ username: this.email });
      this.successMessage = `New code sent to ${this.email}!`;
    } catch (err: any) {
      this.errorMessage = err?.message || 'Could not resend code. Please try again.';
    }
    this.resending = false;
  }

  // ── Forgot Password Flow ──

  newPassword = '';
  confirmNewPassword = '';
  resetCode = '';

  async onForgotPassword() {
    if (!this.email) {
      this.errorMessage = 'Please enter your email address.';
      return;
    }
    this.loading = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      const { nextStep } = await resetPassword({ username: this.email });
      if (nextStep.resetPasswordStep === 'CONFIRM_RESET_PASSWORD_WITH_CODE') {
        this.view = 'resetPassword';
        this.successMessage = `Reset code sent to ${this.email}. Check your inbox!`;
        this.saveAuthState();
      } else if (nextStep.resetPasswordStep === 'DONE') {
        this.successMessage = 'Password reset complete. Please sign in.';
        this.view = 'login';
      }
    } catch (err: any) {
      if (err?.name === 'UserNotFoundException') {
        this.errorMessage = 'No account found with this email.';
      } else if (err?.name === 'LimitExceededException') {
        this.errorMessage = 'Too many attempts. Please try again later.';
      } else {
        this.errorMessage = err?.message || 'Could not send reset code. Please try again.';
      }
    }
    this.loading = false;
  }

  async onConfirmResetPassword() {
    if (!this.resetCode) {
      this.errorMessage = 'Please enter the reset code.';
      return;
    }
    if (!this.newPassword) {
      this.errorMessage = 'Please enter a new password.';
      return;
    }
    if (this.newPassword.length < 8) {
      this.errorMessage = 'Password must be at least 8 characters.';
      return;
    }
    if (this.newPassword !== this.confirmNewPassword) {
      this.errorMessage = 'Passwords do not match.';
      return;
    }

    this.loading = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      await confirmResetPassword({
        username: this.email,
        confirmationCode: this.resetCode,
        newPassword: this.newPassword,
      });

      // Auto sign-in with the new password
      this.clearAuthState();
      try {
        await signOut();
        const result = await signIn({ username: this.email, password: this.newPassword });
        if (result.isSignedIn) {
          sessionStorage.setItem('agenda_mock_session', JSON.stringify({ email: this.email }));
          this.router.navigate(['/dashboard']);
          this.loading = false;
          return;
        }
      } catch { /* ignore — fall through to login view */ }

      this.successMessage = 'Password reset successful! Please sign in with your new password.';
      this.password = '';
      this.view = 'login';
    } catch (err: any) {
      if (err?.name === 'CodeMismatchException') {
        this.errorMessage = 'Invalid code. Please check and try again.';
      } else if (err?.name === 'ExpiredCodeException') {
        this.errorMessage = 'Code expired. Please request a new one.';
      } else if (err?.message?.toLowerCase().includes('password')) {
        this.errorMessage = 'Password must include uppercase, lowercase, numbers, and a special character.';
      } else {
        this.errorMessage = err?.message || 'Password reset failed. Please try again.';
      }
    }
    this.loading = false;
  }

  async resendResetCode() {
    this.resending = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      await resetPassword({ username: this.email });
      this.successMessage = `New reset code sent to ${this.email}!`;
    } catch (err: any) {
      this.errorMessage = err?.message || 'Could not resend code. Please try again.';
    }
    this.resending = false;
  }
}
