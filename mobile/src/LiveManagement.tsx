import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { AccessControl } from "./LiveAccessControl";
import { space, ui, type Palette } from "./theme";
import { Button, Notice, Section, useWorkFocus, Loading } from "./LiveKit";
import { List, Row } from "./LiveAccounts";
import { ToolCards, ToolHeader, ToolTitled, type ToolCard } from "./ToolPage";
import { LiveTraining } from "./LiveTraining";
import { LivePeople } from "./LivePeople";
import { LiveTeamPerformance } from "./LiveShifts";
import { LiveProductivity } from "./LiveProductivity";
import { shiftChangesSchema, type ShiftChanges } from "../../lib/workspace-teams-policy";
import { describeChange, minutesDelta } from "../../lib/productivity";
import { DecisionsReport } from "./LiveOversight";
import { DailyTaskSettings } from "./DailyTaskSettings";
import { OnboardingSettings } from "./OnboardingSettings";
import { isWorkspaceAdmin } from "../../lib/modules";
import { ManagementChecklist } from "./ManagementChecklist";
import { ReflectionReview } from "./ReflectionReview";
import { ManagementApprovals } from "./ManagementApprovals";
import { LimitChanger } from "./LimitChanger";
import { ResponsibilitiesTab, RotaTab } from "./LiveTeamTime";
import { VaPayPanel } from "./VaPay";
import { readTeams, WorkspaceApiError } from "./backend/client";
import { managementSchema, type Management } from "../../lib/management-live";
import { performanceSchema } from "../../lib/cleans-live";
import type { SectionProps } from "./SectionProps";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import type { z } from "zod";

// Live Management: the approvals list (everything waiting on admins, in ManagementApprovals), the
// cleaning team's month, training, the team's day reflections and the daily tasks added to each to-do
// list. Admins also plan the rota and keep the responsibilities register here; everyone's own timesheet
// is on My performance, and the team's hours are under Productivity and Team performance. Read from
// and written to the backend only. The centre lists its tools as cards and each opens on a page of its own (ToolPage.tsx).

// Changes to people's hours waiting for a super admin (the Productivity Tool's approvals).
function ShiftChangesWaiting({ p, onOpen }: { p: Palette; onOpen: () => void }) {
  const [changes, setChanges] = useState<ShiftChanges | null>(null);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { void readTeams({ section: "shiftChanges" }).then(r => { if (active) setChanges(shiftChangesSchema.parse(r.data)); }).catch(() => undefined); });
    return () => { active = false; };
  }, []);
  if (!changes) return null;
  return (
    <Section title={changes.canApprove ? "Timesheet changes to approve" : "Timesheet changes with a super admin"} count={changes.pending.length} p={p}>
      <List p={p} empty="No changes to anyone's hours waiting." search={false}>
        {changes.pending.map((c, i) => {
          const d = describeChange(c);
          return <Row key={c.id} p={p} first={i === 0} avatar={c.fullName ?? "Team member"} title={c.fullName ?? "Team member"} detail={`${d.day} · ${d.before ? d.before + " → " : ""}${d.after} · asked by ${c.requestedByName ?? "an admin"}`}
            tags={[[minutesDelta(d.delta), d.delta >= 0 ? "good" : "bad"]]} onPress={onOpen} />;
        })}
      </List>
    </Section>
  );
}

