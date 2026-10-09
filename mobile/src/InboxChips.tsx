import { View } from "react-native";
import { Pills } from "./LiveAccounts";
import type { Palette } from "./theme";
import { ALL_PROPERTIES, INBOX_CHIP_LABEL, type InboxChip } from "../../lib/inbox-filters";

// The inbox's quick filters: one row of chips with counts (Unread, Needs a reply, Mine…) and, when
// the conversations cover more than one property, a row of properties. Both combine with the tab.
export function InboxChips<C extends InboxChip>({ p, chips, chip, counts, onChip, properties, property, onProperty }: {
  p: Palette; chips: readonly C[]; chip: C; counts: Record<InboxChip, number>; onChip: (chip: C) => void;
  properties: { id: string; name: string; count: number }[]; property: string; onProperty: (id: string) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Pills p={p} values={chips} value={chip} onChange={onChip} label={c => `${INBOX_CHIP_LABEL[c]} (${counts[c] ?? 0})`} />
      {properties.length > 1 && <Pills p={p} values={[ALL_PROPERTIES, ...properties.map(x => x.id)]} value={property} onChange={onProperty}
        label={id => { const x = properties.find(y => y.id === id); return x ? `${x.name} (${x.count})` : "All properties"; }} />}
    </View>
  );
}
