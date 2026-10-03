import { isWorkspaceAdmin } from "@/lib/modules";
import { env } from "cloudflare:workers";
import { supabaseConfiguration } from "@/lib/supabase-server";
import { supabaseAccessAccount, supabaseAccessUsers, supabaseSaveAccess, supabaseRequestAccess } from "@/lib/supabase-access";
import {
  MODULE_IDS,
  defaultModulesForRole,
  type AccessStatus,
  type ModuleId,
  type WorkspaceRole,
} from "@/lib/modules";

export type { AccessStatus, WorkspaceRole } from "@/lib/modules";

export type AccessProfile = {
  email: string;
  fullName: string;
  responsibilities: string;
  role: WorkspaceRole;
  modules: ModuleId[];
  status: AccessStatus;
};

const OWNER_EMAIL = "enquiries@rechargestays.co.uk";
const WORKSPACE_ROLES = new Set<WorkspaceRole>([
  "super_admin",
  "admin",
  "stays",
  "cleans",
  "ready",
  "client",
]);

function database() {
  if (!env.DB) throw new Error("Recharge access database is unavailable");
  return env.DB;
}

function normaliseRole(role: string): WorkspaceRole {
  if (role === "team") return "stays";
  return WORKSPACE_ROLES.has(role as WorkspaceRole)
    ? (role as WorkspaceRole)
    : "client";
}

function ownerProfile(displayName = ""): AccessProfile {
  return {
    email: OWNER_EMAIL,
    fullName: displayName || "Recharge",
    responsibilities: "",
    role: "admin",
    modules: [...MODULE_IDS],
    status: "active",
  };
}

export async function getAccessAccount(
  email: string,
  displayName = "",
): Promise<AccessProfile | null> {
  if (supabaseConfiguration()) return supabaseAccessAccount(email);
  const normalised = email.trim().toLowerCase();
  if (normalised === OWNER_EMAIL) return ownerProfile(displayName);

  try {
    const user = await database()
      .prepare(
        "SELECT email, full_name, responsibilities, role, status FROM access_users WHERE email = ? LIMIT 1",
      )
      .bind(normalised)
      .first<{
        email: string;
        full_name: string;
        responsibilities: string;
        role: string;
        status: AccessStatus;
      }>();
    if (!user) return null;

    const role = normaliseRole(user.role);
    const permissionRows = await database()
      .prepare(
        "SELECT module_id FROM module_permissions WHERE email = ? ORDER BY module_id",
      )
      .bind(normalised)
      .all<{ module_id: ModuleId }>();

    return {
      email: user.email,
      fullName: user.full_name,
      responsibilities: user.responsibilities,
      role,
      status: user.status,
      modules:
        isWorkspaceAdmin(role)
          ? [...MODULE_IDS]
          : withRequiredRoleModules(
              role,
              permissionRows.results
                .map((row) => row.module_id)
                .filter((id): id is ModuleId => MODULE_IDS.includes(id)),
            ),
    };
  } catch (error) {
    console.error("Unable to resolve Recharge account", error);
    return null;
  }
}

export async function getAccessProfile(
  email: string,
  displayName = "",
): Promise<AccessProfile | null> {
  const account = await getAccessAccount(email, displayName);
  return account?.status === "active" ? account : null;
}

export async function listAccessUsers(): Promise<AccessProfile[]> {
  if (supabaseConfiguration()) return supabaseAccessUsers();
  const owner = ownerProfile();
  try {
    const users = await database()
      .prepare(
        "SELECT email, full_name, responsibilities, role, status FROM access_users WHERE email != ? ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, full_name, email",
      )
      .bind(OWNER_EMAIL)
      .all<{
        email: string;
        full_name: string;
        responsibilities: string;
        role: string;
        status: AccessStatus;
      }>();
    const permissions = await database()
      .prepare(
        "SELECT email, module_id FROM module_permissions ORDER BY email, module_id",
      )
      .all<{ email: string; module_id: ModuleId }>();

    return [
      owner,
      ...users.results.map((user) => {
        const role = normaliseRole(user.role);
        return {
          email: user.email,
          fullName: user.full_name,
          responsibilities: user.responsibilities,
          role,
          status: user.status,
          modules:
            isWorkspaceAdmin(role)
              ? [...MODULE_IDS]
              : withRequiredRoleModules(
                  role,
                  permissions.results
                    .filter((permission) => permission.email === user.email)
                    .map((permission) => permission.module_id)
                    .filter((id): id is ModuleId => MODULE_IDS.includes(id)),
                ),
        };
      }),
    ];
  } catch (error) {
    console.error("Unable to list Recharge access", error);
    return [owner];
  }
}

