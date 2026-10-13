import { RoadmapDocument, SCHEMA_VERSION, ViewPreferences } from './model';
import { addDays, addWorkingDays, today } from './dates';
export function initialPreferences(): ViewPreferences { return { mode: 'months', dayWidth: 28, center: today(), collapsed: [] }; }
export function seedDocument(): RoadmapDocument {
  const now = today();
  const day = new Date(now + 'T00:00:00Z').getUTCDay();
  const sunday = addDays(now, -day);
  const implementation = addWorkingDays(sunday, 3), implementationEnd = addWorkingDays(implementation, 4);
  const testing = addWorkingDays(implementationEnd, 1);
  return {
    schemaVersion: SCHEMA_VERSION, revision: 0,
    teams: [{ id: 'team-a', name: 'צוות א׳', order: 0 }, { id: 'team-b', name: 'צוות ב׳', order: 1 }, { id: 'team-c', name: 'צוות ג׳', order: 2 }],
    workItems: [{ id: 'services', title: 'שדרוג תשתית השירותים', order: 0 }, { id: 'monitoring', title: 'מערכת ניטור חדשה', order: 1 }],
    tasks: [
      { planningState: 'scheduled', id: 'architecture', workItemId: 'services', teamId: 'team-a', title: 'תכנון הארכיטקטורה', startDate: sunday, endDate: addWorkingDays(sunday, 2), color: '#3975d5', status: 'completed', notes: '', order: 0 },
      { planningState: 'scheduled', id: 'implementation', workItemId: 'services', teamId: 'team-b', title: 'מימוש השירותים', startDate: implementation, endDate: implementationEnd, color: '#8c62c7', status: 'in_progress', notes: 'מימוש מדורג ותיאום חוזי השירותים עם צוות א׳.', order: 1 },
      { planningState: 'scheduled', id: 'testing', workItemId: 'services', teamId: 'team-c', title: 'בדיקות והטמעה', startDate: testing, endDate: addWorkingDays(testing, 1), color: '#239b87', status: 'planned', notes: '', order: 2 },
      { planningState: 'scheduled', id: 'monitor', workItemId: 'monitoring', teamId: 'team-b', title: 'הקמת מערכת הניטור', startDate: addWorkingDays(sunday, 1), endDate: addWorkingDays(sunday, 6), color: '#de9950', status: 'planned', notes: '', order: 0 },
      { id: 'idea-a', planningState: 'backlog', workItemId: null, teamId: null, title: 'רעיון לשיפור חוויית השירות', color: '#3975d5', status: 'planned', notes: '', order: 4 },
      { id: 'idea-b', planningState: 'backlog', workItemId: null, teamId: null, title: 'בחינת כלי תכנון חדשים', color: '#8c62c7', status: 'planned', notes: '', order: 5 },
      { id: 'idea-c', planningState: 'backlog', workItemId: null, teamId: 'team-b', title: 'תיעוד תהליך העבודה', color: '#de9950', status: 'planned', notes: '', order: 6 },
      { id: 'idea-d', planningState: 'backlog', workItemId: 'services', teamId: 'team-c', title: 'אוטומציה להטמעה', color: '#239b87', status: 'planned', notes: '', order: 7 }
    ],
    dependencies: [
      { id: 'dep-1', predecessorId: 'architecture', successorId: 'implementation', type: 'finish_to_start', lagWorkingDays: 0 },
      { id: 'dep-2', predecessorId: 'implementation', successorId: 'testing', type: 'finish_to_start', lagWorkingDays: 0 }
    ]
  };
}
