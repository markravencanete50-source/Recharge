export function moveScheduleDay(key: string, days: number) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function scheduleWeek(key: string) {
  const date = new Date(`${key}T12:00:00Z`);
  const first = moveScheduleDay(key, -((date.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => moveScheduleDay(first, i));
}
export function scheduleWeekLabel(key: string) {
  const days = scheduleWeek(key), first = new Date(days[0] + 'T12:00:00Z'), last = new Date(days[6] + 'T12:00:00Z');
  const month = (date: Date) => date.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${first.getUTCDate()}${first.getUTCMonth() === last.getUTCMonth() ? '' : ' ' + month(first)} to ${last.getUTCDate()} ${month(last)}`;
}
export const fullScheduleDate = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
