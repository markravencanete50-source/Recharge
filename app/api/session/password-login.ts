import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { passwordDecision, providerIdentity, securityHash } from "@/lib/auth-security";
import { loginContact, type loginSchema } from "@/lib/auth-security-policy";
import { confirmedContact } from '@/lib/registration-policy';

export type PasswordLogin =
  | { ok: true }
  | { ok: false; reason: "limited" | "passwordReset" | "invalid" | "unavailable"; locked?: boolean; retryAfter?: number };

// One password sign-in behind the durable lockout guard: the guard opens an attempt, Supabase
// checks the password, and the guard records the outcome and approves the new session. Used by
// the sign-in form and straight after someone chooses a password from an emailed link.
export async function passwordLogin(client: SupabaseClient, input: z.infer<typeof loginSchema>): Promise<PasswordLogin> {
  const subject = await securityHash("password-account", loginContact(input));
  let attempt: string | undefined = crypto.randomUUID();
  try {
    const begin = await passwordDecision("auth_server_begin_password", { subject_hash: subject, attempt_id: attempt });
    if (!begin.allowed) return { ok: false, reason: "limited", locked: begin.locked, retryAfter: begin.retryAfter };
    const { error } = await client.auth.signInWithPassword(input);
    const candidate = error ? null : await providerIdentity();
    const identity = candidate && confirmedContact(candidate.user, 'phone' in input ? 'phone' : 'email', loginContact(input)) ? candidate : null;
    const invalid = error?.code === "invalid_credentials";
    const finish = await passwordDecision("auth_server_finish_password", { subject_hash: subject, attempt_id: attempt,
      outcome: identity ? "success" : invalid ? "failure" : "unavailable",
      user_id: identity?.user.id || null, session_id: identity?.sessionId || null });
    attempt = undefined;
    if (identity && finish.allowed) return { ok: true };
    // Any session Supabase opened (even one that failed the checks above) is closed again.
    if (!error) await client.auth.signOut({ scope: "local" }).catch(() => null);
    if (finish.locked) return { ok: false, reason: "limited", locked: true, retryAfter: finish.retryAfter };
    if (finish.passwordReset) return { ok: false, reason: "passwordReset" };
    return { ok: false, reason: invalid ? "invalid" : "unavailable" };
  } catch (failure) {
    if (attempt) await passwordDecision("auth_server_finish_password", { subject_hash: subject, attempt_id: attempt, outcome: "unavailable" }).catch(() => null);
    await client.auth.signOut({ scope: "local" }).catch(() => null);
    throw failure;
  }
}
