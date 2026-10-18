import {
  AfterViewInit, ChangeDetectionStrategy, Component, computed, effect, ElementRef, HostListener, inject, signal, ViewChild
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AssigneeFieldComponent } from './assignee-field.component';
import { BacklogTaskDialogComponent } from './backlog-task-dialog.component';
import { CreateWorkDialogComponent } from './create-work-dialog.component';
import { changeTaskTeam } from '../core/members';
import { RoadmapStore } from '../core/store';
import { BacklogTask, clone, isScheduled, statuses, Task } from '../core/model';
interface BacklogGroup { key: string; name: string; tasks: BacklogTask[] }
@Component({
  selector: 'app-backlog', standalone: true, imports: [FormsModule, NgTemplateOutlet, AssigneeFieldComponent, CreateWorkDialogComponent, BacklogTaskDialogComponent], changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './backlog-page.component.html'
})
export class BacklogPageComponent implements AfterViewInit {
  readonly store = inject(RoadmapStore); private readonly router = inject(Router); 
  @ViewChild(BacklogTaskDialogComponent, { static: true }) editor!: BacklogTaskDialogComponent;
  @ViewChild('list') list?: ElementRef<HTMLDivElement>;
  readonly tasks = computed(() => this.store.document().tasks.filter((t): t is BacklogTask => !isScheduled(t)).sort((a, b) => a.order - b.order));
  readonly search = signal('');
  readonly query = computed(() => this.search().trim().toLocaleLowerCase());
  readonly filteredTasks = computed(() => this.tasks().filter(task => task.title.toLocaleLowerCase().includes(this.query())));
  private readonly searchCollapsed = signal<string[]>([]);
  readonly view = computed(() => ({ ...(this.store.preferences().backlog ?? { collapsed: [], scrollTop: 0 }), mode: 'teams' as const }));
  readonly groups = computed<BacklogGroup[]>(() => [
    ...[...this.store.document().teams].sort((a, b) => a.order - b.order).map(team => ({ key: 'team:' + team.id, name: team.name, tasks: this.filteredTasks().filter(t => t.teamId === team.id) })),
    { key: 'unassigned', name: 'ללא צוות', tasks: this.filteredTasks().filter(t => t.teamId === null) }
  ].filter(group => !this.query() || group.tasks.length > 0));
  readonly lastScheduled = signal<string | null>(null);
  readonly dragging = signal<string | null>(null);
  readonly dropTarget = signal<{ id: string; after: boolean } | null>(null);
  readonly durationError = signal<{ id: string; message: string } | null>(null);
  constructor() { effect(() => { if (this.store.loaded()) setTimeout(() => { if (this.list) this.list.nativeElement.scrollTop = this.view().scrollTop; }, 0); }); }
  ngAfterViewInit(): void { setTimeout(() => { if (this.list) this.list.nativeElement.scrollTop = this.view().scrollTop; }, 0); }
  setSearch(value: string): void {
    this.search.set(value); this.searchCollapsed.set([]); this.endDrag();
    if (this.list) this.list.nativeElement.scrollTop = 0;
  }
  toggle(key: string): void {
    const view = this.view(), keys = this.collapsedKeys(), collapsed = keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key];
    if (this.query()) { this.searchCollapsed.set(collapsed); return; }
    this.store.setPreferences({ backlog: { ...view, collapsed } });
  }
  collapsedKeys(): string[] { return this.query() ? this.searchCollapsed() : this.view().collapsed; }
  teamId(group: BacklogGroup): string | null { return group.key === 'unassigned' ? null : group.key.slice(5); }
  workKey(workId: string, groupKey: string): string { return 'work:' + workId + ':' + groupKey; }
  contentId(key: string): string { return 'backlog-content-' + encodeURIComponent(key); }
  revealTask(task: BacklogTask): void {
    const teamKey = task.teamId === null ? 'unassigned' : 'team:' + task.teamId;
    const keys = new Set([teamKey, this.workKey(task.workItemId ?? 'standalone', teamKey)]);
    this.store.setPreferences({ backlog: { ...this.view(), collapsed: this.view().collapsed.filter(key => !keys.has(key)) } });
  }
  startDrag(event: DragEvent, item: BacklogTask): void {
    if (this.store.importing() || !event.dataTransfer) { event.preventDefault(); return; }
    this.dragging.set(item.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id);
  }
  endDrag(): void { this.dragging.set(null); this.dropTarget.set(null); }
  dragOver(event: DragEvent, item: BacklogTask, siblings: BacklogTask[]): void {
    const source = this.dragging();
    if (this.store.importing() || !source || source === item.id || !siblings.some(t => t.id === source)) return;
    event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.dropTarget.set({ id: item.id, after: event.clientY > bounds.top + bounds.height / 2 });
  }
  drop(event: DragEvent, item: BacklogTask, siblings: BacklogTask[]): void {
    event.preventDefault();
    const source = this.dragging(), target = this.dropTarget();
    if (source && target?.id === item.id) this.reorder(source, item.id, target.after, siblings);
    this.endDrag();
  }
  reorderKeyboard(event: KeyboardEvent, item: BacklogTask, siblings: BacklogTask[]): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const index = siblings.findIndex(t => t.id === item.id), after = event.key === 'ArrowDown', target = siblings[index + (after ? 1 : -1)];
    if (target) this.reorder(item.id, target.id, after, siblings);
  }
  private reorder(sourceId: string, targetId: string, after: boolean, siblings: BacklogTask[]): void {
    if (this.store.importing() || sourceId === targetId) return;
    const ids = siblings.map(t => t.id), sourceIndex = ids.indexOf(sourceId);
    if (sourceIndex < 0 || !ids.includes(targetId)) return;
    ids.splice(sourceIndex, 1); ids.splice(ids.indexOf(targetId) + (after ? 1 : 0), 0, sourceId);
    if (ids.every((id, index) => id === siblings[index].id)) return;
    const doc = clone(this.store.document()), backlog = doc.tasks.filter((t): t is BacklogTask => !isScheduled(t)).sort((a, b) => a.order - b.order);
    const scope = new Set(ids), byId = new Map(backlog.map(t => [t.id, t]));
    if (ids.some(id => !byId.has(id))) return;
    let index = 0;
    const ordered = backlog.map(t => scope.has(t.id) ? byId.get(ids[index++])! : t);
    const firstOrder = Math.max(-1, ...doc.tasks.filter(isScheduled).map(t => t.order)) + 1;
    ordered.forEach((task, position) => task.order = firstOrder + position);
    try { this.store.commit(doc, 'סדר המשימות עודכן'); }
    catch (error) { this.store.notice.set((error as Error).message); }
  }
  @HostListener('document:keydown', ['$event']) keyboard(event: KeyboardEvent): void {
    if ((event.target as HTMLElement)?.closest('input, textarea, select, dialog[open]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); event.shiftKey ? this.store.redo() : this.store.undo(); this.lastScheduled.set(null);
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); this.store.redo(); }
  }
  canDeactivate(): boolean {
    if (!this.editor.canDeactivate()) return false;
    if (this.list) this.store.setPreferences({ backlog: { ...this.view(), scrollTop: this.list.nativeElement.scrollTop } });
    return true;
  }
  statusLabel(status: Task['status']): string { return statuses[status]; }
  workGroups(tasks: BacklogTask[], teamId: string | null): { key: string; name: string; tasks: BacklogTask[] }[] {
    return [...this.store.document().workItems].filter(w => w.teamId === teamId || (w.teamId === undefined && tasks.some(t => t.workItemId === w.id))).sort((a, b) => a.order - b.order)
      .map(w => ({ key: w.id, name: w.title, tasks: tasks.filter(t => t.workItemId === w.id) }))
      .concat([{ key: 'standalone', name: 'פריטים עצמאיים', tasks: tasks.filter(t => t.workItemId === null) }]).filter(g => (!this.query() && g.key !== 'standalone') || g.tasks.length > 0);
  }
  workName(id: string | null): string { return this.store.document().workItems.find(w => w.id === id)?.title ?? 'פריט עצמאי'; }
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
  open(item?: BacklogTask, schedule = false, workId?: string, teamId?: string | null): void { this.editor.open(item, schedule, workId, teamId); }
  remove(item: BacklogTask): void { this.editor.remove(item); }
  showInRoadmap(id: string): void { this.store.focusTaskId.set(id); void this.router.navigate(['/roadmap'], { queryParams: { task: id } }); }
}
