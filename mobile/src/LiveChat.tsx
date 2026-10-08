import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, ScrollView, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Sheet } from "./TeamFlows";
import { Button, Field, Loading, message, Notice } from "./LiveKit";
import { ui, type Palette } from "./theme";
import { readChat, writeChat } from "./backend/client";
import { chatPeopleSchema, chatTime, conversationSchema, threadSchema, type ChatMessage, type Conversation } from "../../lib/workspace-chat-policy";
import { ROLE_LABEL } from "../../lib/admin-live";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import type { PropertyView } from "../../lib/workspace-view";
import { z } from "zod";

// Messages: one-to-one and group conversations for the team, and each owner's conversation with
// Recharge. While a conversation is open it checks for new messages every few seconds.
const LIST_EVERY = 15000, THREAD_EVERY = 3000;
const initials = (name: string) => name.replace(/^Recharge · /, "").trim().split(/\s+/).slice(0, 2).map(w => w[0] ?? "").join("").toUpperCase() || "R";
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

function Avatar({ p, name, kind }: { p: Palette; name: string; kind: Conversation["kind"] }) {
  return (
    <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: kind === "owner" ? p.cautionWash : p.wash }}>
      {kind === "group" ? <Feather name="users" size={18} color={p.primary} /> : <Text style={{ color: p.text, fontWeight: "700" }}>{initials(name)}</Text>}
    </View>
  );
}

function ConversationRow({ p, c, active, onPress }: { p: Palette; c: Conversation; active: boolean; onPress: () => void }) {
  return (
    <MotionPress accessibilityRole="button" accessibilityLabel={`${c.title}${c.unread ? `, ${c.unread} unread` : ""}`} onPress={onPress}
      style={[ui.row, { gap: 12, padding: 12, borderRadius: 16, backgroundColor: active ? p.wash : "transparent" }]}>
      <Avatar p={p} name={c.title} kind={c.kind} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={[ui.row, { gap: 8 }]}>
          <Text numberOfLines={1} style={{ color: p.text, fontWeight: c.unread ? "800" : "700", flex: 1 }}>{c.title}</Text>
          {!!c.last && <Text style={[ui.small, { color: c.unread ? p.primary : p.muted }]}>{chatTime(c.last.at)}</Text>}
        </View>
        <View style={[ui.row, { gap: 8 }]}>
          <Text numberOfLines={1} style={[ui.small, { color: c.unread ? p.text : p.muted, flex: 1, fontWeight: c.unread ? "600" : "400" }]}>
            {c.last ? `${c.kind !== "direct" || c.last.authorName === "You" ? c.last.authorName + ": " : ""}${c.last.body}` : c.propertyName ? `About ${c.propertyName}` : c.subtitle ?? "No messages yet"}
          </Text>
          {c.unread > 0 && <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: p.primary, alignItems: "center", justifyContent: "center" }}><Text style={{ color: p.surface, fontSize: 12, fontWeight: "800" }}>{c.unread > 99 ? "99+" : c.unread}</Text></View>}
        </View>
      </View>
    </MotionPress>
  );
}

function Bubble({ p, m, showName }: { p: Palette; m: ChatMessage; showName: boolean }) {
  return (
    <View style={{ alignItems: m.mine ? "flex-end" : "flex-start", gap: 2 }}>
      {showName && !m.mine && <Text style={[ui.small, { color: p.muted, fontWeight: "700", marginLeft: 6 }]}>{m.authorName}</Text>}
      <View style={{ maxWidth: "82%", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, borderBottomRightRadius: m.mine ? 6 : 18, borderBottomLeftRadius: m.mine ? 18 : 6, backgroundColor: m.mine ? p.primary : p.surface, borderWidth: m.mine ? 0 : 1, borderColor: p.border }}>
        <Text selectable style={{ color: m.mine ? p.surface : p.text, fontSize: 15, lineHeight: 21 }}>{m.body}</Text>
      </View>
      <Text style={{ color: p.muted, fontSize: 11, marginHorizontal: 6 }}>{chatTime(m.at)}</Text>
    </View>
  );
}

