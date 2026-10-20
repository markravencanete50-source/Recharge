import { useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { Sheet } from "./TeamFlows";
import { Button, Loading, message, Notice } from "./LiveKit";
import { PersonAvatar, roleName } from "./ChatParts";
import { useBlocks } from "./ChatSafety";
import { ui, type Palette } from "./theme";
import { viewMode } from "./backend/client";

// Blocked people (Profile & preferences): who you have blocked, and a way to unblock each.
export function BlockedPeopleSheet({ p, visible, onClose }: { p: Palette; visible: boolean; onClose: () => void }) {
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title="Blocked people" subtitle="You don't see their messages, and they can't start a new direct message with you." icon="people">
      {visible && <BlockedList p={p} />}
    </Sheet>
  );
}
function BlockedList({ p }: { p: Palette }) {
  const blocks = useBlocks();
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState("");
  const readOnly = viewMode().readOnly;
  async function unblock(userId: string) {
    if (busy) return;
    setBusy(userId); setError("");
    try { await blocks.unblock(userId); } catch (e) { setError(message(e)); } finally { setBusy(null); }
  }
  if (!blocks.people) return <Loading p={p} rows={2} />;
  return (
    <>
      {!blocks.people.length && <Notice text="You haven't blocked anyone. To block someone, open the menu on one of their messages, or open the people in a conversation." p={p} />}
      {blocks.people.map(x => (
        <View key={x.userId} style={[ui.row, { gap: 12, minHeight: 58 }]}>
          <PersonAvatar p={p} name={x.fullName} userId={x.userId} photo={x.photo} size={42} />
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <Text numberOfLines={1} style={{ color: p.text, fontWeight: "700" }}>{x.fullName}</Text>
            <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{roleName(x.role)} · blocked {new Date(x.blockedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" })}</Text>
          </View>
          {!readOnly && <Button label={busy === x.userId ? "Unblocking…" : "Unblock"} icon="user-check" p={p} disabled={!!busy} onPress={() => void unblock(x.userId)} />}
        </View>
      ))}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!!blocks.error && !blocks.people.length && <Text style={[ui.small, { color: p.muted }]}>{blocks.error}</Text>}
    </>
  );
}
