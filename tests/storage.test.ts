import 'fake-indexeddb/auto';
import { IDBObjectStore } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { RoadmapStorage, RevisionConflict } from '../src/app/core/storage';
import { initialPreferences, seedDocument } from '../src/app/core/seed';
import { exportBackup, parseBackup, validateDocument } from '../src/app/core/validation';
import { clone } from '../src/app/core/model';
import { addWorkingDays } from '../src/app/core/dates';
const storage = () => new RoadmapStorage('test-' + crypto.randomUUID());
describe('IndexedDB atomic storage and backup integration', () => {
  it('persists and reloads document and preferences together with monotonically increasing revision', async () => {
    const db = storage(), doc = seedDocument(), prefs = { ...initialPreferences(), collapsed: ['team:team-c'], scrollLeft: 420 };
    expect(await db.load()).toBeUndefined(); const revision = await db.save(doc, prefs, null); expect(revision).toBe(1);
    const loaded = await db.load(); expect(loaded?.document).toEqual({ ...doc, revision }); expect(loaded?.preferences).toEqual(prefs);
    expect(await db.save(doc, prefs, revision)).toBe(2);
  });
  it('prevents two stale tabs from overwriting a newer revision', async () => {
    const name = 'tabs-' + crypto.randomUUID(), a = new RoadmapStorage(name), b = new RoadmapStorage(name);
    const doc = seedDocument(), prefs = initialPreferences(); await a.save(doc, prefs, null);
    const old = await b.load(); doc.workItems[0].title = 'newer'; await a.save(doc, prefs, 1);
    await expect(b.save(old!.document, prefs, 1)).rejects.toBeInstanceOf(RevisionConflict);
    expect((await a.load())?.document.workItems[0].title).toBe('newer');
  });
  it('failed write preserves both the old document and preferences', async () => {
    const db = storage(), doc = seedDocument(), prefs = initialPreferences(); await db.save(doc, prefs, null);
    const before = await db.load(); const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('quota full', 'QuotaExceededError'); });
    doc.workItems[0].title = 'unsaved'; await expect(db.save(doc, { ...prefs, dayWidth: 70 }, 1)).rejects.toThrow(); put.mockRestore(); expect(await db.load()).toEqual(before);
  });
  it('exports and atomically imports all data including technical preferences and text-only notes', async () => {
    const doc = seedDocument(), prefs = initialPreferences(); doc.tasks[1].notes = '<script>alert(1)</script>'; doc.tasks[1].color = '#abcdef';
    const backup = parseBackup(exportBackup(doc, prefs)); expect(backup.document).toEqual(doc); expect(backup.preferences).toEqual(prefs);
    const db = storage(); await db.save(backup.document, backup.preferences, null); expect((await db.load())?.document.tasks).toEqual(doc.tasks);
  });
  it('rejects malformed files, unsupported versions, duplicate IDs, bad dates, references, colors and cycles', () => {
    const good = seedDocument();
    const mutations = [
      (d: typeof good) => { d.schemaVersion = 99; }, (d: typeof good) => { d.tasks[0].id = d.teams[0].id; },
      (d: typeof good) => { d.tasks[0].teamId = 'missing'; }, (d: typeof good) => { d.tasks[0].color = 'red'; },
      (d: typeof good) => { d.tasks[0].startDate = '2026-02-30'; }, (d: typeof good) => { d.tasks[0].startDate = '2026-10-16'; },
      (d: typeof good) => { d.dependencies.push({ id: 'cycle', predecessorId: 'testing', successorId: 'architecture', type: 'finish_to_start', lagWorkingDays: 0 }); },
      (d: typeof good) => { d.dependencies[0].lagWorkingDays = -1; }, (d: typeof good) => { d.dependencies[0].lagWorkingDays = 100; }
    ];
    for (const mutate of mutations) { const bad = clone(good); mutate(bad); expect(() => validateDocument(bad)).toThrow(); }
    expect(() => parseBackup('{bad')).toThrow(); expect(() => parseBackup('{"schemaVersion":9}')).toThrow(/גרסת/);
  });
  it('invalid imports never replace the saved planning', async () => {
    const db = storage(); await db.save(seedDocument(), initialPreferences(), null); const before = await db.load();
    try { const invalid = parseBackup('{"schemaVersion":9}'); await db.save(invalid.document, invalid.preferences, 1); } catch { /* no mutation */ }
    expect(await db.load()).toEqual(before);
  });
});
