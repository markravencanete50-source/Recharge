import { z } from 'zod';
import { WORKSPACE_MAP, type DepartmentTone } from './workspace-map';
import { isWorkspaceAdmin, MODULE_IDS, MODULES, type ModuleId, type WorkspaceRole } from './modules';
import { WORK_VIEW_LABEL, workViewsFor } from './tool-directory';
import { homeToolsFor } from './home-tools';
import { presenceLabel, presenceOf } from './workspace-chat-policy';
import { londonClock } from './team-time';
import { PAUSE_LABEL, shiftSchema, type Shift } from './management-live';

// Access control (super admins): the shapes read from the database, and the plain-English labels
// and groups the screen uses. The database decides what is allowed.
export const accessPersonSchema = z.object({
  userId: z.string().uuid(), fullName: z.string(), email: z.string().nullable(), phone: z.string().nullable(), role: z.string(),
  status: z.enum(['active', 'pending', 'revoked']), emailVerified: z.boolean(), joinedAt: z.string(), lastSignInAt: z.string().nullable(),
  modules: z.array(z.string()), properties: z.number(), activeSessions: z.number(), passwordRevoked: z.boolean(), closed: z.boolean(),
  // When they last had the app open, and their shift right now (with any pause or overtime).
  seenAt: z.string().nullable().default(null), shift: shiftSchema.nullable().default(null),
});
export type AccessPerson = z.infer<typeof accessPersonSchema>;
export const accessPeopleSchema = z.array(accessPersonSchema);
export const accessHistorySchema = z.array(z.object({ id: z.number(), event: z.string(), at: z.string(), target: z.string(), actor: z.string(), detail: z.record(z.unknown()) }));
export type AccessEvent = z.infer<typeof accessHistorySchema>[number];

export type AccessState = 'active' | 'pending' | 'blocked' | 'deleted';
export const accessState = (p: Pick<AccessPerson, 'status' | 'closed'>): AccessState => p.closed ? 'deleted' : p.status === 'revoked' ? 'blocked' : p.status;
export const STATE_LABEL: Record<AccessState, [string, 'good' | 'wait' | 'bad' | 'plain']> = {
  active: ['Active', 'good'], pending: ['Waiting for approval', 'wait'], blocked: ['Blocked', 'bad'], deleted: ['Deleted', 'plain'],
};
const EVENT_LABEL: Record<string, string> = {
  tool_access_changed: 'Tools changed', account_blocked: 'Blocked', account_unblocked: 'Unblocked', password_revoked: 'Password revoked',
  signed_out_everywhere: 'Signed out everywhere', account_deleted: 'Account deleted', role_changed: 'Role changed',
  account_created: 'Added', password_link_created: 'Set-password link made', viewed_as: 'Viewed as',
};
export const eventLabel = (event: string) => EVENT_LABEL[event] ?? event.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

// What each role gives, in one line, for the role picker.
export const ROLE_SUMMARY: Record<WorkspaceRole, string> = {
  super_admin: 'Everything an admin has, plus Access control and admin accounts',
  admin: 'Every tool and every property, with Management and Accounts',
  stays: 'Bookings, guests, pricing and listings for their properties',
  cleaning_manager: 'Runs the cleaning team: schedule, checks and cleaner performance',
  cleans: 'Their own cleaning jobs, performance and invoices',
  ready: 'Repairs, inspections and getting properties ready',
  accounts: 'Expenses, payouts and owner statements',
  client: 'The owner view: their properties, bookings and statements',
};
const RANK: Record<WorkspaceRole, number> = { super_admin: 3, admin: 2, stays: 1, cleaning_manager: 1, cleans: 1, ready: 1, accounts: 1, client: 0 };

