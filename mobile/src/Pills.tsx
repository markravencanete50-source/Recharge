import { Platform, ScrollView } from "react-native";
import { Text } from "./Typography";
import { MotionPress, Pop } from "./motion";
import { Dropdown } from "./Dropdown";
import { type Palette } from "./theme";
import { readableStage } from "../../lib/workspace-view";
import { PILLS_LIMIT, pillOptions, pillsMode } from "../../lib/pills";

// Choices as pills, the "fewer buttons" way (Lee, round 6; the same rule as the forms, lib/choice-control.ts): up to
// PILLS_LIMIT (5) choices stay pills on one line (they scroll sideways on a narrow phone rather than wrap); more become one
// Dropdown showing the current choice ("Waiting on you"), with every choice and any count in its label listed when it
// opens, and a search box at the top past 10. The props and onChange are the
// same either way, so no screen changes its logic. `wrap` is still accepted from older callers and no longer changes
// anything. `title` names the control for screen readers when it is a dropdown (default "Choose").
export { PILLS_LIMIT, pillsMode };
// One look for a pill wherever it is drawn (Session E's review): a chosen pill uses the `selected` tokens (forest in light,
// deep green with a mint edge in dark, never a solid mint block), an unchosen one a 3:1 `controlBorder` outline.
export const pillBox = (p: Palette, on: boolean) => ({ borderWidth: 1, borderColor: on ? p.selectedBorder : p.controlBorder, backgroundColor: on ? p.selected : p.surface });
export const pillInk = (p: Palette, on: boolean, muted = false) => on ? p.onSelected : muted ? p.muted : p.text;
export function Pills<T extends string>({ p, values, value, onChange, label, title = "Choose" }: { p: Palette; values: readonly T[]; value: T; onChange: (v: T) => void; label?: (v: T) => string; wrap?: boolean; title?: string }) {
  const text = (v: T) => label ? label(v) : readableStage(v);
  const mode = pillsMode(values.length);
  if (mode !== "pills") {
    return <Dropdown p={p} label={title} hideLabel searchable={mode === "search"} value={value} options={pillOptions(values, text)} onChange={onChange} />;
  }
  return (
    <ScrollView horizontal accessibilityRole="radiogroup" showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {values.map(v => {
        const on = v === value;
        return (
          <Pop key={v} active={on}><MotionPress {...(Platform.OS === "web" && !on ? { dataSet: { hover: "tint" } } : {})} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => onChange(v)}
            style={[{ minHeight: 42, paddingHorizontal: 16, borderRadius: 999, justifyContent: "center" }, pillBox(p, on)]}>
            <Text style={{ color: pillInk(p, on), fontSize: 13, fontWeight: "600" }}>{text(v)}</Text>
          </MotionPress></Pop>
        );
      })}
    </ScrollView>
  );
}
