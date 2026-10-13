export type TaskStatus = 'planned' | 'in_progress' | 'completed';
export interface Team { id: string; name: string; order: number }
export interface WorkItem { id: string; title: string; order: number }
interface TaskBase {
  id: string; workItemId: string | null; teamId: string | null; title: string;
  color: string; status: TaskStatus; notes: string; order: number;
}
export interface ScheduledTask extends TaskBase { planningState: 'scheduled'; startDate: string; endDate: string }
export interface BacklogTask extends TaskBase { planningState: 'backlog'; startDate?: never; endDate?: never }
export type Task = ScheduledTask | BacklogTask;
export const isScheduled = (task: Task): task is ScheduledTask => task.planningState === 'scheduled';
export interface Dependency { id: string; predecessorId: string; successorId: string; type: 'finish_to_start'; lagWorkingDays: number }
export interface RoadmapDocument {
  schemaVersion: number; revision: number; teams: Team[]; workItems: WorkItem[]; tasks: Task[]; dependencies: Dependency[];
}
export interface ViewPreferences {
  mode: 'weeks' | 'months' | 'quarters'; dayWidth: number; center: string; collapsed: string[]; scrollLeft?: number;
  timelineAnchor?: string; scrollTop?: number;
  backlog?: { mode: 'teams' | 'list'; collapsed: string[]; scrollTop: number };
}
export interface Backup { schemaVersion: number; exportedAt: string; document: RoadmapDocument; preferences: ViewPreferences }
export const SCHEMA_VERSION = 2;
export const statuses: Record<TaskStatus, string> = { planned: 'מתוכננת', in_progress: 'בביצוע', completed: 'הושלמה' };
export const palette = ['#3975d5', '#8c62c7', '#239b87', '#de9950', '#d66883', '#64748b'];
export const uid = (): string => crypto.randomUUID();
export const clone = <T>(value: T): T => structuredClone(value);
