import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Platform, ScrollView, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Text } from "./Typography";
import { ListSearchBox, PropertySelect, useListSearch } from "./SearchPicker";
import { useCelebrate } from "./Celebrate";
import { MotionPress, Pop } from "./motion";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, Field, message, Notice, Tag, Loading, RefreshButton } from "./LiveKit";
import { Pills } from "./LiveAccounts";
import { readInbox, writeInbox } from "./backend/client";
import { CHANNEL_LABEL, GUEST_CHANNELS, inboxListSchema, inboxThreadSchema, waitGrade, waitLabel, type GuestChannel, type GuestThread } from "../../lib/guest-inbox-policy";
import { ALL_PROPERTIES, chipCounts, emptyMessage, filterInbox, GUEST_CHIPS, guestFacts, propertyChips } from "../../lib/inbox-filters";
import { InboxChips } from "./InboxChips";
import { chatTime } from "../../lib/workspace-chat-policy";
import { SavedReplies } from "./SavedReplies";
import type { PropertyView } from "../../lib/workspace-view";

// The guest inbox (Stays → Guest inbox): every conversation with guests, the longest wait first.
// Hostaway fills it by itself (guest messages and the team's replies there, within about a minute).
// When sending is switched on (canSend), a reply to a Hostaway conversation is sent to the guest through
// Hostaway. Messages from anywhere else (WhatsApp, email) are logged by hand, and a reply can be recorded
// here, so reply times and bonuses count either way; those replies are never sent from here.
// Channel colours, darkened or given dark letters where needed so each letter reads at 4.5:1.
const CHANNEL_STYLE: Record<GuestChannel, { bg: string; fg: string; letter: string }> = {
  airbnb: { bg: "#D0353B", fg: "#FFFFFF", letter: "A" }, booking_com: { bg: "#003580", fg: "#FFFFFF", letter: "B." }, vrbo: { bg: "#245ABC", fg: "#FFFFFF", letter: "V" },
  direct: { bg: "#1B3D37", fg: "#F1EADB", letter: "" }, whatsapp: { bg: "#25D366", fg: "#0B3D22", letter: "W" }, email: { bg: "#6B7280", fg: "#FFFFFF", letter: "@" }, other: { bg: "#9CA3AF", fg: "#152D28", letter: "•" },
};
const GRADE_TONE = { green: "good", amber: "wait", red: "bad" } as const;

// Where a conversation came from. Direct bookings show the Recharge mark, cut from the logo artwork.
function ChannelBadge({ channel, size = 40 }: { channel: GuestChannel; size?: number }) {
  const s = CHANNEL_STYLE[channel];
  if (channel === "direct") {
    // The mark sits at 39-164 × 40-165 in the 720 × 240 artwork.
    const scale = size / 125;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const art = require("../assets/brand/recharge-logo-dark.png");
    return (
      <View accessible accessibilityLabel="Direct booking (Recharge)" style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden", backgroundColor: s.bg }}>
        <Image accessible={false} source={art} style={{ position: "absolute", width: 720 * scale, height: 240 * scale, left: -39 * scale, top: -40 * scale }} />
      </View>
    );
  }
  return (
    <View accessible accessibilityLabel={CHANNEL_LABEL[channel]} style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", backgroundColor: s.bg }}>
      <Text style={{ color: s.fg, fontWeight: "800", fontSize: size * 0.38 }}>{s.letter}</Text>
    </View>
  );
}

