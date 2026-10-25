import { legacyFields } from './legacy-fields';
import { describe, expect, it } from 'vitest';
import { addDays, addWorkingDays, daysBetween, duration, epoch, isWorkingDay, nextWorkingDay, workingDifference } from '../src/app/core/dates';
import { clone, Dependency } from '../src/app/core/model';
import { seedDocument } from '../src/app/core/seed';
import { editTask, setIncoming, shiftTask, shiftWork, topological, workRange } from '../src/app/core/scheduler';
const task = (doc: ReturnType<typeof seedDocument>, id: string) => doc.tasks.find(t => t.id === id)!;
describe('date-only Sunday–Thursday calendar', () => {
  it('Thursday follows to Sunday, with backwards moves', () => {
    expect(addWorkingDays('2026-10-15', 1)).toBe('2026-10-18');
    expect(addWorkingDays('2026-10-18', -1)).toBe('2026-10-15');
    expect(nextWorkingDay('2026-10-16')).toBe('2026-10-18');
    expect(nextWorkingDay('2026-10-17')).toBe('2026-10-18');
  });
  it('crosses months, years, leap years and DST without local timestamps', () => {
    expect(addWorkingDays('2026-12-31', 1)).toBe('2027-01-03');
    expect(addWorkingDays('2027-01-03', -1)).toBe('2026-12-31');
    expect(addWorkingDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addWorkingDays('2024-02-29', 1)).toBe('2024-03-03');
    expect(daysBetween('2026-03-26', '2026-03-29')).toBe(3);
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(() => epoch('2026-02-29')).toThrow();
  });
  it('counts inclusive duration and signed working shifts', () => {
    expect(duration('2026-10-15', '2026-10-15')).toBe(1);
    expect(duration('2026-10-15', '2026-10-18')).toBe(2);
    expect(workingDifference('2026-10-15', '2026-10-22')).toBe(5);
    expect(workingDifference('2026-10-22', '2026-10-15')).toBe(-5);
  });
  it('round-trips 600 positive and negative working-day offsets', () => {
    for (let i = -300; i <= 300; i++) { const date = addWorkingDays('2026-10-12', i); expect(isWorkingDay(date)).toBe(true); expect(workingDifference('2026-10-12', date)).toBe(i); }
  });
});
describe('atomic scheduling and dependency graph', () => {
  it('shifts a shared work by five days preserving every duration, gap, metadata and independent work', () => {
    const doc = seedDocument(), range = workRange(doc, 'services')!;
    const shifted = shiftWork(doc, 'services', addWorkingDays(range.startDate, 5));
    for (const t of doc.tasks) {
      const moved = task(shifted, t.id);
      if (t.workItemId === 'services') {
        expect(workingDifference(t.startDate, moved.startDate)).toBe(5); expect(duration(moved.startDate, moved.endDate)).toBe(duration(t.startDate, t.endDate));
        expect(legacyFields({ ...moved, startDate: t.startDate, endDate: t.endDate })).toEqual(legacyFields(t));
      } else expect(moved).toEqual(t);
    }
    expect(shifted.dependencies).toEqual(doc.dependencies); expect(workRange(shifted, 'services')!.startDate).toBe(addWorkingDays(range.startDate, 5));
  });
  it('resizing planning propagates only through descendants and preserves durations', () => {
    const doc = seedDocument(), p = task(doc, 'architecture');
    const moved = editTask(doc, p.id, { endDate: addWorkingDays(p.endDate, 2) });
    expect(task(moved, 'implementation').startDate).toBe(addWorkingDays(p.endDate, 3));
    expect(task(moved, 'testing').startDate).toBe(addWorkingDays(task(moved, 'implementation').endDate, 1));
    expect(task(moved, 'monitor')).toEqual(task(doc, 'monitor'));
    const back = editTask(moved, p.id, { endDate: p.endDate }); expect(back.tasks.map(legacyFields)).toEqual(doc.tasks.map(legacyFields));
  });
  it('metadata and team changes do not modify dates or dependency lags', () => {
    const doc = seedDocument();
    const changed = editTask(doc, 'implementation', { teamId: 'team-c', color: '#123456', notes: '<script>text</script>', status: 'completed' });
    expect(changed.dependencies).toEqual(doc.dependencies);
    for (const t of changed.tasks) { expect(t.startDate).toBe(task(doc, t.id).startDate); expect(t.endDate).toBe(task(doc, t.id).endDate); }
    expect(task(changed, 'implementation').workItemId).toBe('services');
  });
  it('keeps one-day tasks legal and snaps weekends', () => {
    const doc = seedDocument(), p = task(doc, 'architecture');
    const single = editTask(doc, p.id, { endDate: p.startDate });
    expect(duration(task(single, p.id).startDate, task(single, p.id).endDate)).toBe(1);
    const moved = shiftTask(single, p.id, '2026-10-16'); expect(task(moved, p.id).startDate).toBe('2026-10-18');
  });
  it('honors the latest predecessor including another branch during propagation', () => {
    let doc = seedDocument();
    doc.tasks.push({ ...task(doc, 'architecture'), id: 'branch', startDate: addWorkingDays(task(doc, 'implementation').endDate, 1), endDate: addWorkingDays(task(doc, 'implementation').endDate, 3) });
    const dependency: Dependency = { id: 'branch-link', predecessorId: 'branch', successorId: 'testing', type: 'finish_to_start', lagWorkingDays: 0 };
    doc = setIncoming(doc, 'testing', [...doc.dependencies.filter(d => d.successorId === 'testing'), dependency]);
    expect(task(doc, 'testing').startDate).toBe(addWorkingDays(task(doc, 'branch').endDate, 1));
    const changed = editTask(doc, 'architecture', { endDate: addWorkingDays(task(doc, 'architecture').endDate, -1) });
    expect(task(changed, 'testing').startDate >= addWorkingDays(task(changed, 'branch').endDate, 1)).toBe(true);
  });
  it('rejects cycles, self references and duplicate links without mutating input', () => {
    const doc = seedDocument(), before = clone(doc);
    const link: Dependency = { id: 'cycle', predecessorId: 'testing', successorId: 'architecture', type: 'finish_to_start', lagWorkingDays: 0 };
    expect(() => setIncoming(doc, 'architecture', [link])).toThrow(/מעגל/); expect(doc).toEqual(before);
    expect(() => setIncoming(doc, 'architecture', [{ ...link, predecessorId: 'architecture' }])).toThrow(/בעצמה/);
    expect(() => topological({ ...doc, dependencies: [...doc.dependencies, { ...doc.dependencies[0], id: 'duplicate' }] })).toThrow(/כפול/);
  });
  it('manual delays update lags; invalid early moves clamp; completed tasks remain movable', () => {
    const doc = seedDocument(), impl = task(doc, 'implementation');
    const delayed = shiftTask(doc, impl.id, addWorkingDays(impl.startDate, 3));
    expect(delayed.dependencies[0].lagWorkingDays).toBe(3);
    expect(task(delayed, 'testing').startDate).toBe(addWorkingDays(task(delayed, impl.id).endDate, 1));
    const early = shiftTask(doc, impl.id, task(doc, 'architecture').startDate);
    expect(task(early, impl.id).startDate).toBe(impl.startDate);
    const moved = shiftTask(doc, 'architecture', addWorkingDays(task(doc, 'architecture').startDate, 1)); expect(task(moved, 'architecture').status).toBe('completed');
  });
  it('new links preserve late starts and deleting a link does not compress dates', () => {
    let doc = seedDocument(); doc.dependencies = [];
    const impl = task(doc, 'implementation'); impl.startDate = addWorkingDays(impl.startDate, 4); impl.endDate = addWorkingDays(impl.endDate, 4);
    const linked = setIncoming(doc, impl.id, [{ id: 'new', predecessorId: 'architecture', successorId: impl.id, type: 'finish_to_start', lagWorkingDays: 0 }]);
    expect(task(linked, impl.id)).toEqual(impl); expect(linked.dependencies[0].lagWorkingDays).toBe(4);
    expect(setIncoming(linked, impl.id, []).tasks).toEqual(linked.tasks);
  });
  it('lag 2 leaves exactly two free working days, and editing lag propagates', () => {
    const doc = seedDocument(); const dependencies = doc.dependencies.filter(d => d.successorId === 'implementation').map(d => ({ ...d, lagWorkingDays: 2 }));
    const changed = setIncoming(doc, 'implementation', dependencies);
    expect(task(changed, 'implementation').startDate).toBe(addWorkingDays(task(doc, 'architecture').endDate, 3));
    expect(task(changed, 'testing').startDate).toBe(addWorkingDays(task(changed, 'implementation').endDate, 1));
  });
  it('computes a 300-task chain without touching a separate work', () => {
    const doc = seedDocument(); doc.tasks = [task(doc, 'architecture'), task(doc, 'monitor')]; doc.dependencies = [];
    for (let i = 1; i < 300; i++) { const start = addWorkingDays(doc.tasks[0].endDate, i); doc.tasks.push({ ...doc.tasks[0], status: 'planned', id: 'chain-' + i, startDate: start, endDate: start }); doc.dependencies.push({ id: 'chain-link-' + i, predecessorId: i === 1 ? 'architecture' : 'chain-' + (i - 1), successorId: 'chain-' + i, type: 'finish_to_start', lagWorkingDays: 0 }); }
    const start = performance.now(); const changed = shiftTask(doc, 'architecture', addWorkingDays(doc.tasks[0].startDate, 5));
    expect(workingDifference(task(doc, 'chain-299').startDate, task(changed, 'chain-299').startDate)).toBe(5);
    expect(task(changed, 'monitor')).toEqual(task(doc, 'monitor')); expect(performance.now() - start).toBeLessThan(1000);
  });
});
it('calendar fast paths match a day-by-day oracle for every weekday, including weekend origins', () => {
  for (let day = 0; day < 7; day++) for (let delta = -40; delta <= 40; delta++) {
    const start = addDays('2026-10-11', day); let expected = start, left = Math.abs(delta);
    while (left) { expected = addDays(expected, Math.sign(delta)); if (isWorkingDay(expected)) left--; }
    expect(addWorkingDays(start, delta)).toBe(expected);
  }
  expect(() => addWorkingDays('2026-10-11', Number.MAX_SAFE_INTEGER + 1)).toThrow();
});
it('year navigation preserves the calendar day and clamps leap day without altering schedules', async () => {
  const { addYears } = await import('../src/app/core/dates');
  expect(addYears('2026-10-13', 1)).toBe('2027-10-13');
  expect(addYears('2026-10-13', -1)).toBe('2025-10-13');
  expect(addYears('2024-02-29', 1)).toBe('2025-02-28');
  expect(addYears('2024-02-29', -1)).toBe('2023-02-28');
  expect(addYears('2024-02-29', 4)).toBe('2028-02-29');
});
