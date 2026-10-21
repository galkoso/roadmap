import { clone, RoadmapDocument, Task, TeamMember } from './model.js';
export const membersForTeam = (doc: RoadmapDocument, teamId: string | null): TeamMember[] =>
  doc.members.filter(m => m.teamId === teamId).sort((a, b) => a.order - b.order);
export function memberLabel(doc: RoadmapDocument, member: TeamMember): string {
  const duplicates = doc.members.filter(m => m.teamId === member.teamId && m.name === member.name);
  let length = Math.min(8, member.id.length);
  while (length < member.id.length && duplicates.some(m => m.id !== member.id && m.id.startsWith(member.id.slice(0, length)))) length++;
  return member.name + (duplicates.length > 1 ? ' · ' + member.id.slice(0, length) : '');
}
export function validateAssignment(doc: RoadmapDocument, task: Task, assigneeId: string | null): void {
  if (assigneeId !== null && (!task.teamId || !doc.members.some(m => m.id === assigneeId && m.teamId === task.teamId)))
    throw new Error('האחראי חייב להשתייך לצוות המשימה');
}
export function assignTask(document: RoadmapDocument, taskId: string, assigneeId: string | null): RoadmapDocument {
  const doc = clone(document), task = doc.tasks.find(t => t.id === taskId);
  if (!task) throw new Error('המשימה אינה קיימת');
  validateAssignment(doc, task, assigneeId); task.assigneeId = assigneeId; return doc;
}
// Used by both draft editors and immediate team changes; no scheduling takes place.
export function changeTaskTeam(doc: RoadmapDocument, task: Task, teamId: string | null): boolean {
  if (teamId !== null && !doc.teams.some(t => t.id === teamId)) throw new Error('הצוות אינו קיים');
  task.teamId = teamId;
  const heading = doc.workItems.find(w => w.id === task.workItemId);
  if (heading?.teamId !== undefined && heading.teamId !== teamId) task.workItemId = null;
  const reset = !!task.assigneeId && !doc.members.some(m => m.id === task.assigneeId && m.teamId === teamId);
  if (reset) task.assigneeId = null;
  return reset;
}
export const assignedCount = (doc: RoadmapDocument, memberId: string): number => doc.tasks.filter(t => t.assigneeId === memberId).length;
export function updateMember(document: RoadmapDocument, id: string, name: string, teamId: string): RoadmapDocument {
  const doc = clone(document), member = doc.members.find(m => m.id === id);
  if (!member) throw new Error('איש הצוות אינו קיים');
  if (!name.trim()) throw new Error('יש להזין שם');
  if (!doc.teams.some(t => t.id === teamId)) throw new Error('הצוות אינו קיים');
  if (member.teamId !== teamId) for (const task of doc.tasks) if (task.assigneeId === id) task.assigneeId = null;
  Object.assign(member, { name: name.trim(), teamId }); return doc;
}
export function removeMember(document: RoadmapDocument, id: string): RoadmapDocument {
  const doc = clone(document); doc.members = doc.members.filter(m => m.id !== id);
  for (const task of doc.tasks) if (task.assigneeId === id) task.assigneeId = null;
  return doc;
}
export interface PersonGroup<T extends Task = Task> { key: string; name: string; member?: TeamMember; tasks: T[] }
export interface PersonTeam<T extends Task = Task> { key: string; teamId: string | null; name: string; tasks: T[]; groups: PersonGroup<T>[] }
export const personKey = (teamId: string, memberId: string | null): string => 'person:' + teamId + ':' + (memberId ?? 'unassigned');
export function groupByPeople<T extends Task>(doc: RoadmapDocument, tasks: T[]): PersonTeam<T>[] {
  const teams: { id: string | null; name: string }[] = [...doc.teams].sort((a, b) => a.order - b.order);
  teams.push({ id: null, name: 'ללא צוות' });
  return teams.map(team => {
    const owned = tasks.filter(t => t.teamId === team.id).sort((a, b) => a.order - b.order);
    return { key: team.id ? 'team:' + team.id : 'team:unassigned', teamId: team.id, name: team.name, tasks: owned,
      groups: team.id === null ? [] : [
        ...membersForTeam(doc, team.id).map(member => ({ key: personKey(team.id!, member.id), name: memberLabel(doc, member), member, tasks: owned.filter(t => t.assigneeId === member.id) })),
        { key: personKey(team.id, null), name: 'ללא אחראי', tasks: owned.filter(t => !t.assigneeId) }
      ] };
  });
}
