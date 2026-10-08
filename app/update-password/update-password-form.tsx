"use client";
import { useState, type FormEvent } from "react";
import { ArrowRight, Check } from "lucide-react";
import { authResponseMessage } from "@/lib/auth-security-policy";
import { PasswordField } from "@/components/password-field";
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
export function UpdatePasswordForm({ available, email }: { available: boolean; email: string }) {
  const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState(""); const [confirmation, setConfirmation] = useState("");
  const long = password.length >= 12 && bytes(password) <= 72, same = password.length > 0 && password === confirmation;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (!long) { setError("Use at least 12 characters."); return; }
    if (!same) { setError("The passwords do not match. Press the eye to check what you typed."); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/session/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      const result = await authResponseMessage(response);
      if (!response.ok) { setError(result.error || "Could not update your password."); return; }
      setPassword(""); setConfirmation("");
      // The server signs in with the new password straight away, so the workspace opens directly.
      // A full navigation discards router state associated with the replaced session.
      window.location.assign(result.signedIn ? "/workspace" : "/sign-in?password_reset=1");
    } catch { setError("Could not connect. Please try again later."); } finally { setSaving(false); }
  }
  return <form className="auth-form" onSubmit={submit}>
    {!available && <p role="status" className="auth-note">Open a valid reset link from your email in the browser where you requested it.</p>}
    {/* Lets password managers save the new password against the right account. */}
    {email && <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />}
    {email && <p className="auth-account"><span>Account</span><strong>{email}</strong></p>}
    <PasswordField label="New password" name="password" autoComplete="new-password" minLength={12} maxLength={72} disabled={!available} value={password} onChange={setPassword} />
    <PasswordField label="Confirm password" name="confirmation" autoComplete="new-password" minLength={12} maxLength={72} disabled={!available} value={confirmation} onChange={setConfirmation} />
    <ul className="auth-checks" aria-label="Password checks">
      <li data-met={long}><Check aria-hidden size={14} />At least 12 characters</li>
      <li data-met={same}><Check aria-hidden size={14} />Both passwords match</li>
    </ul>
    {error && <p role="alert" className="auth-alert">{error}</p>}
    <button className="auth-submit" disabled={!available || saving}><span>{saving ? "Saving and signing in…" : "Save password and sign in"}</span><ArrowRight aria-hidden size={18} /></button>
  </form>;
}
