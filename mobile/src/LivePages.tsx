import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, TextInput, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import { z } from "zod";
import { Text } from "./Typography";
import { ChoiceField } from "./ChoiceField";
import { Dropdown } from "./Dropdown";
import { choiceControl } from "../../lib/choice-control";
import { useCelebrate } from "./Celebrate";
import { BuildingGlyph } from "./BuildingGlyph";
import { EnquiryCard } from "./HomeOverview";
import { WorkJumpContext } from "./WorkJump";
import { HostawaySyncCard } from "./HostawaySyncCard";
import { LiveTraining } from "./LiveTraining";
import { MyContracts } from "./LiveOnboarding";
import { PropertyAccess, ToolDirectory } from "./LiveTools";
import { LocalEvents } from "./LocalEvents";
import { PropertyProfile } from "./LivePropertyProfile";
import { OnboardingPipeline, PortfolioInsights, type PropertyFilter } from "./LivePortfolio";
import { PropertiesTable } from "./PropertiesTable";
import { EstimateExplorer } from "./LiveEstimate";
import { ScotlandMap } from "./ScotlandMap";
import { EstimateGuide, InspectionResult, JourneyQuestions } from "./LiveOnboardingGuide";
import { readEstimate } from "../../lib/estimate-projection";
import { agreementDocument, agreementFileName } from "../../lib/agreement-copy";
import type { BudgetItem } from "../../lib/accounts-work";
import type { WorkView } from "../../lib/tool-directory";
import { portfolioSummary, type PortfolioSummary } from "../../lib/portfolio-overview";
import { propertyPoints } from "../../lib/property-points";
import { usesPropertyTable } from "../../lib/property-table";
import { formatCount, formatMoney } from "../../lib/format";
import { StatGrid, StatTile, Tag, dayLabel, type IconName } from "./LiveKit";
import { LiveWorkRow, NoticeRowView, isDone, noticeIcon } from "./LiveRows";
import { mayHaveOlder, mergeNotices, noticeRow, noticeRows, oldestNoticeId, workItemFrom, type NoticeRow } from "../../lib/notice-details";
import { ListSearchBox, SearchBox, useListSearch } from "./SearchPicker";
import { Calendar } from "./WorkspaceScreens";
import { DateField } from "./CalendarPicker";
import { FavoriteButton } from "./Favorites";
import { Sheet } from "./TeamFlows";
import { StateGraphic } from "./StateGraphic";
import { Entrance, ExpandChevron, Float, GrowBar, MotionPress, Stagger, SwapIn } from "./motion";
import { departmentColor, primaryFill, space, ui, web, type Palette } from "./theme";
import { ChartTip, useChartFocus } from "./ChartTip";
import { WorkspaceApiError, readOlderNotices, readWorkItem, workspaceRequest, writeControls } from "./backend/client";
import { exportReport } from "./exportReport";
import { weeklyReportDocument, weeklyReportFileName } from "../../lib/weekly-report";
import { isWorkspaceAdmin } from "../../lib/modules";
import { completePostcode, findPostcode, lookupPostcode, partialPostcode, postcodePositions, suggestPostcodes, type PostcodePlace } from "../../lib/postcode-lookup";
import { fillAlso, type Suggestion } from "../../lib/property-listing";
import { matchesSearch, normalise } from "../../lib/search-options";
import { SCOTTISH_REGIONS } from "../../lib/regions";
import { faqsForAccess } from "../../lib/access-faq";
import { dateKey, parseAnalyticsDate, periodError, periodLabel, presetPeriod, type AnalyticsPeriod } from "../../lib/analytics";
import { estimateComparables, MARK_READ_PER_VISIT, noticeViewSchema, onboardingProgress, readableStage, unreadNotices, type InvoiceView, type NoticeView, type PropertyView } from "../../lib/workspace-view";
import { createOperationForms, inspectionReportFrom, journeyForms, newEnquiryForm, operationForms, workflowValues, type JourneyView, type OperationView, type WorkflowField, type WorkflowForm } from "../../lib/workflow-forms";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import { PhotoPicker, WorkPhotos } from "./Photos";
import { LegalLinks } from "./LivePrivacy";
import { readableError } from "../../lib/error-copy";

export const message = (error: unknown) => readableError(error);
const money = (n: unknown) => formatMoney(Number(n));
const hoverLift = Platform.OS === "web" ? { dataSet: { hover: "lift" } } : {};
export async function liveApi(path: string, body?: Record<string, unknown>) {
  const response = await workspaceRequest("/api/mobile" + path, body);
  return z.object({ data: z.unknown().optional() }).passthrough().parse(await response.json());
}

