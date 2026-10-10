import { DEFAULT_ROLE_MODULES, MODULE_IDS, type WorkspaceRole } from './modules';
import type { WorkspaceAccount } from './workspace-account-policy';

// "View as": a super admin sees the app as another role does (its Home, menus, Work views and
// tools), to check each person's point of view. Only the screens change: the database still knows
// who is signed in, so lists show the whole business, and the app saves nothing while viewing.
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

// The account the app shows while viewing as a role: that role's usual tools.
export function previewAccount(account: WorkspaceAccount, role: WorkspaceRole | null): WorkspaceAccount {
  if (!role || role === 'super_admin' || !canViewAs(account)) return account;
  return { ...account, role, modules: role === 'admin' ? [...MODULE_IDS] : [...DEFAULT_ROLE_MODULES[role]] };
}
export const viewOnlyMessage = (role: WorkspaceRole) =>
  `You're viewing as ${viewAsLabel(role)}, so nothing is saved. Switch back to your own view to make changes.`;
