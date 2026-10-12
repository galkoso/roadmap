import { Backup, RoadmapDocument, ViewPreferences } from './model';
import { epoch, validateRange } from './dates';
import { topological } from './scheduler';
function assert(test: unknown, message = 'מבנה קובץ הגיבוי אינו תקין'): asserts test { if (!test) throw new Error(message); }
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const order = (value: unknown): boolean => Number.isInteger(value) && Number(value) >= 0;
export function validateDocument(value: unknown): RoadmapDocument {
  assert(record(value));
  assert(value['schemaVersion'] === 1, 'גרסת הגיבוי אינה נתמכת. נתמכת גרסה 1 בלבד');
  assert(order(value['revision']));
  const ids = new Set<string>();
  for (const key of ['teams', 'workItems', 'tasks', 'dependencies']) {
    const items = value[key]; assert(Array.isArray(items));
    assert(items.length <= 10000, 'קובץ הגיבוי גדול מדי');
    for (const item of items) {
      assert(record(item) && text(item['id']) && item['id'].length > 0 && !ids.has(item['id']), 'מזהים חייבים להיות ייחודיים');
      ids.add(item['id']);
    }
  }
  const doc = value as unknown as RoadmapDocument;
  assert(doc.teams.length > 0, 'חייב להיות צוות אחד לפחות');
  for (const t of doc.teams) assert(text(t.name) && t.name.trim() && order(t.order));
  for (const w of doc.workItems) assert(text(w.title) && w.title.trim() && order(w.order));
  for (const t of doc.tasks) {
    assert(text(t.title) && t.title.trim() && text(t.notes) && order(t.order));
    assert(text(t.color) && /^#[0-9a-f]{6}$/i.test(t.color), 'צבע אינו תקין');
    assert(['planned', 'in_progress', 'completed'].includes(t.status), 'סטטוס אינו תקין');
    assert(doc.teams.some(team => team.id === t.teamId) && doc.workItems.some(w => w.id === t.workItemId), 'שיוך משימה אינו תקין');
    assert(text(t.startDate) && text(t.endDate)); validateRange(t.startDate, t.endDate);
  }
  topological(doc);
  for (const d of doc.dependencies) {
    const p = doc.tasks.find(t => t.id === d.predecessorId)!, s = doc.tasks.find(t => t.id === d.successorId)!;
    // Imported schedules must satisfy all finish-to-start constraints.
    const pEnd = epoch(p.endDate), sStart = epoch(s.startDate);
    assert(sStart > pEnd, 'תכנון מיובא מפר קשרי תלות');
  }
  return structuredClone(doc);
}
export function validatePreferences(value: unknown): ViewPreferences {
  assert(record(value));
  assert(['weeks', 'months', 'quarters'].includes(String(value['mode'])));
  assert(typeof value['dayWidth'] === 'number' && value['dayWidth'] >= 6 && value['dayWidth'] <= 100);
  assert(text(value['center'])); epoch(value['center']);
  assert(Array.isArray(value['collapsed']) && value['collapsed'].every(text));
  return structuredClone(value) as unknown as ViewPreferences;
}
export function parseBackup(raw: string): Backup {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('הקובץ אינו JSON תקין'); }
  assert(record(value)); assert(value['schemaVersion'] === 1, 'גרסת הגיבוי אינה נתמכת');
  assert(text(value['exportedAt']) && Number.isFinite(Date.parse(value['exportedAt'])));
  return { schemaVersion: 1, exportedAt: value['exportedAt'], document: validateDocument(value['document']), preferences: validatePreferences(value['preferences']) };
}
export const exportBackup = (document: RoadmapDocument, preferences: ViewPreferences): string => JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), document, preferences }, null, 2);
