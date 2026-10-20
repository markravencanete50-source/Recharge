import { londonClock } from './team-time';
import type { Timesheet, TimesheetPerson } from './workspace-teams-policy';

// What actually happened on a rota day: each shift's clock in and clock out, in UK time. A shift
// belongs to the UK day it started on, so one that runs past midnight shows on its first day (the
// timesheet already groups shifts that way). A shift still open is "Not clocked out" until it has
// run for 16 hours; after that nobody is plausibly still working it, so it reads "Did not clock out".
export const FORGOTTEN_CLOCK_OUT_MINUTES = 16 * 60;
export type RotaActual = { id: string; state: 'closed' | 'open' | 'forgotten'; text: string };

export function rotaActuals(person: TimesheetPerson | undefined, day: string, now: Date = new Date()): RotaActual[] {
  const shifts = person?.days.find(d => d.day === day)?.shifts ?? [];
  return shifts.slice().sort((a, b) => Date.parse(a.clockedInAt) - Date.parse(b.clockedInAt)).map(s => {
    const clockIn = `In ${londonClock(s.clockedInAt)}`;
    if (s.clockedOutAt) return { id: s.id, state: 'closed', text: `${clockIn} · Out ${londonClock(s.clockedOutAt)}` };
    const forgotten = now.getTime() - Date.parse(s.clockedInAt) >= FORGOTTEN_CLOCK_OUT_MINUTES * 60000;
    return { id: s.id, state: forgotten ? 'forgotten' : 'open', text: `${clockIn} · ${forgotten ? 'Did not clock out' : 'Not clocked out'}` };
  });
}

// The timesheet's people by user id, so each rota row can find its own clocked shifts.
export function actualsByPerson(sheet: Timesheet | null | undefined): Map<string, TimesheetPerson> {
  return new Map((sheet?.people ?? []).map(person => [person.userId, person]));
}
