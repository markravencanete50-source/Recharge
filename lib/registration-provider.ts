import { createClient } from "@supabase/supabase-js";
import { env } from "cloudflare:workers";
import { authSecurityConfiguration } from "./auth-security";
import { supabaseConfiguration } from "./supabase-server";

export function registrationConfiguration() {
  const security = authSecurityConfiguration();
  const settings = env as unknown as Record<string, string | undefined>;
  if (
    !security ||
    (settings.MOBILE_REGISTRATION_ENABLED ||
      process.env.MOBILE_REGISTRATION_ENABLED) !== "true"
  )
    return null;
  return {
    ...security,
    phoneEnabled:
      (settings.MOBILE_PHONE_REGISTRATION_ENABLED ||
        process.env.MOBILE_PHONE_REGISTRATION_ENABLED) === "true",
  };
}
export function registrationProvider(
  config: NonNullable<ReturnType<typeof registrationConfiguration>>,
) {
  // Public Auth client only. Never attach the server's privileged key to user requests.
  return createClient(config.url, authPublicKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
function authPublicKey() {
  // authSecurityConfiguration's `key` is privileged. Resolve the public key separately.
  const key = supabaseConfiguration()?.key;
  if (!key || key.startsWith("sb_secret_"))
    throw new Error("Public account connection unavailable");
  return key;
}
export async function saveRegistrationProfile(
  config: NonNullable<ReturnType<typeof registrationConfiguration>>,
  token: string,
  profile: { displayName: string; avatar: string },
) {
  return fetch(`${config.url}/auth/v1/user`, {
    method: "PUT",
    signal: AbortSignal.timeout(10_000),
    headers: {
      apikey: authPublicKey(),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      data: {
        display_name: profile.displayName,
        avatar_preset: profile.avatar,
      },
    }),
  });
}
