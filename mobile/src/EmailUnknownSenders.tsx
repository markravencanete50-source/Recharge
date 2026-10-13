import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { z } from "zod";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { ListSearchBox, SearchPicker, useListSearch } from "./SearchPicker";
import { Button, message, Notice } from "./LiveKit";
import { readChat, readEmailInbox, writeEmailInbox } from "./backend/client";
import { chatPeopleSchema, chatTime } from "../../lib/workspace-chat-policy";
import { unknownSendersSchema } from "../../lib/email-inbox-policy";
import { ui, type Palette } from "./theme";

// Email to ownerrelations@ from an address Recharge does not know: it waits here for Client relations. Assigning it to an owner posts it
// into that owner's conversation and remembers the address, so their next emails land there by themselves. Dismissing hides it.
// Nothing is shown while the list is empty (or while this person is not allowed to see it).
export function EmailUnknownSenders({ p, onChanged }: { p: Palette; onChanged: () => void }) {
  const [rows, setRows] = useState<z.infer<typeof unknownSendersSchema>["senders"]>([]);
  const [owners, setOwners] = useState<{ id: string; label: string }[]>([]);
  const [open, setOpen] = useState<string | null>(null), [ownerId, setOwnerId] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setRows(unknownSendersSchema.parse((await readEmailInbox()).data).senders); }
    catch { setRows([]); }
  }, []);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  useEffect(() => {
    if (!open || owners.length) return;
    readChat({ section: "people" }).then(r => setOwners(chatPeopleSchema.parse(r.data).owners.map(x => ({ id: x.userId, label: x.fullName })))).catch(e => setError(message(e)));
  }, [open, owners.length]);
  const search = useListSearch(rows, r => [r.from, r.name, r.subject]);
  const options = useMemo(() => owners, [owners]);
  if (!rows.length) return null;
  async function act(action: Parameters<typeof writeEmailInbox>[0]) {
    if (busy) return;
    setBusy(true); setError("");
    try { await writeEmailInbox(action); setOpen(null); setOwnerId(""); await load(); onChanged(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <View style={{ gap: 6, padding: 12, borderRadius: 16, backgroundColor: p.wash }}>
      <Text accessibilityRole="header" style={{ color: p.text, fontWeight: "600", fontSize: 14 }}>Unknown senders ({rows.length})</Text>
      <Text style={[ui.small, { color: p.muted }]}>Email to ownerrelations@ from an address we don’t know yet. Choose the owner it belongs to.</Text>
      <ListSearchBox p={p} search={search} nouns="emails" />
      {search.shown.map(r => (
        <View key={r.id} style={{ gap: 6, borderTopWidth: 1, borderColor: p.border, paddingTop: 6 }}>
          <MotionPress accessibilityRole="button" accessibilityState={{ expanded: open === r.id }} accessibilityLabel={`${r.name ?? r.from}, ${r.subject ?? "no subject"}`} onPress={() => { setOpen(open === r.id ? null : r.id); setOwnerId(""); setError(""); }}
            style={[ui.row, { gap: 8, minHeight: 40 }]}>
            <Text numberOfLines={1} style={{ color: p.text, fontSize: 14, fontWeight: "500", flexShrink: 1 }}>{r.name ?? r.from}</Text>
            <Text numberOfLines={1} style={[ui.small, { color: p.muted, flex: 1 }]}>{r.subject ?? ""}</Text>
            <Text style={[ui.small, { color: p.muted }]}>{chatTime(r.receivedAt)}</Text>
          </MotionPress>
          {open === r.id && <View style={{ gap: 8 }}>
            <Text style={[ui.small, { color: p.muted }]}>{r.from}</Text>
            <Text selectable style={{ color: p.text, fontSize: 14, lineHeight: 20 }}>{r.body}</Text>
            <SearchPicker p={p} options={options} value={ownerId} onChange={setOwnerId} placeholder="Search owner" nouns="owners" empty="No owners to choose from." />
            <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              <Button label={busy ? "Saving…" : "Assign to owner"} icon="check" primary p={p} disabled={busy || !ownerId} onPress={() => void act({ action: "assign", id: r.id, ownerId })} />
              <Button label="Dismiss" icon="x" p={p} disabled={busy} onPress={() => void act({ action: "dismiss", id: r.id })} />
            </View>
          </View>}
        </View>
      ))}
      {!!error && <Notice text={error} p={p} tone="bad" />}
    </View>
  );
}
