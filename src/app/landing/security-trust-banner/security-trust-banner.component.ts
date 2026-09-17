import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

interface TrustPoint {
  icon: string;
  title: string;
  detail: string;
}

/**
 * The three commitments that decide whether someone will connect a calendar:
 * how access is granted, what happens to their data, and how to get out.
 */
@Component({
  selector: 'app-security-trust-banner',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './security-trust-banner.component.html',
  styleUrl: './security-trust-banner.component.css',
})
export class SecurityTrustBannerComponent {
  readonly points: TrustPoint[] = [
    {
      icon: '🔐',
      title: 'OAuth 2.0, encrypted end to end',
      detail:
        'You connect through Google\'s own consent screen. We never see your password, and we request the ' +
        'narrowest calendar scopes that make the features work.',
    },
    {
      icon: '🚫',
      title: 'Zero AI training on your schedule',
      detail:
        'Your events are never used to train any model — ours or anyone else\'s. They are read to answer ' +
        'your request, and that is the end of it.',
    },
    {
      icon: '⏏️',
      title: '1-click disconnect and deletion',
      detail:
        'Revoke calendar access and erase everything we hold from one button in settings. No support ' +
        'ticket, no waiting period.',
    },
  ];
}
