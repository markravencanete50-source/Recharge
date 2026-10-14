import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Sheet } from "./TeamFlows";
import { Button, Field, message, Notice, useRequestId } from "./LiveKit";
import { Chip } from "./SheetTable";
import { ui, type Palette } from "./theme";
import { readChat, writeChat } from "./backend/client";
import { MAX_REPORT_NOTE, blockedPeopleSchema, chatTime, inboxReportedSchema, reportedSchema, type BlockedPerson, type ChatMessage, type InboxReportSource, type ReportReason } from "../../lib/workspace-chat-policy";
import { HIDDEN_LABEL, REPORT_REASONS, REPORT_REASON_LABEL, REPORT_THANKS } from "../../lib/chat-moderation";

// Keeping Messages safe: report a message, block a person (and unblock later). Blocking is one
// person's choice and only ever hides things for them: the database withholds the blocked person's
// messages from the blocker's view, and the blocked person cannot start a new direct message with them.
const firstName = (name: string) => name.replace(/^Recharge · /, "").trim().split(/\s+/)[0] || "this person";

// The people you have blocked. Reading can fail (for example in the demo business, which has none);
// the list is then empty and blocking still reports its own errors.
export function useBlocks() {
  const [people, setPeople] = useState<BlockedPerson[] | null>(null), [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setPeople(blockedPeopleSchema.parse((await readChat({ section: "blocks" })).data)); setError(""); } catch (e) { setPeople(current => current ?? []); setError(message(e)); }
  }, []);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const ids = useMemo(() => new Set((people ?? []).map(x => x.userId)), [people]);
  const block = useCallback(async (userId: string) => { await writeChat({ action: "blockUser", userId }); await load(); }, [load]);
  const unblock = useCallback(async (userId: string) => { await writeChat({ action: "unblockUser", userId }); await load(); }, [load]);
  return { people, ids, error, reload: load, block, unblock };
}

