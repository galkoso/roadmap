import { overlappingTasks } from '../core/availability';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, HostListener, inject, output, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AssigneeFieldComponent } from './assignee-field.component';
import { changeTaskTeam } from '../core/members';
import { RoadmapStore } from '../core/store';
import { BacklogTask, clone, Dependency, isScheduled, palette, statuses, Task, uid } from '../core/model';
import { daysBetween, formatDate, nextWorkingDay, today } from '../core/dates';
import { requiredStart, scheduleTask, ScheduleOptions } from '../core/scheduler';
@Component({
  selector: 'app-backlog-task-dialog', standalone: true, imports: [FormsModule, AssigneeFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush, templateUrl: './backlog-task-dialog.component.html'
})
export class BacklogTaskDialogComponent {
  readonly store = inject(RoadmapStore); private readonly changeDetector = inject(ChangeDetectorRef);
  @ViewChild('dialog', { static: true }) dialog!: ElementRef<HTMLDialogElement>;
  readonly created = output<BacklogTask>(); readonly scheduled = output<string>();
  readonly draft = signal<BacklogTask | null>(null); readonly mode = signal<'edit' | 'schedule'>('edit');
  readonly error = signal(''); readonly colors = palette;
  readonly statusOptions = Object.entries(statuses); readonly formatted = formatDate; readonly span = daysBetween;
  incoming: Dependency[] = []; startDate = nextWorkingDay(today()); workingDays: number | null = 5;
  private original = ''; private isNew = false;
  assignmentMessage = '';
  draftTeam(item: BacklogTask, teamId: string | null): void {
    this.assignmentMessage = changeTaskTeam(this.store.document(), item, teamId) ? 'האחראי הוסר כי אינו שייך לצוות החדש' : '';
  }
  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent): void {
    if (this.draft() && this.original !== this.fingerprint()) { event.preventDefault(); event.returnValue = ''; }
  }
  canDeactivate(): boolean {
    if (this.draft() && this.original !== this.fingerprint() && !confirm('יש שינויים שלא נשמרו. לעבור לעמוד אחר ולבטל אותם?')) return false;
    return true;
  }
  private fingerprint(): string { return JSON.stringify([this.draft(), this.incoming, this.startDate, this.workingDays]); }
  isNewItem(): boolean { return this.isNew; }
  statusLabel(status: Task['status']): string { return statuses[status]; }
  availableHeadings(teamId: string | null) { return this.store.document().workItems.filter(w => w.teamId === undefined || w.teamId === teamId); }
  workName(id: string | null): string { return this.store.document().workItems.find(w => w.id === id)?.title ?? 'פריט עצמאי'; }
  teamName(id: string | null): string { return this.store.document().teams.find(t => t.id === id)?.name ?? 'ללא צוות'; }
  predecessor(id: string): Task | undefined { return this.store.document().tasks.find(t => t.id === id); }
  open(item?: BacklogTask, schedule = false, workId?: string, teamId?: string | null, initialStart?: string): void {
    this.assignmentMessage = ''; this.isNew = !item; this.mode.set(schedule ? 'schedule' : 'edit'); this.error.set('');
    this.draft.set(item ? clone(item) : { assigneeId: null, id: uid(), planningState: 'backlog', estimatedWorkingDays: 5, teamId: null, workItemId: null, title: '', color: palette[0], status: 'planned', notes: '', order: Math.max(-1, ...this.store.document().tasks.map(t => t.order)) + 1 });
    if (workId && !item) { const heading = this.store.document().workItems.find(w => w.id === workId); this.draft.update(t => t ? { ...t, workItemId: workId, teamId: teamId !== undefined ? teamId : heading?.teamId ?? null } : t); }
    this.incoming = clone(this.store.document().dependencies.filter(d => d.successorId === item?.id));
    this.startDate = initialStart ?? nextWorkingDay(today()); this.workingDays = item?.estimatedWorkingDays ?? 5;
    if (schedule && item) try { const min = requiredStart(this.store.document(), item.id); if (min && min > this.startDate) this.startDate = min; } catch { /* blockers are explained in the preview */ }
    this.original = this.fingerprint(); this.changeDetector.detectChanges(); this.dialog.nativeElement.showModal();
  }
  close(): void { this.dialog.nativeElement.close(); this.draft.set(null); this.error.set(''); }
  nativeClose(): void { this.draft.set(null); this.error.set(''); }
  removeDependency(id: string): void { this.incoming = this.incoming.filter(d => d.id !== id); }
  save(): void {
    const draft = this.draft(); if (!draft || this.store.importing()) return; this.error.set('');
    if (!Number.isSafeInteger(this.workingDays) || Number(this.workingDays) < 1 || Number(this.workingDays) > 10000) { this.error.set('משך משוער חייב להיות מספר שלם בין 1 ל־10,000 ימי עבודה'); return; }
    if (!draft.title.trim()) { this.error.set('יש להזין כותרת'); return; }
    try {
      const doc = clone(this.store.document()), index = doc.tasks.findIndex(t => t.id === draft.id);
      if (!this.isNew && (index < 0 || isScheduled(doc.tasks[index]))) throw new Error('הפריט אינו בבקלוג יותר');
      const saved = { ...clone(draft), estimatedWorkingDays: Number(this.workingDays), title: draft.title.trim() };
      if (index >= 0) doc.tasks[index] = saved; else doc.tasks.push(saved);
      const keep = new Set(this.incoming.map(d => d.id));
      doc.dependencies = doc.dependencies.filter(d => d.successorId !== draft.id || keep.has(d.id));
      this.store.commit(doc, 'הפריט נשמר בבקלוג'); if (this.isNew) this.created.emit(saved); this.close();
    } catch (error) { this.error.set((error as Error).message); }
  }
  schedulePreview(): { document?: ReturnType<typeof scheduleTask>; start?: string; end?: string; changed: string[]; overlaps?: string[]; error?: string } {
    const draft = this.draft(); if (!draft) return { changed: [] };
    try {
      const options: ScheduleOptions = { startDate: this.startDate, workingDays: Number(this.workingDays), teamId: draft.teamId, workItemId: draft.workItemId };
      const source = clone(this.store.document()), index = source.tasks.findIndex(t => t.id === draft.id);
      if (index >= 0) source.tasks[index] = clone(draft);
      const document = scheduleTask(source, draft.id, options), task = document.tasks.find(t => t.id === draft.id)!;
      const changed = document.tasks.filter(isScheduled).filter(t => t.id !== draft.id && this.store.document().tasks.some(o => o.id === t.id && (o.startDate !== t.startDate || o.endDate !== t.endDate))).map(t => t.title);
      return { document, start: task.startDate, end: task.endDate, changed, overlaps: isScheduled(task) ? overlappingTasks(document, task) : [] };
    } catch (error) { return { error: (error as Error).message, changed: [] }; }
  }
  schedule(): void {
    const preview = this.schedulePreview(); if (!preview.document || this.store.importing()) return;
    try { const id = this.draft()!.id; this.store.commit(preview.document, 'הפריט שובץ בציר הזמן'); this.close(); this.scheduled.emit(id); }
    catch (error) { this.error.set((error as Error).message); }
  }
  remove(item: BacklogTask): void {
    const doc = clone(this.store.document()), links = doc.dependencies.filter(d => d.predecessorId === item.id || d.successorId === item.id);
    if (!confirm(`למחוק את ״${item.title}״ ואת ${links.length} קשרי התלות שלה? העבודה הקשורה ושאר הפריטים יישארו.`)) return;
    doc.tasks = doc.tasks.filter(t => t.id !== item.id); doc.dependencies = doc.dependencies.filter(d => !links.includes(d));
    this.store.commit(doc, 'הפריט וקשריו נמחקו מהבקלוג'); if (this.draft()?.id === item.id) this.close();
  }
}