const MANAGEMENT_VIEWS = ["queue", "people", "properties", "productivity", "performance", "team", "training", "onboarding", "limits", "decisions", "vapay", "reflections", "dailytasks", "rota", "responsibilities", "access"] as const;
type ManagementView = (typeof MANAGEMENT_VIEWS)[number];
// Each tool's card on the Management centre and the heading of its own page: its name, one line on what is inside, its icon.
const TOOL: Record<ManagementView, ToolCard<ManagementView>> = {
  queue: { key: "queue", label: "Waiting on you", detail: "Approvals, flags and requests that need a management decision.", icon: "clock" },
  people: { key: "people", label: "People", detail: "Team accounts, roles and the tools each person has.", icon: "users" },
  properties: { key: "properties", label: "Properties", detail: "Add and edit properties and choose who works on each.", icon: "home" },
  productivity: { key: "productivity", label: "Productivity", detail: "Every clock in and out, with hours by week and month.", icon: "activity" },
  performance: { key: "performance", label: "Team performance", detail: "KPIs, shifts, guest replies and sign-offs.", icon: "award" },
  team: { key: "team", label: "Cleaning team", detail: "Each cleaner's month: cleans accepted, rejected and overturned.", icon: "check-square" },
  training: { key: "training", label: "Onboarding & training", detail: "Courses and course files for the team, and who has done them.", icon: "book-open" },
  onboarding: { key: "onboarding", label: "Onboarding settings", detail: "The agreement contract, Recharge's details and the owner's own costs.", icon: "file-text" },
  limits: { key: "limits", label: "Limit Changer", detail: "Repair spending limits for each owner and property.", icon: "sliders" },
  decisions: { key: "decisions", label: "Decisions", detail: "Every approval and decision in the last 90 days.", icon: "check-circle" },
  vapay: { key: "vapay", label: "VA pay", detail: "Each VA's monthly request for invoice and their pay setup.", icon: "credit-card" },
  reflections: { key: "reflections", label: "Day reflections", detail: "What the team wrote at the end of each day.", icon: "message-square" },
  dailytasks: { key: "dailytasks", label: "Daily tasks", detail: "Tasks added to each department's to-do list on the days you choose.", icon: "list" },
  rota: { key: "rota", label: "Rota", detail: "Who works the early and late shift each day of the week.", icon: "calendar" },
  responsibilities: { key: "responsibilities", label: "Responsibilities", detail: "Who looks after what across the business, with a backup.", icon: "clipboard" },
  access: { key: "access", label: "Access control", detail: "Roles, tools and security for each person.", icon: "shield" },
};
// Tools whose screen already says what it is for under its heading: their page shows that line, not the card's.
const OWN_INTRO: readonly ManagementView[] = ["productivity", "limits", "onboarding", "dailytasks"];
export function LiveManagement({ palette: p, account, properties, work, onOpenWork }: { palette: Palette; account: WorkspaceAccount } & Partial<Pick<SectionProps, "properties" | "work" | "onOpenWork">>) {
  const [queue, setQueue] = useState<Management | null>(null);
  const [team, setTeam] = useState<z.infer<typeof performanceSchema>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const focus = useWorkFocus();
  // Who sees which tool: Access control, Onboarding settings and the Limit Changer are workspace admins' (an admin's
  // Access control covers accounts below admin; the database enforces it).
  const views = MANAGEMENT_VIEWS.filter(v => (v !== "access" || isWorkspaceAdmin(account.role)) && (v !== "onboarding" || isWorkspaceAdmin(account.role)) && (v !== "limits" || isWorkspaceAdmin(account.role)));
  // A link to one tool (the left panel, search, Home, a notification) opens that tool on its own page. Without one the
  // centre opens on its cards (null), and each card opens its tool's page, with "Management centre" to come back.
  const [view, setView] = useState<ManagementView | null>(() => views.find(v => v === focus?.sub) ?? null);
  const [productivityTab, setProductivityTab] = useState<"days" | "changes">("days");
  // "Set up the checklist" opens Daily tasks showing Management's only.
  const [dailyOnly, setDailyOnly] = useState<"management" | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const [q, perf] = await Promise.allSettled([readTeams({ section: "management" }), readTeams({ section: "performance" })]);
    try {
      if (q.status === "fulfilled") setQueue(managementSchema.parse(q.value.data)); else throw q.reason;
      if (perf.status === "fulfilled") setTeam(performanceSchema.parse(perf.value.data));
    } catch (e) { setError(e instanceof WorkspaceApiError ? e.message : "The management queue could not be loaded."); }
    setLoading(false);
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);

  // The Management centre: today's checklist, then a card for each tool within this person's access.
  if (!view) return (
    <View style={{ gap: space.section }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>Management centre</Text>
        <Text style={[ui.body, { color: p.muted }]}>Every management tool, each on its own page.</Text>
      </View>
      {/* Today's Management daily tasks, ticked here or on the To-do list (the same to-dos). */}
      <ManagementChecklist p={p} account={account} onSetUp={() => { setDailyOnly("management"); setView("dailytasks"); }} />
      <ToolCards p={p} title="Choose a management tool" cards={views.map(v => TOOL[v])} onOpen={setView} />
    </View>
  );

  // One tool on its own page: no picker to jump to another tool, and "Management centre" back to the cards.
  return (
    <View style={{ gap: space.section }}>
      <ToolHeader p={p} back="Management centre" onBack={() => { setView(null); setDailyOnly(null); }} title={TOOL[view].label} detail={OWN_INTRO.includes(view) ? undefined : TOOL[view].detail} />
      <ToolTitled.Provider value={true}>
      {!!error && view === "team" && <Notice text={error} p={p} tone="bad" />}
      {loading && view === "team" && <Loading p={p} />}

      {view === "access" && <AccessControl palette={p} account={account} />}
      {/* Repair spending limits per owner and property (super admins change them; admins can look). */}
      {view === "limits" && isWorkspaceAdmin(account.role) && <LimitChanger p={p} work={work} onOpenWork={onOpenWork} />}
      {/* Flags, requests and every pending decision arrive in one list (ManagementApprovals). */}
      {view === "queue" && <>
        <ManagementApprovals palette={p} account={account} properties={properties} work={work} onOpenWork={onOpenWork} />
        <ShiftChangesWaiting p={p} onOpen={() => { setProductivityTab("changes"); setView("productivity"); }} />
      </>}

      {view === "team" && <>
        {!!queue?.cleanerWarnings.length && <Notice text={`${queue.cleanerWarnings.length} cleaner${queue.cleanerWarnings.length === 1 ? " has" : "s have"} two or more upheld rejections this month.`} p={p} tone="bad" />}
        <Section title="Cleaners this month" p={p}>
          <List p={p} empty="No active cleaners yet.">
            {team.map((c, i) => (
              <Row key={c.cleanerId} p={p} first={i === 0} avatar={c.fullName} tone="cleans" title={c.fullName} detail={`${c.accepted} accepted · ${c.rejected} rejected · ${c.overturned} overturned`}
                tags={c.warning ? [["Warning", "bad"]] : c.openComplaints.length ? [[`${c.openComplaints.length} open complaint${c.openComplaints.length === 1 ? "" : "s"}`, "wait"]] : [["On track", "good"]]} />
            ))}
          </List>
        </Section>
      </>}

      {view === "training" && <LiveTraining palette={p} manage />}
      {view === "decisions" && <DecisionsReport palette={p} />}
      {view === "reflections" && <ReflectionReview palette={p} />}
      {view === "onboarding" && <OnboardingSettings p={p} account={account} />}
      {view === "dailytasks" && <DailyTaskSettings p={p} account={account} only={dailyOnly} onShowAll={() => setDailyOnly(null)} />}
      {view === "rota" && <RotaTab p={p} account={account} />}
      {view === "responsibilities" && <ResponsibilitiesTab p={p} account={account} />}
      {/* VA pay (20261022200000): each VA's monthly Request for Invoice and their pay setup; the database keeps it to management. */}
      {view === "vapay" && <VaPayPanel p={p} account={account} place="management" />}
      {view === "productivity" && <LiveProductivity key={productivityTab} palette={p} account={account} initial={productivityTab} />}
      {view === "performance" && <LiveTeamPerformance palette={p} role={account.role} />}
      {(view === "people" || view === "properties") && <LivePeople palette={p} account={account} view={view} />}

      {view === "team" && <Button label={loading ? "Refreshing…" : "Refresh"} icon="refresh-cw" p={p} disabled={loading} onPress={() => void load()} />}
      </ToolTitled.Provider>
    </View>
  );
}
