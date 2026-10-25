import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { IDBObjectStore } from 'fake-indexeddb';
import { clone, RoadmapDocument, SCHEMA_VERSION } from '../src/app/core/model';
import { initialPreferences, seedDocument } from '../src/app/core/seed';
import {
  assignPlanningTask, capacitySummary, currentPlanningPeriod, effortTotal, emptyPlanningPreferences, memberCapacitySummary, monthlyPlan,
  movePlanningTask, parseCapacityDays, planningGroups, planningMemberId, planningTasks, reconcilePlanning, selectPlanningTask, setCapacity, taskEffort
} from '../src/app/core/planning';
import { changeTaskTeam, updateMember } from '../src/app/core/members';
import { editTask, returnToBacklog, scheduleTask } from '../src/app/core/scheduler';
import { exportBackup, parseBackup, validateDocument, validatePreferences } from '../src/app/core/validation';
import { RoadmapStorage } from '../src/app/core/storage';
const OCT = '2026-10', NOV = '2026-11';
function fixture(): RoadmapDocument {
  const doc = seedDocument(); doc.dependencies = [];
  doc.members = [{ id: 'member-a', teamId: 'team-a', name: 'דנה', order: 0 }, { id: 'member-b', teamId: 'team-a', name: 'אורי', order: 1 },
    { id: 'other-member', teamId: 'team-b', name: 'נועה', order: 2 }];
  doc.workItems = [{ id: 'work-a', title: 'שם זהה', order: 0 }, { id: 'work-b', title: 'שם זהה', order: 1 }];
  doc.tasks = [
    { id: 'a', workItemId: 'work-a', estimatedWorkingDays: 5, assigneeId: 'member-a', teamId: 'team-a' },
    { id: 'b', workItemId: 'work-a', estimatedWorkingDays: 3, assigneeId: null, teamId: 'team-a' },
    { id: 'unknown', workItemId: 'work-b', assigneeId: null, teamId: 'team-a' },
    { id: 'solo', workItemId: null, estimatedWorkingDays: 2, assigneeId: null, teamId: 'team-a' },
    { id: 'no-team', workItemId: null, estimatedWorkingDays: 4, assigneeId: null, teamId: null }
  ].map((task, order) => ({ ...task, order, planningState: 'backlog', title: task.id, color: '#3975d5', status: 'planned', notes: 'הערות לשימור' }));
  return doc;
}
const task = (doc: RoadmapDocument, id: string) => doc.tasks.find(task => task.id === id)!;
const select = (doc: RoadmapDocument, id: string, period = OCT) => selectPlanningTask(doc, id, true, 'team-a', period);

