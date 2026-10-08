import { cookies } from "next/headers";
import { AuthShell } from "@/components/auth-shell";
import { authSecurityConfiguration, providerIdentity } from "@/lib/auth-security";
import { RECOVERY_COOKIE, uuidSchema } from "@/lib/auth-security-policy";
import { UpdatePasswordForm } from "./update-password-form";
export const dynamic = "force-dynamic";
export default async function UpdatePassword() {
  const configured = Boolean(authSecurityConfiguration());
  const proof = uuidSchema.safeParse((await cookies()).get(RECOVERY_COOKIE)?.value);
  const identity = configured && proof.success ? await providerIdentity() : null;
  return <AuthShell title="Choose your password" welcome="Welcome."
    intro="Use at least 12 characters. Press the eye to check what you typed. Saving signs you in here and signs Recharge out on your other devices."
    footer={<a href="/reset-password">Request a new link</a>}>
    <UpdatePasswordForm available={Boolean(identity)} email={identity?.user.email ?? ""} />
  </AuthShell>;
}
