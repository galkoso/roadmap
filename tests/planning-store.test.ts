import '@angular/compiler';
import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { RoadmapStore } from '../src/app/core/store';
import { RoadmapStorage } from '../src/app/core/storage';
import { clone } from '../src/app/core/model';
import { initialPreferences, seedDocument } from '../src/app/core/seed';
import { emptyPlanningPreferences, selectPlanningTask, setCapacity } from '../src/app/core/planning';
import { updateMember } from '../src/app/core/members';
function fixture() {
  const document = seedDocument();
  document.members = [{ id: 'person', teamId: 'team-a', name: 'דנה', order: 0 }];
  document.tasks.push({ id: 'idea', teamId: 'team-a', workItemId: null, assigneeId: 'person', estimatedWorkingDays: 5,
    planningState: 'backlog', title: 'רעיון', notes: '', status: 'planned', color: '#3975d5', order: 10 });
  return { document, preferences: { ...initialPreferences(), planning: emptyPlanningPreferences() } };
}
afterEach(() => vi.restoreAllMocks());
it('selection and capacities participate in Undo/Redo while preserving task records and failed saves never claim success', async () => {
  const saved = fixture(); let revision = 0;
  vi.spyOn(RoadmapStorage.prototype, 'load').mockResolvedValue(clone(saved));
  const write = vi.spyOn(RoadmapStorage.prototype, 'save').mockImplementation(async () => ++revision);
  const store = new RoadmapStore(); await vi.waitFor(() => expect(store.loaded()).toBe(true));
  const tasks = clone(store.document().tasks);
  store.commit(selectPlanningTask(store.document(), 'idea', true));
  store.commit(setCapacity(store.document(), 'team-a', 7.5));
  await vi.waitFor(() => expect(store.saveStatus()).toBe('נשמר'));
  store.undo(); expect(store.document().planning.teamCapacities).toEqual([]); expect(store.document().planning.selectedTaskIds).toEqual(['idea']);
  store.undo(); expect(store.document().planning.selectedTaskIds).toEqual([]); expect(store.document().tasks).toEqual(tasks);
  store.redo(); store.redo(); expect(store.document().planning.teamCapacities[0].availableWorkingDays).toBe(7.5);
  await vi.waitFor(() => expect(store.saveStatus()).toBe('נשמר'));
  write.mockRejectedValue(new Error('quota full'));
  store.commit(selectPlanningTask(store.document(), 'idea', false));
  await vi.waitFor(() => expect(store.error()).toContain('quota full'));
  expect(store.saveStatus()).not.toBe('נשמר'); expect(store.document().planning.selectedTaskIds).toEqual([]); expect(store.document().tasks).toEqual(tasks);
});
it('every editing flow cleans invalid live planning references and Undo restores membership and member breakdown together', async () => {
  const saved = fixture(); saved.document = setCapacity(setCapacity(selectPlanningTask(saved.document, 'idea', true), 'team-a', 40), 'team-a', 10, 'person');
  vi.spyOn(RoadmapStorage.prototype, 'load').mockResolvedValue(clone(saved)); vi.spyOn(RoadmapStorage.prototype, 'save').mockResolvedValue(1);
  const store = new RoadmapStore(); await vi.waitFor(() => expect(store.loaded()).toBe(true));
  store.commit(updateMember(store.document(), 'person', 'דנה', 'team-b'));
  expect(store.document().planning.teamCapacities[0]).toMatchObject({ availableWorkingDays: 40, memberAvailability: [] });
  store.undo(); expect(store.document().planning.teamCapacities[0].memberAvailability).toEqual([{ memberId: 'person', availableWorkingDays: 10 }]);
  const doc = clone(store.document()); doc.tasks = doc.tasks.filter(task => task.id !== 'idea'); store.commit(doc);
  expect(store.document().planning.selectedTaskIds).toEqual([]);
  store.undo(); expect(store.document().planning.selectedTaskIds).toEqual(['idea']);
});
