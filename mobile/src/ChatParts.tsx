import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Linking, Modal, Platform, Pressable, ScrollView, TextInput, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as ImagePicker from "expo-image-picker";
import { Text } from "./Typography";
import { MotionPress, Pop } from "./motion";
import { Sheet } from "./TeamFlows";
import { Button, Field, Loading, message, Notice } from "./LiveKit";
import { avatarColors } from "./AccountSetup";
import { ui, type Palette } from "./theme";
import { chatFileLinks, profilePhotoSource, readChat, uploadToLink, viewMode, writeChat } from "./backend/client";
import { useBlocks } from "./ChatSafety";
import { chatFilesProblem, chatPeopleSchema, conversationSchema, membersSchema, MAX_CHAT_PHOTOS, MAX_CHAT_VIDEOS, preparedFilesSchema, presenceLabel, presenceOf, REACTIONS,
  type ChatAttachment, type ChatMembers, type ChatReaction, type Conversation } from "../../lib/workspace-chat-policy";
import { ROLE_LABEL } from "../../lib/admin-live";

// Messages, messenger-style: people's photos (with a dot when they are online), photos and a video
// in a message, reactions, and the people in a conversation (adding people to a group, leaving it).
const roleName = (role: string) => ROLE_LABEL[role as keyof typeof ROLE_LABEL] ?? role;
export const initialsOf = (name: string) => name.replace(/^Recharge · /, "").trim().split(/\s+/).slice(0, 2).map(w => w[0] ?? "").join("").toUpperCase() || "R";
const web = Platform.OS === "web";
const sizeLabel = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(bytes >= 10485760 ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

// ---------------------------------------------------------------- people's photos
const photos = new Map<string, Promise<{ uri: string; headers?: Record<string, string> } | null>>();
function usePhoto(userId?: string | null, version?: string | null) {
  const key = userId && version ? userId + ":" + version : "";
  const [loaded, setLoaded] = useState<{ key: string; source: { uri: string; headers?: Record<string, string> } | null } | null>(null);
  useEffect(() => {
    if (!key) return;
    if (!photos.has(key)) photos.set(key, profilePhotoSource(userId!, version!).catch(() => null));
    let active = true;
    void photos.get(key)!.then(source => { if (active) setLoaded({ key, source }); });
    return () => { active = false; };
  }, [key, userId, version]);
  return loaded && loaded.key === key ? loaded.source : null;
}
export function PersonAvatar({ p, name, userId, photo, colour, size = 44, online = false, icon, tint }: { p: Palette; name: string; userId?: string | null; photo?: string | null; colour?: keyof typeof avatarColors | null; size?: number; online?: boolean; icon?: "users" | "home" | "hash"; tint?: string }) {
  const source = usePhoto(userId, photo);
  const [failed, setFailed] = useState(false);
  const dot = Math.max(10, Math.round(size * 0.27));
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: colour ? avatarColors[colour] : tint ?? p.wash }}>
        {source && !failed ? <Image source={source} onError={() => setFailed(true)} style={{ width: size, height: size }} resizeMode="cover" accessibilityLabel={`${name}'s photo`} />
          : icon ? <Feather name={icon} size={Math.round(size * 0.42)} color={p.primary} />
          : <Text style={{ color: colour ? "#FFFFFF" : p.text, fontWeight: "700", fontSize: Math.max(10, Math.round(size * 0.34)) }}>{initialsOf(name)}</Text>}
      </View>
      {online && <View accessibilityLabel="Online" style={{ position: "absolute", right: -1, bottom: -1, width: dot, height: dot, borderRadius: dot / 2, backgroundColor: p.success, borderWidth: 2, borderColor: p.surface }} />}
    </View>
  );
}
// The picture for a conversation: the other person's photo, a group's or channel's icon.
export function ConversationAvatar({ p, c, size = 44 }: { p: Palette; c: Conversation; size?: number }) {
  const icon = c.department ? "hash" as const : c.kind === "group" ? "users" as const : c.kind === "owner" && !c.peer ? "home" as const : undefined;
  return <PersonAvatar p={p} name={c.title} userId={c.peer?.userId} photo={c.peer?.photo} size={size} icon={icon} online={presenceOf(c.peer?.seenAt) === "online"} tint={c.kind === "owner" ? p.cautionWash : undefined} />;
}

