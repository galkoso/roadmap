import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { IDBObjectStore } from 'fake-indexeddb';
import { clone, isScheduled, PlanningState, RoadmapDocument, SCHEMA_VERSION } from '../src/app/core/model';
import { initialPreferences, seedDocument } from '../src/app/core/seed';
import {
  capacitySummary, effortTotal, emptyPlanningPreferences, parseCapacityDays, planningGroups, planningTasks, reconcilePlanning,
  reconcilePlanningPreferences, selectPlanningTask, setCapacity, taskEffort
} from '../src/app/core/planning';
import { changeTaskTeam, updateMember } from '../src/app/core/members';
import { editTask, returnToBacklog, scheduleTask } from '../src/app/core/scheduler';
import { exportBackup, parseBackup, validateDocument, validatePreferences } from '../src/app/core/validation';
import { RoadmapStorage } from '../src/app/core/storage';

function fixture(): RoadmapDocument {
  const doc = seedDocument(); doc.dependencies = [];
  doc.members = [{ id: 'member-a', teamId: 'team-a', name: 'דנה', order: 0 }, { id: 'member-b', teamId: 'team-a', name: 'אורי', order: 1 }];
  doc.workItems = [{ id: 'work-a', title: 'שם זהה', order: 0 }, { id: 'work-b', title: 'שם זהה', order: 1 }];
  doc.tasks = [
    { id: 'a', workItemId: 'work-a', estimatedWorkingDays: 5, assigneeId: 'member-a', teamId: 'team-a' },
    { id: 'b', workItemId: 'work-a', estimatedWorkingDays: 3, assigneeId: null, teamId: 'team-a' },
    { id: 'unknown', workItemId: 'work-b', assigneeId: null, teamId: 'team-a' },
    { id: 'solo', workItemId: null, estimatedWorkingDays: 2, assigneeId: null, teamId: 'team-a' },
    { id: 'no-team', workItemId: null, assigneeId: null, teamId: null }
  ].map((task, order) => ({ ...task, order, planningState: 'backlog', title: task.id, color: '#3975d5', status: 'planned', notes: 'הערות לשימור' }));
  return doc;
}
const task = (doc: RoadmapDocument, id: string) => doc.tasks.find(task => task.id === id)!;

