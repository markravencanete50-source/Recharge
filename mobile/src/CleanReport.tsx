import type { ReactNode } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Button, Field, Tag } from "./LiveKit";
import { ui, type Palette } from "./theme";
import { CLEAN_QUESTIONS, cleanAnswers, purchaseFromClean, repairFromClean, type CleanCondition } from "../../lib/clean-report";
import { pillBox, pillInk } from "./Pills";

// The cleaners' post-clean form: the property check the cleaner answers after each clean
// (broadband, heating, bins, garden, meter, cutlery, letters), repairs, items to order and
// recommendations. The team reads it back and turns it into a purchase order or reactive maintenance.
export type ItemRow = { item: string; quantity: string };

// What goes to the server, leaving out anything blank.
export function conditionOf(answers: Partial<CleanCondition>, items: ItemRow[]): CleanCondition | null {
  const order = items.map(r => ({ item: r.item.trim().slice(0, 120), quantity: Math.min(100, Math.max(1, Math.round(Number(r.quantity) || 1))) })).filter(r => r.item).slice(0, 20);
  const c: CleanCondition = {};
  for (const q of CLEAN_QUESTIONS) if (answers[q.key]) c[q.key] = answers[q.key];
  if (answers.repairs?.trim()) c.repairs = answers.repairs.trim().slice(0, 2000);
  if (answers.recommendations?.trim()) c.recommendations = answers.recommendations.trim().slice(0, 2000);
  if (order.length) c.itemOrder = order;
  return Object.keys(c).length ? c : null;
}
export const unanswered = (answers: Partial<CleanCondition>) => CLEAN_QUESTIONS.filter(q => !answers[q.key]).length;

// repairs: where the cleaner reports repairs themselves (CleanRepairs, migration 20261023100000), in place of the
// "Repairs or replacements needed" box the team then had to raise as a repair. Without it the box is shown as before.
export function CleanCheckForm({ p, answers, items, onAnswers, onItems, repairs }: { p: Palette; answers: Partial<CleanCondition>; items: ItemRow[]; onAnswers: (a: Partial<CleanCondition>) => void; onItems: (rows: ItemRow[]) => void; repairs?: ReactNode }) {
  return (
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Property check</Text>
      {CLEAN_QUESTIONS.map(q => (
        <View key={q.key} accessibilityRole="radiogroup" accessibilityLabel={q.label} style={{ gap: 6 }}>
          <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>{q.label}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {q.options.map(([value, label]) => {
              const on = answers[q.key] === value;
              return (
                <MotionPress key={value} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => onAnswers({ ...answers, [q.key]: on ? undefined : value })}
                  style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 999, justifyContent: "center", ...pillBox(p, on) }}>
                  <Text style={{ color: pillInk(p, on), fontSize: 13, fontWeight: "600" }}>{label}</Text>
                </MotionPress>
              );
            })}
          </View>
        </View>
      ))}
      {repairs ?? <Field label="Repairs or replacements needed (optional)" value={answers.repairs ?? ""} onChange={v => onAnswers({ ...answers, repairs: v })} p={p} multiline placeholder="For example, the shower head is cracked" />}
      <View style={{ gap: 8 }}>
        <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Items to order (optional)</Text>
        {items.map((row, i) => (
          <View key={i} style={[ui.row, { gap: 8 }]}>
            <View style={{ flex: 1, minWidth: 0 }}><Field label={`Item ${i + 1}`} value={row.item} onChange={v => onItems(items.map((r, j) => j === i ? { ...r, item: v } : r))} p={p} placeholder="Toilet roll" /></View>
            <View style={{ width: 76 }}><Field label="How many" value={row.quantity} onChange={v => onItems(items.map((r, j) => j === i ? { ...r, quantity: v.replace(/[^0-9]/g, "").slice(0, 3) } : r))} p={p} placeholder="1" /></View>
            <MotionPress accessibilityRole="button" accessibilityLabel={`Remove item ${i + 1}`} onPress={() => onItems(items.filter((_, j) => j !== i))} style={{ width: 40, height: 48, alignSelf: "flex-end", alignItems: "center", justifyContent: "center" }}>
              <Feather name="x" size={18} color={p.muted} />
            </MotionPress>
          </View>
        ))}
        {items.length < 20 && <Button label="Add an item" icon="plus" p={p} onPress={() => onItems([...items, { item: "", quantity: "1" }])} />}
      </View>
      <Field label="Recommendations (optional)" value={answers.recommendations ?? ""} onChange={v => onAnswers({ ...answers, recommendations: v })} p={p} multiline placeholder="Anything that would make the property better for guests" />
    </View>
  );
}

// The report as the team reads it, with the two follow-ups it can start.
export function CleanCheckSummary({ p, condition, onPurchase, onRepair }: { p: Palette; condition: CleanCondition; onPurchase?: (requirements: string) => void; onRepair?: (issue: string) => void }) {
  const answers = cleanAnswers(condition), purchase = purchaseFromClean(condition), repair = repairFromClean(condition);
  return (
    <View style={{ gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: p.border }}>
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Property check</Text>
      {answers.map(a => (
        <View key={a.label} style={[ui.between, { gap: 12 }]}>
          <Text style={[ui.small, { color: p.muted, flex: 1, minWidth: 0 }]}>{a.label}</Text>
          <Tag label={a.answer} tone={a.attention ? "wait" : "good"} p={p} />
        </View>
      ))}
      {!!condition.repairs && <Text style={{ color: p.text }}>Repairs: {condition.repairs}</Text>}
      {!!condition.itemOrder?.length && <Text style={{ color: p.text }}>To order: {condition.itemOrder.map(i => `${i.quantity} × ${i.item}`).join(", ")}</Text>}
      {!!condition.recommendations && <Text style={{ color: p.text }}>Recommendations: {condition.recommendations}</Text>}
      {!!purchase && onPurchase && <Button label="Raise a purchase order" icon="shopping-cart" p={p} onPress={() => onPurchase(purchase)} />}
      {!!repair && onRepair && <Button label="Raise reactive maintenance" icon="tool" p={p} onPress={() => onRepair(repair)} />}
    </View>
  );
}