// ---------------------------------------------------------------- photos and a video in a message
type Link = { url: string; mime: string; name: string; kind: "image" | "video" };
function useLinks(items: ChatAttachment[]) {
  const ids = items.map(x => x.id).join();
  const [links, setLinks] = useState<Map<string, Link> | null>(null), [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!ids) return;
    let active = true;
    chatFileLinks(ids.split(",")).then(found => { if (active) setLinks(found); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [ids]);
  return { links, failed };
}
function Video({ p, link, width }: { p: Palette; link: Link | undefined; width: number }) {
  if (!link) return <View style={{ width, height: Math.round(width * 0.62), borderRadius: 16, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={p.primary} /></View>;
  // In the browser the video plays here; the phone app opens it in the phone's own player.
  if (web) return createElement("video", { src: link.url, controls: true, preload: "metadata", playsInline: true, "aria-label": link.name || "Video", style: { width, maxHeight: 360, borderRadius: 16, background: "#000", display: "block" } });
  return (
    <MotionPress accessibilityRole="button" accessibilityLabel="Play video" onPress={() => void Linking.openURL(link.url)}
      style={{ width, height: Math.round(width * 0.62), borderRadius: 16, backgroundColor: "#101816", alignItems: "center", justifyContent: "center", gap: 8 }}>
      <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: "rgba(255,255,255,.18)", alignItems: "center", justifyContent: "center" }}><Feather name="play" size={24} color="#FFFFFF" /></View>
      <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "600" }}>Play video</Text>
    </MotionPress>
  );
}
export function Attachments({ p, items, mine }: { p: Palette; items: ChatAttachment[]; mine: boolean }) {
  const { links, failed } = useLinks(items);
  const { width: screen } = useWindowDimensions();
  const [open, setOpen] = useState<number | null>(null);
  const images = items.filter(x => x.kind === "image"), videos = items.filter(x => x.kind === "video");
  const full = Math.min(280, Math.round(screen * 0.68));
  const one = images.length === 1 ? images[0] : null;
  const ratio = one?.width && one.height ? Math.min(1.6, Math.max(0.62, one.width / one.height)) : 4 / 3;
  const tile = images.length === 2 || images.length === 4 ? Math.floor((full - 4) / 2) : Math.floor((full - 8) / 3);
  return (
    <View style={{ gap: 4, alignItems: mine ? "flex-end" : "flex-start" }}>
      {!!images.length && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, width: one ? undefined : images.length === 2 || images.length === 4 ? full : images.length === 3 ? full : full, justifyContent: mine ? "flex-end" : "flex-start" }}>
        {images.map((x, i) => {
          const link = links?.get(x.id), w = one ? full : tile, h = one ? Math.round(full / ratio) : tile;
          return (
            <Pressable key={x.id} accessibilityRole="imagebutton" accessibilityLabel={`Open photo ${i + 1} of ${images.length}`} onPress={() => setOpen(i)}
              style={{ width: w, height: h, borderRadius: one ? 18 : 12, overflow: "hidden", backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}>
              {link ? <Image source={{ uri: link.url }} style={{ width: w, height: h }} resizeMode="cover" accessibilityLabel={x.name || "Photo"} />
                : failed ? <Feather name="image" size={20} color={p.muted} /> : <ActivityIndicator color={p.primary} />}
            </Pressable>
          );
        })}
      </View>}
      {videos.map(x => <Video key={x.id} p={p} link={links?.get(x.id)} width={full} />)}
      <Modal visible={open !== null} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(6,12,10,0.94)", alignItems: "center", justifyContent: "center", padding: 16 }}>
          {open !== null && (() => {
            const x = images[open], link = x ? links?.get(x.id) : undefined;
            return link ? <Image source={{ uri: link.url }} style={{ width: "100%", height: "82%", maxWidth: 1100 }} resizeMode="contain" accessibilityLabel={x.name || "Photo"} /> : <ActivityIndicator color="#FFFFFF" />;
          })()}
          <View style={[ui.row, { gap: 12, marginTop: 14 }]}>
            {images.length > 1 && <MotionPress accessibilityRole="button" accessibilityLabel="Previous photo" onPress={() => setOpen(i => i === null ? null : (i + images.length - 1) % images.length)} style={viewerButton}><Feather name="chevron-left" size={22} color="#FFFFFF" /></MotionPress>}
            {images.length > 1 && open !== null && <Text style={{ color: "#FFFFFF", fontWeight: "600" }}>{open + 1} of {images.length}</Text>}
            {images.length > 1 && <MotionPress accessibilityRole="button" accessibilityLabel="Next photo" onPress={() => setOpen(i => i === null ? null : (i + 1) % images.length)} style={viewerButton}><Feather name="chevron-right" size={22} color="#FFFFFF" /></MotionPress>}
            {open !== null && !!links?.get(images[open]?.id ?? "") && <MotionPress accessibilityRole="link" accessibilityLabel="Open the original" onPress={() => void Linking.openURL(links!.get(images[open].id)!.url)} style={viewerButton}><Feather name="external-link" size={18} color="#FFFFFF" /></MotionPress>}
            <MotionPress accessibilityRole="button" accessibilityLabel="Close" onPress={() => setOpen(null)} style={viewerButton}><Feather name="x" size={20} color="#FFFFFF" /></MotionPress>
          </View>
        </View>
      </Modal>
    </View>
  );
}
const viewerButton = { width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(255,255,255,.14)", alignItems: "center" as const, justifyContent: "center" as const };

// ---------------------------------------------------------------- reactions
export function ReactionChips({ p, reactions, mine, onToggle }: { p: Palette; reactions: ChatReaction[]; mine: boolean; onToggle: (emoji: string) => void }) {
  if (!reactions.length) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, justifyContent: mine ? "flex-end" : "flex-start", marginTop: -2 }}>
      {reactions.map(r => (
        <MotionPress key={r.emoji} accessibilityRole="button" accessibilityState={{ selected: r.mine }} accessibilityLabel={`${r.emoji} from ${r.names.join(", ")}${r.mine ? ". Tap to take yours off" : ""}`} onPress={() => onToggle(r.emoji)}
          style={[ui.row, { gap: 4, minHeight: 28, paddingHorizontal: 8, borderRadius: 999, borderWidth: 1, borderColor: r.mine ? p.primary : p.border, backgroundColor: r.mine ? p.wash : p.surface }]}>
          <Text style={{ fontSize: 14 }}>{r.emoji}</Text>
          {r.count > 1 && <Text style={{ color: p.text, fontSize: 12, fontWeight: "700" }}>{r.count}</Text>}
        </MotionPress>
      ))}
    </View>
  );
}
export function ReactionPicker({ p, current, onPick, onMore }: { p: Palette; current: string | null; onPick: (emoji: string) => void; onMore?: () => void }) {
  return (
    <Pop active>
      <View accessibilityRole="toolbar" style={[ui.row, { gap: 2, padding: 4, borderRadius: 999, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface, ...(web ? { boxShadow: "var(--rc-elev-2)" } : {}) }]}>
        {REACTIONS.map(e => (
          <MotionPress key={e} accessibilityRole="button" accessibilityLabel={`React with ${e}`} accessibilityState={{ selected: current === e }} onPress={() => onPick(e)}
            style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: current === e ? p.wash : "transparent" }}>
            <Text style={{ fontSize: 20 }}>{e}</Text>
          </MotionPress>
        ))}
        {!!onMore && <MotionPress accessibilityRole="button" accessibilityLabel="Report or block" onPress={onMore} style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" }}><Feather name="more-horizontal" size={19} color={p.muted} /></MotionPress>}
      </View>
    </Pop>
  );
}

