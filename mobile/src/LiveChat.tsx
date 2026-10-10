import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, ScrollView, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import { Text } from "./Typography";
import { PropertySelect } from "./SearchPicker";
import { MotionPress, Pop, SwapIn } from "./motion";
import { Sheet } from "./TeamFlows";
import { Button, Field, Loading, message, Notice } from "./LiveKit";
import { ui, type Palette } from "./theme";
import { readChat, readInbox, writeChat } from "./backend/client";
import { GuestInbox } from "./LiveGuestInbox";
import { SavedReplies } from "./SavedReplies";
import { channelsFirst, chatPeopleSchema, chatTime, conversationSchema, hasGuestInbox, threadSchema, type ChatMessage, type Conversation } from "../../lib/workspace-chat-policy";
import { inboxListSchema } from "../../lib/guest-inbox-policy";
import { ALL_PROPERTIES, CHAT_CHIPS, chipCounts, conversationFacts, emptyMessage, filterInbox, propertyChips } from "../../lib/inbox-filters";
import { InboxChips } from "./InboxChips";
import { ROLE_LABEL } from "../../lib/admin-live";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import type { PropertyView } from "../../lib/workspace-view";
import { z } from "zod";

// Messages: one inbox for the team, in three tabs: Guests (the guest inbox, for people with the
// guest communication tool), Clients (each owner's conversation with Recharge) and Team (one-to-one
// and group conversations). Owners only see their conversation with Recharge. While a conversation
// is open it checks for new messages every few seconds.
const LIST_EVERY = 15000, THREAD_EVERY = 3000, GUESTS_EVERY = 60000;
type Tab = "guests" | "clients" | "team";
const TAB_LABEL: Record<Tab, string> = { guests: "Guests", clients: "Clients", team: "Team" };
const TAB_ICON = { guests: "globe", clients: "home", team: "users" } as const;
const tabOf = (c: Conversation): Tab => c.kind === "owner" ? "clients" : "team";
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

