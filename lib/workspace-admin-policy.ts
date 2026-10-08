import { z } from 'zod';
import { defaultModulesForRole, isWorkspaceAdmin, MODULE_IDS } from './modules';

// People and property administration. Authority lives in the database
// (workspace_admin_* and workspace_save_access); these are the strict shapes.
export const ROLES = ['super_admin', 'admin', 'stays', 'cleans', 'cleaning_manager', 'ready', 'accounts', 'client'] as const;
export const adminReadSchema = z.object({ section: z.enum(['people', 'properties', 'accessControl', 'accessHistory']) }).strict();
export const adminActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('saveAccess'), userId: z.string().uuid(), fullName: z.string().trim().min(2).max(200), role: z.enum(ROLES),
    status: z.enum(['active', 'pending', 'revoked']), modules: z.array(z.enum(MODULE_IDS)).max(60), responsibilities: z.string().trim().max(5000).default(''),
  }).strict(),
  // Every property at once, for team members (Hostaway imports properties with nobody assigned).
  z.object({ action: z.literal('assignAllProperties'), userId: z.string().uuid() }).strict(),
  // Access control (super admins): role and tools, and the security actions on an account.
  z.object({ action: z.literal('setAccess'), userId: z.string().uuid(), role: z.enum(ROLES), modules: z.array(z.enum(MODULE_IDS)).max(60) }).strict(),
  z.object({ action: z.enum(['block', 'unblock', 'signOut', 'revokePassword']), userId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('deleteAccount'), userId: z.string().uuid(), confirm: z.literal(true) }).strict(),
]).superRefine((value, context) => {
  if (value.action !== 'saveAccess') return;
  if (value.status === 'active' && !isWorkspaceAdmin(value.role) && !value.modules.length) context.addIssue({ code: 'custom', message: 'Select at least one tool for an active account' });
  if (value.role === 'cleans' && value.modules.some(m => !defaultModulesForRole('cleans').includes(m))) context.addIssue({ code: 'custom', message: 'Cleaners can only have their jobs, performance and invoices' });
});
export type AdminAction = z.infer<typeof adminActionSchema>;
