import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, TextInput, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import { z } from "zod";
import { Text } from "./Typography";
import { useCelebrate } from "./Celebrate";
import { BuildingGlyph } from "./BuildingGlyph";
import { EnquiryCard } from "./HomeOverview";
import { HostawaySyncCard } from "./HostawaySyncCard";
import { LiveTraining } from "./LiveTraining";
import { MyContracts } from "./LiveOnboarding";
import { PropertyAccess, ToolDirectory } from "./LiveTools";
import { LocalEvents } from "./LocalEvents";
import { PropertyProfile } from "./LivePropertyProfile";
import { OnboardingPipeline, PortfolioInsights, type PropertyFilter } from "./LivePortfolio";
import { EstimateExplorer } from "./LiveEstimate";
import { ScotlandMap } from "./ScotlandMap";
import { EstimateGuide, InspectionResult, JourneyQuestions } from "./LiveOnboardingGuide";
import { readEstimate } from "../../lib/estimate-projection";
import { agreementDocument, agreementFileName } from "../../lib/agreement-copy";
import type { BudgetItem } from "../../lib/accounts-work";
import type { WorkView } from "../../lib/tool-directory";
import { portfolioSummary, type PortfolioSummary } from "../../lib/portfolio-overview";
import { formatCount, formatMoney } from "../../lib/format";
import { StatGrid, StatTile, Tag, dayLabel, type IconName } from "./LiveKit";
import { LiveNoticeRow, LiveWorkRow, isDone } from "./LiveRows";
import { Calendar } from "./WorkspaceScreens";
import { Sheet } from "./TeamFlows";
import { StateGraphic } from "./StateGraphic";
import { Entrance, GrowBar, MotionPress, Stagger, SwapIn } from "./motion";
import { departmentColor, ui, type Palette } from "./theme";
import { workspaceRequest, writeControls } from "./backend/client";
import { exportReport } from "./exportReport";
import { weeklyReportDocument, weeklyReportFileName } from "../../lib/weekly-report";
import { isWorkspaceAdmin } from "../../lib/modules";
import { faqsForAccess } from "../../lib/access-faq";
import { dateKey, parseAnalyticsDate, periodError, periodLabel, presetPeriod, type AnalyticsPeriod } from "../../lib/analytics";
import { estimateComparables, MARK_READ_PER_VISIT, onboardingProgress, readableStage, unreadNotices, type InvoiceView, type NoticeView, type PropertyView } from "../../lib/workspace-view";
import { createOperationForms, inspectionReportFrom, journeyForms, newEnquiryForm, operationForms, workflowValues, type JourneyView, type OperationView, type WorkflowField, type WorkflowForm } from "../../lib/workflow-forms";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import { PhotoPicker, WorkPhotos } from "./Photos";

export const message = (error: unknown) => error instanceof Error ? error.message : "The request could not be completed.";
const money = (n: unknown) => formatMoney(Number(n));
const hoverLift = Platform.OS === "web" ? { dataSet: { hover: "lift" } } : {};
export async function liveApi(path: string, body?: Record<string, unknown>) {
  const response = await workspaceRequest("/api/mobile" + path, body);
  return z.object({ data: z.unknown().optional() }).passthrough().parse(await response.json());
}

export function PageHeading({ title, subtitle, palette: p, action }: { title: string; subtitle: string; palette: Palette; action?: ReactNode }) {
  return (
    <View style={[ui.between, { gap: 16, alignItems: "flex-end", flexWrap: "wrap" }]}>
      <View style={{ gap: 6, flexShrink: 1, minWidth: 220 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>{title}</Text>
        <Text style={[ui.body, { color: p.muted }]}>{subtitle}</Text>
      </View>
      {action}
    </View>
  );
}
export function SoftButton({ label, icon, onPress, palette: p, primary = false, disabled = false }: { label: string; icon?: "plus" | "download" | "refresh-cw" | "arrow-right" | "log-out" | "check" | "external-link" | "calendar"; onPress: () => void; palette: Palette; primary?: boolean; disabled?: boolean }) {
  return (
    <MotionPress accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[ui.button, { backgroundColor: primary ? p.primary : p.wash, opacity: disabled ? 0.5 : 1 }]}>
      {!!icon && <Feather name={icon} size={16} color={primary ? p.onPrimary : p.primary} />}
      <Text style={[ui.buttonText, { color: primary ? p.onPrimary : p.primary }]}>{label}</Text>
    </MotionPress>
  );
}
export function EmptyState({ title, detail, palette: p, icon = "check-circle" }: { title: string; detail: string; palette: Palette; icon?: "check-circle" | "home" | "inbox" | "activity" }) {
  return (
    <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, alignItems: "center", paddingVertical: 30 }]}>
      <StateGraphic palette={p} success={icon === "check-circle"} icon={icon} />
      <Text style={[ui.sectionTitle, { color: p.text, textAlign: "center" }]}>{title}</Text>
      <Text style={[ui.body, { color: p.muted, textAlign: "center" }]}>{detail}</Text>
    </View>
  );
}

