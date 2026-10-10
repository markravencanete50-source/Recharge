import { z } from 'zod';
import { DEFAULT_ROLE_MODULES, MODULE_IDS, type WorkspaceRole } from './modules';
import type { WorkspaceAccount } from './workspace-account-policy';

// "View as": a super admin sees the app as one of their people does, to check each role's point of
// view. Picking a person shows exactly what they see: the app sends their id with every read and
// the database answers as them (supabase/migrations/20261010270000_view_as_person.sql), read-only,
// with private chats hidden. For a role nobody has yet, the app shows that role's screens and
// tools with the super admin's own records. Either way nothing is saved while viewing.
export const VIEW_AS_HEADER = 'x-recharge-view-as';
export const VIEW_AS_ENDED = 'Viewing as this person has ended. Choose them again to carry on.';
export const VIEW_ONLY_ERROR = "Nothing can be changed while you view as someone else.";
export const VIEW_AS_ROLES: { role: Exclude<WorkspaceRole, 'super_admin'>; label: string; detail: string }[] = [
  { role: 'admin', label: 'Admin', detail: 'Management, every department' },
  { role: 'stays', label: 'Stays', detail: 'Guests, listings, pricing' },
  { role: 'cleaning_manager', label: 'Cleaning manager', detail: 'Schedule, reviews, cleaners' },
  { role: 'cleans', label: 'Cleaner', detail: 'My cleans and checklists' },
  { role: 'ready', label: 'Ready', detail: 'Repairs, visits, purchases' },
  { role: 'accounts', label: 'Accounts', detail: 'Invoices, payouts, statements' },
  { role: 'client', label: 'Owner', detail: 'The property owner’s app' },
];
export const canViewAs = (account: Pick<WorkspaceAccount, 'role' | 'status'>) => account.role === 'super_admin' && account.status === 'active';
export function viewAsLabel(role: WorkspaceRole) { return VIEW_AS_ROLES.find(r => r.role === role)?.label ?? role; }

export const viewAsPersonSchema = z.object({ userId: z.string().uuid(), fullName: z.string().max(200), role: z.enum(['admin', 'stays', 'cleaning_manager', 'cleans', 'ready', 'accounts', 'client']) });
export const viewAsPeopleSchema = z.array(viewAsPersonSchema).max(2000);
export type ViewAsPerson = z.infer<typeof viewAsPersonSchema>;
// What the super admin is looking through: one person, or a role's screens when nobody has it.
export type ViewAs = { role: Exclude<WorkspaceRole, 'super_admin'>; person: { userId: string; fullName: string } | null };
export const viewAsKey = (view: ViewAs | null) => view ? view.person?.userId ?? 'role:' + view.role : 'self';
export const viewAsName = (view: ViewAs) => view.person ? `${view.person.fullName} (${viewAsLabel(view.role)})` : `the ${viewAsLabel(view.role)} role`;

// The people to choose from, grouped by role in the picker's order.
export function viewAsGroups(people: readonly ViewAsPerson[]) {
  return VIEW_AS_ROLES.map(r => ({ ...r, people: people.filter(p => p.role === r.role).sort((a, b) => a.fullName.localeCompare(b.fullName)) }));
}

// For a role nobody has yet: that role's usual tools, on the super admin's own account.
export function previewAccount(account: WorkspaceAccount, role: WorkspaceRole | null): WorkspaceAccount {
  if (!role || role === 'super_admin' || !canViewAs(account)) return account;
  return { ...account, role, modules: role === 'admin' ? [...MODULE_IDS] : [...DEFAULT_ROLE_MODULES[role]] };
}
export const viewOnlyMessage = (view: ViewAs) =>
  `You're viewing as ${viewAsName(view)}, so nothing is saved. Switch back to your own view to make changes.`;

// Kept for this browser tab only, so a refresh stays in the same view.
const savedSchema = z.object({ role: viewAsPersonSchema.shape.role, person: z.object({ userId: z.string().uuid(), fullName: z.string().max(200) }).nullable() }).strict();
export function readSavedView(raw: string | null | undefined): ViewAs | null {
  if (!raw) return null;
  try { const parsed = savedSchema.safeParse(JSON.parse(raw)); return parsed.success ? parsed.data : null; } catch { return null; }
}
