import { clone, Dependency, RoadmapDocument, Task } from './model';
import { addWorkingDays, duration, nextWorkingDay, validateRange, workingDifference } from './dates';
export function topological(doc: RoadmapDocument): string[] {
  const indegree = new Map(doc.tasks.map(t => [t.id, 0]));
  const outgoing = new Map<string, string[]>();
  const pairs = new Set<string>();
  const tasks = new Map(doc.tasks.map(t => [t.id, t]));
  for (const d of doc.dependencies) {
    const a = tasks.get(d.predecessorId), b = tasks.get(d.successorId);
    if (!a || !b || a.workItemId !== b.workItemId) throw new Error('תלות חייבת לקשר משימות באותה עבודה');
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
  const tasks = doc.tasks.filter(t => t.workItemId === id);
  return tasks.length ? { startDate: tasks.map(t => t.startDate).sort()[0], endDate: tasks.map(t => t.endDate).sort().at(-1)! } : null;
}
function required(doc: RoadmapDocument, taskId: string, useLag = true): string | undefined {
  const tasks = new Map(doc.tasks.map(t => [t.id, t]));
  return doc.dependencies.filter(d => d.successorId === taskId)
    .map(d => addWorkingDays(tasks.get(d.predecessorId)!.endDate, 1 + (useLag ? d.lagWorkingDays : 0))).sort().at(-1);
}
function moveTask(task: Task, start: string): void {
  const length = duration(task.startDate, task.endDate); task.startDate = start; task.endDate = addWorkingDays(start, length - 1);
}
export function propagate(doc: RoadmapDocument, roots: string[]): void {
  const reachable = new Set(roots);
  const tasks = new Map(doc.tasks.map(t => [t.id, t]));
  for (const id of topological(doc)) {
    if (!reachable.has(id)) continue;
    if (!roots.includes(id)) { const start = required(doc, id); if (start) moveTask(tasks.get(id)!, start); }
    for (const d of doc.dependencies) if (d.predecessorId === id) reachable.add(d.successorId);
  }
}
export function editTask(document: RoadmapDocument, id: string, patch: Partial<Task>): RoadmapDocument {
  const doc = clone(document), task = doc.tasks.find(t => t.id === id);
  if (!task) throw new Error('המשימה לא נמצאה');
  const scheduling = (patch.startDate !== undefined && patch.startDate !== task.startDate) || (patch.endDate !== undefined && patch.endDate !== task.endDate);
  Object.assign(task, patch, { id: task.id, workItemId: task.workItemId });
  validateRange(task.startDate, task.endDate);
  if (scheduling) {
    const minimum = required(doc, id); if (minimum && task.startDate < minimum) moveTask(task, minimum);
    // A deliberate delay is expressed as an incoming working-day lag for every predecessor.
    for (const d of doc.dependencies.filter(d => d.successorId === id)) {
      const predecessor = doc.tasks.find(t => t.id === d.predecessorId)!;
      d.lagWorkingDays = Math.max(0, workingDifference(addWorkingDays(predecessor.endDate, 1), task.startDate));
    }
    propagate(doc, [id]);
  }
  return doc;
}
export function shiftTask(doc: RoadmapDocument, id: string, start: string): RoadmapDocument {
  const task = doc.tasks.find(t => t.id === id)!;
  start = nextWorkingDay(start);
  return editTask(doc, id, { startDate: start, endDate: addWorkingDays(start, duration(task.startDate, task.endDate) - 1) });
}
export function shiftWork(document: RoadmapDocument, id: string, start: string): RoadmapDocument {
  const doc = clone(document), range = workRange(doc, id); if (!range) return doc;
  const delta = workingDifference(range.startDate, nextWorkingDay(start));
  for (const task of doc.tasks.filter(t => t.workItemId === id)) {
    task.startDate = addWorkingDays(task.startDate, delta); task.endDate = addWorkingDays(task.endDate, delta);
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
  // New links preserve an already legal start; explicit edits to existing lag values take effect.
  for (const d of doc.dependencies.filter(d => d.successorId === id && !previous.has(d.predecessorId))) {
    const p = doc.tasks.find(t => t.id === d.predecessorId)!;
    d.lagWorkingDays = Math.max(d.lagWorkingDays, workingDifference(addWorkingDays(p.endDate, 1), task.startDate));
  }
  const min = required(doc, id);
  if (min && min > task.startDate) { moveTask(task, min); propagate(doc, [id]); }
  const edited = incoming.some(d => document.dependencies.some(old => old.id === d.id && old.lagWorkingDays !== d.lagWorkingDays));
  if (edited && min) { moveTask(task, min); propagate(doc, [id]); }
  return doc;
}
