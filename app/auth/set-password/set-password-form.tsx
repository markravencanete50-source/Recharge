"use client";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
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
  return <div className="auth-form">{error && <p role="alert" className="auth-alert">{error}</p>}<button type="button" className="auth-submit" disabled={!token || busy} onClick={() => void start()}><span>{busy ? "Opening…" : "Choose my password"}</span><ArrowRight aria-hidden size={18} /></button></div>;
}
