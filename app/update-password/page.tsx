import { cookies } from "next/headers";
import { authSecurityConfiguration, providerIdentity } from "@/lib/auth-security";
import { RECOVERY_COOKIE, uuidSchema } from "@/lib/auth-security-policy";
import { UpdatePasswordForm } from "./update-password-form";
export const dynamic = "force-dynamic";
export default async function UpdatePassword() {
  const configured = Boolean(authSecurityConfiguration());
  const proof = uuidSchema.safeParse((await cookies()).get(RECOVERY_COOKIE)?.value);
  const available = configured && proof.success && Boolean(await providerIdentity());
  return <main className="grid min-h-dvh place-items-center p-6"><section className="w-full max-w-md rounded-3xl border border-border bg-card p-8"><p className="eyebrow">Recharge workspace</p><h1 className="mt-4 text-3xl font-semibold">Choose a new password</h1><p className="mt-3 text-sm text-muted-foreground">Use at least 12 characters. Updating your password clears the login lockout and signs you out of Recharge on all devices.</p><UpdatePasswordForm available={available} /><a className="mt-6 block text-sm underline" href="/reset-password">Request a new reset link</a></section></main>;
}
