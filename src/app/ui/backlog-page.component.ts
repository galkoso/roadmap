import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, computed, effect, ElementRef, HostListener, inject, signal, ViewChild
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AssigneeFieldComponent } from './assignee-field.component';
import { CreateWorkDialogComponent } from './create-work-dialog.component';
import { MembersDialogComponent } from './members-dialog.component';
import { changeTaskTeam, groupByPeople } from '../core/members';
import { RoadmapStore } from '../core/store';
import { BacklogTask, clone, Dependency, isScheduled, palette, statuses, Task, uid } from '../core/model';
import { formatDate, nextWorkingDay, today } from '../core/dates';
import { requiredStart, scheduleTask, ScheduleOptions } from '../core/scheduler';
interface BacklogGroup { key: string; name: string; tasks: BacklogTask[] }
@Component({
  selector: 'app-backlog', standalone: true, imports: [FormsModule, NgTemplateOutlet, AssigneeFieldComponent, MembersDialogComponent, CreateWorkDialogComponent], changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './backlog-page.component.html'
})
export class BacklogPageComponent implements AfterViewInit {
  readonly store = inject(RoadmapStore); private readonly router = inject(Router); private readonly changeDetector = inject(ChangeDetectorRef);
  @ViewChild('dialog', { static: true }) dialog!: ElementRef<HTMLDialogElement>;
  @ViewChild('list') list?: ElementRef<HTMLDivElement>;
  readonly tasks = computed(() => this.store.document().tasks.filter((t): t is BacklogTask => !isScheduled(t)).sort((a, b) => a.order - b.order));
  readonly view = computed(() => this.store.preferences().backlog ?? { mode: 'teams' as const, collapsed: [], scrollTop: 0 });
  readonly groups = computed<BacklogGroup[]>(() => [
    ...[...this.store.document().teams].sort((a, b) => a.order - b.order).map(team => ({ key: 'team:' + team.id, name: team.name, tasks: this.tasks().filter(t => t.teamId === team.id) })),
    { key: 'unassigned', name: 'ללא צוות', tasks: this.tasks().filter(t => t.teamId === null) }
  ]);
  readonly peopleGroups = computed(() => groupByPeople(this.store.document(), this.tasks()));
  readonly draft = signal<BacklogTask | null>(null); readonly mode = signal<'edit' | 'schedule'>('edit');
  readonly error = signal(''); readonly lastScheduled = signal<string | null>(null); readonly colors = palette;
  readonly durationError = signal<{ id: string; message: string } | null>(null);
  readonly statusOptions = Object.entries(statuses); readonly formatted = formatDate;
  incoming: Dependency[] = []; startDate = nextWorkingDay(today()); workingDays: number | null = 5;
  private original = ''; private isNew = false;
  constructor() { effect(() => { if (this.store.loaded()) setTimeout(() => { if (this.list) this.list.nativeElement.scrollTop = this.view().scrollTop; }, 0); }); }
  ngAfterViewInit(): void { setTimeout(() => { if (this.list) this.list.nativeElement.scrollTop = this.view().scrollTop; }, 0); }
  setView(mode: 'teams' | 'people' | 'list'): void { this.store.setPreferences({ backlog: { ...this.view(), mode } }); }
  toggle(key: string): void {
    const view = this.view(), keys = this.collapsedKeys(), collapsed = keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key];
    this.store.setPreferences({ backlog: { ...view, ...(view.mode === 'people' ? { peopleCollapsed: collapsed } : { collapsed }) } });
  }
  collapsedKeys(): string[] { return this.view().mode === 'people' ? this.view().peopleCollapsed ?? [] : this.view().collapsed; }
  assignmentMessage = '';
  draftTeam(item: BacklogTask, teamId: string | null): void {
    this.assignmentMessage = changeTaskTeam(this.store.document(), item, teamId) ? 'האחראי הוסר כי אינו שייך לצוות החדש' : '';
  }
  @HostListener('document:keydown', ['$event']) keyboard(event: KeyboardEvent): void {
    if ((event.target as HTMLElement)?.closest('input, textarea, select, dialog[open]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); event.shiftKey ? this.store.redo() : this.store.undo(); this.lastScheduled.set(null);
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); this.store.redo(); }
  }
  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent): void {
    if (this.draft() && this.original !== this.fingerprint()) { event.preventDefault(); event.returnValue = ''; }
  }
  canDeactivate(): boolean {
    if (this.draft() && this.original !== this.fingerprint() && !confirm('יש שינויים שלא נשמרו. לעבור לעמוד אחר ולבטל אותם?')) return false;
    if (this.list) this.store.setPreferences({ backlog: { ...this.view(), scrollTop: this.list.nativeElement.scrollTop } }); return true;
  }
  private fingerprint(): string { return JSON.stringify([this.draft(), this.incoming, this.startDate, this.workingDays]); }
  isNewItem(): boolean { return this.isNew; }
  statusLabel(status: Task['status']): string { return statuses[status]; }
  workGroups(tasks: BacklogTask[], teamId: string | null): { key: string; name: string; tasks: BacklogTask[] }[] {
    return [...this.store.document().workItems].filter(w => w.teamId === teamId || (w.teamId === undefined && tasks.some(t => t.workItemId === w.id))).sort((a, b) => a.order - b.order)
      .map(w => ({ key: w.id, name: w.title, tasks: tasks.filter(t => t.workItemId === w.id) }))
      .concat([{ key: 'standalone', name: 'פריטים עצמאיים', tasks: tasks.filter(t => t.workItemId === null) }]).filter(g => g.key !== 'standalone' || g.tasks.length);
  }
  availableHeadings(teamId: string | null) { return this.store.document().workItems.filter(w => w.teamId === undefined || w.teamId === teamId); }
  workName(id: string | null): string { return this.store.document().workItems.find(w => w.id === id)?.title ?? 'פריט עצמאי'; }
  teamName(id: string | null): string { return this.store.document().teams.find(t => t.id === id)?.name ?? 'ללא צוות'; }
  predecessor(id: string): Task | undefined { return this.store.document().tasks.find(t => t.id === id); }
  totalWorkingDays(tasks: BacklogTask[]): string {
    const total = tasks.reduce((sum, task) => sum + (task.estimatedWorkingDays ?? 0), 0);
    const missing = tasks.filter(task => task.estimatedWorkingDays === undefined).length;
    return `${total} ימי עבודה` + (missing ? ` · ${missing} ללא משך` : '');
  }
  changeDuration(item: BacklogTask, input: HTMLInputElement): void {
    this.durationError.set(null);
    const days = input.valueAsNumber;
    const reject = (message: string) => {
      input.value = item.estimatedWorkingDays?.toString() ?? '';
      this.durationError.set({ id: item.id, message });
    };
    if (!Number.isSafeInteger(days) || days < 1 || days > 10000) {
      reject('משך משוער חייב להיות מספר שלם בין 1 ל־10,000 ימי עבודה'); return;
    }
    if (this.store.importing()) { input.value = item.estimatedWorkingDays?.toString() ?? ''; return; }
    const doc = clone(this.store.document()), task = doc.tasks.find(t => t.id === item.id);
    if (!task || isScheduled(task) || task.estimatedWorkingDays === days) return;
    task.estimatedWorkingDays = days;
    try { this.store.commit(doc, 'משך המשימה עודכן'); }
    catch (error) { reject((error as Error).message); }
  }
  changeTeam(item: BacklogTask, teamId: string | null): void {
    const doc = clone(this.store.document()), task = doc.tasks.find(t => t.id === item.id);
    if (!task || isScheduled(task)) return; const reset = changeTaskTeam(doc, task, teamId); this.store.commit(doc, 'שיוך הצוות עודכן' + (reset ? ' · האחראי הוסר כי אינו שייך לצוות החדש' : ''));
  }
  open(item?: BacklogTask, schedule = false, workId?: string): void {
    this.assignmentMessage = ''; this.isNew = !item; this.mode.set(schedule ? 'schedule' : 'edit'); this.error.set('');
    this.draft.set(item ? clone(item) : { assigneeId: null, id: uid(), planningState: 'backlog', estimatedWorkingDays: 5, teamId: null, workItemId: null, title: '', color: palette[0], status: 'planned', notes: '', order: Math.max(-1, ...this.store.document().tasks.map(t => t.order)) + 1 });
    if (workId && !item) { const heading = this.store.document().workItems.find(w => w.id === workId); this.draft.update(t => t ? { ...t, workItemId: workId, teamId: heading?.teamId ?? null } : t); }
    this.incoming = clone(this.store.document().dependencies.filter(d => d.successorId === item?.id));
    this.startDate = nextWorkingDay(today()); this.workingDays = item?.estimatedWorkingDays ?? 5;
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
      this.store.commit(doc, 'הפריט נשמר בבקלוג'); this.close();
    } catch (error) { this.error.set((error as Error).message); }
  }
  schedulePreview(): { document?: ReturnType<typeof scheduleTask>; start?: string; end?: string; changed: string[]; error?: string } {
    const draft = this.draft(); if (!draft) return { changed: [] };
    try {
      const options: ScheduleOptions = { startDate: this.startDate, workingDays: Number(this.workingDays), teamId: draft.teamId, workItemId: draft.workItemId };
      const source = clone(this.store.document()), index = source.tasks.findIndex(t => t.id === draft.id);
      if (index >= 0) source.tasks[index] = clone(draft);
      const document = scheduleTask(source, draft.id, options), task = document.tasks.find(t => t.id === draft.id)!;
      const changed = document.tasks.filter(isScheduled).filter(t => t.id !== draft.id && this.store.document().tasks.some(o => o.id === t.id && (o.startDate !== t.startDate || o.endDate !== t.endDate))).map(t => t.title);
      return { document, start: task.startDate, end: task.endDate, changed };
    } catch (error) { return { error: (error as Error).message, changed: [] }; }
  }
  schedule(): void {
    const preview = this.schedulePreview(); if (!preview.document || this.store.importing()) return;
    try { const id = this.draft()!.id; this.store.commit(preview.document, 'הפריט שובץ בציר הזמן'); this.close(); this.lastScheduled.set(id); }
    catch (error) { this.error.set((error as Error).message); }
  }
  showInRoadmap(id: string): void { this.store.focusTaskId.set(id); void this.router.navigate(['/roadmap'], { queryParams: { task: id } }); }
  remove(item: BacklogTask): void {
    const doc = clone(this.store.document()), links = doc.dependencies.filter(d => d.predecessorId === item.id || d.successorId === item.id);
    if (!confirm(`למחוק את ״${item.title}״ ואת ${links.length} קשרי התלות שלה? העבודה הקשורה ושאר הפריטים יישארו.`)) return;
    doc.tasks = doc.tasks.filter(t => t.id !== item.id); doc.dependencies = doc.dependencies.filter(d => !links.includes(d));
    this.store.commit(doc, 'הפריט וקשריו נמחקו מהבקלוג'); if (this.draft()?.id === item.id) this.close();
  }
}
