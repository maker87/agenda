import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { signIn, signUp, confirmSignUp } from 'aws-amplify/auth';

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
  loading = false;

  constructor(private router: Router) {}

  switchView(v: AuthView) {
    this.view = v;
    this.errorMessage = '';
  }

  async onLogin() {
    if (!this.email || !this.password) {
      this.errorMessage = 'Please fill in all fields.';
      return;
    }
    this.loading = true;
    this.errorMessage = '';
    try {
      await signIn({ username: this.email, password: this.password });
      this.router.navigate(['/dashboard']);
    } catch (err: any) {
      this.errorMessage = err.message || 'Login failed. Please try again.';
    } finally {
      this.loading = false;
    }
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
      await signUp({ username: this.email, password: this.password, options: { userAttributes: { email: this.email } } });
      this.view = 'confirm';
    } catch (err: any) {
      this.errorMessage = err.message || 'Sign up failed. Please try again.';
    } finally {
      this.loading = false;
    }
  }

  async onConfirm() {
    if (!this.confirmationCode) {
      this.errorMessage = 'Please enter the confirmation code.';
      return;
    }
    this.loading = true;
    this.errorMessage = '';
    try {
      await confirmSignUp({ username: this.email, confirmationCode: this.confirmationCode });
      // Auto-login after confirmation
      await signIn({ username: this.email, password: this.password });
      this.router.navigate(['/dashboard']);
    } catch (err: any) {
      this.errorMessage = err.message || 'Confirmation failed. Please try again.';
    } finally {
      this.loading = false;
    }
  }
}