// The sheet behind a message's menu: report it, block (or unblock) whoever wrote it. One sheet that
// moves through its steps, so only ever one is open at a time.
type Step = "menu" | "report" | "thanks" | "block" | "blocked" | "unblocked";
export function MessageSafety({ p, m, onClose, onChanged }: { p: Palette; m: ChatMessage; onClose: () => void; onChanged: () => void }) {
  const [step, setStep] = useState<Step>("menu");
  const [reason, setReason] = useState<ReportReason | null>(null), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [alreadyBlocked, setAlreadyBlocked] = useState(false);
  const name = firstName(m.authorName), who = m.authorId;
  const request = useRequestId(["report", m.id, reason ?? "", note.trim()].join(":"));
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError("");
    try { await work(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const send = () => run(async () => {
    if (!reason) { setError("Choose a reason."); return; }
    const result = reportedSchema.parse((await writeChat({ action: "reportMessage", requestId: request.get(), messageId: m.id, reason, ...(note.trim() ? { note: note.trim() } : {}) })).data);
    request.done(); setAlreadyBlocked(result.blocked); setStep("thanks");
  });
  const block = () => run(async () => { if (!who) return; await writeChat({ action: "blockUser", userId: who }); setStep("blocked"); onChanged(); });
  const unblock = () => run(async () => { if (!who) return; await writeChat({ action: "unblockUser", userId: who }); setStep("unblocked"); onChanged(); });
  const title = step === "report" ? "Report this message" : step === "thanks" ? "Report sent" : step === "block" || step === "blocked" ? `Block ${name}?` : step === "unblocked" ? `${name} is unblocked` : `Message from ${name}`;
  const preview = m.blocked ? "" : m.body.trim() || (m.attachments.length ? "Photo or video" : "");
  return (
    <Sheet palette={p} visible onClose={onClose} title={title} subtitle={step === "menu" || step === "report" ? chatTime(m.at) : undefined} icon="chat">
      {step === "menu" && <>
        {!!preview && <Text numberOfLines={4} style={[ui.body, { color: p.muted, padding: 12, borderRadius: 14, backgroundColor: p.wash }]}>{preview}</Text>}
        {!m.blocked && <Button label="Report message" icon="flag" p={p} onPress={() => setStep("report")} />}
        {!!who && (m.blocked ? <Button label={`Unblock ${name}`} icon="user-check" p={p} disabled={busy} onPress={() => void unblock()} /> : <Button label={`Block ${name}`} icon="slash" p={p} onPress={() => setStep("block")} />)}
        {!!error && <Notice text={error} p={p} tone="bad" />}
        <Button label="Cancel" p={p} onPress={onClose} />
      </>}
      {step === "report" && <ReportForm p={p} intro="An admin reviews every report. The person is not told it was you." reason={reason} note={note} busy={busy} error={error}
        onReason={r => { setReason(r); setError(""); }} onNote={setNote} onSend={() => void send()} onBack={() => { setStep("menu"); setError(""); }} />}
      {step === "thanks" && <>
        <Notice text={REPORT_THANKS} p={p} />
        {!!who && !alreadyBlocked && <Text style={[ui.small, { color: p.muted }]}>You can also stop seeing messages from {name}.</Text>}
        {!!who && !alreadyBlocked && <Button label={`Block ${name}`} icon="slash" p={p} onPress={() => setStep("block")} />}
        <Button label="Done" primary p={p} onPress={onClose} />
      </>}
      {step === "block" && <>
        <Text style={[ui.body, { color: p.text }]}>You will no longer see messages from {name}, and {name} cannot start a new direct message with you. {name} is not told, and everyone else in your conversations carries on as before.</Text>
        <Text style={[ui.small, { color: p.muted }]}>You can unblock {name} at any time from Blocked people in Profile &amp; preferences, or here.</Text>
        {!!error && <Notice text={error} p={p} tone="bad" />}
        <Button label={busy ? "Blocking…" : `Block ${name}`} icon="slash" primary p={p} disabled={busy} onPress={() => void block()} />
        <Button label="Cancel" p={p} disabled={busy} onPress={() => { setStep("menu"); setError(""); }} />
      </>}
      {step === "blocked" && <>
        <Notice text={`${name} is blocked. Their messages are hidden for you.`} p={p} />
        <Button label="Done" primary p={p} onPress={onClose} />
      </>}
      {step === "unblocked" && <>
        <Notice text={`You can see ${name}'s messages again.`} p={p} />
        <Button label="Done" primary p={p} onPress={onClose} />
      </>}
    </Sheet>
  );
}

// The report itself: a reason, an optional note, Send. Team chat and guest and client messages share it.
function ReportForm({ p, intro, reason, note, busy, error, onReason, onNote, onSend, onBack }: {
  p: Palette; intro: string; reason: ReportReason | null; note: string; busy: boolean; error: string;
  onReason: (r: ReportReason) => void; onNote: (v: string) => void; onSend: () => void; onBack: () => void;
}) {
  return (
    <>
      <Text style={[ui.small, { color: p.muted }]}>{intro}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="Reason" style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
        {REPORT_REASONS.map(r => <Chip key={r} p={p} label={REPORT_REASON_LABEL[r]} on={reason === r} onPress={() => onReason(r)} />)}
      </View>
      <Field label="Anything we should know? (optional)" value={note} onChange={v => onNote(v.slice(0, MAX_REPORT_NOTE))} p={p} multiline placeholder="For example, what happened before" />
      <Text style={[ui.small, { color: p.muted, alignSelf: "flex-end" }]}>{note.length} / {MAX_REPORT_NOTE}</Text>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Sending…" : "Send report"} icon="send" primary p={p} disabled={busy || !reason} onPress={onSend} />
      <Button label="Back" p={p} disabled={busy} onPress={onBack} />
    </>
  );
}

// The "…" beside a message someone else wrote, as in Team chat: it opens that message's menu.
export function MessageMenuButton({ p, onPress }: { p: Palette; onPress: () => void }) {
  return (
    <MotionPress accessibilityRole="button" accessibilityLabel="Report this message" onPress={onPress}
      style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", alignSelf: "center" }}>
      <Feather name="more-horizontal" size={17} color={p.muted} />
    </MotionPress>
  );
}

// A message an admin hid after a report: what the team sees in its place, as for a removed Team chat message.
export function HiddenMessage({ p }: { p: Palette }) {
  return (
    <View style={[ui.row, { gap: 8, minHeight: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderStyle: "dashed", borderColor: p.border }]}>
      <Feather name="eye-off" size={14} color={p.muted} /><Text style={{ color: p.muted, fontSize: 14, fontStyle: "italic" }}>{HIDDEN_LABEL}</Text>
    </View>
  );
}

// The menu of a message from a guest (Messages > Guests) or from someone emailing client relations (Clients): the same
// report as Team chat. There is no block: guests and email senders have no account here. Our own messages have no menu.
type InboxStep = "menu" | "report" | "thanks";
export function InboxMessageSafety({ p, source, id, from, body, at, onClose }: { p: Palette; source: InboxReportSource; id: string; from: string; body: string; at: string; onClose: () => void }) {
  const [step, setStep] = useState<InboxStep>("menu");
  const [reason, setReason] = useState<ReportReason | null>(null), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRequestId(["inbox-report", id, reason ?? "", note.trim()].join(":"));
  const send = async () => {
    if (busy) return;
    if (!reason) { setError("Choose a reason."); return; }
    setBusy(true); setError("");
    try {
      inboxReportedSchema.parse((await writeChat({ action: "reportInboxMessage", requestId: request.get(), source, messageId: id, reason, ...(note.trim() ? { note: note.trim() } : {}) })).data);
      request.done(); setStep("thanks");
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  const title = step === "report" ? "Report this message" : step === "thanks" ? "Report sent" : `Message from ${firstName(from)}`;
  return (
    <Sheet palette={p} visible onClose={onClose} title={title} subtitle={step === "thanks" ? undefined : chatTime(at)} icon={source === "guest" ? "chat" : "mail"}>
      {step === "menu" && <>
        {!!body.trim() && <Text numberOfLines={4} style={[ui.body, { color: p.muted, padding: 12, borderRadius: 14, backgroundColor: p.wash }]}>{body.trim()}</Text>}
        <Button label="Report message" icon="flag" p={p} onPress={() => setStep("report")} />
        <Button label="Cancel" p={p} onPress={onClose} />
      </>}
      {step === "report" && <ReportForm p={p} intro={`An admin reviews every report. ${source === "guest" ? "The guest" : "The sender"} is not told.`} reason={reason} note={note} busy={busy} error={error}
        onReason={r => { setReason(r); setError(""); }} onNote={setNote} onSend={() => void send()} onBack={() => { setStep("menu"); setError(""); }} />}
      {step === "thanks" && <>
        <Notice text={REPORT_THANKS} p={p} />
        <Button label="Done" primary p={p} onPress={onClose} />
      </>}
    </Sheet>
  );
}