// A page's title, what it is for, and its main action. The title settles in with a short accent
// line beneath it.
export function PageHeading({ title, subtitle, palette: p, action }: { title: string; subtitle: string; palette: Palette; action?: ReactNode }) {
  return (
    <View style={[ui.between, { gap: 16, alignItems: "flex-end", flexWrap: "wrap" }]}>
      <View style={{ gap: 6, flexShrink: 1, minWidth: 220 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>{title}</Text>
        <Text style={[ui.body, { color: p.muted, maxWidth: 680 }]}>{subtitle}</Text>
      </View>
      {action}
    </View>
  );
}
export function SoftButton({ label, icon, onPress, palette: p, primary = false, disabled = false }: { label: string; icon?: "plus" | "download" | "refresh-cw" | "arrow-right" | "log-out" | "check" | "external-link" | "calendar"; onPress: () => void; palette: Palette; primary?: boolean; disabled?: boolean }) {
  return (
    <MotionPress {...(Platform.OS === "web" && !disabled ? { dataSet: primary ? { sheen: "" } : { hover: "tint" } } : {})} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[ui.button, primary ? primaryFill(p) : { backgroundColor: p.wash }, { opacity: disabled ? 0.5 : 1 }]}>
      {!!icon && <Feather name={icon} size={16} color={primary ? p.onPrimary : p.primary} />}
      <Text style={[ui.buttonText, { color: primary ? p.onPrimary : p.primary }]}>{label}</Text>
    </MotionPress>
  );
}
// Nothing here yet: a floating illustration over a soft pool of light, and a short explanation.
export function EmptyState({ title, detail, palette: p, icon = "check-circle" }: { title: string; detail: string; palette: Palette; icon?: "check-circle" | "home" | "inbox" | "activity" }) {
  return (
    <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, alignItems: "center", paddingVertical: 34, gap: 10, overflow: "hidden" }]}>
      <Float distance={5}><StateGraphic palette={p} success={icon === "check-circle"} icon={icon} /></Float>
      <Text style={[ui.sectionTitle, { color: p.text, textAlign: "center" }]}>{title}</Text>
      <Text style={[ui.body, { color: p.muted, textAlign: "center", maxWidth: 520 }]}>{detail}</Text>
    </View>
  );
}

// Quick picks under a field: tapping one fills the field, and any other fields the pick implies (a studio has no bedrooms).
function Suggestions({ p, label, items, value, disabled, onPick }: { p: Palette; label: string; items: Suggestion[]; value: string; disabled?: boolean; onPick: (item: Suggestion) => void }) {
  const current = value.trim().toLowerCase();
  // More than a handful of quick picks become one dropdown (lib/choice-control.ts); the field stays free to type in.
  if (choiceControl(items.length) !== "radio") {
    const picked = items.find(s => s.value.toLowerCase() === current)?.value ?? "";
    return <Dropdown p={p} label={`Quick pick for ${label}`} hideLabel disabled={disabled} searchable={choiceControl(items.length) === "search"} value={picked}
      options={[...(picked ? [] : [{ value: "", label: "Or pick one" }]), ...items.map(s => ({ value: s.value, label: s.label }))]}
      onChange={v => { const item = items.find(s => s.value === v); if (item) onPick(item); }} />;
  }
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={`Suggestions for ${label}`} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {items.map(s => {
        const on = current === s.value.toLowerCase();
        return (
          <MotionPress key={s.value} disabled={disabled} accessibilityRole="radio" accessibilityLabel={`${label}: ${s.label}`} accessibilityState={{ selected: on, disabled }} onPress={() => onPick(s)}
            style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 999, justifyContent: "center", borderWidth: 1, borderColor: on ? p.primary : p.border, backgroundColor: on ? p.primary : p.surface }}>
            <Text style={{ color: on ? p.onPrimary : p.text, fontSize: 13, fontWeight: "600" }}>{s.label}</Text>
          </MotionPress>
        );
      })}
    </View>
  );
}

// Under an address: once a full postcode is typed, where it is (from postcodes.io, free; only the postcode is sent), and the
// area is filled in if nobody chose one. While a postcode is part-typed at the end, the full postcodes it could be.
function PostcodeLookup({ p, text, disabled, onComplete, onFound }: { p: Palette; text: string; disabled?: boolean; onComplete: (text: string) => void; onFound: (place: PostcodePlace) => void }) {
  const full = findPostcode(text), partial = full ? null : partialPostcode(text);
  const [place, setPlace] = useState<{ postcode: string; found: PostcodePlace | null; error: string } | null>(null);
  const [options, setOptions] = useState<{ partial: string; list: string[] }>({ partial: "", list: [] });
  const found = useRef(onFound);
  useEffect(() => { found.current = onFound; });
  useEffect(() => {
    if (!full) return;
    let active = true;
    const timer = setTimeout(() => {
      lookupPostcode(full).then(result => { if (!active) return; setPlace({ postcode: full, found: result, error: "" }); if (result) found.current(result); })
        .catch(e => { if (active) setPlace({ postcode: full, found: null, error: e instanceof Error ? e.message : "The postcode could not be checked just now." }); });
    }, 500);
    return () => { active = false; clearTimeout(timer); };
  }, [full]);
  useEffect(() => {
    if (!partial || partial.replace(/\s/g, "").length < 3) return;
    let active = true;
    const timer = setTimeout(() => { suggestPostcodes(partial).then(list => { if (active) setOptions({ partial, list }); }).catch(() => undefined); }, 400);
    return () => { active = false; clearTimeout(timer); };
  }, [partial]);
  if (full) {
    const done = place?.postcode === full ? place : null;
    const line = !done ? "Checking the postcode…" : done.found ? [done.found.ward, done.found.council].filter(Boolean).join(", ") + (done.found.region ? `. Area: ${done.found.region}` : "")
      : done.error || "That postcode was not found. Check it, or choose the area below.";
    return (
      <View accessibilityLiveRegion="polite" style={[ui.row, { gap: 8 }]}>
        <Feather name={done && !done.found ? "alert-circle" : "map-pin"} size={15} color={done && !done.found ? p.waiting : p.primary} />
        <Text style={[ui.small, { color: done && !done.found ? p.text : p.muted, flex: 1 }]}>{line}</Text>
      </View>
    );
  }
  if (!partial || options.partial !== partial || !options.list.length) return null;
  return (
    <View style={{ gap: 6 }}>
      <Text style={[ui.small, { color: p.muted }]}>Finish the postcode</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.list.map(code => (
          <MotionPress key={code} disabled={disabled} accessibilityRole="button" accessibilityLabel={`Use postcode ${code}`} onPress={() => onComplete(completePostcode(text, code))}
            style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 999, justifyContent: "center", borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }}>
            <Text style={{ color: p.text, fontSize: 13, fontWeight: "600" }}>{code}</Text>
          </MotionPress>
        ))}
      </View>
    </View>
  );
}