function Field({ field: f, value, onChange, p, disabled }: { field: WorkflowField; value: unknown; onChange: (value: unknown) => void; p: Palette; disabled?: boolean }) {
  const [calendar, setCalendar] = useState(false);
  if (f.type === "checkbox") return (
    <MotionPress disabled={disabled} accessibilityRole="checkbox" accessibilityState={{ checked: value === true, disabled }} onPress={() => onChange(value !== true)} style={[ui.row, { gap: 12, minHeight: 48, paddingVertical: 10, alignItems: "flex-start" }]}>
      <View style={{ width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: value === true ? p.primary : p.controlBorder, backgroundColor: value === true ? p.primary : "transparent", alignItems: "center", justifyContent: "center" }}>{value === true && <Feather name="check" size={15} color={p.onPrimary} />}</View>
      <View style={{ flex: 1 }}><Text style={[ui.body, { color: p.text }]}>{f.label}</Text>{f.help && <Text style={[ui.small, { color: p.muted }]}>{f.help}</Text>}</View>
    </MotionPress>
  );
  const label = <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{f.label}{!f.required ? " (optional)" : ""}</Text>;
  if (f.type === "date") {
    const text = value ? String(value) : "";
    const parsed = text ? new Date(text + "T12:00:00") : new Date(), selected = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    return (
      <View style={{ gap: 8 }}>
        {label}
        <MotionPress accessibilityRole="button" accessibilityLabel={f.label + ", " + (text || "choose a date")} disabled={disabled} onPress={() => setCalendar(!calendar)} style={[ui.between, { minHeight: 50, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: calendar ? p.primary : p.controlBorder, backgroundColor: p.background }]}>
          <Text style={{ color: text ? p.text : p.muted, fontSize: 15 }}>{text ? new Date(text + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "Choose a date"}</Text>
          <Feather name="calendar" size={17} color={p.primary} />
        </MotionPress>
        {calendar && (Platform.OS === "web"
          ? <Calendar selected={text || dateKey(new Date())} palette={p} onSelect={date => { onChange(date); setCalendar(false); }} />
          : <DateTimePicker value={selected} mode="date" display={Platform.OS === "ios" ? "inline" : "default"} themeVariant={p.isDark ? "dark" : "light"} onDismiss={() => setCalendar(false)} onValueChange={(_event, date) => { if (Platform.OS === "android") setCalendar(false); onChange(dateKey(date)); }} />)}
        {!f.required && !!text && <MotionPress accessibilityRole="button" onPress={() => { onChange(""); setCalendar(false); }} style={{ minHeight: 40, justifyContent: "center", alignSelf: "flex-start" }}><Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>Clear date</Text></MotionPress>}
        {f.help && <Text style={[ui.small, { color: p.muted }]}>{f.help}</Text>}
      </View>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      {label}
      {f.type === "select" ? (
        <View style={{ gap: 8 }}>{f.options?.map(o => (
          <MotionPress key={o.value} disabled={disabled} accessibilityRole="radio" accessibilityState={{ selected: value === o.value, disabled }} onPress={() => onChange(o.value)} style={[ui.row, { minHeight: 48, gap: 10, paddingHorizontal: 14, borderRadius: 14, borderWidth: value === o.value ? 2 : 1, borderColor: value === o.value ? p.primary : p.border, backgroundColor: value === o.value ? p.wash : p.background }]}>
            <Feather name={value === o.value ? "check-circle" : "circle"} size={18} color={p.primary} />
            <Text style={{ color: p.text, flexShrink: 1 }}>{o.label}</Text>
          </MotionPress>
        ))}</View>
      ) : (
        <TextInput accessibilityLabel={f.label} editable={!disabled} value={String(value ?? "")} onChangeText={onChange} placeholderTextColor={p.muted} multiline={f.type === "textarea"} keyboardType={f.type === "money" || f.type === "percent" ? "decimal-pad" : f.type === "number" ? "number-pad" : "default"} maxLength={f.type === "textarea" ? 10000 : 1000}
          style={{ borderWidth: 1, borderRadius: 14, padding: 13, minHeight: f.type === "textarea" ? 110 : 50, fontSize: 15, fontFamily: "Montserrat_500Medium", backgroundColor: p.background, color: p.text, borderColor: p.controlBorder, textAlignVertical: "top" }} />
      )}
      {f.help && <Text style={[ui.small, { color: p.muted }]}>{f.help}</Text>}
    </View>
  );
}

// A workflow form in a sheet. Each attempt keeps its request id until it succeeds,
// so a retry after a lost response replays it rather than creating a duplicate.
export function WorkflowSheet({ spec, invoices, budget = [], palette: p, onClose, onSaved }: { spec: WorkflowForm | null; invoices: InvoiceView[]; budget?: BudgetItem[]; palette: Palette; onClose: () => void; onSaved: () => Promise<void> }) {
  return (
    <Sheet palette={p} visible={!!spec} onClose={onClose} title={spec?.title ?? ""} subtitle={spec?.description} icon="clipboard">
      {spec && <WorkflowEditor key={spec.key} spec={spec} invoices={invoices} budget={budget} p={p} onClose={onClose} onSaved={onSaved} />}
    </Sheet>
  );
}
function WorkflowEditor({ spec, invoices, budget, p, onClose, onSaved }: { spec: WorkflowForm; invoices: InvoiceView[]; budget: BudgetItem[]; p: Palette; onClose: () => void; onSaved: () => Promise<void> }) {
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(spec.fields.map(f => [f.name, f.defaultValue ?? (f.type === "checkbox" ? false : "")])));
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [attempt, setAttempt] = useState<{ id: string; key: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const celebrate = useCelebrate();
  async function save() {
    if (busy || uploading) return;
    setBusy(true); setError("");
    try {
      const normalized = workflowValues(spec.fields, values), key = JSON.stringify(normalized), requestId = attempt?.key === key ? attempt.id : Crypto.randomUUID();
      setAttempt({ key, id: requestId });
      await liveApi(spec.endpoint === "workspace" ? "/workspace" : "/" + spec.endpoint, { ...(spec.endpoint === "workspace" ? {} : { requestId }), ...spec.build(normalized, requestId) });
      // A successful change is never repeated merely because the following read fails.
      celebrate("Done"); onClose(); await onSaved();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  if (spec.unavailable) return <Text style={[ui.body, { color: p.muted }]}>{spec.unavailable}</Text>;
  return (
    <>
      {spec.fields.map((f, n) => f.type === "photos" ? (spec.workId && f.purpose ? <Stagger key={f.name} index={n}><PhotoPicker p={p} workId={spec.workId} purpose={f.purpose} label={f.label} hint={f.help} onChange={(ids, loading) => { setValues(v => ({ ...v, [f.name]: ids })); setUploading(loading); }} /></Stagger> : null) : <Stagger key={f.name} index={n}><Field field={f.name === "budgetItemId" ? { ...f, options: [{ value: "", label: "Not from the chart" }, ...budget.map(b => ({ value: b.id, label: `${b.item}, up to ${money(b.maxUnitMinor)} each` }))] } : f.name === "invoiceId" ? { ...f, options: invoices.filter(i => !spec.workId || i.work_id === spec.workId).map(i => ({ value: i.id, label: i.reference + ", " + money(i.amount_minor) + ", " + i.status })) } : f} value={values[f.name]} onChange={v => setValues(current => ({ ...current, [f.name]: v }))} p={p} disabled={busy} /></Stagger>)}
      {!!error && <View accessibilityRole="alert" style={{ padding: 12, borderRadius: 14, backgroundColor: p.cautionWash }}><Text style={[ui.small, { color: p.text }]}>{error}</Text></View>}
      <SoftButton label={busy ? "Saving…" : uploading ? "Saving photos…" : "Save and continue"} icon="check" primary disabled={busy || uploading} onPress={() => void save()} palette={p} />
    </>
  );
}

// Photos on the onboarding: the owner's photos and documents for the set-up form (keys, meters,
// the mailbox, paperwork such as gas or electrical certificates), and Ready's inspection photos.
const SETUP_STAGES = ["form", "invoice", "inspection_to_book", "inspection_booked"];
function JourneyPhotos({ j, p, account }: { j: JourneyView; p: Palette; account: WorkspaceAccount }) {
  const [saved, setSaved] = useState(0);
  const onSetup = useCallback((ids: string[]) => setSaved(ids.length), []);
  const owner = account.role === "client" && SETUP_STAGES.includes(j.stage);
  const team = (["admin", "super_admin", "stays"].includes(account.role) && SETUP_STAGES.includes(j.stage));
  const inspector = ["ready", "stays", "admin", "super_admin"].includes(account.role) && ["inspection_booked", "inspection_complete"].includes(j.stage);
  return (
    <View style={{ gap: 12 }}>
      <WorkPhotos p={p} workId={j.workId} title="Photos and documents" refreshKey={saved} />
      {(owner || team) && <PhotoPicker p={p} workId={j.workId} purpose="setup" label={owner ? "Add photos for your set-up" : "Add set-up photos"} hint="For example the keys, the meters, the mailbox, or a photo of a certificate. They are saved as soon as they are chosen." onChange={onSetup} />}
      {inspector && <PhotoPicker p={p} workId={j.workId} purpose="inspection" label="Inspection photos" hint="Saved straight away, and shared with the owner." onChange={onSetup} />}
    </View>
  );
}

// A local event near a property (a festival, a match, a conference) that could bring bookings.
// It appears in the owner's weekly report until an automatic events feed is connected.
function localEventForm(propertyId: string): WorkflowForm {
  return {
    key: "recordLocalEvent", title: "Add a local event", endpoint: "portfolio",
    description: "Events near the property that could bring bookings. They appear in the owner's weekly report.",
    fields: [
      { name: "name", label: "Event", type: "text", required: true },
      { name: "eventOn", label: "Date", type: "date", required: true },
      { name: "sourceUrl", label: "Link to the event (https://…)", type: "text", required: true },
      { name: "opportunity", label: "Why it matters for this property", type: "textarea", required: true, help: "For example: big crowds the same weekend, so raise prices and keep a 2-night minimum." },
    ],
    build: (values, requestId) => ({ action: "recordLocalEvent", requestId, propertyId, ...values }),
  };
}

// The signed agreement, kept as a page the owner and the team can open, print or save.
function AgreementCopy({ j, p, propertyName }: { j: JourneyView; p: Palette; propertyName: string }) {
  const [note, setNote] = useState("");
  if (!j.signedName) return null;
  const save = async () => {
    try {
      await exportReport(agreementDocument({ propertyName, agreement: j.agreement, revision: j.signedRevision ?? j.agreementRevision, signedName: j.signedName!, signedAt: j.signedAt ?? null }), agreementFileName(propertyName), { mime: "text/html", uti: "public.html" });
      setNote(Platform.OS === "web" ? "Saved. Open it to read, print or save as a PDF." : "Ready to save or share.");
    } catch (e) { setNote(message(e)); }
  };
  return <View style={{ gap: 6 }}>
    <SoftButton label="Download a copy of the signed agreement" icon="download" palette={p} onPress={() => void save()} />
    {!!note && <Text accessibilityLiveRegion="polite" style={[ui.small, { color: p.muted }]}>{note}</Text>}
  </View>;
}

function JourneyDetails({ j, p, account, propertyName, onForm, work }: { j: JourneyView; p: Palette; account: WorkspaceAccount; propertyName: string; onForm: (f: WorkflowForm) => void; work: OperationView[] }) {
  const comparables = estimateComparables(j.estimate), [linkError, setLinkError] = useState("");
  const progress = onboardingProgress(j.stage), linked = work.filter(w => w.propertyId === j.propertyId && w.workId !== j.workId), reportFrom = inspectionReportFrom(account, j);
  return (
    <View style={{ gap: 14 }}>
      <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Onboarding</Text>
      <View style={{ gap: 8 }}>{progress.steps.map(step => (
        <View key={step.label} style={[ui.row, { gap: 10 }]}>
          <Feather name={step.state === "complete" ? "check-circle" : step.state === "current" ? "arrow-right-circle" : "circle"} size={18} color={step.state === "complete" ? p.success : step.state === "current" ? p.primary : p.muted} />
          <Text style={{ color: step.state === "pending" ? p.muted : p.text, fontWeight: step.state === "current" ? "600" : "400" }}>{step.label}{step.state === "current" && readableStage(j.stage) !== step.label ? " · " + readableStage(j.stage) : ""}</Text>
        </View>
      ))}</View>
      <Text style={[ui.body, { color: p.muted }]}>{progress.next}</Text>
      {j.estimate && !readEstimate(j.estimate) && <View style={{ gap: 6 }}><Text style={{ color: p.text, fontWeight: "700" }}>Your estimate</Text>{[["Low nightly rate", "lowRateMinor"], ["Expected nightly rate", "mediumRateMinor"], ["High nightly rate", "highRateMinor"]].map(([label, key]) => <Text key={key} style={{ color: p.text }}>{label}: {money(j.estimate?.[key])}</Text>)}</View>}
      {j.estimate && typeof j.estimate.comments === "string" && !!j.estimate.comments.trim() && <View style={{ gap: 4 }}><Text style={{ color: p.text, fontWeight: "700" }}>{account.role === "client" ? "Notes from Recharge" : "Estimate notes"}</Text><Text style={[ui.body, { color: p.muted }]}>{j.estimate.comments}</Text></View>}
      {j.estimate && <EstimateExplorer palette={p} estimate={j.estimate} owner={account.role === "client"} />}
      {j.estimate && account.role === "client" && ["estimate", "reviewing"].includes(j.stage) && <EstimateGuide palette={p} />}
      {!!comparables.length && <View style={{ gap: 8 }}><Text style={{ color: p.text, fontWeight: "700" }}>Comparable properties</Text>{comparables.map(c => <SoftButton key={c.url} label={c.name + " · " + money(c.adrMinor) + " a night"} icon="external-link" palette={p} onPress={() => void Linking.openURL(c.url).catch(() => setLinkError("The comparable link could not be opened."))} />)}{!!linkError && <Text accessibilityRole="alert" style={{ color: p.danger }}>{linkError}</Text>}</View>}
      {!!j.agreement && <View style={{ gap: 8 }}><Text style={{ color: p.text, fontWeight: "700" }}>Management agreement, revision {j.agreementRevision}</Text><Text selectable style={[ui.body, { color: p.text }]}>{j.agreement}</Text>{j.signedName && <Text style={{ color: p.success }}>Accepted by {j.signedName}{j.signedAt ? " on " + new Date(j.signedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }) : ""}.</Text>}<AgreementCopy j={j} p={p} propertyName={propertyName} /></View>}
      {j.inspectionReport && <View style={{ gap: 8 }}><Text style={{ color: p.text, fontWeight: "700" }}>Inspection findings</Text><InspectionResult palette={p} j={j} /><Text selectable style={[ui.body, { color: p.text }]}>{j.inspectionReport}</Text></View>}
      <JourneyQuestions palette={p} j={j} owner={account.role === "client"} />
      <JourneyPhotos j={j} p={p} account={account} />
      {journeyForms(account, j).map(f => <SoftButton key={f.key} label={f.title} icon={f.key === "askQuestion" ? "plus" : "arrow-right"} palette={p} onPress={() => onForm(f)} />)}
      {!!reportFrom && <Text style={[ui.small, { color: p.muted }]}>Report from {dayLabel(reportFrom)}</Text>}
      {!!linked.length && <Text style={[ui.small, { color: p.muted }]}>{linked.length} connected team {linked.length === 1 ? "handover" : "handovers"}</Text>}
    </View>
  );
}

function PropertyCard({ property, index, palette: p, onPress }: { property: PropertyView; index: number; palette: Palette; onPress: () => void }) {
  const live = property.status === "active";
  return (
    <MotionPress {...hoverLift} accessibilityRole="button" accessibilityLabel={"Open " + property.name} onPress={onPress} style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, padding: 0, overflow: "hidden", borderRadius: 26, gap: 0 }]}>
      <View style={{ minHeight: 132, alignItems: "center", justifyContent: "center", backgroundColor: departmentColor(index % 2 ? "clients" : "stays", p).wash }}>
        <View style={{ width: 80, height: 88, backgroundColor: p.surface, borderRadius: 22, borderWidth: 1, borderColor: p.border, alignItems: "center", justifyContent: "center" }}><BuildingGlyph palette={p} variant={index} /></View>
        <View style={[ui.row, { position: "absolute", left: 14, top: 14, backgroundColor: p.surface, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, gap: 6 }]}>
          <Feather name={live ? "check-circle" : "clock"} size={13} color={live ? p.success : p.waiting} />
          <Text style={[ui.small, { color: p.text, fontWeight: "600" }]}>{live ? "Live" : readableStage(property.status)}</Text>
        </View>
      </View>
      <View style={{ padding: 18, gap: 10 }}>
        <View style={ui.between}><Text numberOfLines={2} style={[ui.sectionTitle, { color: p.text, flex: 1, fontSize: 17, lineHeight: 23 }]}>{property.name}</Text><Feather name="arrow-up-right" size={19} color={p.primary} /></View>
        {!!(property.region || property.address) && <View style={[ui.row, { gap: 7 }]}><Feather name="map-pin" size={14} color={p.muted} /><Text numberOfLines={1} style={[ui.small, { color: p.muted, flex: 1 }]}>{property.region || property.address}</Text></View>}
        <View style={[ui.between, { borderTopWidth: 1, borderColor: p.border, paddingTop: 10 }]}>
          <Text style={[ui.small, { color: p.muted }]}>{property.bedrooms ? property.bedrooms + (property.bedrooms === 1 ? " bedroom" : " bedrooms") : "Bedrooms not set"}</Text>
          <Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>View</Text>
        </View>
      </View>
    </MotionPress>
  );
}

