import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfiguration } from "./supabase-server";
import { bearerToken } from "./native-request-policy";
import { uuidSchema } from "./auth-security-policy";
import { workspaceAccountSchema } from "./workspace-account-policy";
export { workspaceAccountSchema } from "./workspace-account-policy";

export function nativeProvider(accessToken?: string) {
  const config = supabaseConfiguration();
  return config ? createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(accessToken ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {}),
  }) : null;
}
export async function nativeIdentity(client: SupabaseClient, token: string) {
  const userResult = await client.auth.getUser(token);
  const claimsResult = await client.auth.getClaims(token);
  const sessionId = uuidSchema.safeParse(claimsResult.data?.claims.session_id);
  const user = userResult.data.user;
  if (userResult.error || claimsResult.error || !user?.email_confirmed_at || !user.email || !sessionId.success || claimsResult.data?.claims.sub !== user.id) return null;
  return { user, sessionId: sessionId.data };
}
export async function nativeWorkspace(request: Request) {
  const token = bearerToken(request);
  if (!token) return null;
  const client = nativeProvider(token);
  if (!client || !await nativeIdentity(client, token)) return null;
  const allowed = await client.rpc("workspace_session_allowed");
  if (allowed.error || allowed.data !== true) return null;
  const accountResult = await client.rpc("workspace_account");
  const account = workspaceAccountSchema.safeParse(accountResult.data);
  if (accountResult.error || !account.success) return null;
  return { client, account: account.data };
}