// ---------------------------------------------------------------- adding photos and a video
export type PendingFile = { key: string; uri: string; file?: File; mime: string; bytes: number; name: string; width?: number; height?: number; kind: "image" | "video"; id?: string; progress: number; status: "uploading" | "ready" | "failed"; error?: string };
const VIDEO_MIME: Record<string, string> = { mov: "video/quicktime", webm: "video/webm", mp4: "video/mp4", m4v: "video/mp4" };
const IMAGE_MIME: Record<string, string> = { png: "image/png", webp: "image/webp", gif: "image/gif", jpg: "image/jpeg", jpeg: "image/jpeg", heic: "image/heic", heif: "image/heic" };
// Photos and a video for the next message: chosen, checked against the limits, then each sent
// straight to storage (with progress) while the message is written.
export function useChatUploads(conversationId: string) {
  const [items, setItems] = useState<PendingFile[]>([]);
  const latest = useRef(items);
  useEffect(() => { latest.current = items; }, [items]);
  const patch = (key: string, change: Partial<PendingFile>) => setItems(list => list.map(x => x.key === key ? { ...x, ...change } : x));
  const upload = useCallback(async (batch: PendingFile[]) => {
    try {
      const made = preparedFilesSchema.parse((await writeChat({ action: "prepareFiles", conversationId, files: batch.map(x => ({ name: x.name.slice(0, 200), mime: x.mime as never, bytes: x.bytes, ...(x.width && x.height ? { width: Math.round(x.width), height: Math.round(x.height) } : {}) })) })).data);
      await Promise.all(batch.map(async (x, i) => {
        const target = made.files[i];
        patch(x.key, { id: target.id, status: "uploading", error: undefined });
        try { await uploadToLink(target.uploadUrl, { uri: x.uri, file: x.file, type: x.mime }, share => patch(x.key, { progress: share })); patch(x.key, { status: "ready", progress: 1 }); }
        catch (e) { patch(x.key, { status: "failed", error: message(e) }); }
      }));
    } catch (e) { for (const x of batch) patch(x.key, { status: "failed", error: message(e) }); }
  }, [conversationId]);
  async function pick(): Promise<string | null> {
    const have = latest.current, left = MAX_CHAT_PHOTOS + MAX_CHAT_VIDEOS - have.length;
    if (left <= 0) return `Up to ${MAX_CHAT_PHOTOS} photos and ${MAX_CHAT_VIDEOS} video at a time.`;
    if (!web) { const permission = await ImagePicker.requestMediaLibraryPermissionsAsync(); if (!permission.granted) return "Allow photo access to add photos and videos."; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], allowsMultipleSelection: true, selectionLimit: left, quality: 0.7 });
    if (result.canceled) return null;
    const chosen: PendingFile[] = [];
    for (const asset of result.assets.slice(0, left)) {
      const name = asset.fileName || asset.file?.name || (asset.type === "video" ? "video.mp4" : "photo.jpg"), ext = name.split(".").pop()?.toLowerCase() ?? "";
      const video = asset.type === "video" || (asset.mimeType ?? "").startsWith("video/");
      const mime = asset.mimeType || (video ? VIDEO_MIME[ext] ?? "video/mp4" : IMAGE_MIME[ext] ?? "image/jpeg");
      let bytes = asset.fileSize ?? asset.file?.size ?? 0;
      if (!bytes) try { bytes = (await (await fetch(asset.uri)).blob()).size; } catch { bytes = 0; }
      chosen.push({ key: Math.random().toString(36).slice(2), uri: asset.uri, file: asset.file, mime, bytes: Math.max(1, bytes), name, width: asset.width || undefined, height: asset.height || undefined, kind: video ? "video" : "image", progress: 0, status: "uploading" });
    }
    if (chosen.some(x => x.mime === "image/heic")) return "HEIC photos can't be shown in every browser. Choose a JPG or PNG, or share it from your phone's Photos app.";
    const problem = chatFilesProblem([...have, ...chosen]);
    if (problem) return problem;
    setItems(list => [...list, ...chosen]);
    void upload(chosen);
    return null;
  }
  function remove(key: string) {
    const item = latest.current.find(x => x.key === key);
    setItems(list => list.filter(x => x.key !== key));
    if (item?.id) void writeChat({ action: "discardFiles", ids: [item.id] }).catch(() => undefined);
  }
  function retry(key: string) {
    const item = latest.current.find(x => x.key === key);
    if (!item) return;
    if (item.id) void writeChat({ action: "discardFiles", ids: [item.id] }).catch(() => undefined);
    const again = { ...item, id: undefined, progress: 0, status: "uploading" as const, error: undefined };
    patch(key, again);
    void upload([again]);
  }
  const ready = items.filter(x => x.status === "ready" && x.id).map(x => x.id!);
  return { items, pick, remove, retry, clear: () => setItems([]), ready, uploading: items.some(x => x.status === "uploading"), failed: items.some(x => x.status === "failed") };
}
export function PendingFiles({ p, items, onRemove, onRetry }: { p: Palette; items: PendingFile[]; onRemove: (key: string) => void; onRetry: (key: string) => void }) {
  if (!items.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
      {items.map(x => (
        <View key={x.key} style={{ width: 76, height: 76, borderRadius: 14, overflow: "hidden", backgroundColor: p.wash, borderWidth: 1, borderColor: x.status === "failed" ? p.danger : p.border }}>
          {x.kind === "image" ? <Image source={{ uri: x.uri }} style={{ width: 76, height: 76 }} resizeMode="cover" accessibilityLabel={x.name} />
            : <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 2, padding: 4 }}><Feather name="film" size={20} color={p.primary} /><Text numberOfLines={1} style={{ color: p.muted, fontSize: 10 }}>{sizeLabel(x.bytes)}</Text></View>}
          {x.status !== "ready" && <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: 0, backgroundColor: "rgba(0,0,0,.35)", alignItems: "center", justifyContent: "center" }}>
            {x.status === "failed" ? <MotionPress accessibilityRole="button" accessibilityLabel={`Try ${x.name} again`} onPress={() => onRetry(x.key)} style={{ alignItems: "center", gap: 2 }}><Feather name="refresh-cw" size={18} color="#FFFFFF" /><Text style={{ color: "#FFFFFF", fontSize: 10, fontWeight: "700" }}>Retry</Text></MotionPress>
              : <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "800" }}>{Math.round(x.progress * 100)}%</Text>}
          </View>}
          {x.status === "uploading" && <View style={{ position: "absolute", left: 0, bottom: 0, height: 3, width: `${Math.max(4, x.progress * 100)}%`, backgroundColor: p.primary }} />}
          <MotionPress accessibilityRole="button" accessibilityLabel={`Remove ${x.name}`} onPress={() => onRemove(x.key)}
            style={{ position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,.6)", alignItems: "center", justifyContent: "center" }}>
            <Feather name="x" size={13} color="#FFFFFF" />
          </MotionPress>
        </View>
      ))}
    </ScrollView>
  );
}

