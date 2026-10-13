import { describe, expect, it } from 'vitest';
import { clone, isScheduled, RoadmapDocument, Task } from '../src/app/core/model';
import { seedDocument, initialPreferences } from '../src/app/core/seed';
import { addWorkingDays, duration } from '../src/app/core/dates';
import { returnToBacklog, scheduleTask, shiftTask, shiftWork, topological, workRange } from '../src/app/core/scheduler';
import { exportBackup, parseBackup, validateDocument } from '../src/app/core/validation';
const get = (doc: RoadmapDocument, id: string) => doc.tasks.find(t => t.id === id)!;
const standalone = (): Task => ({ id: 'backlog-new', planningState: 'backlog', teamId: null, workItemId: null, title: 'רעיון', notes: '<b>טקסט</b>', color: '#abcdef', status: 'completed', order: 4 });
function legacyDocument(): Record<string, unknown> {
  const doc = clone(seedDocument());
  return { ...doc, schemaVersion: 1, tasks: doc.tasks.map(({ planningState, ...task }) => task) };
}
describe('backlog schema and legacy migration', () => {
  it('migrates every old task as scheduled with identical IDs, dates, metadata and dependencies; input is untouched', () => {
    const old = legacyDocument(), before = clone(old), migrated = validateDocument(old);
    expect(migrated.schemaVersion).toBe(2); expect(old).toEqual(before);
    expect(migrated.tasks.map(({ planningState, ...task }) => task)).toEqual(old['tasks']);
    expect(migrated.tasks.every(isScheduled)).toBe(true); expect(migrated.dependencies).toEqual(old['dependencies']);
    const backup = parseBackup(JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), document: old, preferences: initialPreferences() }));
    expect(backup.schemaVersion).toBe(2); expect(backup.document).toEqual(migrated);
  });
  it('rejects invalid old data instead of inventing dates or unassigning teams', () => {
    const bad = legacyDocument(), before = clone(bad);
    (bad['tasks'] as Record<string, unknown>[])[0]['startDate'] = '2026-02-30';
    expect(() => validateDocument(bad)).toThrow(); expect(bad['schemaVersion']).toBe(before['schemaVersion']);
    (bad['tasks'] as Record<string, unknown>[])[0]['teamId'] = null; expect(() => validateDocument(bad)).toThrow(/ישנים/);
  });
  it('stores date-free unassigned independent backlog with execution status separate from planning status', () => {
    const doc = seedDocument(); doc.tasks.push(standalone());
    const valid = validateDocument(doc); expect(get(valid, 'backlog-new')).toEqual(standalone());
    expect(parseBackup(exportBackup(valid, initialPreferences())).document).toEqual(valid);
    expect(() => validateDocument({ ...valid, tasks: [...valid.tasks.slice(0, -1), { ...standalone(), startDate: '2026-10-13' }] })).toThrow(/דמה/);
    expect(() => validateDocument({ ...valid, tasks: [...valid.tasks.slice(0, -1), { ...standalone(), planningState: 'scheduled' }] })).toThrow();
  });
});
describe('planning state transitions and scheduling with missing dates', () => {
  it('schedules the same ID without a team/work; Thursday + 2 working days ends Sunday; one day is inclusive', () => {
    const doc = seedDocument(); doc.tasks.push(standalone());
    const scheduled = scheduleTask(doc, 'backlog-new', { startDate: '2026-10-15', workingDays: 2, teamId: null, workItemId: null });
    const task = get(scheduled, 'backlog-new'); expect(isScheduled(task)).toBe(true);
    expect(task.startDate).toBe('2026-10-15'); expect(task.endDate).toBe('2026-10-18'); expect(scheduled.tasks.length).toBe(doc.tasks.length);
    expect(task.notes).toBe(standalone().notes); expect(task.status).toBe('completed'); expect(task.color).toBe('#abcdef');
    const single = scheduleTask(doc, 'backlog-new', { startDate: '2026-10-15', workingDays: 1, teamId: null, workItemId: null });
    expect(get(single, 'backlog-new').endDate).toBe('2026-10-15');
    expect(returnToBacklog(scheduled, 'backlog-new')).toEqual(doc);
    expect(() => scheduleTask(doc, 'backlog-new', { startDate: '2026-10-16', workingDays: 2, teamId: null, workItemId: null })).toThrow(/שישי/);
  });
  it('backlog tasks do not affect the shared work range and stay date-free during task/work dragging', () => {
    const doc = returnToBacklog(seedDocument(), 'testing'), before = clone(get(doc, 'testing')), range = workRange(doc, 'services')!;
    const shifted = shiftWork(doc, 'services', addWorkingDays(range.startDate, 5)); expect(get(shifted, 'testing')).toEqual(before);
    expect(workRange(doc, 'services')!.endDate).toBe(get(doc, 'implementation').endDate);
    const moved = shiftTask(doc, 'architecture', addWorkingDays(get(doc, 'architecture').startDate!, 2));
    expect(get(moved, 'testing')).toEqual(before); expect(moved.dependencies).toEqual(doc.dependencies);
  });
  it('preserves links, blocks return of a predecessor of scheduled tasks, and requires unscheduled predecessors before scheduling', () => {
    const original = seedDocument(); expect(() => returnToBacklog(original, 'architecture')).toThrow(/מימוש השירותים/);
    let doc = returnToBacklog(original, 'testing'); doc = returnToBacklog(doc, 'implementation'); doc = returnToBacklog(doc, 'architecture');
    expect(doc.dependencies).toEqual(original.dependencies); const before = clone(doc);
    expect(() => scheduleTask(doc, 'testing', { startDate: '2026-10-15', workingDays: 2, teamId: 'team-c', workItemId: 'services' })).toThrow(/מימוש השירותים/);
    expect(doc).toEqual(before);
    doc = scheduleTask(doc, 'architecture', { startDate: '2026-10-15', workingDays: 3, teamId: 'team-a', workItemId: 'services' });
    expect(get(doc, 'implementation').planningState).toBe('backlog'); expect(get(doc, 'testing').planningState).toBe('backlog');
    doc = scheduleTask(doc, 'implementation', { startDate: '2026-10-15', workingDays: 5, teamId: 'team-b', workItemId: 'services' });
    expect(get(doc, 'implementation').startDate).toBe(addWorkingDays(get(doc, 'architecture').endDate!, 1));
    expect(duration(get(doc, 'implementation').startDate!, get(doc, 'implementation').endDate!)).toBe(5);
    expect(get(doc, 'testing').planningState).toBe('backlog'); validateDocument(doc);
  });
  it('cycles and cross-work links remain invalid when tasks are in the backlog', () => {
    let doc = returnToBacklog(seedDocument(), 'testing'); doc = returnToBacklog(doc, 'implementation'); doc = returnToBacklog(doc, 'architecture');
    doc.dependencies.push({ id: 'cycle-backlog', predecessorId: 'testing', successorId: 'architecture', type: 'finish_to_start', lagWorkingDays: 0 });
    expect(() => topological(doc)).toThrow(/מעגל/);
    doc.dependencies.pop(); get(doc, 'testing').workItemId = null; expect(() => topological(doc)).toThrow(/אותה עבודה/);
  });
});
