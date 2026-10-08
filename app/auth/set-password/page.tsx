import { SetPasswordForm } from "./set-password-form";
export const dynamic = "force-dynamic";
// Opened from the one-time link a super admin shares after adding someone (Access control → Add a
// person). The link is only used when the person presses the button, so a chat app's link preview
// can't use it up.
export default async function SetPassword({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? "";
  const valid = /^[A-Za-z0-9_-]{16,256}$/.test(token);
  return <main className="grid min-h-dvh place-items-center p-6"><section className="w-full max-w-md rounded-3xl border border-border bg-card p-8"><p className="eyebrow">Recharge workspace</p><h1 className="mt-4 text-3xl font-semibold">Welcome to Recharge</h1><p className="mt-3 text-sm text-muted-foreground">Your account is ready. Choose your own password to finish setting it up. This link works once.</p><SetPasswordForm token={valid ? token : ""} /><a className="mt-6 block text-sm underline" href="/workspace">Already set it? Sign in</a></section></main>;
}
