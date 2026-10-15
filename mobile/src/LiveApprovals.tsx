import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { useSaved } from "./Celebrate";
import { MotionPress } from "./motion";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, Field, message, Notice, Section, StatGrid, StatTile, Tag, useRequestId } from "./LiveKit";
import { List, Row } from "./LiveAccounts";
import { EmptyState, PageHeading, SoftButton } from "./LivePages";
import { WorkPhotos } from "./Photos";
import { ApprovalContractor } from "./RepairContractors";
import { writeOperation } from "./backend/client";
import { formatMoney } from "../../lib/format";
import { managementReason } from "../../lib/repair-approvals";
import { repairTypeLabel } from "../../lib/repair-guides";
import { ownerApprovals, type RepairApproval } from "../../lib/owner-approvals";
import type { RepairApproval as ManagementRepair } from "../../lib/management-live";
import type { JourneyView, OperationView, WorkflowForm } from "../../lib/workflow-forms";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import type { PropertyView } from "../../lib/workspace-view";

// A repair cost someone has to say yes or no to: management (at or over the company repair limit, or a
// contractor estimate), then the owner. Declining needs a reason, which Stays see on the repair.
export type CostDecision = {
  who: "owner" | "management"; workId: string; version: number; propertyName: string; issue: string;
  repairType: string | null; urgent: boolean; hazard: boolean;
  estimateMinor: number | null; previousEstimateMinor: number | null; quoteReason: string | null; limitText: string | null;
};
type Choice = "approve" | "decline";

// A repair waiting for management, as Management decides it (Management and admins' Home).
export function managementCostDecision(r: ManagementRepair): CostDecision {
  return {
    who: "management", workId: r.workId, version: r.version, propertyName: r.propertyName, issue: r.issue ?? r.title, repairType: r.repairType, urgent: r.urgent, hazard: r.hazard,
    estimateMinor: r.estimatedCostMinor, previousEstimateMinor: r.previousEstimateMinor, quoteReason: r.quoteReason,
    limitText: managementReason(r),
  };
}

export function ownerLimitText(r: Pick<RepairApproval, "limitMinor" | "anyAmount">) {
  if (r.anyAmount) return "You authorised repairs of any amount, but this one was sent to you to check.";
  const checked = "Recharge have checked this quote. Repairs at or over our repair limit need your approval too.";
  return r.limitMinor ? `${checked} You pre-authorised repairs up to ${formatMoney(r.limitMinor)}, and this one is above that.` : checked;
}