describe('monthly task selection', () => {
  it('keeps selections isolated by month and year without changing task records or original backlog eligibility', () => {
    const doc = fixture(), before = clone(doc);
    let next = select(doc, 'a'); next = select(next, 'b', NOV); next = select(next, 'solo', '2027-10');
    expect(planningTasks(next, 'team-a', 'selected', 'team', OCT).map(t => t.id)).toEqual(['a']);
    expect(planningTasks(next, 'team-a', 'selected', 'team', NOV).map(t => t.id)).toEqual(['b']);
    expect(planningTasks(next, 'team-a', 'selected', 'team', '2027-10').map(t => t.id)).toEqual(['solo']);
    expect(monthlyPlan(next, '2028-01').selectedTaskIds).toEqual([]); expect(next.tasks).toEqual(before.tasks); expect(doc).toEqual(before);
    expect(next.tasks.filter(t => t.planningState === 'backlog')).toHaveLength(5);
  });
  it('prevents duplicate selection within or across months and moves a task with its planning assignee only', () => {
    let doc = assignPlanningTask(select(fixture(), 'a'), 'a', 'member-b', OCT);
    doc = select(doc, 'a'); expect(monthlyPlan(doc, OCT).selectedTaskIds).toEqual(['a']);
    expect(() => select(doc, 'a', NOV)).toThrow(/חודש אחר/);
    expect(planningTasks(doc, 'team-a', 'candidates', 'all', NOV).some(t => t.id === 'a')).toBe(false);
    const moved = movePlanningTask(doc, 'a', OCT, NOV);
    expect(monthlyPlan(moved, OCT).selectedTaskIds).toEqual([]); expect(monthlyPlan(moved, NOV).selectedTaskIds).toEqual(['a']);
    expect(planningMemberId(moved, 'a', NOV)).toBe('member-b'); expect(moved.tasks).toEqual(doc.tasks);
    expect(movePlanningTask(moved, 'a', NOV, NOV)).toEqual(moved);
  });
  it('handles unassigned backlog, source filters, removal and original team independence', () => {
    let doc = select(fixture(), 'no-team');
    expect(task(doc, 'no-team').teamId).toBeNull(); expect(planningTasks(doc, 'team-a', 'selected', 'team', OCT).map(t => t.id)).toEqual(['no-team']);
    expect(planningTasks(doc, 'team-b', 'candidates', 'unassigned', NOV)).toEqual([]);
    changeTaskTeam(doc, task(doc, 'no-team'), 'team-b'); expect(planningTasks(doc, 'team-a', 'selected', 'team', OCT).map(t => t.id)).toEqual(['no-team']);
    doc = selectPlanningTask(doc, 'no-team', false, undefined, OCT);
    expect(planningTasks(doc, 'team-b', 'candidates', 'team', NOV).map(t => t.id)).toEqual(['no-team']);
    const base = fixture(); expect(planningTasks(base, 'team-a', 'candidates', 'unassigned', OCT).map(t => t.id)).toEqual(['no-team']);
    expect(planningTasks(base, 'team-a', 'candidates', 'team', OCT).map(t => t.id)).not.toContain('no-team');
  });
  it('groups by stable work identity, separates pane counts and retains missing effort', () => {
    const doc = select(select(select(fixture(), 'a'), 'unknown'), 'solo');
    const groups = planningGroups(doc, planningTasks(doc, 'team-a', 'selected', 'team', OCT));
    expect(groups.map(g => g.workItemId)).toEqual(['work-a', 'work-b', null]);
    expect(groups.map(g => effortTotal(g.tasks))).toEqual([{ known: 5, missing: 0 }, { known: 0, missing: 1 }, { known: 2, missing: 0 }]);
    expect(planningGroups(doc, planningTasks(doc, 'team-a', 'candidates', 'team', OCT))[0].tasks.map(t => t.id)).toEqual(['b']);
  });
});

