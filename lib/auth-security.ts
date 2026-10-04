import { createClient } from "@supabase/supabase-js";
import { env } from "cloudflare:workers";
import { supabaseConfiguration, workspaceSupabase } from "@/lib/supabase-server";
import { uuidSchema } from "@/lib/auth-security-policy";
import { z } from "zod";
export function authSecurityConfiguration() {
  const config = supabaseConfiguration(); const settings = env as unknown as Record<string, string | undefined>;
  const key = settings.SUPABASE_SECRET_KEY || process.env.SUPABASE_SECRET_KEY;
  const salt = settings.AUTH_RATE_LIMIT_SECRET || process.env.AUTH_RATE_LIMIT_SECRET;
  const rawOrigin = settings.APP_ORIGIN || process.env.APP_ORIGIN;
  if (!config || !key?.startsWith("sb_secret_") || !salt || salt.length < 32 || !rawOrigin) return null;
  try {
    const origin = new URL(rawOrigin);
    if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || (origin.protocol !== "https:" && origin.hostname !== "127.0.0.1" && origin.hostname !== "localhost")) return null;
    return { ...config, key, salt, origin: origin.origin };
  } catch { return null; }
}
export async function securityHash(scope: string, value: string) {
  const config = authSecurityConfiguration(); if (!config) throw new Error("Security connection unavailable");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(config.salt), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(`${scope}\0${value}`));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function securityRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const config = authSecurityConfiguration(); if (!config) throw new Error("Security connection unavailable");
  // Never attach a user session to this stateless, server-only RPC client.
  const client = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const result = await client.rpc(name, args);
  if (result.error) throw new Error("Security database unavailable");
  return result.data as T;
}
const decisionSchema = z.object({ allowed: z.boolean(), locked: z.boolean().optional(), retryAfter: z.number().int().min(0).max(86400) });
export type AuthDecision = z.infer<typeof decisionSchema>;
export async function passwordDecision(name: "auth_server_begin_password" | "auth_server_finish_password", args: Record<string, unknown>) {
  return decisionSchema.parse(await securityRpc(name, args));
}
export async function requestQuota(request: Request, scope: string, maximum: number, seconds: number, identity?: string): Promise<AuthDecision> {
  // Cloudflare supplies and overwrites this header. Do not use X-Forwarded-For.
  const ip = request.headers.get("cf-connecting-ip");
  if (!identity && (!ip || !/^[0-9a-f:.]{3,64}$/i.test(ip))) throw new Error("Trusted request address unavailable");
  const bucket_hash = await securityHash(scope, identity || ip!);
  return decisionSchema.parse(await securityRpc("auth_server_rate_limit", { bucket_hash, maximum, window_seconds: seconds }));
}
export async function providerIdentity() {
  const client = await workspaceSupabase(); if (!client) return null;
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user?.email || !userData.user.email_confirmed_at) return null;
  const { data, error } = await client.auth.getClaims(); const id = uuidSchema.safeParse(data?.claims.session_id);
  if (error || !id.success || data?.claims.sub !== userData.user.id) return null;
  return { user: userData.user, sessionId: id.data };
}
export async function recoveryPhase(input: { proofHash: string; userId: string; sessionId: string; phase: "create" | "begin" | "release" | "complete"; subjectHash?: string; leaseId?: string }) {
  return await securityRpc<boolean>("auth_server_recovery", { proof_hash: input.proofHash, user_id: input.userId, session_id: input.sessionId, phase: input.phase, subject_hash: input.subjectHash || null, lease_id: input.leaseId || null }) === true;
}