// The portfolio at a glance for the team: live, onboarding, owners, and properties per region.
function PortfolioCard({ palette: p, summary }: { palette: Palette; summary: PortfolioSummary }) {
  const top = summary.regions[0]?.count || 1, wide = useWindowDimensions().width >= 700;
  const stats: [string, number, IconName][] = [["Properties", summary.total, "home"], ["Live", summary.live, "check-circle"], ["Onboarding", summary.onboarding, "key"], ["Owners", summary.owners, "users"]];
  return (
    <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 14 }]}>
      <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Portfolio</Text>
      <StatGrid>
        {stats.map(([label, value, icon]) => <StatTile key={label} p={p} icon={icon} tone="stays" label={label} value={value} />)}
      </StatGrid>
      <View style={{ flexDirection: wide ? "row" : "column", gap: 18, alignItems: wide ? "center" : "stretch" }}>
        <View style={{ flex: wide ? 1 : undefined, minWidth: 0 }}><ScotlandMap palette={p} regions={summary.regions} /></View>
        <View style={{ gap: 8, flex: wide ? 1.3 : undefined, minWidth: 0 }}>
          <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>By region</Text>
          {summary.regions.slice(0, 8).map(r => (
            <View key={r.region} accessibilityLabel={`${r.region}: ${r.count}`} style={[ui.row, { gap: 10 }]}>
              <Text numberOfLines={1} style={{ color: p.text, width: 130, fontSize: 13 }}>{r.region}</Text>
              <GrowBar share={Math.max(0.06, r.count / top)} color={p.primary} track={p.wash} />
              <Text style={{ color: p.text, minWidth: 32, textAlign: "right", fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{formatCount(r.count)}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

export function LiveProperties({ palette: p, desktop, account, properties, journeys, work, invoices, period, loading, onForm, onOpenWork, onRefresh }: {
  palette: Palette; desktop: boolean; account: WorkspaceAccount; properties: PropertyView[]; journeys: JourneyView[]; work: OperationView[]; invoices: InvoiceView[];
  period: AnalyticsPeriod; loading: boolean; onForm: (form: WorkflowForm) => void; onOpenWork?: (item: OperationView) => void; onRefresh: () => void;
}) {
  const [query, setQuery] = useState(""), [shown, setShown] = useState(24), [selected, setSelected] = useState<PropertyView | null>(null);
  const [filter, setFilter] = useState<PropertyFilter>(null), [ownerCount, setOwnerCount] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false), [exportMessage, setExportMessage] = useState("");
  const visible = properties.filter(property => (!filter || filter.ids.includes(property.id)) && (property.name + " " + property.region + " " + property.address).toLowerCase().includes(query.trim().toLowerCase()));
  const staff = isWorkspaceAdmin(account.role) || account.role === "stays";
  const journey = selected ? journeys.find(j => j.propertyId === selected.id) : undefined;
  const propertyWork = selected ? work.filter(w => w.propertyId === selected.id) : [];
  async function downloadProperty(kind: "page" | "csv") {
    if (!selected || exporting) return;
    setExporting(true); setExportMessage("");
    try {
      if (kind === "page") {
        // The weekly report as a page to read, print or save as a PDF.
        const report = await (await workspaceRequest("/api/mobile/portfolio?" + new URLSearchParams({ section: "weekly", propertyId: selected.id, ...period }))).json();
        await exportReport(weeklyReportDocument(report.data), weeklyReportFileName(selected.name, period.from, period.to), { mime: "text/html", uti: "public.html" });
        setExportMessage(Platform.OS === "web" ? "Saved. Open it to read, print or save as a PDF." : "Ready to open, save or share.");
      } else {
        const csv = await (await workspaceRequest("/api/mobile/portfolio?" + new URLSearchParams({ section: "weekly", propertyId: selected.id, ...period, download: "csv" }))).text();
        await exportReport(csv, "Recharge-property-report-" + period.from + "-" + period.to + ".csv");
        setExportMessage("Spreadsheet prepared for saving or sharing.");
      }
    } catch (e) { setExportMessage(message(e)); } finally { setExporting(false); }
  }
  const columns = desktop ? 3 : 1;
  return (
    <>
      <PageHeading palette={p} title={account.role === "client" ? "Your properties" : account.role === "cleans" ? "Assigned properties" : "Property Management Database"} subtitle={loading ? "Loading your properties…" : `${properties.length} ${properties.length === 1 ? "property" : "properties"} within your access.`} />
      {account.role === "client" && account.modules.includes("property-onboarding") && <EnquiryCard palette={p} onStart={() => onForm(newEnquiryForm())} />}
      {staff && <HostawaySyncCard p={p} onSynced={onRefresh} />}
      {staff && !loading && properties.length > 0 && <PortfolioCard palette={p} summary={{ ...portfolioSummary(properties, journeys), ...(ownerCount !== null ? { owners: ownerCount } : {}) }} />}
      {staff && !loading && properties.length > 0 && account.modules.includes("property-database") && <PortfolioInsights palette={p} properties={properties} journeys={journeys} filter={filter} onFilter={f => { setFilter(f); setShown(24); }} onOwners={setOwnerCount} />}
      {staff && !loading && account.modules.includes("property-onboarding") && <OnboardingPipeline palette={p} properties={properties} journeys={journeys} onOpen={setSelected} />}
      {!!filter && <MotionPress accessibilityRole="button" onPress={() => setFilter(null)} style={[ui.row, { gap: 8, alignSelf: "flex-start", maxWidth: "100%", minHeight: 40, paddingHorizontal: 14, borderRadius: 999, backgroundColor: p.wash }]}>
        <Text numberOfLines={1} style={{ color: p.text, fontWeight: "600", flexShrink: 1 }}>Showing: {filter.label} · {filter.ids.length}</Text><Feather name="x" size={16} color={p.text} />
      </MotionPress>}
      <View {...(Platform.OS === "web" ? { dataSet: { searchShell: "true" } } : {})} style={[ui.row, { borderRadius: 14, minHeight: 50, borderWidth: 1, borderColor: p.controlBorder, paddingHorizontal: 14, backgroundColor: p.surface, gap: 10 }]}>
        <Feather name="search" size={18} color={p.muted} />
        <TextInput accessibilityLabel="Search properties" placeholder="Search by name or area" placeholderTextColor={p.muted} value={query} onChangeText={value => { setQuery(value); setShown(24); }} autoCorrect={false} style={{ flex: 1, color: p.text, fontSize: 15, fontFamily: "Montserrat_400Regular", minHeight: 48 }} />
        {!!query && <MotionPress accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery("")} style={{ width: 44, minHeight: 48, alignItems: "center", justifyContent: "center" }}><Feather name="x" size={18} color={p.text} /></MotionPress>}
      </View>
      {visible.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 20 }}>
          {visible.slice(0, shown).map((property, index) => (
            <Entrance key={property.id} sessionKey={"live:property:" + property.id} delay={Math.min(index, 8) * 40} style={{ flexBasis: columns === 3 ? "30%" : "100%", flexGrow: 1, minWidth: 0 }}>
              <PropertyCard property={property} index={index} palette={p} onPress={() => setSelected(property)} />
            </Entrance>
          ))}
        </View>
      ) : !loading && <EmptyState palette={p} icon="home" title={query ? "No matching properties" : "No properties yet"} detail={query ? "Try another name or area." : account.role === "client" ? "Start an enquiry to begin your property journey." : "Properties appear here once they are added or onboarded."} />}
      {visible.length > shown && <SoftButton label={`Show more (${visible.length - shown} more)`} icon="arrow-right" palette={p} onPress={() => setShown(shown + 24)} />}
      <Sheet palette={p} visible={!!selected} onClose={() => { setSelected(null); setExportMessage(""); }} title={selected?.name ?? ""} subtitle={selected ? [selected.address, selected.region].filter(Boolean).join(" · ") : undefined} icon="house">
        {selected && <>
          <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
            <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: selected.status === "active" ? p.successWash : p.cautionWash }}><Text style={{ color: p.text, fontSize: 12, fontWeight: "700" }}>{selected.status === "active" ? "Live" : readableStage(selected.status)}</Text></View>
            {!!selected.bedrooms && <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: p.wash }}><Text style={{ color: p.text, fontSize: 12, fontWeight: "700" }}>{selected.bedrooms} {selected.bedrooms === 1 ? "bedroom" : "bedrooms"}</Text></View>}
          </View>
          {journey && selected.status !== "active" && <JourneyDetails j={journey} p={p} account={account} propertyName={selected.name} onForm={form => { setSelected(null); onForm(form); }} work={work} />}
          <PropertyProfile palette={p} account={account} propertyId={selected.id} journey={journey} />
          <PropertyAccess palette={p} account={account} propertyId={selected.id} />
          {journey && selected.status === "active" && <JourneyDetails j={journey} p={p} account={account} propertyName={selected.name} onForm={form => { setSelected(null); onForm(form); }} work={work} />}
          {createOperationForms(account, selected.id).map(f => <SoftButton key={f.key} label={f.title} icon="plus" palette={p} onPress={() => { setSelected(null); onForm(f); }} />)}
          {!!propertyWork.length && <View style={{ gap: 4 }}>
            <Text style={{ color: p.text, fontWeight: "700" }}>Work at this property · {propertyWork.length}</Text>
            {/* Open items first; each opens with every step available to you. */}
            {[...propertyWork].sort((a, b) => Number(isDone(a.status)) - Number(isDone(b.status))).slice(0, 30).map(item => <View key={item.workId} style={{ gap: 6 }}><LiveWorkRow item={item} palette={p} onPress={() => {
              if (onOpenWork) { setSelected(null); onOpenWork(item); return; }
              const form = operationForms(account, item)[0]; if (form) { setSelected(null); onForm(form); }
            }} /></View>)}
            {propertyWork.length > 30 && <Text style={[ui.small, { color: p.muted }]}>The rest are in Work → All work.</Text>}
          </View>}
          {account.modules.includes(account.role === "client" ? "client-dashboard" : "weekly-performance") && ["client", "stays", "admin", "super_admin"].includes(account.role) && <View style={{ gap: 8 }}>
            <SoftButton label={exporting ? "Preparing report…" : "Weekly report to read or print"} icon="external-link" palette={p} disabled={exporting} onPress={() => void downloadProperty("page")} />
            <SoftButton label="Spreadsheet (CSV)" icon="download" palette={p} disabled={exporting} onPress={() => void downloadProperty("csv")} />
            <Text style={[ui.small, { color: p.muted }]}>Pricing, listing checks and local events for {periodLabel(period)}. Choose up to 31 days in Reports.</Text>
            {account.role !== "client" && <LocalEvents p={p} propertyId={selected.id} refreshKey={work} />}
            {account.role !== "client" && <SoftButton label="Add a local event" icon="calendar" palette={p} onPress={() => onForm(localEventForm(selected.id))} />}
            {!!exportMessage && <Text style={[ui.small, { color: p.text }]}>{exportMessage}</Text>}
          </View>}
          {invoices.some(invoice => invoice.property_id === selected.id) && <View style={{ gap: 8 }}>
            <Text style={{ color: p.text, fontWeight: "700" }}>Invoices</Text>
            {invoices.filter(invoice => invoice.property_id === selected.id).map(invoice => (
              <View key={invoice.id} style={[ui.between, { gap: 12, paddingVertical: 8, borderTopWidth: 1, borderColor: p.border }]}>
                <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                  <Text style={{ color: p.text, fontWeight: "600" }}>{invoice.reference}</Text>
                  <Text style={[ui.small, { color: p.muted, fontVariant: ["tabular-nums"] }]}>{invoice.currency === "GBP" ? money(invoice.amount_minor) : `${invoice.currency} ${(invoice.amount_minor / 100).toFixed(2)}`}</Text>
                </View>
                <Tag label={invoice.status === "paid" ? "Settled" : readableStage(invoice.status)} tone={invoice.status === "paid" ? "good" : invoice.status === "issued" ? "wait" : "plain"} p={p} />
              </View>
            ))}
          </View>}
        </>}
      </Sheet>
    </>
  );
}

