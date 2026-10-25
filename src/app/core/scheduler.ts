import { AttendanceException, clone, Dependency, isScheduled, RoadmapDocument, ScheduledTask, Task } from './model.js';
import { changeTaskTeam, validateAssignment } from './members.js';
import { addWorkingDays, duration, epoch, nextWorkingDay, workingDifference } from './dates.js';
import { executionSchedule, rangeEffort, requiredEffort, validateAttendance } from './availability.js';
export function topological(doc: RoadmapDocument): string[] {
  const indegree = new Map(doc.tasks.map(t => [t.id, 0]));
  const outgoing = new Map<string, string[]>();
  const pairs = new Set<string>();
  const tasks = new Map(doc.tasks.map(t => [t.id, t]));
  for (const d of doc.dependencies) {
    const a = tasks.get(d.predecessorId), b = tasks.get(d.successorId);
    if (!a || !b || !a.workItemId || a.workItemId !== b.workItemId) throw new Error('תלות חייבת לקשר משימות באותה עבודה');
    if (a.id === b.id) throw new Error('משימה אינה יכולה להיות תלויה בעצמה');
    const key = a.id + ':' + b.id;
    if (pairs.has(key)) throw new Error('קשר תלות כפול');
    pairs.add(key);
    if (d.type !== 'finish_to_start' || !Number.isSafeInteger(d.lagWorkingDays) || d.lagWorkingDays < 0) throw new Error('מרווח תלות אינו תקין');
    indegree.set(b.id, indegree.get(b.id)! + 1);
    outgoing.set(a.id, [...(outgoing.get(a.id) ?? []), b.id]);
  }
  const queue = [...indegree].filter(([, n]) => n === 0).map(([id]) => id);
  for (let i = 0; i < queue.length; i++) for (const id of outgoing.get(queue[i]) ?? []) {
    indegree.set(id, indegree.get(id)! - 1); if (indegree.get(id) === 0) queue.push(id);
  }
  if (queue.length !== doc.tasks.length) throw new Error('לא ניתן ליצור מעגל תלויות. הנתונים לא שונו');
  return queue;
}
export function workRange(doc: RoadmapDocument, id: string): { startDate: string; endDate: string } | null {
  const tasks = doc.tasks.filter(isScheduled).filter(t => t.workItemId === id);
  return tasks.length ? { startDate: tasks.map(t => t.startDate).sort()[0], endDate: tasks.map(t => t.endDate).sort().at(-1)! } : null;
}
export function unscheduledPredecessors(doc: RoadmapDocument, id: string): Task[] {
  const ids = new Set(doc.dependencies.filter(d => d.successorId === id).map(d => d.predecessorId));
  return doc.tasks.filter(t => ids.has(t.id) && !isScheduled(t));
}
export function requiredStart(doc: RoadmapDocument, taskId: string): string | undefined {
  const blockers = unscheduledPredecessors(doc, taskId);
  if (blockers.length) throw new Error('יש לשבץ קודם את המשימות: ' + blockers.map(t => t.title).join(', ') + ', או להסיר את התלות בהן');
  const tasks = new Map(doc.tasks.filter(isScheduled).map(t => [t.id, t]));
  if (doc.dependencies.some(link => link.successorId === taskId && tasks.get(link.predecessorId)?.scheduleIssue))
    throw new Error('שיבוץ משימה קודמת אינו מעודכן; יש לפתור את הזמינות תחילה');
  return doc.dependencies.filter(d => d.successorId === taskId)
    .map(d => addWorkingDays(tasks.get(d.predecessorId)!.endDate, 1 + d.lagWorkingDays)).sort().at(-1);
}
function moveTask(doc: RoadmapDocument, task: ScheduledTask, start: string): void {
  const effort = requiredEffort(task), schedule = executionSchedule(doc, task.assigneeId, start, effort);
  task.effortWorkingDays = effort; task.startDate = schedule.startDate; task.endDate = schedule.endDate;
  delete task.scheduleIssue;
}
export function propagate(doc: RoadmapDocument, roots: string[]): void {
  const reachable = new Set(roots);
  const tasks = new Map(doc.tasks.map(t => [t.id, t]));
  for (const id of topological(doc)) {
    if (!reachable.has(id) || !isScheduled(tasks.get(id)!)) continue;
    if (!roots.includes(id)) {
      const task = tasks.get(id)! as ScheduledTask, minimum = requiredStart(doc, id);
      if (task.status !== 'completed' && minimum) moveTask(doc, task, [task.requestedStartDate ?? minimum, minimum].sort().at(-1)!);
    }
    for (const d of doc.dependencies) if (d.predecessorId === id) reachable.add(d.successorId);
  }
}
export function editTask(document: RoadmapDocument, id: string, patch: Partial<ScheduledTask>): RoadmapDocument {
  const doc = clone(document), task = doc.tasks.find(t => t.id === id);
  if (!task || !isScheduled(task)) throw new Error('המשימה אינה משובצת בציר הזמן');
  const oldEffort = requiredEffort(task), oldAnchor = task.requestedStartDate ?? task.startDate;
  const startChanged = patch.startDate !== undefined && patch.startDate !== task.startDate;
  const endChanged = patch.endDate !== undefined && patch.endDate !== task.endDate;
  const scheduling = startChanged || endChanged || patch.requestedStartDate !== undefined || patch.effortWorkingDays !== undefined ||
    patch.assigneeId !== undefined || patch.teamId !== undefined;
  if (patch.teamId !== undefined) changeTaskTeam(doc, task, patch.teamId);
  Object.assign(task, patch, { id: task.id, planningState: 'scheduled' });
  validateAssignment(doc, task, task.assigneeId ?? null); topological(doc);
  if (scheduling) {
    task.requestedStartDate = patch.requestedStartDate ?? (startChanged ? patch.startDate! : task.requestedStartDate ?? task.startDate);
    epoch(task.requestedStartDate!);
    // Endpoint resize preserves the selected range; a body move supplies explicit effort.
    task.effortWorkingDays = patch.effortWorkingDays ?? (endChanged || startChanged
      ? rangeEffort(doc, task.assigneeId, task.startDate, task.endDate) : oldEffort);
    const minimum = requiredStart(doc, id);
    moveTask(doc, task, [task.requestedStartDate, minimum ?? task.requestedStartDate].sort().at(-1)!);
    if (startChanged || (patch.requestedStartDate !== undefined && patch.requestedStartDate !== oldAnchor)) for (const d of doc.dependencies.filter(d => d.successorId === id)) {
      const predecessor = doc.tasks.find(t => t.id === d.predecessorId)! as ScheduledTask;
      d.lagWorkingDays = Math.max(0, workingDifference(addWorkingDays(predecessor.endDate, 1), task.requestedStartDate!));
    }
    propagate(doc, [id]);
  }
  return doc;
}
export function shiftTask(doc: RoadmapDocument, id: string, start: string): RoadmapDocument {
  const task = doc.tasks.find(t => t.id === id);
  if (!task || !isScheduled(task)) throw new Error('המשימה אינה משובצת');
  return editTask(doc, id, { requestedStartDate: start, effortWorkingDays: requiredEffort(task) });
}
export function shiftWork(document: RoadmapDocument, id: string, start: string): RoadmapDocument {
  const doc = clone(document), range = workRange(doc, id); if (!range) return doc;
  const delta = workingDifference(range.startDate, nextWorkingDay(start));
  const tasks = doc.tasks.filter(isScheduled).filter(t => t.workItemId === id);
  for (const task of tasks) {
    task.requestedStartDate = addWorkingDays(task.requestedStartDate ?? task.startDate, delta);
    moveTask(doc, task, task.requestedStartDate);
  }
  for (const taskId of topological(doc)) {
    const task = tasks.find(t => t.id === taskId); if (!task) continue;
    const minimum = requiredStart(doc, taskId);
    if (minimum && minimum > task.startDate) moveTask(doc, task, minimum);
  }
  return doc;
}
export function setIncoming(document: RoadmapDocument, id: string, incoming: Dependency[]): RoadmapDocument {
  const doc = clone(document);
  const previous = new Set(doc.dependencies.filter(d => d.successorId === id).map(d => d.predecessorId));
  const incomingById = new Map(incoming.map(d => [d.id, d]));
  const oldIds = new Set(doc.dependencies.map(d => d.id));
  doc.dependencies = doc.dependencies.flatMap(d => d.successorId !== id ? [d] : incomingById.has(d.id) ? [clone(incomingById.get(d.id)!)] : []);
  doc.dependencies.push(...clone(incoming.filter(d => !oldIds.has(d.id))));
  topological(doc);
  const task = doc.tasks.find(t => t.id === id)!;
  if (!isScheduled(task)) return doc;
  // New links preserve an already legal start; explicit edits to existing lag values take effect.
  for (const d of doc.dependencies.filter(d => d.successorId === id && !previous.has(d.predecessorId))) {
    const p = doc.tasks.find(t => t.id === d.predecessorId)!;
    if (!isScheduled(p)) { requiredStart(doc, id); continue; }
    d.lagWorkingDays = Math.max(d.lagWorkingDays, workingDifference(addWorkingDays(p.endDate, 1), task.startDate));
  }
  const minimum = requiredStart(doc, id);
  const min = minimum && task.requestedStartDate && task.requestedStartDate > minimum ? task.requestedStartDate : minimum;
  if (min && min > task.startDate) { moveTask(doc, task, min); propagate(doc, [id]); }
  const edited = incoming.some(d => document.dependencies.some(old => old.id === d.id && old.lagWorkingDays !== d.lagWorkingDays));
  if (edited && min) { moveTask(doc, task, min); propagate(doc, [id]); }
  return doc;
}
export interface ScheduleOptions { startDate: string; workingDays: number; teamId: string | null; workItemId: string | null }
export function scheduleTask(document: RoadmapDocument, id: string, options: ScheduleOptions): RoadmapDocument {
  epoch(options.startDate);
  if (!Number.isSafeInteger(options.workingDays) || options.workingDays < 1 || options.workingDays > 10000) throw new Error('משך חייב להיות מספר שלם בין 1 ל־10,000 ימי עבודה');
  const doc = clone(document), index = doc.tasks.findIndex(t => t.id === id), item = doc.tasks[index];
  if (!item || isScheduled(item)) throw new Error('הפריט אינו בבקלוג');
  changeTaskTeam(doc, item, options.teamId);
  validateAssignment(doc, item, item.assigneeId ?? null);
  const task: ScheduledTask = { ...item, estimatedWorkingDays: options.workingDays, planningState: 'scheduled', teamId: options.teamId, workItemId: options.workItemId,
    requestedStartDate: options.startDate, effortWorkingDays: options.workingDays, startDate: options.startDate, endDate: options.startDate };
  moveTask(doc, task, options.startDate);
  doc.tasks[index] = task; topological(doc);
  const minimum = requiredStart(doc, id); if (minimum && task.startDate < minimum) moveTask(doc, task, minimum);
  for (const link of doc.dependencies.filter(d => d.successorId === id)) {
    const p = doc.tasks.find(t => t.id === link.predecessorId)! as ScheduledTask;
    link.lagWorkingDays = Math.max(link.lagWorkingDays, workingDifference(addWorkingDays(p.endDate, 1), options.startDate));
  }
  propagate(doc, [id]); return doc;
}
export function returnToBacklog(document: RoadmapDocument, id: string): RoadmapDocument {
  const doc = clone(document), index = doc.tasks.findIndex(t => t.id === id), task = doc.tasks[index];
  if (!task || !isScheduled(task)) throw new Error('המשימה אינה משובצת');
  const reachable = new Set([id]);
  for (const node of topological(doc)) if (reachable.has(node)) for (const d of doc.dependencies.filter(d => d.predecessorId === node)) reachable.add(d.successorId);
  const blockers = doc.tasks.filter(t => t.id !== id && reachable.has(t.id) && isScheduled(t));
  if (blockers.length) throw new Error('לא ניתן להחזיר לבקלוג. משימות משובצות שתלויות בה: ' + blockers.map(t => t.title).join(', '));
  const { startDate, endDate, requestedStartDate, effortWorkingDays, effortProvenance, scheduleIssue, ...rest } = task;
  doc.tasks[index] = { ...rest, estimatedWorkingDays: requiredEffort(task), planningState: 'backlog' }; return doc;
}

