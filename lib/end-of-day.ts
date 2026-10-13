import { reflectionRequired } from './feedback-defaults';

// Signing off the day without an open shift (client ask A7 follow-up). Saving a reflection needs an open
// shift, so a person who never clocked in, or who clocked out earlier, cannot sign off that way. Home then
// offers the plain sign-off card instead. The database lets only Stays and admins use signOffDay
// ("Stays access required"), so the card is for the roles that must write a reflection AND can sign off:
// today that is Stays. Everyone else is not offered a button the database would refuse.
export const SIGN_OFF_ROLES = ['stays', 'admin', 'super_admin'] as const;
export const canSignOffDay = (role: string | null | undefined): boolean => !!role && (SIGN_OFF_ROLES as readonly string[]).includes(role);
export const endOfDayRole = (role: string | null | undefined): boolean => reflectionRequired(role) && canSignOffDay(role);

// From this London hour the day is nearly over, so the card shows even when no shift was worked.
export const END_OF_DAY_HOUR = 15;
// How often the card checks again, so it follows a clock-in or clock-out made elsewhere on Home.
export const END_OF_DAY_POLL_MS = 60000;

// Show the card when the role needs it, nobody is clocked in (the reflection covers that), and either a
// shift was already worked today or the afternoon has come. Once signed off it stays quiet.
export function endOfDayOffered(input: { role: string | null | undefined; openShift: boolean; shiftsToday: number; hour: number }): boolean {
  if (!endOfDayRole(input.role) || input.openShift) return false;
  return input.shiftsToday > 0 || input.hour >= END_OF_DAY_HOUR;
}

// The London hour (0 to 23) of an instant.
export const londonHour = (at: Date = new Date()): number => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' }).format(at));
