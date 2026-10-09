import { AuthShell } from "@/components/auth-shell";
import { SetPasswordForm } from "./set-password-form";
export const dynamic = "force-dynamic";
// Opened from the one-time link a super admin shares after adding someone (Access control → Add a
// person). The link is only used when the person presses the button, so a chat app's link preview
// can't use it up.
export default async function SetPassword({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? "";
  const valid = /^[A-Za-z0-9_-]{16,256}$/.test(token);
  return <AuthShell title="Welcome to Recharge" welcome="Welcome." consent
    intro="Your account is ready. Choose your own password to finish setting it up. This link works once."
    footer={<a href="/workspace">Already set it? Sign in</a>}>
    <SetPasswordForm token={valid ? token : ""} />
  </AuthShell>;
}
