import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { RoadmapStore } from './core/store';
import { exportBackup } from './core/validation';
import { today } from './core/dates';
@Component({
  selector: 'app-root', standalone: true, imports: [RouterLink, RouterLinkActive, RouterOutlet], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="app-shell" dir="rtl">
      <nav class="page-navigation" aria-label="ניווט ראשי"><a routerLink="/roadmap" routerLinkActive="current-page" ariaCurrentWhenActive="page">Roadmap</a><a routerLink="/backlog" routerLinkActive="current-page" ariaCurrentWhenActive="page">בקלוג</a><a routerLink="/planning" routerLinkActive="current-page" ariaCurrentWhenActive="page">תכנון חודשי</a></nav>
      @if (store.error()) { <div class="error-banner" role="alert"><span>{{ store.error() }}</span><button (click)="download()">{{ store.rawRecovery() ? 'ייצוא הנתונים המקוריים לבדיקה' : 'ייצוא המצב הנוכחי' }}</button>@if (store.conflict()) { <button (click)="store.reload()">טעינת הגרסה החדשה</button> } @else { <button (click)="store.retry()">ניסיון שמירה נוסף</button> }</div> }
      <router-outlet/>
    </main>
  `
})
export class AppComponent {
  readonly store = inject(RoadmapStore);
  download(): void {
    const recovery = this.store.rawRecovery(), contents = recovery ? JSON.stringify(recovery, null, 2) : exportBackup(this.store.document(), this.store.preferences());
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' })), link = document.createElement('a');
    link.href = url; link.download = `${recovery ? 'roadmap-recovery' : 'roadmap-backup'}-${today()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
