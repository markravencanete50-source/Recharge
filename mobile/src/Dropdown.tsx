import { createElement, useState } from "react";
import { Platform, ScrollView, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { radius, ui, type Palette } from "./theme";
import { filterChoices } from "../../lib/choice-control";

// One closed control that shows the current choice ("All regions"). On the web it is the browser's own select; on the phone
// it opens a plain list under it. Used where a row of chips was too many buttons.
// With `searchable` (long lists, lib/choice-control.ts) it opens with a search box at the top, on every platform.
// `hideLabel` is for forms that already print the field's label above it (the label still names it for screen readers).
export type DropdownOption<T extends string> = { value: T; label: string };

// `labelledBy` is the id of a label printed above it (Pills with `showTitle`), which the web select is tied to.
export function Dropdown<T extends string>({ p, label, value, options, onChange, searchable = false, hideLabel = false, disabled = false, labelledBy }: {
  p: Palette; label: string; value: T; options: readonly DropdownOption<T>[]; onChange: (v: T) => void; searchable?: boolean; hideLabel?: boolean; disabled?: boolean; labelledBy?: string;
}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState("");
  const current = options.find(o => o.value === value)?.label ?? "";
  const box = { minHeight: 48, paddingHorizontal: 14, borderRadius: radius.control, borderWidth: 1, borderColor: open ? p.primary : p.controlBorder, backgroundColor: p.surface };
  const caption = hideLabel ? null : <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>{label}</Text>;
  if (Platform.OS === "web" && !searchable) {
    return (
      <View style={{ gap: 6 }}>
        {caption}
        {createElement("select", {
          "aria-label": label, "aria-labelledby": labelledBy, value, disabled, onChange: (e: { target: { value: string } }) => onChange(e.target.value as T),
          style: { minHeight: 48, padding: "0 12px", borderRadius: 12, border: `1px solid ${p.controlBorder}`, background: p.surface, color: p.text, fontSize: 15, fontFamily: "Montserrat_400Regular, system-ui, sans-serif", fontWeight: 400 },
        }, options.map(o => createElement("option", { key: o.value, value: o.value }, o.label)))}
      </View>
    );
  }
  const shown = searchable ? filterChoices(options, query) : options;
  const toggle = () => { setOpen(o => !o); setQuery(""); };
  return (
    <View style={{ gap: 6 }}>
      {caption}
      <MotionPress accessibilityRole="combobox" accessibilityLabel={`${label}: ${current}`} accessibilityState={{ expanded: open, disabled }} disabled={disabled} onPress={toggle} style={[ui.row, box, { gap: 10 }]}>
        <Text style={{ flex: 1, color: p.text, fontSize: 15 }}>{current}</Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={16} color={p.muted} />
      </MotionPress>
      {open && <View style={{ gap: 8 }}>
        {searchable && <View {...(Platform.OS === "web" ? { dataSet: { bareInput: "true" } } : {})} style={[ui.row, { gap: 10, paddingHorizontal: 14, minHeight: 48, borderRadius: radius.control, borderWidth: 1, borderColor: p.controlBorder, backgroundColor: p.background }]}>
          <Feather name="search" size={18} color={p.muted} />
          <TextInput value={query} onChangeText={setQuery} placeholder={`Search ${options.length} choices`} placeholderTextColor={p.muted} accessibilityLabel={`Search ${label}`} autoCapitalize="none" autoCorrect={false} autoFocus
            style={{ flex: 1, minWidth: 0, color: p.text, fontFamily: "Montserrat_500Medium", fontSize: 14, ...(Platform.OS === "web" ? { outlineStyle: "none" } as object : {}) }} />
        </View>}
        <View accessibilityRole="menu" style={{ borderRadius: radius.control, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface, overflow: "hidden" }}>
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={searchable ? { maxHeight: 320 } : undefined}>
            {shown.map((o, i) => (
              <MotionPress key={o.value} accessibilityRole="menuitem" accessibilityState={{ selected: o.value === value }} accessibilityLabel={o.label} onPress={() => { setOpen(false); setQuery(""); onChange(o.value); }}
                style={[ui.row, { gap: 10, minHeight: 44, paddingHorizontal: 14, borderTopWidth: i ? 1 : 0, borderColor: p.border, backgroundColor: o.value === value ? p.wash : "transparent" }]}>
                <Text style={{ flex: 1, color: o.value === value ? p.primary : p.text, fontSize: 15, fontWeight: o.value === value ? "600" : "400" }}>{o.label}</Text>
                {o.value === value && <Feather name="check" size={16} color={p.primary} />}
              </MotionPress>
            ))}
            {!shown.length && <Text style={[ui.small, { color: p.muted, padding: 14 }]}>Nothing matches “{query.trim()}”.</Text>}
          </ScrollView>
        </View>
      </View>}
    </View>
  );
}