// One flow, top to bottom: what is wrong (with any photos), the amount (and the earlier quote if it
// was re-quoted, and the limit it is above), the confirmation tick, then one "Approve £X". Decline is
// the secondary choice and opens the reason field. Management decide in the same layout.
export function CostDecisionSheet({ p, decision, start = "approve", onClose, onDone, onMessage }: { p: Palette; decision: CostDecision | null; start?: Choice; onClose: () => void; onDone: () => Promise<void>; onMessage?: () => void }) {
  const [choice, setChoice] = useState<Choice>(start);
  const [consent, setConsent] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(decision ? [decision.workId, decision.version, choice, text.trim()].join(":") : null);
  useEffect(() => { queueMicrotask(() => { setChoice(start); setConsent(false); setText(""); setError(""); }); }, [decision, start]);
  const owner = decision?.who === "owner", amount = formatMoney(decision?.estimateMinor);
  const choose = (next: Choice) => { setChoice(next); setText(""); setError(""); };
  async function save() {
    if (!decision || busy) return;
    const reason = text.trim();
    if (choice === "approve" && !consent) { setError("Tick to approve the cost."); return; }
    if (choice === "decline" && reason.length < 5) { setError("Say why you are declining (at least 5 characters). It is shared with the team."); return; }
    if (reason.length > 2000) { setError("Keep it under 2,000 characters."); return; }
    const step = choice === "approve" ? (owner ? "approveBudget" : "approveManagement") : (owner ? "declineBudget" : "declineManagement");
    const data = choice === "decline" ? { reason } : owner ? { consent: true } : reason ? { note: reason } : {};
    setBusy(true); setError("");
    try {
      await writeOperation({ action: "updateOperation", requestId: request.get(), workId: decision.workId, version: decision.version, step, data } as Parameters<typeof writeOperation>[0]);
      request.done(); onClose(); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const label = { color: p.muted, fontSize: 13, fontWeight: "700" as const };
  const tags = decision ? [
    decision.repairType ? <Tag key="type" label={repairTypeLabel(decision.repairType)} tone="plain" p={p} /> : null,
    decision.urgent ? <Tag key="urgent" label="Urgent" tone="bad" p={p} /> : null,
    decision.hazard ? <Tag key="hazard" label="Safety hazard" tone="bad" p={p} /> : null,
  ].filter(Boolean) : [];
  // One block, so every part keeps the same 14px gap (the sheet staggers its direct children).
  return (
    <Sheet palette={p} visible={!!decision} onClose={onClose} title={decision?.propertyName ?? ""} subtitle={owner ? "A repair cost waiting for your approval" : "A repair cost for management to approve"} icon="hardhat">
      {decision && <View style={{ gap: 14 }}>
        {/* What is wrong, and where. */}
        <View style={{ gap: 8 }}>
          <Text style={label}>What’s wrong at {decision.propertyName}</Text>
          <Text style={[ui.body, { color: p.text }]}>{decision.issue}</Text>
          {!!tags.length && <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>{tags}</View>}
        </View>
        <WorkPhotos key={decision.workId + ":" + decision.version} p={p} workId={decision.workId} title="Photos" />
        {/* A contractor's estimate: who sent it, what the work is and the quote they attached. Owners approve these after the
            team's review (Repairs with contractors); the team records the owner's answer while owners have no accounts. */}
        <ApprovalContractor key={"contractor:" + decision.workId + ":" + decision.version} p={p} workId={decision.workId} version={decision.version} showReason={decision.previousEstimateMinor === null || !decision.quoteReason} />
        {/* The amount, the earlier quote if it changed, and the limit it is above. */}
        <View style={{ gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: p.border, backgroundColor: p.background }}>
          <View style={{ gap: 2 }}>
            <Text style={label}>{decision.previousEstimateMinor !== null ? "New quote" : "Quoted cost"}</Text>
            <Text style={{ color: p.text, fontSize: 30, lineHeight: 36, fontWeight: "700", letterSpacing: -1, fontVariant: ["tabular-nums"] }}>{amount}</Text>
          </View>
          {decision.previousEstimateMinor !== null && <View style={{ gap: 2 }}>
            <Text style={[ui.small, { color: p.text }]}>Earlier quote: <Text style={{ fontWeight: "700", fontVariant: ["tabular-nums"] }}>{formatMoney(decision.previousEstimateMinor)}</Text></Text>
            {!!decision.quoteReason && <Text style={[ui.small, { color: p.muted }]}>Why it changed: {decision.quoteReason}</Text>}
          </View>}
          {!!decision.limitText && <Text style={[ui.small, { color: p.muted }]}>{decision.limitText}</Text>}
        </View>
        {choice === "approve" ? <>
          {!owner && <Field label="Note for the team (optional)" value={text} onChange={setText} p={p} multiline placeholder="For example: checked against the last invoice. The owner does not see this." />}
          <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: consent }} onPress={() => { setConsent(c => !c); setError(""); }}
            style={[ui.row, { gap: 12, minHeight: 48, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, backgroundColor: consent ? p.successWash : p.elevated }]}>
            <Feather name={consent ? "check-square" : "square"} size={20} color={consent ? p.success : p.muted} />
            <Text style={{ color: p.text, flex: 1 }}>{owner ? `I approve spending up to ${amount} on this repair` : `I approve ${amount} for this repair`}</Text>
          </MotionPress>
          {!!error && <Notice text={error} p={p} tone="bad" />}
          <Button label={busy ? "Saving…" : `Approve ${amount}`} icon="check" primary p={p} disabled={busy || !consent} onPress={() => void save()} />
          <Button label="Decline" icon="x" p={p} disabled={busy} onPress={() => choose("decline")} />
        </> : <>
          <Field label={owner ? "Why you are declining" : "Why it is declined"} value={text} onChange={setText} p={p} multiline placeholder={owner ? "For example: please get a second quote first" : "For example: use the spare part in the store"} />
          <Text style={[ui.small, { color: p.muted }]}>{owner ? "Recharge sees your reason on the repair and can get a new quote or close it." : "Stays see the reason on the repair and can re-quote or close it."}</Text>
          {!!error && <Notice text={error} p={p} tone="bad" />}
          <Button label={busy ? "Saving…" : "Decline the cost"} icon="x" primary p={p} disabled={busy || text.trim().length < 5} onPress={() => void save()} />
          <Button label="Back to approving" icon="arrow-left" p={p} disabled={busy} onPress={() => choose("approve")} />
        </>}
        {owner && onMessage && <MotionPress accessibilityRole="link" accessibilityLabel="Message Recharge about this repair" hitSlop={8} onPress={() => { onClose(); onMessage(); }}
          style={[ui.row, { gap: 6, minHeight: 44, alignSelf: "center", paddingHorizontal: 10 }]}>
          <Feather name="message-circle" size={15} color={p.primary} />
          <Text style={{ color: p.primary, fontSize: 14, fontWeight: "600" }}>Message Recharge</Text>
        </MotionPress>}
      </View>}
    </Sheet>
  );
}

