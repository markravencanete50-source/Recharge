import { useState, type ReactNode } from "react";
import { Platform, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import { z } from "zod";
import { Text } from "./Typography";
import { BuildingGlyph } from "./BuildingGlyph";
import { EnquiryCard } from "./HomeOverview";
import { HostawaySyncCard } from "./HostawaySyncCard";
import { LiveTraining } from "./LiveTraining";
import { PropertyAccess, ToolDirectory } from "./LiveTools";
import { PropertyProfile } from "./LivePropertyProfile";
import { EstimateExplorer } from "./LiveEstimate";
import { readEstimate } from "../../lib/estimate-projection";
import type { BudgetItem } from "../../lib/accounts-work";
import type { WorkView } from "../../lib/tool-directory";
import { portfolioSummary, type PortfolioSummary } from "../../lib/portfolio-overview";
import { formatCount, formatMoney } from "../../lib/format";
import { StatGrid, StatTile, Tag, type IconName } from "./LiveKit";
import { LiveNoticeRow, LiveWorkRow, isDone } from "./LiveRows";
import { Calendar } from "./WorkspaceScreens";
import { Sheet } from "./TeamFlows";
import { StateGraphic } from "./StateGraphic";
import { Entrance, GrowBar, MotionPress, Stagger, TweenNumber } from "./motion";
import { departmentColor, ui, type Palette } from "./theme";
import { workspaceRequest } from "./backend/client";
import { exportReport } from "./exportReport";
import { isWorkspaceAdmin } from "../../lib/modules";
import { faqsForAccess } from "../../lib/access-faq";
import { dateKey, parseAnalyticsDate, periodError, periodLabel, presetPeriod, type AnalyticsPeriod } from "../../lib/analytics";
import { estimateComparables, onboardingProgress, readableStage, type InvoiceView, type NoticeView, type PropertyView } from "../../lib/workspace-view";
import { createOperationForms, journeyForms, newEnquiryForm, operationForms, workflowValues, type JourneyView, type OperationView, type WorkflowField, type WorkflowForm } from "../../lib/workflow-forms";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

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
  async function save() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const normalized = workflowValues(spec.fields, values), key = JSON.stringify(normalized), requestId = attempt?.key === key ? attempt.id : Crypto.randomUUID();
      setAttempt({ key, id: requestId });
      await liveApi(spec.endpoint === "workspace" ? "/workspace" : "/" + spec.endpoint, { ...(spec.endpoint === "workspace" ? {} : { requestId }), ...spec.build(normalized, requestId) });
      // A successful change is never repeated merely because the following read fails.
      onClose(); await onSaved();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  if (spec.unavailable) return <Text style={[ui.body, { color: p.muted }]}>{spec.unavailable}</Text>;
  return (
    <>
      {spec.fields.map((f, n) => <Stagger key={f.name} index={n}><Field field={f.name === "budgetItemId" ? { ...f, options: [{ value: "", label: "Not from the chart" }, ...budget.map(b => ({ value: b.id, label: `${b.item}, up to ${money(b.maxUnitMinor)} each` }))] } : f.name === "invoiceId" ? { ...f, options: invoices.map(i => ({ value: i.id, label: i.reference + ", " + money(i.amount_minor) + ", " + i.status })) } : f} value={values[f.name]} onChange={v => setValues({ ...values, [f.name]: v })} p={p} disabled={busy} /></Stagger>)}
      {!!error && <View accessibilityRole="alert" style={{ padding: 12, borderRadius: 14, backgroundColor: p.cautionWash }}><Text style={[ui.small, { color: p.text }]}>{error}</Text></View>}
      <SoftButton label={busy ? "Saving…" : "Save and continue"} icon="check" primary disabled={busy} onPress={() => void save()} palette={p} />
    </>
  );
}

