import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { AccessControl } from "./LiveAccessControl";
import { ui, type Palette } from "./theme";
import { Button, Notice, Section, useWorkFocus, Loading } from "./LiveKit";
import { List, Row } from "./LiveAccounts";
import { Pills } from "./Pills";
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
import { ResponsibilitiesTab, RotaTab } from "./LiveTeamTime";
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
// and written to the backend only.

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

const MANAGEMENT_VIEWS = ["queue", "people", "properties", "productivity", "performance", "team", "training", "onboarding", "decisions", "reflections", "dailytasks", "rota", "responsibilities", "access"] as const;
type ManagementView = (typeof MANAGEMENT_VIEWS)[number];
export function LiveManagement({ palette: p, account, properties, work, onOpenWork }: { palette: Palette; account: WorkspaceAccount } & Partial<Pick<SectionProps, "properties" | "work" | "onOpenWork">>) {
  const [queue, setQueue] = useState<Management | null>(null);
  const [team, setTeam] = useState<z.infer<typeof performanceSchema>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const focus = useWorkFocus();
  const [view, setView] = useState<ManagementView>(() => MANAGEMENT_VIEWS.find(v => v === focus?.sub) ?? "queue");
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

  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>Management</Text>
        <Text style={[ui.body, { color: p.muted }]}>Everything waiting on a management decision, in one place.</Text>
      </View>
      {/* Today's Management daily tasks, ticked here or on the To-do list (the same to-dos). */}
      <ManagementChecklist p={p} account={account} onSetUp={() => { setDailyOnly("management"); setView("dailytasks"); }} />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {loading && view === "team" && <Loading p={p} />}
      <Pills p={p} title="Management section" values={MANAGEMENT_VIEWS.filter(v => (v !== "access" || account.role === "super_admin") && (v !== "onboarding" || isWorkspaceAdmin(account.role)))} value={view} onChange={setView} label={v => ({ queue: "Waiting on you", people: "People", properties: "Properties", productivity: "Productivity", performance: "Team performance", team: "Cleaning team", training: "Onboarding & training", decisions: "Decisions", reflections: "Day reflections", onboarding: "Onboarding settings", dailytasks: "Daily tasks", rota: "Rota", responsibilities: "Responsibilities", access: "Access control" })[v]} />

      {view === "access" && <AccessControl palette={p} account={account} />}
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
      {view === "productivity" && <LiveProductivity key={productivityTab} palette={p} account={account} initial={productivityTab} />}
      {view === "performance" && <LiveTeamPerformance palette={p} role={account.role} />}
      {(view === "people" || view === "properties") && <LivePeople palette={p} account={account} view={view} />}

      {view === "team" && <Button label={loading ? "Refreshing…" : "Refresh"} icon="refresh-cw" p={p} disabled={loading} onPress={() => void load()} />}
    </View>
  );
}
