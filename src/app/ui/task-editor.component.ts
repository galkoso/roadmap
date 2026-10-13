import { ChangeDetectionStrategy, Component, effect, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RoadmapStore } from '../core/store';
import { clone, Dependency, palette, Task, uid } from '../core/model';
import { duration, formatDate, nextWorkingDay, today, validateRange } from '../core/dates';
import { editTask, setIncoming } from '../core/scheduler';
@Component({
  selector: 'app-task-editor', standalone: true, imports: [FormsModule], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (draft) {
      <section class="editor-panel" aria-label="עריכת משימה"><div class="panel-heading"><div><span class="eyebrow">{{ newTask() ? 'משימה חדשה' : 'פרטי המשימה' }}</span><h2>{{ draft.title || 'משימה חדשה' }}</h2></div><button class="icon-button" aria-label="סגירת עריכת משימה" (click)="close.emit()">×</button></div>
      <form (ngSubmit)="save()" class="task-form">
        <div class="form-main"><label>שם המשימה<input name="title" [(ngModel)]="draft.title" required maxlength="200"></label>
          <div class="field-grid"><label>צוות אחראי<select aria-label="צוות אחראי" name="team" [(ngModel)]="draft.teamId">@for (team of store.document().teams; track team.id) { <option [value]="team.id">{{ team.name }}</option> }</select></label>
          <label>סטטוס<select aria-label="סטטוס" name="status" [(ngModel)]="draft.status"><option value="planned">מתוכננת</option><option value="in_progress">בביצוע</option><option value="completed">הושלמה</option></select></label>
          <label>תאריך התחלה<input type="date" name="start" [(ngModel)]="draft.startDate" (ngModelChange)="checkDates()" dir="ltr"></label>
          <label>תאריך סיום<input type="date" name="end" [(ngModel)]="draft.endDate" (ngModelChange)="checkDates()" dir="ltr"></label></div>
          @if (dateError) { <p class="field-error" role="alert">{{ dateError }}</p> } @else { <p class="field-hint">{{ length() }} ימי עבודה · ראשון–חמישי · הסיום כולל</p> }
          <label>תיאור / הערות<textarea name="notes" [(ngModel)]="draft.notes" rows="3" placeholder="פרטים שכדאי לזכור…"></textarea></label>
        </div>
        <div class="form-side"><label>צבע המשימה</label><div class="color-palette">@for (color of colors; track color) { <button type="button" [style.background]="color" [class.chosen]="draft.color === color" [attr.aria-label]="'בחירת צבע ' + color" (click)="draft.color = color"></button> }<input type="color" name="color" [(ngModel)]="draft.color" aria-label="צבע מותאם אישית"></div>
          <h3>תלויה במשימות</h3><p class="field-hint">סיום–להתחלה · המרווח בימי עבודה</p>
          <div class="dependency-picker">@for (task of candidates(); track task.id) {
            <div class="dependency-option"><label class="check-label"><input type="checkbox" [checked]="hasDependency(task.id)" (change)="toggleDependency(task.id)"><span>{{ task.title }}<small>{{ teamName(task.teamId) }} · סיום {{ formatted(task.endDate) }}</small></span></label>
              @if (hasDependency(task.id)) { <label class="lag-label">מרווח<input type="number" min="0" max="10000" [name]="'lag-' + task.id" [ngModel]="lag(task.id)" (ngModelChange)="setLag(task.id, $event)" dir="ltr"></label> }
            </div>
          } @empty { <p class="field-hint">אין משימות נוספות בעבודה זו</p> }</div>
        </div>
        @if (error) { <p class="field-error form-error" role="alert">{{ error }}</p> }
        <div class="form-actions"><button class="primary" type="submit" [disabled]="!!dateError">{{ newTask() ? 'הוספת משימה' : 'שמירת השינויים' }}</button><button type="button" (click)="close.emit()">ביטול</button>@if (!newTask()) { <button class="danger text-button" type="button" (click)="remove()">מחיקת משימה</button> }<span class="field-hint">השינויים נשמרים רק לאחר אישור הטופס</span></div>
      </form></section>
    }
  `
})
export class TaskEditorComponent {
  readonly store = inject(RoadmapStore); readonly taskId = input<string | null>(null); readonly workId = input<string | null>(null);
  readonly newTask = input(false); readonly close = output<void>(); readonly deleteTask = output<string>(); readonly colors = palette; readonly formatted = formatDate;
  draft: Task | null = null; incoming: Dependency[] = []; error = ''; dateError = ''; private original: Task | null = null; private originalIncoming: Dependency[] = [];
  constructor() {
    effect(() => {
      const id = this.taskId(), workId = this.workId(), isNew = this.newTask();
      // Read data once per selection; committed changes elsewhere never overwrite a partially edited form.
      const doc = this.store.document();
      if (this.draft && this.draft.id === id && !isNew) return;
      if (isNew && workId && this.draft?.workItemId === workId && !this.original) return;
      const task = isNew && workId ? { id: uid(), workItemId: workId, teamId: doc.teams[0].id, title: '', startDate: nextWorkingDay(today()), endDate: nextWorkingDay(today()), color: palette[0], status: 'planned' as const, notes: '', order: doc.tasks.length } : doc.tasks.find(t => t.id === id);
      this.draft = task ? clone(task) : null; this.original = isNew ? null : this.draft ? clone(this.draft) : null;
      this.incoming = clone(doc.dependencies.filter(d => d.successorId === id)); this.originalIncoming = clone(this.incoming); this.error = ''; this.checkDates();
    });
  }
  candidates(): Task[] { return this.store.document().tasks.filter(t => t.workItemId === this.draft?.workItemId && t.id !== this.draft?.id); }
  teamName(id: string): string { return this.store.document().teams.find(t => t.id === id)?.name ?? ''; }
  hasDependency(id: string): boolean { return this.incoming.some(d => d.predecessorId === id); }
  lag(id: string): number { return this.incoming.find(d => d.predecessorId === id)!.lagWorkingDays; }
  setLag(id: string, value: number): void { this.incoming.find(d => d.predecessorId === id)!.lagWorkingDays = value; }
  toggleDependency(id: string): void {
    this.incoming = this.hasDependency(id) ? this.incoming.filter(d => d.predecessorId !== id) : [...this.incoming, { id: uid(), predecessorId: id, successorId: this.draft!.id, type: 'finish_to_start', lagWorkingDays: 0 }];
  }
  checkDates(): void { this.dateError = ''; if (this.draft) try { validateRange(this.draft.startDate, this.draft.endDate); } catch (error) { this.dateError = (error as Error).message; } }
  length(): number { try { return this.draft ? duration(this.draft.startDate, this.draft.endDate) : 0; } catch { return 0; } }
  save(): void {
    if (!this.draft) return; this.error = ''; this.checkDates(); if (this.dateError) return;
    if (!this.draft.title.trim()) { this.error = 'יש להזין שם משימה'; return; }
    try {
      let doc = clone(this.store.document());
      if (this.newTask()) doc.tasks.push(clone(this.draft));
      else {
        const current = doc.tasks.find(t => t.id === this.draft!.id); if (!current) throw new Error('המשימה כבר נמחקה');
        const patch: Partial<Task> = {};
        for (const key of ['title', 'teamId', 'startDate', 'endDate', 'color', 'status', 'notes'] as const) {
          if (this.draft[key] !== this.original?.[key]) Object.assign(patch, { [key]: this.draft[key] });
        }
        doc = editTask(doc, this.draft.id, patch);
      }
      const incoming = this.incoming.map(d => { const old = this.originalIncoming.find(o => o.id === d.id), scheduled = doc.dependencies.find(o => o.id === d.id); return old && scheduled && old.lagWorkingDays === d.lagWorkingDays ? { ...d, lagWorkingDays: scheduled.lagWorkingDays } : d; });
      doc = setIncoming(doc, this.draft.id, incoming);
      const before = this.store.document();
      const changed = doc.tasks.filter(t => t.id !== this.draft!.id && before.tasks.some(o => o.id === t.id && (o.startDate !== t.startDate || o.endDate !== t.endDate))).map(t => t.title);
      const actual = doc.tasks.find(t => t.id === this.draft!.id)!;
      const snapped = actual.startDate !== this.draft.startDate;
      this.store.commit(doc, `המשימה נשמרה${snapped ? ' · הוצמדה למועד חוקי: ' + formatDate(actual.startDate) : ''}${changed.length ? ' · עודכנו: ' + changed.join(', ') : ''}`); this.close.emit();
    } catch (error) { this.error = (error as Error).message; }
  }
  remove(): void { if (this.draft) this.deleteTask.emit(this.draft.id); }
}