// The owner's Approvals: everything waiting for their decision, in one list.
export function LiveApprovals({ palette: p, account, properties, journeys, work, loading, onForm, onRefresh, onInbox, onProperties }: {
  palette: Palette; account: WorkspaceAccount; properties: PropertyView[]; journeys: JourneyView[]; work: OperationView[]; loading: boolean;
  onForm: (form: WorkflowForm) => void; onRefresh: () => Promise<void>; onInbox: () => void; onProperties: () => void;
}) {
  const saved = useSaved();
  const items = useMemo(() => ownerApprovals(account, work, journeys, properties), [account, work, journeys, properties]);
  const repairs = items.filter((x): x is RepairApproval => x.kind === "repair"), steps = items.filter(x => x.kind === "onboarding");
  const [open, setOpen] = useState<{ decision: CostDecision; start: Choice } | null>(null);
  const decide = (r: RepairApproval, start: Choice) => setOpen({ start, decision: {
    who: "owner", workId: r.work.workId, version: r.work.version, propertyName: r.propertyName, issue: r.issue, repairType: r.repairType, urgent: r.urgent, hazard: r.hazard,
    estimateMinor: r.estimateMinor, previousEstimateMinor: r.previousEstimateMinor, quoteReason: r.quoteReason, limitText: ownerLimitText(r),
  } });
  return (
    <>
      <PageHeading palette={p} title="Approvals" subtitle="Repair costs and onboarding steps waiting for your decision." />
      <StatGrid>
        <StatTile p={p} icon="clock" tone="clients" label="Waiting for you" value={loading ? "…" : items.length} attention={items.length > 0} />
        <StatTile p={p} icon="tool" tone="clients" label="Repair costs" value={loading ? "…" : repairs.length} />
        <StatTile p={p} icon="key" tone="clients" label="Onboarding steps" value={loading ? "…" : steps.length} />
      </StatGrid>
      {!items.length && <EmptyState palette={p} title={loading ? "Checking what needs you…" : "Nothing is waiting for you"} detail="When a repair cost or an onboarding step needs your decision, it appears here." />}
      {!!repairs.length && <Section title="Repair costs" count={repairs.length} p={p}>
        {repairs.map(r => (
          <View key={r.key} style={[ui.card, { backgroundColor: p.surface, borderColor: p.primary, gap: 10 }]}>
            <MotionPress accessibilityRole="button" accessibilityLabel={`${r.propertyName}: ${r.issue}, ${formatMoney(r.estimateMinor)}. Review`} onPress={() => decide(r, "approve")} style={{ gap: 8 }}>
              <View style={[ui.between, { gap: 10, alignItems: "flex-start" }]}>
                <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>{r.propertyName}</Text>
                  <Text numberOfLines={3} style={[ui.small, { color: p.text }]}>{r.issue}</Text>
                </View>
                <Text style={{ color: p.text, fontSize: 20, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{formatMoney(r.estimateMinor)}</Text>
              </View>
              <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
                {!!r.repairType && <Tag label={repairTypeLabel(r.repairType)} tone="plain" p={p} />}
                {r.urgent && <Tag label="Urgent" tone="bad" p={p} />}
                {r.hazard && <Tag label="Safety hazard" tone="bad" p={p} />}
                {r.previousEstimateMinor !== null && <Tag label={`Quote updated from ${formatMoney(r.previousEstimateMinor)}`} tone="wait" p={p} />}
              </View>
              <Text style={[ui.small, { color: p.muted }]}>{ownerLimitText(r)}</Text>
            </MotionPress>
            <View style={[ui.row, { gap: 8 }]}>
              <Button label="Approve" icon="check" primary p={p} onPress={() => decide(r, "approve")} />
              <Button label="Decline" icon="x" p={p} onPress={() => decide(r, "decline")} />
            </View>
          </View>
        ))}
      </Section>}
      {!!steps.length && <Section title="Onboarding steps" count={steps.length} p={p}>
        <List p={p} empty="">
          {steps.map((s, i) => s.kind === "onboarding" && <Row key={s.key} p={p} first={i === 0} icon={s.step === "submitForm" ? "clipboard" : s.step === "signAgreement" ? "edit-3" : "trending-up"} tone="clients"
            title={s.title} detail={`${s.propertyName} · ${s.detail}`} tags={[["Your turn", "wait"]]} onPress={() => onForm(s.form)} />)}
        </List>
        <SoftButton label="See each property's onboarding" icon="arrow-right" palette={p} onPress={onProperties} />
      </Section>}
      <SoftButton label="Message Recharge" icon="arrow-right" palette={p} onPress={onInbox} />
      <CostDecisionSheet p={p} decision={open?.decision ?? null} start={open?.start} onClose={() => setOpen(null)} onDone={saved(onRefresh)} onMessage={onInbox} />
    </>
  );
}