function Field({ field: f, value, onChange, onAlso, p, disabled }: { field: WorkflowField; value: unknown; onChange: (value: unknown) => void; onAlso?: (values: Record<string, string>, onlyIfEmpty?: boolean) => void; p: Palette; disabled?: boolean }) {
  if (f.type === "checkbox") return (
    <MotionPress disabled={disabled} accessibilityRole="checkbox" accessibilityState={{ checked: value === true, disabled }} onPress={() => onChange(value !== true)} style={[ui.row, { gap: 12, minHeight: 48, paddingVertical: 10, alignItems: "flex-start" }]}>
      <View style={{ width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: value === true ? p.primary : p.controlBorder, backgroundColor: value === true ? p.primary : "transparent", alignItems: "center", justifyContent: "center" }}>{value === true && <Feather name="check" size={15} color={p.onPrimary} />}</View>
      <View style={{ flex: 1 }}><Text style={[ui.body, { color: p.text }]}>{f.label}</Text>{f.help && <Text style={[ui.small, { color: p.muted }]}>{f.help}</Text>}</View>
    </MotionPress>
  );
  const label = <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{f.label}{!f.required ? " (optional)" : ""}</Text>;
  // A date in a workflow form (only "Add a local event" has one) uses the shared calendar field (D's round 8 review).
  if (f.type === "date") {
    const text = value ? String(value) : "";
    return (
      <View style={{ gap: space.tight }} pointerEvents={disabled ? "none" : "auto"}>
        <DateField p={p} label={f.label + (!f.required ? " (optional)" : "")} mode="single" wholeMonthLink={false} empty="Choose a date" clearable={!f.required} value={{ from: text, to: text }} onChange={next => onChange(next.from)} />
        {f.help && <Text style={[ui.small, { color: p.muted }]}>{f.help}</Text>}
      </View>
    );
  }
  return (
    <View style={{ gap: space.tight }}>
      {label}
      {f.type === "select" ? (
        // Few options as radio choices, more as a dropdown, a long list with a search box (ChoiceField).
        <ChoiceField p={p} label={f.label} value={String(value ?? "")} options={f.options ?? []} onChange={onChange} disabled={disabled} />
      ) : (
        <TextInput accessibilityLabel={f.label} editable={!disabled} value={String(value ?? "")} onChangeText={onChange} placeholderTextColor={p.muted} multiline={f.type === "textarea"} keyboardType={f.type === "money" || f.type === "percent" ? "decimal-pad" : f.type === "number" ? "number-pad" : "default"} maxLength={f.type === "textarea" ? 10000 : 1000}
          style={{ borderWidth: 1, borderRadius: 14, padding: 13, minHeight: f.type === "textarea" ? 110 : 50, fontSize: 15, fontFamily: "Montserrat_500Medium", backgroundColor: p.background, color: p.text, borderColor: p.controlBorder, textAlignVertical: "top" }} />
      )}
      {!!f.suggestions?.length && <Suggestions p={p} label={f.label} items={f.suggestions} value={String(value ?? "")} disabled={disabled} onPick={s => { onChange(s.value); if (s.also) onAlso?.(s.also); }} />}
      {f.lookup === "postcode" && <PostcodeLookup p={p} text={String(value ?? "")} disabled={disabled} onComplete={onChange}
        onFound={place => { if ((SCOTTISH_REGIONS as readonly string[]).includes(place.region)) onAlso?.({ region: place.region }, true); }} />}
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
  const inFlight = useRef(false); // a second tap in the same instant never saves twice
  async function save() {
    if (busy || uploading || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const normalized = workflowValues(spec.fields, values), key = JSON.stringify(normalized), requestId = attempt?.key === key ? attempt.id : Crypto.randomUUID();
      setAttempt({ key, id: requestId });
      await liveApi(spec.endpoint === "workspace" ? "/workspace" : "/" + spec.endpoint, { ...(spec.endpoint === "workspace" ? {} : { requestId }), ...spec.build(normalized, requestId) });
      // A successful change is never repeated merely because the following read fails.
      celebrate("Done"); onClose(); await onSaved();
    } catch (e) { setError(message(e)); } finally { inFlight.current = false; setBusy(false); }
  }
  if (spec.unavailable) return <Text style={[ui.body, { color: p.muted }]}>{spec.unavailable}</Text>;
  // Each label belongs to the field under it: a field and its label sit close (space.tight), and the next label starts
  // a clear step further down (space.section), so a label never reads as a caption of the field above.
  const shown = spec.fields.filter(f => !f.after || (values[f.after] !== undefined && values[f.after] !== "" && values[f.after] !== null));
  return (
    <>
      <View style={{ gap: space.section }}>
      {shown.map((f, n) => <View key={f.name} style={{ gap: space.row }}>
        {!!f.section && <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "600", marginTop: n ? space.tight : 0 }}>{f.section}</Text>}
        {f.type === "photos" ? (spec.workId && f.purpose ? <Stagger key={f.name} index={n}><PhotoPicker p={p} workId={spec.workId} purpose={f.purpose} label={f.label} hint={f.help} onChange={(ids, loading) => { setValues(v => ({ ...v, [f.name]: ids })); setUploading(loading); }} /></Stagger> : null) : <Stagger key={f.name} index={n}><Field field={f.name === "budgetItemId" ? { ...f, options: [{ value: "", label: "Not from the chart" }, ...budget.map(b => ({ value: b.id, label: `${b.item}, up to ${money(b.maxUnitMinor)} each` }))] } : f.name === "invoiceId" ? { ...f, options: invoices.filter(i => !spec.workId || i.work_id === spec.workId).map(i => ({ value: i.id, label: i.reference + ", " + money(i.amount_minor) + ", " + i.status })) } : f} value={values[f.name]} onChange={v => setValues(current => ({ ...current, [f.name]: v }))} onAlso={(also, onlyIfEmpty) => setValues(current => fillAlso(current, also, onlyIfEmpty))} p={p} disabled={busy} /></Stagger>}
      </View>)}
      </View>
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
      <WorkPhotos p={p} workId={j.workId} title="Photos and documents" refreshKey={saved} queued={false} />
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
      {account.role !== "client" && <EnquiryContact palette={p} j={j} />}
      {account.role !== "client" && (!!j.form?.gasElectricMeters || !!j.form?.operatingStatus) && <View style={{ gap: 4 }}>
        {!!j.form?.gasElectricMeters && <Text style={[ui.body, { color: p.text }]}><Text style={{ fontWeight: "700" }}>Gas and electric: </Text>{String(j.form.gasElectricMeters)}</Text>}
        {!!j.form?.operatingStatus && <Text style={[ui.body, { color: p.text }]}><Text style={{ fontWeight: "700" }}>Current operating status: </Text>{String(j.form.operatingStatus)}</Text>}
      </View>}
      {!!j.invoiceOutsideAt && <Text style={[ui.small, { color: p.muted }]}>Onboarding invoice handled outside the app: {j.invoiceOutsideNote}</Text>}
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

// Who asked for the estimate, from the enquiry form. Owners with an account don't need it, and
// older enquiries have none.
function EnquiryContact({ palette: p, j }: { palette: Palette; j: JourneyView }) {
  const e = j.enquiry ?? {}, [linkError, setLinkError] = useState("");
  const rows = [
    ["Contact", [e.contactName, e.companyName].filter(Boolean).join(", ")], ["Email", e.email], ["Phone", e.phone],
    ["Existing client", e.existingClient === undefined ? "" : e.existingClient ? "Yes" : "No"], ["WCs", e.wcs === undefined ? "" : String(e.wcs)],
    ["Parking", e.parking], ["Garden", e.garden], ["Notes", e.notes],
  ].filter((r): r is [string, string] => !!r[1]);
  if (!rows.length && !e.photoLink) return j.ownerAccount === false ? <Text style={[ui.small, { color: p.muted }]}>No owner account: the team records the owner&apos;s steps.</Text> : null;
  return (
    <View style={{ gap: 6, padding: 14, borderRadius: 16, backgroundColor: p.wash }}>
      <Text style={{ color: p.text, fontWeight: "700" }}>From the enquiry</Text>
      {rows.map(([label, value]) => <Text key={label} selectable style={[ui.body, { color: p.text }]}><Text style={{ color: p.muted }}>{label}: </Text>{value}</Text>)}
      {!!e.photoLink && <SoftButton label="Open the photos and videos" icon="external-link" palette={p} onPress={() => void Linking.openURL(e.photoLink!).catch(() => setLinkError("The photo link could not be opened."))} />}
      {!!linkError && <Text accessibilityRole="alert" style={{ color: p.danger }}>{linkError}</Text>}
      {j.ownerAccount === false && <Text style={[ui.small, { color: p.muted }]}>No owner account: the team records the owner&apos;s steps.</Text>}
    </View>
  );
}

function PropertyCard({ property, index, palette: p, onPress }: { property: PropertyView; index: number; palette: Palette; onPress: () => void }) {
  const live = property.status === "active";
  return (
    <MotionPress {...hoverLift} accessibilityRole="button" accessibilityLabel={"Open " + property.name} onPress={onPress} style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, padding: 0, overflow: "hidden", borderRadius: 26, gap: 0 }]}>
      {/* The property's "photo": its building on a soft wash, the status pinned on top. */}
      <View style={[{ minHeight: 140, alignItems: "center", justifyContent: "center", backgroundColor: departmentColor(index % 2 ? "clients" : "stays", p).wash }]}>
        <Float distance={3} duration={3600} delay={(index % 4) * 400}><View style={{ width: 82, height: 90, backgroundColor: p.surface, borderRadius: 22, borderWidth: 1, borderColor: p.border, alignItems: "center", justifyContent: "center", ...web({ boxShadow: "0 16px 28px -18px rgba(21,45,40,.55)" }) }}><BuildingGlyph palette={p} variant={index} /></View></Float>
        <View style={[ui.row, { position: "absolute", left: 14, top: 14, backgroundColor: p.surface, borderRadius: 999, paddingLeft: 9, paddingRight: 11, paddingVertical: 5, gap: 6, ...web({ boxShadow: "0 6px 14px -10px rgba(21,45,40,.5)" }) }]}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: live ? p.success : p.waiting }} />
          <Text style={[ui.small, { color: p.text, fontWeight: "700", fontSize: 12 }]}>{live ? "Live" : readableStage(property.status)}</Text>
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

