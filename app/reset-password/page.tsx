import { AuthShell } from "@/components/auth-shell";
import { authSecurityConfiguration } from "@/lib/auth-security";
import { RecoveryForm } from "./recovery-form";
export const dynamic = "force-dynamic";
export default async function ResetPassword({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const expired = (await searchParams).expired === "1";
  return <AuthShell title="Reset your password" consent intro="We’ll email you a secure link to choose a new password. This works even while sign-in is paused."
    footer={<a href="/workspace">Back to sign in</a>}>
    {expired && <p role="alert" className="auth-alert">Your reset link has expired or could not be verified. Please request a new link.</p>}
    <RecoveryForm configured={Boolean(authSecurityConfiguration())} />
  </AuthShell>;
}