function Thread({ p, id, onBack, onChanged, savedReplies = false }: { p: Palette; id: string; onBack?: () => void; onChanged: () => void; savedReplies?: boolean }) {
  const [thread, setThread] = useState<z.infer<typeof threadSchema> | null>(null);
  const [text, setText] = useState(""), [sending, setSending] = useState(false), [error, setError] = useState("");
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
  // A ref (not state) guards against a second tap or Enter in the same instant, and the request id is
  // kept until the message is sent, so a retry after a timeout never posts it twice.
  const inFlight = useRef(false), pending = useRef<{ body: string; requestId: string } | null>(null);
  async function send() {
    const body = text.trim();
    if (!body || inFlight.current) return;
    inFlight.current = true; setSending(true); setError("");
    if (pending.current?.body !== body) pending.current = { body, requestId: Crypto.randomUUID() };
    try { await writeChat({ action: "send", requestId: pending.current.requestId, conversationId: id, body }); pending.current = null; setText(""); await load(); onChanged(); }
    catch (e) { setError(message(e)); } finally { inFlight.current = false; setSending(false); }
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
          : <Text style={[ui.small, { color: p.muted, textAlign: "center", paddingVertical: 24 }]}>{c?.kind === "owner" && c.title === "Recharge" ? "Ask us anything about your property. The team usually replies within minutes during the day." : c?.department ? (c.department === "all" ? "Everyone on the team can read and write here. Use it for announcements." : `Everyone in ${c.title} can read and write here. Admins can read it too.`) : "Say hello. Messages are only seen by the people in this conversation."}</Text>}
      </ScrollView>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {savedReplies && c?.kind === "owner" && <SavedReplies p={p} audience="owner" fill={{ name: c.title, property: c.propertyName }} onInsert={reply => setText(current => current.trim() ? current.trimEnd() + "\n\n" + reply : reply)} />}
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
    <Sheet palette={p} visible onClose={onClose} title="New message" subtitle={only === "owners" ? "Choose an owner you look after" : "Choose one person, or several for a group"} icon="people">
      <TextInput value={query} onChangeText={setQuery} placeholder="Search by name" placeholderTextColor={p.muted} accessibilityLabel="Search people" style={{ minHeight: 46, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: p.controlBorder, backgroundColor: p.background, color: p.text, fontFamily: "Montserrat_500Medium" }} />
      {!people && !error && <Loading p={p} />}
      {people && !team.length && !owners.length && <Text style={[ui.small, { color: p.muted }]}>{query.trim() ? "Nobody matches." : only === "owners" ? "No owners to message yet. You can message the owners of the properties you look after." : "Nobody to message yet."}</Text>}
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
          <PropertySelect p={p} properties={properties} value={propertyId} onChange={setPropertyId} clearable empty="" />
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

export function LiveChat({ palette: p, account, desktop, properties, onUnread, guestWaiting = 0, openConversation }: { palette: Palette; account: WorkspaceAccount; desktop: boolean; properties: PropertyView[]; onUnread: () => void; guestWaiting?: number | null; openConversation?: string }) {
  const owner = account.role === "client", guests = hasGuestInbox(account);
  const [list, setList] = useState<Conversation[] | null>(null), [open, setOpen] = useState<string | null>(openConversation ?? null), [creating, setCreating] = useState(false), [error, setError] = useState("");
  const loadList = useCallback(async () => {
    try { setList(z.array(conversationSchema).parse((await readChat({ section: "list" })).data)); setError(""); } catch (e) { setError(message(e)); }
  }, []);
  // Owners go straight to their conversation with Recharge.
  useEffect(() => {
    queueMicrotask(() => {
      // The team channels are made the first time anyone on the team opens Messages.
      if (owner) void loadList(); else writeChat({ action: "openTeams" }).catch(() => undefined).finally(() => void loadList());
      if (owner) writeChat({ action: "startOwner" }).then(r => setOpen(conversationSchema.parse(r.data).id)).catch(e => setError(message(e)));
    });
  }, [loadList, owner]);
  useVisiblePoll(() => void loadList(), LIST_EVERY, !owner);
  const changed = useCallback(() => { void loadList(); onUnread(); }, [loadList, onUnread]);
  // The team's tabs: Clients for the people who answer owners, Guests for the guest inbox.
  const showClients = ["admin", "super_admin", "stays"].includes(account.role) || !!list?.some(c => c.kind === "owner");
  const tabs: Tab[] = owner ? [] : [...(guests ? ["guests" as const] : []), ...(showClients ? ["clients" as const] : []), "team"];
  const [chosenTab, setTab] = useState<Tab>(openConversation ? "team" : guests ? "guests" : "team");
  const tab: Tab = tabs.includes(chosenTab) ? chosenTab : "team";
  const count = (t: Tab) => t === "guests" ? guestWaiting ?? 0 : (list ?? []).filter(c => tabOf(c) === t).reduce((sum, c) => sum + c.unread, 0);
  // The first time the list arrives, open the first tab that needs attention, unless one was chosen.
  const picked = useRef(!!openConversation);
  const attention = list && !owner ? tabs.find(t => count(t) > 0) ?? null : undefined;
  useEffect(() => {
    if (picked.current || attention === undefined) return;
    picked.current = true;
    if (attention) queueMicrotask(() => setTab(attention));
  }, [attention]);
  // Quick filters inside the tab: Unread, Needs a reply, Mine, and a property when there are several.
  const [chip, setChip] = useState<(typeof CHAT_CHIPS)[number]>("all"), [property, setProperty] = useState(ALL_PROPERTIES);
  const choose = (t: Tab) => { picked.current = true; setTab(t); setOpen(null); setChip("all"); setProperty(ALL_PROPERTIES); };
  const inTab = (list ?? []).filter(c => tabs.length < 2 || tabOf(c) === tab);
  const facts = (c: Conversation) => conversationFacts(c, owner);
  const names = new Map([...inTab.filter(c => c.propertyId && c.propertyName).map(c => [c.propertyId!, c.propertyName!] as const), ...properties.map(x => [x.id, x.name] as const)]);
  const propertyOptions = propertyChips(inTab, facts, names, chip);
  const where = propertyOptions.some(x => x.id === property) ? property : ALL_PROPERTIES;
  // The conversation open beside the list stays listed while it is read, so it does not jump away.
  const matching = filterInbox(inTab, facts, chip, where), shown = channelsFirst(inTab.filter(c => matching.includes(c) || (desktop && c.id === open)));
  const listView = (
    <View style={{ gap: 4, width: desktop ? 340 : "100%" }}>
      <View style={[ui.between, { paddingBottom: 6, gap: 12 }]}>
        <Text accessibilityRole="header" numberOfLines={1} style={[ui.sectionTitle, { color: p.text, flex: 1, minWidth: 0 }]}>{tabs.length > 1 ? TAB_LABEL[tab] : "Messages"}</Text>
        <MotionPress accessibilityRole="button" accessibilityLabel={tab === "clients" ? "New message to an owner" : "New message"} onPress={() => setCreating(true)}
          style={[ui.row, { gap: 8, minHeight: 40, paddingHorizontal: 14, borderRadius: 12, backgroundColor: p.primary }]}>
          <Feather name="edit-3" size={15} color={p.onPrimary} /><Text style={{ color: p.onPrimary, fontWeight: "700" }}>New</Text>
        </MotionPress>
      </View>
      {!!list?.length && !!inTab.length && <View style={{ paddingBottom: 8 }}><InboxChips p={p} chips={CHAT_CHIPS} chip={chip} counts={chipCounts(inTab, facts, CHAT_CHIPS, where)} onChip={setChip} properties={propertyOptions} property={where} onProperty={setProperty} /></View>}
      {!list ? <Loading p={p} /> : shown.length ? shown.map(c => <ConversationRow key={c.id} p={p} c={c} active={c.id === open} onPress={() => setOpen(c.id)} />)
        : <Text style={[ui.small, { color: p.muted, paddingVertical: 16 }]}>{emptyMessage(inTab.length ? chip : "all", tab === "clients" && tabs.length > 1 ? "clients" : "team", where !== ALL_PROPERTIES ? names.get(where) : undefined)}</Text>}
    </View>
  );
  const tabBar = tabs.length > 1 && (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {tabs.map(t => {
        const on = t === tab, n = count(t);
        return (
          <Pop key={t} active={on}><MotionPress accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`${TAB_LABEL[t]}${n ? `, ${n} ${t === "guests" ? "waiting" : "unread"}` : ""}`} onPress={() => choose(t)}
            style={[ui.row, { gap: 8, minHeight: 42, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: on ? p.primary : p.border, backgroundColor: on ? p.primary : p.surface }]}>
            <Feather name={TAB_ICON[t]} size={15} color={on ? p.onPrimary : p.text} />
            <Text style={{ color: on ? p.onPrimary : p.text, fontWeight: "700", fontSize: 14 }}>{TAB_LABEL[t]}</Text>
            {n > 0 && <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: "center", justifyContent: "center", backgroundColor: on ? p.onPrimary : p.primary }}><Text style={{ color: on ? p.primary : p.onPrimary, fontSize: 12, fontWeight: "800" }}>{n > 99 ? "99+" : n}</Text></View>}
          </MotionPress></Pop>
        );
      })}
    </View>
  );
  const thread = (id: string, back?: () => void) => <Thread key={id} p={p} id={id} onBack={back} onChanged={changed} savedReplies={guests} />;
  return (
    <View style={{ gap: 12 }}>
      {tabBar}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <SwapIn swapKey={owner ? "owner" : tab}>
        {owner ? (open ? <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border }]}>{thread(open)}</View> : <Loading p={p} />)
          : tab === "guests" ? <GuestInbox palette={p} properties={properties} onChanged={onUnread} />
          : desktop ? (
            <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, flexDirection: "row", gap: 18, alignItems: "stretch" }]}>
              {listView}
              <View style={{ flex: 1, minWidth: 0, borderLeftWidth: 1, borderColor: p.border, paddingLeft: 18 }}>
                {open ? thread(open) : <View style={{ flex: 1, alignItems: "center", justifyContent: "center", minHeight: 420, gap: 8 }}><Feather name="message-circle" size={32} color={p.muted} /><Text style={{ color: p.muted }}>Choose a conversation</Text></View>}
              </View>
            </View>
          ) : open ? <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border }]}>{thread(open, () => { setOpen(null); void loadList(); })}</View>
            : <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border }]}>{listView}</View>}
      </SwapIn>
      {creating && <NewConversation p={p} properties={properties} only={tabs.length < 2 ? undefined : tab === "clients" ? "owners" : "team"} onClose={() => setCreating(false)} onOpen={c => { setCreating(false); setOpen(c.id); void loadList(); }} />}
    </View>
  );
}
