import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Platform, ScrollView, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { useCelebrate } from "./Celebrate";
import { SearchPicker } from "./SearchPicker";
import { Button, message, Notice, Tag, Loading } from "./LiveKit";
import { ThreadHeader } from "./MessagesLayout";
import { HiddenMessage, InboxMessageSafety, MessageMenuButton } from "./ChatSafety";
import { emailFileLink, readChat, readClientEmail, writeClientEmail } from "./backend/client";
import { clientEmailDetailSchema, clientEmailStatus, type ClientEmailThread as Thread } from "../../lib/client-email-policy";
import { MESSAGE_STATUS_LABEL } from "../../lib/inbox-filters";
import { chatPeopleSchema, chatTime } from "../../lib/workspace-chat-policy";
import { ui, type Palette } from "./theme";

// Email to ownerrelations@ from someone who is not an owner yet, as a conversation in Messages > Clients (round 7, Session F).
// Replies go out from ownerrelations@rechargegroup.co.uk; their answer comes back here. Close and reopen; "Assign to owner" moves the
// conversation into that owner's own conversation once they have an account.

// The row in the Clients list.
export function ClientEmailRow({ p, t, active, onPress }: { p: Palette; t: Thread; active: boolean; onPress: () => void }) {
  const status = clientEmailStatus(t);
  return (
    <MotionPress accessibilityRole="button" accessibilityLabel={`${t.name ?? t.address}, email, ${MESSAGE_STATUS_LABEL[status]}`} onPress={onPress}
      style={[ui.row, { gap: 12, paddingVertical: 12, paddingHorizontal: 8, borderRadius: 14, alignItems: "flex-start", backgroundColor: active ? p.wash : "transparent" }]}>
      <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }}>
        <Feather name="mail" size={18} color={p.muted} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <View style={[ui.row, { gap: 8 }]}>
          <Text numberOfLines={1} style={{ color: p.text, fontSize: 15, fontWeight: status === "reply" ? "600" : "500", flex: 1 }}>{t.name ?? t.address}</Text>
          {!!t.lastMessageAt && <Text style={[ui.small, { color: p.muted }]}>{chatTime(t.lastMessageAt)}</Text>}
        </View>
        <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{["Email", t.subject].filter(Boolean).join(" · ")}</Text>
        {!!t.preview && <Text numberOfLines={2} style={[ui.small, { color: p.text }]}>{t.lastFrom === "out" ? "You: " : ""}{t.preview}</Text>}
        <View style={[ui.row, { gap: 6 }]}><Tag label={MESSAGE_STATUS_LABEL[status]} tone={status === "reply" ? "wait" : status === "waiting" ? "good" : "plain"} p={p} /></View>
      </View>
    </MotionPress>
  );
}

