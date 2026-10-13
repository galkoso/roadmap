import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { IDBObjectStore } from 'fake-indexeddb';
import { clone, isScheduled, SCHEMA_VERSION } from '../src/app/core/model';
import { initialPreferences, seedDocument } from '../src/app/core/seed';
import { assignTask, changeTaskTeam, groupByPeople, memberLabel, removeMember, updateMember } from '../src/app/core/members';
import { editTask, returnToBacklog, scheduleTask } from '../src/app/core/scheduler';
import { exportBackup, parseBackup, validateDocument, validatePreferences } from '../src/app/core/validation';
import { RoadmapStorage } from '../src/app/core/storage';
function fixture() {
  const doc = seedDocument();
  doc.members = [{ id: 'person-a', name: 'דנה', teamId: 'team-b', order: 0 }, { id: 'person-b', name: 'דנה', teamId: 'team-b', order: 1 },
    { id: 'person-c', name: 'אורי', teamId: 'team-a', order: 2 }];
  doc.tasks.push({ id: 'idea', teamId: 'team-b', workItemId: 'services', assigneeId: null, title: 'רעיון', planningState: 'backlog',
    color: '#abcdef', notes: 'מידע לשימור', status: 'completed', order: 20, estimatedWorkingDays: 3 });
  return doc;
}
const task = (doc: ReturnType<typeof fixture>, id: string) => doc.tasks.find(t => t.id === id)!;
describe('team member assignment domain', () => {
  it('assigns, reassigns and clears a task without changing any other data or input', () => {
    const original = fixture(), before = clone(original), id = 'implementation';
    let doc = assignTask(original, id, 'person-a');
    expect(task(doc, id)).toEqual({ ...task(original, id), assigneeId: 'person-a' });
    expect(doc.dependencies).toEqual(before.dependencies); expect(doc.workItems).toEqual(before.workItems);
    doc = assignTask(doc, id, 'person-b'); expect(task(doc, id)).toEqual({ ...task(original, id), assigneeId: 'person-b' });
    doc = assignTask(doc, id, null); expect(doc).toEqual(original); expect(original).toEqual(before);
  });
  it('rejects cross-team, unknown and no-team assignments independently of controls', () => {
    const doc = fixture(); expect(() => assignTask(doc, 'implementation', 'person-c')).toThrow(/צוות/);
    expect(() => assignTask(doc, 'implementation', 'missing')).toThrow();
    task(doc, 'idea').teamId = null; expect(() => assignTask(doc, 'idea', 'person-a')).toThrow();
    expect(() => assignTask(doc, 'missing', null)).toThrow();
  });
  it('clears an incompatible assignee on team changes and preserves metadata', () => {
    const doc = assignTask(fixture(), 'implementation', 'person-a'), before = clone(task(doc, 'implementation'));
    expect(changeTaskTeam(doc, task(doc, 'implementation'), 'team-a')).toBe(true);
    expect(task(doc, 'implementation')).toEqual({ ...before, teamId: 'team-a', assigneeId: null });
    const next = editTask(assignTask(fixture(), 'implementation', 'person-a'), 'implementation', { teamId: null });
    expect(task(next, 'implementation')).toEqual({ ...before, teamId: null, assigneeId: null });
    expect(() => changeTaskTeam(doc, task(doc, 'idea'), 'missing')).toThrow();
  });
  it('renames without changing identity or assignments, trims names and distinguishes duplicates', () => {
    const doc = assignTask(fixture(), 'idea', 'person-a');
    expect(memberLabel(doc, doc.members[0])).toContain('person-a'); expect(memberLabel(doc, doc.members[1])).toContain('person-b');
    const next = updateMember(doc, 'person-a', '  מיכל  ', 'team-b');
    expect(next.members[0]).toEqual({ ...doc.members[0], name: 'מיכל' }); expect(next.tasks).toEqual(doc.tasks);
    expect(() => updateMember(doc, 'person-a', '  ', 'team-b')).toThrow();
  });
  it.each(['move', 'delete'])('%s clears Roadmap and Backlog assignments while keeping all task data and teams', action => {
    const doc = assignTask(assignTask(fixture(), 'implementation', 'person-a'), 'idea', 'person-a'), before = clone(doc);
    const next = action === 'move' ? updateMember(doc, 'person-a', 'דנה', 'team-c') : removeMember(doc, 'person-a');
    expect(next.tasks).toEqual(doc.tasks.map(t => t.assigneeId === 'person-a' ? { ...t, assigneeId: null } : t));
    expect(next.teams).toEqual(doc.teams); expect(next.dependencies).toEqual(doc.dependencies); expect(doc).toEqual(before);
    expect(validateDocument(next)).toEqual(next);
  });
  it('preserves valid assignments through scheduling and returning to backlog', () => {
    const doc = assignTask(fixture(), 'idea', 'person-a');
    const scheduled = scheduleTask(doc, 'idea', { startDate: '2026-10-15', workingDays: 3, teamId: 'team-b', workItemId: 'services' });
    expect(task(scheduled, 'idea').assigneeId).toBe('person-a');
    const returned = returnToBacklog(scheduled, 'idea'); expect(task(returned, 'idea')).toEqual(task(doc, 'idea'));
    const other = scheduleTask(doc, 'idea', { startDate: '2026-10-15', workingDays: 3, teamId: 'team-a', workItemId: 'services' });
    expect(task(other, 'idea').assigneeId).toBeNull();
  });
});
describe('people projection and persistence', () => {
  it('projects each page independently, exactly once, with empty members, unassigned and no-team groups', () => {
    const doc = assignTask(assignTask(fixture(), 'implementation', 'person-a'), 'idea', 'person-a');
    const noTeam = { ...task(doc, 'idea'), id: 'no-team', teamId: null, assigneeId: null }; doc.tasks.push(noTeam);
    const before = clone(doc), roadmap = groupByPeople(doc, doc.tasks.filter(isScheduled)), backlog = groupByPeople(doc, doc.tasks.filter(t => !isScheduled(t)));
    const all = (groups: typeof backlog) => groups.flatMap(g => g.teamId === null ? g.tasks : g.groups.flatMap(p => p.tasks));
    expect(all(roadmap).map(t => t.id).sort()).toEqual(doc.tasks.filter(isScheduled).map(t => t.id).sort());
    expect(all(backlog).map(t => t.id).sort()).toEqual(['idea', 'no-team']);
    const b = roadmap.find(g => g.teamId === 'team-b')!;
    expect(b.groups.find(g => g.member?.id === 'person-a')!.tasks.map(t => t.id)).toEqual(['implementation']);
    expect(b.groups.find(g => g.member?.id === 'person-b')!.tasks).toEqual([]);
    expect(b.groups.find(g => !g.member)!.tasks.map(t => t.id)).toEqual(['monitor']);
    expect(roadmap.find(g => g.teamId === 'team-c')!.groups).toHaveLength(1);
    expect(doc).toEqual(before);
  });
  it.each([1, 2])('migrates schema %s without changing task data, dates or relationships', version => {
    const doc = seedDocument(); const { members, ...old } = doc;
    const legacy = { ...old, schemaVersion: version, tasks: doc.tasks.map(({ assigneeId, planningState, ...rest }) => version === 1 ? rest : { ...rest, planningState }) };
    const before = clone(legacy), migrated = validateDocument(legacy);
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION); expect(migrated.members).toEqual([]);
    expect(migrated.tasks).toEqual(doc.tasks); expect(migrated.dependencies).toEqual(doc.dependencies); expect(legacy).toEqual(before);
    expect(parseBackup(JSON.stringify({ schemaVersion: version, exportedAt: new Date().toISOString(), document: legacy, preferences: initialPreferences() })).document).toEqual(migrated);
  });
  it('round-trips members, references and independent grouping preferences through JSON and IndexedDB', async () => {
    const doc = assignTask(fixture(), 'idea', 'person-a'), prefs = { ...initialPreferences(), grouping: 'people' as const, peopleCollapsed: ['person:team-b:person-b'],
      backlog: { mode: 'list' as const, collapsed: ['team:team-a'], peopleCollapsed: ['person:team-b:unassigned'], scrollTop: 20 } };
    const backup = parseBackup(exportBackup(doc, prefs)); expect(backup.document).toEqual(doc); expect(backup.preferences).toEqual(prefs);
    const db = new RoadmapStorage('members-' + crypto.randomUUID()); await db.save(doc, prefs, null);
    const loaded = await db.load(); expect(loaded!.document).toEqual({ ...doc, revision: 1 }); expect(loaded!.preferences).toEqual(prefs);
  });
  it.each(['dangling', 'cross-team', 'no-team', 'member-team', 'duplicate-id'])('rejects invalid %s references without replacing persisted state', async kind => {
    const db = new RoadmapStorage('invalid-' + crypto.randomUUID()), doc = fixture(); await db.save(doc, initialPreferences(), null);
    const before = await db.load(), invalid = clone(doc);
    if (kind === 'dangling') task(invalid, 'idea').assigneeId = 'missing';
    if (kind === 'cross-team') task(invalid, 'idea').assigneeId = 'person-c';
    if (kind === 'no-team') Object.assign(task(invalid, 'idea'), { teamId: null, assigneeId: 'person-a' });
    if (kind === 'member-team') invalid.members[0].teamId = 'missing';
    if (kind === 'duplicate-id') invalid.members[0].id = invalid.teams[0].id;
    expect(() => parseBackup(exportBackup(invalid, initialPreferences()))).toThrow(); expect(await db.load()).toEqual(before);
  });
  it('failed bulk cleanup write preserves members and assignments together', async () => {
    const db = new RoadmapStorage('failure-' + crypto.randomUUID()), doc = assignTask(assignTask(fixture(), 'idea', 'person-a'), 'implementation', 'person-a');
    await db.save(doc, initialPreferences(), null); const before = await db.load();
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    try { await expect(db.save(removeMember(doc, 'person-a'), initialPreferences(), 1)).rejects.toThrow(); }
    finally { put.mockRestore(); }
    expect(await db.load()).toEqual(before);
  });
  it('rejects a non-numeric schema version even if it looks like a supported version', () => {
    const doc = { ...fixture(), schemaVersion: String(SCHEMA_VERSION) };
    expect(() => validateDocument(doc)).toThrow(/גרסת/);
    expect(() => parseBackup(JSON.stringify({ schemaVersion: String(SCHEMA_VERSION), document: doc, exportedAt: new Date().toISOString(), preferences: initialPreferences() }))).toThrow(/גרסת/);
  });
  it('validates grouping preferences and expansion arrays', () => {
    expect(() => validatePreferences({ ...initialPreferences(), grouping: 'wrong' })).toThrow();
    expect(() => validatePreferences({ ...initialPreferences(), backlog: { mode: 'people', collapsed: [], peopleCollapsed: [4], scrollTop: 0 } })).toThrow();
  });
});