describe('people capacity and planned workload', () => {
  it('calculates team capacity from people and keeps availability isolated by month, year and team', () => {
    let doc = setCapacity(fixture(), 'team-a', 15.5, 'member-a', OCT);
    doc = setCapacity(doc, 'team-a', 10, 'member-b', OCT); doc = setCapacity(doc, 'team-a', 4, 'member-a', NOV);
    doc = setCapacity(doc, 'team-a', 0, 'member-b', NOV); doc = setCapacity(doc, 'team-b', 7, 'other-member', OCT);
    expect(capacitySummary(doc, 'team-a', OCT)).toMatchObject({ available: 25.5, missingAvailability: 0, remaining: 25.5 });
    expect(capacitySummary(doc, 'team-a', NOV)).toMatchObject({ available: 4, missingAvailability: 0 });
    expect(capacitySummary(doc, 'team-a', '2027-10')).toMatchObject({ available: 0, missingAvailability: 2 });
    expect(capacitySummary(doc, 'team-b', OCT).available).toBe(7); expect(doc.tasks).toEqual(fixture().tasks);
    // Old manually entered capacity remains archival data; the team total always comes from people now.
    monthlyPlan(doc, OCT).teamCapacities[0].availableWorkingDays = 100;
    expect(capacitySummary(doc, 'team-a', OCT).available).toBe(25.5);
  });
  it('subtracts each assigned task once from its person, uses the original assignee and updates that same field on reassignment', () => {
    let doc = select(select(fixture(), 'a'), 'b'); doc = setCapacity(doc, 'team-a', 10, 'member-a', OCT); doc = setCapacity(doc, 'team-a', 4, 'member-b', OCT);
    const before = clone(doc.tasks); doc = assignPlanningTask(doc, 'a', 'member-a', OCT); doc = assignPlanningTask(doc, 'b', 'member-a', OCT);
    expect(memberCapacitySummary(doc, 'team-a', 'member-a', OCT)).toMatchObject({ available: 10, known: 8, remaining: 2, tasks: 2 });
    doc = assignPlanningTask(doc, 'a', 'member-b', OCT);
    expect(memberCapacitySummary(doc, 'team-a', 'member-a', OCT).remaining).toBe(7);
    expect(memberCapacitySummary(doc, 'team-a', 'member-b', OCT)).toMatchObject({ known: 5, remaining: -1 });
    expect(capacitySummary(doc, 'team-a', OCT)).toMatchObject({ known: 8, remaining: 6, unassignedTasks: 0 });
    expect(doc.tasks).toEqual(before.map(t => ({ ...t, assigneeId: t.id === 'a' ? 'member-b' : t.id === 'b' ? 'member-a' : t.assigneeId }))); 
    doc = assignPlanningTask(doc, 'a', null, OCT); expect(memberCapacitySummary(doc, 'team-a', 'member-b', OCT).remaining).toBe(4);
    expect(capacitySummary(doc, 'team-a', OCT).unassignedTasks).toBe(1);
  });
  it('assigns a task without a real team to an existing planning-team person without assigning the task to a team', () => {
    const doc = assignPlanningTask(select(fixture(), 'no-team'), 'no-team', 'member-a', OCT);
    expect(task(doc, 'no-team')).toEqual({ ...task(fixture(), 'no-team'), assigneeId: 'member-a' }); expect(planningMemberId(doc, 'no-team', OCT)).toBe('member-a');
    expect(memberCapacitySummary(doc, 'team-a', 'member-a', OCT)).toMatchObject({ available: null, known: 4, remaining: null });
    expect(() => assignPlanningTask(doc, 'no-team', 'other-member', OCT)).toThrow(/צוות/);
    expect(() => assignPlanningTask(doc, 'a', 'member-a', OCT)).toThrow(/החודש/);
  });
  it('reports unknown effort and unavailable capacity separately; effort edits update the same monthly record', () => {
    let doc = assignPlanningTask(select(fixture(), 'unknown'), 'unknown', 'member-a', OCT);
    expect(memberCapacitySummary(doc, 'team-a', 'member-a', OCT)).toMatchObject({ available: null, known: 0, missing: 1, remaining: null });
    doc = setCapacity(doc, 'team-a', 6, 'member-a', OCT);
    expect(memberCapacitySummary(doc, 'team-a', 'member-a', OCT)).toMatchObject({ remaining: 6, missing: 1 });
    task(doc, 'unknown').estimatedWorkingDays = 8; expect(memberCapacitySummary(doc, 'team-a', 'member-a', OCT)).toMatchObject({ remaining: -2, missing: 0 });
  });
  it.each(['', ' ', '-1', 'NaN', 'Infinity', '0.3', '1000001'])('rejects invalid availability %j', value => { expect(() => parseCapacityDays(value)).toThrow(); });
  it('accepts explicit zero and half days and rejects invalid months, years, people and teams', () => {
    expect(parseCapacityDays('0')).toBe(0); expect(parseCapacityDays('3.5')).toBe(3.5);
    for (const period of ['2026-00', '2026-13', '2026-1', '1899-12', '10000-01', 'NaN-10']) expect(() => select(fixture(), 'a', period)).toThrow(/חודש/);
    expect(() => setCapacity(fixture(), 'team-b', 5, 'member-a', OCT)).toThrow(/צוות/);
    expect(() => setCapacity(fixture(), 'missing', 5, 'missing', OCT)).toThrow();
  });
});

