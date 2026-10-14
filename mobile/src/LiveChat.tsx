import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, Platform, Pressable, ScrollView, TextInput, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import { Text } from "./Typography";
import { PropertySelect, SearchBox } from "./SearchPicker";
import { MotionPress } from "./motion";
import { Sheet } from "./TeamFlows";
import { Button, Field, Loading, message, Notice } from "./LiveKit";
import { depth, primaryFill, ui, type Palette } from "./theme";
import { readChat, readInbox, viewMode, writeChat } from "./backend/client";
import { GuestInbox } from "./LiveGuestInbox";
import { SavedReplies } from "./SavedReplies";
import { EmailUnknownSenders } from "./EmailUnknownSenders";
import { chatPeopleSchema, chatTime, conversationSchema, hasGuestInbox, messageTabs, presenceLabel, presenceOf, threadSchema, type ChatMessage, type ChatReaction, type Conversation, type MessagesTab } from "../../lib/workspace-chat-policy";
import { Attachments, ConversationAvatar, MemberFaces, MembersSheet, PendingFiles, PersonAvatar, ReactionChips, ReactionPicker, useChatUploads, useMembers } from "./ChatParts";
import { MessageSafety } from "./ChatSafety";
import { BLOCKED_LABEL, REMOVED_LABEL } from "../../lib/chat-moderation";
import { inboxListSchema } from "../../lib/guest-inbox-policy";
import { clientStatus, emptyStatusMessage, matchesSearch, statusCounts, type MessageStatus } from "../../lib/inbox-filters";
import { MessagesSplit, SearchBar, StatusFilter, ThreadHeader } from "./MessagesLayout";
import { ROLE_LABEL } from "../../lib/admin-live";
import { previewHasConversation } from "../../lib/view-as";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import type { PropertyView } from "../../lib/workspace-view";
import { z } from "zod";

// Messages, laid out like a messenger (Lee, round 5): at most three tabs, Guests (the guest inbox, for people with the
// guest communication tool), Clients (each owner's conversation with Recharge) and Team (one-to-one, group and
// department conversations). One search box per tab; Guests and Clients filter by Needs a reply, Engaged
// and Closed. A conversation opens in place: beside the list on a wide screen, full screen with a back arrow on a phone.
// Owners only see their conversation with Recharge. While a conversation is open it checks for new messages every few
// seconds; the list refreshes by itself. Nothing here animates by itself.
const LIST_EVERY = 15000, THREAD_EVERY = 3000, GUESTS_EVERY = 60000;
type Tab = MessagesTab;
const TAB_LABEL: Record<Tab, string> = { guests: "Guests", clients: "Clients", team: "Team" };
const tabOf = (c: Conversation): Tab => c.kind === "owner" ? "clients" : "team";
const roleName = (role: string) => ROLE_LABEL[role as keyof typeof ROLE_LABEL] ?? role;

function useVisiblePoll(run: () => void, every: number, active: boolean) {
  const latest = useRef(run);
  useEffect(() => { latest.current = run; }, [run]);
  useEffect(() => {
    if (!active) return;
    const tick = () => { if (AppState.currentState === "active" && (Platform.OS !== "web" || typeof document === "undefined" || document.visibilityState === "visible")) latest.current(); };
    const timer = setInterval(tick, every);
    return () => clearInterval(timer);
  }, [every, active]);
}

