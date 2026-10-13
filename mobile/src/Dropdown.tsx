import { createElement, useState } from "react";
import { Platform, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { ui, type Palette } from "./theme";

// One closed control that shows the current choice ("All regions"). On the web it is the browser's own select; on the phone
// it opens a plain list under it. Used where a row of chips was too many buttons.
export type DropdownOption<T extends string> = { value: T; label: string };

export function Dropdown<T extends string>({ p, label, value, options, onChange }: { p: Palette; label: string; value: T; options: readonly DropdownOption<T>[]; onChange: (v: T) => void }) {
  const [open, setOpen] = useState(false);
  const current = options.find(o => o.value === value)?.label ?? "";
  const box = { minHeight: 48, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: open ? p.primary : p.border, backgroundColor: p.surface };
  if (Platform.OS === "web") {
    return (
      <View style={{ gap: 6 }}>
        <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>{label}</Text>
        {createElement("select", {
          "aria-label": label, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value as T),
          style: { minHeight: 48, padding: "0 12px", borderRadius: 12, border: `1px solid ${p.border}`, background: p.surface, color: p.text, fontSize: 15, fontFamily: "inherit", fontWeight: 400 },
        }, options.map(o => createElement("option", { key: o.value, value: o.value }, o.label)))}
      </View>
    );
  }
  return (
    <View style={{ gap: 6 }}>
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>{label}</Text>
      <MotionPress accessibilityRole="button" accessibilityLabel={`${label}: ${current}`} accessibilityState={{ expanded: open }} onPress={() => setOpen(o => !o)} style={[ui.row, box, { gap: 10 }]}>
        <Text style={{ flex: 1, color: p.text, fontSize: 15 }}>{current}</Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={16} color={p.muted} />
      </MotionPress>
      {open && <View accessibilityRole="menu" style={{ borderRadius: 12, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface, overflow: "hidden" }}>
        {options.map((o, i) => (
          <MotionPress key={o.value} accessibilityRole="menuitem" accessibilityState={{ selected: o.value === value }} accessibilityLabel={o.label} onPress={() => { setOpen(false); onChange(o.value); }}
            style={[ui.row, { gap: 10, minHeight: 44, paddingHorizontal: 14, borderTopWidth: i ? 1 : 0, borderColor: p.border, backgroundColor: o.value === value ? p.wash : "transparent" }]}>
            <Text style={{ flex: 1, color: o.value === value ? p.primary : p.text, fontSize: 15, fontWeight: o.value === value ? "600" : "400" }}>{o.label}</Text>
            {o.value === value && <Feather name="check" size={16} color={p.primary} />}
          </MotionPress>
        ))}
      </View>}
    </View>
  );
}
