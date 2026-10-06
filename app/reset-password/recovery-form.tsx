"use client";
import { useState, type FormEvent } from "react";
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
  return <form className="mt-6 space-y-4" onSubmit={submit}><label className="block text-sm">Email<input className="field mt-2" name="email" type="email" required autoComplete="email" maxLength={254} /></label>{!configured && <p role="status" className="text-sm text-muted-foreground">Live password recovery is awaiting a secure connection to Supabase.</p>}{status && <p role="status" className="text-sm text-muted-foreground">{status}</p>}{error && <p role="alert" className="text-sm text-[var(--rc-danger-text)]">{error}</p>}<button className="primary-button w-full" disabled={!configured || saving}>{saving ? "Requesting link…" : "Send reset link"}</button></form>;
}