// Guests waiting for a reply, for the Messages badge and the Guests tab. Read once a minute, and
// only for people with the guest inbox. Null until the first read.
export function useGuestWaiting(account: WorkspaceAccount) {
  const enabled = hasGuestInbox(account);
  const [waiting, setWaiting] = useState<number | null>(null);
  const load = useCallback(async () => {
    if (!enabled) return;
    try { setWaiting(inboxListSchema.parse((await readInbox({ section: "list", status: "waiting" })).data).waiting); } catch { /* the count stays as it was */ }
  }, [enabled]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  useVisiblePoll(() => void load(), GUESTS_EVERY, enabled);
  return { waiting: enabled ? waiting : 0, reload: load };
}

function ConversationRow({ p, c, active, onPress }: { p: Palette; c: Conversation; active: boolean; onPress: () => void }) {
  return (
    <MotionPress accessibilityRole="button" accessibilityLabel={`${c.title}${c.unread ? `, ${c.unread} unread` : ""}`} onPress={onPress}
      style={[ui.row, { gap: 12, padding: 12, borderRadius: 16, backgroundColor: active ? p.wash : "transparent" }]}>
      <ConversationAvatar p={p} c={c} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={[ui.row, { gap: 8 }]}>
          <Text numberOfLines={1} style={{ color: p.text, fontWeight: c.unread ? "600" : "500", flex: 1 }}>{c.title}</Text>
          {!!c.last && <Text style={[ui.small, { color: c.unread ? p.primary : p.muted }]}>{chatTime(c.last.at)}</Text>}
        </View>
        <View style={[ui.row, { gap: 8 }]}>
          <Text numberOfLines={1} style={[ui.small, { color: c.unread ? p.text : p.muted, flex: 1, fontWeight: c.unread ? "600" : "400" }]}>
            {c.last ? c.last.kind === "event" ? `${c.last.authorName} ${c.last.body}` : `${c.kind !== "direct" || c.last.authorName === "You" ? c.last.authorName + ": " : ""}${c.last.body}` : c.propertyName ? `About ${c.propertyName}` : c.subtitle ?? "No messages yet"}
          </Text>
          {c.unread > 0 && <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: p.primary, alignItems: "center", justifyContent: "center" }}><Text style={{ color: p.surface, fontSize: 12, fontWeight: "600" }}>{c.unread > 99 ? "99+" : c.unread}</Text></View>}
        </View>
      </View>
    </MotionPress>
  );
}

function Bubble({ p, m, showName, readOnly, reacting, onReacting, onReact, onSafety }: { p: Palette; m: ChatMessage; showName: boolean; readOnly: boolean; reacting: boolean; onReacting: (open: boolean) => void; onReact: (emoji: string) => void; onSafety: () => void }) {
  // A line about the group ("Fiona added Isla"), in the middle.
  if (m.kind === "event") return <Text style={[ui.small, { color: p.muted, textAlign: "center", paddingVertical: 4 }]}>{m.authorName} {m.body} · {chatTime(m.at)}</Text>;
  const mine = m.mine, words = m.body.trim().length > 0, current = m.reactions.find(r => r.mine)?.emoji ?? null;
  // Taken down by an admin: for everyone, including whoever wrote it.
  if (m.removed) return (
    <View style={{ alignItems: mine ? "flex-end" : "flex-start", gap: 3 }}>
      <View style={[ui.row, { gap: 8, marginLeft: mine ? 0 : 38, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, borderWidth: 1, borderStyle: "dashed", borderColor: p.border }]}>
        <Feather name="slash" size={14} color={p.muted} /><Text style={{ color: p.muted, fontSize: 14, fontStyle: "italic" }}>{REMOVED_LABEL}</Text>
      </View>
      <Text style={{ color: p.muted, fontSize: 11, marginHorizontal: mine ? 6 : 44 }}>{chatTime(m.at)}</Text>
    </View>
  );
  // From someone you blocked: collapsed, with a way to unblock them.
  if (m.blocked) return (
    <MotionPress accessibilityRole="button" accessibilityLabel={`${BLOCKED_LABEL}. ${readOnly ? "" : "Options"}`} disabled={readOnly} onPress={onSafety}
      style={[ui.row, { gap: 8, alignSelf: "flex-start", marginLeft: 38, minHeight: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderStyle: "dashed", borderColor: p.border }]}>
      <Feather name="eye-off" size={14} color={p.muted} /><Text style={{ color: p.muted, fontSize: 14, fontStyle: "italic" }}>{BLOCKED_LABEL}</Text>
      {!readOnly && <Text style={{ color: p.primary, fontSize: 12, fontWeight: "600" }}>Options</Text>}
    </MotionPress>
  );
  const react = !readOnly && (
    <View {...(Platform.OS === "web" ? { dataSet: { chatTools: "true" } } : {})} style={{ alignSelf: "center", flexDirection: "row" }}>
      <MotionPress accessibilityRole="button" accessibilityLabel="React to this message" onPress={() => onReacting(!reacting)}
        style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: reacting ? p.wash : "transparent" }}>
        <Feather name="smile" size={17} color={p.muted} />
      </MotionPress>
      {!mine && <MotionPress accessibilityRole="button" accessibilityLabel="Report this message or block the sender" onPress={onSafety}
        style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" }}>
        <Feather name="more-horizontal" size={17} color={p.muted} />
      </MotionPress>}
    </View>
  );
  return (
    <View style={{ alignItems: mine ? "flex-end" : "flex-start", gap: 3 }}>
      {showName && !mine && <Text style={[ui.small, { color: p.muted, fontWeight: "600", marginLeft: 44 }]}>{m.authorName}</Text>}
      {reacting && <View style={{ marginLeft: mine ? 0 : 38 }}><ReactionPicker p={p} current={current} onPick={e => { onReacting(false); onReact(e); }} onMore={mine || readOnly ? undefined : () => { onReacting(false); onSafety(); }} /></View>}
      <View {...(Platform.OS === "web" ? { dataSet: { chatRow: "true" } } : {})} style={[ui.row, { gap: 6, alignItems: "flex-end", width: "100%", flexDirection: mine ? "row-reverse" : "row" }]}>
        {!mine && <PersonAvatar p={p} name={m.authorName} userId={m.authorId} photo={m.authorPhoto} size={30} />}
        <Pressable onLongPress={readOnly ? undefined : () => onReacting(true)} delayLongPress={350} style={{ maxWidth: "78%", gap: 4, alignItems: mine ? "flex-end" : "flex-start" }}>
          {!!m.attachments.length && <Attachments p={p} items={m.attachments} mine={mine} />}
          {words && <View style={[{ paddingHorizontal: 15, paddingVertical: 10, borderRadius: 20, borderBottomRightRadius: mine ? 6 : 20, borderBottomLeftRadius: mine ? 20 : 6, borderWidth: mine ? 0 : 1, borderColor: p.border }, mine ? primaryFill(p) : { backgroundColor: p.surface, ...depth.card }]}>
            <Text selectable style={{ color: mine ? p.onPrimary : p.text, fontSize: 15, lineHeight: 21 }}>{m.body}</Text>
          </View>}
        </Pressable>
        {react}
      </View>
      <View style={{ marginHorizontal: mine ? 0 : 38 }}><ReactionChips p={p} reactions={m.reactions} mine={mine} onToggle={e => { if (!readOnly) onReact(e); }} /></View>
      <Text style={{ color: p.muted, fontSize: 11, marginHorizontal: mine ? 6 : 44 }}>{chatTime(m.at)}</Text>
    </View>
  );
}

