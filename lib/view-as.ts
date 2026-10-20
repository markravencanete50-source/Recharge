import { z } from 'zod';
import { DEFAULT_ROLE_MODULES, MODULE_IDS, type WorkspaceRole } from './modules';
import type { WorkspaceAccount } from './workspace-account-policy';

// "View as": a super admin sees the app as one of their people does, to check each role's point of
// view. Picking a person shows exactly what they see: the app sends their id with every read and
// the database answers as them (supabase/migrations/20261010270000_view_as_person.sql), read-only,
// with private chats hidden. For a role nobody has yet, the app shows that role's screens, tools and
// left panel, with the super admin's records cut down to what that role could be shown
// (previewKeeps). Either way nothing is saved while viewing. Other active super admins can be
// viewed as people too (supabase/migrations/20261025700000_view_as_super_admins.sql), never
// yourself; there is no "Super admin screens" preview, since that is just your own view.
export const VIEW_AS_HEADER = 'x-recharge-view-as';
export const VIEW_AS_ENDED = 'Viewing as this person has ended. Choose them again to carry on.';
export const VIEW_ONLY_ERROR = "Nothing can be changed while you view as someone else.";
export const VIEW_AS_ROLES: { role: WorkspaceRole; label: string; detail: string }[] = [
  { role: 'super_admin', label: 'Super admin', detail: 'The whole business' },
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

export const viewAsPersonSchema = z.object({ userId: z.string().uuid(), fullName: z.string().max(200), role: z.enum(['super_admin', 'admin', 'stays', 'cleaning_manager', 'cleans', 'ready', 'accounts', 'client']) });
export const viewAsPeopleSchema = z.array(viewAsPersonSchema).max(2000);
export type ViewAsPerson = z.infer<typeof viewAsPersonSchema>;
// What the super admin is looking through: one person, or a role's screens when nobody has it.
// A super admin can only be viewed as a person: their role's screens are your own view.
export type ViewAs = { role: WorkspaceRole; person: { userId: string; fullName: string } | null };
export const viewAsKey = (view: ViewAs | null) => view ? view.person?.userId ?? 'role:' + view.role : 'self';
export const viewAsName = (view: ViewAs) => view.person ? `${view.person.fullName} (${viewAsLabel(view.role)})` : `the ${viewAsLabel(view.role)} role`;

// The people to choose from, grouped by role in the picker's order.
export function viewAsGroups(people: readonly ViewAsPerson[]) {
  return VIEW_AS_ROLES.map(r => ({ ...r, people: people.filter(p => p.role === r.role).sort((a, b) => a.fullName.localeCompare(b.fullName)) }));
}

// For a role nobody has yet: that role's usual tools, on the super admin's own account. Never for
// super admin: that would just be your own account.
export function previewAccount(account: WorkspaceAccount, role: WorkspaceRole | null): WorkspaceAccount {
  if (!role || role === 'super_admin' || !canViewAs(account)) return account;
  return { ...account, role, modules: role === 'admin' ? [...MODULE_IDS] : [...DEFAULT_ROLE_MODULES[role]] };
}
export const viewOnlyMessage = (view: ViewAs) =>
  `You're viewing as ${viewAsName(view)}, so nothing is saved. Switch back to your own view to make changes.`;

// Kept for this browser tab only, so a refresh stays in the same view.
const savedSchema = z.object({ role: viewAsPersonSchema.shape.role, person: z.object({ userId: z.string().uuid(), fullName: z.string().max(200) }).nullable() }).strict()
  .refine(view => view.role !== 'super_admin' || view.person !== null);
export function readSavedView(raw: string | null | undefined): ViewAs | null {
  if (!raw) return null;
  try { const parsed = savedSchema.safeParse(JSON.parse(raw)); return parsed.success ? parsed.data : null; } catch { return null; }
}

// In a role preview (no person chosen) Messages reads the super admin's own list. It keeps only what someone with
// that role could have: the department channels the role is placed in when it has no rota department
// (private.chat_in_channel), owner conversations for the roles that answer owners, and the super admin's own chats.
const PREVIEW_CHANNELS: Partial<Record<WorkspaceRole, readonly string[]>> = {
  cleans: ['cleaning'], cleaning_manager: ['cleaning'], ready: ['ready'], accounts: ['accounts'], stays: ['guest_relations', 'client_relations'],
};
export function previewHasConversation(role: WorkspaceRole, conversation: { kind: string; department: string | null }): boolean {
  if (role === 'admin' || role === 'super_admin') return true;
  if (role === 'client') return false;
  if (conversation.department) return conversation.department === 'all' || (PREVIEW_CHANNELS[role] ?? []).includes(conversation.department);
  return conversation.kind !== 'owner' || role === 'stays';
}

// In a role preview (no person chosen) the records come from the super admin's own reads, which cover
// the whole business. Keep only what someone in that role could be shown, so the preview switches
// completely: work from the role's own tools, invoices only for the roles that handle them, onboarding
// journeys only for the roles that take part in them, and none of the super admin's own updates.
const JOURNEY_TOOLS = ['property-onboarding', 'new-property-inspection-board', 'clean-property-onboarding', 'onboarding-invoices'];
export function previewKeeps(role: WorkspaceRole, modules: readonly string[]) {
  const all = role === 'admin' || role === 'super_admin';
  return {
    work: (moduleId: string) => all || modules.includes(moduleId),
    invoices: all || role === 'accounts' || role === 'client',
    journeys: all || role === 'client' || modules.some(m => JOURNEY_TOOLS.includes(m)),
    notices: all,
  };
}
