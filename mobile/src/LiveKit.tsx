import { useRef, type ComponentProps, type ReactNode } from "react";
import { TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { ui, type Palette } from "./theme";

// Shared building blocks for the live (backend-connected) screens.
export const message = (error: unknown) => error instanceof Error ? error.message : "The request could not be completed.";
export const london = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
export const addDays = (iso: string, days: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
export const dayLabel = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
export function Button({ label, onPress, p, primary = false, disabled = false, icon }: { label: string; onPress: () => void; p: Palette; primary?: boolean; disabled?: boolean; icon?: ComponentProps<typeof Feather>["name"] }) {
  return (
    <MotionPress accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[ui.button, { backgroundColor: disabled ? p.elevated : primary ? p.primary : p.wash, flexGrow: 1 }]}>
      {!!icon && <Feather name={icon} size={16} color={disabled ? p.muted : primary ? p.onPrimary : p.primary} />}
      <Text style={[ui.buttonText, { color: disabled ? p.muted : primary ? p.onPrimary : p.primary }]}>{label}</Text>
    </MotionPress>
  );
}
export function Field({ label, value, onChange, p, multiline = false, placeholder }: { label: string; value: string; onChange: (v: string) => void; p: Palette; multiline?: boolean; placeholder?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={p.muted} multiline={multiline} accessibilityLabel={label}
        style={{ minHeight: multiline ? 88 : 48, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: p.controlBorder, color: p.text, backgroundColor: p.background, textAlignVertical: multiline ? "top" : "center", fontFamily: "Montserrat_500Medium", fontSize: 14 }} />
    </View>
  );
}
export function Tag({ label, tone, p }: { label: string; tone: "good" | "wait" | "bad" | "plain"; p: Palette }) {
  const [bg, fg] = { good: [p.successWash, p.success], wait: [p.cautionWash, p.waiting], bad: ["#F6DEDA", "#A63A32"], plain: [p.wash, p.primary] }[tone];
  return <View style={{ alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: bg }}><Text style={{ color: fg, fontSize: 12, fontWeight: "700" }}>{label}</Text></View>;
}
export function Notice({ text, p, tone = "plain" }: { text: string; p: Palette; tone?: "plain" | "bad" }) {
  return <View style={{ padding: 12, borderRadius: 14, backgroundColor: tone === "bad" ? "#F6DEDA" : p.wash }}><Text accessibilityLiveRegion="polite" style={[ui.small, { color: tone === "bad" ? "#A63A32" : p.text }]}>{text}</Text></View>;
}
export function Section({ title, count, p, children }: { title: string; count?: number; p: Palette; children: ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <View style={ui.between}><Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>{title}</Text>{count !== undefined && <Tag label={String(count)} tone={count ? "wait" : "good"} p={p} />}</View>
      {children}
    </View>
  );
}

// One request identifier per attempt, kept until it succeeds, so a retry after a
// lost response replays the original action instead of creating a duplicate.
export function useRequestId(key: string | null) {
  const ids = useRef(new Map<string, string>());
  return {
    get: () => { if (!key) return Crypto.randomUUID(); if (!ids.current.has(key)) ids.current.set(key, Crypto.randomUUID()); return ids.current.get(key)!; },
    done: () => { if (key) ids.current.delete(key); },
  };
}