function Thread({ p, id, onBack, onChanged, onOpen, onLeft, savedReplies = false }: { p: Palette; id: string; onBack?: () => void; onChanged: () => void; onOpen: (c: Conversation) => void; onLeft: () => void; savedReplies?: boolean }) {
  const [thread, setThread] = useState<z.infer<typeof threadSchema> | null>(null);
  const [text, setText] = useState(""), [sending, setSending] = useState(false), [error, setError] = useState("");
  const [reacting, setReacting] = useState<string | null>(null), [people, setPeople] = useState(false), [safety, setSafety] = useState<ChatMessage | null>(null);
  const [readOnly] = useState(() => viewMode().readOnly);
  const narrow = useWindowDimensions().width < 560;
  const files = useChatUploads(id);
  const { members, reload: reloadMembers } = useMembers(id);
  const scroll = useRef<ScrollView>(null), lastSeen = useRef("");
  const load = useCallback(async () => {
    try {
      const parsed = threadSchema.parse((await readChat({ section: "messages", conversationId: id })).data);
      setThread(parsed); setError("");
      const newest = parsed.messages.at(-1)?.id ?? "";
      if (newest !== lastSeen.current) {
        lastSeen.current = newest;
        if (parsed.conversation.unread) { await writeChat({ action: "markRead", conversationId: id }).catch(() => undefined); onChanged(); }
        setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
      }
    } catch (e) { setError(message(e)); }
  }, [id, onChanged]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  useVisiblePoll(() => void load(), THREAD_EVERY, true);
  // Reactions show straight away, then the conversation's own copy replaces them.
  async function react(messageId: string, emoji: string) {
    const toggle = (list: ChatReaction[]): ChatReaction[] => {
      const had = list.find(r => r.mine)?.emoji, out = list.map(r => r.mine ? { ...r, count: r.count - 1, mine: false, names: r.names.filter(n => n !== "You") } : r).filter(r => r.count > 0);
      if (had === emoji) return out;
      const at = out.find(r => r.emoji === emoji);
      return at ? out.map(r => r === at ? { ...r, count: r.count + 1, mine: true, names: [...r.names, "You"] } : r) : [...out, { emoji, count: 1, mine: true, names: ["You"] }];
    };
    setThread(t => t && { ...t, messages: t.messages.map(m => m.id === messageId ? { ...m, reactions: toggle(m.reactions) } : m) });
    try { await writeChat({ action: "react", messageId, emoji: emoji as never }); } catch (e) { setError(message(e)); }
    void load();
  }
  // A ref (not state) guards against a second tap or Enter in the same instant, and the request id is
  // kept until the message is sent, so a retry after a timeout never posts it twice.
  const inFlight = useRef(false), pending = useRef<{ key: string; requestId: string } | null>(null);
  const canSend = (text.trim().length > 0 || files.ready.length > 0) && !files.uploading && !files.failed && !sending;
  async function send() {
    const body = text.trim(), attachments = files.ready;
    if ((!body && !attachments.length) || files.uploading || files.failed || inFlight.current) return;
    inFlight.current = true; setSending(true); setError("");
    const key = body + "|" + attachments.join();
    if (pending.current?.key !== key) pending.current = { key, requestId: Crypto.randomUUID() };
    try {
      await writeChat({ action: "send", requestId: pending.current.requestId, conversationId: id, body, ...(attachments.length ? { attachments } : {}) });
      pending.current = null; setText(""); files.clear(); await load(); onChanged();
    }
    catch (e) { setError(message(e)); } finally { inFlight.current = false; setSending(false); }
  }
  async function attach() { setError(""); const problem = await files.pick().catch(e => message(e)); if (problem) setError(problem); }
  const c = thread?.conversation;
  // The team's side of an owner conversation can be closed (the Clients tab's Closed); any new message reopens it.
  const teamOwnerView = c?.kind === "owner" && c.title !== "Recharge";
  const [closing, setClosing] = useState(false);
  async function setClosed(closed: boolean) {
    if (closing) return;
    setClosing(true); setError("");
    try { await writeChat({ action: "closeConversation", conversationId: id, closed }); await load(); onChanged(); }
    catch (e) { setError(message(e)); } finally { setClosing(false); }
  }
  const seen = c?.kind === "direct" ? presenceLabel(c.peer?.seenAt) : "";
  const subtitle = c ? [seen || c.subtitle, c.propertyName ? `About ${c.propertyName}` : null].filter(Boolean).join(" · ") || (c.kind === "owner" ? "Owner conversation" : "Direct message") : "";
  return (
    <View style={{ flex: 1, minHeight: 420, gap: 10 }}>
      <View style={[ui.row, { gap: 10, paddingBottom: 10, borderBottomWidth: 1, borderColor: p.border }]}>
        {onBack && <MotionPress accessibilityRole="button" accessibilityLabel="Back to messages" onPress={onBack} style={{ minWidth: 40, minHeight: 40, alignItems: "center", justifyContent: "center" }}><Feather name="arrow-left" size={21} color={p.text} /></MotionPress>}
        {c && <MotionPress accessibilityRole="button" accessibilityLabel="See who is in this conversation" onPress={() => setPeople(true)}><ConversationAvatar p={p} c={c} /></MotionPress>}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: p.text, fontWeight: "600", fontSize: 16 }}>{c?.title ?? "…"}</Text>
          {!!c && <Text numberOfLines={1} style={[ui.small, { color: presenceOf(c.peer?.seenAt) === "online" && c.kind === "direct" ? p.success : p.muted }]}>{subtitle}</Text>}
        </View>
        {c && members && c.kind !== "direct" && !(c.kind === "owner" && c.title === "Recharge") && <MemberFaces p={p} members={members} compact={narrow} onPress={() => setPeople(true)} />}
        {c && teamOwnerView && !readOnly && <MotionPress accessibilityRole="button" accessibilityLabel={c.closed ? "Reopen this conversation" : "Close this conversation"} disabled={closing} onPress={() => void setClosed(!c.closed)}
          style={[ui.row, { gap: 6, minHeight: 36, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: p.border }]}>
          <Feather name={c.closed ? "rotate-ccw" : "archive"} size={14} color={p.text} /><Text style={{ color: p.text, fontSize: 13 }}>{c.closed ? "Reopen" : "Close"}</Text>
        </MotionPress>}
        {c && c.kind === "direct" && !readOnly && <MotionPress accessibilityRole="button" accessibilityLabel="Add people (starts a group)" onPress={() => setPeople(true)} style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: p.border }}><Feather name="user-plus" size={17} color={p.text} /></MotionPress>}
      </View>
      <ScrollView ref={scroll} style={{ flex: 1, maxHeight: Platform.OS === "web" ? 560 : undefined }} contentContainerStyle={{ gap: 10, paddingVertical: 6 }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
        {!thread ? <Loading p={p} rows={2} /> : thread.messages.length ? thread.messages.map(m => <Bubble key={m.id} p={p} m={m} showName={c?.kind !== "direct"} readOnly={readOnly} reacting={reacting === m.id} onReacting={on => setReacting(on ? m.id : null)} onReact={e => void react(m.id, e)} onSafety={() => setSafety(m)} />)
          : <Text style={[ui.small, { color: p.muted, textAlign: "center", paddingVertical: 24 }]}>{c?.kind === "owner" && c.title === "Recharge" ? "Ask us anything about your property." : c?.department ? (c.department === "all" ? "Everyone on the team can read and write here." : `Everyone in ${c.title} can read and write here. Admins can read it too.`) : "Say hello."}</Text>}
      </ScrollView>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {savedReplies && c?.kind === "owner" && <SavedReplies p={p} audience="owner" fill={{ name: c.title, property: c.propertyName }} onInsert={reply => setText(current => current.trim() ? current.trimEnd() + "\n\n" + reply : reply)} />}
      <PendingFiles p={p} items={files.items} onRemove={files.remove} onRetry={files.retry} />
      <View style={[ui.row, { gap: 8, alignItems: "flex-end" }]}>
        {!readOnly && <MotionPress accessibilityRole="button" accessibilityLabel="Add photos or a video (up to 5 photos and 1 video of 50 MB)" onPress={() => void attach()}
          style={{ width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: p.wash }}>
          <Feather name="image" size={19} color={p.primary} />
        </MotionPress>}
        <TextInput value={text} onChangeText={setText} placeholder={files.items.length ? "Add a message (optional)" : "Write a message"} placeholderTextColor={p.muted} multiline maxLength={4000} accessibilityLabel="Message"
          onKeyPress={e => { const key = e.nativeEvent as unknown as { key: string; shiftKey?: boolean }; if (Platform.OS === "web" && key.key === "Enter" && !key.shiftKey) { (e as unknown as { preventDefault: () => void }).preventDefault(); void send(); } }}
          style={{ flex: 1, minHeight: 46, maxHeight: 140, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 18, borderWidth: 1, borderColor: p.controlBorder, backgroundColor: p.background, color: p.text, fontFamily: "Montserrat_500Medium", fontSize: 15 }} />
        <MotionPress accessibilityRole="button" accessibilityLabel={files.uploading ? "Send (waiting for uploads)" : "Send"} disabled={!canSend} onPress={() => void send()}
          style={[{ width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" }, canSend ? primaryFill(p) : { backgroundColor: p.wash }]}>
          <Feather name="send" size={19} color={canSend ? p.onPrimary : p.muted} />
        </MotionPress>
      </View>
      {safety && <MessageSafety key={safety.id} p={p} m={safety} onClose={() => setSafety(null)} onChanged={() => { void load(); onChanged(); }} />}
      {people && c && <MembersSheet p={p} conversation={c} members={members} onClose={() => setPeople(false)} onChanged={() => { void reloadMembers(); void load(); onChanged(); }}
        onLeft={() => { setPeople(false); onLeft(); }} onOpen={next => { setPeople(false); onOpen(next); }} />}
    </View>
  );
}

function NewConversation({ p, properties, only, onClose, onOpen }: { p: Palette; properties: PropertyView[]; only?: "team" | "owners"; onClose: () => void; onOpen: (c: Conversation) => void }) {
  const [people, setPeople] = useState<z.infer<typeof chatPeopleSchema> | null>(null);
  const [picked, setPicked] = useState<string[]>([]), [title, setTitle] = useState(""), [propertyId, setPropertyId] = useState(""), [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { readChat({ section: "people" }).then(r => setPeople(chatPeopleSchema.parse(r.data))).catch(e => setError(message(e))); }, []);
  async function start(action: Parameters<typeof writeChat>[0]) {
    setBusy(true); setError("");
    try { onOpen(conversationSchema.parse((await writeChat(action)).data)); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const match = (name: string) => name.toLowerCase().includes(query.trim().toLowerCase());
  const team = only === "owners" ? [] : (people?.team ?? []).filter(x => match(x.fullName)), owners = only === "team" ? [] : (people?.owners ?? []).filter(x => match(x.fullName));
  const group = picked.length > 1;
  return (
    <Sheet palette={p} visible onClose={onClose} title="New message" subtitle={only === "owners" ? "Choose an owner you look after" : "Choose one person, or several to start a group chat"} icon="people">
      <SearchBox p={p} value={query} onChange={setQuery} placeholder="Search by name" label="Search people" />
      {!people && !error && <Loading p={p} />}
      {people && !team.length && !owners.length && <Text style={[ui.small, { color: p.muted }]}>{query.trim() ? "Nobody matches." : only === "owners" ? "No owners to message yet. You can message the owners of the properties you look after." : "Nobody to message yet."}</Text>}
      {!!team.length && <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Team</Text>}
      {team.map(x => {
        const on = picked.includes(x.userId);
        return (
          <MotionPress key={x.userId} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => setPicked(on ? picked.filter(y => y !== x.userId) : [...picked, x.userId])}
            style={[ui.row, { gap: 12, minHeight: 52, paddingHorizontal: 12, borderRadius: 14, backgroundColor: on ? p.wash : p.elevated }]}>
            <PersonAvatar p={p} name={x.fullName} userId={x.userId} photo={x.photo} size={34} online={presenceOf(x.seenAt) === "online"} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: p.text, fontWeight: "600" }}>{x.fullName}</Text>
              <Text numberOfLines={1} style={[ui.small, { color: presenceOf(x.seenAt) === "online" ? p.success : p.muted }]}>{[roleName(x.role), presenceLabel(x.seenAt) || null].filter(Boolean).join(" · ")}</Text>
            </View>
            <Feather name={on ? "check-circle" : "circle"} size={20} color={on ? p.primary : p.muted} />
          </MotionPress>
        );
      })}
      {group && <>
        <Field label="Group name (optional)" value={title} onChange={setTitle} p={p} placeholder="Leave empty to name it after its people" />
        {!!properties.length && <View style={{ gap: 6 }}>
          <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>About a property (optional)</Text>
          <PropertySelect p={p} properties={properties} value={propertyId} onChange={setPropertyId} clearable empty="" />
        </View>}
      </>}
      {!!picked.length && <Button label={busy ? "Starting…" : group ? `Start group with ${picked.length} people` : "Start conversation"} icon="message-circle" primary p={p} disabled={busy || (group && title.trim().length === 1)}
        onPress={() => void start(group ? { action: "startGroup", ...(title.trim() ? { title: title.trim() } : {}), userIds: picked, ...(propertyId ? { propertyId } : {}) } : { action: "startDirect", userId: picked[0] })} />}
      {!!owners.length && <>
        <Text style={[ui.small, { color: p.muted, fontWeight: "600", paddingTop: 6 }]}>Owners you look after</Text>
        {owners.map(x => <MotionPress key={x.userId} accessibilityRole="button" onPress={() => void start({ action: "startOwner", ownerId: x.userId })}
          style={[ui.row, { gap: 12, minHeight: 52, paddingHorizontal: 12, borderRadius: 14, backgroundColor: p.elevated }]}>
          <PersonAvatar p={p} name={x.fullName} userId={x.userId} photo={x.photo} size={34} online={presenceOf(x.seenAt) === "online"} /><Text style={{ color: p.text, flex: 1, fontWeight: "600" }}>{x.fullName}</Text><Feather name="chevron-right" size={18} color={p.muted} />
        </MotionPress>)}
      </>}
      {!!error && <Notice text={error} p={p} tone="bad" />}
    </Sheet>
  );
}

export function LiveChat({ palette: p, account, desktop, properties, onUnread, guestWaiting = 0, openConversation, updates, initialTab }: { palette: Palette; account: WorkspaceAccount; desktop: boolean; properties: PropertyView[]; onUnread: () => void; guestWaiting?: number | null; openConversation?: string; updates?: ReactNode; initialTab?: "updates" }) {
  const owner = account.role === "client", guests = hasGuestInbox(account);
  // While a super admin views as someone nothing can be started or saved. A role preview (no person) reads the super admin's
  // own Messages, so it keeps only what that role could have (lib/view-as.ts). The workspace remounts when the view changes.
  const [mode] = useState(viewMode), preview = mode.readOnly && !mode.person ? account.role : null;
  const [list, setList] = useState<Conversation[] | null>(null), [open, setOpen] = useState<string | null>(openConversation ?? null), [creating, setCreating] = useState(false), [error, setError] = useState("");
  const loadList = useCallback(async () => {
    try {
      const all = z.array(conversationSchema).parse((await readChat({ section: "list" })).data);
      setList(preview ? all.filter(c => previewHasConversation(preview, c)) : all); setError("");
    } catch (e) { setError(message(e)); }
  }, [preview]);
  // Owners go straight to their conversation with Recharge.
  useEffect(() => {
    queueMicrotask(() => {
      // The team channels are made the first time anyone on the team opens Messages.
      if (owner || mode.readOnly) void loadList(); else writeChat({ action: "openTeams" }).catch(() => undefined).finally(() => void loadList());
      if (owner && !mode.readOnly) writeChat({ action: "startOwner" }).then(r => setOpen(conversationSchema.parse(r.data).id)).catch(e => setError(message(e)));
    });
  }, [loadList, owner, mode.readOnly]);
  // Viewing as an owner: open the conversation they already have with Recharge, if any (starting one would be a change).
  const ownerThread = owner && mode.person ? list?.find(c => c.kind === "owner")?.id ?? null : null;
  useEffect(() => { if (ownerThread && !open) queueMicrotask(() => setOpen(ownerThread)); }, [ownerThread, open]);
  useVisiblePoll(() => void loadList(), LIST_EVERY, !owner);
  const changed = useCallback(() => { void loadList(); onUnread(); }, [loadList, onUnread]);
  // Three tabs at most: Guests for the guest inbox, Clients for the people who answer owners, Team for everything else
  // (the department channels are ordinary conversations there). Updates is not a tab: a link to it (Home, Recent activity)
  // opens the feed here in place, with a way back to Messages.
  const tabs: Tab[] = messageTabs(account, !!list?.some(c => c.kind === "owner"));
  const openUpdates = initialTab === "updates" && !openConversation && !!updates;
  const [showUpdates, setShowUpdates] = useState(openUpdates);
  const [chosenTab, setTab] = useState<Tab>(openConversation ? "team" : guests ? "guests" : "team");
  const tab: Tab = tabs.includes(chosenTab) ? chosenTab : "team";
  const count = (t: Tab) => t === "guests" ? guestWaiting ?? 0 : (list ?? []).filter(c => tabOf(c) === t).reduce((sum, c) => sum + c.unread, 0);
  // The first time the list arrives, open the first tab that needs attention, unless one was chosen.
  const picked = useRef(!!openConversation || openUpdates);
  const attention = list && !owner ? tabs.find(t => count(t) > 0) ?? null : undefined;
  useEffect(() => {
    if (picked.current || attention === undefined) return;
    picked.current = true;
    if (attention) queueMicrotask(() => setTab(attention));
  }, [attention]);
  // Clients: Needs a reply, Engaged, Closed. Team: no status. Both: one search box.
  const [status, setStatus] = useState<MessageStatus>("reply"), [query, setQuery] = useState("");
  const choose = (t: Tab) => { picked.current = true; setTab(t); setOpen(null); setQuery(""); setStatus("reply"); };
  const inTab = (list ?? []).filter(c => tabs.length < 2 || tabOf(c) === tab);
  const placeText = new Map(properties.map(x => [x.id, [x.name, x.address].filter(Boolean).join(" ")] as const));
  const searchable = (c: Conversation) => [c.title, c.subtitle, c.propertyName, c.last?.authorName, ...c.propertyIds.map(id => placeText.get(id))];
  const found = inTab.filter(c => matchesSearch(query, searchable(c)));
  const clients = tab === "clients" && tabs.length > 1;
  // The conversation open beside the list stays listed while it is read, so it does not jump away.
  const shown = clients ? found.filter(c => clientStatus(c) === status || (desktop && c.id === open)) : found;
  const thread = (id: string, back?: () => void) => <Thread key={id} p={p} id={id} onBack={back} onChanged={changed} savedReplies={guests} onOpen={c => { setOpen(c.id); void loadList(); }} onLeft={() => { setOpen(null); void loadList(); }} />;
  const listView = (
    <View style={{ gap: 10 }}>
      <SearchBar p={p} value={query} onChange={setQuery} placeholder={clients ? "Search owner or property" : "Search conversations or people"}
        action={mode.readOnly ? undefined : { icon: "edit-3", label: clients ? "New message to an owner" : "New message", onPress: () => setCreating(true) }} />
      {clients && !!list && <StatusFilter p={p} value={status} counts={statusCounts(found, clientStatus)} onChange={setStatus} />}
      {clients && !mode.readOnly && ["admin", "super_admin", "stays"].includes(account.role) && <EmailUnknownSenders p={p} onChanged={changed} />}
      {!list ? <Loading p={p} /> : shown.length ? <View style={{ gap: 2 }}>{shown.map(c => <ConversationRow key={c.id} p={p} c={c} active={c.id === open} onPress={() => setOpen(c.id)} />)}</View>
        : <Text style={[ui.small, { color: p.muted, paddingVertical: 16 }]}>{emptyStatusMessage(clients ? "clients" : "team", clients ? status : null, !!query.trim())}</Text>}
    </View>
  );
  const tabBar = tabs.length > 1 && (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: 4, padding: 4, borderRadius: 999, backgroundColor: p.wash, alignSelf: desktop ? "flex-start" : "stretch" }}>
      {tabs.map(t => {
        const on = t === tab, n = count(t);
        return (
          <MotionPress key={t} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`${TAB_LABEL[t]}${n ? `, ${n} ${t === "guests" ? "waiting" : "unread"}` : ""}`} onPress={() => choose(t)}
            style={[ui.row, { flex: desktop ? undefined : 1, justifyContent: "center", gap: 6, minHeight: 38, paddingHorizontal: 18, borderRadius: 999, backgroundColor: on ? p.surface : "transparent" }]}>
            <Text style={{ color: on ? p.text : p.muted, fontWeight: on ? "600" : "400", fontSize: 14 }}>{TAB_LABEL[t]}</Text>
            {n > 0 && <View style={{ minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, alignItems: "center", justifyContent: "center", backgroundColor: p.primary }}><Text style={{ color: p.onPrimary, fontSize: 11, fontWeight: "600" }}>{n > 99 ? "99+" : n}</Text></View>}
          </MotionPress>
        );
      })}
    </View>
  );
  if (showUpdates && updates && !owner) return (
    <View style={{ gap: 12 }}>
      <ThreadHeader p={p} onBack={() => setShowUpdates(false)}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Updates</Text>
      </ThreadHeader>
      {updates}
    </View>
  );
  // On a phone an open conversation takes the whole screen, with a back arrow; the tabs come back with the list.
  const phoneThread = !desktop && !owner && tab !== "guests" && !!open;
  return (
    <View style={{ gap: 12 }}>
      {!phoneThread && tabBar}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {owner ? (open ? <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border }]}>{thread(open)}</View>
        : mode.readOnly && (list || preview) ? <Text style={[ui.small, { color: p.muted, paddingVertical: 16 }]}>{preview ? "An owner's Messages is their conversation with Recharge. Choose an owner under View as to see theirs." : "This owner has not messaged Recharge yet."}</Text>
        : <Loading p={p} />)
        : tab === "guests" ? <GuestInbox palette={p} properties={properties} desktop={desktop} onChanged={onUnread} />
        : <MessagesSplit p={p} desktop={desktop} list={listView} detail={open ? thread(open, desktop ? undefined : () => { setOpen(null); void loadList(); }) : null} />}
      {creating && <NewConversation p={p} properties={properties} only={tabs.length < 2 ? undefined : tab === "clients" ? "owners" : "team"} onClose={() => setCreating(false)} onOpen={c => { setCreating(false); setOpen(c.id); void loadList(); }} />}
    </View>
  );
}