describe('linked planning membership and effort', () => {
  it('selects once without changing task records, assignees, dates or original backlog eligibility', () => {
    const doc = fixture(), before = clone(doc);
    const selected = selectPlanningTask(selectPlanningTask(doc, 'a', true), 'a', true);
    expect(selected.planning.selectedTaskIds).toEqual(['a']); expect(doc).toEqual(before);
    expect(selected.tasks).toEqual(doc.tasks); expect(selected.tasks.filter(t => !isScheduled(t))).toHaveLength(5);
    expect(planningTasks(selected, 'team-a', 'candidates').map(t => t.id)).toEqual(['b', 'unknown', 'solo']);
    expect(planningTasks(selected, 'team-a', 'selected').map(t => t.id)).toEqual(['a']);
    expect(capacitySummary(selected, 'team-a')).toMatchObject({ known: 5, missing: 0, remaining: null });
    expect(selectPlanningTask(selected, 'a', false)).toEqual(doc);
    expect(() => selectPlanningTask(doc, 'no-team', true)).toThrow(/צוות/);
  });
  it('calculates manual capacity and soldier breakdown independently, including zero, half-days and excess', () => {
    let doc = selectPlanningTask(fixture(), 'a', true);
    doc = setCapacity(doc, 'team-a', 4.5); doc = setCapacity(doc, 'team-a', 15, 'member-a'); doc = setCapacity(doc, 'team-a', 10, 'member-b');
    expect(capacitySummary(doc, 'team-a')).toMatchObject({ available: 4.5, known: 5, remaining: -0.5, distributed: 25, undistributed: -20.5 });
    doc = setCapacity(doc, 'team-a', 40);
    expect(capacitySummary(doc, 'team-a')).toMatchObject({ remaining: 35, distributed: 25, undistributed: 15 });
    expect(doc.tasks).toEqual(fixture().tasks);
    expect(setCapacity(doc, 'team-b', 0).planning.teamCapacities.find(c => c.teamId === 'team-b')!.availableWorkingDays).toBe(0);
    expect(() => setCapacity(doc, 'team-b', 2, 'member-a')).toThrow(/צוות/);
  });
  it.each(['', ' ', '-1', 'NaN', 'Infinity', '0.3', '1000001'])('rejects invalid or empty capacity %j', value => {
    expect(() => parseCapacityDays(value)).toThrow();
  });
  it('distinguishes explicit zero and missing effort, and updates estimates from the same record', () => {
    expect(parseCapacityDays('0')).toBe(0); expect(parseCapacityDays(' 3.5 ')).toBe(3.5);
    let doc = selectPlanningTask(selectPlanningTask(fixture(), 'a', true), 'unknown', true); doc = setCapacity(doc, 'team-a', 10);
    expect(effortTotal(planningTasks(doc, 'team-a', 'selected'))).toEqual({ known: 5, missing: 1 });
    expect(taskEffort(task(doc, 'unknown'))).toBeNull();
    task(doc, 'unknown').estimatedWorkingDays = 7;
    expect(capacitySummary(doc, 'team-a')).toMatchObject({ known: 12, missing: 0, remaining: -2 });
  });
  it('groups by work ID with separate pane subtotals and a virtual standalone group', () => {
    let doc = fixture(); for (const id of ['a', 'unknown', 'solo']) doc = selectPlanningTask(doc, id, true);
    const selected = planningGroups(doc, planningTasks(doc, 'team-a', 'selected'));
    expect(selected.map(g => g.workItemId)).toEqual(['work-a', 'work-b', null]);
    expect(selected.map(g => effortTotal(g.tasks))).toEqual([{ known: 5, missing: 0 }, { known: 0, missing: 1 }, { known: 2, missing: 0 }]);
    const candidates = planningGroups(doc, planningTasks(doc, 'team-a', 'candidates'));
    expect(candidates.map(g => g.workItemId)).toEqual(['work-a']); expect(candidates[0].tasks.map(t => t.id)).toEqual(['b']);
    doc = selectPlanningTask(doc, 'b', true); expect(planningGroups(doc, planningTasks(doc, 'team-a', 'candidates'))).toEqual([]);
    expect(doc.workItems).toEqual(fixture().workItems);
  });
  it('follows real team and title changes, flags no-team selections and cleans deleted references', () => {
    let doc = selectPlanningTask(setCapacity(fixture(), 'team-a', 40), 'a', true);
    changeTaskTeam(doc, task(doc, 'a'), 'team-b'); task(doc, 'a').title = 'שם חדש';
    expect(planningTasks(doc, 'team-b', 'selected')[0].title).toBe('שם חדש');
    expect(capacitySummary(doc, 'team-a').known).toBe(0);
    changeTaskTeam(doc, task(doc, 'a'), null); expect(planningTasks(doc, null, 'selected').map(t => t.id)).toEqual(['a']);
    doc.tasks = doc.tasks.filter(t => t.id !== 'a'); reconcilePlanning(doc); expect(doc.planning.selectedTaskIds).toEqual([]);
  });
  it('clears moved/deleted member breakdowns and deleted team data without transferring capacity', () => {
    let doc = setCapacity(setCapacity(selectPlanningTask(fixture(), 'a', true), 'team-a', 40), 'team-a', 10, 'member-a');
    doc = updateMember(doc, 'member-a', 'דנה', 'team-b'); reconcilePlanning(doc);
    expect(doc.planning.teamCapacities).toEqual([{ teamId: 'team-a', availableWorkingDays: 40, memberAvailability: [] }]);
    expect(doc.planning.selectedTaskIds).toEqual(['a']);
    const prefs = { ...emptyPlanningPreferences(), activeTeamId: 'team-a', expandedTeamIds: ['team-a'], collapsedGroups: [{ teamId: 'team-a', pane: 'selected' as const, workItemId: 'work-a' }] };
    doc.teams = doc.teams.filter(t => t.id !== 'team-a'); reconcilePlanning(doc);
    expect(doc.planning.teamCapacities).toEqual([]); expect(reconcilePlanningPreferences(prefs, doc)).toEqual(emptyPlanningPreferences());
  });
});

describe('shared Roadmap handoff', () => {
  it('preserves IDs, metadata, selection and dependencies; removal never unschedules', () => {
    const doc = selectPlanningTask(fixture(), 'a', true), before = clone(doc);
    const scheduled = scheduleTask(doc, 'a', { startDate: '2027-02-04', workingDays: 5, teamId: 'team-a', workItemId: 'work-a' });
    expect(task(scheduled, 'a')).toMatchObject({ ...task(doc, 'a'), planningState: 'scheduled', startDate: '2027-02-04', endDate: '2027-02-10' });
    expect(scheduled.tasks).toHaveLength(doc.tasks.length); expect(scheduled.planning).toEqual(doc.planning); expect(doc).toEqual(before);
    expect(capacitySummary(scheduled, 'team-a').known).toBe(5);
    const removed = selectPlanningTask(scheduled, 'a', false);
    expect(task(removed, 'a')).toEqual(task(scheduled, 'a')); expect(planningTasks(removed, 'team-a', 'candidates').some(t => t.id === 'a')).toBe(false);
    expect(planningTasks(returnToBacklog(removed, 'a'), 'team-a', 'candidates').some(t => t.id === 'a')).toBe(true);
    expect(() => scheduleTask(scheduled, 'a', { startDate: '2027-02-04', workingDays: 5, teamId: 'team-a', workItemId: 'work-a' })).toThrow();
  });
  it('uses existing weekend/dependency checks and current working duration after resizing', () => {
    const doc = selectPlanningTask(fixture(), 'a', true); doc.dependencies = [{ id: 'dep', predecessorId: 'b', successorId: 'a', type: 'finish_to_start', lagWorkingDays: 0 }];
    expect(() => scheduleTask(doc, 'a', { startDate: '2027-02-05', workingDays: 5, teamId: 'team-a', workItemId: 'work-a' })).toThrow(/שישי/);
    expect(() => scheduleTask(doc, 'a', { startDate: '2027-02-04', workingDays: 5, teamId: 'team-a', workItemId: 'work-a' })).toThrow(/b/);
    let next = scheduleTask(doc, 'b', { startDate: '2027-02-04', workingDays: 3, teamId: 'team-a', workItemId: 'work-a' });
    next = scheduleTask(next, 'a', { startDate: '2027-02-04', workingDays: 5, teamId: 'team-a', workItemId: 'work-a' });
    expect(task(next, 'a').startDate).toBe('2027-02-09');
    next = editTask(next, 'a', { endDate: '2027-02-16' }); expect(taskEffort(task(next, 'a'))).toBe(6);
    expect(next.planning.selectedTaskIds).toEqual(['a']);
  });
});

