import { z } from 'zod';
import { WORKSPACE_MAP, type DepartmentTone } from './workspace-map';
import { MODULE_IDS, MODULES, type ModuleId } from './modules';

// Access control (super admins): the shapes read from the database, and the plain-English labels
// and groups the screen uses. The database decides what is allowed.
export const accessPersonSchema = z.object({
  userId: z.string().uuid(), fullName: z.string(), email: z.string().nullable(), phone: z.string().nullable(), role: z.string(),
  status: z.enum(['active', 'pending', 'revoked']), emailVerified: z.boolean(), joinedAt: z.string(), lastSignInAt: z.string().nullable(),
  modules: z.array(z.string()), properties: z.number(), activeSessions: z.number(), passwordRevoked: z.boolean(), closed: z.boolean(),
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
  signed_out_everywhere: 'Signed out everywhere', account_deleted: 'Account deleted',
};
export const eventLabel = (event: string) => EVENT_LABEL[event] ?? event.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

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
    blocked: live.filter(p => p.status === 'revoked').length, signedIn: live.filter(p => p.activeSessions > 0).length };
}
export function matchesSearch(p: AccessPerson, query: string) {
  const q = query.trim().toLowerCase();
  return !q || [p.fullName, p.email ?? '', p.phone ?? '', p.role].some(v => v.toLowerCase().includes(q));
}