function Thread({ p, id, onBack, onChanged }: { p: Palette; id: string; onBack?: () => void; onChanged: () => void }) {
  const [thread, setThread] = useState<z.infer<typeof threadSchema> | null>(null);
  const [text, setText] = useState(""), [sending, setSending] = useState(false), [error, setError] = useState("");
  const scroll = useRef<ScrollView>(null), lastSeen = useRef("");
  const load = useCallback(async () => {
    try {
      const parsed = threadSchema.parse((await readChat({ section: "messages", conversationId: id })).data);
      setThread(parsed);
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
  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true); setError("");
    try { await writeChat({ action: "send", requestId: Crypto.randomUUID(), conversationId: id, body }); setText(""); await load(); onChanged(); }
    catch (e) { setError(message(e)); } finally { setSending(false); }
  }
  const c = thread?.conversation;
  return (
    <View style={{ flex: 1, minHeight: 420, gap: 10 }}>
      <View style={[ui.row, { gap: 10, paddingBottom: 10, borderBottomWidth: 1, borderColor: p.border }]}>
        {onBack && <MotionPress accessibilityRole="button" accessibilityLabel="Back to messages" onPress={onBack} style={{ minWidth: 40, minHeight: 40, alignItems: "center", justifyContent: "center" }}><Feather name="chevron-left" size={22} color={p.text} /></MotionPress>}
        {c && <Avatar p={p} name={c.title} kind={c.kind} />}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: p.text, fontWeight: "800", fontSize: 16 }}>{c?.title ?? "…"}</Text>
          {!!c && <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{[c.subtitle, c.propertyName ? `About ${c.propertyName}` : null].filter(Boolean).join(" · ") || (c.kind === "owner" ? "Owner conversation" : "Direct message")}</Text>}
        </View>
      </View>
      <ScrollView ref={scroll} style={{ flex: 1, maxHeight: Platform.OS === "web" ? 520 : undefined }} contentContainerStyle={{ gap: 10, paddingVertical: 6 }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
        {!thread ? <Loading p={p} rows={2} /> : thread.messages.length ? thread.messages.map(m => <Bubble key={m.id} p={p} m={m} showName={c?.kind !== "direct"} />)
          : <Text style={[ui.small, { color: p.muted, textAlign: "center", paddingVertical: 24 }]}>{c?.kind === "owner" && c.title === "Recharge" ? "Ask us anything about your property. The team usually replies within minutes during the day." : "Say hello. Messages are only seen by the people in this conversation."}</Text>}
      </ScrollView>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <View style={[ui.row, { gap: 8, alignItems: "flex-end" }]}>
        <TextInput value={text} onChangeText={setText} placeholder="Write a message" placeholderTextColor={p.muted} multiline maxLength={4000} accessibilityLabel="Message"
          onKeyPress={e => { const key = e.nativeEvent as unknown as { key: string; shiftKey?: boolean }; if (Platform.OS === "web" && key.key === "Enter" && !key.shiftKey) { (e as unknown as { preventDefault: () => void }).preventDefault(); void send(); } }}
          style={{ flex: 1, minHeight: 46, maxHeight: 140, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 18, borderWidth: 1, borderColor: p.controlBorder, backgroundColor: p.background, color: p.text, fontFamily: "Montserrat_500Medium", fontSize: 15 }} />
        <MotionPress accessibilityRole="button" accessibilityLabel="Send" disabled={!text.trim() || sending} onPress={() => void send()}
          style={{ width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: text.trim() ? p.primary : p.wash }}>
          <Feather name="send" size={19} color={text.trim() ? p.surface : p.muted} />
        </MotionPress>
      </View>
    </View>
  );
}