describe('schema migration, backups and atomic persistence', () => {
  it.each([1, 2, 3])('migrates v%s non-destructively with empty planning and unset capacities', version => {
    const doc = seedDocument(); const { planning, ...rest } = doc;
    const old = { ...rest, schemaVersion: version, ...(version < 3 ? { members: [] } : {}), tasks: doc.tasks.map(({ planningState, ...task }) => version === 1 ? task : { ...task, planningState }) };
    const before = clone(old), migrated = validateDocument(old);
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION); expect(migrated.planning).toEqual({ selectedTaskIds: [], teamCapacities: [] });
    expect(migrated.tasks).toEqual(doc.tasks); expect(migrated.dependencies).toEqual(doc.dependencies); expect(old).toEqual(before);
    expect(parseBackup(JSON.stringify({ schemaVersion: version, document: old, preferences: initialPreferences(), exportedAt: new Date().toISOString() })).document).toEqual(migrated);
  });
  it('round-trips selection, half-days, members, active team and independent expansion state', async () => {
    const doc = setCapacity(setCapacity(selectPlanningTask(fixture(), 'a', true), 'team-a', 40.5), 'team-a', 15, 'member-a');
    const prefs = { ...initialPreferences(), planning: { activeTeamId: 'team-a', expandedTeamIds: ['team-a'], collapsedGroups: [
      { teamId: 'team-a', pane: 'selected' as const, workItemId: 'work-a' }, { teamId: 'team-b', pane: 'candidates' as const, workItemId: null }
    ] } };
    const backup = parseBackup(exportBackup(doc, prefs)); expect(backup.document).toEqual(doc); expect(backup.preferences).toEqual(prefs);
    const db = new RoadmapStorage('planning-' + crypto.randomUUID()); await db.save(backup.document, backup.preferences, null);
    expect((await db.load())!.document).toEqual({ ...doc, revision: 1 }); expect((await db.load())!.preferences).toEqual(prefs);
  });
  it('rejects duplicate and dangling refs, bad numbers and cross-team member breakdowns before replacing data', async () => {
    const doc = setCapacity(selectPlanningTask(fixture(), 'a', true), 'team-a', 40, 'member-a');
    const mutations: ((p: PlanningState) => void)[] = [
      p => p.selectedTaskIds.push('a'), p => p.selectedTaskIds.push('missing'),
      p => p.teamCapacities.push(clone(p.teamCapacities[0])), p => p.teamCapacities[0].teamId = 'team-b',
      p => p.teamCapacities[0].availableWorkingDays = -1, p => p.teamCapacities[0].availableWorkingDays = NaN,
      p => p.teamCapacities[0].memberAvailability.push(clone(p.teamCapacities[0].memberAvailability[0])),
      p => p.teamCapacities[0].memberAvailability[0].memberId = 'missing', p => p.teamCapacities[0].memberAvailability[0].availableWorkingDays = 0.1
    ];
    const db = new RoadmapStorage('invalid-planning-' + crypto.randomUUID()); await db.save(doc, initialPreferences(), null); const before = await db.load();
    for (const mutate of mutations) {
      const invalid = clone(doc); mutate(invalid.planning);
      expect(() => parseBackup(exportBackup(invalid, initialPreferences()))).toThrow(); expect(await db.load()).toEqual(before);
    }
    expect(() => validatePreferences({ ...initialPreferences(), planning: { ...emptyPlanningPreferences(), collapsedGroups: [{ teamId: 'team-a', pane: 'other', workItemId: null }] } })).toThrow();
    expect(() => parseBackup(exportBackup(doc, { ...initialPreferences(), planning: { ...emptyPlanningPreferences(), activeTeamId: 'missing' } }))).toThrow();
  });
  it('failed writes retain the old selection, capacities and preferences atomically', async () => {
    const db = new RoadmapStorage('planning-failure-' + crypto.randomUUID()), doc = fixture(); await db.save(doc, initialPreferences(), null); const before = await db.load();
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    try { await expect(db.save(setCapacity(selectPlanningTask(doc, 'a', true), 'team-a', 40), { ...initialPreferences(), planning: emptyPlanningPreferences() }, 1)).rejects.toThrow(); }
    finally { put.mockRestore(); }
    expect(await db.load()).toEqual(before);
  });
});
