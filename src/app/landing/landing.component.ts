import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { InteractiveSandboxComponent } from './interactive-sandbox/interactive-sandbox.component';
import { SecurityTrustBannerComponent } from './security-trust-banner/security-trust-banner.component';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, InteractiveSandboxComponent, SecurityTrustBannerComponent],
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.css',
})
export class LandingComponent {
  constructor(private router: Router) {}

  /** Secondary CTA — drops the visitor into the sandbox rather than signup. */
  scrollToSandbox() {
    document.getElementById('sandbox')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  goToLogin() {
    this.router.navigate(['/auth'], { queryParams: { mode: 'login' } });
  }

  goToSignup() {
    this.router.navigate(['/auth'], { queryParams: { mode: 'signup' } });
  }

  goToTerms() {
    this.router.navigate(['/terms']);
  }

  goToPrivacy() {
    this.router.navigate(['/privacy']);
  }
}
