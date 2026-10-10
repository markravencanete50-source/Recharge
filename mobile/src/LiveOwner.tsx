import { useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { ExpandChevron, MotionPress } from "./motion";
import { ui, type Palette } from "./theme";
import { dayLabel, Tag } from "./LiveKit";
import { StatementFiles } from "./AccountsFiles";
import { monthLabel, pounds, type Statement } from "../../lib/accounts-live";

// An owner's issued or paid statement, line by line, with every stay and cost behind it. Owners
// see their stays, earnings and statements in one place: Reports.
export function StatementCard({ p, s }: { p: Palette; s: Statement }) {
  const [open, setOpen] = useState(false);
  const line = (label: string, value: string, strong = false) => (
    <View style={[ui.between, { gap: 12 }]}><Text style={[ui.small, { color: strong ? p.text : p.muted, flex: 1, fontWeight: strong ? "700" : "400" }]}>{label}</Text><Text style={{ color: p.text, fontWeight: strong ? "700" : "600" }}>{value}</Text></View>
  );
  return (
    <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 10 }]}>
      <View style={[ui.between, { gap: 10 }]}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>{monthLabel(s.period)}</Text>
          <Text style={[ui.small, { color: p.muted }]}>{s.propertyName}</Text>
        </View>
        <Tag label={s.status === "paid" ? "Paid" : s.payoutMinor < 0 ? "Balance due" : "Issued"} tone={s.status === "paid" ? "good" : s.payoutMinor < 0 ? "bad" : "plain"} p={p} />
      </View>
      {line("Booking income", pounds(s.revenueMinor))}
      {line(`Cleaning (${s.cleaningCount})`, "−" + pounds(s.cleaningMinor))}
      {line("Repairs and supplies", "−" + pounds(s.expensesMinor))}
      {line(`Management fee (${s.feeBps / 100}%)`, "−" + pounds(s.feeMinor))}
      <View style={{ height: 1, backgroundColor: p.border }} />
      {line(s.payoutMinor < 0 ? "You owe" : "Your payout", pounds(Math.abs(s.payoutMinor)), true)}
      {s.status === "paid" && <Text style={[ui.small, { color: p.muted }]}>Paid by bank transfer{s.paidAt ? ` on ${new Date(s.paidAt).toLocaleDateString("en-GB")}` : ""}, reference {s.payoutReference}.</Text>}
      {s.status === "issued" && s.payoutMinor >= 0 && <Text style={[ui.small, { color: p.muted }]}>Your payout is being prepared.</Text>}
      <MotionPress accessibilityRole="button" onPress={() => setOpen(v => !v)} style={[ui.row, { gap: 6 }]}>
        <ExpandChevron open={open} size={16} color={p.primary} /><Text style={{ color: p.primary, fontWeight: "600" }}>{open ? "Hide the detail" : "See every stay and cost"}</Text>
      </MotionPress>
      {open && <View style={{ gap: 6 }}>
        {s.detail.stays.map(x => line(`${dayLabel(x.checkIn)} to ${dayLabel(x.checkOut)}`, pounds(x.amountMinor)))}
        {s.detail.expenses.map(x => line(`${x.supplier} (${x.reference})`, "−" + pounds(x.amountMinor)))}
        {!s.detail.stays.length && !s.detail.expenses.length && <Text style={[ui.small, { color: p.muted }]}>No stays or costs this month.</Text>}
      </View>}
      <StatementFiles p={p} statement={s} audience="owner" />
    </View>
  );
}