export function LiveActivity({ palette: p, notices, loading, onRead }: { palette: Palette; notices: NoticeView[]; loading: boolean; onRead?: (ids: number[]) => void }) {
  // Opening Activity marks the listed updates read (one request each, newest first, never twice),
  // so Home's Updates count only shows what is new.
  const tried = useRef(new Set<number>());
  useEffect(() => {
    const ids = unreadNotices(notices).map(n => n.id).filter(id => !tried.current.has(id)).slice(0, MARK_READ_PER_VISIT);
    if (!ids.length) return;
    ids.forEach(id => tried.current.add(id));
    void (async () => {
      const read: number[] = [];
      for (const id of ids) {
        try { await writeControls({ action: "markNotificationRead", requestId: Crypto.randomUUID(), eventId: String(id) }); read.push(id); }
        catch { break; /* offline or rate-limited: try again next visit */ }
      }
      if (read.length) onRead?.(read);
    })();
  }, [notices, onRead]);
  return (
    <>
      <PageHeading palette={p} title="Recent activity" subtitle="Updates on the work and properties within your access." />
      {notices.length ? (
        <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 6, gap: 0 }]}>{notices.map((notice, i) => <View key={notice.id} style={{ borderTopWidth: i ? 1 : 0, borderColor: p.border }}><LiveNoticeRow notice={notice} palette={p} /></View>)}</View>
      ) : <EmptyState palette={p} icon="activity" title={loading ? "Loading updates…" : "No updates yet"} detail="Changes to your work and properties appear here." />}
      <Text style={[ui.small, { color: p.muted }]}>Email and push notifications start once they are switched on.</Text>
    </>
  );
}