function JourneyDetails({ j, p, account, onForm, work }: { j: JourneyView; p: Palette; account: WorkspaceAccount; onForm: (f: WorkflowForm) => void; work: OperationView[] }) {
  const comparables = estimateComparables(j.estimate), [linkError, setLinkError] = useState("");
  const progress = onboardingProgress(j.stage), linked = work.filter(w => w.propertyId === j.propertyId && w.workId !== j.workId);
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
      {!!comparables.length && <View style={{ gap: 8 }}><Text style={{ color: p.text, fontWeight: "700" }}>Comparable properties</Text>{comparables.map(c => <SoftButton key={c.url} label={c.name + " · " + money(c.adrMinor) + " a night"} icon="external-link" palette={p} onPress={() => void Linking.openURL(c.url).catch(() => setLinkError("The comparable link could not be opened."))} />)}{!!linkError && <Text accessibilityRole="alert" style={{ color: p.danger }}>{linkError}</Text>}</View>}
      {!!j.agreement && <View style={{ gap: 8 }}><Text style={{ color: p.text, fontWeight: "700" }}>Management agreement, revision {j.agreementRevision}</Text><Text selectable style={[ui.body, { color: p.text }]}>{j.agreement}</Text>{j.signedName && <Text style={{ color: p.success }}>Accepted by {j.signedName}.</Text>}</View>}
      {j.inspectionReport && <View style={{ gap: 8 }}><Text style={{ color: p.text, fontWeight: "700" }}>Inspection findings</Text><Text selectable style={[ui.body, { color: p.text }]}>{j.inspectionReport}</Text></View>}
      {journeyForms(account, j).map(f => <SoftButton key={f.key} label={f.title} icon="arrow-right" palette={p} onPress={() => onForm(f)} />)}
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
  const top = summary.regions[0]?.count || 1;
  const stats: [string, number, IconName][] = [["Properties", summary.total, "home"], ["Live", summary.live, "check-circle"], ["Onboarding", summary.onboarding, "key"], ["Owners", summary.owners, "users"]];
  return (
    <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 14 }]}>
      <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Portfolio</Text>
      <StatGrid>
        {stats.map(([label, value, icon]) => <StatTile key={label} p={p} icon={icon} tone="stays" label={label} value={value} />)}
      </StatGrid>
      <View style={{ gap: 8 }}>
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
  );
}

export function LiveProperties({ palette: p, desktop, account, properties, journeys, work, invoices, period, loading, onForm, onOpenWork, onRefresh }: {
  palette: Palette; desktop: boolean; account: WorkspaceAccount; properties: PropertyView[]; journeys: JourneyView[]; work: OperationView[]; invoices: InvoiceView[];
  period: AnalyticsPeriod; loading: boolean; onForm: (form: WorkflowForm) => void; onOpenWork?: (item: OperationView) => void; onRefresh: () => void;
}) {
  const [query, setQuery] = useState(""), [shown, setShown] = useState(24), [selected, setSelected] = useState<PropertyView | null>(null);
  const [exporting, setExporting] = useState(false), [exportMessage, setExportMessage] = useState("");
  const visible = properties.filter(property => (property.name + " " + property.region + " " + property.address).toLowerCase().includes(query.trim().toLowerCase()));
  const staff = isWorkspaceAdmin(account.role) || account.role === "stays";
  const journey = selected ? journeys.find(j => j.propertyId === selected.id) : undefined;
  const propertyWork = selected ? work.filter(w => w.propertyId === selected.id) : [];
  async function downloadProperty() {
    if (!selected || exporting) return;
    setExporting(true); setExportMessage("");
    try {
      const csv = await (await workspaceRequest("/api/mobile/portfolio?" + new URLSearchParams({ section: "weekly", propertyId: selected.id, ...period, download: "csv" }))).text();
      await exportReport(csv, "Recharge-property-report-" + period.from + "-" + period.to + ".csv");
      setExportMessage("Property report prepared for saving or sharing.");
    } catch (e) { setExportMessage(message(e)); } finally { setExporting(false); }
  }
  const columns = desktop ? 3 : 1;
  return (
    <>
      <PageHeading palette={p} title={account.role === "client" ? "Your properties" : account.role === "cleans" ? "Assigned properties" : "Property Management Database"} subtitle={loading ? "Loading your properties…" : `${properties.length} ${properties.length === 1 ? "property" : "properties"} within your access.`} />
      {account.role === "client" && account.modules.includes("property-onboarding") && <EnquiryCard palette={p} onStart={() => onForm(newEnquiryForm())} />}
      {staff && <HostawaySyncCard p={p} onSynced={onRefresh} />}
      {staff && !loading && properties.length > 0 && <PortfolioCard palette={p} summary={portfolioSummary(properties, journeys)} />}
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
          {journey && selected.status !== "active" && <JourneyDetails j={journey} p={p} account={account} onForm={form => { setSelected(null); onForm(form); }} work={work} />}
          <PropertyProfile palette={p} account={account} propertyId={selected.id} journey={journey} />
          <PropertyAccess palette={p} account={account} propertyId={selected.id} />
          {journey && selected.status === "active" && <JourneyDetails j={journey} p={p} account={account} onForm={form => { setSelected(null); onForm(form); }} work={work} />}
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
            <SoftButton label={exporting ? "Preparing report…" : "Download property report"} icon="download" palette={p} disabled={exporting} onPress={() => void downloadProperty()} />
            <Text style={[ui.small, { color: p.muted }]}>Pricing, listing checks and opportunities for {periodLabel(period)}. Choose up to 31 days in Reports.</Text>
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

export function LiveActivity({ palette: p, notices, loading }: { palette: Palette; notices: NoticeView[]; loading: boolean }) {
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
            {open === f.id && <Text style={[ui.body, { color: p.muted, paddingBottom: 14 }]}>{f.answer}</Text>}
          </View>
        ))}
      </View>
      <LiveTraining palette={p} />
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
