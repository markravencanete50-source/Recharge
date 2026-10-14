import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { z } from "zod";
import { Text } from "./Typography";
import { ExpandChevron, MotionPress, SwapIn } from "./motion";
import { Button, Field, Loading, message, Notice, Tag } from "./LiveKit";
import { Pills } from "./Pills";
import { readChat, writeChat } from "./backend/client";
import { ui, type Palette } from "./theme";
import { fillReply, repliesFor, SAVED_AUDIENCE_LABEL, SAVED_AUDIENCES, savedRepliesSchema, type SavedReply } from "../../lib/workspace-chat-policy";
import { SearchBox } from "./SearchPicker";

// Saved replies in a reply box: pick one and its text goes into the box, with {guest} and
// {property} filled in, ready to edit before sending. Admins and the Stays team keep the list here too.
type Audience = (typeof SAVED_AUDIENCES)[number];

function ReplyForm({ p, reply, onCancel, onSaved }: { p: Palette; reply: SavedReply | null; onCancel: () => void; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState(reply?.title ?? ""), [body, setBody] = useState(reply?.body ?? ""), [audience, setAudience] = useState<Audience>(reply?.audience ?? "all");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save() {
    if (busy) return;
    if (title.trim().length < 2 || body.trim().length < 2) { setError("Add a short title and the reply."); return; }
    setBusy(true); setError("");
    try {
      await writeChat({ action: "saveReply", ...(reply ? { replyId: reply.id, version: reply.version } : {}), title: title.trim(), body: body.trim(), audience });
      await onSaved();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <View style={{ gap: 10 }}>
      <Field label="Title" value={title} onChange={setTitle} p={p} placeholder="For example: Check-in time" />
      <Field label="Reply" value={body} onChange={setBody} p={p} multiline placeholder="Hi {guest}, check-in at {property} is from 3pm." />
      <Text style={[ui.small, { color: p.muted }]}>{"Use {guest} for the first name of the person you are writing to and {property} for the property."}</Text>
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>For</Text>
      <Pills p={p} values={SAVED_AUDIENCES} value={audience} onChange={setAudience} label={v => SAVED_AUDIENCE_LABEL[v]} />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
        <Button label={busy ? "Saving…" : "Save reply"} icon="check" primary p={p} disabled={busy} onPress={() => void save()} />
        <Button label="Cancel" icon="x" p={p} disabled={busy} onPress={onCancel} />
      </View>
    </View>
  );
}

export function SavedReplies({ p, audience, fill, onInsert }: { p: Palette; audience: "guest" | "owner"; fill: { name?: string | null; property?: string | null }; onInsert: (text: string) => void }) {
  const [open, setOpen] = useState(false), [managing, setManaging] = useState(false);
  const [data, setData] = useState<z.infer<typeof savedRepliesSchema> | null>(null), [error, setError] = useState("");
  const [editing, setEditing] = useState<SavedReply | "new" | null>(null), [confirm, setConfirm] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const load = useCallback(async () => {
    try { setData(savedRepliesSchema.parse((await readChat({ section: "savedReplies" })).data)); setError(""); } catch (e) { setError(message(e)); }
  }, []);
  useEffect(() => { if (open && !data) queueMicrotask(() => void load()); }, [open, data, load]);
  const mine = data ? repliesFor(data.replies, audience) : [];
  const q = query.trim().toLowerCase();
  const matching = q ? mine.filter(r => (r.title + " " + r.body).toLowerCase().includes(q)) : mine;
  async function remove(reply: SavedReply) {
    if (busy) return;
    setBusy(true); setError("");
    try { await writeChat({ action: "deleteReply", replyId: reply.id, version: reply.version }); setConfirm(null); await load(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <View style={{ gap: 8 }}>
      <MotionPress accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel="Saved replies" onPress={() => { setOpen(!open); setManaging(false); setEditing(null); }}
        style={[ui.row, { alignSelf: "flex-start", gap: 6, minHeight: 36, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: open ? p.primary : p.border, backgroundColor: open ? p.wash : p.surface }]}>
        <Feather name="bookmark" size={14} color={p.primary} />
        <Text style={{ color: p.primary, fontSize: 13, fontWeight: "700" }}>Saved replies</Text>
        <ExpandChevron open={open} size={14} color={p.primary} />
      </MotionPress>
      {open && (
        <SwapIn swapKey={managing ? "manage" + (editing === "new" ? "new" : editing?.id ?? "") : "pick"} style={{ gap: 8, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: p.border, backgroundColor: p.background }}>
          {!data && !error && <Loading p={p} rows={2} />}
          {!!error && <Notice text={error} p={p} tone="bad" />}
          {data && !managing && <>
            {mine.length > 6 && <SearchBox p={p} value={query} onChange={setQuery} placeholder="Search saved replies" />}
            {matching.map(r => (
              <MotionPress key={r.id} accessibilityRole="button" accessibilityLabel={`Use saved reply: ${r.title}`} onPress={() => { onInsert(fillReply(r.body, fill)); setOpen(false); }}
                style={{ gap: 2, padding: 10, borderRadius: 12, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }}>
                <Text numberOfLines={1} style={{ color: p.text, fontWeight: "700", fontSize: 14 }}>{r.title}</Text>
                <Text numberOfLines={2} style={[ui.small, { color: p.muted }]}>{fillReply(r.body, fill)}</Text>
              </MotionPress>
            ))}
            {!mine.length && <Text style={[ui.small, { color: p.muted }]}>{data.canEdit ? "No saved replies yet. Add the answers you send most often." : "No saved replies yet. Admins and the Stays team can add them."}</Text>}
            {!!mine.length && !matching.length && <Text style={[ui.small, { color: p.muted }]}>No saved replies match.</Text>}
            {data.canEdit && <MotionPress accessibilityRole="button" onPress={() => setManaging(true)} style={[ui.row, { gap: 6, minHeight: 36, alignSelf: "flex-start" }]}>
              <Feather name="settings" size={14} color={p.primary} /><Text style={[ui.small, { color: p.primary, fontWeight: "700" }]}>Manage saved replies</Text>
            </MotionPress>}
          </>}
          {data && managing && (editing ? <ReplyForm key={editing === "new" ? "new" : editing.id + editing.version} p={p} reply={editing === "new" ? null : editing} onCancel={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} /> : <>
            <View style={[ui.between, { gap: 10 }]}>
              <Text style={{ color: p.text, fontWeight: "700", flex: 1 }}>Saved replies · {data.replies.length}</Text>
              <MotionPress accessibilityRole="button" onPress={() => setManaging(false)} style={{ minHeight: 36, justifyContent: "center" }}><Text style={[ui.small, { color: p.primary, fontWeight: "700" }]}>Done</Text></MotionPress>
            </View>
            <Button label="Add a saved reply" icon="plus" p={p} onPress={() => setEditing("new")} />
            {data.replies.map(r => (
              <View key={r.id} style={{ gap: 6, padding: 10, borderRadius: 12, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }}>
                <View style={[ui.row, { gap: 8 }]}>
                  <Text numberOfLines={1} style={{ color: p.text, fontWeight: "700", flex: 1 }}>{r.title}</Text>
                  <Tag label={SAVED_AUDIENCE_LABEL[r.audience]} tone="plain" p={p} />
                </View>
                <Text numberOfLines={3} style={[ui.small, { color: p.muted }]}>{r.body}</Text>
                {confirm === r.id ? (
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    <Button label={busy ? "Deleting…" : "Delete it"} icon="trash-2" p={p} disabled={busy} onPress={() => void remove(r)} />
                    <Button label="Keep it" icon="x" p={p} disabled={busy} onPress={() => setConfirm(null)} />
                  </View>
                ) : (
                  <View style={[ui.row, { gap: 16 }]}>
                    <MotionPress accessibilityRole="button" accessibilityLabel={`Edit ${r.title}`} onPress={() => setEditing(r)} style={[ui.row, { gap: 6, minHeight: 36 }]}><Feather name="edit-2" size={14} color={p.primary} /><Text style={[ui.small, { color: p.primary, fontWeight: "700" }]}>Edit</Text></MotionPress>
                    <MotionPress accessibilityRole="button" accessibilityLabel={`Delete ${r.title}`} onPress={() => setConfirm(r.id)} style={[ui.row, { gap: 6, minHeight: 36 }]}><Feather name="trash-2" size={14} color={p.danger} /><Text style={[ui.small, { color: p.danger, fontWeight: "700" }]}>Delete</Text></MotionPress>
                  </View>
                )}
              </View>
            ))}
          </>)}
        </SwapIn>
      )}
    </View>
  );
}