export function ClientEmailThreadPane({ p, threadId, onBack, onChanged, onAssigned }: { p: Palette; threadId: string; onBack?: () => void; onChanged: () => void; onAssigned: (conversationId: string) => void }) {
  const celebrate = useCelebrate();
  const [data, setData] = useState<ReturnType<typeof clientEmailDetailSchema.parse> | null>(null);
  const [reply, setReply] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [note, setNote] = useState("");
  const [assigning, setAssigning] = useState(false), [owners, setOwners] = useState<{ id: string; label: string }[] | null>(null), [ownerId, setOwnerId] = useState("");
  // The email whose menu is open (Report message, Session C), as in Team chat.
  const [reporting, setReporting] = useState<ReturnType<typeof clientEmailDetailSchema.parse>["messages"][number] | null>(null);
  const scroller = useRef<ScrollView>(null);
  const load = useCallback(async () => {
    try { setData(clientEmailDetailSchema.parse((await readClientEmail({ section: "thread", threadId })).data)); setError(""); }
    catch (e) { setError(message(e)); }
  }, [threadId]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void load(); });
    const timer = setInterval(() => { if (active) void load(); }, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [load]);
  useEffect(() => {
    if (!assigning || owners) return;
    readChat({ section: "people" }).then(r => setOwners(chatPeopleSchema.parse(r.data).owners.map(x => ({ id: x.userId, label: x.fullName })))).catch(e => setError(message(e)));
  }, [assigning, owners]);
  const t = data?.thread;
  // One request id per reply text, kept until it is sent, so pressing Send again never sends it twice.
  const sendId = useRef<{ text: string; id: string } | null>(null);
  async function run(action: Parameters<typeof writeClientEmail>[0], done: string, after?: (data: unknown) => void) {
    if (busy) return false;
    setBusy(true); setError(""); setNote("");
    try { const r = await writeClientEmail(action) as { data?: unknown }; celebrate(done); after?.(r.data); await load(); onChanged(); return true; }
    catch (e) { setError(message(e)); return false; } finally { setBusy(false); }
  }
  async function send() {
    const text = reply.trim();
    if (!text || !t) return;
    if (sendId.current?.text !== text) sendId.current = { text, id: Crypto.randomUUID() };
    if (await run({ action: "reply", requestId: sendId.current.id, threadId, body: text }, "Reply sent", () => { setReply(""); setNote("Emailed from ownerrelations@rechargegroup.co.uk."); })) sendId.current = null;
  }
  async function openFile(id: string) {
    setError("");
    try { await Linking.openURL((await emailFileLink(id)).url); } catch (e) { setError(message(e)); }
  }
  const status = t ? clientEmailStatus(t) : null;
  const ownerOptions = useMemo(() => owners ?? [], [owners]);
  return (
    <View style={{ gap: 12 }}>
      <ThreadHeader p={p} onBack={onBack}>
        <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }}><Feather name="mail" size={16} color={p.muted} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" numberOfLines={1} style={{ color: p.text, fontWeight: "600", fontSize: 16 }}>{t?.name ?? t?.address ?? "Email"}</Text>
          {!!t && <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{["Email", t.name ? t.address : null, t.subject].filter(Boolean).join(" · ")}</Text>}
        </View>
      </ThreadHeader>
      {!data && !error && <Loading p={p} />}
      {t && data && status && <>
        <View style={[ui.row, { gap: 8 }]}><Tag label={MESSAGE_STATUS_LABEL[status]} tone={status === "reply" ? "wait" : status === "waiting" ? "good" : "plain"} p={p} /></View>
        <ScrollView ref={scroller} style={{ maxHeight: Platform.OS === "web" ? 460 : 380 }} contentContainerStyle={{ gap: 8, paddingVertical: 4 }} onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}>
          {data.messages.map(m => {
            const team = m.direction === "out";
            return (
              <View key={m.id} style={{ alignSelf: team ? "flex-end" : "flex-start", maxWidth: "86%", gap: 3 }}>
                {m.hidden ? <HiddenMessage p={p} /> : <View style={[ui.row, { gap: 4, alignItems: "flex-end" }]}>
                  <View style={{ flexShrink: 1, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, borderBottomRightRadius: team ? 6 : 18, borderBottomLeftRadius: team ? 18 : 6, backgroundColor: team ? p.primary : p.surface, borderWidth: team ? 0 : 1, borderColor: p.border }}>
                    <Text selectable style={{ color: team ? p.onPrimary : p.text, fontSize: 14, lineHeight: 20 }}>{m.body}</Text>
                  </View>
                  {!team && <MessageMenuButton p={p} onPress={() => setReporting(m)} />}
                </View>}
                {m.files.map(file => (
                  <MotionPress key={file.id} accessibilityRole="link" accessibilityLabel={`Open ${file.filename}`} onPress={() => void openFile(file.id)}
                    style={[ui.row, { gap: 6, alignSelf: team ? "flex-end" : "flex-start", maxWidth: "100%", paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }]}>
                    <Feather name="paperclip" size={14} color={p.muted} />
                    <Text numberOfLines={1} style={[ui.small, { color: p.primary, fontWeight: "600", flexShrink: 1 }]}>{file.filename}</Text>
                  </MotionPress>
                ))}
                <Text style={[ui.small, { color: p.muted, fontSize: 11, textAlign: team ? "right" : "left" }]}>{team ? `Sent by ${m.author ?? "the team"} · ` : ""}{chatTime(m.sentAt)}</Text>
              </View>
            );
          })}
        </ScrollView>
        {t.status === "open" && <>
          <View style={{ gap: 6 }}>
            <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Your reply</Text>
            <TextInput value={reply} onChangeText={setReply} multiline placeholder="Write your reply" placeholderTextColor={p.muted} accessibilityLabel="Your reply" editable={data.canSend}
              style={{ minHeight: 88, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: p.controlBorder, color: p.text, backgroundColor: p.background, textAlignVertical: "top", fontFamily: "Montserrat_500Medium", fontSize: 14 }} />
          </View>
          {data.canSend ? <>
            <Button label={busy ? "Sending…" : "Send"} icon="send" primary p={p} disabled={busy || !reply.trim()} onPress={() => void send()} />
            <Text style={[ui.small, { color: p.muted }]}>Send emails your reply to {t.address} from ownerrelations@rechargegroup.co.uk. Their reply comes back here by itself.</Text>
          </> : <Text style={[ui.small, { color: p.muted }]}>Emailing from here is switched off. Reply from your mail app (ownerrelations@rechargegroup.co.uk).</Text>}
        </>}
        {!!note && <Notice text={note} p={p} />}
        <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
          {t.status === "open" ? <Button label="Close" icon="archive" p={p} disabled={busy} onPress={() => void run({ action: "close", threadId }, "Conversation closed")} />
            : <Button label="Reopen" icon="rotate-ccw" p={p} disabled={busy} onPress={() => void run({ action: "reopen", threadId }, "Reopened")} />}
          <Button label="Assign to owner" icon="user" p={p} disabled={busy} onPress={() => { setAssigning(!assigning); setOwnerId(""); }} />
        </View>
        {assigning && <View style={{ gap: 8, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }}>
          <Text style={[ui.small, { color: p.muted }]}>Moves this conversation into the owner’s own conversation, and their next emails go there.</Text>
          {!owners ? <Loading p={p} /> : <SearchPicker p={p} options={ownerOptions} value={ownerId} onChange={setOwnerId} placeholder="Search owner" nouns="owners" empty="No owner accounts yet. Keep replying here; assign once they have an account." />}
          <Button label={busy ? "Moving…" : "Assign"} icon="check" primary p={p} disabled={busy || !ownerId} onPress={() => void run({ action: "assign", threadId, ownerId }, "Assigned", d => { const id = (d as { conversationId?: string } | null)?.conversationId; if (id) onAssigned(id); })} />
        </View>}
      </>}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {reporting && <InboxMessageSafety key={reporting.id} p={p} source="client_email" id={reporting.id} from={t?.name ?? t?.address ?? "the sender"} body={reporting.body} at={reporting.sentAt} onClose={() => setReporting(null)} />}
    </View>
  );
}
