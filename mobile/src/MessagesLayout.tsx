import type { ReactNode } from "react";
import { TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { ui, type Palette } from "./theme";
import { MESSAGE_STATUSES, MESSAGE_STATUS_LABEL, type MessageStatus } from "../../lib/inbox-filters";
import type { IconName } from "./LiveKit";

// The pieces every Messages tab shares (Lee, round 5: "like a messenger or WhatsApp"): one search box with a small
// action beside it, the three statuses for Guests and Clients, a quiet one-line note, and the list with the open
// conversation beside it on a wide screen, or in its place on a phone.

// Needs a reply in the attention colour, Engaged in green, Closed plain.
const STATUS_INK = (p: Palette): Record<MessageStatus, string> => ({ reply: p.waiting, waiting: p.success, closed: p.muted });

export function StatusFilter({ p, value, counts, onChange }: { p: Palette; value: MessageStatus; counts: Record<MessageStatus, number>; onChange: (s: MessageStatus) => void }) {
  const ink = STATUS_INK(p);
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
      {MESSAGE_STATUSES.map(s => {
        const on = s === value;
        return (
          <MotionPress key={s} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${MESSAGE_STATUS_LABEL[s]}, ${counts[s]}`} onPress={() => onChange(s)}
            style={[ui.row, { gap: 6, minHeight: 36, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: on ? ink[s] : p.border, backgroundColor: on ? p.wash : "transparent" }]}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: ink[s] }} />
            <Text style={{ color: on ? p.text : p.muted, fontSize: 13, fontWeight: on ? "600" : "400" }}>{MESSAGE_STATUS_LABEL[s]}</Text>
            <Text style={{ color: on ? ink[s] : p.muted, fontSize: 13, fontVariant: ["tabular-nums"] }}>{counts[s]}</Text>
          </MotionPress>
        );
      })}
    </View>
  );
}

// One search box, filtering as you type, with an optional small icon button beside it (log a guest message, new message).
export function SearchBar({ p, value, onChange, placeholder, action }: { p: Palette; value: string; onChange: (v: string) => void; placeholder: string; action?: { icon: IconName; label: string; onPress: () => void } }) {
  return (
    <View style={[ui.row, { gap: 8 }]}>
      <View style={[ui.row, { flex: 1, minWidth: 0, gap: 8, minHeight: 42, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: p.controlBorder, backgroundColor: p.background }]}>
        <Feather name="search" size={16} color={p.muted} />
        <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={p.muted} accessibilityLabel={placeholder} autoCorrect={false}
          style={{ flex: 1, minWidth: 0, minHeight: 40, color: p.text, fontFamily: "Montserrat_400Regular", fontSize: 14 }} />
        {!!value && <MotionPress accessibilityRole="button" accessibilityLabel="Clear the search" onPress={() => onChange("")} style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}><Feather name="x" size={15} color={p.muted} /></MotionPress>}
      </View>
      {action && <MotionPress accessibilityRole="button" accessibilityLabel={action.label} onPress={action.onPress}
        style={{ width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: p.primary }}>
        <Feather name={action.icon} size={18} color={p.onPrimary} />
      </MotionPress>}
    </View>
  );
}

// A quiet note (for example, guests who have waited too long). It wraps on a narrow phone rather than being cut short
// (Session E's review, item 19); the icon stays beside the first line.
export function QuietLine({ p, icon = "clock", text, tone = "plain" }: { p: Palette; icon?: IconName; text: string; tone?: "plain" | "bad" }) {
  const ink = tone === "bad" ? p.danger : p.muted;
  return (
    <View accessible accessibilityLiveRegion="polite" style={[ui.row, { gap: 6, alignItems: "flex-start" }]}>
      <Feather name={icon} size={13} color={ink} style={{ marginTop: 3 }} />
      <Text style={[ui.small, { color: ink, flex: 1 }]}>{text}</Text>
    </View>
  );
}

// The list and the open conversation. Wide screens: the list on the left, the conversation on the right. Phones: the
// list, then the conversation full width in its place (it carries its own back arrow).
export function MessagesSplit({ p, desktop, list, detail }: { p: Palette; desktop: boolean; list: ReactNode; detail: ReactNode | null }) {
  if (!desktop) return <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border }]}>{detail ?? list}</View>;
  return (
    <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, flexDirection: "row", gap: 0, padding: 0, alignItems: "stretch", overflow: "hidden" }]}>
      <View style={{ width: 360, padding: 14, gap: 10, borderRightWidth: 1, borderColor: p.border }}>{list}</View>
      <View style={{ flex: 1, minWidth: 0, padding: 16 }}>
        {detail ?? <View style={{ flex: 1, alignItems: "center", justifyContent: "center", minHeight: 420, gap: 8 }}><Feather name="message-circle" size={28} color={p.muted} /><Text style={{ color: p.muted }}>Choose a conversation</Text></View>}
      </View>
    </View>
  );
}

// The top of an open conversation: a back arrow on a phone, then whatever identifies it.
export function ThreadHeader({ p, onBack, children, actions }: { p: Palette; onBack?: () => void; children: ReactNode; actions?: ReactNode }) {
  return (
    <View style={[ui.row, { gap: 10, paddingBottom: 10, borderBottomWidth: 1, borderColor: p.border }]}>
      {onBack && <MotionPress accessibilityRole="button" accessibilityLabel="Back to messages" onPress={onBack} style={{ minWidth: 40, minHeight: 40, alignItems: "center", justifyContent: "center" }}><Feather name="arrow-left" size={21} color={p.text} /></MotionPress>}
      <View style={[ui.row, { flex: 1, minWidth: 0, gap: 10 }]}>{children}</View>
      {actions}
    </View>
  );
}
