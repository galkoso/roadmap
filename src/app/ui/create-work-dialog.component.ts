import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, inject, output, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RoadmapStore } from '../core/store';
import { clone, palette, uid } from '../core/model';
import { addWorkingDays, formatDate, nextWorkingDay, today, validateRange } from '../core/dates';
@Component({
  selector: 'app-create-work-dialog', standalone: true, imports: [FormsModule], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog class="create-work-dialog" aria-labelledby="create-work-heading" (close)="onClosed()">
      @if (opened()) {
      <div class="panel-heading"><div><span class="eyebrow">הוספה למפת הדרכים</span><h2 id="create-work-heading">עבודה חדשה</h2></div><button type="button" class="icon-button" aria-label="סגירת יצירת עבודה" (click)="close()">×</button></div>
      <form (ngSubmit)="save()" novalidate>
        <label>כותרת העבודה<input name="create-work-title" [(ngModel)]="title" required maxlength="200" autofocus placeholder="מה מתכננים לעשות?"></label>
        <label class="check-label schedule-toggle"><input type="checkbox" name="scheduled" [(ngModel)]="scheduled" (ngModelChange)="resetErrors()">להגדיר תקופה לעבודה</label>
        @if (scheduled) {
          <label>צוות אחראי<select name="create-work-team" [(ngModel)]="teamId" aria-label="צוות אחראי">@for (team of store.document().teams; track team.id) { <option [value]="team.id">{{ team.name }}</option> }</select></label>
          <div class="field-grid"><label>תאריך התחלה<input type="date" name="create-work-start" [(ngModel)]="startDate" (ngModelChange)="checkSchedule()" dir="ltr" required></label>
            <label>מספר ימי עבודה<input type="number" name="create-work-days" [(ngModel)]="workingDays" (ngModelChange)="checkSchedule()" min="1" max="10000" step="1" dir="ltr" required></label></div>
          @if (scheduleError) { <p class="field-error" role="alert">{{ scheduleError }}</p> } @else { <div class="schedule-summary"><span>תאריך סיום מחושב</span><strong dir="ltr">{{ endLabel() }}</strong><small>ראשון–חמישי · כולל יום ההתחלה והסיום</small></div> }
          <p class="field-hint">תיווצר משימה ראשונה לתקופה זו בצוות שנבחר. אפשר לערוך אותה ולהוסיף משימות בהמשך.</p>
        } @else { <p class="field-hint">העבודה תתווסף ללא פס זמן. אפשר להוסיף לה משימות בהמשך.</p> }
        @if (error) { <p class="field-error" role="alert">{{ error }}</p> }
        <div class="form-actions dialog-actions"><button class="primary" type="submit" [disabled]="store.importing() || !store.loaded()">שמירת עבודה</button><button type="button" (click)="close()">ביטול</button></div>
      </form>
      }
    </dialog>
  `
})
export class CreateWorkDialogComponent {
  readonly store = inject(RoadmapStore); private readonly changeDetector = inject(ChangeDetectorRef);
  readonly opened = signal(false);
  readonly created = output<{ id: string; startDate?: string }>();
  @ViewChild('dialog', { static: true }) dialog!: ElementRef<HTMLDialogElement>;
  title = ''; teamId = ''; startDate = nextWorkingDay(today()); workingDays: number | null = 5; scheduled = true;
  error = ''; scheduleError = '';
  open(): void {
    this.title = ''; this.teamId = [...this.store.document().teams].sort((a, b) => a.order - b.order)[0]?.id ?? '';
    this.startDate = nextWorkingDay(today()); this.workingDays = 5; this.scheduled = true; this.resetErrors();
    this.opened.set(true); this.changeDetector.detectChanges(); this.dialog.nativeElement.showModal();
  }
  close(): void { this.dialog.nativeElement.close(); this.opened.set(false); }
  onClosed(): void { this.opened.set(false); this.resetErrors(); }
  resetErrors(): void { this.error = ''; this.scheduleError = ''; }
  private endDate(): string {
    validateRange(this.startDate, this.startDate);
    if (!Number.isSafeInteger(this.workingDays) || Number(this.workingDays) < 1 || Number(this.workingDays) > 10000) {
      throw new Error('יש להזין מספר שלם של ימי עבודה, בין 1 ל־10,000');
    }
    const end = addWorkingDays(this.startDate, Number(this.workingDays) - 1); validateRange(this.startDate, end); return end;
  }
  endLabel(): string { try { return formatDate(this.endDate()); } catch { return '—'; } }
  checkSchedule(): void { this.scheduleError = ''; try { this.endDate(); } catch (error) { this.scheduleError = (error as Error).message; } }
  save(): void {
    this.error = ''; if (!this.title.trim()) { this.error = 'יש להזין כותרת עבודה'; return; }
    if (!this.store.loaded() || this.store.importing()) return;
    if (this.scheduled) { this.checkSchedule(); if (this.scheduleError) return; }
    try {
      const doc = clone(this.store.document()), id = uid(), title = this.title.trim();
      if (this.scheduled && !doc.teams.some(t => t.id === this.teamId)) throw new Error('יש לבחור צוות אחראי');
      doc.workItems.push({ id, title, order: Math.max(-1, ...doc.workItems.map(w => w.order)) + 1 });
      if (this.scheduled) doc.tasks.push({
        planningState: 'scheduled', id: uid(), workItemId: id, teamId: this.teamId, title, startDate: this.startDate, endDate: this.endDate(),
        color: palette[0], status: 'planned', notes: '', order: 0
      });
      this.store.commit(doc, this.scheduled ? `העבודה נוצרה · ${this.workingDays} ימי עבודה · סיום ${this.endLabel()}` : 'העבודה נוספה ללא משימות');
      this.close(); this.created.emit({ id, startDate: this.scheduled ? this.startDate : undefined });
    } catch (error) { this.error = (error as Error).message; }
  }
}
