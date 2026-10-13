// UTC is used only as a calendar representation, never as local elapsed time.
const DAY = 86_400_000;
export function epoch(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('תאריך אינו תקין');
  const value = Date.parse(date + 'T00:00:00Z');
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) throw new Error('תאריך אינו תקין');
  return value / DAY;
}
export const iso = (day: number): string => new Date(day * DAY).toISOString().slice(0, 10);
export const addDays = (date: string, amount: number): string => iso(epoch(date) + amount);
export const daysBetween = (from: string, to: string): number => epoch(to) - epoch(from);
export const isWorkingDay = (date: string): boolean => ![5, 6].includes(new Date(epoch(date) * DAY).getUTCDay());
export function nextWorkingDay(date: string): string {
  while (!isWorkingDay(date)) date = addDays(date, 1);
  return date;
}
export function addWorkingDays(date: string, amount: number): string {
  epoch(date);
  if (!Number.isSafeInteger(amount)) throw new Error('מספר ימי עבודה חייב להיות שלם ובטווח בטוח');
  const step = Math.sign(amount); let left = Math.abs(amount);
  // Normalize a weekend input while counting only a reached working day.
  while (left && !isWorkingDay(date)) { date = addDays(date, step); if (isWorkingDay(date)) left--; }
  const weeks = Math.floor(left / 5);
  if (weeks) date = addDays(date, weeks * 7 * step);
  left %= 5;
  while (left > 0) { date = addDays(date, step); if (isWorkingDay(date)) left--; }
  epoch(date); return date;
}
export function workingDifference(from: string, to: string): number {
  const distance = daysBetween(from, to);
  return distance > 0 ? duration(addDays(from, 1), to) : distance < 0 ? -duration(to, addDays(from, -1)) : 0;
}
export function duration(start: string, end: string): number {
  const days = daysBetween(start, end) + 1;
  if (days <= 0) throw new Error('תאריך הסיום לפני תאריך ההתחלה');
  const weeks = Math.floor(days / 7); let count = weeks * 5;
  for (let i = 0; i < days % 7; i++) if (isWorkingDay(addDays(start, i))) count++;
  return count;
}
export function validateRange(start: string, end: string): void {
  epoch(start); epoch(end);
  for (const date of [start, end]) if (!isWorkingDay(date)) throw new Error(`שישי ושבת אינם ימי עבודה. התאריך הבא: ${nextWorkingDay(date)}`);
  if (end < start) throw new Error('תאריך הסיום חייב להיות אחרי ההתחלה או באותו יום');
}
export const today = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const formatDate = (date: string): string => new Intl.DateTimeFormat('he-IL', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(epoch(date) * DAY));
export const monthLabel = (date: string): string => new Intl.DateTimeFormat('he-IL', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(epoch(date) * DAY));
