import { useState } from "react";
import { Platform, View } from "react-native";
import * as Crypto from "expo-crypto";
import { Text } from "./Typography";
import { Button, Notice, Tag, message } from "./LiveKit";
import { ui, type Palette } from "./theme";
import { viewMode, writeEstimateLink } from "./backend/client";
import { ESTIMATE_DELIVERY_LABEL, estimateDeliveryNote, estimateDeliverySchema, type EstimateDelivery } from "../../lib/estimate-link";

// The estimate emailed with a private link (migration 20261019520000): on a journey with no owner account the team sees
// whether the current estimate has been emailed ("Estimate sent") or not ("Estimate ready"), and can email it (again)
// or copy a link to send by hand. The client opens the link without an account and decides there.
export function EstimateDeliveryCard({ p, propertyId, delivery }: { p: Palette; propertyId: string; delivery: EstimateDelivery }) {
  const [state, setState] = useState(delivery), [link, setLink] = useState(""), [busy, setBusy] = useState<"" | "email" | "link">("");
  const [note, setNote] = useState(""), [error, setError] = useState("");
  const readOnly = viewMode().readOnly;
  async function run(action: "email" | "link") {
    setBusy(action); setError(""); setNote("");
    try {
      const response = await writeEstimateLink({ action, requestId: Crypto.randomUUID(), propertyId });
      const next = estimateDeliverySchema.safeParse(response.data?.estimateDelivery);
      if (next.success) setState(next.data);
      if (action === "email") { setNote(`Emailed to ${next.success && next.data.to ? next.data.to : "the client"}.`); return; }
      const made = response.data?.link ?? "";
      setLink(made);
      try {
        if (Platform.OS === "web" && globalThis.navigator?.clipboard) { await globalThis.navigator.clipboard.writeText(made); setNote("Link copied. Paste it into your email or message. It works for 30 days."); }
        else setNote("Copy the link below and send it yourself. It works for 30 days.");
      } catch { setNote("Copy the link below and send it yourself. It works for 30 days."); }
    } catch (e) { setError(message(e)); } finally { setBusy(""); }
  }
  const status = state.status;
  return (
    <View style={{ gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }}>
      <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
        <Text style={{ color: p.text, fontWeight: "700" }}>Estimate to the client</Text>
        <Tag label={ESTIMATE_DELIVERY_LABEL[status]} tone={status === "sent" ? "good" : "wait"} p={p} />
      </View>
      <Text style={[ui.small, { color: p.muted }]}>{estimateDeliveryNote(state)}</Text>
      {!readOnly && <View style={{ gap: 8 }}>
        {!!state.to && status !== "sending" && <Button label={busy === "email" ? "Sending…" : status === "sent" ? "Resend the estimate" : "Email the estimate"} icon="mail" p={p} primary={status !== "sent"} disabled={!!busy} onPress={() => void run("email")} />}
        <Button label={busy === "link" ? "Making the link…" : "Copy link"} icon="link" p={p} primary={!state.to} disabled={!!busy} onPress={() => void run("link")} />
      </View>}
      {!!link && <View style={{ padding: 12, borderRadius: 14, backgroundColor: p.wash }}><Text selectable numberOfLines={2} style={{ color: p.text, fontSize: 12 }}>{link}</Text></View>}
      {!!note && <Text accessibilityLiveRegion="polite" style={[ui.small, { color: p.muted }]}>{note}</Text>}
      {!!error && <Notice text={error} p={p} tone="bad" />}
    </View>
  );
}
