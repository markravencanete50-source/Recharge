"use client";
import { useState, type FormEvent } from "react";
import { authResponseMessage } from "@/lib/auth-security-policy";
export function UpdatePasswordForm({ available }: { available: boolean }) {
  const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setError("");
    if (data.get("password") !== data.get("confirmation")) { setError("The passwords do not match."); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/session/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: data.get("password") }) });
      const result = await authResponseMessage(response); if (!response.ok) { setError(result.error || "Could not update your password."); return; }
      form.reset();
      // Discard router state associated with the invalidated session.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/sign-in?password_reset=1");
    } catch { setError("Could not connect. Please try again later."); } finally { setSaving(false); }
  }
  return <form className="mt-6 space-y-4" onSubmit={submit}>{!available && <p role="status" className="text-sm text-muted-foreground">Open a valid reset link from your email in the browser where you requested it.</p>}<label className="block text-sm">New password<input className="field mt-2" name="password" type="password" required minLength={12} maxLength={72} autoComplete="new-password" disabled={!available} /></label><label className="block text-sm">Confirm password<input className="field mt-2" name="confirmation" type="password" required minLength={12} maxLength={72} autoComplete="new-password" disabled={!available} /></label>{error && <p role="alert" className="text-sm text-[var(--rc-danger-text)]">{error}</p>}<button className="primary-button w-full" disabled={!available || saving}>{saving ? "Updating password…" : "Update password"}</button></form>;
}
