"use client";
import { useState } from "react";

// Signs out with fetch, like the other sign-in forms. A plain form post would be sent with
// "Origin: null" (pages use Referrer-Policy: no-referrer), which the origin check rightly refuses.
export function SignOutButton() {
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  async function signOut() {
    setBusy(true); setFailed(false);
    try {
      const response = await fetch("/api/session/logout", { method: "POST", credentials: "same-origin" });
      if (!response.ok && !response.redirected) throw new Error("Sign out failed");
      window.location.assign("/sign-in");
    } catch { setFailed(true); setBusy(false); }
  }
  return (
    <>
      <button type="button" className="primary-button" disabled={busy} onClick={() => void signOut()}>{busy ? "Signing out…" : "Sign out"}</button>
      {failed && <p role="alert" className="mt-3 text-sm">Sign out didn’t finish. Check your connection and try again.</p>}
    </>
  );
}