// Attendance persists even when the entire affected schedule transaction cannot resolve.
export function changeAttendance(document: RoadmapDocument, entry: AttendanceException): { document: RoadmapDocument; changed: string[]; unresolved: boolean } {
  validateAttendance(document, entry);
  const base = clone(document);
  base.attendance = [...(base.attendance ?? []).filter(old => old.memberId !== entry.memberId || old.date !== entry.date)];
  if (entry.status === 'absent') base.attendance.push(entry);
  const affected = new Set(base.tasks.filter(isScheduled).filter(task => task.assigneeId === entry.memberId && task.status !== 'completed' &&
    entry.date >= (task.requestedStartDate ?? task.startDate) && (entry.date <= task.endDate || !!task.scheduleIssue)).map(task => task.id));
  for (const id of topological(base)) if (affected.has(id)) for (const link of base.dependencies.filter(link => link.predecessorId === id)) affected.add(link.successorId);
  const next = clone(base), changed: string[] = [];
  try {
    for (const id of topological(next)) {
      const task = next.tasks.find(task => task.id === id)!;
      if (!affected.has(id) || !isScheduled(task) || task.status === 'completed') continue;
      const minimum = requiredStart(next, id), anchor = task.requestedStartDate ?? task.startDate;
      task.requestedStartDate = anchor;
      moveTask(next, task, minimum && minimum > anchor ? minimum : anchor);
      const old = document.tasks.find(old => old.id === id)!;
      if (old.startDate !== task.startDate || old.endDate !== task.endDate || (isScheduled(old) && old.scheduleIssue)) changed.push(task.title);
    }
    return { document: next, changed, unresolved: false };
  } catch (error) {
    for (const task of base.tasks.filter(isScheduled)) if (affected.has(task.id) && task.status !== 'completed')
      task.scheduleIssue = 'תאריכים קודמים — השיבוץ אינו מעודכן: ' + (error as Error).message;
    return { document: base, changed: [], unresolved: true };
  }
}
