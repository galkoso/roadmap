import { clone, isScheduled, MonthlyPlan, PlanningCandidateSource, PlanningPane, PlanningPreferences, RoadmapDocument, Task } from './model';
import { duration, today } from './dates';

export const currentPlanningPeriod = (): string => today().slice(0, 7);
export const validPlanningPeriod = (value: unknown): value is string => typeof value === 'string' && /^(19\d{2}|[2-9]\d{3})-(0[1-9]|1[0-2])$/.test(value);
export const emptyMonthlyPlan = (period: string): MonthlyPlan => ({ period, selectedTaskIds: [], teamCapacities: [] });
export const emptyPlanningPreferences = (): PlanningPreferences => ({ activeTeamId: null, collapsedGroups: [], expandedTeamIds: [] });
export function monthlyPlan(doc: RoadmapDocument, period = currentPlanningPeriod()): MonthlyPlan {
  return doc.planning.plans.find(plan => plan.period === period) ?? emptyMonthlyPlan(period);
}
function writablePlan(doc: RoadmapDocument, period: string): MonthlyPlan {
  if (!validPlanningPeriod(period)) throw new Error('חודש ושנת התכנון אינם תקינים');
  let plan = doc.planning.plans.find(plan => plan.period === period);
  if (!plan) { plan = emptyMonthlyPlan(period); doc.planning.plans.push(plan); }
  return plan;
}
export const validCapacityDays = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000 && Number.isInteger(value * 2);
export function parseCapacityDays(value: string): number {
  if (!value.trim()) throw new Error('יש להזין ימי עבודה; להזנת אפס יש לכתוב 0');
  const days = Number(value);
  if (!validCapacityDays(days)) throw new Error('יש להזין מספר בין 0 ל־1,000,000, בכפולות של חצי יום');
  return days;
}
// The existing effort quantity is a backlog estimate or the actual inclusive working duration of a scheduled task.
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
export function planningTeamId(doc: RoadmapDocument, task: Task, period = currentPlanningPeriod()): string | null {
  const link = monthlyPlan(doc, period).taskTeamLinks?.find(link => link.taskId === task.id);
  return link ? link.teamId : task.teamId;
}
export function planningMemberId(doc: RoadmapDocument, taskId: string, period = currentPlanningPeriod()): string | null {
  return monthlyPlan(doc, period).taskMemberLinks?.find(link => link.taskId === taskId)?.memberId ?? null;
}
export function planningTasks(doc: RoadmapDocument, teamId: string | null, pane: PlanningPane, source: PlanningCandidateSource = 'team', period = currentPlanningPeriod()): Task[] {
  const selected = new Set(monthlyPlan(doc, period).selectedTaskIds), allSelected = new Set(doc.planning.plans.flatMap(plan => plan.selectedTaskIds));
  return doc.tasks.filter(task => {
    if (pane === 'selected') return selected.has(task.id) && planningTeamId(doc, task, period) === teamId;
    const eligible = source === 'unassigned' ? task.teamId === null : task.teamId === teamId || (source === 'all' && task.teamId === null);
    return eligible && !isScheduled(task) && !allSelected.has(task.id);
  }).sort((a, b) => a.order - b.order);
}
export function planningGroups(doc: RoadmapDocument, tasks: Task[]): { workItemId: string | null; title: string; tasks: Task[] }[] {
  const byWork = new Map<string | null, Task[]>();
  for (const task of tasks) {
    const group = byWork.get(task.workItemId); if (group) group.push(task); else byWork.set(task.workItemId, [task]);
  }
  return [...doc.workItems].sort((a, b) => a.order - b.order).filter(work => byWork.has(work.id))
    .map(work => ({ workItemId: work.id as string | null, title: work.title, tasks: byWork.get(work.id)! }))
    .concat(byWork.has(null) ? [{ workItemId: null, title: 'משימות עצמאיות', tasks: byWork.get(null)! }] : []);
}
export function memberCapacitySummary(doc: RoadmapDocument, teamId: string, memberId: string, period = currentPlanningPeriod()) {
  const plan = monthlyPlan(doc, period), available = plan.teamCapacities.find(capacity => capacity.teamId === teamId)
    ?.memberAvailability.find(member => member.memberId === memberId)?.availableWorkingDays ?? null;
  const tasks = planningTasks(doc, teamId, 'selected', 'team', period).filter(task => planningMemberId(doc, task.id, period) === memberId);
  const effort = effortTotal(tasks);
  return { ...effort, available, remaining: available === null ? null : available - effort.known, tasks: tasks.length };
}
export function capacitySummary(doc: RoadmapDocument, teamId: string, period = currentPlanningPeriod()) {
  const members = doc.members.filter(member => member.teamId === teamId), plan = monthlyPlan(doc, period);
  const availability = plan.teamCapacities.find(capacity => capacity.teamId === teamId)?.memberAvailability ?? [];
  const available = availability.reduce((sum, member) => sum + member.availableWorkingDays, 0);
  const effort = effortTotal(planningTasks(doc, teamId, 'selected', 'team', period));
  const missingAvailability = members.filter(member => !availability.some(value => value.memberId === member.id)).length;
  const unassignedTasks = planningTasks(doc, teamId, 'selected', 'team', period).filter(task => !planningMemberId(doc, task.id, period)).length;
  return { ...effort, available, remaining: available - effort.known, missingAvailability, unassignedTasks };
}
export function selectPlanningTask(document: RoadmapDocument, id: string, selected: boolean, teamId?: string, period = currentPlanningPeriod()): RoadmapDocument {
  const doc = clone(document), task = doc.tasks.find(task => task.id === id);
  if (!task) throw new Error('המשימה אינה קיימת');
  const plan = writablePlan(doc, period), ids = new Set(plan.selectedTaskIds);
  if (selected && !ids.has(id)) {
    if (isScheduled(task)) throw new Error('יש לבחור משימת בקלוג');
    if (doc.planning.plans.some(other => other.period !== period && other.selectedTaskIds.includes(id))) throw new Error('המשימה כבר נבחרה לחודש אחר. ניתן להעביר אותה מתוך התכנון שלה');
    if (teamId !== undefined && !doc.teams.some(team => team.id === teamId)) throw new Error('צוות התכנון אינו קיים');
    if (task.teamId === null && teamId === undefined) throw new Error('יש לבחור צוות לתכנון המשימה');
    ids.add(id);
    if (teamId !== undefined) plan.taskTeamLinks = [...(plan.taskTeamLinks ?? []), { taskId: id, teamId }];
  } else if (!selected) {
    ids.delete(id);
    plan.taskTeamLinks = plan.taskTeamLinks?.filter(link => link.taskId !== id);
    plan.taskMemberLinks = plan.taskMemberLinks?.filter(link => link.taskId !== id);
  }
  plan.selectedTaskIds = [...ids]; return doc;
}
export function setCapacity(document: RoadmapDocument, teamId: string, days: number, memberId: string, period = currentPlanningPeriod()): RoadmapDocument {
  if (!validCapacityDays(days)) throw new Error('ימי עבודה אינם תקינים');
  if (!document.members.some(member => member.id === memberId && member.teamId === teamId)) throw new Error('האדם אינו שייך לצוות');
  const doc = clone(document), plan = writablePlan(doc, period);
  let capacity = plan.teamCapacities.find(item => item.teamId === teamId);
  if (!capacity) { capacity = { teamId, availableWorkingDays: null, memberAvailability: [] }; plan.teamCapacities.push(capacity); }
  capacity.memberAvailability = [...capacity.memberAvailability.filter(member => member.memberId !== memberId), { memberId, availableWorkingDays: days }];
  return doc;
}
export function assignPlanningTask(document: RoadmapDocument, taskId: string, memberId: string | null, period = currentPlanningPeriod()): RoadmapDocument {
  const doc = clone(document), plan = writablePlan(doc, period), task = doc.tasks.find(task => task.id === taskId);
  if (!task || !plan.selectedTaskIds.includes(taskId)) throw new Error('המשימה אינה בתכנון החודש הנבחר');
  if (memberId !== null && !doc.members.some(member => member.id === memberId && member.teamId === planningTeamId(doc, task, period))) throw new Error('האדם אינו שייך לצוות התכנון');
  plan.taskMemberLinks = plan.taskMemberLinks?.filter(link => link.taskId !== taskId) ?? [];
  if (memberId !== null) plan.taskMemberLinks.push({ taskId, memberId }); return doc;
}
export function movePlanningTask(document: RoadmapDocument, taskId: string, from: string, to: string): RoadmapDocument {
  if (!validPlanningPeriod(to)) throw new Error('חודש ושנת התכנון אינם תקינים');
  const doc = clone(document), source = writablePlan(doc, from);
  if (!source.selectedTaskIds.includes(taskId)) throw new Error('המשימה אינה בחודש המקור');
  if (from === to) return doc;
  const target = writablePlan(doc, to);
  source.selectedTaskIds = source.selectedTaskIds.filter(id => id !== taskId); target.selectedTaskIds.push(taskId);
  const teamLink = source.taskTeamLinks?.find(link => link.taskId === taskId), memberLink = source.taskMemberLinks?.find(link => link.taskId === taskId);
  source.taskTeamLinks = source.taskTeamLinks?.filter(link => link.taskId !== taskId);
  source.taskMemberLinks = source.taskMemberLinks?.filter(link => link.taskId !== taskId);
  if (teamLink) target.taskTeamLinks = [...(target.taskTeamLinks ?? []), teamLink];
  if (memberLink) target.taskMemberLinks = [...(target.taskMemberLinks ?? []), memberLink];
  return doc;
}
// Live edits clean references across all months. Imports are validated strictly before any replacement.
export function reconcilePlanning(doc: RoadmapDocument): void {
  const tasks = new Set(doc.tasks.map(task => task.id)), teams = new Set(doc.teams.map(team => team.id));
  for (const plan of doc.planning.plans) {
    plan.selectedTaskIds = plan.selectedTaskIds.filter(id => tasks.has(id));
    plan.taskTeamLinks = plan.taskTeamLinks?.filter(link => tasks.has(link.taskId) && plan.selectedTaskIds.includes(link.taskId))
      .map(link => ({ ...link, teamId: link.teamId !== null && teams.has(link.teamId) ? link.teamId : null }));
    plan.teamCapacities = plan.teamCapacities.filter(capacity => teams.has(capacity.teamId));
    for (const capacity of plan.teamCapacities) capacity.memberAvailability = capacity.memberAvailability.filter(value =>
      doc.members.some(member => member.id === value.memberId && member.teamId === capacity.teamId));
    plan.taskMemberLinks = plan.taskMemberLinks?.filter(link => {
      const task = doc.tasks.find(task => task.id === link.taskId);
      return task && plan.selectedTaskIds.includes(link.taskId) && doc.members.some(member => member.id === link.memberId && member.teamId === planningTeamId(doc, task, plan.period));
    });
  }
}
export function reconcilePlanningPreferences(prefs: PlanningPreferences, doc: RoadmapDocument): PlanningPreferences {
  const teams = new Set(doc.teams.map(team => team.id)), works = new Set(doc.workItems.map(work => work.id));
  return { ...prefs, activeTeamId: prefs.activeTeamId !== null && teams.has(prefs.activeTeamId) ? prefs.activeTeamId : null,
    expandedTeamIds: prefs.expandedTeamIds.filter(id => teams.has(id)),
    collapsedGroups: prefs.collapsedGroups.filter(group => teams.has(group.teamId) && (group.workItemId === null || works.has(group.workItemId))) };
}
