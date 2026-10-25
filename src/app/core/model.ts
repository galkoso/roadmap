export type TaskStatus = 'planned' | 'in_progress' | 'completed';
export interface Team { id: string; name: string; order: number }
export interface TeamMember { id: string; teamId: string; name: string; order: number }
export interface WorkItem { id: string; title: string; order: number; teamId?: string }
interface TaskBase {
  id: string; workItemId: string | null; teamId: string | null; title: string;
  assigneeId?: string | null; color: string; status: TaskStatus; notes: string; order: number; estimatedWorkingDays?: number;
}
export interface ScheduledTask extends TaskBase { planningState: 'scheduled'; startDate: string; endDate: string }
export interface BacklogTask extends TaskBase { planningState: 'backlog'; startDate?: never; endDate?: never }
export type Task = ScheduledTask | BacklogTask;
export const isScheduled = (task: Task): task is ScheduledTask => task.planningState === 'scheduled';
export interface Dependency { id: string; predecessorId: string; successorId: string; type: 'finish_to_start'; lagWorkingDays: number }
export interface TeamCapacity {
  // Legacy manually entered total is retained for backup compatibility; current capacity is the sum of member availability.
  teamId: string; availableWorkingDays: number | null;
  memberAvailability: { memberId: string; availableWorkingDays: number }[];
}
export interface MonthlyPlan {
  period: string;
  selectedTaskIds: string[]; teamCapacities: TeamCapacity[];
  taskTeamLinks?: { taskId: string; teamId: string | null }[];
}
export interface PlanningState { plans: MonthlyPlan[] }
export type PlanningCandidateSource = 'team' | 'unassigned' | 'all';
export type PlanningPane = 'selected' | 'candidates';
export interface PlanningPreferences {
  activeTeamId: string | null; activePeriod?: string; candidateSource?: PlanningCandidateSource;
  collapsedGroups: { teamId: string; pane: PlanningPane; workItemId: string | null; period?: string }[];
  expandedTeamIds: string[];
}
export interface RoadmapDocument {
  schemaVersion: number; revision: number; teams: Team[]; members: TeamMember[]; workItems: WorkItem[]; tasks: Task[]; dependencies: Dependency[];
  planning: PlanningState;
}
export interface ViewPreferences {
  mode: 'weeks' | 'months' | 'quarters'; dayWidth: number; center: string; collapsed: string[]; scrollLeft?: number;
  timelineAnchor?: string; scrollTop?: number; grouping?: 'work' | 'people'; peopleCollapsed?: string[];
  backlog?: { mode: 'teams' | 'people' | 'list'; collapsed: string[]; peopleCollapsed?: string[]; scrollTop: number };
  planning?: PlanningPreferences;
}
export interface Backup { schemaVersion: number; exportedAt: string; document: RoadmapDocument; preferences: ViewPreferences }
export const SCHEMA_VERSION = 6;
export const statuses: Record<TaskStatus, string> = { planned: 'מתוכננת', in_progress: 'בביצוע', completed: 'הושלמה' };
export const palette = ['#3975d5', '#8c62c7', '#239b87', '#de9950', '#d66883', '#64748b'];
export const uid = (): string => crypto.randomUUID();
export const clone = <T>(value: T): T => structuredClone(value);
