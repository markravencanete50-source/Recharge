import { SignInForm } from "./sign-in-form";
import { AuthShell } from "@/components/auth-shell";
import { authSecurityConfiguration } from "@/lib/auth-security";
export const dynamic = "force-dynamic";
export default async function SignIn({ searchParams }: { searchParams: Promise<{ password_reset?: string }> }) {
  const reset = (await searchParams).password_reset === "1";
  return <AuthShell title="Sign in" consent intro="Use the email your administrator approved for your workspace."
    footer={<><a href="/reset-password">Forgot your password?</a><p>Five incorrect passwords pause sign-in for 24 hours. Password reset stays available.</p></>}>
    {reset && <p role="status" className="auth-success">Your password is saved. Sign in with it below.</p>}
    <SignInForm configured={Boolean(authSecurityConfiguration())} />
  </AuthShell>;
}
