import { executionSchedule, overlappingTasks, rangeEffort, requiredEffort } from '../core/availability';
import { ChangeDetectionStrategy, Component, effect, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AssigneeFieldComponent } from './assignee-field.component';
import { changeTaskTeam } from '../core/members';
import { RoadmapStore } from '../core/store';
import { clone, Dependency, isScheduled, palette, ScheduledTask, Task, uid } from '../core/model';
import { daysBetween, formatDate, nextWorkingDay, today } from '../core/dates';
import { editTask, returnToBacklog, setIncoming } from '../core/scheduler';
@Component({
  selector: 'app-task-editor', standalone: true, imports: [FormsModule, AssigneeFieldComponent], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (draft) {
      <section class="editor-panel" aria-label="עריכת משימה"><div class="panel-heading"><div><span class="eyebrow">{{ newTask() ? 'משימה חדשה' : 'פרטי המשימה' }}</span><h2>{{ draft.title || 'משימה חדשה' }}</h2></div><button class="icon-button" aria-label="סגירת עריכת משימה" (click)="close.emit()">×</button></div>
      <form (ngSubmit)="save()" class="task-form">
        <div class="form-main">@if (newTask()) { <label class="check-label schedule-toggle"><input type="checkbox" name="save-as-backlog" [(ngModel)]="saveAsBacklog">הוספה לבקלוג</label>@if (saveAsBacklog) { <label>משך משוער בימי עבודה<input type="number" name="backlog-days" [(ngModel)]="backlogWorkingDays" min="1" max="10000" step="1" dir="ltr" required></label> } }<label>שם המשימה<input name="title" [(ngModel)]="draft.title" required maxlength="200"></label>
          <div class="field-grid"><label>צוות אחראי<select aria-label="צוות אחראי" name="team" [ngModel]="draft.teamId" (ngModelChange)="changeTeam($event)"><option [ngValue]="null">ללא צוות</option>@for (team of store.document().teams; track team.id) { <option [value]="team.id">{{ team.name }}</option> }</select></label>
          <app-assignee-field [task]="draft" (changed)="draft.assigneeId = $event; checkDates()"/>
          @if (assignmentMessage) { <p class="field-hint" role="status">{{ assignmentMessage }}</p> }
          <label>כותרת<select aria-label="כותרת" name="work" [(ngModel)]="draft.workItemId"><option [ngValue]="null">ללא כותרת</option>@for (work of availableHeadings(); track work.id) { <option [value]="work.id">{{ work.title }}</option> }</select></label><label>סטטוס<select aria-label="סטטוס" name="status" [(ngModel)]="draft.status"><option value="planned">מתוכננת</option><option value="in_progress">בביצוע</option><option value="completed">הושלמה</option></select></label>
          @if (!saveAsBacklog) { <label>תאריך התחלה<input type="date" name="start" [(ngModel)]="draft.requestedStartDate" (ngModelChange)="checkDates()" dir="ltr"></label>
          <label>היקף בימי עבודה<input type="number" name="effort" [(ngModel)]="draft.effortWorkingDays" min="1" max="10000" step="1" (ngModelChange)="checkDates()"></label><label>תאריך סיום<input type="date" name="end" [(ngModel)]="draft.endDate" (ngModelChange)="checkDates(true)" dir="ltr"></label> }</div>
          @if (saveAsBacklog) { <p class="field-hint">המשימה תישמר בבקלוג ללא תאריכים ולא תופיע בציר הזמן עד לשיבוץ.</p> } @else if (dateError) { <p class="field-error" role="alert">{{ dateError }}</p> } @else { <p class="field-hint">{{ length() }} ימי עבודה · {{ elapsed() }} ימים קלנדריים · התחלה בפועל {{ formatted(draft.startDate) }}</p> }
          @if (!draft.assigneeId) { <p class="field-hint">ללא אחראי — זמינות אישית לא הוחלה</p> }
          @if (draft.scheduleIssue) { <p class="field-error" role="alert">{{ draft.scheduleIssue }}</p> }
          @if (overlaps()) { <p class="field-hint" role="status">אזהרה: ימי ביצוע חופפים עם {{ overlaps() }}</p> }
          <details class="field-hint"><summary>ימי ביצוע וימים שדולגו</summary><p>{{ executionDetail() }}</p></details>
          <label>תיאור / הערות<textarea name="notes" [(ngModel)]="draft.notes" rows="3" placeholder="פרטים שכדאי לזכור…"></textarea></label>
        </div>
        <div class="form-side"><label>צבע המשימה</label><div class="color-palette">@for (color of colors; track color) { <button type="button" [style.background]="color" [class.chosen]="draft.color === color" [attr.aria-label]="'בחירת צבע ' + color" (click)="draft.color = color"></button> }<input type="color" name="color" [(ngModel)]="draft.color" aria-label="צבע מותאם אישית"></div>
          <h3>תלויה במשימות</h3><p class="field-hint">סיום–להתחלה · המרווח בימי עבודה</p>
          <div class="dependency-picker">@for (task of candidates(); track task.id) {
            <div class="dependency-option"><label class="check-label"><input type="checkbox" [checked]="hasDependency(task.id)" (change)="toggleDependency(task.id)"><span>{{ task.title }}<small>{{ teamName(task.teamId) }} · {{ candidateDate(task) }}</small></span></label>
              @if (hasDependency(task.id)) { <label class="lag-label">מרווח<input type="number" min="0" max="10000" [name]="'lag-' + task.id" [ngModel]="lag(task.id)" (ngModelChange)="setLag(task.id, $event)" dir="ltr"></label> }
            </div>
          } @empty { <p class="field-hint">אין משימות נוספות בעבודה זו</p> }</div>
        </div>
        @if (error) { <p class="field-error form-error" role="alert">{{ error }}</p> }
        <div class="form-actions"><button class="primary" type="submit" [disabled]="!saveAsBacklog && !!dateError">{{ newTask() ? 'הוספת משימה' : 'שמירת השינויים' }}</button><button type="button" (click)="close.emit()">ביטול</button>@if (!newTask()) { <button class="danger text-button" type="button" (click)="remove()">מחיקת משימה</button><button type="button" (click)="toBacklog()">החזרה לבקלוג</button> }<span class="field-hint">השינויים נשמרים רק לאחר אישור הטופס</span></div>
      </form></section>
    }
  `
})
export class TaskEditorComponent {
  readonly store = inject(RoadmapStore); readonly taskId = input<string | null>(null); readonly workId = input<string | null>(null);
  readonly newTask = input(false); readonly close = output<void>(); readonly deleteTask = output<string>(); readonly colors = palette; readonly formatted = formatDate;
  assignmentMessage = '';
  changeTeam(teamId: string | null): void { if (this.draft) this.assignmentMessage = changeTaskTeam(this.store.document(), this.draft, teamId) ? 'האחראי הוסר כי אינו שייך לצוות החדש' : ''; this.checkDates(); }
  saveAsBacklog = false; backlogWorkingDays: number | null = 5;
  draft: ScheduledTask | null = null; incoming: Dependency[] = []; error = ''; dateError = ''; private original: ScheduledTask | null = null; private originalIncoming: Dependency[] = [];
  constructor() {
    effect(() => {
      const id = this.taskId(), workId = this.workId(), isNew = this.newTask();
      // Read data once per selection; committed changes elsewhere never overwrite a partially edited form.
      const doc = this.store.document();
      if (this.draft && this.draft.id === id && !isNew) return;
      if (isNew && workId && this.draft?.workItemId === (workId === '__standalone__' ? null : workId) && !this.original) return;
      const task = isNew && workId ? { assigneeId: null, planningState: 'scheduled' as const, id: uid(), workItemId: workId === '__standalone__' ? null : workId, teamId: doc.workItems.find(w => w.id === workId)?.teamId ?? doc.teams[0].id, title: '', startDate: nextWorkingDay(today()), endDate: nextWorkingDay(today()), color: palette[0], status: 'planned' as const, notes: '', order: doc.tasks.length } : doc.tasks.filter(isScheduled).find(t => t.id === id);
      this.draft = task ? clone(task) : null; this.original = isNew ? null : this.draft ? clone(this.draft) : null;
      this.incoming = clone(doc.dependencies.filter(d => d.successorId === id)); this.originalIncoming = clone(this.incoming); this.error = ''; this.assignmentMessage = ''; this.saveAsBacklog = false; this.backlogWorkingDays = 5;
      if (this.draft) { this.draft.requestedStartDate ??= this.draft.startDate; this.draft.effortWorkingDays ??= requiredEffort(this.draft); }
      if (!isNew && this.draft) this.original = clone(this.draft);
      this.dateError = '';
    });
  }
  availableHeadings() { return this.store.document().workItems.filter(w => w.teamId === undefined || w.teamId === this.draft?.teamId); }
  candidates(): Task[] { return this.store.document().tasks.filter(t => !!this.draft?.workItemId && t.workItemId === this.draft.workItemId && t.id !== this.draft?.id); }
  teamName(id: string | null): string { return this.store.document().teams.find(t => t.id === id)?.name ?? 'ללא צוות'; }
  candidateDate(task: Task): string { return isScheduled(task) ? 'סיום ' + formatDate(task.endDate) : 'בבקלוג · טרם שובצה'; }
  hasUnsavedChanges(): boolean { return !!this.draft && (!this.original || JSON.stringify(this.draft) !== JSON.stringify(this.original) || JSON.stringify(this.incoming) !== JSON.stringify(this.originalIncoming)); }
  hasDependency(id: string): boolean { return this.incoming.some(d => d.predecessorId === id); }
  lag(id: string): number { return this.incoming.find(d => d.predecessorId === id)!.lagWorkingDays; }
  setLag(id: string, value: number): void { this.incoming.find(d => d.predecessorId === id)!.lagWorkingDays = value; }
  toggleDependency(id: string): void {
    this.incoming = this.hasDependency(id) ? this.incoming.filter(d => d.predecessorId !== id) : [...this.incoming, { id: uid(), predecessorId: id, successorId: this.draft!.id, type: 'finish_to_start', lagWorkingDays: 0 }];
  }
  checkDates(resize = false): void {
    this.dateError = ''; if (!this.draft) return;
    try {
      if (resize) this.draft.effortWorkingDays = rangeEffort(this.store.document(), this.draft.assigneeId, this.draft.startDate, this.draft.endDate);
      const doc = clone(this.store.document()), task = this.draft;
      if (!doc.tasks.some(t => t.id === task.id)) doc.tasks.push(clone(task));
      const next = editTask(doc, task.id, { requestedStartDate: task.requestedStartDate ?? task.startDate, effortWorkingDays: requiredEffort(task), assigneeId: task.assigneeId, teamId: task.teamId });
      const actual = next.tasks.find(t => t.id === task.id)!;
      if (isScheduled(actual)) { task.startDate = actual.startDate; task.endDate = actual.endDate; delete task.scheduleIssue; }
    } catch (error) { this.dateError = (error as Error).message; }
  }
  length(): number { try { return this.draft ? requiredEffort(this.draft) : 0; } catch { return 0; } }
  elapsed(): number { return this.draft ? daysBetween(this.draft.startDate, this.draft.endDate) + 1 : 0; }
  overlaps(): string { try { return this.draft ? overlappingTasks(this.store.document(), this.draft).join(', ') : ''; } catch { return ''; } }
  executionDetail(): string {
    try {
      if (!this.draft) return '';
      const schedule = executionSchedule(this.store.document(), this.draft.assigneeId, this.draft.requestedStartDate ?? this.draft.startDate, requiredEffort(this.draft));
      return 'ימי ביצוע: ' + schedule.executionDates.map(formatDate).join(', ') + ' · דולגו: ' + schedule.skippedDates.map(formatDate).join(', ');
    } catch { return ''; }
  }
  save(): void {
    if (!this.draft) return; this.error = '';
    if (this.newTask() || !this.original || ['requestedStartDate', 'effortWorkingDays', 'assigneeId', 'teamId', 'startDate', 'endDate'].some(key => this.draft![key as keyof ScheduledTask] !== this.original![key as keyof ScheduledTask])) this.checkDates();
    if (!this.saveAsBacklog && this.dateError) return;
    if (this.saveAsBacklog && (!Number.isSafeInteger(this.backlogWorkingDays) || Number(this.backlogWorkingDays) < 1 || Number(this.backlogWorkingDays) > 10000)) { this.error = 'משך משוער חייב להיות מספר שלם בין 1 ל־10,000 ימי עבודה'; return; }
    if (!this.draft.title.trim()) { this.error = 'יש להזין שם משימה'; return; }
    try {
      let doc = clone(this.store.document());
      if (this.newTask()) {
        if (this.saveAsBacklog) {
          const { startDate, endDate, requestedStartDate, effortWorkingDays, effortProvenance, scheduleIssue, ...metadata } = clone(this.draft);
          doc.tasks.push({ ...metadata, estimatedWorkingDays: Number(this.backlogWorkingDays), planningState: 'backlog' });
        } else doc.tasks.push(clone(this.draft));
      }
      else {
        const current = doc.tasks.find(t => t.id === this.draft!.id); if (!current) throw new Error('המשימה כבר נמחקה');
        const patch: Partial<ScheduledTask> = {};
        for (const key of ['title', 'teamId', 'assigneeId', 'workItemId', 'startDate', 'endDate', 'requestedStartDate', 'effortWorkingDays', 'color', 'status', 'notes'] as const) {
          if (this.draft[key] !== this.original?.[key]) Object.assign(patch, { [key]: this.draft[key] });
        }
        if ('startDate' in patch || 'endDate' in patch || 'workItemId' in patch || 'assigneeId' in patch || 'teamId' in patch || 'effortWorkingDays' in patch || 'requestedStartDate' in patch) doc = editTask(doc, this.draft.id, { ...patch, requestedStartDate: this.draft.requestedStartDate, effortWorkingDays: this.draft.effortWorkingDays });
        else {
          if (patch.teamId !== undefined && changeTaskTeam(doc, current, patch.teamId))
            this.assignmentMessage = 'האחראי הוסר כי אינו שייך לצוות החדש';
          Object.assign(current, patch);
        }
      }
      const incoming = this.incoming.map(d => { const old = this.originalIncoming.find(o => o.id === d.id), scheduled = doc.dependencies.find(o => o.id === d.id); return old && scheduled && old.lagWorkingDays === d.lagWorkingDays ? { ...d, lagWorkingDays: scheduled.lagWorkingDays } : d; });
      if (JSON.stringify(incoming) !== JSON.stringify(doc.dependencies.filter(d => d.successorId === this.draft!.id)))
        doc = setIncoming(doc, this.draft.id, incoming);
      const before = this.store.document();
      const changed = doc.tasks.filter(t => t.id !== this.draft!.id && before.tasks.some(o => o.id === t.id && (o.startDate !== t.startDate || o.endDate !== t.endDate))).map(t => t.title);
      const actual = doc.tasks.find(t => t.id === this.draft!.id)!;
      if (!isScheduled(actual)) { this.store.commit(doc, 'המשימה נוספה לבקלוג'); this.close.emit(); return; }
      const snapped = actual.startDate !== this.draft.startDate;
      this.store.commit(doc, `המשימה נשמרה${this.assignmentMessage ? ' · ' + this.assignmentMessage : ''}${snapped ? ' · הוצמדה למועד חוקי: ' + formatDate(actual.startDate) : ''}${changed.length ? ' · עודכנו: ' + changed.join(', ') : ''}`); this.close.emit();
    } catch (error) { this.error = (error as Error).message; }
  }
  toBacklog(): void {
    if (!this.draft) return;
    try {
      const doc = returnToBacklog(this.store.document(), this.draft.id);
      if (!confirm('להחזיר את המשימה לבקלוג? תאריכי השיבוץ יוסרו והיא תצא מציר הזמן. שינויים שלא נשמרו בטופס לא ייכללו. אפשר לבטל באמצעות Undo.')) return;
      this.store.commit(doc, 'המשימה הוחזרה לבקלוג'); this.close.emit();
    } catch (error) { this.error = (error as Error).message; }
  }
  remove(): void { if (this.draft) this.deleteTask.emit(this.draft.id); }
}
