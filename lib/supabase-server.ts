import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { env } from "cloudflare:workers";
import { confirmedContact } from './registration-policy';

export function supabaseConfiguration() {
  const settings = env as unknown as Record<string, string | undefined>;
  const url = settings.SUPABASE_URL || process.env.SUPABASE_URL;
  const key = settings.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

export const workspaceSupabase = cache(() => webClient());
// A super admin's "View as" read: the same web session, with the person's id for the database's
// request check (supabase/migrations/20261010270000_view_as_person.sql).
export const workspaceSupabaseViewing = (target: string) => webClient({ "x-recharge-view-as": target });

async function webClient(headers?: Record<string, string>) {
  const config = supabaseConfiguration();
  if (!config) return null;
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    ...(headers ? { global: { headers } } : {}),
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" },
    cookies: {
      getAll: () => store.getAll(),
      setAll: values => {
        // Server Components are read-only; proxy.ts persists refresh cookies.
        try { for (const { name, value, options } of values) store.set(name, value, options); } catch { /* read-only render */ }
      },
    },
  });
}

export const verifiedWorkspaceUser = cache(async () => {
  const client = await workspaceSupabase();
  if (!client) return null;
  // The user check and the session check only read, so they go out together: one wait on every request instead of two.
  // Someone not signed in is answered as before (null) even when the session check's connection fails.
  const sessionCheck = (async () => { try { return { ok: true as const, answer: await client.rpc("workspace_session_allowed") }; } catch (thrown) { return { ok: false as const, thrown }; } })();
  const [{ data, error }, check] = await Promise.all([client.auth.getUser(), sessionCheck]);
  if (error || !data.user || !confirmedContact(data.user)) return null;
  if (!check.ok) throw check.thrown;
  return check.answer.error || check.answer.data !== true ? null : data.user;
});
