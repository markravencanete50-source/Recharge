import { createContext, useContext, useMemo } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { EnquiryCard } from "./HomeOverview";
import { Entrance, GrowBar, MotionPress } from "./motion";
import { ui, type Palette } from "./theme";
import { OwnerPeriodSummary } from "./OwnerPeriodSummary";
import { ownerApprovals, propertyProgress } from "../../lib/owner-approvals";
import { newEnquiryForm, type JourneyView, type OperationView, type WorkflowForm } from "../../lib/workflow-forms";
import type { WorkspaceSection } from "../../lib/workspace-map";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import type { PropertyView } from "../../lib/workspace-view";

// What the workspace lends an owner's Home: the unread message count, and a way to open a form
// (a new enquiry, an onboarding step) in the workspace's form sheet, which refreshes afterwards.
export const OwnerActions = createContext<{ unread: number; openForm: (form: WorkflowForm) => void } | null>(null);

// The rest of an owner's Home, below their figures this month and what needs them (LiveHome.tsx): their figures for
// a period they choose (statement style), where each property is up to, and a new enquiry. What waits for them and
// their new messages are lines in "Needs you now", never a tile showing 0.
export function OwnerHome({ palette: p, account, properties, journeys, work, onNavigate }: {
  palette: Palette; desktop: boolean; account: WorkspaceAccount; properties: PropertyView[]; journeys: JourneyView[]; work: OperationView[]; loading: boolean; onNavigate: (section: WorkspaceSection) => void;
}) {
  const actions = useContext(OwnerActions);
  const approvals = useMemo(() => ownerApprovals(account, work, journeys, properties), [account, work, journeys, properties]);
  const progress = useMemo(() => propertyProgress(properties, journeys, approvals), [properties, journeys, approvals]);
  const onboarding = progress.filter(x => !x.live);
  return (
    <Entrance sessionKey="live:owner-home" style={{ gap: 18 }}>
      {/* Earnings, occupancy, nightly rate and bookings for the chosen period, with the statement lines. */}
      {account.modules.includes("owner-statements") && <OwnerPeriodSummary palette={p} onStatements={() => onNavigate("analytics")} />}

      {!!progress.length && <View style={{ gap: 8 }}>
        <View style={ui.between}>
          <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Your properties</Text>
          <Text style={[ui.small, { color: p.muted }]}>{onboarding.length ? `${onboarding.length} being set up` : "All live"}</Text>
        </View>
        <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 6, gap: 0 }]}>
          {progress.slice(0, 8).map((x, i) => {
            const step = approvals.find(a => a.kind === "onboarding" && a.propertyId === x.propertyId);
            return (
              <MotionPress key={x.propertyId} accessibilityRole="button" accessibilityLabel={`${x.name}, ${x.phase}. ${x.next}`}
                onPress={() => step && step.kind === "onboarding" && actions ? actions.openForm(step.form) : onNavigate("properties")}
                style={[ui.row, { gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderColor: p.border, alignItems: "flex-start" }]}>
                <View style={{ width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: x.live ? p.successWash : x.waitingForYou ? p.cautionWash : p.wash }}>
                  <Feather name={x.live ? "check-circle" : x.waitingForYou ? "edit-3" : "clock"} size={18} color={x.live ? p.success : x.waitingForYou ? p.waiting : p.primary} />
                </View>
                <View style={{ flex: 1, gap: 6, minWidth: 0 }}>
                  <View style={[ui.between, { gap: 8 }]}>
                    <Text numberOfLines={1} style={{ color: p.text, fontSize: 15, fontWeight: "600", flex: 1 }}>{x.name}</Text>
                    <Text style={[ui.small, { color: x.live ? p.success : p.muted, fontWeight: "600" }]}>{x.phase}</Text>
                  </View>
                  {!x.live && <GrowBar share={Math.max(0.04, x.done / Math.max(1, x.total))} color={p.primary} track={p.wash} height={6} />}
                  <Text numberOfLines={2} style={[ui.small, { color: x.waitingForYou ? p.text : p.muted, fontWeight: x.waitingForYou ? "600" : "400" }]}>{x.waitingForYou ? "Your turn: " : ""}{x.next}</Text>
                </View>
                <Feather name="chevron-right" size={18} color={p.muted} style={{ alignSelf: "center" }} />
              </MotionPress>
            );
          })}
        </View>
      </View>}

      {account.modules.includes("property-onboarding") && actions && <EnquiryCard palette={p} onStart={() => actions.openForm(newEnquiryForm())} />}
    </Entrance>
  );
}