function NewConversation({ p, properties, onClose, onOpen }: { p: Palette; properties: PropertyView[]; onClose: () => void; onOpen: (c: Conversation) => void }) {
  const [people, setPeople] = useState<z.infer<typeof chatPeopleSchema> | null>(null);
  const [picked, setPicked] = useState<string[]>([]), [title, setTitle] = useState(""), [propertyId, setPropertyId] = useState(""), [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { readChat({ section: "people" }).then(r => setPeople(chatPeopleSchema.parse(r.data))).catch(e => setError(message(e))); }, []);
  async function start(action: Parameters<typeof writeChat>[0]) {
    setBusy(true); setError("");
    try { onOpen(conversationSchema.parse((await writeChat(action)).data)); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const match = (name: string) => name.toLowerCase().includes(query.trim().toLowerCase());
  const team = (people?.team ?? []).filter(x => match(x.fullName)), owners = (people?.owners ?? []).filter(x => match(x.fullName));
  const group = picked.length > 1;
  return (
    <Sheet palette={p} visible onClose={onClose} title="New message" subtitle="Choose one person, or several for a group" icon="people">
      <TextInput value={query} onChangeText={setQuery} placeholder="Search by name" placeholderTextColor={p.muted} accessibilityLabel="Search people" style={{ minHeight: 46, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: p.controlBorder, backgroundColor: p.background, color: p.text, fontFamily: "Montserrat_500Medium" }} />
      {!people && !error && <Loading p={p} />}
      {!!team.length && <Text style={[ui.small, { color: p.muted, fontWeight: "700" }]}>Team</Text>}
      {team.map(x => {
        const on = picked.includes(x.userId);
        return (
          <MotionPress key={x.userId} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => setPicked(on ? picked.filter(y => y !== x.userId) : [...picked, x.userId])}
            style={[ui.row, { gap: 12, minHeight: 52, paddingHorizontal: 12, borderRadius: 14, backgroundColor: on ? p.wash : p.elevated }]}>
            <Feather name={on ? "check-circle" : "circle"} size={20} color={on ? p.primary : p.muted} />
            <Text style={{ color: p.text, flex: 1, fontWeight: "600" }}>{x.fullName}</Text>
            <Text style={[ui.small, { color: p.muted }]}>{roleName(x.role)}</Text>
          </MotionPress>
        );
      })}
      {group && <>
        <Field label="Group name" value={title} onChange={setTitle} p={p} placeholder="For example: Weekend changeovers" />
        {!!properties.length && <View style={{ gap: 6 }}>
          <Text style={[ui.small, { color: p.muted, fontWeight: "700" }]}>About a property (optional)</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {properties.slice(0, 30).map(x => <MotionPress key={x.id} accessibilityRole="radio" accessibilityState={{ selected: propertyId === x.id }} onPress={() => setPropertyId(propertyId === x.id ? "" : x.id)}
              style={{ paddingHorizontal: 12, minHeight: 36, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: propertyId === x.id ? p.primary : p.border, backgroundColor: propertyId === x.id ? p.wash : p.surface }}>
              <Text style={[ui.small, { color: p.text, fontWeight: "600" }]}>{x.name}</Text></MotionPress>)}
          </View>
        </View>}
      </>}
      {!!picked.length && <Button label={busy ? "Starting…" : group ? `Start group with ${picked.length} people` : "Start conversation"} icon="message-circle" primary p={p} disabled={busy || (group && title.trim().length < 2)}
        onPress={() => void start(group ? { action: "startGroup", title: title.trim(), userIds: picked, ...(propertyId ? { propertyId } : {}) } : { action: "startDirect", userId: picked[0] })} />}
      {!!owners.length && <>
        <Text style={[ui.small, { color: p.muted, fontWeight: "700", paddingTop: 6 }]}>Owners you look after</Text>
        {owners.map(x => <MotionPress key={x.userId} accessibilityRole="button" onPress={() => void start({ action: "startOwner", ownerId: x.userId })}
          style={[ui.row, { gap: 12, minHeight: 52, paddingHorizontal: 12, borderRadius: 14, backgroundColor: p.elevated }]}>
          <Feather name="home" size={18} color={p.primary} /><Text style={{ color: p.text, flex: 1, fontWeight: "600" }}>{x.fullName}</Text><Feather name="chevron-right" size={18} color={p.muted} />
        </MotionPress>)}
      </>}
      {!!error && <Notice text={error} p={p} tone="bad" />}
    </Sheet>
  );
}

export function LiveChat({ palette: p, account, desktop, properties, onUnread }: { palette: Palette; account: WorkspaceAccount; desktop: boolean; properties: PropertyView[]; onUnread: () => void }) {
  const owner = account.role === "client";
  const [list, setList] = useState<Conversation[] | null>(null), [open, setOpen] = useState<string | null>(null), [creating, setCreating] = useState(false), [error, setError] = useState("");
  const loadList = useCallback(async () => {
    try { setList(z.array(conversationSchema).parse((await readChat({ section: "list" })).data)); setError(""); } catch (e) { setError(message(e)); }
  }, []);
  // Owners go straight to their conversation with Recharge.
  useEffect(() => {
    queueMicrotask(() => {
      void loadList();
      if (owner) writeChat({ action: "startOwner" }).then(r => setOpen(conversationSchema.parse(r.data).id)).catch(e => setError(message(e)));
    });
  }, [loadList, owner]);
  useVisiblePoll(() => void loadList(), LIST_EVERY, !owner);
  const changed = useCallback(() => { void loadList(); onUnread(); }, [loadList, onUnread]);
  const listView = (
    <View style={{ gap: 4, width: desktop ? 340 : "100%" }}>
      <View style={[ui.between, { paddingBottom: 6, gap: 12 }]}>
        <Text accessibilityRole="header" numberOfLines={1} style={[ui.sectionTitle, { color: p.text, flex: 1, minWidth: 0 }]}>Messages</Text>
        <MotionPress accessibilityRole="button" accessibilityLabel="New message" onPress={() => setCreating(true)}
          style={[ui.row, { gap: 8, minHeight: 40, paddingHorizontal: 14, borderRadius: 12, backgroundColor: p.primary }]}>
          <Feather name="edit-3" size={15} color={p.onPrimary} /><Text style={{ color: p.onPrimary, fontWeight: "700" }}>New</Text>
        </MotionPress>
      </View>
      {!list ? <Loading p={p} /> : list.length ? list.map(c => <ConversationRow key={c.id} p={p} c={c} active={c.id === open} onPress={() => setOpen(c.id)} />)
        : <Text style={[ui.small, { color: p.muted, paddingVertical: 16 }]}>No conversations yet. Tap New to message someone on the team.</Text>}
    </View>
  );
  return (
    <View style={{ gap: 12 }}>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {owner ? (open ? <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border }]}><Thread key={open} p={p} id={open} onChanged={changed} /></View> : <Loading p={p} />)
        : desktop ? (
          <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, flexDirection: "row", gap: 18, alignItems: "stretch" }]}>
            {listView}
            <View style={{ flex: 1, minWidth: 0, borderLeftWidth: 1, borderColor: p.border, paddingLeft: 18 }}>
              {open ? <Thread key={open} p={p} id={open} onChanged={changed} /> : <View style={{ flex: 1, alignItems: "center", justifyContent: "center", minHeight: 420, gap: 8 }}><Feather name="message-circle" size={32} color={p.muted} /><Text style={{ color: p.muted }}>Choose a conversation</Text></View>}
            </View>
          </View>
        ) : open ? <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border }]}><Thread key={open} p={p} id={open} onBack={() => { setOpen(null); void loadList(); }} onChanged={changed} /></View>
          : <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border }]}>{listView}</View>}
      {creating && <NewConversation p={p} properties={properties} onClose={() => setCreating(false)} onOpen={c => { setCreating(false); setOpen(c.id); void loadList(); }} />}
    </View>
  );
}
