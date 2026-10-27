import { useCallback, useEffect, useState } from "react";
import { Switch, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { Button, Field, Loading, Notice, Tag, message, useRequestId } from "./LiveKit";
import { Sheet } from "./TeamFlows";
import { liveApi } from "./LivePages";
import { ui, type Palette } from "./theme";
import { formatMoney } from "../../lib/format";
import {
  DEFAULT_FEE_REMINDER_HOURS, FEE_LIMITS, FEE_MESSAGES, feeSettingsActionSchema, feeStage, feeViewSchema, nextReminder,
  type FeeMessageKey, type FeeSettingsAction, type FeeView,
} from "../../lib/onboarding-fee";
import { waitLabel } from "../../lib/agreement-follow-ups";

// The onboarding fee (Business Plan v1.0, migration 20261027300000). On a lead's ticket: where the fee is (orange while
// accounts prepare it or wait for payment, green once settled), the reminders sent, and the package tasks it holds or has
// released. The invoice itself moves in Accounts > Receivable. On the Leads page, for admins: the fee, the reminders and the
// messages to the owner.
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const pounds = (minor: number | null) => minor === null ? "" : formatMoney(minor);

async function readFee(propertyId?: string) {
  return feeViewSchema.parse((await liveApi("/onboarding-fee" + (propertyId ? "?propertyId=" + encodeURIComponent(propertyId) : ""))).data);
}

export function FeePanel({ p, propertyId }: { p: Palette; propertyId: string }) {
  const [view, setView] = useState<FeeView | null>(null), [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setView(await readFee(propertyId)); setError(""); } catch (err) { setError(message(err)); }
  }, [propertyId]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  const f = view?.fee;
  if (!f) return error ? <Notice text={error} p={p} tone="bad" /> : null;
  const stage = feeStage(f), next = nextReminder(f, view.settings);
  const waiting = f.held.filter(h => !h.releasedAt).length;
  return (
    <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, padding: 14, gap: 10 }]}>
      <View style={[ui.between, { gap: 8 }]}>
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>Onboarding fee</Text>
        <Tag label={stage.label} tone={stage.tone} p={p} />
      </View>
      <Text style={[ui.small, { color: p.muted }]}>
        {[f.amountMinor !== null ? pounds(f.amountMinor) : "Amount to be set by accounts", f.reference ? `Invoice ${f.reference}` : null].filter(Boolean).join(" · ")}
      </Text>
      <Row p={p} done label={`Opened in Receivable, ${when(f.openedAt)}`} />
      <Row p={p} done={!!f.sentAt} label={f.sentAt ? `Invoice sent, ${when(f.sentAt)}` : "Invoice to send (accounts)"} />
      {!!f.sentAt && !f.settledAt && <Row p={p} done={f.reminders > 0} label={`${f.reminders} payment reminder${f.reminders === 1 ? "" : "s"} sent${next ? `; next ${when(next.toISOString())}` : ""}`} />}
      <Row p={p} done={!!f.settledAt} label={f.settledAt ? `Settled, ${when(f.settledAt)}` : "Settled"} />
      {f.held.length > 0 && <Text style={[ui.small, { color: p.muted }]}>
        {waiting ? `${waiting} onboarding task${waiting === 1 ? "" : "s"} waiting for the fee: ${f.held.filter(h => !h.releasedAt).map(h => h.title).join(", ")}.`
          : `${f.released} onboarding task${f.released === 1 ? "" : "s"} released to ${f.released === 1 ? "its board" : "their boards"}.`}
      </Text>}
      <Text style={[ui.small, { color: p.muted }]}>Accounts send it and record the payment in Accounts, Receivable.</Text>
    </View>
  );
}

function Row({ p, done, label }: { p: Palette; done: boolean; label: string }) {
  return (
    <View style={[ui.row, { gap: 8 }]}>
      <Feather name={done ? "check-circle" : "circle"} size={15} color={done ? p.success : p.waiting} />
      <Text style={{ flex: 1, color: p.text, fontSize: 13 }}>{label}</Text>
    </View>
  );
}

type Draft = Omit<FeeSettingsAction, "action" | "requestId" | "amountMinor"> & { amount: string };

