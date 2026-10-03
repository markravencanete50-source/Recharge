import { isWorkspaceAdmin, MODULE_IDS } from "@/lib/modules";
import { verifiedWorkspaceUser, workspaceSupabase } from "@/lib/supabase-server";
import type { AccessProfile } from "@/lib/access";

function normaliseProfile(profile: AccessProfile): AccessProfile {
  return { ...profile, modules: isWorkspaceAdmin(profile.role) ? [...MODULE_IDS] : profile.modules.filter(id => MODULE_IDS.includes(id)) };
}
export async function supabaseAccessAccount(email: string): Promise<AccessProfile | null> {
  const user = await verifiedWorkspaceUser();
  if (!user || user.email?.toLowerCase() !== email.trim().toLowerCase()) return null;
  const client = await workspaceSupabase();
  const result = await client!.rpc("workspace_account");
  if (result.error || !result.data) return null;
  return normaliseProfile(result.data as AccessProfile);
}
export async function supabaseAccessUsers(): Promise<AccessProfile[]> {
  const client = await workspaceSupabase();
  if (!client || !await verifiedWorkspaceUser()) return [];
  const result = await client.rpc("workspace_accounts");
  return result.error ? [] : ((result.data || []) as AccessProfile[]).map(normaliseProfile);
}
export async function supabaseSaveAccess(input: Omit<AccessProfile, "status"> & { status?: AccessProfile["status"] }) {
  const client = await workspaceSupabase();
  if (!client || !await verifiedWorkspaceUser()) throw new Error("Verified sign-in required");
  const result = await client.rpc("workspace_save_access", {
    target_email: input.email, next_name: input.fullName, next_role: input.role,
    next_status: input.status || "active", next_modules: input.modules, next_responsibilities: input.responsibilities,
  });
  if (result.error) throw new Error(result.error.message);
}
export async function supabaseRequestAccess(fullName: string, role: AccessProfile["role"]) {
  const client = await workspaceSupabase();
  if (!client || !await verifiedWorkspaceUser()) throw new Error("Verified sign-in required");
  const result = await client.rpc("workspace_request_access", { requested_name: fullName, requested_role: role });
  if (result.error) throw new Error(result.error.message);
}
