"use client";
import { useState, type FormEvent } from "react";
import { ArrowRight, Mail } from "lucide-react";
import { authResponseMessage } from "@/lib/auth-security-policy";
export function RecoveryForm({ configured }: { configured: boolean }) {
  const [status, setStatus] = useState(""); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; setSaving(true); setStatus(""); setError("");
    try {
      const response = await fetch("/api/session/recovery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: new FormData(form).get("email") }) });
      const data = await authResponseMessage(response);
      if (!response.ok) { setError(data.error || "Could not request a reset. Please try again later."); return; }
      setStatus(data.message || "If this account exists, a password-reset link will be sent."); form.reset();
    } catch { setError("Could not connect. Please try again later."); } finally { setSaving(false); }
  }
  return <form className="auth-form" onSubmit={submit}>
    <div className="auth-field"><label htmlFor="recovery-email">Email</label><div className="auth-control"><Mail aria-hidden size={17} className="auth-control-icon" /><input id="recovery-email" name="email" type="email" required autoComplete="email" maxLength={254} placeholder="you@example.com" spellCheck={false} autoCapitalize="none" /></div></div>
    {!configured && <p role="status" className="auth-note">Live password recovery is awaiting a secure connection to Supabase.</p>}
    {status && <p role="status" className="auth-success">{status}</p>}
    {error && <p role="alert" className="auth-alert">{error}</p>}
    <button className="auth-submit" disabled={!configured || saving}><span>{saving ? "Requesting link…" : "Send reset link"}</span><ArrowRight aria-hidden size={18} /></button>
  </form>;
}
