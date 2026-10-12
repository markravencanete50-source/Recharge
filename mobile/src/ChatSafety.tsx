import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { Sheet } from "./TeamFlows";
import { Button, Field, message, Notice, useRequestId } from "./LiveKit";
import { Chip } from "./SheetTable";
import { ui, type Palette } from "./theme";
import { readChat, writeChat } from "./backend/client";
import { MAX_REPORT_NOTE, blockedPeopleSchema, chatTime, reportedSchema, type BlockedPerson, type ChatMessage, type ReportReason } from "../../lib/workspace-chat-policy";
import { REPORT_REASONS, REPORT_REASON_LABEL, REPORT_THANKS } from "../../lib/chat-moderation";

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
      {step === "report" && <>
        <Text style={[ui.small, { color: p.muted }]}>An admin reviews every report. The person is not told it was you.</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel="Reason" style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
          {REPORT_REASONS.map(r => <Chip key={r} p={p} label={REPORT_REASON_LABEL[r]} on={reason === r} onPress={() => { setReason(r); setError(""); }} />)}
        </View>
        <Field label="Anything we should know? (optional)" value={note} onChange={v => setNote(v.slice(0, MAX_REPORT_NOTE))} p={p} multiline placeholder="For example, what happened before" />
        <Text style={[ui.small, { color: p.muted, alignSelf: "flex-end" }]}>{note.length} / {MAX_REPORT_NOTE}</Text>
        {!!error && <Notice text={error} p={p} tone="bad" />}
        <Button label={busy ? "Sending…" : "Send report"} icon="send" primary p={p} disabled={busy || !reason} onPress={() => void send()} />
        <Button label="Back" p={p} disabled={busy} onPress={() => { setStep("menu"); setError(""); }} />
      </>}
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
