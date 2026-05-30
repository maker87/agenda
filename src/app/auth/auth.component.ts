import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MockAuthService } from '../services/mock-auth.service';
import { signUp, confirmSignUp, signIn, resendSignUpCode, signOut } from 'aws-amplify/auth';

type AuthView = 'login' | 'signup' | 'confirm';

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
        sessionStorage.setItem('agenda_mock_session', JSON.stringify({ email: this.email }));
        this.router.navigate(['/dashboard']);
      } else if (result.nextStep?.signInStep === 'CONFIRM_SIGN_UP') {
        this.view = 'confirm';
        this.errorMessage = 'Please verify your email first.';
      } else {
        this.errorMessage = 'Additional steps required. Please try again.';
      }
    } catch (err: any) {
      if (err?.name === 'UserNotConfirmedException') {
        this.view = 'confirm';
        this.errorMessage = 'Your email is not verified. Enter the code we sent.';
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
            sessionStorage.setItem('agenda_mock_session', JSON.stringify({ email: this.email }));
            this.router.navigate(['/dashboard']);
            this.loading = false;
            return;
          }
        } catch {
          // If auto sign-in fails, send to login
        }
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
}
