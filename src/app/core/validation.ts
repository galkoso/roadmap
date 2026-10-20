import { Backup, isScheduled, RoadmapDocument, SCHEMA_VERSION, ViewPreferences } from './model';
import { addWorkingDays, epoch, validateRange } from './dates';
import { validCapacityDays } from './planning';
import { topological } from './scheduler';
function assert(test: unknown, message = 'מבנה קובץ הגיבוי אינו תקין'): asserts test { if (!test) throw new Error(message); }
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const order = (value: unknown): boolean => Number.isSafeInteger(value) && Number(value) >= 0;
export function validateDocument(value: unknown): RoadmapDocument {
  assert(record(value));
  assert([1, 2, 3, SCHEMA_VERSION].some(version => value['schemaVersion'] === version), 'גרסת הגיבוי אינה נתמכת. נתמכות גרסאות 1–4');
  if (value['schemaVersion'] === 1) {
    assert(Array.isArray(value['tasks']));
    for (const task of value['tasks']) assert(record(task) && text(task['teamId']) && text(task['workItemId']) && text(task['startDate']) && text(task['endDate']) && task['planningState'] === undefined, 'נתונים ישנים אינם תקינים; לא שונו ולא נמחקו');
    const migrated = structuredClone(value);
    migrated['schemaVersion'] = 2;
    migrated['tasks'] = (value['tasks'] as Record<string, unknown>[]).map(task => ({ ...task, planningState: 'scheduled' }));
    return validateDocument(migrated);
  }
  if (value['schemaVersion'] === 2) {
    assert(Array.isArray(value['tasks']));
    const migrated = structuredClone(value);
    migrated['schemaVersion'] = 3; migrated['members'] = [];
    migrated['tasks'] = (value['tasks'] as Record<string, unknown>[]).map(task => ({ ...task, assigneeId: null }));
    return validateDocument(migrated);
  }
  if (value['schemaVersion'] === 3) {
    const migrated = structuredClone(value);
    migrated['schemaVersion'] = SCHEMA_VERSION;
    migrated['planning'] = { selectedTaskIds: [], teamCapacities: [] };
    return validateDocument(migrated);
  }
  assert(order(value['revision']));
  const ids = new Set<string>();
  for (const key of ['teams', 'members', 'workItems', 'tasks', 'dependencies']) {
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
  for (const member of doc.members) {
    assert(text(member.name) && member.name.trim() && order(member.order), 'שם איש צוות אינו תקין');
    assert(doc.teams.some(team => team.id === member.teamId), 'איש צוות מפנה לצוות שאינו קיים');
  }
  for (const w of doc.workItems) {
    assert(text(w.title) && w.title.trim() && order(w.order));
    assert(w.teamId === undefined || doc.teams.some(team => team.id === w.teamId), 'צוות הכותרת אינו קיים');
    const raw = w as unknown as Record<string, unknown>;
    assert(raw['startDate'] === undefined && raw['endDate'] === undefined && raw['estimatedWorkingDays'] === undefined, 'כותרת אינה יכולה להכיל תאריכים או ימי עבודה');
  }
  for (const t of doc.tasks) {
    assert(text(t.title) && t.title.trim() && text(t.notes) && order(t.order));
    assert(t.estimatedWorkingDays === undefined || (Number.isSafeInteger(t.estimatedWorkingDays) && t.estimatedWorkingDays >= 1 && t.estimatedWorkingDays <= 10000), 'משך משוער חייב להיות מספר שלם בין 1 ל־10,000 ימי עבודה');
    assert(text(t.color) && /^#[0-9a-f]{6}$/i.test(t.color), 'צבע אינו תקין');
    assert(['planned', 'in_progress', 'completed'].includes(t.status), 'סטטוס אינו תקין');
    assert(t.teamId === null || doc.teams.some(team => team.id === t.teamId), 'שיוך צוות אינו תקין');
    assert(t.assigneeId === undefined || t.assigneeId === null || (text(t.assigneeId) && t.teamId !== null && doc.members.some(m => m.id === t.assigneeId && m.teamId === t.teamId)), 'אחראי אינו קיים או אינו שייך לצוות המשימה');
    assert(t.workItemId === null || doc.workItems.some(w => w.id === t.workItemId && (w.teamId === undefined || w.teamId === t.teamId)), 'הכותרת אינה שייכת לצוות המשימה');
    assert(t.planningState === 'scheduled' || t.planningState === 'backlog', 'מצב תכנון אינו תקין');
    if (isScheduled(t)) { assert(text(t.startDate) && text(t.endDate)); validateRange(t.startDate, t.endDate); }
    else assert(t.startDate === undefined && t.endDate === undefined, 'פריט בקלוג אינו יכול להכיל תאריכי דמה');
  }
  const planning = value['planning']; assert(record(planning), 'מצב התכנון אינו תקין');
  const selected = planning['selectedTaskIds'], capacities = planning['teamCapacities'];
  assert(Array.isArray(selected) && selected.length <= 10000 && selected.every(text), 'בחירת משימות אינה תקינה');
  assert(new Set(selected).size === selected.length && selected.every(id => doc.tasks.some(task => task.id === id)), 'בחירת משימות כפולה או מפנה למשימה חסרה');
  assert(Array.isArray(capacities) && capacities.length <= 10000, 'קיבולת צוותים אינה תקינה');
  const capacityTeams = new Set<string>();
  for (const capacity of capacities) {
    assert(record(capacity) && text(capacity['teamId']) && doc.teams.some(team => team.id === capacity['teamId']) && !capacityTeams.has(capacity['teamId']), 'צוות קיבולת חסר או כפול');
    capacityTeams.add(capacity['teamId']);
    assert(capacity['availableWorkingDays'] === null || validCapacityDays(capacity['availableWorkingDays']), 'ימי עבודה זמינים אינם תקינים');
    const availability = capacity['memberAvailability']; assert(Array.isArray(availability) && availability.length <= 10000);
    const members = new Set<string>();
    for (const entry of availability) {
      assert(record(entry) && text(entry['memberId']) && !members.has(entry['memberId']) &&
        doc.members.some(member => member.id === entry['memberId'] && member.teamId === capacity['teamId']), 'פירוט חיילים חסר, כפול או שייך לצוות אחר');
      members.add(entry['memberId']); assert(validCapacityDays(entry['availableWorkingDays']), 'ימי עבודה לחייל אינם תקינים');
    }
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
    assert(['teams', 'people', 'list'].includes(String(backlog['mode'])) && Array.isArray(backlog['collapsed']) && backlog['collapsed'].every(text));
    assert(typeof backlog['scrollTop'] === 'number' && Number.isFinite(backlog['scrollTop']) && backlog['scrollTop'] >= 0);
  }
  assert(value['grouping'] === undefined || ['work', 'people'].includes(String(value['grouping'])));
  assert(value['peopleCollapsed'] === undefined || (Array.isArray(value['peopleCollapsed']) && value['peopleCollapsed'].every(text)));
  if (record(value['backlog'])) {
    const keys = value['backlog']['peopleCollapsed']; assert(keys === undefined || (Array.isArray(keys) && keys.every(text)));
  }
  if (value['planning'] !== undefined) {
    const prefs = value['planning']; assert(record(prefs));
    assert(prefs['activeTeamId'] === null || text(prefs['activeTeamId']));
    assert(Array.isArray(prefs['expandedTeamIds']) && prefs['expandedTeamIds'].length <= 10000 && prefs['expandedTeamIds'].every(text));
    assert(new Set(prefs['expandedTeamIds']).size === prefs['expandedTeamIds'].length);
    assert(Array.isArray(prefs['collapsedGroups']) && prefs['collapsedGroups'].length <= 10000);
    const keys = new Set<string>();
    for (const group of prefs['collapsedGroups']) {
      assert(record(group) && text(group['teamId']) && text(group['pane']) && ['selected', 'candidates'].includes(group['pane']) && (group['workItemId'] === null || text(group['workItemId'])));
      const key = JSON.stringify([group['teamId'], group['pane'], group['workItemId']]);
      assert(!keys.has(key), 'קבוצת תכנון כפולה'); keys.add(key);
    }
  }
  assert(Array.isArray(value['collapsed']) && value['collapsed'].every(text));
  return structuredClone(value) as unknown as ViewPreferences;
}
export function parseBackup(raw: string): Backup {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('הקובץ אינו JSON תקין'); }
  assert(record(value)); assert([1, 2, 3, SCHEMA_VERSION].some(version => value['schemaVersion'] === version), 'גרסת הגיבוי אינה נתמכת');
  assert(record(value['document']) && value['document']['schemaVersion'] === value['schemaVersion'], 'גרסת המסמך אינה תואמת לגרסת הגיבוי');
  assert(text(value['exportedAt']) && Number.isFinite(Date.parse(value['exportedAt'])));
  const document = validateDocument(value['document']), preferences = validatePreferences(value['preferences']);
  validatePlanningPreferenceReferences(preferences, document);
  return { schemaVersion: SCHEMA_VERSION, exportedAt: value['exportedAt'], document, preferences };
}
export function exportBackup(document: RoadmapDocument, preferences: ViewPreferences): string {
  const valid = validateDocument(document), prefs = validatePreferences(preferences);
  validatePlanningPreferenceReferences(prefs, valid);
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), document: valid, preferences: prefs }, null, 2);
}

export function validatePlanningPreferenceReferences(preferences: ViewPreferences, doc: RoadmapDocument): void {
  const prefs = preferences.planning; if (!prefs) return;
  const teams = new Set(doc.teams.map(team => team.id)), works = new Set(doc.workItems.map(work => work.id));
  assert(prefs.activeTeamId === null || teams.has(prefs.activeTeamId), 'צוות התכנון הפעיל אינו קיים');
  assert(prefs.expandedTeamIds.every(id => teams.has(id)), 'צוות בפירוט חיילים אינו קיים');
  assert(prefs.collapsedGroups.every(group => teams.has(group.teamId) && (group.workItemId === null || works.has(group.workItemId))), 'קבוצת תכנון מפנה לצוות או וקטור חסר');
}
