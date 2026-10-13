import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Dropdown, type DropdownOption } from "./Dropdown";
import { ui, type Palette } from "./theme";
import { choiceControl } from "../../lib/choice-control";
import { Pills } from "./Pills";

// One choice in a form, drawn by how many options it has (lib/choice-control.ts, the "fewer buttons"
// rule): up to 5 as compact radio choices, up to 10 as a dropdown, more as a dropdown with a search box.
// Lists of properties, people or stays use PropertySelect / SearchPicker instead.
export function ChoiceField<T extends string>({ p, label, value, options, onChange, disabled = false, hideLabel = true }: {
  p: Palette; label: string; value: T; options: readonly DropdownOption<T>[]; onChange: (v: T) => void; disabled?: boolean; hideLabel?: boolean;
}) {
  const control = choiceControl(options.length);
  if (control !== "radio") return <Dropdown p={p} label={label} value={value} options={options} onChange={onChange} searchable={control === "search"} hideLabel={hideLabel} disabled={disabled} />;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ gap: 8 }}>
      {!hideLabel && <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>{label}</Text>}
      {options.map(o => (
        <MotionPress key={o.value} disabled={disabled} accessibilityRole="radio" accessibilityState={{ selected: value === o.value, disabled }} onPress={() => onChange(o.value)}
          style={[ui.row, { minHeight: 48, gap: 10, paddingHorizontal: 14, borderRadius: 14, borderWidth: value === o.value ? 2 : 1, borderColor: value === o.value ? p.primary : p.border, backgroundColor: value === o.value ? p.wash : p.background }]}>
          <Feather name={value === o.value ? "check-circle" : "circle"} size={18} color={p.primary} />
          <Text style={{ color: p.text, flexShrink: 1 }}>{o.label}</Text>
        </MotionPress>
      ))}
    </View>
  );
}

// The same rule for a row of Pills in a sheet: up to 5 stay as pills; more become a dropdown (with a
// search box past 10). `name` labels the dropdown for screen readers; the sheet prints its own heading.
export function ChoicePills<T extends string>({ p, name, values, value, onChange, label, wrap }: {
  p: Palette; name: string; values: readonly T[]; value: T; onChange: (v: T) => void; label?: (v: T) => string; wrap?: boolean;
}) {
  // Pills (Pills.tsx) applies the same rule itself; `name` names its dropdown.
  return <Pills p={p} title={name} values={values} value={value} onChange={onChange} label={label} wrap={wrap} />;
}