// What changes when someone moves to another role: they see exactly what anyone in that role sees
// (the same Work views, Home tools and usual tools), and their properties follow the role.
export function roleChange(person: { role: string; properties: number }, to: WorkspaceRole, modules: readonly string[], label: (role: string) => string) {
  const from = person.role as WorkspaceRole;
  const promote = (RANK[to] ?? 0) > (RANK[from] ?? 0) && to !== 'client';
  const crossesOwner = (from === 'client') !== (to === 'client');
  const n = person.properties, props = `${n} propert${n === 1 ? 'y' : 'ies'}`;
  const properties = isWorkspaceAdmin(to) ? 'They see every property.'
    : !n ? 'They have no properties yet. Assign them in Management → Properties.'
    : crossesOwner ? `Their ${props} will be unassigned, because owners and team members are linked to properties differently. Assign them again in Management → Properties.`
    : `Their ${props} ${n === 1 ? 'stays' : 'stay'} assigned to them.`;
  return {
    same: from === to, promote,
    action: `${promote ? 'Promote to' : 'Change to'} ${label(to)}`,
    views: workViewsFor(to).map(v => WORK_VIEW_LABEL[v]),
    homeTools: homeToolsFor(to, isWorkspaceAdmin(to) ? MODULE_IDS : modules).map(t => t.label),
    properties,
  };
}

// When someone last signed in, in words.
export function lastSeen(iso: string | null, now = new Date()): string {
  if (!iso) return 'Never signed in';
  const minutes = Math.floor((now.getTime() - Date.parse(iso)) / 60000);
  if (minutes < 2) return 'Signed in just now';
  if (minutes < 60) return `Signed in ${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Signed in ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `Signed in ${days} day${days === 1 ? '' : 's'} ago`;
  return 'Signed in ' + new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
}

// Tools grouped by department, for the switches on each person.
const GROUP_LABEL: Record<DepartmentTone, string> = { stays: 'Stays and properties', cleans: 'Cleaning', ready: 'Ready', accounts: 'Accounts', clients: 'Owners' };
export function toolGroups(): { tone: DepartmentTone; label: string; tools: { id: ModuleId; name: string }[] }[] {
  const order: DepartmentTone[] = ['stays', 'cleans', 'ready', 'accounts', 'clients'];
  return order.map(tone => ({ tone, label: GROUP_LABEL[tone], tools: MODULE_IDS.filter(id => WORKSPACE_MAP[id].tone === tone).map(id => ({ id, name: MODULES.find(m => m.id === id)?.shortName ?? id })) }))
    .filter(g => g.tools.length);
}

// What the summary tiles count.
export function accessSummary(people: AccessPerson[]) {
  const live = people.filter(p => !p.closed);
  return { people: live.length, active: live.filter(p => p.status === 'active').length, waiting: live.filter(p => p.status === 'pending').length,
    blocked: live.filter(p => p.status === 'revoked').length, signedIn: live.filter(p => p.activeSessions > 0).length,
    online: live.filter(p => presenceOf(p.seenAt) === 'online').length };
}
export function matchesSearch(p: AccessPerson, query: string) {
  const q = query.trim().toLowerCase();
  return !q || [p.fullName, p.email ?? '', p.phone ?? '', p.role].some(v => v.toLowerCase().includes(q));
}

// Online or not: the app checks in every minute while it is open.
export function presenceText(person: Pick<AccessPerson, 'seenAt' | 'lastSignInAt'>, now = Date.now()) {
  if (presenceOf(person.seenAt, now) === 'online') return 'Online now';
  return person.seenAt ? presenceLabel(person.seenAt, now).replace(/^Active/, 'Last online') : lastSeen(person.lastSignInAt, new Date(now));
}
// Where someone is with their shift: on a pause, on overtime, or clocked in (and since when).
export function shiftStatus(shift: Shift | null): { label: string; tone: 'good' | 'wait' | 'bad' } | null {
  if (!shift || shift.clockedOutAt) return null;
  if (shift.pause) return { label: `${PAUSE_LABEL[shift.pause.kind]} since ${londonClock(shift.pause.startedAt)}`, tone: shift.pause.kind === 'emergency' ? 'bad' : 'wait' };
  if (shift.overtimeFrom) return { label: `Overtime since ${londonClock(shift.overtimeFrom)}`, tone: 'good' };
  return { label: `Clocked in since ${londonClock(shift.clockedInAt)}`, tone: 'good' };
}
