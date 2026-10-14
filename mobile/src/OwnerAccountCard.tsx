import { useState } from "react";
import { View } from "react-native";
import * as Crypto from "expo-crypto";
import { Text } from "./Typography";
import { Button, Notice, Tag, message } from "./LiveKit";
import { ui, type Palette } from "./theme";
import { resendOwnerAccountEmail, viewMode } from "./backend/client";
import { ownerAccountEmailSchema, ownerAccountState, type OwnerAccountEmail } from "../../lib/owner-account";

// Proceed makes the owner's app account (migration 20261020880000). The team sees whether the owner was emailed their
// sign-in link, why no account was made, and can send the email again (or make the account when they recorded the
// owner's Proceed themselves).
export function OwnerAccountCard({ p, propertyId, email, hasAccount, onDone }: { p: Palette; propertyId: string; email: OwnerAccountEmail | null; hasAccount: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false), [note, setNote] = useState(""), [error, setError] = useState("");
  const state = ownerAccountState(email, hasAccount);
  if (!state) return null;
  const readOnly = viewMode().readOnly;
  async function send() {
    setBusy(true); setError(""); setNote("");
    try {
      const response = await resendOwnerAccountEmail(propertyId, Crypto.randomUUID()) as { data?: { state?: string } };
      setNote(response.data?.state === "sent" ? "Email sent." : response.data?.state === "skipped" ? "No account was made. See the reason above." : "Done.");
      onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <View style={{ gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }}>
      <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
        <Text style={{ color: p.text, fontWeight: "700" }}>Owner’s app account</Text>
        <Tag label={state.label} tone={state.tone} p={p} />
      </View>
      <Text style={[ui.small, { color: p.muted }]}>{state.note}</Text>
      {!readOnly && !!state.action && <Button label={busy ? "Sending…" : state.action} icon="mail" p={p} primary={state.tone !== "good"} disabled={busy} onPress={() => void send()} />}
      {!!note && <Text accessibilityLiveRegion="polite" style={[ui.small, { color: p.muted }]}>{note}</Text>}
      {!!error && <Notice text={error} p={p} tone="bad" />}
    </View>
  );
}
export const ownerAccountEmailOf = (j: unknown): OwnerAccountEmail | null => {
  const parsed = ownerAccountEmailSchema.safeParse((j as { ownerAccountEmail?: unknown } | null)?.ownerAccountEmail);
  return parsed.success ? parsed.data : null;
};