// ---------------------------------------------------------------- who is in a conversation
// The people in a group (or a channel, or an owner's conversation), with photos and who is
// online. In a group anyone adds people or renames it, whoever started it (or an admin) removes
// people, and anyone leaves. From a one-to-one conversation, adding people starts a new group.
export function useMembers(conversationId: string, every = 60000) {
  const [members, setMembers] = useState<ChatMembers | null>(null);
  const load = useCallback(async () => { try { setMembers(membersSchema.parse((await readChat({ section: "members", conversationId })).data)); } catch { /* the header shows without them */ } }, [conversationId]);
  useEffect(() => { queueMicrotask(() => void load()); const timer = setInterval(() => void load(), every); return () => clearInterval(timer); }, [load, every]);
  return { members, reload: load };
}
export function MemberFaces({ p, members, onPress, compact = false }: { p: Palette; members: ChatMembers; onPress: () => void; compact?: boolean }) {
  const others = members.members.filter(m => !m.you), shown = others.slice(0, compact ? 2 : 4), online = others.filter(m => presenceOf(m.seenAt) === "online").length;
  return (
    <MotionPress accessibilityRole="button" accessibilityLabel={`${members.members.length} people${online ? `, ${online} online` : ""}. See who is here`} onPress={onPress} style={[ui.row, { gap: 8, minHeight: 40, paddingLeft: 6, paddingRight: 10, borderRadius: 999, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }]}>
      <View style={[ui.row]}>
        {shown.map((m, i) => <View key={m.userId} style={{ marginLeft: i ? -8 : 0, borderRadius: 15, borderWidth: 2, borderColor: p.surface }}><PersonAvatar p={p} name={m.fullName} userId={m.userId} photo={m.photo} size={26} /></View>)}
      </View>
      <Text style={{ color: p.text, fontSize: 13, fontWeight: "700" }}>{members.members.length}</Text>
      {online > 0 && <View style={[ui.row, { gap: 4 }]}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.success }} />{!compact && <Text style={{ color: p.muted, fontSize: 12, fontWeight: "600" }}>{online} online</Text>}</View>}
      {!compact && <Feather name="user-plus" size={15} color={p.muted} />}
    </MotionPress>
  );
}
export function MembersSheet({ p, conversation, members, onClose, onChanged, onLeft, onOpen }: { p: Palette; conversation: Conversation; members: ChatMembers | null; onClose: () => void; onChanged: () => void; onLeft: () => void; onOpen: (c: Conversation) => void }) {
  const [adding, setAdding] = useState(false), [renaming, setRenaming] = useState(false), [title, setTitle] = useState(conversation.named ? conversation.title : "");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [confirmLeave, setConfirmLeave] = useState(false);
  const group = conversation.kind === "group" && !conversation.department, direct = conversation.kind === "direct";
  const me = members?.members.find(m => m.you);
  // Blocking someone from the people in a conversation: it only hides their messages for you.
  const blocks = useBlocks(), [blocking, setBlocking] = useState<string | null>(null), readOnly = viewMode().readOnly;
  async function run(action: Parameters<typeof writeChat>[0], after?: (data: unknown) => void) {
    if (busy) return;
    setBusy(true); setError("");
    try { const result = await writeChat(action); after?.(result.data); onChanged(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const subtitle = conversation.department ? (conversation.department === "all" ? "Everyone on the team" : `Everyone in ${conversation.title}, by rota department. Admins can read every channel.`)
    : conversation.kind === "owner" ? "The owner and the team who answer them" : direct ? "Add people to start a group" : `${members?.members.length ?? "…"} people`;
  return (
    <Sheet palette={p} visible onClose={onClose} title={group ? conversation.title : direct ? "People" : conversation.title} subtitle={subtitle} icon="people">
      {!members ? <Loading p={p} rows={3} /> : <View style={{ gap: 4 }}>
        {members.members.map(m => {
          const status = presenceOf(m.seenAt), seen = presenceLabel(m.seenAt);
          const blocked = blocks.ids.has(m.userId), first = m.fullName.split(/\s+/)[0] || "them";
          return (
            <View key={m.userId} style={{ gap: 6 }}>
            <View style={[ui.row, { gap: 12, minHeight: 58, paddingHorizontal: 6 }]}>
              <PersonAvatar p={p} name={m.fullName} userId={m.userId} photo={m.photo} size={42} online={status === "online"} />
              <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                <Text numberOfLines={1} style={{ color: p.text, fontWeight: "700" }}>{m.fullName}{m.you ? " (you)" : ""}</Text>
                <Text numberOfLines={1} style={[ui.small, { color: status === "online" && !m.you ? p.success : p.muted }]}>{[m.you ? null : seen || null, roleName(m.role), m.creator ? "Started the group" : null, blocked ? "Blocked" : null].filter(Boolean).join(" · ")}</Text>
                {!!m.about && <Text numberOfLines={2} style={[ui.small, { color: p.muted }]}>{m.about}</Text>}
              </View>
              {members.canRemove && group && !m.you && <MotionPress accessibilityRole="button" accessibilityLabel={`Remove ${m.fullName} from the group`} disabled={busy} onPress={() => void run({ action: "removeMember", conversationId: conversation.id, userId: m.userId })}
                style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: p.wash }}><Feather name="user-minus" size={16} color={p.danger} /></MotionPress>}
              {!m.you && !readOnly && <MotionPress accessibilityRole="button" accessibilityLabel={blocked ? `Unblock ${m.fullName}` : `Block ${m.fullName}`} disabled={busy}
                onPress={() => blocked ? void run({ action: "unblockUser", userId: m.userId }, () => void blocks.reload()) : setBlocking(blocking === m.userId ? null : m.userId)}
                style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: blocked ? p.primary : p.wash }}><Feather name={blocked ? "user-check" : "slash"} size={16} color={blocked ? p.onPrimary : p.muted} /></MotionPress>}
            </View>
            {blocking === m.userId && !blocked && (
              <View style={{ gap: 8, padding: 12, borderRadius: 16, backgroundColor: p.wash }}>
                <Text style={[ui.small, { color: p.text }]}>Block {first}? You won&apos;t see their messages and they can&apos;t start a new direct message with you. They aren&apos;t told. You can unblock them here or in Profile &amp; preferences.</Text>
                <View style={[ui.row, { gap: 8 }]}>
                  <Button label={busy ? "Blocking…" : `Block ${first}`} icon="slash" primary p={p} disabled={busy} onPress={() => void run({ action: "blockUser", userId: m.userId }, () => { setBlocking(null); void blocks.reload(); })} />
                  <Button label="Cancel" p={p} onPress={() => setBlocking(null)} />
                </View>
              </View>
            )}
            </View>
          );
        })}
      </View>}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {(group && members?.canAdd || direct) && !adding && <Button label={direct ? "Add people (starts a group)" : "Add people"} icon="user-plus" primary p={p} onPress={() => setAdding(true)} />}
      {adding && members && <AddPeople p={p} exclude={members.members.map(m => m.userId)} busy={busy} onCancel={() => setAdding(false)}
        onAdd={ids => direct
          ? void run({ action: "startGroup", userIds: [...members.members.filter(m => !m.you).map(m => m.userId), ...ids] }, data => onOpen(conversationSchema.parse(data)))
          : void run({ action: "addMembers", conversationId: conversation.id, userIds: ids }, () => setAdding(false))} />}
      {group && (renaming
        ? <View style={{ gap: 8 }}>
            <Field label="Group name" value={title} onChange={setTitle} p={p} placeholder="Leave empty to name it after its people" />
            <View style={[ui.row, { gap: 8 }]}>
              <Button label="Save name" icon="check" primary p={p} disabled={busy || (title.trim().length > 0 && title.trim().length < 2)} onPress={() => void run({ action: "renameGroup", conversationId: conversation.id, ...(title.trim() ? { title: title.trim() } : {}) }, () => setRenaming(false))} />
              <Button label="Cancel" p={p} onPress={() => setRenaming(false)} />
            </View>
          </View>
        : <Button label="Rename the group" icon="edit-2" p={p} onPress={() => setRenaming(true)} />)}
      {group && me && (confirmLeave
        ? <View style={{ gap: 8 }}>
            <Notice text="You'll stop seeing this group. Someone in it can add you again." p={p} />
            <View style={[ui.row, { gap: 8 }]}>
              <Button label={busy ? "Leaving…" : "Leave the group"} icon="log-out" primary p={p} disabled={busy} onPress={() => void run({ action: "removeMember", conversationId: conversation.id, userId: me.userId }, () => onLeft())} />
              <Button label="Stay" p={p} onPress={() => setConfirmLeave(false)} />
            </View>
          </View>
        : <Button label="Leave the group" icon="log-out" p={p} onPress={() => setConfirmLeave(true)} />)}
    </Sheet>
  );
}
function AddPeople({ p, exclude, busy, onAdd, onCancel }: { p: Palette; exclude: string[]; busy: boolean; onAdd: (ids: string[]) => void; onCancel: () => void }) {
  const [people, setPeople] = useState<{ userId: string; fullName: string; role: string; photo: string | null; seenAt: string | null }[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]), [query, setQuery] = useState(""), [error, setError] = useState("");
  useEffect(() => { readChat({ section: "people" }).then(r => setPeople(chatPeopleSchema.parse(r.data).team)).catch(e => setError(message(e))); }, []);
  const shown = useMemo(() => (people ?? []).filter(x => !exclude.includes(x.userId) && x.fullName.toLowerCase().includes(query.trim().toLowerCase())), [people, exclude, query]);
  return (
    <View style={{ gap: 8, padding: 12, borderRadius: 18, borderWidth: 1, borderColor: p.border, backgroundColor: p.background }}>
      <Text style={{ color: p.text, fontWeight: "700" }}>Add people</Text>
      <TextInput value={query} onChangeText={setQuery} placeholder="Search the team" placeholderTextColor={p.muted} accessibilityLabel="Search the team" style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: p.controlBorder, backgroundColor: p.surface, color: p.text, fontFamily: "Montserrat_500Medium" }} />
      {!people && !error && <Loading p={p} rows={2} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {people && !shown.length && <Text style={[ui.small, { color: p.muted }]}>{query.trim() ? "Nobody matches." : "Everyone on the team is already here."}</Text>}
      <View style={{ maxHeight: 280 }}><ScrollView contentContainerStyle={{ gap: 4 }}>
        {shown.map(x => {
          const on = picked.includes(x.userId);
          return (
            <MotionPress key={x.userId} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={x.fullName} onPress={() => setPicked(on ? picked.filter(y => y !== x.userId) : [...picked, x.userId])}
              style={[ui.row, { gap: 10, minHeight: 50, paddingHorizontal: 8, borderRadius: 12, backgroundColor: on ? p.wash : "transparent" }]}>
              <PersonAvatar p={p} name={x.fullName} userId={x.userId} photo={x.photo} size={32} online={presenceOf(x.seenAt) === "online"} />
              <Text numberOfLines={1} style={{ color: p.text, flex: 1, fontWeight: "600" }}>{x.fullName}</Text>
              <Feather name={on ? "check-circle" : "circle"} size={20} color={on ? p.primary : p.muted} />
            </MotionPress>
          );
        })}
      </ScrollView></View>
      <View style={[ui.row, { gap: 8 }]}>
        <Button label={busy ? "Adding…" : picked.length ? `Add ${picked.length} ${picked.length === 1 ? "person" : "people"}` : "Add"} icon="user-plus" primary p={p} disabled={busy || !picked.length} onPress={() => onAdd(picked)} />
        <Button label="Cancel" p={p} onPress={onCancel} />
      </View>
    </View>
  );
}