function ThreadRow({ p, t, targets, first, unread = false, onPress }: { p: Palette; t: GuestThread; targets: { greenMinutes: number; amberMinutes: number }; first: boolean; unread?: boolean; onPress: () => void }) {
  const wait = t.status === "open" ? waitGrade(t.waitingSince, targets) : null;
  const where = [CHANNEL_LABEL[t.channel], t.propertyName ?? "No property yet", t.reservationRef].filter(Boolean).join(" · ");
  return (
    <MotionPress accessibilityRole="button" accessibilityLabel={`${t.guestName ?? "Guest"}${unread ? ", unread" : ""}, ${where}${wait ? `, waiting ${waitLabel(wait.minutes)}` : ""}`} onPress={onPress}
      style={[ui.row, { gap: 12, paddingVertical: 12, borderTopWidth: first ? 0 : 1, borderColor: p.border, alignItems: "flex-start" }]}>
      <ChannelBadge channel={t.channel} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <View style={[ui.row, { gap: 8 }]}>
          {unread && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.primary }} />}
          <Text numberOfLines={1} style={{ color: p.text, fontSize: 15, fontWeight: unread ? "800" : "700", flex: 1 }}>{t.guestName ?? "Guest"}</Text>
          {!!t.lastMessageAt && <Text style={[ui.small, { color: p.muted }]}>{chatTime(t.lastMessageAt)}</Text>}
        </View>
        <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{where}</Text>
        {!!t.preview && <Text numberOfLines={2} style={[ui.small, { color: p.text }]}>{t.lastFrom === "team" ? "You: " : ""}{t.preview}</Text>}
        <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
          {wait && <Tag label={`Waiting ${waitLabel(wait.minutes)}`} tone={GRADE_TONE[wait.grade]} p={p} />}
          {t.status === "done" && <Tag label="Done" tone="plain" p={p} />}
          {t.status === "open" && !wait && <Tag label="Replied" tone="good" p={p} />}
        </View>
      </View>
    </MotionPress>
  );
}

function PropertyPicker({ p, properties, value, onChange }: { p: Palette; properties: PropertyView[]; value: string | null; onChange: (id: string | null) => void }) {
  if (!properties.length) return null;
  return (
    <View style={{ gap: 6 }}>
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Property</Text>
      <PropertySelect p={p} properties={properties} value={value ?? NOT_SURE} onChange={id => onChange(id === NOT_SURE ? null : id)} fixed={[{ id: NOT_SURE, label: "Not sure yet" }]} />
    </View>
  );
}
const NOT_SURE = "not-sure";

// "When it arrived": now, or a few minutes ago, so a message noticed late is still timed fairly.
const AGO = ["0", "5", "15", "30", "60"] as const;
const agoLabel = (m: string) => m === "0" ? "Just now" : m === "60" ? "1 hour ago" : `${m} min ago`;

