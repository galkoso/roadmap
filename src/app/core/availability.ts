import { AttendanceException, RoadmapDocument, ScheduledTask } from './model.js';
import { addDays, daysBetween, duration, epoch, isWorkingDay } from './dates.js';

// A search is bounded to 1,096 calendar dates (three years, including a leap day).
export const SCHEDULING_HORIZON = 1096;
export function validateAttendance(doc: RoadmapDocument, entry: AttendanceException): void {
  if (!doc.members.some(member => member.id === entry.memberId)) throw new Error('איש הצוות אינו קיים');
  epoch(entry.date);
  if (!isWorkingDay(entry.date)) throw new Error('לא ניתן לשנות נוכחות בשישי או בשבת');
  if (!['present', 'absent'].includes(entry.status)) throw new Error('מצב נוכחות אינו תקין');
}
export function isAvailable(doc: RoadmapDocument, memberId: string | null | undefined, date: string): boolean {
  epoch(date);
  if (memberId && !doc.members.some(member => member.id === memberId)) throw new Error('איש הצוות אינו קיים');
  return isWorkingDay(date) && (!memberId || !doc.attendance?.some(entry => entry.memberId === memberId && entry.date === date && entry.status === 'absent'));
}
export function monthDates(period: string): string[] {
  if (!/^(19\d{2}|[2-9]\d{3})-(0[1-9]|1[0-2])$/.test(period)) throw new Error('חודש ושנה אינם תקינים');
  const dates: string[] = [];
  for (let date = period + '-01'; date.startsWith(period); date = addDays(date, 1)) dates.push(date);
  return dates;
}
export function personCapacity(doc: RoadmapDocument, memberId: string, period: string) {
  if (!doc.members.some(member => member.id === memberId)) throw new Error('איש הצוות אינו קיים');
  const dates = monthDates(period), base = dates.filter(isWorkingDay).length;
  const available = dates.filter(date => isAvailable(doc, memberId, date)).length;
  return { base, absent: base - available, available };
}
export const teamCapacity = (doc: RoadmapDocument, teamId: string, period: string): number =>
  doc.members.filter(member => member.teamId === teamId).reduce((sum, member) => sum + personCapacity(doc, member.id, period).available, 0);
export const requiredEffort = (task: ScheduledTask): number => task.effortWorkingDays ?? duration(task.startDate, task.endDate);
export function executionSchedule(doc: RoadmapDocument, memberId: string | null | undefined, requested: string, effort: number) {
  epoch(requested);
  if (!Number.isSafeInteger(effort) || effort < 1 || effort > 10000) throw new Error('נדרש היקף שלם של 1–10,000 ימי עבודה; חצאי ימים אינם נתמכים בשיבוץ');
  const executionDates: string[] = [], skippedDates: string[] = [];
  for (let offset = 0; offset < SCHEDULING_HORIZON; offset++) {
    const date = addDays(requested, offset);
    if (isAvailable(doc, memberId, date)) executionDates.push(date); else skippedDates.push(date);
    if (executionDates.length === effort) return { startDate: executionDates[0], endDate: date, executionDates, skippedDates,
      elapsedDays: daysBetween(executionDates[0], date) + 1 };
  }
  throw new Error('לא נמצאה זמינות מספקת בטווח החיפוש של שלוש שנים');
}
export const nextAvailableDate = (doc: RoadmapDocument, memberId: string | null, requested: string): string =>
  executionSchedule(doc, memberId, requested, 1).startDate;
export function rangeEffort(doc: RoadmapDocument, memberId: string | null | undefined, start: string, end: string): number {
  const span = daysBetween(start, end);
  if (span < 0 || span >= SCHEDULING_HORIZON) throw new Error('טווח השיבוץ אינו תקין או חורג משלוש שנים');
  let count = 0;
  for (let i = 0; i <= span; i++) if (isAvailable(doc, memberId, addDays(start, i))) count++;
  if (!count) throw new Error('אין ימי עבודה זמינים בטווח שנבחר');
  return count;
}
export function overlappingTasks(doc: RoadmapDocument, task: ScheduledTask): string[] {
  if (!task.assigneeId || task.scheduleIssue) return [];
  const dates = new Set(executionSchedule(doc, task.assigneeId, task.startDate, requiredEffort(task)).executionDates);
  return doc.tasks.filter((other): other is ScheduledTask => other.planningState === 'scheduled' && other.id !== task.id &&
    other.assigneeId === task.assigneeId && !other.scheduleIssue && other.startDate <= task.endDate && other.endDate >= task.startDate)
    .filter(other => executionSchedule(doc, other.assigneeId, other.startDate, requiredEffort(other)).executionDates.some(date => dates.has(date)))
    .map(other => other.title);
}
