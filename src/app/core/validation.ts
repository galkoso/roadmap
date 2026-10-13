import { Backup, isScheduled, RoadmapDocument, SCHEMA_VERSION, ViewPreferences } from './model';
import { addWorkingDays, epoch, validateRange } from './dates';
import { topological } from './scheduler';
function assert(test: unknown, message = 'מבנה קובץ הגיבוי אינו תקין'): asserts test { if (!test) throw new Error(message); }
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const order = (value: unknown): boolean => Number.isSafeInteger(value) && Number(value) >= 0;
export function validateDocument(value: unknown): RoadmapDocument {
  assert(record(value));
  assert([1, SCHEMA_VERSION].includes(Number(value['schemaVersion'])), 'גרסת הגיבוי אינה נתמכת. נתמכות גרסאות 1 ו־2');
  if (value['schemaVersion'] === 1) {
    assert(Array.isArray(value['tasks']));
    for (const task of value['tasks']) assert(record(task) && text(task['teamId']) && text(task['workItemId']) && text(task['startDate']) && text(task['endDate']) && task['planningState'] === undefined, 'נתונים ישנים אינם תקינים; לא שונו ולא נמחקו');
    const migrated = structuredClone(value);
    migrated['schemaVersion'] = SCHEMA_VERSION;
    migrated['tasks'] = (value['tasks'] as Record<string, unknown>[]).map(task => ({ ...task, planningState: 'scheduled' }));
    return validateDocument(migrated);
  }
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
    assert(t.teamId === null || doc.teams.some(team => team.id === t.teamId), 'שיוך צוות אינו תקין');
    assert(t.workItemId === null || doc.workItems.some(w => w.id === t.workItemId), 'שיוך עבודה אינו תקין');
    assert(t.planningState === 'scheduled' || t.planningState === 'backlog', 'מצב תכנון אינו תקין');
    if (isScheduled(t)) { assert(text(t.startDate) && text(t.endDate)); validateRange(t.startDate, t.endDate); }
    else assert(t.startDate === undefined && t.endDate === undefined, 'פריט בקלוג אינו יכול להכיל תאריכי דמה');
  }
  topological(doc);
  for (const d of doc.dependencies) {
    const p = doc.tasks.find(t => t.id === d.predecessorId)!, s = doc.tasks.find(t => t.id === d.successorId)!;
    // Imported schedules must satisfy all finish-to-start constraints.
    if (isScheduled(s)) {
      assert(isScheduled(p), 'משימה משובצת תלויה בפריט בקלוג ללא תאריכים: ' + p.title);
      assert(s.startDate >= addWorkingDays(p.endDate, 1 + d.lagWorkingDays), 'תכנון מיובא מפר קשרי תלות');
    }
  }
  return structuredClone(doc);
}
export function validatePreferences(value: unknown): ViewPreferences {
  assert(record(value));
  assert(['weeks', 'months', 'quarters'].includes(String(value['mode'])));
  assert(typeof value['dayWidth'] === 'number' && value['dayWidth'] >= 6 && value['dayWidth'] <= 100);
  assert(text(value['center'])); epoch(value['center']);
  assert(value['scrollLeft'] === undefined || (typeof value['scrollLeft'] === 'number' && Number.isFinite(value['scrollLeft']) && value['scrollLeft'] >= 0));
  if (value['timelineAnchor'] !== undefined) { assert(text(value['timelineAnchor'])); epoch(value['timelineAnchor']); }
  assert(value['scrollTop'] === undefined || (typeof value['scrollTop'] === 'number' && Number.isFinite(value['scrollTop']) && value['scrollTop'] >= 0));
  if (value['backlog'] !== undefined) {
    const backlog = value['backlog']; assert(record(backlog));
    assert(['teams', 'list'].includes(String(backlog['mode'])) && Array.isArray(backlog['collapsed']) && backlog['collapsed'].every(text));
    assert(typeof backlog['scrollTop'] === 'number' && Number.isFinite(backlog['scrollTop']) && backlog['scrollTop'] >= 0);
  }
  assert(Array.isArray(value['collapsed']) && value['collapsed'].every(text));
  return structuredClone(value) as unknown as ViewPreferences;
}
export function parseBackup(raw: string): Backup {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('הקובץ אינו JSON תקין'); }
  assert(record(value)); assert([1, SCHEMA_VERSION].includes(Number(value['schemaVersion'])), 'גרסת הגיבוי אינה נתמכת');
  assert(record(value['document']) && value['document']['schemaVersion'] === value['schemaVersion'], 'גרסת המסמך אינה תואמת לגרסת הגיבוי');
  assert(text(value['exportedAt']) && Number.isFinite(Date.parse(value['exportedAt'])));
  return { schemaVersion: SCHEMA_VERSION, exportedAt: value['exportedAt'], document: validateDocument(value['document']), preferences: validatePreferences(value['preferences']) };
}
export const exportBackup = (document: RoadmapDocument, preferences: ViewPreferences): string => JSON.stringify({ schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), document, preferences }, null, 2);