function LogMessageSheet({ p, properties, onClose, onDone }: { p: Palette; properties: PropertyView[]; onClose: () => void; onDone: (threadId: string) => void }) {
  const celebrate = useCelebrate();
  const [channel, setChannel] = useState<GuestChannel>("airbnb"), [guest, setGuest] = useState(""), [property, setProperty] = useState<string | null>(null);
  const [booking, setBooking] = useState(""), [body, setBody] = useState(""), [ago, setAgo] = useState<(typeof AGO)[number]>("0");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [requestId] = useState(() => Crypto.randomUUID());
  async function save() {
    if (busy) return;
    if (!guest.trim() || !body.trim()) { setError("Add the guest’s name and their message."); return; }
    setBusy(true); setError("");
    try {
      const result = await writeInbox({ action: "logMessage", requestId, channel, guestName: guest.trim(), body: body.trim(), ...(property ? { propertyId: property } : {}),
        ...(booking.trim() ? { reservationRef: booking.trim() } : {}), ...(ago !== "0" ? { sentAt: new Date(Date.now() - Number(ago) * 60000).toISOString() } : {}) });
      celebrate("Message logged");
      onDone(String((result.data as { id?: string } | undefined)?.id ?? ""));
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible onClose={onClose} title="Log a guest message" subtitle="A message that arrived on Airbnb, Booking.com or elsewhere" icon="chat">
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Where it came from</Text>
      <Pills p={p} values={GUEST_CHANNELS} value={channel} onChange={setChannel} label={c => CHANNEL_LABEL[c]} />
      <Field label="Guest’s name" value={guest} onChange={setGuest} p={p} placeholder="As shown on the booking" />
      <PropertyPicker p={p} properties={properties} value={property} onChange={setProperty} />
      <Field label="Booking reference (optional)" value={booking} onChange={setBooking} p={p} />
      <Field label="Their message" value={body} onChange={setBody} p={p} multiline placeholder="Paste or type what the guest wrote" />
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>When it arrived</Text>
      <Pills p={p} values={AGO} value={ago} onChange={setAgo} label={agoLabel} />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Log message"} icon="inbox" primary p={p} disabled={busy} onPress={() => void save()} />
    </Sheet>
  );
}

type Loaded = ReturnType<typeof inboxThreadSchema.parse>;
function ThreadSheet({ p, threadId, properties, onClose, onChanged }: { p: Palette; threadId: string; properties: PropertyView[]; onClose: () => void; onChanged: () => void }) {
  const celebrate = useCelebrate();
  const [data, setData] = useState<Loaded | null>(null);
  const [reply, setReply] = useState(""), [guestText, setGuestText] = useState("");
  const [editing, setEditing] = useState(false), [guest, setGuest] = useState(""), [property, setProperty] = useState<string | null>(null), [booking, setBooking] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [note, setNote] = useState("");
  const scroller = useRef<ScrollView>(null);
  const load = useCallback(async () => {
    try { setData(inboxThreadSchema.parse((await readInbox({ section: "thread", threadId })).data)); setError(""); }
    catch (e) { setError(message(e)); }
  }, [threadId]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void load(); });
    const timer = setInterval(() => { if (active) void load(); }, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [load]);
  const t = data?.thread;
  // Sending is on and this is a Hostaway conversation: Send delivers the reply to the guest.
  const viaHostaway = !!data?.canSend && t?.source === "hostaway";
  // Returns whether the write was saved, so nothing after it claims success when it failed.
  async function run(body: Parameters<typeof writeInbox>[0], done: string, after?: () => void): Promise<boolean> {
    if (busy) return false;
    setBusy(true); setError(""); setNote("");
    try { await writeInbox(body); celebrate(done); after?.(); await load(); onChanged(); return true; }
    catch (e) { setError(message(e)); return false; } finally { setBusy(false); }
  }
  // One request id per reply text, kept until it is saved, so trying again never records it twice.
  const replyId = useRef<{ text: string; id: string } | null>(null);
  async function sendReply(outside: boolean) {
    const text = outside ? "" : reply.trim();
    if (!outside && !text) { setError("Write the reply, or choose “I replied on the platform”."); return; }
    if (replyId.current?.text !== text) replyId.current = { text, id: Crypto.randomUUID() };
    if (!(await run({ action: "reply", requestId: replyId.current.id, threadId, body: text }, "Reply recorded", () => setReply("")))) return;
    replyId.current = null;
    // Replies aren't sent from here: copy it so it can be pasted into the platform. A Hostaway conversation brings the real reply in itself.
    if (text && t && t.source === "manual" && Platform.OS === "web" && globalThis.navigator?.clipboard) {
      try { await globalThis.navigator.clipboard.writeText(text); setNote(`Reply copied. Paste it into ${CHANNEL_LABEL[t.channel]} to send it to the guest.`); } catch { /* copying is a convenience */ }
    } else if (text && t?.source === "manual") setNote(`Remember to send it on ${CHANNEL_LABEL[t.channel]} too.`);
    else if (text && t?.source === "hostaway") setNote("Recorded. Send it to the guest in Hostaway; it then appears here by itself.");
  }
  // One request id per reply text, kept until it is sent, so pressing Send again never sends it twice.
  const sendId = useRef<{ text: string; id: string } | null>(null);
  async function sendToGuest() {
    const text = reply.trim();
    if (!text || !t || busy) return;
    if (sendId.current?.text !== text) sendId.current = { text, id: Crypto.randomUUID() };
    // On a failure the text stays in the box and the error shows, so Send can be pressed again.
    const sent = await run({ action: "sendReply", requestId: sendId.current.id, threadId, body: text }, "Reply sent", () => { setReply(""); setNote(`Sent to the guest through Hostaway on ${CHANNEL_LABEL[t.channel]}.`); });
    if (sent) sendId.current = null;
  }
  const wait = t && t.status === "open" && data ? waitGrade(t.waitingSince, data.targets) : null;
  return (
    <Sheet palette={p} visible onClose={onClose} title={t?.guestName ?? "Conversation"} subtitle={t ? [CHANNEL_LABEL[t.channel], t.propertyName ?? "No property yet", t.reservationRef].filter(Boolean).join(" · ") : undefined} icon="chat">
      {!data && !error && <Loading p={p} />}
      {t && data && <>
        <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
          <ChannelBadge channel={t.channel} size={28} />
          {wait ? <Tag label={`Waiting ${waitLabel(wait.minutes)}`} tone={GRADE_TONE[wait.grade]} p={p} /> : <Tag label={t.status === "done" ? "Done" : "Replied"} tone={t.status === "done" ? "plain" : "good"} p={p} />}
          {t.source === "manual" && <Tag label="Logged by hand" tone="plain" p={p} />}
        </View>
        <ScrollView ref={scroller} style={{ maxHeight: 380 }} contentContainerStyle={{ gap: 8, paddingVertical: 4 }} onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}>
          {data.messages.map(m => {
            const team = m.direction === "team";
            return (
              <View key={m.id} style={{ alignSelf: team ? "flex-end" : "flex-start", maxWidth: "86%", gap: 3 }}>
                <View style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, borderBottomRightRadius: team ? 6 : 18, borderBottomLeftRadius: team ? 18 : 6, backgroundColor: team ? p.primary : p.surface, borderWidth: team ? 0 : 1, borderColor: p.border }}>
                  <Text selectable style={{ color: team ? p.onPrimary : p.text, fontSize: 14, lineHeight: 20, fontStyle: m.body ? "normal" : "italic" }}>{m.body ?? "Replied on the platform"}</Text>
                </View>
                <Text style={[ui.small, { color: p.muted, fontSize: 11, textAlign: team ? "right" : "left" }]}>{team ? `${m.author ? (m.delivery === "sent" ? `Sent by ${m.author}` : m.author) : "Team"} · ` : ""}{chatTime(m.sentAt)}</Text>
              </View>
            );
          })}
        </ScrollView>
        {t.status === "open" ? <>
          <View style={{ gap: 6 }}>
            <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Your reply</Text>
            <SavedReplies p={p} audience="guest" fill={{ name: t.guestName, property: t.propertyName }} onInsert={text => setReply(current => current.trim() ? current.trimEnd() + "\n\n" + text : text)} />
            <TextInput value={reply} onChangeText={setReply} multiline placeholder={t.source === "manual" ? `Write it here, then send it on ${CHANNEL_LABEL[t.channel]}` : "Write your reply"} placeholderTextColor={p.muted} accessibilityLabel="Your reply"
              style={{ minHeight: 88, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: p.controlBorder, color: p.text, backgroundColor: p.background, textAlignVertical: "top", fontFamily: "Montserrat_500Medium", fontSize: 14 }} />
          </View>
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            {viaHostaway ? <Button label={busy ? "Sending…" : "Send"} icon="send" primary p={p} disabled={busy || !reply.trim()} onPress={() => void sendToGuest()} />
              : <Button label={busy ? "Saving…" : "Save reply"} icon="send" primary p={p} disabled={busy || !reply.trim()} onPress={() => void sendReply(false)} />}
            {!!wait && !viaHostaway && <Button label="I replied on the platform" icon="check" p={p} disabled={busy} onPress={() => void sendReply(true)} />}
          </View>
          {t.source === "manual" && <Text style={[ui.small, { color: p.muted }]}>Replies aren’t sent to {CHANNEL_LABEL[t.channel]} from here. Saving one records when you replied, for reply times.</Text>}
          {viaHostaway && <Text style={[ui.small, { color: p.muted }]}>Send delivers your reply to the guest through Hostaway on {CHANNEL_LABEL[t.channel]}. Their replies show up here by themselves.</Text>}
          {t.source === "hostaway" && !viaHostaway && <Text style={[ui.small, { color: p.muted }]}>Send your reply in Hostaway (or on {CHANNEL_LABEL[t.channel]}): it shows up here by itself within a minute and the wait ends. Saving one here only records it; nothing is sent to the guest.</Text>}
        </> : null}
        {!!note && <Notice text={note} p={p} />}
        {t.source === "manual" && t.status === "open" && <View style={{ gap: 6 }}>
          <Field label="The guest wrote again" value={guestText} onChange={setGuestText} p={p} multiline placeholder="Paste their new message" />
          {!!guestText.trim() && <Button label="Log their message" icon="inbox" p={p} disabled={busy} onPress={() => void run({ action: "logMessage", requestId: Crypto.randomUUID(), threadId, body: guestText.trim() }, "Message logged", () => setGuestText(""))} />}
        </View>}
        <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
          {t.status === "open" ? <Button label="Mark as done" icon="archive" p={p} disabled={busy} onPress={() => void run({ action: "setStatus", requestId: Crypto.randomUUID(), threadId, status: "done" }, "Conversation done")} />
            : <Button label="Reopen" icon="rotate-ccw" p={p} disabled={busy} onPress={() => void run({ action: "setStatus", requestId: Crypto.randomUUID(), threadId, status: "open" }, "Reopened")} />}
          <Button label="Guest details" icon="edit-2" p={p} onPress={() => { setEditing(!editing); setGuest(t.guestName ?? ""); setProperty(t.propertyId); setBooking(t.reservationRef ?? ""); }} />
        </View>
        {editing && <View style={{ gap: 10, padding: 12, borderRadius: 16, backgroundColor: p.background }}>
          <Field label="Guest’s name" value={guest} onChange={setGuest} p={p} />
          <PropertyPicker p={p} properties={properties} value={property} onChange={setProperty} />
          <Field label="Booking reference" value={booking} onChange={setBooking} p={p} />
          <Button label="Save details" icon="check" primary p={p} disabled={busy || !guest.trim()} onPress={() => void run({ action: "editThread", requestId: Crypto.randomUUID(), threadId, propertyId: property, guestName: guest.trim(), reservationRef: booking.trim() }, "Details saved", () => setEditing(false))} />
        </View>}
      </>}
      {!!error && <Notice text={error} p={p} tone="bad" />}
    </Sheet>
  );
}

