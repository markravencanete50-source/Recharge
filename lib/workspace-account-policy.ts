import { z } from "zod";
import { MODULE_IDS } from "./modules";
export const workspaceAccountSchema = z.object({
  userId: z.string().uuid(), email: z.string().nullable(), fullName: z.string(), responsibilities: z.string(),
  role: z.enum(["super_admin", "admin", "stays", "cleans", "cleaning_manager", "ready", "accounts", "client"]),
  status: z.enum(["active", "pending", "revoked"]), modules: z.array(z.enum(MODULE_IDS)),
  // Team beta: owner accounts are switched off, so the team records owners' decisions.
  teamOnly: z.boolean().optional(),
  // Your profile: a colour, a photo (its version, or null) and a line about you.
  avatar: z.enum(["forest", "sage", "ocean", "plum", "clay", "slate"]).catch("ocean").default("ocean"), photo: z.string().nullable().default(null), about: z.string().default(""),
  // Admins use every tool (the database grants them all), so their accounts carry every tool
  // even when none were ticked for them one by one.
}).transform(account => account.role === "admin" || account.role === "super_admin" ? { ...account, modules: [...MODULE_IDS] } : account);
export type WorkspaceAccount = z.infer<typeof workspaceAccountSchema>;

// Your profile: a line about you and a colour, or taking your photo off (a new photo is sent as a file).
export const AVATAR_COLOURS = ["forest", "sage", "ocean", "plum", "clay", "slate"] as const;
export const profileActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("saveProfile"), about: z.string().trim().max(160, "Keep it to 160 characters").optional(), avatar: z.enum(AVATAR_COLOURS).optional() }).strict(),
  z.object({ action: z.literal("clearPhoto") }).strict(),
]);
export type ProfileAction = z.infer<typeof profileActionSchema>;
