"use client";
import { useState } from "react";
import { authResponseMessage } from "@/lib/auth-security-policy";
export function SetPasswordForm({ token }: { token: string }) {
  const [error, setError] = useState(token ? "" : "This link is incomplete. Ask the person who added you for a new one."); const [busy, setBusy] = useState(false);
  async function start() {
    if (!token || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/auth/recovery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
      const result = await authResponseMessage(response);
      if (!response.ok) { setError(result.error || "This link has expired or was already used. Ask the person who added you for a new one."); return; }
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/update-password");
    } catch { setError("Could not connect. Please try again."); } finally { setBusy(false); }
  }
  return <div className="mt-6 space-y-4">{error && <p role="alert" className="text-sm text-[var(--rc-danger-text)]">{error}</p>}<button type="button" className="primary-button w-full" disabled={!token || busy} onClick={() => void start()}>{busy ? "Opening…" : "Choose my password"}</button></div>;
}