describe('Roadmap handoff and cleanup across months', () => {
  it('retains month and person assignment after scheduling; removing planning never unschedules', () => {
    const doc = assignPlanningTask(select(fixture(), 'no-team'), 'no-team', 'member-a', OCT), before = clone(doc);
    const scheduled = scheduleTask(doc, 'no-team', { startDate: '2026-10-29', workingDays: 4, teamId: null, workItemId: null });
    expect(scheduled.planning).toEqual(doc.planning); expect(task(scheduled, 'no-team').teamId).toBeNull();
    expect(memberCapacitySummary(scheduled, 'team-a', 'member-a', OCT).known).toBe(4);
    const resized = editTask(scheduled, 'no-team', { endDate: '2026-11-05' }); expect(taskEffort(task(resized, 'no-team'))).toBe(6);
    const removed = selectPlanningTask(resized, 'no-team', false, undefined, OCT);
    expect(task(removed, 'no-team')).toEqual(task(resized, 'no-team')); expect(planningMemberId(removed, 'no-team', OCT)).toBeNull();
    expect(planningTasks(removed, 'team-a', 'candidates', 'all', NOV).some(t => t.id === 'no-team')).toBe(false);
    expect(returnToBacklog(removed, 'no-team').tasks.find(t => t.id === 'no-team')!.planningState).toBe('backlog'); expect(doc).toEqual(before);
  });
  it('keeps existing weekend and dependency validation', () => {
    const doc = select(fixture(), 'a'); doc.dependencies = [{ id: 'dep', predecessorId: 'b', successorId: 'a', type: 'finish_to_start', lagWorkingDays: 0 }];
    expect(() => scheduleTask(doc, 'a', { startDate: '2026-10-30', workingDays: 5, teamId: 'team-a', workItemId: 'work-a' })).toThrow(/שישי/);
    expect(() => scheduleTask(doc, 'a', { startDate: '2026-10-29', workingDays: 5, teamId: 'team-a', workItemId: 'work-a' })).toThrow(/b/);
  });
  it('cleans moved/deleted people in every month and preserves selected tasks', () => {
    let doc = assignPlanningTask(select(fixture(), 'a'), 'a', 'member-a', OCT); doc = assignPlanningTask(select(doc, 'b', NOV), 'b', 'member-a', NOV);
    doc = setCapacity(setCapacity(doc, 'team-a', 10, 'member-a', OCT), 'team-a', 12, 'member-a', NOV);
    doc = updateMember(doc, 'member-a', 'דנה', 'team-b'); reconcilePlanning(doc);
    for (const plan of doc.planning.plans) { expect(plan.teamCapacities[0].memberAvailability).toEqual([]); }
    expect(monthlyPlan(doc, OCT).selectedTaskIds).toEqual(['a']); expect(monthlyPlan(doc, NOV).selectedTaskIds).toEqual(['b']); validateDocument(doc);
    doc.tasks = doc.tasks.filter(t => t.id !== 'a'); reconcilePlanning(doc); expect(monthlyPlan(doc, OCT).selectedTaskIds).toEqual([]);
  });
  it('exposes a deleted independent planning team as unresolved instead of transferring it silently', () => {
    const doc = selectPlanningTask(fixture(), 'no-team', true, 'team-c', OCT); doc.teams = doc.teams.filter(t => t.id !== 'team-c'); reconcilePlanning(doc);
    expect(planningTasks(doc, null, 'selected', 'team', OCT).map(t => t.id)).toEqual(['no-team']); validateDocument(doc);
  });
});

