import { describe, expect, it } from 'vitest';
import { seedDocument, initialPreferences } from '../src/app/core/seed';
import { validateDocument, exportBackup, parseBackup } from '../src/app/core/validation';
import { changeTaskTeam } from '../src/app/core/members';
import { returnToBacklog, scheduleTask } from '../src/app/core/scheduler';
function fixture() {
  const doc = seedDocument();
  doc.workItems.push({ id: 'heading', title: 'כותרת צוות', teamId: 'team-b', order: 2 });
  doc.tasks.push({ id: 'idea', title: 'משימה', teamId: 'team-b', workItemId: 'heading', planningState: 'backlog',
    color: '#3975d5', status: 'planned', notes: '', order: 5, estimatedWorkingDays: 3 });
  return doc;
}
describe('team headings', () => {
  it('round-trips empty headings and team ownership without dates or duration', () => {
    const doc = fixture(); doc.tasks.pop();
    expect(parseBackup(exportBackup(doc, initialPreferences())).document).toEqual(doc);
    for (const key of ['startDate', 'endDate', 'estimatedWorkingDays']) {
      const invalid = structuredClone(doc); Object.assign(invalid.workItems.at(-1)!, { [key]: key === 'estimatedWorkingDays' ? 3 : '2026-10-15' });
      expect(() => validateDocument(invalid)).toThrow(/כותרת/);
    }
  });
  it('rejects foreign and missing team references and detaches a heading on team change', () => {
    const doc = fixture(); doc.tasks.at(-1)!.teamId = 'team-a';
    expect(() => validateDocument(doc)).toThrow(/צוות המשימה/);
    doc.workItems.at(-1)!.teamId = 'missing'; expect(() => validateDocument(doc)).toThrow(/צוות הכותרת/);
    const valid = fixture(); changeTaskTeam(valid, valid.tasks.at(-1)!, 'team-a');
    expect(valid.tasks.at(-1)!.workItemId).toBeNull(); expect(() => validateDocument(valid)).not.toThrow();
  });
  it('keeps heading ownership across scheduling and returning to backlog', () => {
    const doc = fixture(), scheduled = scheduleTask(doc, 'idea', { startDate: '2026-10-15', workingDays: 3, teamId: 'team-b', workItemId: 'heading' });
    expect(validateDocument(scheduled).tasks.at(-1)!.workItemId).toBe('heading');
    expect(validateDocument(returnToBacklog(scheduled, 'idea')).workItems).toEqual(doc.workItems);
    expect(doc.tasks.at(-1)!.planningState).toBe('backlog');
  });
});
