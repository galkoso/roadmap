import { ChangeDetectionStrategy, Component, computed, HostListener, inject, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AssigneeFieldComponent } from './assignee-field.component';
import { BacklogTaskDialogComponent } from './backlog-task-dialog.component';
import { nextWorkingDay } from '../core/dates';
import { Session } from '../core/session';
import { RoadmapStore } from '../core/store';
import { isScheduled, PlanningCandidateSource, PlanningPane, PlanningPreferences, statuses, Task } from '../core/model';
import { memberLabel, membersForTeam } from '../core/members';
import {
  assignPlanningTask, capacitySummary, currentPlanningPeriod, effortTotal, emptyPlanningPreferences, memberCapacitySummary, monthlyPlan,
  movePlanningTask, planningGroups, planningTasks, selectPlanningTask, taskEffort
} from '../core/planning';

@Component({
  selector: 'app-planning', standalone: true, imports: [RouterLink, FormsModule, BacklogTaskDialogComponent, AssigneeFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush, templateUrl: './planning-page.component.html'
})
export class PlanningPageComponent {
  readonly session = inject(Session);
  readonly store = inject(RoadmapStore); private readonly router = inject(Router);
  @ViewChild(BacklogTaskDialogComponent, { static: true }) editor!: BacklogTaskDialogComponent;
  readonly preferences = computed(() => this.store.preferences().planning ?? emptyPlanningPreferences());
  readonly period = computed(() => this.preferences().activePeriod ?? currentPlanningPeriod());
  readonly plan = computed(() => monthlyPlan(this.store.document(), this.period()));
  readonly teams = computed(() => [...this.store.document().teams].sort((a, b) => a.order - b.order));
  readonly team = computed(() => this.teams().find(team => team.id === this.preferences().activeTeamId) ?? this.teams()[0]);
  readonly summary = computed(() => capacitySummary(this.store.document(), this.team().id, this.period()));
  readonly members = computed(() => membersForTeam(this.store.document(), this.team().id));
  readonly panes: { key: PlanningPane; title: string }[] = [
    { key: 'selected', title: 'המשימות שנבחרו לתכנון' }, { key: 'candidates', title: 'משימות מהבקלוג לבחירה' }
  ];
  readonly selected = computed(() => planningTasks(this.store.document(), this.team().id, 'selected', 'team', this.period()));
  readonly candidateSource = computed(() => this.preferences().candidateSource ?? 'all');
  readonly candidates = computed(() => planningTasks(this.store.document(), this.team().id, 'candidates', this.candidateSource(), this.period()));
  readonly groups = computed(() => ({ selected: planningGroups(this.store.document(), this.selected()), candidates: planningGroups(this.store.document(), this.candidates()) }));
  readonly unresolved = computed(() => planningTasks(this.store.document(), null, 'selected', 'team', this.period()));
  readonly error = signal('');
  readonly scheduled = isScheduled; readonly effort = taskEffort; readonly total = effortTotal; readonly statusOptions = statuses;
  memberName(id: string): string {
    const member = this.store.document().members.find(member => member.id === id);
    return member ? memberLabel(this.store.document(), member) : '';
  }
  private setPreferences(patch: Partial<PlanningPreferences>): void {
    this.store.setPreferences({ planning: { ...this.preferences(), ...patch } });
  }
  setCandidateSource(candidateSource: PlanningCandidateSource): void { this.setPreferences({ candidateSource }); }
  taskTeamName(task: Task): string { return this.store.document().teams.find(team => team.id === task.teamId)?.name ?? 'ללא צוות'; }
  personSummary(id: string) { return memberCapacitySummary(this.store.document(), this.team().id, id, this.period()); }
  assign(task: Task, memberId: string | null): void {
    if (this.store.importing()) return;
    try { this.store.commit(assignPlanningTask(this.store.document(), task.id, memberId, this.period()), 'האחראי עודכן'); }
    catch (error) { this.error.set((error as Error).message); }
  }
  move(task: Task, event: Event): void {
    const input = event.target as HTMLInputElement;
    try { this.store.commit(movePlanningTask(this.store.document(), task.id, this.period(), input.value), 'המשימה הועברה לחודש שנבחר'); }
    catch (error) { input.value = this.period(); this.error.set((error as Error).message); }
  }
  selectTeam(id: string): void { this.error.set(''); this.setPreferences({ activeTeamId: id }); }
  collapsed(pane: PlanningPane, workItemId: string | null): boolean {
    return this.preferences().collapsedGroups.some(group => group.teamId === this.team().id && group.pane === pane && group.workItemId === workItemId && (group.period ?? currentPlanningPeriod()) === this.period());
  }
  toggleGroup(pane: PlanningPane, workItemId: string | null): void {
    const teamId = this.team().id, keys = this.preferences().collapsedGroups;
    this.setPreferences({ collapsedGroups: this.collapsed(pane, workItemId)
      ? keys.filter(group => !(group.teamId === teamId && group.pane === pane && group.workItemId === workItemId && (group.period ?? currentPlanningPeriod()) === this.period()))
      : [...keys, { teamId, pane, workItemId, period: this.period() }] });
  }
  contentId(pane: PlanningPane, workItemId: string | null): string { return 'planning-' + encodeURIComponent(JSON.stringify([this.period(), this.team().id, pane, workItemId])); }
  select(task: Task, selected: boolean): void {
    if (!this.store.loaded() || this.store.importing()) return;
    if (this.plan().selectedTaskIds.includes(task.id) === selected) return;
    try {
      const next = selectPlanningTask(this.store.document(), task.id, selected, task.teamId === null ? this.team().id : undefined, this.period()), pane = selected ? 'selected' : 'candidates';
      const collapsedGroups = this.preferences().collapsedGroups.filter(group => !(group.teamId === this.team().id && group.pane === pane && group.workItemId === task.workItemId && (group.period ?? currentPlanningPeriod()) === this.period()));
      this.store.commit(next, selected ? 'המשימה נוספה לתכנון' : 'המשימה הוסרה מהתכנון', { planning: { ...this.preferences(), collapsedGroups } });
    } catch (error) { this.error.set((error as Error).message); }
  }
  resolvePlanningTeam(task: Task): void {
    if (!this.store.loaded() || this.store.importing()) return;
    const doc = structuredClone(this.store.document());
    const plan = doc.planning.plans.find(plan => plan.period === this.period())!;
    plan.taskTeamLinks = [...(plan.taskTeamLinks ?? []).filter(link => link.taskId !== task.id), { taskId: task.id, teamId: this.team().id }];
    this.store.commit(doc, 'צוות התכנון עודכן');
  }
  focusPerson(velocityMemberId: string): void { this.store.setPreferences({ velocityMemberId }); }
  edit(task: Task, schedule = false): void {
    if (isScheduled(task)) this.showInRoadmap(task.id);
    else {
      const initialStart = schedule && this.period() !== currentPlanningPeriod() ? nextWorkingDay(this.period() + '-01') : undefined;
      this.editor.open(task, schedule, undefined, undefined, initialStart);
    }
  }
  showInRoadmap(id: string): void { this.store.focusTaskId.set(id); void this.router.navigate(['/roadmap'], { queryParams: { task: id } }); }
  dirty(): boolean { return false; }
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