export function FeeSettingsSheet({ p, visible, onClose }: { p: Palette; visible: boolean; onClose: () => void }) {
  const [view, setView] = useState<FeeView | null>(null), [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  const request = useRequestId("fee-settings:" + JSON.stringify(draft));
  const fill = (v: FeeView) => {
    const s = v.settings;
    setView(v);
    setDraft({ amount: s.amountMinor === null ? "" : (s.amountMinor / 100).toFixed(2), remindersOn: s.remindersOn, reminderHours: s.reminderHours,
      signedMessage: s.signedMessage, sentMessage: s.sentMessage, reminderMessage: s.reminderMessage, settledMessage: s.settledMessage });
  };
  const load = useCallback(async () => { try { fill(await readFee()); setError(""); } catch (err) { setError(message(err)); } }, []);
  useEffect(() => { if (!visible) return; let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [visible, load]);
  const canEdit = !!view?.settings.canEdit;
  const set = (patch: Partial<Draft>) => { setSaved(false); setDraft(d => d ? { ...d, ...patch } : d); };
  async function save() {
    if (!draft) return;
    const amount = draft.amount.trim().replace(/[£,\s]/g, "");
    if (amount && !/^\d+(\.\d{1,2})?$/.test(amount)) { setError("Enter the fee in pounds, for example 495 or 495.00"); return; }
    const { amount: _amount, ...rest } = draft;
    const parsed = feeSettingsActionSchema.safeParse({ action: "saveSettings", requestId: request.get(), ...rest, amountMinor: amount ? Math.round(Number(amount) * 100) : null });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the settings"); return; }
    setBusy(true); setError("");
    try { fill(feeViewSchema.parse((await liveApi("/onboarding-fee", parsed.data)).data)); request.done(); setSaved(true); } catch (err) { setError(message(err)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title="Onboarding fee" subtitle="The fee ticket opened when an agreement is signed, and the messages to the owner" icon="chat" width={640}>
      <View style={{ gap: 14 }}>
        <Text style={[ui.small, { color: p.muted }]}>When an owner signs, a ticket opens in Accounts, Receivable for this fee (accounts can change the amount on the ticket). Once it is sent, the owner is reminded until it is settled; settling it releases the onboarding tasks. In the messages you can use {"{first_name}"}, {"{property}"}, {"{amount}"} and {"{amount_text}"} (" for £495.00", or nothing when there is no amount).</Text>
        {!draft && !error && <Loading p={p} rows={4} />}
        {draft && <>
          {canEdit ? <Field p={p} label="Onboarding fee (£, leave empty for accounts to fill in)" value={draft.amount} onChange={v => set({ amount: v.slice(0, 12) })} placeholder="495.00" />
            : <Text style={{ color: p.text, fontSize: 14 }}>{`Onboarding fee: ${draft.amount ? "£" + draft.amount : "set by accounts on each ticket"}`}</Text>}
          <View style={[ui.row, { gap: 10, alignItems: "center", flexWrap: "wrap" }]}>
            <Switch accessibilityLabel="Send payment reminders" value={draft.remindersOn} disabled={!canEdit} onValueChange={v => set({ remindersOn: v })} />
            <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>Payment reminders every</Text>
            <TextInput accessibilityLabel="Hours between reminders" editable={canEdit} keyboardType="number-pad" value={draft.reminderHours ? String(draft.reminderHours) : ""}
              onChangeText={v => set({ reminderHours: Number(v.replace(/\D/g, "").slice(0, 4)) || 0 })}
              style={{ width: 64, minHeight: 36, paddingHorizontal: 10, borderWidth: 1, borderColor: p.controlBorder, borderRadius: 10, color: p.text, backgroundColor: p.background, fontSize: 14 }} />
            <Text style={[ui.small, { color: p.muted }]}>{draft.reminderHours > 0 ? `hours (${waitLabel(draft.reminderHours)})` : "hours"}</Text>
          </View>
          {FEE_MESSAGES.map(m => canEdit
            ? <Field key={m.key} p={p} multiline label={m.label} value={draft[m.key as FeeMessageKey]} onChange={v => set({ [m.key]: v.slice(0, FEE_LIMITS.message) } as Partial<Draft>)} />
            : <View key={m.key} style={{ gap: 4 }}><Text style={[ui.label, { color: p.muted }]}>{m.label}</Text><Text selectable style={{ color: p.text, fontSize: 13, lineHeight: 19 }}>{draft[m.key as FeeMessageKey]}</Text></View>)}
        </>}
        {!!error && <Notice text={error} p={p} tone="bad" />}
        {saved && <Notice text="Saved. Signed agreements from now on use this fee and these messages." p={p} />}
        {view && !canEdit && <Notice text="Only admins can change the onboarding fee settings." p={p} />}
        {view?.settings.updatedByName && <Text style={[ui.small, { color: p.muted }]}>{`Last changed by ${view.settings.updatedByName}, ${when(view.settings.updatedAt)}.`}</Text>}
        {canEdit && draft && <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
          {draft.reminderHours !== DEFAULT_FEE_REMINDER_HOURS && <Button p={p} quiet icon="rotate-ccw" label="Back to every 48 hours" onPress={() => set({ reminderHours: DEFAULT_FEE_REMINDER_HOURS })} />}
          <Button p={p} primary icon="check" label="Save" disabled={busy} onPress={() => void save()} />
        </View>}
      </View>
    </Sheet>
  );
}
