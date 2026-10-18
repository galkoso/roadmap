import { ChangeDetectionStrategy, Component, computed, HostListener, inject, signal, ViewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { BacklogTaskDialogComponent } from './backlog-task-dialog.component';
import { RoadmapStore } from '../core/store';
import { isScheduled, PlanningPane, PlanningPreferences, statuses, Task } from '../core/model';
import { memberLabel, membersForTeam } from '../core/members';
import {
  capacitySummary, effortTotal, emptyPlanningPreferences, parseCapacityDays, planningGroups, planningTasks, selectPlanningTask, setCapacity, taskEffort
} from '../core/planning';

@Component({
  selector: 'app-planning', standalone: true, imports: [RouterLink, BacklogTaskDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush, templateUrl: './planning-page.component.html'
})
export class PlanningPageComponent {
  readonly store = inject(RoadmapStore); private readonly router = inject(Router);
  @ViewChild(BacklogTaskDialogComponent, { static: true }) editor!: BacklogTaskDialogComponent;
  readonly preferences = computed(() => this.store.preferences().planning ?? emptyPlanningPreferences());
  readonly teams = computed(() => [...this.store.document().teams].sort((a, b) => a.order - b.order));
  readonly team = computed(() => this.teams().find(team => team.id === this.preferences().activeTeamId) ?? this.teams()[0]);
  readonly summary = computed(() => capacitySummary(this.store.document(), this.team().id));
  readonly members = computed(() => membersForTeam(this.store.document(), this.team().id));
  readonly panes: { key: PlanningPane; title: string }[] = [
    { key: 'selected', title: 'המשימות שנבחרו לתכנון' }, { key: 'candidates', title: 'משימות מהבקלוג לבחירה' }
  ];
  readonly selected = computed(() => planningTasks(this.store.document(), this.team().id, 'selected'));
  readonly candidates = computed(() => planningTasks(this.store.document(), this.team().id, 'candidates'));
  readonly groups = computed(() => ({ selected: planningGroups(this.store.document(), this.selected()), candidates: planningGroups(this.store.document(), this.candidates()) }));
  readonly unresolved = computed(() => planningTasks(this.store.document(), null, 'selected'));
  readonly error = signal(''); readonly drafts = signal<Record<string, string>>({});
  readonly scheduled = isScheduled; readonly effort = taskEffort; readonly total = effortTotal; readonly statusOptions = statuses;
  memberName(id: string): string {
    const member = this.store.document().members.find(member => member.id === id);
    return member ? memberLabel(this.store.document(), member) : '';
  }
  private setPreferences(patch: Partial<PlanningPreferences>): void {
    this.store.setPreferences({ planning: { ...this.preferences(), ...patch } });
  }
  selectTeam(id: string): void { this.error.set(''); this.setPreferences({ activeTeamId: id }); }
  breakdownOpen(): boolean { return this.preferences().expandedTeamIds.includes(this.team().id); }
  toggleBreakdown(): void {
    const id = this.team().id, keys = this.preferences().expandedTeamIds;
    this.setPreferences({ expandedTeamIds: keys.includes(id) ? keys.filter(key => key !== id) : [...keys, id] });
  }
  collapsed(pane: PlanningPane, workItemId: string | null): boolean {
    return this.preferences().collapsedGroups.some(group => group.teamId === this.team().id && group.pane === pane && group.workItemId === workItemId);
  }
  toggleGroup(pane: PlanningPane, workItemId: string | null): void {
    const teamId = this.team().id, keys = this.preferences().collapsedGroups;
    this.setPreferences({ collapsedGroups: this.collapsed(pane, workItemId)
      ? keys.filter(group => !(group.teamId === teamId && group.pane === pane && group.workItemId === workItemId))
      : [...keys, { teamId, pane, workItemId }] });
  }
  contentId(pane: PlanningPane, workItemId: string | null): string { return 'planning-' + encodeURIComponent(JSON.stringify([this.team().id, pane, workItemId])); }
  select(task: Task, selected: boolean): void {
    if (!this.store.loaded() || this.store.importing()) return;
    if (this.store.document().planning.selectedTaskIds.includes(task.id) === selected) return;
    try {
      const next = selectPlanningTask(this.store.document(), task.id, selected), pane = selected ? 'selected' : 'candidates';
      const collapsedGroups = this.preferences().collapsedGroups.filter(group => !(group.teamId === task.teamId && group.pane === pane && group.workItemId === task.workItemId));
      this.store.commit(next, selected ? 'המשימה נוספה לתכנון' : 'המשימה הוסרה מהתכנון', { planning: { ...this.preferences(), collapsedGroups } });
    } catch (error) { this.error.set((error as Error).message); }
  }
  private inputKey(memberId?: string): string { return JSON.stringify([this.team().id, memberId ?? null]); }
  capacityInput(memberId?: string): string {
    const draft = this.drafts()[this.inputKey(memberId)]; if (draft !== undefined) return draft;
    const capacity = this.store.document().planning.teamCapacities.find(capacity => capacity.teamId === this.team().id);
    const value = memberId === undefined ? capacity?.availableWorkingDays : capacity?.memberAvailability.find(member => member.memberId === memberId)?.availableWorkingDays;
    return value?.toString() ?? '';
  }
  draftCapacity(event: Event, memberId?: string): void {
    const value = (event.target as HTMLInputElement).value;
    this.drafts.update(drafts => ({ ...drafts, [this.inputKey(memberId)]: value })); this.error.set('');
  }
  saveCapacity(event: Event, memberId?: string): void {
    event.preventDefault(); if (!this.store.loaded() || this.store.importing()) return;
    try {
      const days = parseCapacityDays(this.capacityInput(memberId));
      this.store.commit(setCapacity(this.store.document(), this.team().id, days, memberId), 'ימי העבודה עודכנו');
      this.drafts.update(drafts => { const copy = { ...drafts }; delete copy[this.inputKey(memberId)]; return copy; }); this.error.set('');
    } catch (error) { this.error.set((error as Error).message); }
  }
  edit(task: Task, schedule = false): void {
    if (isScheduled(task)) this.showInRoadmap(task.id); else this.editor.open(task, schedule);
  }
  showInRoadmap(id: string): void { this.store.focusTaskId.set(id); void this.router.navigate(['/roadmap'], { queryParams: { task: id } }); }
  private dirty(): boolean { return Object.keys(this.drafts()).length > 0; }
  canDeactivate(): boolean {
    return this.editor.canDeactivate() && (!this.dirty() || confirm('יש ימי עבודה שלא נשמרו. לעבור לעמוד אחר ולבטל אותם?'));
  }
  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) { event.preventDefault(); event.returnValue = ''; }
  }
  @HostListener('document:keydown', ['$event']) keyboard(event: KeyboardEvent): void {
    if ((event.target as HTMLElement)?.closest('input, textarea, select, dialog[open]') || !(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? this.store.redo() : this.store.undo(); }
    if (event.key.toLowerCase() === 'y') { event.preventDefault(); this.store.redo(); }
  }
}