export function LiveHelp({ palette: p, account, properties = [], onSignOut, busy, onOpen }: { palette: Palette; account: WorkspaceAccount; properties?: PropertyView[]; onSignOut: () => void; busy: boolean; onOpen?: (tab: "home" | "work" | "properties" | "analytics", view?: WorkView) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const faq = faqsForAccess(account.role, account.modules).filter(f => f.id !== "communication-centre");
  return (
    <>
      <PageHeading palette={p} title="Help" subtitle={"Your tools and answers for your role: " + readableStage(account.role) + "."} />
      {onOpen && <ToolDirectory palette={p} account={account} properties={properties} onOpen={onOpen} />}
      <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, gap: 0 }]}>
        {faq.map((f, i) => (
          <View key={f.id} style={{ borderTopWidth: i ? 1 : 0, borderColor: p.border }}>
            <MotionPress accessibilityRole="button" accessibilityState={{ expanded: open === f.id }} onPress={() => setOpen(open === f.id ? null : f.id)} style={[ui.between, { gap: 12, minHeight: 56, paddingVertical: 12 }]}>
              <Text style={{ color: p.text, fontSize: 15, fontWeight: "600", flex: 1 }}>{f.question}</Text>
              <Feather name={open === f.id ? "chevron-up" : "chevron-down"} size={18} color={p.muted} />
            </MotionPress>
            {open === f.id && <SwapIn swapKey={f.id}><Text style={[ui.body, { color: p.muted, paddingBottom: 14 }]}>{f.answer}</Text></SwapIn>}
          </View>
        ))}
      </View>
      <LiveTraining palette={p} />
      <MyContracts palette={p} account={account} />
      <SoftButton label={busy ? "Signing out…" : "Sign out"} icon="log-out" palette={p} disabled={busy} onPress={onSignOut} />
    </>
  );
}