// Postcode positions already looked up, kept for the session so the map does not ask again.
const knownPostcodes: Record<string, [number, number]> = {};
// The postcodes on the map whose position is not known yet: the properties with no saved position.
function usePostcodePositions(properties: PropertyView[]) {
  const [positions, setPositions] = useState<Record<string, [number, number]>>(() => ({ ...knownPostcodes }));
  const wanted = useMemo(() => [...new Set(properties.filter(x => x.status !== "archived" && typeof x.latitude !== "number").map(x => findPostcode(x.address)).filter((x): x is string => !!x))].sort().join("|"), [properties]);
  useEffect(() => {
    const missing = wanted ? wanted.split("|").filter(code => !(code in knownPostcodes)) : [];
    if (!missing.length) return;
    let active = true;
    // If postcodes.io cannot be reached, the dots stay in their postcode districts.
    postcodePositions(missing).then(found => { Object.assign(knownPostcodes, found); if (active) setPositions({ ...knownPostcodes }); }).catch(() => undefined);
    return () => { active = false; };
  }, [wanted]);
  return positions;
}

// The portfolio at a glance for the team: live, onboarding, owners, and properties per region.
function PortfolioCard({ palette: p, summary, properties, onOpen }: { palette: Palette; summary: PortfolioSummary; properties: PropertyView[]; onOpen: (property: PropertyView) => void }) {
  const positions = usePostcodePositions(properties);
  const points = useMemo(() => propertyPoints(properties, positions), [properties, positions]);
  const top = summary.regions[0]?.count || 1, wide = useWindowDimensions().width >= 700;
  const regionFocus = useChartFocus(), [regionWidth, setRegionWidth] = useState(0), regionTotal = summary.regions.reduce((t, r) => t + r.count, 0);
  const stats: [string, number, IconName][] = [["Properties", summary.total, "home"], ["Live", summary.live, "check-circle"], ["Onboarding", summary.onboarding, "key"], ["Owners", summary.owners, "users"]];
  return (
    <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 14 }]}>
      <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Portfolio</Text>
      <StatGrid>
        {stats.map(([label, value, icon]) => <StatTile key={label} p={p} icon={icon} tone="stays" label={label} value={value} />)}
      </StatGrid>
      <View style={{ flexDirection: wide ? "row" : "column", gap: 20, alignItems: wide ? "flex-start" : "stretch" }}>
        <View style={{ flex: wide ? 1 : undefined, minWidth: 0 }}><ScotlandMap palette={p} regions={summary.regions} points={points} addressOf={id => properties.find(x => x.id === id)?.address || undefined} onOpenProperty={id => { const x = properties.find(y => y.id === id); if (x) onOpen(x); }} /></View>
        {/* Regions, largest first: the name and count above a bar that grows to its share. */}
        <View style={{ gap: 14, flex: wide ? 1 : undefined, minWidth: 0, padding: 18, borderRadius: 20, backgroundColor: p.background, borderWidth: 1, borderColor: p.border }}>
          <View style={[ui.between, { gap: 8 }]}>
            <Text style={[ui.label, { color: p.muted }]}>By region</Text>
            <Text style={[ui.small, { color: p.muted, fontVariant: ["tabular-nums"] }]}>{summary.regions.length} {summary.regions.length === 1 ? "region" : "regions"}</Text>
          </View>
          {summary.regions.slice(0, 8).map((r, i) => (
            <Stagger key={r.region} index={i}><MotionPress accessibilityRole="button" accessibilityLabel={`${r.region}: ${r.count}`} {...regionFocus.press(i)} onLayout={i === 0 ? (e: { nativeEvent: { layout: { width: number } } }) => setRegionWidth(e.nativeEvent.layout.width) : undefined} style={{ gap: 7, position: "relative", zIndex: regionFocus.focus === i ? 5 : 0 }}>
              <View style={[ui.between, { gap: 10 }]}>
                <Text numberOfLines={1} style={{ color: p.text, flex: 1, fontSize: 14, fontWeight: i === 0 ? "700" : "500" }}>{r.region}</Text>
                <Text style={{ color: p.text, fontSize: 14, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{formatCount(r.count)}</Text>
              </View>
              <GrowBar share={Math.max(0.06, r.count / top)} color={i === 0 ? p.primary : p.chart} track={p.elevated} height={8} />
              {regionFocus.focus === i && <ChartTip p={p} x={Math.max(80, Math.max(0.06, r.count / top) * regionWidth)} width={regionWidth} top={-58} tipWidth={170} title={r.region} rows={[{ label: "Properties", value: formatCount(r.count), color: p.primary }, { label: "Share of all", value: regionTotal ? Math.round(r.count / regionTotal * 100) + "%" : "0%" }]} />}
            </MotionPress></Stagger>
          ))}
        </View>
      </View>
    </View>
  );
}

