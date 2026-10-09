import { z } from "zod";
import { MODULE_IDS } from "./modules";
export const workspaceAccountSchema = z.object({
  userId: z.string().uuid(), email: z.string().nullable(), fullName: z.string(), responsibilities: z.string(),
  role: z.enum(["super_admin", "admin", "stays", "cleans", "cleaning_manager", "ready", "accounts", "client"]),
  status: z.enum(["active", "pending", "revoked"]), modules: z.array(z.enum(MODULE_IDS)),
  // Team beta: owner accounts are switched off, so the team records owners' decisions.
  teamOnly: z.boolean().optional(),
  // Admins use every tool (the database grants them all), so their accounts carry every tool
  // even when none were ticked for them one by one.
}).transform(account => account.role === "admin" || account.role === "super_admin" ? { ...account, modules: [...MODULE_IDS] } : account);
export type WorkspaceAccount = z.infer<typeof workspaceAccountSchema>;
