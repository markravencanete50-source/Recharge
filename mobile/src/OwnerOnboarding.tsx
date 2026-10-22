import { useCallback, useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Button, message, Notice, useRequestId } from "./LiveKit";
import { CourseVideo } from "./LiveTraining";
import { EstimateExplorer } from "./LiveEstimate";
import { EstimateGuide } from "./LiveOnboardingGuide";
import { WorkHistory } from "./WorkHistory";
import { TrackerProgress } from "./Tracker";
import { journeyProgress } from "../../lib/tracker-onboarding";
import { readClientOnboarding, saveClientOnboarding } from "./backend/client";
import { ui, type Palette } from "./theme";
import { clientOnboardingSchema, decisionForms, DECISION_BUTTON, firstOpenStep, ownerChecklist, propertyFacts, TBC, type ClientOnboarding, type Decision, type FactRow, type SeenStep, type StepMark, type VideoStep } from "../../lib/client-onboarding";
import { FEES, PROCESS, SERVICES, WELCOME } from "../../lib/onboarding-content";
import { journeyForms, type JourneyView, type WorkflowForm } from "../../lib/workflow-forms";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import type { PropertyView } from "../../lib/workspace-view";

// The owner's onboarding ticket (Alex's framework, migration 20261025200000). Two panes on a wide screen, stacked on a
// phone: on the left what we know about the property ("TBC" until we have it); on the right the checklist (Welcome;
// Process, fees and services; Estimate), then the rest of the onboarding exactly as before (`details`, which keeps the
// agreement and signing unchanged) and the activity on this property.
export function OwnerOnboarding({ p, account, j, property, onForm, details }: { p: Palette; account: WorkspaceAccount; j: JourneyView; property: PropertyView; onForm: (f: WorkflowForm) => void; details: ReactNode }) {
  const [data, setData] = useState<ClientOnboarding | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [width, setWidth] = useState(0);
  const [open, setOpen] = useState<VideoStep | null | undefined>(undefined);
  const request = useRequestId("seen:" + j.propertyId);
  const load = useCallback(async () => {
    try { setData(clientOnboardingSchema.parse((await readClientOnboarding(j.propertyId)).data)); setError(""); }
    catch (e) { setError(message(e)); }
  }, [j.propertyId]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load, j.version]);
  const steps = ownerChecklist(j, data?.seen ?? { welcome: null, process: null });
  const shown = open === undefined ? (data ? firstOpenStep(steps) : null) : open;
  async function next(step: SeenStep) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await saveClientOnboarding({ action: "markSeen", requestId: request.get(step), propertyId: j.propertyId, step });
      request.done(step);
      await load();
      setOpen(step === "welcome" ? "process" : "estimate");
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const facts = propertyFacts({ answers: data?.answers ?? null, files: data?.files ?? 0, property, journey: { ...j, enquiry: j.enquiry ?? null } });
  const decide = decisionForms(journeyForms(account, j).find(f => f.key === "decideEstimate"));
  const wide = width >= 760;
  const video = (step: VideoStep) => data?.videos[step] ? <CourseVideo p={p} url={data.videos[step]} title={WELCOME.title} onError={setError} /> : null;
  const body = (step: VideoStep): ReactNode => {
    if (step === "welcome") return <View style={{ gap: 10 }}>
      {video("welcome")}
      <Text style={{ color: p.text, fontWeight: "700" }}>{WELCOME.title}</Text>
      {WELCOME.paragraphs.map(text => <Text key={text} style={[ui.body, { color: p.text }]}>{text}</Text>)}
      {!data?.seen.welcome && <Button label="Next" icon="arrow-right" primary p={p} disabled={busy} onPress={() => void next("welcome")} />}
    </View>;
    if (step === "process") return <View style={{ gap: 10 }}>
      {video("process")}
      <Text style={{ color: p.text, fontWeight: "700" }}>How onboarding works</Text>
      {PROCESS.map((s, n) => <Text key={s.step} style={[ui.body, { color: p.text }]}><Text style={{ fontWeight: "700" }}>{n + 1}. {s.step}: </Text>{s.detail}</Text>)}
      <Text style={{ color: p.text, fontWeight: "700" }}>Fees</Text>
      {FEES.map(f => <Text key={f.title} style={[ui.body, { color: p.text }]}><Text style={{ fontWeight: "700" }}>{f.title}: </Text>{f.detail}</Text>)}
      <Text style={{ color: p.text, fontWeight: "700" }}>Services</Text>
      {SERVICES.map(s => <Text key={s.title} style={[ui.body, { color: p.text }]}><Text style={{ fontWeight: "700" }}>{s.title}: </Text>{s.detail}</Text>)}
      {!data?.seen.process && <Button label="Next" icon="arrow-right" primary p={p} disabled={busy} onPress={() => void next("process")} />}
    </View>;
    const mark = steps[2].mark;
    return <View style={{ gap: 12 }}>
      <Text style={[ui.body, { color: p.muted }]}>{steps[2].note}</Text>
      {mark !== "waiting" && video("estimate")}
      {mark !== "waiting" && j.estimate && <EstimateExplorer palette={p} estimate={j.estimate} owner />}
      {(mark === "arrived" || mark === "reviewing") && <EstimateGuide palette={p} />}
      {mark === "reviewing" && !!j.followUpOn && <Text style={[ui.small, { color: p.text }]}>We will check in with you on {new Date(j.followUpOn + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}.</Text>}
      {mark === "declined" && !!j.feedback && <Text style={[ui.small, { color: p.text }]}>Your reason: {j.feedback}</Text>}
      {!!decide && <View style={{ gap: 8 }}>
        {(["proceed", "review", "decline"] as Decision[]).filter(d => !(d === "review" && mark === "reviewing")).map(d => <Button key={d} label={DECISION_BUTTON[d]} icon={d === "proceed" ? "check" : d === "review" ? "clock" : "x"} primary={d === "proceed"} p={p} onPress={() => onForm(decide[d])} />)}
      </View>}
    </View>;
  };
  return (
    <View onLayout={e => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: wide ? "row" : "column", alignItems: "flex-start", gap: 20, width: "100%" }}>
      <View style={{ gap: 14, minWidth: 0, width: wide ? undefined : "100%", flex: wide ? 2 : undefined, padding: 16, borderRadius: 18, backgroundColor: p.wash }}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Property information</Text>
        <Text style={[ui.small, { color: p.muted }]}>What you have told us so far. {TBC} means we still need it; we will ask as we go.</Text>
        <FactGroup p={p} title="About you" rows={facts.about} />
        <FactGroup p={p} title="The property" rows={facts.property} />
        <FactGroup p={p} title="Setting it up" rows={facts.setup} />
      </View>
      <View style={{ gap: 14, minWidth: 0, width: wide ? undefined : "100%", flex: wide ? 3 : undefined }}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Your checklist</Text>
        {/* How far the whole onboarding has come, counted as on the onboarding tracker. */}
        <TrackerProgress p={p} progress={journeyProgress(j.stage)} percent />
        {!!error && <Notice p={p} tone="bad" text={error} />}
        <View style={{ gap: 8 }}>{steps.map(step => {
          const expanded = shown === step.key;
          return <View key={step.key} style={{ borderWidth: 1, borderColor: p.border, borderRadius: 16, overflow: "hidden" }}>
            <MotionPress accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={step.title + ", " + MARK_LABEL[step.mark]} onPress={() => setOpen(expanded ? null : step.key)} style={[ui.row, { gap: 12, minHeight: 52, paddingHorizontal: 14 }]}>
              <Mark p={p} mark={step.mark} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: p.text, fontWeight: "600" }}>{step.title}</Text>
                <Text numberOfLines={expanded ? undefined : 1} style={[ui.small, { color: p.muted }]}>{MARK_LABEL[step.mark]}</Text>
              </View>
              <Feather name={expanded ? "chevron-up" : "chevron-down"} size={18} color={p.muted} />
            </MotionPress>
            {expanded && <View style={{ paddingHorizontal: 14, paddingBottom: 16 }}>{body(step.key)}</View>}
          </View>;
        })}</View>
        {details}
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Activity</Text>
          <WorkHistory key={j.workId} p={p} workId={j.workId} version={j.version} hideNames />
        </View>
      </View>
    </View>
  );
}