// When this person last opened each conversation, on this device, for the Unread chip. Kept to the
// most recent few hundred; nothing is sent to the server.
const SEEN_KEY = "rc-guest-inbox-seen";
function useSeenThreads() {
  const [seen, setSeen] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(SEEN_KEY).then(value => {
      if (!active || !value) return;
      try { const parsed = JSON.parse(value) as unknown; if (parsed && typeof parsed === "object") setSeen(parsed as Record<string, string>); } catch { /* start afresh */ }
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const mark = useCallback((id: string) => setSeen(current => {
    const next = Object.fromEntries(Object.entries({ ...current, [id]: new Date().toISOString() }).sort((a, b) => b[1].localeCompare(a[1])).slice(0, 400));
    void AsyncStorage.setItem(SEEN_KEY, JSON.stringify(next)).catch(() => undefined);
    return next;
  }), []);
  return { seen, mark };
}

export function GuestInbox({ palette: p, properties, onChanged }: { palette: Palette; properties: PropertyView[]; onChanged?: () => void }) {
  // Every recent conversation is read once; the chips (Needs a reply first) filter it here.
  const [chip, setChip] = useState<(typeof GUEST_CHIPS)[number]>("reply"), [property, setProperty] = useState(ALL_PROPERTIES);
  const [data, setData] = useState<ReturnType<typeof inboxListSchema.parse> | null>(null);
  const [error, setError] = useState(""), [logging, setLogging] = useState(false), [openId, setOpenId] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const { seen, mark } = useSeenThreads();
  const open = (id: string | null) => { if (id) mark(id); else if (openId) mark(openId); setOpenId(id); };
  const load = useCallback(async () => {
    try { setData(inboxListSchema.parse((await readInbox({ section: "list", status: "all" })).data)); setError(""); }
    catch (e) { setError(message(e)); }
  }, []);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void load(); });
    // New messages every 30 seconds; waiting times tick on in between.
    const poll = setInterval(() => { if (active) void load(); }, 30000);
    const tick = setInterval(() => { if (active) setTick(n => n + 1); }, 20000);
    return () => { active = false; clearInterval(poll); clearInterval(tick); };
  }, [load]);
  const red = data ? data.threads.filter(t => t.status === "open" && waitGrade(t.waitingSince, data.targets)?.grade === "red").length : 0;
  const threads = data?.threads ?? [];
  const facts = (t: GuestThread) => guestFacts(t, seen[t.id]);
  const names = new Map([...threads.filter(t => t.propertyId && t.propertyName).map(t => [t.propertyId!, t.propertyName!] as const), ...properties.map(x => [x.id, x.name] as const)]);
  const propertyOptions = propertyChips(threads, facts, names, chip);
  const where = propertyOptions.some(x => x.id === property) ? property : ALL_PROPERTIES;
  const search = useListSearch(filterInbox(threads, facts, chip, where), t => [t.guestName, t.propertyName, t.reservationRef, CHANNEL_LABEL[t.channel], t.preview]), shown = search.shown;
  return (
    <View style={{ gap: 16 }}>
      {data && !data.connected && <View style={[ui.row, { gap: 10, padding: 14, borderRadius: 16, backgroundColor: p.wash, alignItems: "flex-start" }]}>
        <Feather name="info" size={16} color={p.primary} style={{ marginTop: 2 }} />
        <Text style={[ui.small, { color: p.text, flex: 1 }]}>The channel manager isn’t connected yet, so messages don’t arrive here by themselves. Log each guest message as it comes in and record your reply: reply times and bonuses count from these.</Text>
      </View>}
      <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
        <Button label="Log a guest message" icon="plus" primary p={p} onPress={() => setLogging(true)} />
        <RefreshButton p={p} onPress={() => void load()} />
      </View>
      {data && <InboxChips p={p} chips={GUEST_CHIPS} chip={chip} counts={chipCounts(threads, facts, GUEST_CHIPS, where)} onChip={setChip} properties={propertyOptions} property={where} onProperty={setProperty} />}
      {red > 0 && <Notice text={`${red} guest${red === 1 ? " has" : "s have"} waited longer than ${data?.targets.amberMinutes} minutes.`} p={p} tone="bad" />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {data && <ListSearchBox p={p} search={search} nouns="conversations" />}
      {!data && !error ? <Loading p={p} /> : data && !search.missed && (
        <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, gap: 0 }]}>
          {shown.length ? shown.map((t, i) => <Pop key={t.id} active={t.id === openId}><ThreadRow p={p} t={t} targets={data.targets} unread={facts(t).unread} first={i === 0} onPress={() => open(t.id)} /></Pop>)
            : <Text style={[ui.small, { color: p.muted, paddingVertical: 16 }]}>{emptyMessage(chip, "guests", where !== ALL_PROPERTIES ? names.get(where) : undefined)}</Text>}
        </View>
      )}
      {logging && <LogMessageSheet p={p} properties={properties} onClose={() => setLogging(false)} onDone={id => { setLogging(false); void load(); onChanged?.(); if (id) open(id); }} />}
      {openId && <ThreadSheet key={openId} p={p} threadId={openId} properties={properties} onClose={() => open(null)} onChanged={() => { void load(); onChanged?.(); }} />}
    </View>
  );
}
