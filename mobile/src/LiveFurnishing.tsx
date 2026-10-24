import { useMemo, useRef, useState } from "react";
import { Platform, Share, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress, Pop, SwapIn, TweenNumber } from "./motion";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, Notice, StatGrid, StatTile } from "./LiveKit";
import { exportReport } from "./exportReport";
import { formatCount } from "../../lib/format";
import { calculateFurnishing, clampInput, cleanExtras, DEFAULT_LAYOUT, EXTRA_LIMITS, furnishingCsv, furnishingText, INPUTS, OTHER_ID, type Count, type Extra, type Layout } from "../../lib/furnishing-calculator";
import { pillBox, pillInk } from "./Pills";

// The furnishing calculator, inside the app: enter the property layout and the full quantity list
// for every category updates as you go. Copy or share it, or download it as a spreadsheet.
function Stepper({ p, label, help, value, min, max, onChange }: { p: Palette; label: string; help: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const button = (icon: "minus" | "plus", next: number, disabled: boolean) => (
    <MotionPress accessibilityRole="button" accessibilityLabel={`${icon === "plus" ? "Increase" : "Decrease"} ${label}`} disabled={disabled} onPress={() => onChange(next)}
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.35 : 1 }}>
      <Feather name={icon} size={18} color={p.text} />
    </MotionPress>
  );
  return (
    <View style={[ui.between, { gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }]}>
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <Text style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{label}</Text>
        <Text style={[ui.small, { color: p.muted }]}>{help}</Text>
      </View>
      <View style={[ui.row, { borderWidth: 1, borderColor: p.border, borderRadius: 14, overflow: "hidden" }]}>
        {button("minus", value - 1, value <= min)}
        <Text accessibilityLabel={`${label}: ${value}`} style={{ color: p.text, fontSize: 17, fontWeight: "700", minWidth: 40, textAlign: "center", fontVariant: ["tabular-nums"] }}>{value}</Text>
        {button("plus", value + 1, value >= max)}
      </View>
    </View>
  );
}

// The "Other" tab: add any item the fixed rules do not cover, set how many, and remove or change it later.
function OtherItems({ p, extras, onChange }: { p: Palette; extras: Extra[]; onChange: (next: Extra[]) => void }) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [quantity, setQuantity] = useState(1);
  const next = useRef(1);
  const full = extras.length >= EXTRA_LIMITS.items;
  const field = { minHeight: 46, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: p.controlBorder, backgroundColor: p.background, color: p.text, fontFamily: "Montserrat_500Medium", fontSize: 15 } as const;
  const change = (id: string, quantity: number) => onChange(extras.map(e => e.id === id ? { ...e, quantity: Math.min(EXTRA_LIMITS.quantity, Math.max(1, quantity)) } : e));
  const add = () => {
    if (!name.trim() || full) return;
    onChange([...extras, { id: `extra-${Date.now()}-${next.current++}`, item: name, note, quantity }]);
    setName(""); setNote(""); setQuantity(1);
  };
  const small = (icon: "minus" | "plus", label: string, disabled: boolean, onPress: () => void) => (
    <MotionPress accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.35 : 1 }}>
      <Feather name={icon} size={16} color={p.text} />
    </MotionPress>
  );
  return (
    <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, gap: 0 }]}>
      <View style={{ paddingVertical: 12, gap: 2 }}>
        <Text style={{ color: p.text, fontSize: 18, fontWeight: "700" }}>Other items</Text>
        <Text style={[ui.small, { color: p.muted }]}>Add anything this property needs that is not already on the list. It is counted in the total and included in the copy and download.</Text>
      </View>
      {extras.map(e => (
        <View key={e.id} style={[ui.row, { gap: 8, paddingVertical: 10, borderTopWidth: 1, borderColor: p.border }]}>
          <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
            <Text style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{e.item}</Text>
            <Text style={[ui.small, { color: p.muted }]}>{e.note || "Added by you"}</Text>
          </View>
          <View style={[ui.row, { borderWidth: 1, borderColor: p.border, borderRadius: 12, overflow: "hidden" }]}>
            {small("minus", `Decrease ${e.item}`, e.quantity <= 1, () => change(e.id, e.quantity - 1))}
            <Text accessibilityLabel={`${e.item}: ${e.quantity}`} style={{ color: p.text, fontSize: 16, fontWeight: "700", minWidth: 32, textAlign: "center", fontVariant: ["tabular-nums"] }}>{e.quantity}</Text>
            {small("plus", `Increase ${e.item}`, e.quantity >= EXTRA_LIMITS.quantity, () => change(e.id, e.quantity + 1))}
          </View>
          <MotionPress accessibilityRole="button" accessibilityLabel={`Remove ${e.item}`} onPress={() => onChange(extras.filter(x => x.id !== e.id))} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
            <Feather name="trash-2" size={17} color={p.muted} />
          </MotionPress>
        </View>
      ))}
      <View style={{ gap: 10, paddingVertical: 14, borderTopWidth: 1, borderColor: p.border }}>
        <TextInput accessibilityLabel="Other item name" value={name} onChangeText={setName} maxLength={EXTRA_LIMITS.name} placeholder="Item, for example Baby cot" placeholderTextColor={p.muted} style={field} />
        <TextInput accessibilityLabel="Other item note" value={note} onChangeText={setNote} maxLength={EXTRA_LIMITS.note} placeholder="Note (optional)" placeholderTextColor={p.muted} style={field} />
        <View style={[ui.between, { gap: 12 }]}>
          <View style={[ui.row, { borderWidth: 1, borderColor: p.border, borderRadius: 12, overflow: "hidden" }]}>
            {small("minus", "Decrease quantity", quantity <= 1, () => setQuantity(q => Math.max(1, q - 1)))}
            <Text accessibilityLabel={`Quantity: ${quantity}`} style={{ color: p.text, fontSize: 16, fontWeight: "700", minWidth: 32, textAlign: "center", fontVariant: ["tabular-nums"] }}>{quantity}</Text>
            {small("plus", "Increase quantity", quantity >= EXTRA_LIMITS.quantity, () => setQuantity(q => Math.min(EXTRA_LIMITS.quantity, q + 1)))}
          </View>
          <Button label="Add item" icon="plus" p={p} onPress={add} />
        </View>
        {full && <Text style={[ui.small, { color: p.muted }]}>You can add up to {EXTRA_LIMITS.items} other items.</Text>}
      </View>
    </View>
  );
}

