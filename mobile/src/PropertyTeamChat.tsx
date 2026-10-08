import { createContext, useContext, useState } from "react";
import { View } from "react-native";
import { Button, message, Notice } from "./LiveKit";
import { writeChat } from "./backend/client";
import { conversationSchema } from "../../lib/workspace-chat-policy";
import type { Palette } from "./theme";

// Opens Messages on a conversation. The workspace provides it; outside the workspace it is absent
// and the button below hides itself.
export const OpenMessagesContext = createContext<((conversationId: string) => void) | null>(null);

// "Message the property team": finds or starts the group conversation with the team on a property
// (or on one job there: pass its workId), then opens it in Messages.
export function PropertyTeamChatButton({ palette: p, propertyId, workId, title }: { palette: Palette; propertyId: string; workId?: string; title?: string }) {
  const open = useContext(OpenMessagesContext);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (!open) return null;
  async function start() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const conversation = conversationSchema.parse((await writeChat({ action: "startProperty", propertyId, ...(workId ? { workId } : {}) })).data);
      open!(conversation.id);
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <View style={{ gap: 8 }}>
      <Button label={busy ? "Opening…" : title || (workId ? "Message the team about this job" : "Message the property team")} icon="message-circle" p={p} disabled={busy} onPress={() => void start()} />
      {!!error && <Notice text={error} p={p} tone="bad" />}
    </View>
  );
}
