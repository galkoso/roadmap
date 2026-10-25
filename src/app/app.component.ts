import { ChangeDetectionStrategy, Component, computed, HostListener, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Session } from './core/session';
import { RoadmapStore } from './core/store';
import { exportBackup } from './core/validation';
import { today } from './core/dates';
import { currentPlanningPeriod, emptyPlanningPreferences, validPlanningPeriod } from './core/planning';
@Component({
  selector: 'app-roadmap-shell', standalone: true, imports: [FormsModule, RouterLink, RouterLinkActive, RouterOutlet], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="app-shell" dir="rtl">
      <nav class="page-navigation" aria-label="ניווט ראשי"><a routerLink="/roadmap" routerLinkActive="current-page" ariaCurrentWhenActive="page">Roadmap</a>@if (session.canViewBacklog()) { <a routerLink="/backlog" routerLinkActive="current-page" ariaCurrentWhenActive="page">בקלוג</a> }<a routerLink="/planning" routerLinkActive="current-page" ariaCurrentWhenActive="page">תכנון חודשי</a><a routerLink="/velocity" routerLinkActive="current-page" ariaCurrentWhenActive="page">Velocity</a>
        <div class="navigation-actions">
          <div class="website-period" role="group" aria-label="תקופת האתר">
            <label>חודש<select aria-label="חודש" [ngModel]="period().slice(5)" (ngModelChange)="selectPeriod(period().slice(0, 4) + '-' + $event)" [disabled]="!store.loaded()">
              @for (month of months; track $index) { <option [value]="($index + 1).toString().padStart(2, '0')">{{ month }}</option> }
            </select></label>
            <label>שנה<input aria-label="שנה" type="number" min="1900" max="9999" step="1" dir="ltr" [value]="+period().slice(0, 4)" (change)="changeYear($event)" [disabled]="!store.loaded()"></label>
            @if (periodError()) { <p class="field-error" role="alert">{{ periodError() }}</p> }
          </div>
          <button class="logout-button" (click)="logout.emit()">יציאה</button>
        </div>
      </nav>
      @if (store.error()) { <div class="error-banner" role="alert"><span>{{ store.error() }}</span><button (click)="download()">{{ store.rawRecovery() ? 'ייצוא הנתונים המקוריים לבדיקה' : 'ייצוא המצב הנוכחי' }}</button>@if (store.conflict()) { <button (click)="store.reload()">טעינת הגרסה החדשה</button> } @else { <button (click)="store.retry()">ניסיון שמירה נוסף</button> }</div> }
      <router-outlet/>
    </main>
  `
})
export class RoadmapShellComponent {
  readonly session = inject(Session);
  readonly logout = output<void>();
  readonly store = inject(RoadmapStore);
  readonly period = computed(() => this.store.preferences().planning?.activePeriod ?? currentPlanningPeriod());
  readonly periodError = signal('');
  readonly months = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  selectPeriod(activePeriod: string): void {
    if (!validPlanningPeriod(activePeriod)) { this.periodError.set('יש להזין שנה שלמה בין 1900 ל־9999'); return; }
    this.periodError.set('');
    this.store.setPreferences({ planning: { ...(this.store.preferences().planning ?? emptyPlanningPreferences()), activePeriod } });
  }
  changeYear(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectPeriod(`${Number(input.value)}-${this.period().slice(5)}`);
    input.value = String(Number(this.period().slice(0, 4)));
  }
  download(): void {
    const recovery = this.store.rawRecovery(), contents = recovery ? JSON.stringify(recovery, null, 2) : exportBackup(this.store.document(), this.store.preferences());
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' })), link = document.createElement('a');
    link.href = url; link.download = `${recovery ? 'roadmap-recovery' : 'roadmap-backup'}-${today()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

@Component({
  selector: 'app-root', standalone: true, imports: [FormsModule, RoadmapShellComponent], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (authenticated()) {
      <app-roadmap-shell (logout)="logout()"/>
    } @else {
      <main class="login-page" dir="rtl">
        <section class="login-card" aria-labelledby="login-heading">
          <span class="login-brand">ROADMAP</span>
          <h1 id="login-heading">מפת הדרכים של המדור</h1>
          @if (checking()) { <p role="status">בודק התחברות…</p> } @else {
            <p>הזינו סיסמה כדי להיכנס</p>
            <form (ngSubmit)="login()">
              <label for="login-password">סיסמה</label>
              <input id="login-password" name="password" type="password" autocomplete="current-password"
                [(ngModel)]="password" required maxlength="256" [disabled]="busy()" [attr.aria-invalid]="error() ? true : null"
                [attr.aria-describedby]="error() ? 'login-error' : null" dir="ltr"/>
              @if (error()) { <p class="login-error" id="login-error" role="alert">{{ error() }}</p> }
              <button class="primary" type="submit" [disabled]="busy() || !password">{{ busy() ? 'מתחבר…' : 'כניסה' }}</button>
            </form>
          }
        </section>
      </main>
    }
  `
})
export class AppComponent {
  readonly session = inject(Session);
  readonly authenticated = this.session.authenticated;
  readonly checking = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  password = '';
  constructor() { void this.checkSession(); }
  @HostListener('window:roadmap-auth-required')
  lock(): void { this.session.apply({ authenticated: false }); this.error.set('פג תוקף ההתחברות. הזינו סיסמה כדי להמשיך.'); }
  private async checkSession(): Promise<void> {
    try {
      await this.session.check();
    } catch { this.error.set('לא ניתן להתחבר לשרת. נסו שוב.'); }
    finally { this.checking.set(false); }
  }
  async login(): Promise<void> {
    if (this.busy() || !this.password) return;
    this.busy.set(true); this.error.set('');
    try {
      const response = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ password: this.password })
      });
      if (!response.ok) {
        this.error.set(response.status === 401 ? 'הסיסמה שגויה. נסו שוב.' : response.status === 429 ? 'יותר מדי ניסיונות. נסו שוב בעוד דקה.' : 'לא ניתן להתחבר לשרת. נסו שוב.');
        return;
      }
      const session = await response.json();
      if (session.authenticated !== true) throw new Error();
      this.password = '';
      location.reload();
    } catch { this.error.set('לא ניתן להתחבר לשרת. נסו שוב.'); }
    finally { this.busy.set(false); }
  }
  async logout(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const response = await fetch('/api/login', { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
      if (!response.ok) throw new Error();
      location.reload();
    } catch { window.alert('לא ניתן לצאת כרגע. נסו שוב.'); }
    finally { this.busy.set(false); }
  }
}
