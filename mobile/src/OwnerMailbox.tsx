import { useMemo } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { ui, type Palette } from "./theme";
import { Section } from "./LiveKit";
import { List, Row } from "./LiveAccounts";
import { MailboxSection } from "./LiveTools";
import { ownerMailboxDocuments } from "../../lib/owner-approvals";
import type { JourneyView } from "../../lib/workflow-forms";
import type { PropertyView } from "../../lib/workspace-view";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

// The owner's Mailbox, a page of its own (Lee: Portfolio and Mailbox are different pages): what Recharge sent them, such
// as their management agreement, and the post handled at their properties (when they have the mailbox service).
export function OwnerMailbox({ palette: p, account, journeys, properties, onOpenProperty, onSign }: {
  palette: Palette; account: WorkspaceAccount; journeys: JourneyView[]; properties: PropertyView[]; onOpenProperty: (id: string) => void; onSign: () => void;
}) {
  const documents = useMemo(() => ownerMailboxDocuments(account, journeys, properties), [account, journeys, properties]);
  return (
    <View style={{ gap: 24 }}>
      <Section title="From Recharge" count={documents.length || undefined} p={p}>
        <Text style={[ui.small, { color: p.muted }]}>Documents Recharge sent you about your properties. Open one to read it, sign it or download a copy.</Text>
        <List p={p} empty="Nothing from Recharge yet. Your management agreement will arrive here.">
          {documents.map((d, i) => <Row key={d.key} p={p} first={i === 0} icon="file-text" tone="clients" title={d.title} detail={d.detail}
            tags={[d.toSign ? ["Sign now", "wait"] : ["Agreement", "plain"]]} onPress={() => (d.toSign ? onSign() : onOpenProperty(d.propertyId))} />)}
        </List>
      </Section>
      {account.modules.includes("client-mailbox") && <MailboxSection palette={p} />}
    </View>
  );
}
