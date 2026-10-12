export type TaskStatus = 'planned' | 'in_progress' | 'completed';
export interface Team { id: string; name: string; order: number }
export interface WorkItem { id: string; title: string; order: number }
export interface Task {
  id: string; workItemId: string; teamId: string; title: string;
  startDate: string; endDate: string; color: string; status: TaskStatus; notes: string; order: number;
}
export interface Dependency { id: string; predecessorId: string; successorId: string; type: 'finish_to_start'; lagWorkingDays: number }
export interface RoadmapDocument {
  schemaVersion: number; revision: number; teams: Team[]; workItems: WorkItem[]; tasks: Task[]; dependencies: Dependency[];
}
export interface ViewPreferences { mode: 'weeks' | 'months' | 'quarters'; dayWidth: number; center: string; collapsed: string[] }
export interface Backup { schemaVersion: number; exportedAt: string; document: RoadmapDocument; preferences: ViewPreferences }
export const statuses: Record<TaskStatus, string> = { planned: 'מתוכננת', in_progress: 'בביצוע', completed: 'הושלמה' };
export const palette = ['#3975d5', '#8c62c7', '#239b87', '#de9950', '#d66883', '#64748b'];
export const uid = (): string => crypto.randomUUID();
export const clone = <T>(value: T): T => structuredClone(value);
