import { createContext, useContext, useMemo } from "react";
import { Platform, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { DimensionalIcon, type DimensionalName } from "./DimensionalIcon";
import { EnquiryCard } from "./HomeOverview";
import { Entrance, GrowBar, MotionPress, Stagger, TweenNumber } from "./motion";
import { ui, type Palette } from "./theme";
import { OwnerPeriodSummary } from "./OwnerPeriodSummary";
import { ownerApprovals, propertyProgress } from "../../lib/owner-approvals";
import { formatCount, formatMoneyShort } from "../../lib/format";
import { newEnquiryForm, type JourneyView, type OperationView, type WorkflowForm } from "../../lib/workflow-forms";
import type { WorkspaceSection } from "../../lib/workspace-map";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import type { PropertyView } from "../../lib/workspace-view";

// What the workspace lends an owner's Home: the unread message count, and a way to open a form
// (a new enquiry, an onboarding step) in the workspace's form sheet, which refreshes afterwards.
export const OwnerActions = createContext<{ unread: number; openForm: (form: WorkflowForm) => void } | null>(null);
const hover = Platform.OS === "web" ? { dataSet: { hover: "lift" } } : {};

type Tile = { key: string; icon: DimensionalName; value: number | null; money?: boolean; label: string; hint: string; attention: boolean; onPress: () => void };

// An owner's Home: what is waiting for them, new messages, their figures for a period they choose
// (statement style), where each property is up to, and a new enquiry.
export function OwnerHome({ palette: p, desktop, account, properties, journeys, work, loading, onNavigate }: {
  palette: Palette; desktop: boolean; account: WorkspaceAccount; properties: PropertyView[]; journeys: JourneyView[]; work: OperationView[]; loading: boolean; onNavigate: (section: WorkspaceSection) => void;
}) {
  const actions = useContext(OwnerActions);
  const approvals = useMemo(() => ownerApprovals(account, work, journeys, properties), [account, work, journeys, properties]);
  const progress = useMemo(() => propertyProgress(properties, journeys, approvals), [properties, journeys, approvals]);
  const unread = actions?.unread ?? 0;
  const tiles: Tile[] = [
    { key: "waiting", icon: "hourglass", value: loading ? null : approvals.length, label: "Waiting for you", hint: "Open your approvals", attention: approvals.length > 0, onPress: () => onNavigate("approvals") },
    { key: "messages", icon: "chat", value: unread, label: unread === 1 ? "New message" : "New messages", hint: "Open your inbox", attention: unread > 0, onPress: () => onNavigate("inbox") },
  ];
  const onboarding = progress.filter(x => !x.live);
  return (
    <Entrance sessionKey="live:owner-home" style={{ gap: 18 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {tiles.map((tile, i) => (
          <Stagger key={tile.key} index={i} style={{ flexBasis: desktop ? "30%" : "46%", flexGrow: 1, minWidth: 0 }}>
            <MotionPress {...hover} accessibilityRole="button" accessibilityLabel={`${tile.value === null ? "Unavailable" : tile.money ? formatMoneyShort(tile.value) : formatCount(tile.value)} ${tile.label}. ${tile.hint}`} onPress={tile.onPress}
              style={{ padding: 16, gap: 12, borderRadius: 24, backgroundColor: tile.attention ? p.wash : p.surface, borderWidth: 1, borderColor: tile.attention ? p.primary : p.border, ...(Platform.OS === "web" ? { boxShadow: "var(--rc-elev-1),var(--rc-sheen)" } : { elevation: 2 }) }}>
              <View style={[ui.between, { alignItems: "flex-start" }]}>
                <View style={{ width: 54, height: 54, borderRadius: 18, backgroundColor: tile.attention ? p.surface : p.wash, alignItems: "center", justifyContent: "center" }}><DimensionalIcon name={tile.icon} size={42} /></View>
                <Feather name="chevron-right" size={18} color={p.muted} />
              </View>
              <View style={{ gap: 2 }}>
                {tile.value === null ? <Text style={{ color: p.text, fontSize: 28, lineHeight: 34, fontWeight: "700" }}>—</Text>
                  : <TweenNumber value={tile.value} format={tile.money ? formatMoneyShort : formatCount} numberOfLines={1} adjustsFontSizeToFit style={{ color: p.text, fontSize: 28, lineHeight: 34, fontWeight: "700", letterSpacing: -1, fontVariant: ["tabular-nums"] }} />}
                <Text numberOfLines={1} style={{ color: p.muted, fontSize: 13, fontWeight: "500" }}>{tile.label}</Text>
              </View>
            </MotionPress>
          </Stagger>
        ))}
      </View>

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