export function FurnishingCalculator({ palette: p }: { palette: Palette }) {
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
  const [extras, setExtras] = useState<Extra[]>([]);
  const [category, setCategory] = useState("safety");
  const [step, setStep] = useState<"details" | "list">("details");
  const [notice, setNotice] = useState("");
  const list = useMemo(() => calculateFurnishing(layout, extras), [layout, extras]);
  const otherCount = useMemo(() => cleanExtras(extras).length, [extras]);
  const onOther = category === OTHER_ID;
  const fixed = list.categories.filter(c => c.id !== OTHER_ID);
  const selected = fixed.find(c => c.id === category) ?? fixed[0];
  const set = (key: Count, value: number) => setLayout(current => ({ ...current, [key]: clampInput(key, value) }));

  async function copy() {
    const text = furnishingText(layout, list);
    try {
      if (Platform.OS === "web" && globalThis.navigator?.clipboard) { await globalThis.navigator.clipboard.writeText(text); setNotice("List copied."); }
      else { await Share.share({ message: text }); setNotice(""); }
    } catch { setNotice("The list could not be copied. Download it instead."); }
  }
  async function download() {
    try { await exportReport(furnishingCsv(layout, list), "Recharge-furnishing-list.csv"); setNotice(Platform.OS === "web" ? "Download started." : "List ready to save or share."); }
    catch { setNotice("The list could not be downloaded just now."); }
  }

  const group = (g: "rooms" | "sleeping") => INPUTS.filter(i => i.group === g).map(i => <Stepper key={i.key} p={p} label={i.label} help={i.help} value={layout[i.key]} min={i.min} max={i.max} onChange={v => set(i.key, v)} />);


  return (
    <View style={{ gap: 18 }}>
      <View style={{ padding: 18, borderRadius: 22, backgroundColor: p.header, gap: 8 }}>
        <Text style={{ color: p.headerText, fontSize: 24, lineHeight: 30, fontWeight: "700" }}>Calculate what your property requires.</Text>
        <Text style={{ color: p.headerMuted, fontSize: 14, lineHeight: 21 }}>Enter the property layout. The full quantity list for every room updates as you go.</Text>
      </View>

      <View style={[ui.row, { gap: 8 }]}>
        {(["details", "list"] as const).map((s, i) => (
          <MotionPress key={s} accessibilityRole="tab" accessibilityState={{ selected: step === s }} onPress={() => setStep(s)}
            style={[ui.row, { flex: 1, gap: 8, minHeight: 46, paddingHorizontal: 14, borderRadius: 999, justifyContent: "center", ...pillBox(p, step === s) }]}>
            <Text style={{ color: pillInk(p, step === s), fontWeight: "600" }}>{i + 1}. {s === "details" ? "Property details" : "Required quantities"}</Text>
          </MotionPress>
        ))}
      </View>

      <SwapIn swapKey={step} style={{ gap: 18 }}>
      {step === "details" ? <>
        <View style={{ gap: 6 }}>
          <Text style={{ color: p.muted, fontSize: 12, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" }}>Property address</Text>
          <TextInput accessibilityLabel="Property address" value={layout.address} onChangeText={address => setLayout(current => ({ ...current, address }))} placeholder="Enter the full property address" placeholderTextColor={p.muted}
            style={{ minHeight: 50, padding: 13, borderRadius: 14, borderWidth: 1, borderColor: p.controlBorder, backgroundColor: p.background, color: p.text, fontFamily: "Montserrat_500Medium", fontSize: 15 }} />
        </View>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Rooms & occupancy</Text>
        <Text style={[ui.small, { color: p.muted, marginTop: -10 }]}>These figures set the room, guest and window-based quantities.</Text>
        {group("rooms")}
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Sleeping & bedroom set-up</Text>
        <Text style={[ui.small, { color: p.muted, marginTop: -10 }]}>Bed details set frames, linen, protectors, pillows and lamps.</Text>
        {group("sleeping")}
      </> : <>
        <View style={{ gap: 2 }}>
          <Text style={{ color: p.muted, fontSize: 12, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" }}>Property</Text>
          <Text style={{ color: p.text, fontSize: 17, fontWeight: "700" }}>{layout.address.trim() || "Address not entered"}</Text>
        </View>
        <StatGrid showZeros>
          <StatTile p={p} icon="moon" tone="clients" label="Bedrooms" value={layout.bedrooms} />
          <StatTile p={p} icon="users" tone="clients" label="Guests" value={layout.guests} />
          <StatTile p={p} icon="layers" tone="clients" label="Total beds" value={list.beds} />
        </StatGrid>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {[...fixed, { id: OTHER_ID, label: "Other", lines: { length: otherCount } }].map(c => {
            const on = c.id === OTHER_ID ? onOther : !onOther && c.id === selected?.id;
            return (
              <Pop key={c.id} active={on}><MotionPress accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setCategory(c.id)}
                style={[ui.row, { gap: 8, minHeight: 42, paddingHorizontal: 14, borderRadius: 14, ...pillBox(p, on) }]}>
                <Text style={{ color: pillInk(p, on), fontWeight: "600" }}>{c.label}</Text>
                <View style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: 6, backgroundColor: on ? p.onSelected : p.wash }}><Text style={{ color: on ? p.selected : p.text, fontSize: 12, fontWeight: "700" }}>{c.lines.length}</Text></View>
              </MotionPress></Pop>
            );
          })}
        </View>
        {onOther ? <SwapIn swapKey={OTHER_ID}><OtherItems p={p} extras={extras} onChange={setExtras} /></SwapIn> : selected && <SwapIn swapKey={selected.id}><View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, gap: 0 }]}>
          <View style={{ paddingVertical: 12, gap: 2 }}>
            <Text style={{ color: p.text, fontSize: 18, fontWeight: "700" }}>{selected.title}</Text>
            <Text style={[ui.small, { color: p.muted }]}>{selected.lines.length} required item types</Text>
          </View>
          {selected.lines.map(l => (
            <View key={l.item} style={[ui.row, { gap: 12, paddingVertical: 12, borderTopWidth: 1, borderColor: p.border }]}>
              <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: p.successWash }}><Feather name="check" size={15} color={p.success} /></View>
              <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                <Text style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{l.item}</Text>
                <Text style={[ui.small, { color: p.muted }]}>{l.rule}</Text>
              </View>
              <Text style={{ color: p.text, fontSize: 24, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{l.quantity}<Text style={[ui.small, { color: p.muted, fontWeight: "500" }]}> {l.quantity === 1 ? "unit" : "units"}</Text></Text>
            </View>
          ))}
        </View></SwapIn>}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <Button label={Platform.OS === "web" ? "Copy list" : "Share list"} icon={Platform.OS === "web" ? "copy" : "share"} p={p} onPress={() => void copy()} />
          <Button label="Download spreadsheet" icon="download" p={p} onPress={() => void download()} />
        </View>
        {!!notice && <Notice text={notice} p={p} />}
      </>}
      </SwapIn>

      <View style={[ui.between, { gap: 12, padding: 16, borderRadius: 18, backgroundColor: p.header }]}>
        <View style={[ui.row, { gap: 8, alignItems: "baseline" }]}><TweenNumber value={list.total} format={formatCount} style={{ color: p.headerText, fontSize: 24, fontWeight: "700", fontVariant: ["tabular-nums"] }} /><Text style={{ color: p.headerText, fontSize: 15 }}>required units</Text></View>
        <MotionPress accessibilityRole="button" onPress={() => setStep(step === "details" ? "list" : "details")} style={{ minHeight: 44, paddingHorizontal: 16, borderRadius: 12, justifyContent: "center", backgroundColor: p.headerText }}>
          <Text style={{ color: p.header, fontWeight: "700" }}>{step === "details" ? "View list" : "Edit details"}</Text>
        </MotionPress>
      </View>
      <MotionPress accessibilityRole="button" onPress={() => { setLayout(DEFAULT_LAYOUT); setExtras([]); setStep("details"); setCategory("safety"); setNotice(""); }} style={{ alignSelf: "center", minHeight: 44, justifyContent: "center", paddingHorizontal: 12 }}>
        <Text style={{ color: p.primary, fontWeight: "700" }}>Reset</Text>
      </MotionPress>
    </View>
  );
}

export function FurnishingSheet({ palette: p, visible, onClose }: { palette: Palette; visible: boolean; onClose: () => void }) {
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title="Furnishing calculator" subtitle="What a guest-ready property needs, room by room" icon="house">
      {visible && <FurnishingCalculator palette={p} />}
    </Sheet>
  );
}
