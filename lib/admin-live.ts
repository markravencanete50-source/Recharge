import { z } from "zod";
import { defaultModulesForRole, isWorkspaceAdmin, MODULE_IDS, MODULES, type ModuleId, type WorkspaceRole } from "./modules";

// Response shapes and rules for the live People, Properties and owner screens,
// shared with the tests that check them against the database.
const assignment = z.enum(["client", "cleaner", "cleaning_manager", "staff"]);
export const personSchema = z.object({
  userId: z.string().uuid(), email: z.string().nullable(), fullName: z.string(), role: z.string(), status: z.enum(["active", "pending", "revoked"]),
  responsibilities: z.string().nullable(), modules: z.array(z.string()), emailVerified: z.boolean(),
  assignments: z.array(z.object({ propertyId: z.string().uuid(), propertyName: z.string(), propertyStatus: z.string(), assignment })),
});
export const peopleSchema = z.array(personSchema);
export type Person = z.infer<typeof personSchema>;
export const adminPropertySchema = z.object({
  id: z.string().uuid(), name: z.string(), address: z.string(), region: z.string(), status: z.enum(["onboarding", "active", "archived"]), bedrooms: z.number(), version: z.number(),
  people: z.array(z.object({ userId: z.string().uuid(), fullName: z.string(), role: z.string(), status: z.string(), assignment })),
});
export const adminPropertiesSchema = z.array(adminPropertySchema);
export type AdminProperty = z.infer<typeof adminPropertySchema>;
export const detailSchemas = {
  access: z.object({ accessInstructions: z.string().optional() }),
  ota: z.object({ otaInstructions: z.string().optional() }),
  finance: z.object({ managementFeeBps: z.number().nullable().optional(), paymentNotes: z.string().nullable().optional() }),
};

export const ROLE_LABEL: Record<WorkspaceRole, string> = {
  super_admin: "Super admin", admin: "Admin", stays: "Stays", cleans: "Cleaner", cleaning_manager: "Cleaning manager", ready: "Ready", accounts: "Accounts", client: "Owner",
};
// The assignment a role takes on a property, as the database requires.
export const assignmentFor = (role: string) => role === "client" ? "client" as const : role === "cleans" ? "cleaner" as const : role === "cleaning_manager" ? "cleaning_manager" as const : "staff" as const;
// Admins manage everyone except admins; only a super admin manages admins.
export const rolesFor = (actorRole: string): WorkspaceRole[] => actorRole === "super_admin"
  ? ["super_admin", "admin", "stays", "cleaning_manager", "cleans", "ready", "accounts", "client"]
  : ["stays", "cleaning_manager", "cleans", "ready", "accounts", "client"];
export const canEdit = (actorRole: string, target: Pick<Person, "role">) => actorRole === "super_admin" || (actorRole === "admin" && !isWorkspaceAdmin(target.role));
// Tools a role may hold: cleaners are limited to their own jobs, performance and invoices.
export const toolsFor = (role: WorkspaceRole): { id: ModuleId; name: string }[] =>
  (role === "cleans" ? defaultModulesForRole("cleans") : [...MODULE_IDS]).map(id => ({ id, name: MODULES.find(m => m.id === id)?.shortName ?? id }));
// Changing role resets the tools to that role's defaults.
export const toolsOnRoleChange = (role: WorkspaceRole): ModuleId[] => isWorkspaceAdmin(role) ? [...MODULE_IDS] : defaultModulesForRole(role);
