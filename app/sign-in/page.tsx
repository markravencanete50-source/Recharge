import { SignInForm } from "./sign-in-form";
import { supabaseConfiguration } from "@/lib/supabase-server";
export const dynamic = "force-dynamic";
export default function SignIn() {
  return <main className="grid min-h-dvh place-items-center p-6"><section className="w-full max-w-md rounded-3xl border border-border bg-card p-8"><p className="eyebrow">Recharge workspace</p><h1 className="mt-4 text-3xl font-semibold">Welcome back</h1><p className="mt-3 text-sm text-muted-foreground">Sign in with your verified workspace account.</p><SignInForm configured={Boolean(supabaseConfiguration())} /></section></main>;
}
