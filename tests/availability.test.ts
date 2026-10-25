import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { executionSchedule, isAvailable, monthDates, nextAvailableDate, personCapacity, rangeEffort, requiredEffort, teamCapacity } from '../src/app/core/availability';
import { addDays, daysBetween, isWorkingDay } from '../src/app/core/dates';
import { assignTask } from '../src/app/core/members';
import { clone, isScheduled, RoadmapDocument, ScheduledTask } from '../src/app/core/model';
import { capacitySummary, memberCapacitySummary, selectPlanningTask, taskEffort } from '../src/app/core/planning';
import { changeAttendance, editTask, scheduleTask, shiftTask, shiftWork } from '../src/app/core/scheduler';
import { initialPreferences, seedDocument } from '../src/app/core/seed';
import { RoadmapStorage } from '../src/app/core/storage';
import { exportBackup, parseBackup, validateDocument } from '../src/app/core/validation';
export function calendarFixture(): RoadmapDocument {
  const doc = seedDocument(); doc.dependencies = []; doc.tasks = []; doc.attendance = [];
  doc.members = [{ id: 'noa', teamId: 'team-a', name: 'נועה', order: 0 }, { id: 'dor', teamId: 'team-a', name: 'דור', order: 1 }];
  return doc;
}
const get = (doc: RoadmapDocument, id = 'a') => doc.tasks.find(t => t.id === id) as ScheduledTask;
function backlog(doc: RoadmapDocument, id = 'a', assigneeId: string | null = 'noa'): RoadmapDocument {
  doc.tasks.push({ id, assigneeId, teamId: 'team-a', workItemId: 'services', estimatedWorkingDays: 5,
    title: id, color: '#3975d5', status: 'planned', notes: 'preserve', order: doc.tasks.length, planningState: 'backlog' }); return doc;
}
function schedule(doc: RoadmapDocument, id = 'a', startDate = '2026-10-25', workingDays = 5) {
  return scheduleTask(doc, id, { startDate, workingDays, teamId: 'team-a', workItemId: 'services' });
}
function absent(doc: RoadmapDocument, dates: string[], memberId = 'noa') {
  doc.attendance = [...(doc.attendance ?? []), ...dates.map(date => ({ memberId, date, status: 'absent' as const }))]; return doc;
}
const absences = ['2026-10-26', '2026-10-28', '2026-11-02', '2026-11-03', '2026-11-04'];

