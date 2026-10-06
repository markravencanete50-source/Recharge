import { z } from "zod";
import { MODULE_IDS } from "./modules";
export const workspaceAccountSchema = z.object({
  userId: z.string().uuid(), email: z.string().nullable(), fullName: z.string(), responsibilities: z.string(),
  role: z.enum(["super_admin", "admin", "stays", "cleans", "cleaning_manager", "ready", "accounts", "client"]),
  status: z.enum(["active", "pending", "revoked"]), modules: z.array(z.enum(MODULE_IDS)),
});
export type WorkspaceAccount = z.infer<typeof workspaceAccountSchema>;