export function LiveProperties({ palette: p, desktop, account, properties, journeys, work, invoices, period, loading, onForm, onOpenWork, onRefresh, focusProperty }: {
  palette: Palette; desktop: boolean; account: WorkspaceAccount; properties: PropertyView[]; journeys: JourneyView[]; work: OperationView[]; invoices: InvoiceView[];
  period: AnalyticsPeriod; loading: boolean; onForm: (form: WorkflowForm) => void; onOpenWork?: (item: OperationView) => void; onRefresh: () => void;
  // A property chosen in search or Favorites opens straight away (once the list has loaded).
  focusProperty?: { id: string; nonce: number } | null;
}) {
  const [query, setQuery] = useState(""), [shown, setShown] = useState(24), [selected, setSelected] = useState<PropertyView | null>(null);
  const [focused, setFocused] = useState(0);
  if (focusProperty && focusProperty.nonce !== focused && properties.length) {
    setFocused(focusProperty.nonce);
    setSelected(properties.find(x => x.id === focusProperty.id) ?? null);
  }
  const [filter, setFilter] = useState<PropertyFilter>(null), [ownerCount, setOwnerCount] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false), [exportMessage, setExportMessage] = useState("");
  // Every word typed must appear in the name, area or address, in any order ("pitt lower" finds "39 (Lower) Pitt").
  const visible = properties.filter(property => (!filter || filter.ids.includes(property.id)) && matchesSearch(normalise(property.name + " " + property.region + " " + property.address), query));
  const staff = isWorkspaceAdmin(account.role) || account.role === "stays";
  const jump = useContext(WorkJumpContext);
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
  // Staff get the Properties table; owners and cleaners keep the cards.
  const table = usesPropertyTable(account.role);
  const openForm = (form: WorkflowForm) => { setSelected(null); onForm(form); };
  const closeDetail = () => { setSelected(null); setExportMessage(""); };
  const journeyBlock = (property: PropertyView) => journey ? <JourneyDetails j={journey} p={p} account={account} propertyName={property.name} onForm={openForm} work={work} /> : null;
  // What follows the profile in a property's detail: new work, work at the property, reports and invoices.
  const moreFor = (property: PropertyView) => (
    <>
      {createOperationForms(account, property.id).map(f => <SoftButton key={f.key} label={f.title} icon="plus" palette={p} onPress={() => openForm(f)} />)}
      {!!propertyWork.length && <View style={{ gap: 4 }}>
        <Text style={{ color: p.text, fontWeight: "700" }}>Work at this property · {propertyWork.length}</Text>
        {/* Open items first; each opens with every step available to you. */}
        {[...propertyWork].sort((a, b) => Number(isDone(a.status)) - Number(isDone(b.status))).slice(0, 30).map(item => <View key={item.workId} style={{ gap: 6 }}><LiveWorkRow item={item} palette={p} onPress={() => {
          if (onOpenWork) { setSelected(null); onOpenWork(item); return; }
          const form = operationForms(account, item)[0]; if (form) openForm(form);
        }} /></View>)}
        {propertyWork.length > 30 && <Text style={[ui.small, { color: p.muted }]}>The rest are in Work → All work.</Text>}
      </View>}
      {account.modules.includes(account.role === "client" ? "client-dashboard" : "weekly-performance") && ["client", "stays", "admin", "super_admin"].includes(account.role) && <View style={{ gap: 8 }}>
        <SoftButton label={exporting ? "Preparing report…" : "Weekly report to read or print"} icon="external-link" palette={p} disabled={exporting} onPress={() => void downloadProperty("page")} />
        <SoftButton label="Spreadsheet (CSV)" icon="download" palette={p} disabled={exporting} onPress={() => void downloadProperty("csv")} />
        <Text style={[ui.small, { color: p.muted }]}>Pricing, listing checks and local events for {periodLabel(period)}. Choose up to 31 days in Reports.</Text>
        {account.role !== "client" && <LocalEvents p={p} propertyId={property.id} refreshKey={work} />}
        {account.role !== "client" && <SoftButton label="Add a local event" icon="calendar" palette={p} onPress={() => openForm(localEventForm(property.id))} />}
        {!!exportMessage && <Text style={[ui.small, { color: p.text }]}>{exportMessage}</Text>}
      </View>}
      {invoices.some(invoice => invoice.property_id === property.id) && <View style={{ gap: 8 }}>
        <Text style={{ color: p.text, fontWeight: "700" }}>Invoices</Text>
        {invoices.filter(invoice => invoice.property_id === property.id).map(invoice => (
          <View key={invoice.id} style={[ui.between, { gap: 12, paddingVertical: 8, borderTopWidth: 1, borderColor: p.border }]}>
            <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
              <Text style={{ color: p.text, fontWeight: "600" }}>{invoice.reference}</Text>
              <Text style={[ui.small, { color: p.muted, fontVariant: ["tabular-nums"] }]}>{invoice.currency === "GBP" ? money(invoice.amount_minor) : `${invoice.currency} ${(invoice.amount_minor / 100).toFixed(2)}`}</Text>
            </View>
            <Tag label={invoice.status === "paid" ? "Settled" : readableStage(invoice.status)} tone={invoice.status === "paid" ? "good" : invoice.status === "issued" ? "wait" : "plain"} p={p} />
          </View>
        ))}
      </View>}
    </>
  );
  return (
    <>
      <PageHeading palette={p} title={account.role === "client" ? "Your properties" : account.role === "cleans" ? "Assigned properties" : "Properties"} subtitle={loading ? "Loading your properties…" : `${properties.length} ${properties.length === 1 ? "property" : "properties"} within your access.`} />
      {(account.role === "client" || staff) && account.modules.includes("property-onboarding") && <EnquiryCard palette={p} team={staff} onStart={() => onForm(newEnquiryForm(staff))} />}
      {/* Client Enquiries: the landlord fills the form in themselves (on phones this is the way in). */}
      {staff && account.modules.includes("property-onboarding") && jump && <SoftButton label="Client enquiries: send the form to a landlord" icon="arrow-right" palette={p} onPress={() => jump({ kind: "tab", tab: "enquiries" })} />}
      {staff && <HostawaySyncCard p={p} onSynced={onRefresh} />}
      {staff && !loading && properties.length > 0 && <PortfolioCard palette={p} properties={properties} onOpen={setSelected} summary={{ ...portfolioSummary(properties, journeys), ...(ownerCount !== null ? { owners: ownerCount } : {}) }} />}
      {staff && !loading && properties.length > 0 && account.modules.includes("property-database") && <PortfolioInsights palette={p} properties={properties} journeys={journeys} filter={filter} onFilter={f => { setFilter(f); setShown(24); }} onOwners={setOwnerCount} />}
      {staff && !loading && account.modules.includes("property-onboarding") && <OnboardingPipeline palette={p} properties={properties} journeys={journeys} onOpen={setSelected} />}
      {!!filter && <MotionPress accessibilityRole="button" onPress={() => setFilter(null)} style={[ui.row, { gap: 8, alignSelf: "flex-start", maxWidth: "100%", minHeight: 40, paddingHorizontal: 14, borderRadius: 999, backgroundColor: p.wash }]}>
        <Text numberOfLines={1} style={{ color: p.text, fontWeight: "600", flexShrink: 1 }}>Showing: {filter.label} · {filter.ids.length}</Text><Feather name="x" size={16} color={p.text} />
      </MotionPress>}
      {table ? <>
        <PropertiesTable palette={p} account={account} properties={filter ? properties.filter(x => filter.ids.includes(x.id)) : properties} journeys={journeys} work={work} loading={loading}
          selected={selected} onSelect={setSelected} onClose={closeDetail} onOpenWork={onOpenWork} extra={property => <>{journeyBlock(property)}{moreFor(property)}</>} />
        {!loading && !properties.length && <EmptyState palette={p} icon="home" title="No properties yet" detail="Properties appear here once they are added or onboarded." />}
      </> : <>
        <SearchBox p={p} value={query} onChange={value => { setQuery(value); setShown(24); }} placeholder="Search by name, street, area or postcode" label="Search properties" />
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
      </>}
      {!table && <Sheet palette={p} visible={!!selected} onClose={closeDetail} title={selected?.name ?? ""} subtitle={selected ? [selected.address, selected.region].filter(Boolean).join(" · ") : undefined} icon="house">
        {selected && <>
          <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
            <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: selected.status === "active" ? p.successWash : p.cautionWash }}><Text style={{ color: p.text, fontSize: 12, fontWeight: "700" }}>{selected.status === "active" ? "Live" : readableStage(selected.status)}</Text></View>
            {!!selected.bedrooms && <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: p.wash }}><Text style={{ color: p.text, fontSize: 12, fontWeight: "700" }}>{selected.bedrooms} {selected.bedrooms === 1 ? "bedroom" : "bedrooms"}</Text></View>}
            {account.role !== "client" && <FavoriteButton entryKey={"property:" + selected.id} label={selected.name} palette={p} />}
          </View>
          {journey && selected.status !== "active" && journeyBlock(selected)}
          <PropertyProfile palette={p} account={account} propertyId={selected.id} journey={journey} />
          <PropertyAccess palette={p} account={account} propertyId={selected.id} />
          {journey && selected.status === "active" && journeyBlock(selected)}
          {moreFor(selected)}
        </>}
      </Sheet>}
    </>
  );
}

