import { createContext, useContext, useState } from "react";
import { Platform, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress, Stagger } from "./motion";
import type { IconName } from "./LiveKit";
import { space, ui, type Palette } from "./theme";

// Each tool on a page of its own (Lee, 16 October 2026: "If I click Limit Changer all I can see is Limit Changer").
// A tool opened directly (the left panel, search, a Home card, a link or a notification) shows only itself: a link back
// to where it lives, its own heading and its content, with no picker to jump to another tool. The place it lives
// (the Management centre, the Reports hub) lists its tools as cards, one per tool, each opening that tool's page.
//
// A screen that already prints its own heading (Limit Changer, Daily tasks…) leaves it out on a tool page, where
// ToolHeader has given the page that heading: it reads `useToolTitled()`.
export const ToolTitled = createContext(false);
export const useToolTitled = () => useContext(ToolTitled);

// The top of a tool's own page: "‹ Management centre", then the tool's name and what it is for.
export function ToolHeader({ p, back, onBack, title, detail }: { p: Palette; back: string; onBack: () => void; title: string; detail?: string }) {
  return (
    <View style={{ gap: space.tight }}>
      <MotionPress accessibilityRole="link" accessibilityLabel={`Back to ${back}`} onPress={onBack} {...(Platform.OS === "web" ? { dataSet: { hover: "tint" } } : {})}
        style={[ui.row, { gap: 4, alignSelf: "flex-start", minHeight: 44, paddingRight: 10, borderRadius: 12 }]}>
        <Feather name="chevron-left" size={18} color={p.primary} />
        <Text style={{ color: p.primary, fontSize: 14, fontWeight: "600" }}>{back}</Text>
      </MotionPress>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>{title}</Text>
        {!!detail && <Text style={[ui.body, { color: p.muted }]}>{detail}</Text>}
      </View>
    </View>
  );
}

export type ToolCard<K extends string> = { key: K; label: string; detail: string; icon: IconName };

// The tools of one place as cards: the name and one line on what is inside. As many to a row as fit (one on a phone),
// all the same width and each row's cards the same height, so the last row does not stretch. `title` is the visible heading the cards are listed under.
const CARD_MIN = 260, GAP = 12;
export function ToolCards<K extends string>({ p, title, cards, onOpen }: { p: Palette; title: string; cards: readonly ToolCard<K>[]; onOpen: (key: K) => void }) {
  const [width, setWidth] = useState(0);
  const columns = Math.max(1, Math.floor((width + GAP) / (CARD_MIN + GAP)));
  const cardWidth = width ? (width - GAP * (columns - 1)) / columns : "100%";
  return (
    <View style={{ gap: space.row }}>
      <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>{title}</Text>
      <View accessibilityRole="list" accessibilityLabel={title} onLayout={e => setWidth(Math.floor(e.nativeEvent.layout.width))} style={{ flexDirection: "row", flexWrap: "wrap", gap: GAP }}>
        {cards.map((card, i) => (
          <Stagger key={card.key} index={i} style={{ width: cardWidth }}>
            <MotionPress accessibilityRole="button" accessibilityLabel={`${card.label}. ${card.detail}`} onPress={() => onOpen(card.key)} {...(Platform.OS === "web" ? { dataSet: { hover: "lift" } } : {})}
              style={[ui.card, ui.row, { backgroundColor: p.surface, borderColor: p.border, padding: 16, gap: 14, minHeight: 84, flexGrow: 1 }]}>
              <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: p.wash }}>
                <Feather name={card.icon} size={18} color={p.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={{ color: p.text, fontSize: 15, fontWeight: "600" }}>{card.label}</Text>
                <Text style={[ui.small, { color: p.muted }]}>{card.detail}</Text>
              </View>
              <Feather name="chevron-right" size={18} color={p.muted} />
            </MotionPress>
          </Stagger>
        ))}
      </View>
    </View>
  );
}
