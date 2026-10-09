"use client";
import { useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { authResponseMessage } from "@/lib/auth-security-policy";
import { PasswordField } from "@/components/password-field";
import { ACCOUNT_DELETED, DELETE_PHRASE } from "@/lib/privacy-policy";

export function DeleteAccountForm() {
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [done, setDone] = useState(false), [phrase, setPhrase] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || phrase.trim() !== DELETE_PHRASE) return;
    setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/session/delete-account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: DELETE_PHRASE, password: form.get("password") }) });
      if (!response.ok) { setError((await authResponseMessage(response)).error || "Your account could not be deleted. Please try again."); return; }
      setDone(true);
    } catch { setError("Could not connect. Please try again."); } finally { setBusy(false); }
  }
  if (done) return <p role="status" className="auth-success">{ACCOUNT_DELETED}</p>;
  return <form className="auth-form legal-form" onSubmit={submit}>
    <div className="auth-field"><label htmlFor="delete-confirm">Type {DELETE_PHRASE} to confirm</label><div className="auth-control"><input id="delete-confirm" name="confirm" required autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={20} placeholder={DELETE_PHRASE} value={phrase} onChange={event => setPhrase(event.target.value)} /></div></div>
    <PasswordField label="Your password" name="password" autoComplete="current-password" maxLength={1024} />
    {error && <p role="alert" className="auth-alert">{error}</p>}
    <button className="auth-submit legal-danger" disabled={busy || phrase.trim() !== DELETE_PHRASE}><span>{busy ? "Deleting…" : "Delete my account"}</span><Trash2 aria-hidden size={18} /></button>
  </form>;
}
