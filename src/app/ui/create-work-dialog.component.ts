import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, inject, output, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RoadmapStore } from '../core/store';
import { clone, uid } from '../core/model';
@Component({
  selector: 'app-create-work-dialog', standalone: true, imports: [FormsModule], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog class="create-work-dialog" aria-labelledby="create-work-heading" (close)="onClosed()">
      @if (opened()) {
        <div class="panel-heading"><div><span class="eyebrow">קבוצת משימות תחת צוות</span><h2 id="create-work-heading">{{ editingId ? 'עריכת כותרת' : 'כותרת חדשה' }}</h2></div><button type="button" class="icon-button" aria-label="סגירת עריכת כותרת" (click)="close()">×</button></div>
        <form (ngSubmit)="save()" novalidate>
          <label>שם הכותרת<input name="heading-title" [(ngModel)]="title" required maxlength="200" autofocus></label>
          <label>צוות<select name="heading-team" [(ngModel)]="teamId" aria-label="צוות הכותרת" [disabled]="!!editingId">@for (team of store.document().teams; track team.id) { <option [value]="team.id">{{ team.name }}</option> }</select></label>
          <p class="field-hint">כותרת מארגנת משימות בלבד, ללא תאריכים או ימי עבודה. היא מופיעה בבקלוג ובמפת הדרכים.</p>
          @if (error) { <p class="field-error" role="alert">{{ error }}</p> }
          <div class="form-actions dialog-actions"><button class="primary" type="submit" [disabled]="store.importing() || !store.loaded()">שמירת כותרת</button><button type="button" (click)="close()">ביטול</button>@if (editingId) { <button type="button" class="danger text-button" (click)="remove()">מחיקת כותרת</button> }</div>
        </form>
      }
    </dialog>
  `
})
export class CreateWorkDialogComponent {
  readonly store = inject(RoadmapStore); private readonly changeDetector = inject(ChangeDetectorRef);
  readonly opened = signal(false); readonly created = output<{ id: string; startDate?: string }>();
  @ViewChild('dialog', { static: true }) dialog!: ElementRef<HTMLDialogElement>;
  title = ''; teamId = ''; editingId: string | null = null; error = '';
  open(teamId?: string, id?: string): void {
    const heading = this.store.document().workItems.find(w => w.id === id);
    this.editingId = heading?.id ?? null; this.title = heading?.title ?? '';
    this.teamId = heading?.teamId ?? teamId ?? [...this.store.document().teams].sort((a, b) => a.order - b.order)[0]?.id ?? '';
    this.error = ''; this.opened.set(true); this.changeDetector.detectChanges(); this.dialog.nativeElement.showModal();
  }
  close(): void { this.dialog.nativeElement.close(); this.opened.set(false); }
  onClosed(): void { this.opened.set(false); this.error = ''; }
  save(): void {
    this.error = ''; if (!this.title.trim()) { this.error = 'יש להזין שם כותרת'; return; }
    if (!this.store.loaded() || this.store.importing()) return;
    try {
      const doc = clone(this.store.document()), id = this.editingId ?? uid();
      if (!doc.teams.some(t => t.id === this.teamId)) throw new Error('יש לבחור צוות');
      if (this.editingId) {
        const heading = doc.workItems.find(w => w.id === id); if (!heading) throw new Error('הכותרת כבר נמחקה');
        heading.title = this.title.trim();
      } else doc.workItems.push({ id, title: this.title.trim(), teamId: this.teamId, order: Math.max(-1, ...doc.workItems.map(w => w.order)) + 1 });
      this.store.commit(doc, 'הכותרת נשמרה'); this.close(); this.created.emit({ id });
    } catch (error) { this.error = (error as Error).message; }
  }
  remove(): void {
    if (!this.editingId || !confirm('למחוק את הכותרת? המשימות יישארו תחת הצוות ללא כותרת. קשרי התלות שלהן יוסרו.')) return;
    const doc = clone(this.store.document());
    const ids = new Set(doc.tasks.filter(t => t.workItemId === this.editingId).map(t => t.id));
    for (const task of doc.tasks) if (ids.has(task.id)) task.workItemId = null;
    doc.dependencies = doc.dependencies.filter(d => !ids.has(d.predecessorId) && !ids.has(d.successorId));
    doc.workItems = doc.workItems.filter(w => w.id !== this.editingId);
    this.store.commit(doc, 'הכותרת נמחקה; המשימות נשמרו'); this.close();
  }
}