// The reports date range: presets, or a start and end picked on a calendar.
export function DateRangeSheet({ palette: p, visible, period, onClose, onApply }: { palette: Palette; visible: boolean; period: AnalyticsPeriod; onClose: () => void; onApply: (period: AnalyticsPeriod) => void }) {
  const [draft, setDraft] = useState(period), [editing, setEditing] = useState<"from" | "to" | null>(null);
  const error = periodError(draft);
  return (
    <Sheet palette={p} visible={visible} onClose={() => { setEditing(null); onClose(); }} title="Date range" subtitle="All charts update together. Up to 366 days." icon="calendar">
      <View style={{ flexDirection: "row", gap: 6, padding: 4, borderRadius: 999, backgroundColor: p.elevated }}>
        {[7, 30, 90].map(days => {
          const preset = presetPeriod(days), active = draft.from === preset.from && draft.to === preset.to;
          return <MotionPress key={days} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => { setDraft(preset); setEditing(null); }} style={{ flex: 1, minHeight: 40, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: active ? p.primary : "transparent" }}><Text style={{ fontSize: 13, fontWeight: "600", color: active ? p.onPrimary : p.muted }}>Last {days} days</Text></MotionPress>;
        })}
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {(["from", "to"] as const).map(field => {
          const active = editing === field, value = parseAnalyticsDate(draft[field]);
          return (
            <MotionPress key={field} accessibilityRole="button" accessibilityLabel={`${field === "from" ? "Start" : "End"} date, ${draft[field]}`} accessibilityState={{ expanded: active }} onPress={() => setEditing(active ? null : field)} style={{ flex: 1, gap: 6, padding: 14, borderRadius: 18, borderWidth: active ? 2 : 1, borderColor: active ? p.primary : p.border, backgroundColor: active ? p.wash : p.background }}>
              <Text style={{ fontSize: 11, fontWeight: "600", letterSpacing: 1.2, textTransform: "uppercase", color: p.muted }}>{field === "from" ? "Start" : "End"}</Text>
              <Text style={{ fontSize: 16, fontWeight: "700", color: p.text }}>{value ? value.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : draft[field]}</Text>
            </MotionPress>
          );
        })}
      </View>
      {editing && (Platform.OS === "web"
        ? <Calendar key={editing} selected={draft[editing]} palette={p} onSelect={date => setDraft(current => ({ ...current, [editing]: date }))} />
        : <DateTimePicker value={parseAnalyticsDate(draft[editing]) ?? new Date()} mode="date" display={Platform.OS === "ios" ? "inline" : "default"} themeVariant={p.isDark ? "dark" : "light"} onValueChange={(_event, date) => { if (Platform.OS === "android") setEditing(null); setDraft(current => ({ ...current, [editing]: dateKey(date) })); }} onDismiss={() => setEditing(null)} />)}
      {error ? <View accessibilityRole="alert" style={{ padding: 12, borderRadius: 14, backgroundColor: p.cautionWash }}><Text style={[ui.small, { color: p.text }]}>{error}</Text></View> : <Text style={[ui.small, { color: p.muted }]}>{periodLabel(draft)}</Text>}
      <SoftButton label="Apply dates" icon="check" primary disabled={Boolean(error)} palette={p} onPress={() => { setEditing(null); onApply(draft); }} />
    </Sheet>
  );
}
