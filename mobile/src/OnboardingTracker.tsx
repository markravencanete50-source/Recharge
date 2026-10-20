import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { Button } from "./LiveKit";
import { FlagButton } from "./ManagementFlag";
import { DeleteEnquiryAction } from "./LiveEnquiries";
import { TrackerDetailSheet, TrackerList } from "./Tracker";
import { readTeams } from "./backend/client";
import { ui } from "./theme";
import type { SectionProps } from "./SectionProps";
import { clientEnquiriesSchema, type ClientEnquiry } from "../../lib/client-enquiry";
import { parseFlags, withFlags, type Flag } from "../../lib/management-flags";
import { onboardingSection, onboardingTrackerItems } from "../../lib/tracker-onboarding";
import { journeyForms, newEnquiryForm, workItemForms, type JourneyView, type OperationView } from "../../lib/workflow-forms";
import { agreementTemplateForms } from "../../lib/agreement-template";

// Property onboarding as a staged list (client ask C3): new enquiries first, then each stage, every
// property with the address, the next step, who must act, the last update and a percentage complete.
// Open one for the progress bar and the full checklist; the buttons use the same onboarding forms as
// everywhere else. Owners see their own properties' rows, never staff names or other people's enquiries.
// `onRefresh` reloads the workspace's properties and journeys after an enquiry is deleted here.
export function OnboardingTracker({ palette: p, account, properties, journeys, work, onForm, onOpenWork, onTool, onRefresh }: SectionProps & { onRefresh?: () => Promise<void> | void }) {
  const owner = account.role === "client";
  const team = account.role === "admin" || account.role === "super_admin" || account.role === "stays";
  const [enquiries, setEnquiries] = useState<ClientEnquiry[]>([]);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  // Enquiry forms and flags are read leniently: whoever cannot see them (or an older server) simply has none.
  const load = useCallback(async () => {
    const [e, f] = await Promise.allSettled([readTeams({ section: "clientEnquiries" }), readTeams({ section: "flags" })]);
    if (e.status === "fulfilled") { const parsed = clientEnquiriesSchema.safeParse(e.value.data); if (parsed.success) setEnquiries(parsed.data.items); }
    if (f.status === "fulfilled") setFlags(parseFlags(f.value.data));
  }, []);
  useEffect(() => { if (owner) return; let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load, owner]);

  const items = useMemo(() => {
    const ctx = {
      property: (id: string) => properties.find(x => x.id === id), forms: (w: OperationView) => workItemForms(account, w, journeys, work),
      workOf: (id: string) => work.find(w => w.workId === id), now: new Date(), owner, canAct: team,
    };
    return withFlags(onboardingTrackerItems(journeys, enquiries, ctx), flags);
  }, [journeys, enquiries, properties, work, account, owner, team, flags]);
  const open = items.find(i => i.id === openId) ?? null;
  const journey = open && !open.id.startsWith("enquiry:") ? open.source as JourneyView : null;
  const root = journey ? work.find(w => w.workId === journey.workId) : undefined;
  const forms = journey ? (root ? workItemForms(account, root, journeys, work) : [...agreementTemplateForms(account, journey), ...journeyForms(account, journey)]) : [];
  // The client enquiry this onboarding came from (or the enquiry row itself), for Delete at the bottom.
  const enquiry = open ? (open.id.startsWith("enquiry:") ? open.source as ClientEnquiry : enquiries.find(e => !!journey && e.propertyId === journey.propertyId)) : undefined;
  const canAdd = (owner || team) && account.modules.includes("property-onboarding");

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Onboarding</Text>
        <Text style={[ui.small, { color: p.muted }]}>New enquiries first, then each property by stage. Open one for its progress and checklist.</Text>
      </View>
      {canAdd && <Button label="Add a property enquiry" icon="plus" primary p={p} onPress={() => onForm(newEnquiryForm(team))} />}
      <TrackerList p={p} items={items} owner={owner} percent sectionOf={onboardingSection} onOpen={i => setOpenId(i.id)} empty="No properties are onboarding." />
      <TrackerDetailSheet p={p} item={open} owner={owner} percent forms={forms} onForm={onForm} onClose={() => setOpenId(null)}>
        {!!open && <View style={{ gap: 10 }}>
          {!journey && <Button label="Open Leads" icon="external-link" primary p={p} onPress={() => { setOpenId(null); onTool({ kind: "work", view: "clients", sub: "enquiries" }); }} />}
          {!!root && <Button label="Open the full ticket" icon="external-link" p={p} onPress={() => { setOpenId(null); onOpenWork(root); }} />}
          {!!journey && <FlagButton p={p} role={account.role} target={{ workId: journey.workId, propertyId: open.propertyId, title: `Onboarding: ${open.address}` }} onDone={() => void load()} />}
          {!!enquiry && <DeleteEnquiryAction p={p} role={account.role} enquiry={enquiry} onDeleted={async () => { setOpenId(null); await Promise.all([load(), onRefresh?.()]); }} />}
        </View>}
      </TrackerDetailSheet>
    </View>
  );
}
