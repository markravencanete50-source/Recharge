import { authSecurityConfiguration } from "@/lib/auth-security";
import { RecoveryForm } from "./recovery-form";
export const dynamic = "force-dynamic";
export default async function ResetPassword({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const expired = (await searchParams).expired === "1";
  return <main className="grid min-h-dvh place-items-center p-6"><section className="w-full max-w-md rounded-3xl border border-border bg-card p-8"><p className="eyebrow">Recharge workspace</p><h1 className="mt-4 text-3xl font-semibold">Reset your password</h1><p className="mt-3 text-sm text-muted-foreground">Request a secure email link. Password recovery remains available during a sign-in lockout.</p>{expired && <p role="alert" className="mt-4 text-sm text-[var(--rc-danger-text)]">Your reset link has expired or could not be verified. Please request a new link.</p>}<RecoveryForm configured={Boolean(authSecurityConfiguration())} /><a className="mt-6 block text-sm underline" href="/sign-in">Back to sign in</a></section></main>;
}
