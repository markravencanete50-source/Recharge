import { z } from 'zod';
import { workspaceAccountSchema, type WorkspaceAccount } from './workspace-account-policy';

// Demo mode: a super admin can show the whole app filled with a sample business without writing to
// the real database. The sample business is a file of recorded answers (mobile/web-static/demo-data.json,
// made by scripts/build-demo-data.mjs from the real database functions and a seeded business), one set
// per role. While demo mode is on, every read the app makes is answered from that file, dates moved so
// the sample stays current, and nothing is ever sent to be saved.

export const DEMO_ROLES = ['super_admin', 'admin', 'stays', 'cleaning_manager', 'cleans', 'ready', 'accounts', 'client'] as const;
export type DemoRole = (typeof DEMO_ROLES)[number];
export const DEMO_SAVE_MESSAGE = "Demo mode: nothing is saved. Switch to Live to make real changes.";

const personaSchema = z.object({
  account: workspaceAccountSchema,
  // Recorded answers by request key (demoKey), and by the looser key (demoLooseKey) as a fallback.
  responses: z.record(z.unknown()),
  loose: z.record(z.unknown()).default({}),
});
export const demoDataSchema = z.object({
  version: z.literal(1),
  capturedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  personas: z.record(z.enum(DEMO_ROLES), personaSchema),
});
export type DemoData = z.infer<typeof demoDataSchema>;
export type DemoPersona = { role: DemoRole; account: WorkspaceAccount };

const DAY = 86_400_000;
const dayNumber = (iso: string) => Math.floor(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') / DAY);
const isoDay = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from);

// Request parameters that are dates are recorded relative to the day they were recorded on ("@-7"
// is a week before), so the same screen asks the same question on any later day.
const DATE = /^\d{4}-\d{2}-\d{2}$/, MONTH = /^\d{4}-\d{2}$/;
function relative(value: string, today: string) {
  if (DATE.test(value)) return '@' + daysBetween(today, value);
  if (MONTH.test(value)) { const [y, m] = value.split('-').map(Number), [ty, tm] = today.split('-').map(Number); return '@m' + ((y - ty) * 12 + (m - tm)); }
  return value;
}
const isDateLike = (value: string) => DATE.test(value) || MONTH.test(value);
// Identifies a read: the phone-app path (/api/mobile/…) and its parameters in a fixed order, with
// dates made relative to `today`.
export function demoKey(path: string, today: string) {
  const [base, query = ''] = path.split('?');
  const params = [...new URLSearchParams(query)].map(([k, v]) => [k, relative(v, today)] as const).sort(([a], [b]) => a.localeCompare(b));
  return base + (params.length ? '?' + params.map(([k, v]) => `${k}=${v}`).join('&') : '');
}
// The looser key leaves out dates and record ids, so a screen asking about another week or another
// property still gets a believable answer.
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function demoLooseKey(path: string) {
  const [base, query = ''] = path.split('?');
  const params = [...new URLSearchParams(query)].filter(([k, v]) => !isDateLike(v) && !ID.test(v) && !['cursor', 'before', 'limit'].includes(k)).sort(([a], [b]) => a.localeCompare(b));
  return base + (params.length ? '?' + params.map(([k, v]) => `${k}=${v}`).join('&') : '');
}

// Moves every date in a recorded answer by `days`, so "today's cleans" are today's whenever the demo
// is opened. Dates, timestamps and months are moved; other text is left alone.
const STAMP = /\b(\d{4}-\d{2}-\d{2})(T[0-9:.]+(?:Z|[+-]\d{2}:?\d{2})?)?\b/g;
export function shiftDates<T>(value: T, days: number): T {
  if (!days) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (MONTH.test(v)) { const moved = isoDay(dayNumber(v + '-15') + days); return moved.slice(0, 7); }
      return v.replace(STAMP, (_all, day: string, time: string | undefined) => isoDay(dayNumber(day) + days) + (time ?? ''));
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

// The answer to one read for a persona, or null when the sample has none.
export function demoAnswer(data: DemoData, role: DemoRole, path: string, today: string): unknown | null {
  const persona = data.personas[role];
  if (!persona) return null;
  const exact = persona.responses[demoKey(path, today)];
  const found = exact !== undefined ? exact : persona.loose[demoLooseKey(path)];
  return found === undefined ? null : shiftDates(found, daysBetween(data.capturedOn, today));
}
// The people a super admin can "view as" inside the demo: one per role the sample has.
export function demoPeople(data: DemoData) {
  return DEMO_ROLES.filter((role): role is Exclude<DemoRole, 'super_admin'> => role !== 'super_admin' && !!data.personas[role])
    .map(role => ({ userId: data.personas[role]!.account.userId, fullName: data.personas[role]!.account.fullName, role }));
}
