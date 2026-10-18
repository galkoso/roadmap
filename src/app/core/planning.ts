import { clone, isScheduled, PlanningPane, PlanningPreferences, RoadmapDocument, Task } from './model';
import { duration } from './dates';

export const emptyPlanningPreferences = (): PlanningPreferences => ({ activeTeamId: null, collapsedGroups: [], expandedTeamIds: [] });
export const validCapacityDays = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000 && Number.isInteger(value * 2);
export function parseCapacityDays(value: string): number {
  if (!value.trim()) throw new Error('יש להזין ימי עבודה; להזנת אפס יש לכתוב 0');
  const days = Number(value);
  if (!validCapacityDays(days)) throw new Error('יש להזין מספר בין 0 ל־1,000,000, בכפולות של חצי יום');
  return days;
}
// The existing quantity is an estimate for backlog tasks and the actual working duration for scheduled tasks.
// It is not multiplied by team size or by the number of assignees.
export function taskEffort(task: Task): number | null {
  const days = isScheduled(task) ? duration(task.startDate, task.endDate) : task.estimatedWorkingDays;
  return typeof days === 'number' && Number.isSafeInteger(days) && days > 0 ? days : null;
}
export function effortTotal(tasks: Task[]): { known: number; missing: number } {
  return tasks.reduce((sum, task) => {
    const days = taskEffort(task);
    return { known: sum.known + (days ?? 0), missing: sum.missing + Number(days === null) };
  }, { known: 0, missing: 0 });
}
export function planningTasks(doc: RoadmapDocument, teamId: string | null, pane: PlanningPane): Task[] {
  const selected = new Set(doc.planning.selectedTaskIds);
  return doc.tasks.filter(task => task.teamId === teamId && (pane === 'selected' ? selected.has(task.id) : !isScheduled(task) && !selected.has(task.id)))
    .sort((a, b) => a.order - b.order);
}
export function planningGroups(doc: RoadmapDocument, tasks: Task[]): { workItemId: string | null; title: string; tasks: Task[] }[] {
  const byWork = new Map<string | null, Task[]>();
  for (const task of tasks) byWork.set(task.workItemId, [...(byWork.get(task.workItemId) ?? []), task]);
  return [...doc.workItems].sort((a, b) => a.order - b.order)
    .filter(work => byWork.has(work.id)).map(work => ({ workItemId: work.id as string | null, title: work.title, tasks: byWork.get(work.id)! }))
    .concat(byWork.has(null) ? [{ workItemId: null, title: 'משימות עצמאיות', tasks: byWork.get(null)! }] : []);
}
export function capacitySummary(doc: RoadmapDocument, teamId: string) {
  const capacity = doc.planning.teamCapacities.find(item => item.teamId === teamId), effort = effortTotal(planningTasks(doc, teamId, 'selected'));
  const available = capacity?.availableWorkingDays ?? null;
  const distributed = capacity?.memberAvailability.reduce((sum, member) => sum + member.availableWorkingDays, 0) ?? 0;
  return { ...effort, available, distributed, remaining: available === null ? null : available - effort.known,
    undistributed: available === null ? null : available - distributed };
}
export function selectPlanningTask(document: RoadmapDocument, id: string, selected: boolean): RoadmapDocument {
  const doc = clone(document), task = doc.tasks.find(task => task.id === id);
  if (!task) throw new Error('המשימה אינה קיימת');
  const ids = new Set(doc.planning.selectedTaskIds);
  if (selected && !ids.has(id)) {
    if (task.teamId === null || isScheduled(task)) throw new Error('יש לבחור משימת בקלוג המשויכת לצוות');
    ids.add(id);
  } else if (!selected) ids.delete(id);
  doc.planning.selectedTaskIds = [...ids]; return doc;
}
export function setCapacity(document: RoadmapDocument, teamId: string, days: number, memberId?: string): RoadmapDocument {
  if (!validCapacityDays(days)) throw new Error('ימי עבודה אינם תקינים');
  if (!document.teams.some(team => team.id === teamId)) throw new Error('הצוות אינו קיים');
  if (memberId !== undefined && !document.members.some(member => member.id === memberId && member.teamId === teamId)) throw new Error('החייל אינו שייך לצוות');
  const doc = clone(document);
  let capacity = doc.planning.teamCapacities.find(item => item.teamId === teamId);
  if (!capacity) { capacity = { teamId, availableWorkingDays: null, memberAvailability: [] }; doc.planning.teamCapacities.push(capacity); }
  if (memberId === undefined) capacity.availableWorkingDays = days;
  else {
    capacity.memberAvailability = capacity.memberAvailability.filter(member => member.memberId !== memberId);
    capacity.memberAvailability.push({ memberId, availableWorkingDays: days });
  }
  return doc;
}
// Only live application mutations are reconciled. Imported references are validated strictly, never repaired silently.
export function reconcilePlanning(doc: RoadmapDocument): void {
  const tasks = new Set(doc.tasks.map(task => task.id)), teams = new Set(doc.teams.map(team => team.id));
  doc.planning.selectedTaskIds = doc.planning.selectedTaskIds.filter(id => tasks.has(id));
  doc.planning.teamCapacities = doc.planning.teamCapacities.filter(capacity => teams.has(capacity.teamId));
  for (const capacity of doc.planning.teamCapacities) {
    capacity.memberAvailability = capacity.memberAvailability.filter(value => doc.members.some(member => member.id === value.memberId && member.teamId === capacity.teamId));
  }
}
export function reconcilePlanningPreferences(prefs: PlanningPreferences, doc: RoadmapDocument): PlanningPreferences {
  const teams = new Set(doc.teams.map(team => team.id)), works = new Set(doc.workItems.map(work => work.id));
  return { activeTeamId: prefs.activeTeamId !== null && teams.has(prefs.activeTeamId) ? prefs.activeTeamId : null,
    expandedTeamIds: prefs.expandedTeamIds.filter(id => teams.has(id)),
    collapsedGroups: prefs.collapsedGroups.filter(group => teams.has(group.teamId) && (group.workItemId === null || works.has(group.workItemId))) };
}
