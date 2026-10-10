import { SignOutButton } from "./sign-out-button";

export default function SignOut() {
  return <main className="grid min-h-dvh place-items-center p-6"><section className="rounded-3xl border border-border bg-card p-8"><h1 className="text-2xl font-semibold">Sign out of Recharge</h1><div className="mt-6"><SignOutButton /></div></section></main>;
}
