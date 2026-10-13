import { useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { ChoicePills } from "./ChoiceField";
import { PropertySelect } from "./SearchPicker";
import { MotionPress } from "./motion";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, Field, message, Notice, useRequestId } from "./LiveKit";
import { Pills } from "./LiveAccounts";
import { SoftButton } from "./LivePages";
import { writeOwner } from "./backend/client";
import { formatMoney } from "../../lib/format";
import { monthName } from "../../lib/owner-reports";
import { OWNER_EXPENSE_CATEGORIES } from "../../lib/owner-policy";
import { OWNER_EXPENSE_LABEL, type OwnerExpense, type OwnerPeriods } from "../../lib/owner-periods";
import { poundsToMinor } from "../../lib/repairs-live";

// "Your expenses": what the owner spends themselves on a property in a month. Entered here, listed
// with a way to remove each one, and used for one thing only: the net figure under their payout. It
// never changes what Recharge pays them. A month whose statement has been issued is read only.
const MAX_POUNDS = 100000;

export function OwnerExpenses({ palette: p, properties, cells, months, onChanged }: {
  palette: Palette; properties: OwnerPeriods["properties"]; cells: OwnerPeriods["months"]; months: string[]; onChanged: () => void;
}) {
  const [chosenMonth, setMonth] = useState("");
  const [chosenProperty, setProperty] = useState("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState("");
  const [error, setError] = useState("");
  const month = months.includes(chosenMonth) ? chosenMonth : months[months.length - 1] ?? "";
  const property = properties.find(x => x.propertyId === chosenProperty) ?? properties[0];
  if (!month || !property) return null;
  const cell = cells.find(c => c.month === month && c.propertyId === property.propertyId);
  const expenses = cell?.ownerExpenses ?? [];
  const total = expenses.reduce((n, e) => n + e.amountMinor, 0);
  const locked = cell?.ownerExpensesLocked === true;

  async function remove(expense: OwnerExpense) {
    setRemoving(expense.id); setError("");
    try { await writeOwner({ action: "removeOwnerExpense", expenseId: expense.id }); onChanged(); }
    catch (e) { setError(message(e)); onChanged(); }
    finally { setRemoving(""); }
  }

  return (
    <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 14 }]}>
      <View style={{ gap: 3 }}>
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 16, fontWeight: "600" }}>Your expenses</Text>
        <Text style={[ui.small, { color: p.muted }]}>Costs you pay yourself for a property. They only change the net figure under your payout. They never change what Recharge pays you.</Text>
      </View>
      {properties.length > 1 && <PropertySelect p={p} properties={properties.map(x => ({ id: x.propertyId, name: x.propertyName }))} value={property.propertyId} onChange={id => { if (id) setProperty(id); }} />}
      {months.length > 1 && <ChoicePills p={p} name="Month" values={months} value={month} onChange={setMonth} label={m => monthName(m, months.length <= 3)} />}
      <View style={{ gap: 2 }}>
        {!expenses.length && <Text style={[ui.small, { color: p.muted }]}>{`Nothing added for ${property.propertyName} in ${monthName(month)}.`}</Text>}
        {expenses.map((e, i) => (
          <View key={e.id} accessibilityLabel={`${OWNER_EXPENSE_LABEL[e.category]}, ${formatMoney(e.amountMinor)}${e.note ? ", " + e.note : ""}`} style={[ui.row, { gap: 12, minHeight: 52, borderTopWidth: i ? 1 : 0, borderColor: p.border }]}>
            <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
              <Text style={{ color: p.text, fontSize: 14, fontWeight: "500" }}>{OWNER_EXPENSE_LABEL[e.category]}</Text>
              {!!e.note && <Text numberOfLines={2} style={[ui.small, { color: p.muted }]}>{e.note}</Text>}
            </View>
            <Text style={{ color: p.text, fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{formatMoney(e.amountMinor)}</Text>
            {!locked && <MotionPress accessibilityRole="button" accessibilityLabel={`Remove ${OWNER_EXPENSE_LABEL[e.category]} ${formatMoney(e.amountMinor)}`} disabled={removing === e.id} onPress={() => void remove(e)}
              style={{ minHeight: 44, minWidth: 44, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", opacity: removing === e.id ? 0.5 : 1 }}>
              <Text style={{ color: p.muted, fontSize: 13, fontWeight: "500" }}>{removing === e.id ? "Removing…" : "Remove"}</Text>
            </MotionPress>}
          </View>
        ))}
        {!!expenses.length && <View style={[ui.row, { gap: 12, minHeight: 40, borderTopWidth: 1, borderColor: p.border }]}>
          <Text style={[ui.small, { flex: 1, color: p.muted }]}>Total</Text>
          <Text style={{ color: p.text, fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{formatMoney(total)}</Text>
        </View>}
      </View>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {locked
        ? <Text style={[ui.small, { color: p.muted }]}>The statement for this month has been issued, so its expenses can no longer be changed.</Text>
        : <SoftButton label="Add an expense" icon="plus" palette={p} onPress={() => { setError(""); setAdding(true); }} />}
      <AddExpenseSheet p={p} visible={adding} propertyId={property.propertyId} propertyName={property.propertyName} month={month} onClose={() => setAdding(false)} onSaved={onChanged} />
    </View>
  );
}

function AddExpenseSheet({ p, visible, propertyId, propertyName, month, onClose, onSaved }: { p: Palette; visible: boolean; propertyId: string; propertyName: string; month: string; onClose: () => void; onSaved: () => void }) {
  const [category, setCategory] = useState<(typeof OWNER_EXPENSE_CATEGORIES)[number]>("maintenance");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One request id per attempt, kept until it succeeds, so a retry after a lost reply is not added twice.
  const request = useRequestId(visible ? ["owner-expense", propertyId, month, category, amount, note].join(":") : null);

  async function save() {
    const amountMinor = poundsToMinor(amount);
    if (!amountMinor) { setError("Enter the amount in pounds, for example 45.50."); return; }
    if (amountMinor > MAX_POUNDS * 100) { setError("Enter an amount up to £100,000."); return; }
    if (note.trim().length > 300) { setError("Keep the note to 300 characters."); return; }
    setBusy(true); setError("");
    try {
      await writeOwner({ action: "saveOwnerExpense", requestId: request.get(), propertyId, month, amountMinor, category, ...(note.trim() ? { note: note.trim() } : {}) });
      request.done(); setAmount(""); setNote(""); onClose(); onSaved();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }

  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title="Add an expense" subtitle={`${propertyName}, ${monthName(month)}`}>
      <Pills p={p} values={OWNER_EXPENSE_CATEGORIES} value={category} onChange={setCategory} label={c => OWNER_EXPENSE_LABEL[c]} />
      <Field label="Amount (£)" value={amount} onChange={setAmount} p={p} placeholder="0.00" />
      <Field label="Note (optional)" value={note} onChange={setNote} p={p} multiline />
      <Text style={[ui.small, { color: p.muted }]}>This only changes the net figure you see. It does not change what Recharge pays you.</Text>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Save expense"} primary p={p} disabled={busy} onPress={() => void save()} />
    </Sheet>
  );
}