const MARK_LABEL: Record<StepMark, string> = { done: "Done", arrived: "Your estimate is ready", reviewing: "Still reviewing", declined: "Not proceeding", waiting: "On its way", todo: "To read" };

// Green tick (done), amber tick (the estimate has arrived), amber dot (still reviewing), red cross (not proceeding),
// grey circle (not yet).
function Mark({ p, mark }: { p: Palette; mark: StepMark }) {
  if (mark === "reviewing") return <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 22, height: 22, alignItems: "center", justifyContent: "center" }}><View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: p.waiting }} /></View>;
  const icon = mark === "declined" ? "x-circle" : mark === "done" || mark === "arrived" ? "check-circle" : "circle";
  const color = mark === "done" ? p.success : mark === "arrived" ? p.waiting : mark === "declined" ? p.danger : p.muted;
  return <Feather name={icon} size={22} color={color} />;
}

function FactGroup({ p, title, rows }: { p: Palette; title: string; rows: FactRow[] }) {
  return <View style={{ gap: 6 }}>
    <Text style={{ color: p.text, fontWeight: "700" }}>{title}</Text>
    {rows.map(r => <View key={r.label} style={[ui.between, { gap: 12, alignItems: "flex-start" }]}>
      <Text style={[ui.small, { color: p.muted, flexShrink: 0, maxWidth: "50%" }]}>{r.label}</Text>
      <Text selectable style={[ui.small, { color: r.value ? p.text : p.muted, fontWeight: r.value ? "600" : "400", flex: 1, textAlign: "right" }]}>{r.value ?? TBC}</Text>
    </View>)}
  </View>;
}
