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

export const workspaceSupabase = cache(async () => {
  const config = supabaseConfiguration();
  if (!config) return null;
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" },
    cookies: {
      getAll: () => store.getAll(),
      setAll: values => {
        // Server Components are read-only; proxy.ts persists refresh cookies.
        try { for (const { name, value, options } of values) store.set(name, value, options); } catch { /* read-only render */ }
      },
    },
  });
});

export const verifiedWorkspaceUser = cache(async () => {
  const client = await workspaceSupabase();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  if (error || !data.user || !confirmedContact(data.user)) return null;
  const allowed = await client.rpc("workspace_session_allowed");
  return allowed.error || allowed.data !== true ? null : data.user;
});