describe('exact-date attendance and shared capacity', () => {
  it('defaults to Sunday–Thursday without writing records, and separates people, months and years', () => {
    const doc = calendarFixture(), before = clone(doc);
    expect(personCapacity(doc, 'noa', '2026-10')).toEqual({ base: 21, absent: 0, available: 21 }); expect(doc).toEqual(before);
    const next = changeAttendance(doc, { memberId: 'noa', date: '2026-10-26', status: 'absent' }).document;
    expect(personCapacity(next, 'noa', '2026-10').available).toBe(20);
    expect(personCapacity(next, 'dor', '2026-10').available).toBe(21);
    expect(personCapacity(next, 'noa', '2027-10').available).toBe(monthDates('2027-10').filter(isWorkingDay).length);
    expect(personCapacity(next, 'noa', '2026-11').absent).toBe(0);
    expect(teamCapacity(next, 'team-a', '2026-10')).toBe(41);
    expect(capacitySummary(next, 'team-a', '2026-10').available).toBe(41);
    expect(memberCapacitySummary(next, 'team-a', 'noa', '2026-10').available).toBe(20);
    expect(changeAttendance(next, { memberId: 'noa', date: '2026-10-26', status: 'present' }).document.attendance).toEqual([]);
  });
  it('rejects invalid dates, weekends, statuses and dangling people at the domain and import boundaries', () => {
    for (const entry of [{ memberId: 'noa', date: '2026-02-30', status: 'absent' }, { memberId: 'noa', date: '2026-10-30', status: 'present' },
      { memberId: 'missing', date: '2026-10-25', status: 'absent' }, { memberId: 'noa', date: '2026-10-25', status: 'unknown' }]) {
      const doc = calendarFixture();
      expect(() => changeAttendance(doc, entry as any)).toThrow(); expect(() => validateDocument({ ...doc, attendance: [entry] })).toThrow();
    }
    const doc = absent(calendarFixture(), ['2026-10-26', '2026-10-26']); expect(() => validateDocument(doc)).toThrow(/כפולה/);
  });
});
describe('effort distinct from elapsed time', () => {
  it('executes the five-day Noa fixture through November 5 with a 12-date continuous bar', () => {
    const doc = schedule(backlog(absent(calendarFixture(), absences))), task = get(doc);
    expect(task).toMatchObject({ requestedStartDate: '2026-10-25', startDate: '2026-10-25', endDate: '2026-11-05', effortWorkingDays: 5 });
    const result = executionSchedule(doc, 'noa', task.requestedStartDate!, requiredEffort(task));
    expect(result.executionDates).toEqual(['2026-10-25', '2026-10-27', '2026-10-29', '2026-11-01', '2026-11-05']);
    expect(result.elapsedDays).toBe(12); expect(daysBetween(task.startDate, task.endDate) + 1).toBe(12); expect(taskEffort(task)).toBe(5);
    expect(rangeEffort(doc, 'noa', task.startDate, task.endDate)).toBe(5);
  });
  it.each([['2026-12-31', 2, '2027-01-03'], ['2024-02-28', 2, '2024-02-29'], ['2026-03-26', 2, '2026-03-29'], ['2026-10-29', 2, '2026-11-01']])('crosses date-only boundaries from %s', (start, effort, end) => {
    expect(executionSchedule(calendarFixture(), 'noa', start, effort).endDate).toBe(end);
  });
  it('counts one-day work inclusively and advances an unavailable anchor without changing effort', () => {
    const doc = absent(calendarFixture(), ['2026-10-25']);
    expect(executionSchedule(doc, 'noa', '2026-10-26', 1)).toMatchObject({ startDate: '2026-10-26', endDate: '2026-10-26', elapsedDays: 1 });
    expect(nextAvailableDate(doc, 'noa', '2026-10-23')).toBe('2026-10-26');
    expect(executionSchedule(doc, null, '2026-10-25', 1).endDate).toBe('2026-10-25');
    expect(() => executionSchedule(doc, 'noa', '2026-10-25', 1.5)).toThrow(/שלם/);
    expect(() => rangeEffort(doc, 'noa', '2026-10-23', '2026-10-25')).toThrow(/אין ימי/);
  });
  it('uses the same rules for reassignment, effort edits, body dragging, resizing, and work shifts', () => {
    const doc = schedule(backlog(absent(calendarFixture(), absences)));
    expect(get(assignTask(doc, 'a', 'dor')).endDate).toBe('2026-10-29');
    expect(get(editTask(doc, 'a', { effortWorkingDays: 3 })).endDate).toBe('2026-10-29');
    const moved = get(shiftTask(doc, 'a', '2026-10-26'));
    expect(moved).toMatchObject({ requestedStartDate: '2026-10-26', startDate: '2026-10-27', endDate: '2026-11-08', effortWorkingDays: 5 });
    expect(get(editTask(doc, 'a', { endDate: '2026-11-01' })).effortWorkingDays).toBe(4);
    expect(get(editTask(doc, 'a', { startDate: '2026-10-27' }))).toMatchObject({ startDate: '2026-10-27', endDate: '2026-11-05', effortWorkingDays: 4 });
    expect(get(shiftWork(doc, 'services', '2026-10-26'))).toMatchObject({ requestedStartDate: '2026-10-26', effortWorkingDays: 5, endDate: '2026-11-08' });
  });
});
describe('attendance impact and atomic scheduling', () => {
  it('extends and shortens descendants using their own calendar, preserving anchors, global lag and independent/completed schedules', () => {
    let doc = schedule(backlog(calendarFixture()), 'a', '2026-10-25', 1);
    doc = schedule(backlog(doc, 'b', 'dor'), 'b', '2026-10-26', 1);
    doc = schedule(backlog(doc, 'independent', 'dor'), 'independent', '2026-10-25', 1);
    doc = schedule(backlog(doc, 'history'), 'history', '2026-10-25', 1); get(doc, 'history').status = 'completed';
    doc.dependencies = [{ id: 'ab', predecessorId: 'a', successorId: 'b', type: 'finish_to_start', lagWorkingDays: 0 }];
    absent(doc, ['2026-10-27'], 'dor');
    const next = changeAttendance(doc, { memberId: 'noa', date: '2026-10-25', status: 'absent' });
    expect(next.unresolved).toBe(false); expect(next.changed).toEqual(['a', 'b']);
    expect(get(next.document)).toMatchObject({ startDate: '2026-10-26', endDate: '2026-10-26', effortWorkingDays: 1, requestedStartDate: '2026-10-25' });
    expect(get(next.document, 'b').startDate).toBe('2026-10-28');
    expect(get(next.document, 'independent')).toEqual(get(doc, 'independent')); expect(get(next.document, 'history')).toEqual(get(doc, 'history'));
    const restored = changeAttendance(next.document, { memberId: 'noa', date: '2026-10-25', status: 'present' }).document;
    expect(get(restored).endDate).toBe('2026-10-25'); expect(get(restored, 'b').startDate).toBe('2026-10-26'); validateDocument(restored);
  });
  it('bounds exhausted searches and preserves attendance with all affected last-known schedules explicitly outdated', () => {
    let doc = schedule(backlog(calendarFixture()), 'a', '2026-10-25', 1);
    doc = schedule(backlog(doc, 'b', 'dor'), 'b', '2026-10-26', 1);
    doc.dependencies = [{ id: 'ab', predecessorId: 'a', successorId: 'b', type: 'finish_to_start', lagWorkingDays: 0 }];
    const dates = Array.from({ length: 1096 }, (_, i) => addDays('2026-10-25', i)).filter(isWorkingDay);
    absent(doc, dates.slice(1));
    const before = clone(doc); expect(() => executionSchedule(absent(clone(doc), dates.slice(0, 1)), 'noa', '2026-10-25', 1)).toThrow(/שלוש שנים/);
    const next = changeAttendance(doc, { memberId: 'noa', date: dates[0], status: 'absent' });
    expect(doc).toEqual(before); expect(next.unresolved).toBe(true); expect(next.document.attendance).toHaveLength(dates.length);
    for (const task of next.document.tasks.filter(isScheduled)) { expect(task.startDate).toBe(get(doc, task.id).startDate); expect(task.scheduleIssue).toMatch(/אינו מעודכן/); }
    validateDocument(next.document);
  });
});
describe('migration, storage and backup', () => {
  it('archives manual capacity, infers legacy effort once and never extends completed historical dates', () => {
    const old = seedDocument(); old.schemaVersion = 6;
    old.planning.plans = [{ period: '2026-10', selectedTaskIds: [], teamCapacities: [{ teamId: 'team-a', availableWorkingDays: 15, memberAvailability: [] }] }];
    const before = clone(old), doc = validateDocument(old);
    expect(old).toEqual(before); expect(doc.schemaVersion).toBe(7); expect(doc.attendance).toEqual([]);
    expect(doc.legacyCapacityArchive).toEqual(before.planning.plans.map(({ period, teamCapacities }) => ({ period, teamCapacities }))); expect(doc.calendarMigrationNote).toBeTruthy();
    for (const task of doc.tasks.filter(isScheduled)) expect(task).toMatchObject({ startDate: get(before, task.id).startDate, endDate: get(before, task.id).endDate,
      requestedStartDate: get(before, task.id).startDate, effortProvenance: 'legacy-global-calendar' });
    expect(validateDocument(doc)).toEqual(doc);
  });
  it('round-trips exact dates, period preferences, anchors and effort without changing planning membership; rejects imports before replacement', async () => {
    let doc = backlog(absent(calendarFixture(), absences)); doc = selectPlanningTask(doc, 'a', true, undefined, '2026-10'); doc = schedule(doc);
    const prefs = { ...initialPreferences(), velocityMemberId: 'noa', planning: { activeTeamId: 'team-a', activePeriod: '2026-10', collapsedGroups: [], expandedTeamIds: [] } };
    const backup = parseBackup(exportBackup(doc, prefs)); expect(backup.document).toEqual(doc); expect(backup.preferences).toEqual(prefs);
    const storage = new RoadmapStorage('velocity-' + crypto.randomUUID()); await storage.save(doc, prefs, null);
    const before = await storage.load(); expect(before?.document.attendance).toEqual(doc.attendance);
    expect(() => parseBackup(JSON.stringify({ ...backup, document: { ...doc, attendance: [...doc.attendance!, doc.attendance![0]] } }))).toThrow();
    expect(await storage.load()).toEqual(before); expect(get(before!.document).effortWorkingDays).toBe(5);
  });
});