describe('migration, backup validation and atomic storage', () => {
  it.each([1, 2, 3])('migrates schema %s without changing tasks or adding monthly selections', version => {
    const doc = seedDocument(), { planning, ...rest } = doc;
    const old = { ...rest, schemaVersion: version, tasks: doc.tasks.map(({ planningState, ...task }) => version === 1 ? task : { ...task, planningState }) };
    const before = clone(old), migrated = validateDocument(old);
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION); expect(migrated.planning).toEqual({ plans: [] }); expect(migrated.tasks).toEqual(doc.tasks); expect(old).toEqual(before);
  });
  it('migrates a legacy plan into the current Jerusalem month with all selections, links and availability retained', () => {
    const doc = fixture(), legacy = { selectedTaskIds: ['no-team'], taskTeamLinks: [{ taskId: 'no-team', teamId: 'team-a' }],
      teamCapacities: [{ teamId: 'team-a', availableWorkingDays: 40, memberAvailability: [{ memberId: 'member-a', availableWorkingDays: 15 }] }] };
    const old = { ...doc, schemaVersion: 4, planning: legacy }, before = clone(old), next = validateDocument(old);
    expect(next.planning.plans).toEqual([{ ...legacy, period: currentPlanningPeriod() }]); expect(next.tasks).toEqual(doc.tasks); expect(old).toEqual(before);
    expect(capacitySummary(next, 'team-a', currentPlanningPeriod()).available).toBe(15);
    const backup = { schemaVersion: 4, exportedAt: new Date().toISOString(), document: old, preferences: initialPreferences() };
    expect(parseBackup(JSON.stringify(backup)).document).toEqual(next);
  });
  it('merges legacy planning assignments into the task, preferring an existing responsible person', () => {
    const doc = select(select(select(fixture(), 'a'), 'b'), 'no-team');
    const old = { ...doc, schemaVersion: 5, planning: { plans: [{ ...doc.planning.plans[0], taskMemberLinks: [
      { taskId: 'a', memberId: 'member-b' }, { taskId: 'b', memberId: 'member-b' }, { taskId: 'no-team', memberId: 'member-a' }
    ] }] } }, before = clone(old);
    const migrated = validateDocument(old);
    expect(task(migrated, 'a').assigneeId).toBe('member-a');
    expect(task(migrated, 'b').assigneeId).toBe('member-b');
    expect(task(migrated, 'no-team')).toMatchObject({ teamId: null, assigneeId: 'member-a' });
    expect(migrated.planning.plans[0]).not.toHaveProperty('taskMemberLinks'); expect(old).toEqual(before);
    old.planning.plans[0].taskMemberLinks[0].memberId = 'missing'; expect(() => validateDocument(old)).toThrow(/אחראי/);
  });
  it('round-trips months, people, balances and independently scoped expansion preferences', async () => {
    let doc = assignPlanningTask(select(fixture(), 'a'), 'a', 'member-b', OCT); doc = select(doc, 'b', NOV); doc = setCapacity(doc, 'team-a', 8.5, 'member-b', OCT);
    const prefs = { ...initialPreferences(), planning: { ...emptyPlanningPreferences(), activePeriod: OCT, candidateSource: 'all' as const, collapsedGroups: [
      { teamId: 'team-a', pane: 'selected' as const, workItemId: 'work-a', period: OCT }, { teamId: 'team-a', pane: 'selected' as const, workItemId: 'work-a', period: NOV }
    ] } };
    const backup = parseBackup(exportBackup(doc, prefs)); expect(backup.document).toEqual(doc); expect(backup.preferences).toEqual(prefs);
    const db = new RoadmapStorage('monthly-' + crypto.randomUUID()); await db.save(doc, prefs, null); expect((await db.load())!.document).toEqual({ ...doc, revision: 1 });
  });
  it('rejects invalid periods, duplicate months, duplicate membership, wrong people and invalid availability before replacing data', async () => {
    const doc = setCapacity(assignPlanningTask(select(fixture(), 'a'), 'a', 'member-a', OCT), 'team-a', 10, 'member-a', OCT);
    const mutations: ((d: RoadmapDocument) => void)[] = [
      d => d.planning.plans[0].period = '2026-13', d => d.planning.plans.push(clone(d.planning.plans[0])),
      d => d.planning.plans.push({ ...clone(d.planning.plans[0]), period: NOV }), d => d.planning.plans[0].selectedTaskIds.push('missing'),
      d => task(d, 'a').assigneeId = 'other-member', d => task(d, 'a').assigneeId = 'missing',
      d => Object.assign(d.planning.plans[0], { taskMemberLinks: [] }), d => d.planning.plans[0].teamCapacities[0].memberAvailability[0].availableWorkingDays = -1,
      d => d.planning.plans[0].taskTeamLinks![0].teamId = 'missing'
    ];
    const db = new RoadmapStorage('invalid-monthly-' + crypto.randomUUID()); await db.save(doc, initialPreferences(), null); const before = await db.load();
    for (const mutate of mutations) { const invalid = clone(doc); mutate(invalid); expect(() => parseBackup(exportBackup(invalid, initialPreferences()))).toThrow(); expect(await db.load()).toEqual(before); }
    expect(() => validatePreferences({ ...initialPreferences(), planning: { ...emptyPlanningPreferences(), activePeriod: '2026-00' } })).toThrow();
  });
  it('failed storage writes preserve all monthly plans and preferences atomically', async () => {
    const db = new RoadmapStorage('failure-monthly-' + crypto.randomUUID()), doc = fixture(); await db.save(doc, initialPreferences(), null); const before = await db.load();
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    try { await expect(db.save(assignPlanningTask(select(doc, 'a'), 'a', 'member-a', OCT), initialPreferences(), 1)).rejects.toThrow(); }
    finally { put.mockRestore(); } expect(await db.load()).toEqual(before);
  });
});