// Updates in day groups, in London time: "Today", "Yesterday", then "Friday 9 October".
// The day a row belongs to: Today, Yesterday, then the date.
function dayGroups(rows: readonly NoticeRow[]): [string, NoticeRow[]][] {
  const day = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(iso));
  const today = day(new Date().toISOString()), yesterday = day(new Date(Date.now() - 86_400_000).toISOString());
  const groups = new Map<string, NoticeRow[]>();
  for (const r of rows) {
    const at = r.notices[0].created_at, key = day(at);
    const label = key === today ? "Today" : key === yesterday ? "Yesterday" : new Date(at).toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long" });
    groups.set(label, [...(groups.get(label) ?? []), r]);
  }
  return [...groups.entries()];
}

// The Updates feed (round 6): each row says what it is ("Pricing: 3 empty nights to price"), then the property, who did it and when.
// A row with a work item opens it; chat and guest notices open Messages; a burst of the same automatic kind is one row that opens
// its list. Opening the feed marks the listed updates read.
// Round 7: an item that is not in the loaded work list is read on its own and opened (the same rules as the work list, so an
// item someone may not see is simply "no longer available"), and "Show older updates" pages back 50 at a time.
export function LiveActivity({ palette: p, notices, loading, onRead, work = [], onOpenWork, onOpenMessages }: {
  palette: Palette; notices: NoticeView[]; loading: boolean; onRead?: (ids: number[]) => void;
  work?: readonly OperationView[]; onOpenWork?: (item: OperationView) => void; onOpenMessages?: () => void;
}) {
  // Older updates, 50 at a time from the oldest one shown.
  const [older, setOlder] = useState<NoticeView[]>([]);
  const [olderState, setOlderState] = useState<"idle" | "loading" | "failed">("idle");
  const [more, setMore] = useState<boolean | null>(null);
  const all = useMemo(() => mergeNotices(notices, older), [notices, older]);
  // Opening Activity marks the listed updates read (one request each, newest first, never twice),
  // so Home's Updates count only shows what is new. Older pages, once shown, are marked read the same way.
  const tried = useRef(new Set<number>());
  useEffect(() => {
    const ids = unreadNotices(all).map(n => n.id).filter(id => !tried.current.has(id)).slice(0, MARK_READ_PER_VISIT);
    if (!ids.length) return;
    ids.forEach(id => tried.current.add(id));
    void (async () => {
      const read: number[] = [];
      for (const id of ids) {
        try { await writeControls({ action: "markNotificationRead", requestId: Crypto.randomUUID(), eventId: String(id) }); read.push(id); }
        catch { break; /* offline or rate-limited: try again next visit */ }
      }
      if (read.length) { onRead?.(read); setOlder(list => list.some(n => read.includes(n.id)) ? list.map(n => read.includes(n.id) ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n) : list); }
    })();
  }, [all, onRead]);
  const showOlder = async () => {
    const before = oldestNoticeId(all);
    if (before === null) return;
    setOlderState("loading");
    try {
      const page = z.array(noticeViewSchema).parse((await readOlderNotices(before)).data);
      // A page with nothing new (the demo answers every page alike) ends the paging too.
      const known = new Set(all.map(n => n.id));
      setOlder(list => mergeNotices(list, page)); setMore(mayHaveOlder(page.length) && page.some(n => !known.has(n.id))); setOlderState("idle");
    } catch { setOlderState("failed"); }
  };
  const canShowOlder = more ?? mayHaveOlder(notices.length);
  const [openNote, setOpenNote] = useState<string | null>(null);
  const rows = useMemo(() => noticeRows(all), [all]);
  const search = useListSearch(rows, r => [r.title, r.line, ...r.notices.map(n => n.work_title ?? "")]);
  const [opened, setOpened] = useState<string | null>(null);
  const byId = useMemo(() => new Map(work.map(w => [w.workId, w] as const)), [work]);
  // Where a row goes: its work item (from the work already loaded, else read on its own), or Messages.
  const openWork = async (workId: string) => {
    setOpenNote(null);
    try {
      const item = workItemFrom((await readWorkItem(workId)).data, workId);
      if (item && onOpenWork) onOpenWork(item); else setOpenNote("That item is no longer available to you.");
    } catch (error) { setOpenNote(error instanceof WorkspaceApiError && error.status === 404 ? "That item is no longer available to you." : "That item could not be opened just now. Try again."); }
  };
  const press = (row: NoticeRow) => {
    if (row.notices.length > 1) return () => setOpened(opened === row.key ? null : row.key);
    const t = row.target;
    if (t?.kind === "work" && onOpenWork) { const item = byId.get(t.workId); return item ? () => onOpenWork(item) : () => void openWork(t.workId); }
    if (t?.kind === "messages" && onOpenMessages) return onOpenMessages;
    return undefined;
  };
  return (
    <>
      <PageHeading palette={p} title="Recent activity" subtitle="Updates on the work and properties within your access." />
      <ListSearchBox p={p} search={search} nouns="updates" />
      {!!openNote && <Text accessibilityLiveRegion="polite" style={[ui.small, { color: p.muted }]}>{openNote}</Text>}
      {search.missed ? null : rows.length ? (
        dayGroups(search.shown).map(([day, list], g) => (
          <View key={day} style={{ gap: 8 }}>
            <View style={[ui.row, { gap: 10, paddingHorizontal: 4 }]}>
              <Text style={[ui.label, { color: g === 0 ? p.primary : p.muted }]}>{day}</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: p.border }} />
              <Text style={[ui.small, { color: p.muted, fontVariant: ["tabular-nums"] }]}>{list.reduce((sum, r) => sum + r.notices.length, 0)}</Text>
            </View>
            <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, gap: 0 }]}>
              {list.map((row, i) => {
                const group = row.notices.length > 1, open = group && opened === row.key;
                return (
                  <View key={row.key} style={{ borderTopWidth: i ? 1 : 0, borderColor: p.border }}>
                    <NoticeRowView row={row} palette={p} icon={noticeIcon(row.notices[0].event_type, row.notices[0].work_kind)} onPress={press(row)} open={group ? open : undefined} clock />
                    {open && <View style={{ marginLeft: 17, borderLeftWidth: 1, borderColor: p.border, paddingLeft: 12 }}>
                      {row.notices.map(n => { const one = noticeRow(n); return <NoticeRowView key={n.id} row={one} palette={p} icon={noticeIcon(n.event_type, n.work_kind)} onPress={press(one)} clock />; })}
                    </View>}
                  </View>
                );
              })}
            </View>
          </View>
        ))
      ) : <EmptyState palette={p} icon="activity" title={loading ? "Loading updates…" : "No updates yet"} detail="Changes to your work and properties appear here." />}
      {!search.missed && rows.length > 0 && (canShowOlder || olderState === "failed") && (
        <MotionPress accessibilityRole="button" accessibilityLabel="Show older updates" disabled={olderState === "loading"} onPress={() => void showOlder()}
          style={{ alignSelf: "flex-start", minHeight: 44, justifyContent: "center" }}>
          <Text style={{ color: p.primary, fontWeight: "600" }}>{olderState === "loading" ? "Loading older updates…" : olderState === "failed" ? "Older updates could not be loaded. Try again" : "Show older updates"}</Text>
        </MotionPress>
      )}
      {!search.missed && more === false && <Text style={[ui.small, { color: p.muted }]}>That is every update.</Text>}
      <Text style={[ui.small, { color: p.muted }]}>Email and push notifications start once they are switched on.</Text>
    </>
  );
}