function withRequiredRoleModules(role: WorkspaceRole, modules: ModuleId[]) {
  return role === "client"
    ? Array.from(new Set<ModuleId>([...modules, "client-property-maintenance"]))
    : modules;
}

export async function saveAccessUser(input: {
  email: string;
  fullName: string;
  responsibilities: string;
  role: WorkspaceRole;
  modules: ModuleId[];
  status?: AccessStatus;
}) {
  if (supabaseConfiguration()) return supabaseSaveAccess(input);
  const email = input.email.trim().toLowerCase();
  if (email === OWNER_EMAIL) {
    throw new Error("The primary owner account cannot be changed");
  }

  const modules =
    isWorkspaceAdmin(input.role) ? [...MODULE_IDS] : Array.from(new Set(input.modules));
  const status = input.status || "active";
  const db = database();
  const statements = [
    db
      .prepare(
        "INSERT INTO access_users (email, full_name, responsibilities, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch()) ON CONFLICT(email) DO UPDATE SET full_name = excluded.full_name, responsibilities = excluded.responsibilities, role = excluded.role, status = excluded.status, updated_at = unixepoch()",
      )
      .bind(email, input.fullName.trim(), input.responsibilities.trim(), input.role, status),
    db.prepare("DELETE FROM module_permissions WHERE email = ?").bind(email),
    ...modules.map((moduleId) =>
      db
        .prepare(
          "INSERT INTO module_permissions (email, module_id, created_at) VALUES (?, ?, unixepoch())",
        )
        .bind(email, moduleId),
    ),
  ];
  await db.batch(statements);
}

export async function removeAccessUser(emailInput: string) {
  if (supabaseConfiguration()) {
    const users = await supabaseAccessUsers();
    const account = users.find(user => user.email.toLowerCase() === emailInput.trim().toLowerCase());
    if (!account) throw new Error("Account could not be found");
    return supabaseSaveAccess({ ...account, status: "revoked" });
  }
  const email = emailInput.trim().toLowerCase();
  if (email === OWNER_EMAIL) throw new Error("The primary owner account cannot be removed");
  const db = database();
  await db.batch([
    db.prepare("DELETE FROM module_permissions WHERE email = ?").bind(email),
    db.prepare("DELETE FROM access_users WHERE email = ?").bind(email),
  ]);
}

export async function registerAccessRequest(input: {
  email: string;
  fullName: string;
  role: WorkspaceRole;
}): Promise<AccessProfile> {
  if (input.role === "super_admin" || input.role === "admin") throw new Error("Privileged roles must be assigned by a super admin");
  if (supabaseConfiguration()) {
    await supabaseRequestAccess(input.fullName, input.role);
    const account = await supabaseAccessAccount(input.email);
    if (!account) throw new Error("Account request could not be loaded");
    return account;
  }
  const email = input.email.trim().toLowerCase();
  const existing = await getAccessAccount(email, input.fullName);
  if (existing) return existing;

  const status: AccessStatus = input.role === "client" ? "active" : "pending";
  const modules = defaultModulesForRole(input.role);
  const db = database();
  const statements = [
    db
      .prepare(
        "INSERT INTO access_users (email, full_name, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, unixepoch(), unixepoch())",
      )
      .bind(email, input.fullName.trim(), input.role, status),
    ...modules.map((moduleId) =>
      db
        .prepare(
          "INSERT INTO module_permissions (email, module_id, created_at) VALUES (?, ?, unixepoch())",
        )
        .bind(email, moduleId),
    ),
  ];

  try {
    await db.batch(statements);
  } catch (error) {
    const account = await getAccessAccount(email, input.fullName);
    if (account) return account;
    throw error;
  }

  return {
    email,
    fullName: input.fullName.trim(),
    responsibilities: "",
    role: input.role,
    modules,
    status,
  };
}