it('preserves global lag semantics when personal absences delay a successor and its effort changes', () => {
  let doc = schedule(backlog(calendarFixture()), 'a', '2026-10-25', 1);
  backlog(doc, 'b', 'dor'); absent(doc, ['2026-10-28', '2026-10-29'], 'dor');
  doc.dependencies = [{ id: 'ab', predecessorId: 'a', successorId: 'b', type: 'finish_to_start', lagWorkingDays: 2 }];
  doc = schedule(doc, 'b', '2026-10-25', 1);
  expect(get(doc, 'b')).toMatchObject({ requestedStartDate: '2026-10-25', startDate: '2026-11-01' });
  expect(doc.dependencies[0].lagWorkingDays).toBe(2);
  doc = editTask(doc, 'b', { requestedStartDate: '2026-10-25', effortWorkingDays: 2 });
  expect(doc.dependencies[0].lagWorkingDays).toBe(2); expect(get(doc, 'b').endDate).toBe('2026-11-02');
});
it('keeps completed descendants historical and earlier independent tasks byte-for-byte unchanged', () => {
  let doc = schedule(backlog(calendarFixture()), 'a', '2026-10-25', 1);
  doc = schedule(backlog(doc, 'b', 'dor'), 'b', '2026-10-26', 1); get(doc, 'b').status = 'completed';
  doc = schedule(backlog(doc, 'earlier'), 'earlier', '2026-10-22', 1);
  doc.dependencies = [{ id: 'ab', predecessorId: 'a', successorId: 'b', type: 'finish_to_start', lagWorkingDays: 0 }];
  absent(doc, ['2026-10-26', '2026-10-27']);
  const next = changeAttendance(doc, { memberId: 'noa', date: '2026-10-25', status: 'absent' }).document;
  expect(get(next).endDate).toBe('2026-10-28');
  expect(get(next, 'b')).toEqual(get(doc, 'b')); expect(get(next, 'earlier')).toEqual(get(doc, 'earlier')); validateDocument(next);
});
