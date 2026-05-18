import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MockAuthService } from '../services/mock-auth.service';
import { signUp, confirmSignUp, signIn, autoSignIn } from 'aws-amplify/auth';

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

    // Check if it's a demo account first
    const isDemoLogin = this.mockAuth.login(this.email, this.password);
    if (isDemoLogin) {
      this.router.navigate(['/dashboard']);
      this.loading = false;
      return;
    }

    // Try real Amplify sign-in
    try {
      const result = await signIn({ username: this.email, password: this.password });
      if (result.isSignedIn) {
        // Store session for the app
        sessionStorage.setItem('agenda_mock_session', JSON.stringify({ email: this.email }));
        this.router.navigate(['/dashboard']);
      } else if (result.nextStep?.signInStep === 'CONFIRM_SIGN_UP') {
        this.errorMessage = 'Please verify your email first. Check your inbox for the code.';
        this.view = 'confirm';
      } else {
        this.errorMessage = 'Sign-in requires additional steps. Please try again.';
      }
    } catch (err: any) {
      if (err?.name === 'UserNotConfirmedException') {
        this.view = 'confirm';
        this.errorMessage = 'Your email is not verified yet. Please enter the code we sent.';
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

    try {
      const { nextStep } = await signUp({
        username: this.email,
        password: this.password,
        options: {
          userAttributes: {
            email: this.email,
          },
          autoSignIn: true,
        },
      });

      if (nextStep.signUpStep === 'CONFIRM_SIGN_UP') {
        this.view = 'confirm';
        this.successMessage = `Verification code sent to ${this.email}. Check your inbox!`;
      } else if (nextStep.signUpStep === 'DONE') {
        // Auto-confirmed (unlikely with email verification, but handle it)
        sessionStorage.setItem('agenda_mock_session', JSON.stringify({ email: this.email }));
        this.router.navigate(['/dashboard']);
      }
    } catch (err: any) {
      if (err?.name === 'UsernameExistsException') {
        this.errorMessage = 'An account with this email already exists. Try signing in.';
      } else if (err?.message?.includes('password')) {
        this.errorMessage = 'Password must include uppercase, lowercase, numbers, and special characters.';
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

    try {
      const { nextStep } = await confirmSignUp({
        username: this.email,
        confirmationCode: this.confirmationCode,
      });

      if (nextStep.signUpStep === 'DONE') {
        // Try auto sign-in
        try {
          const signInResult = await autoSignIn();
          if (signInResult.isSignedIn) {
            sessionStorage.setItem('agenda_mock_session', JSON.stringify({ email: this.email }));
            this.router.navigate(['/dashboard']);
            this.loading = false;
            return;
          }
        } catch {
          // Auto sign-in failed, try manual
        }

        // Manual sign-in fallback
        try {
          const result = await signIn({ username: this.email, password: this.password });
          if (result.isSignedIn) {
            sessionStorage.setItem('agenda_mock_session', JSON.stringify({ email: this.email }));
            this.router.navigate(['/dashboard']);
          }
        } catch {
          // If sign-in fails, just go to login view
          this.successMessage = 'Email verified! You can now sign in.';
          this.view = 'login';
        }
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
      // Re-trigger sign-up to resend the code
      const { resendSignUpCode } = await import('aws-amplify/auth');
      await resendSignUpCode({ username: this.email });
      this.successMessage = `New code sent to ${this.email}!`;
    } catch (err: any) {
      this.errorMessage = err?.message || 'Could not resend code. Please try again.';
    }
    this.resending = false;
  }
}