export function LiveHelp({ palette: p, account, properties = [], onSignOut, busy, onOpen }: { palette: Palette; account: WorkspaceAccount; properties?: PropertyView[]; onSignOut: () => void; busy: boolean; onOpen?: (tab: "home" | "work" | "properties" | "analytics", view?: WorkView, sub?: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const faq = faqsForAccess(account.role, account.modules).filter(f => f.id !== "communication-centre");
  const search = useListSearch(faq, f => [f.question, f.answer]);
  return (
    <>
      <PageHeading palette={p} title="Help" subtitle={"Your tools and answers for your role: " + readableStage(account.role) + "."} />
      {onOpen && <ToolDirectory palette={p} account={account} properties={properties} onOpen={onOpen} />}
      <ListSearchBox p={p} search={search} nouns="questions" />
      {!search.missed && <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, gap: 0 }]}>
        {search.shown.map((f, i) => (
          <View key={f.id} style={{ borderTopWidth: i ? 1 : 0, borderColor: p.border }}>
            <MotionPress accessibilityRole="button" accessibilityState={{ expanded: open === f.id }} onPress={() => setOpen(open === f.id ? null : f.id)} style={[ui.between, { gap: 12, minHeight: 56, paddingVertical: 12 }]}>
              <Text style={{ color: p.text, fontSize: 15, fontWeight: "600", flex: 1 }}>{f.question}</Text>
              <ExpandChevron open={open === f.id} color={p.muted} />
            </MotionPress>
            {open === f.id && <SwapIn swapKey={f.id}><Text style={[ui.body, { color: p.muted, paddingBottom: 14 }]}>{f.answer}</Text></SwapIn>}
          </View>
        ))}
      </View>}
      <LiveTraining palette={p} />
      <MyContracts palette={p} account={account} />
      <SoftButton label={busy ? "Signing out…" : "Sign out"} icon="log-out" palette={p} disabled={busy} onPress={onSignOut} />
      <LegalLinks p={p} />
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
