import { supabaseAccessAccount, supabaseAccessUsers, supabaseSaveAccess, supabaseRequestAccess } from "@/lib/supabase-access";
import type { AccessStatus, ModuleId, WorkspaceRole } from "@/lib/modules";
export type { AccessStatus, WorkspaceRole } from "@/lib/modules";
export type AccessProfile = {
  email: string;
  fullName: string;
  responsibilities: string;
  role: WorkspaceRole;
  modules: ModuleId[];
  status: AccessStatus;
};
// Identity and authority always come from verified Auth and checked Supabase
// RPCs. Missing configuration never falls back to email-based D1 privileges.
export async function getAccessAccount(email: string, displayName = ""): Promise<AccessProfile | null> {
  const account = await supabaseAccessAccount(email);
  return account ? { ...account, fullName: account.fullName || displayName } : null;
}
export async function getAccessProfile(email: string, displayName = ""): Promise<AccessProfile | null> {
  const account = await getAccessAccount(email, displayName);
  return account?.status === "active" ? account : null;
}
export async function saveAccessUser(input: Omit<AccessProfile, "status"> & { status?: AccessStatus }) {
  return supabaseSaveAccess(input);
}
export async function removeAccessUser(emailInput: string) {
  const users = await supabaseAccessUsers();
  const account = users.find(user => user.email.toLowerCase() === emailInput.trim().toLowerCase());
  if (!account) throw new Error("Account could not be found");
  return supabaseSaveAccess({ ...account, status: "revoked" });
}
export async function registerAccessRequest(input: { email: string; fullName: string; role: WorkspaceRole }): Promise<AccessProfile> {
  if (input.role === "super_admin" || input.role === "admin" || input.role === "cleaning_manager" || input.role === "accounts") throw new Error("Management and accounts roles must be assigned by an authorised administrator");
  await supabaseRequestAccess(input.fullName, input.role);
  const account = await supabaseAccessAccount(input.email);
  if (!account) throw new Error("Account request could not be loaded");
  return account;
}
