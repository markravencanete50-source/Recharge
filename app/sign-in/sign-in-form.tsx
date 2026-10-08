"use client";
import { useState, type FormEvent } from "react";
import { ArrowRight, Mail } from "lucide-react";
import { authResponseMessage } from "@/lib/auth-security-policy";
import { PasswordField } from "@/components/password-field";
export function SignInForm({ configured }: { configured: boolean }) {
  const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
      if (!response.ok) { const data = await authResponseMessage(response); setError(data.error || "Sign-in failed. Check your email, password and account verification."); return; }
      // A full navigation discards pre-login router state after cookies change.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/workspace");
    } catch { setError("Could not connect. Please try again."); } finally { setSaving(false); }
  }
  return <form className="auth-form" onSubmit={submit}>
    <div className="auth-field"><label htmlFor="sign-in-email">Email</label><div className="auth-control"><Mail aria-hidden size={17} className="auth-control-icon" /><input id="sign-in-email" name="email" type="email" required autoComplete="username" maxLength={254} placeholder="you@example.com" spellCheck={false} autoCapitalize="none" /></div></div>
    <PasswordField label="Password" name="password" autoComplete="current-password" maxLength={1024} />
    {!configured && <p role="status" className="auth-note">Live sign-in is awaiting connection to Supabase.</p>}
    {error && <p role="alert" className="auth-alert">{error}</p>}
    <button className="auth-submit" disabled={!configured || saving}><span>{saving ? "Signing in…" : "Sign in"}</span><ArrowRight aria-hidden size={18} /></button>
  </form>;
}
