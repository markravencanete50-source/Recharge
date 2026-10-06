import { SignInForm } from "./sign-in-form";
import { authSecurityConfiguration } from "@/lib/auth-security";
export const dynamic = "force-dynamic";
export default function SignIn() {
  return <main className="grid min-h-dvh place-items-center p-6"><section className="w-full max-w-md rounded-3xl border border-border bg-card p-8"><p className="eyebrow">Recharge workspace</p><h1 className="mt-4 text-3xl font-semibold">Welcome back</h1><p className="mt-3 text-sm text-muted-foreground">Sign in with your verified workspace account.</p><SignInForm configured={Boolean(authSecurityConfiguration())} /><a className="mt-6 block text-sm underline" href="/reset-password">Forgot your password?</a><p className="mt-4 text-xs text-muted-foreground">Five incorrect passwords block sign-in for 24 hours. You can use email recovery to reset your password.</p></section></main>;
}
