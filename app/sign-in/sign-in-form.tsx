"use client";
import { useState, type FormEvent } from "react";
export function SignInForm({ configured }: { configured: boolean }) {
  const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
      if (!response.ok) { setError("Sign-in failed. Check your email, password and account verification."); return; }
      window.location.assign("/");
    } catch { setError("Could not connect. Please try again."); } finally { setSaving(false); }
  }
  return <form className="mt-6 space-y-4" onSubmit={submit}><label className="block text-sm">Email<input className="field mt-2" name="email" type="email" required autoComplete="username" maxLength={254} /></label><label className="block text-sm">Password<input className="field mt-2" name="password" type="password" required autoComplete="current-password" maxLength={1024} /></label>{!configured && <p role="status" className="text-sm text-muted-foreground">Live sign-in is awaiting connection to Supabase.</p>}{error && <p role="alert" className="text-sm text-[var(--rc-danger-text)]">{error}</p>}<button className="primary-button w-full" disabled={!configured || saving}>{saving ? "Signing in…" : "Sign in"}</button></form>;
}
