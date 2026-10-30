"use client";
import { useState } from "react";
import { ArrowRight } from "lucide-react";

// One button: make (or link) the account, then go on to choose a password or to sign in.
export function CreateAccount({ token, existing }: { token: string; existing: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function go() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/careers/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
      const body = (await response.json().catch(() => ({}))) as { data?: { url?: string }; error?: string };
      if (!response.ok || !body.data?.url) { setError(body.error || "Your account could not be created. Please try again."); return; }
      window.location.assign(body.data.url);
    } catch { setError("Could not connect. Please try again."); } finally { setBusy(false); }
  }
  return <div className="auth-form" style={{ marginTop: 18 }}>
    {error && <p role="alert" className="auth-alert">{error}</p>}
    <button type="button" className="auth-submit" disabled={busy} onClick={() => void go()}><span>{busy ? "One moment…" : existing ? "Add my applications and sign in" : "Create my account"}</span><ArrowRight aria-hidden size={18} /></button>
  </div>;
}
