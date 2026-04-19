import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MockAuthService } from '../services/mock-auth.service';

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

  constructor(private router: Router, private mockAuth: MockAuthService) {}

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

    // Simulate a short delay
    await new Promise((r) => setTimeout(r, 600));

    const success = this.mockAuth.login(this.email, this.password);
    if (success) {
      this.router.navigate(['/dashboard']);
    } else {
      this.errorMessage = 'Invalid email or password.';
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
    await new Promise((r) => setTimeout(r, 600));
    // In mock mode, sign-up goes straight to confirm step
    this.loading = false;
    this.view = 'confirm';
  }

  async onConfirm() {
    if (!this.confirmationCode) {
      this.errorMessage = 'Please enter the confirmation code.';
      return;
    }
    this.loading = true;
    this.errorMessage = '';
    await new Promise((r) => setTimeout(r, 600));
    // Mock: any code works
    this.mockAuth.login('demo@agenda.com', 'Demo1234!');
    this.router.navigate(['/dashboard']);
    this.loading = false;
  }
}
