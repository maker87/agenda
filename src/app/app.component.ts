import { Component, OnDestroy, OnInit } from '@angular/core';
import { NgIf } from '@angular/common';
import { RouterOutlet } from '@angular/router';

/** The hashed bundle name a build stamps into index.html, e.g. main-PWEDWIBA.js. */
const BUNDLE_PATTERN = /main-[A-Z0-9]+\.js/;

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NgIf],
  template: `
    <router-outlet />
    <div class="update-bar" *ngIf="updateReady" role="status">
      <span>A new version of Agenda is ready.</span>
      <button type="button" (click)="reload()">Reload</button>
    </div>
  `,
  styles: [`
    .update-bar {
      position: fixed;
      left: 50%;
      bottom: 24px;
      transform: translateX(-50%);
      z-index: 3000;
      display: flex;
      align-items: center;
      gap: 14px;
      max-width: calc(100vw - 32px);
      padding: 10px 12px 10px 18px;
      background: #1a1a2e;
      color: #fff;
      border-radius: 12px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3);
      font-size: 14px;
    }
    .update-bar button {
      flex-shrink: 0;
      padding: 7px 14px;
      border: none;
      border-radius: 8px;
      background: #6c63ff;
      color: #fff;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    .update-bar button:hover { opacity: 0.9; }
    /* Clear the dashboard's bottom nav bar on phones. */
    @media (max-width: 480px) {
      .update-bar { bottom: 84px; }
    }
  `],
})
export class AppComponent implements OnInit, OnDestroy {
  /**
   * True once the site has been deployed again since this tab loaded.
   *
   * The app never reloads itself, so a tab left open keeps running whatever
   * build it started with — new features just don't appear until the user
   * happens to refresh. Offering the reload (rather than doing it) leaves any
   * half-filled form alone.
   */
  updateReady = false;

  private readonly loadedBundle = document
    .querySelector<HTMLScriptElement>('script[src*="main-"]')
    ?.getAttribute('src')?.match(BUNDLE_PATTERN)?.[0] ?? '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly onVisible = () => {
    if (document.visibilityState === 'visible') this.checkForUpdate();
  };

  ngOnInit() {
    // `ng serve` builds have no hashed bundle, so there is nothing to compare.
    if (!this.loadedBundle) return;
    this.timer = setInterval(() => this.checkForUpdate(), 5 * 60_000);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  ngOnDestroy() {
    if (this.timer) clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  reload() {
    window.location.reload();
  }

  private async checkForUpdate() {
    if (this.updateReady) return;
    try {
      const res = await fetch('/index.html', { cache: 'no-store' });
      const live = (await res.text()).match(BUNDLE_PATTERN)?.[0];
      if (live && live !== this.loadedBundle) this.updateReady = true;
    } catch { /* offline — try again next time */ }
  }
}
