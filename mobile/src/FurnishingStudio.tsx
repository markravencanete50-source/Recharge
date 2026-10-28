import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Platform, Switch, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Sheet } from "./TeamFlows";
import { Pills } from "./Pills";
import { ChoiceField } from "./ChoiceField";
import { Dropdown } from "./Dropdown";
import { DateField } from "./CalendarPicker";
import { SearchBox, SearchPicker } from "./SearchPicker";
import { List, Row } from "./AccountsPayable";
import { Button, Field, Loading, london, message, Notice, Section, StatGrid, StatTile, Tag, useRequestId } from "./LiveKit";
import { exportReport } from "./exportReport";
import { readFurnishing, writeFurnishing } from "./backend/client";
import { space, ui, type Palette } from "./theme";
import { formatCount, formatMoney, formatMoneyShort } from "../../lib/format";
import { matchesSearch } from "../../lib/search-options";
import { AnalyticsPanel, PeriodBar, usePeriod, usePeriodData } from "./AnalyticsKit";
import { STANDARD_PERIODS } from "../../lib/report-analytics";
import { furnishingModel } from "../../lib/report-analytics-models";
import { quoteFileName, quoteHtml, shoppingListHtml } from "../../lib/furnishing-documents";
import {
  analyticsQuery, analyticsSchema, BASIS_LABEL, buying, canUseFurnishingStudio, catalogueQuery, catalogueSchema, categoryName, COOKER_LABEL, COOKERS, COUNT_INPUTS,
  COVERING_LABEL, editable, emptyItemForm, emptyProjectForm, estimateLines, estimateTotals, formFromProject, FURNISHING_CATEGORIES, FURNISHING_INTRO, FURNISHING_TITLE,
  headerStats, INVENTORY_ROLE_LABEL, INVENTORY_ROLES, itemToForm, monthName, MOVE_LABEL, NEXT_STATUS, normaliseInputs, OPTION_KEYS, OPTION_LABEL, penceToPounds, poundsToPence,
  projectFormError, projectQuery, projectSchema, projectsQuery, projectsSchema, propertiesQuery, propertyChoiceSchema, PROPERTY_TYPE_LABEL, PROPERTY_TYPES, RULE_BASES,
  RULE_WHEN, ruleLine, saveProjectAction, savedLines, shoppingGroups, spendSummary, STATUS_LABEL, STATUS_TONE, TV_LABEL, TV_SETUPS, varianceLine, WHEN_LABEL,
  WINDOW_COVERINGS, ZIP_SETUP_LABEL, ZIP_SETUPS,
  type CatalogueItem, type CountGroup, type EstimateLine, type FurnishingCategory, type ItemForm, type Project, type ProjectForm,
  type ProjectStatus, type ProjectSummary, type PropertyChoice, type RuleBasis, type RuleWhen, type StudioInputs,
} from "../../lib/furnishing-studio";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

// Furnishing Studio (Client relations → Furnishing Studio; Stays team and management only). Three parts: Projects (each a
// client quote in four steps: 01 Property details, 02 Catalogue, 03 Estimate, 04 Shopping list), the shared Catalogue,
// and Analytics. Everything is read from and saved to the database (lib/furnishing-studio.ts); nothing is kept in the
// browser. Theme tokens only, UK English, money as pence.

type Tab = "projects" | "catalogue" | "analytics";
const TABS: readonly Tab[] = ["projects", "catalogue", "analytics"];
const TAB_LABEL: Record<Tab, string> = { projects: "Projects", catalogue: "Catalogue", analytics: "Analytics" };
const STEPS = ["details", "catalogue", "estimate", "shopping"] as const;
type Step = (typeof STEPS)[number];
const STEP_LABEL: Record<Step, string> = { details: "01 Property details", catalogue: "02 Catalogue", estimate: "03 Estimate", shopping: "04 Shopping list" };
const GROUP_TITLE: Record<CountGroup, string> = { property: "Property & client", beds: "Bed configuration", rooms: "Room details & furnishings" };

// On the web the document opens in a new tab with "Print or save as PDF"; on a phone the share sheet saves or opens it.
async function openDocument(html: (origin?: string) => string, fileName: string) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const page = window.open("", "_blank");
    if (!page) throw new Error("Allow pop-ups for Recharge to open the document.");
    page.document.open(); page.document.write(html(window.location.origin)); page.document.close();
    return "The document opened in a new tab. Choose Print or save as PDF.";
  }
  await exportReport(html(), fileName, { mime: "text/html", uti: "public.html" });
  return "Ready to save or share. Open it and choose Print or save as PDF.";
}

export function FurnishingStudio({ p, account }: { p: Palette; account: WorkspaceAccount }) {
  const [tab, setTab] = useState<Tab>("projects");
  const [catalogue, setCatalogue] = useState<CatalogueItem[] | null>(null), [error, setError] = useState("");
  const loadCatalogue = useCallback(async () => {
    try { setCatalogue(catalogueSchema.parse((await readFurnishing(catalogueQuery())).data)); setError(""); } catch (e) { setError(message(e)); }
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void loadCatalogue(); }); return () => { active = false; }; }, [loadCatalogue]);
  // The database refuses everyone else; the tool is not drawn for them either.
  if (!canUseFurnishingStudio(account.role)) return <Notice p={p} text="Furnishing Studio is for the Stays team and management." />;
  return (
    <View style={{ gap: space.section }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>{FURNISHING_TITLE}</Text>
        <Text style={[ui.small, { color: p.muted }]}>{FURNISHING_INTRO}</Text>
      </View>
      <Pills p={p} title="Choose a part of Furnishing Studio" values={TABS} value={tab} onChange={setTab} label={t => TAB_LABEL[t]} />
      {!!error && <Notice p={p} text={error} tone="bad" />}
      {!catalogue && !error && <Loading p={p} />}
      {catalogue && tab === "projects" && <Projects p={p} catalogue={catalogue} />}
      {catalogue && tab === "catalogue" && <Catalogue p={p} catalogue={catalogue} onSaved={loadCatalogue} />}
      {tab === "analytics" && <Analytics p={p} />}
    </View>
  );
}

// --- Projects ---------------------------------------------------------------------------------------------------------------
function Projects({ p, catalogue }: { p: Palette; catalogue: CatalogueItem[] }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null), [error, setError] = useState("");
  const [open, setOpen] = useState<string | "new" | null>(null), [query, setQuery] = useState(""), [show, setShow] = useState<"open" | "archived">("open");
  const load = useCallback(async () => {
    try { setProjects(projectsSchema.parse((await readFurnishing(projectsQuery())).data)); setError(""); } catch (e) { setError(message(e)); }
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  if (open) return <ProjectEditor p={p} catalogue={catalogue} projectId={open === "new" ? null : open} onBack={() => { setOpen(null); void load(); }} onSaved={id => setOpen(id)} />;
  const shown = (projects ?? []).filter(x => x.archived === (show === "archived") && matchesSearch([x.number, x.clientName, x.propertyName ?? "", x.address].join(" "), query));
  return (
    <View style={{ gap: space.row }}>
      <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}><Button label="New project" icon="plus" primary p={p} onPress={() => setOpen("new")} /></View>
      {!!error && <Notice p={p} text={error} tone="bad" />}
      {!projects && !error && <Loading p={p} />}
      {projects && <Section title="Saved projects" p={p}>
        <Pills p={p} title="Show" values={["open", "archived"] as const} value={show} onChange={setShow} label={v => v === "open" ? "Current" : "Archived"} />
        <SearchBox p={p} value={query} onChange={setQuery} placeholder="Search by client, property or quote number" />
        <List p={p} search={false} empty={query.trim() ? "Nothing matches that search." : show === "archived" ? "No archived projects." : "No projects yet. Start one with New project."}>
          {shown.map((x, n) => <Row key={x.id} p={p} first={n === 0} art="sofa" title={`${x.clientName} · ${x.number}`}
            detail={[x.propertyName ?? x.address, `${x.bedrooms} ${x.bedrooms === 1 ? "bedroom" : "bedrooms"}`, buying(x.status) && x.shoppingLines ? `${x.purchasedLines} of ${x.shoppingLines} bought` : ""].filter(Boolean).join(" · ")}
            tags={[[STATUS_LABEL[x.status], STATUS_TONE[x.status]]]} amount={formatMoney(x.quotePence)} onPress={() => setOpen(x.id)} />)}
        </List>
      </Section>}
    </View>
  );
}

function Stepper({ p, label, help, value, min, max, disabled, onChange }: { p: Palette; label: string; help?: string; value: number; min: number; max: number; disabled?: boolean; onChange: (v: number) => void }) {
  const button = (icon: "minus" | "plus", next: number, off: boolean) => (
    <MotionPress accessibilityRole="button" accessibilityLabel={`${icon === "plus" ? "Increase" : "Decrease"} ${label}`} disabled={off || disabled} onPress={() => onChange(next)}
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", opacity: off || disabled ? 0.35 : 1 }}>
      <Feather name={icon} size={18} color={p.text} />
    </MotionPress>
  );
  return (
    <View style={[ui.between, { gap: 12, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }]}>
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <Text style={{ color: p.text, fontSize: 14, fontWeight: "700" }}>{label}</Text>
        {!!help && <Text style={[ui.small, { color: p.muted }]}>{help}</Text>}
      </View>
      <View style={[ui.row, { borderWidth: 1, borderColor: p.border, borderRadius: 12, overflow: "hidden" }]}>
        {button("minus", value - 1, value <= min)}
        <Text accessibilityLabel={`${label}: ${value}`} style={{ color: p.text, fontSize: 16, fontWeight: "700", minWidth: 36, textAlign: "center", fontVariant: ["tabular-nums"] }}>{value}</Text>
        {button("plus", value + 1, value >= max)}
      </View>
    </View>
  );
}

function Toggle({ p, label, value, disabled, onChange }: { p: Palette; label: string; value: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={[ui.between, { gap: 12, minHeight: 44 }]}>
      <Text style={{ color: p.text, flexShrink: 1 }}>{label}</Text>
      <Switch accessibilityLabel={label} value={value} disabled={disabled} onValueChange={onChange} trackColor={{ false: p.controlBorder, true: p.primary }} thumbColor={p.surface} />
    </View>
  );
}

// A whole number typed in a small box (quantities on the estimate).
function CountBox({ p, label, value, disabled, onChange }: { p: Palette; label: string; value: number; disabled?: boolean; onChange: (v: number) => void }) {
  return (
    <View style={{ gap: 2, width: 76 }}>
      <Text style={{ color: p.muted, fontSize: 11, fontWeight: "600" }}>{label}</Text>
      <TextInput accessibilityLabel={label} editable={!disabled} keyboardType="number-pad" value={String(value)} onChangeText={t => onChange(Number(t.replace(/\D/g, "").slice(0, 5)) || 0)}
        style={{ minHeight: 40, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: p.controlBorder, color: disabled ? p.muted : p.text, backgroundColor: p.background, fontVariant: ["tabular-nums"], fontFamily: "Montserrat_500Medium" }} />
    </View>
  );
}

// Pounds typed as text, kept as pence; a sum that is not money leaves the last good value.
function MoneyField({ p, label, pence, optional, disabled, onChange }: { p: Palette; label: string; pence: number | null; optional?: boolean; disabled?: boolean; onChange: (v: number | null) => void }) {
  const [text, setText] = useState(penceToPounds(pence));
  return (
    <View style={{ gap: 2 }} pointerEvents={disabled ? "none" : "auto"}>
      <Field p={p} label={label} value={text} placeholder={optional ? "Leave empty to use the cost cap" : "0.00"} onChange={t => {
        setText(t);
        if (!t.trim() && optional) onChange(null); else { const v = poundsToPence(t); if (v != null) onChange(v); }
      }} />
      {!!text.trim() && poundsToPence(text) == null && <Text style={[ui.small, { color: p.danger }]}>Enter pounds and pence, for example 12.50</Text>}
    </View>
  );
}

// The property details the quantity rules work from (also the inventory in Launch Preparation, 20261029400000).
export function PropertyDetails({ p, inputs, disabled, onChange }: { p: Palette; inputs: StudioInputs; disabled?: boolean; onChange: (inputs: StudioInputs) => void }) {
  const setInputs = (next: Partial<StudioInputs>) => onChange(normaliseInputs({ ...inputs, ...next }));
  return <>
    <ChoiceField p={p} label="Property type" hideLabel={false} value={inputs.propertyType} options={PROPERTY_TYPES.map(v => ({ value: v, label: PROPERTY_TYPE_LABEL[v] }))} onChange={v => setInputs({ propertyType: v })} />
    {(["property", "beds", "rooms"] as const).map(group => <View key={group} style={{ gap: 8 }}>
      {group !== "property" && <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text, marginTop: 8 }]}>{GROUP_TITLE[group]}</Text>}
      {group === "beds" && <Text style={[ui.small, { color: p.muted }]}>Zip & link linen covers both configurations: three rotations for the primary setup and one for the secondary.</Text>}
      {COUNT_INPUTS.filter(i => i.group === group).map(i => <Stepper key={i.key} p={p} label={i.label} help={i.help} value={inputs[i.key]} min={i.min} max={i.max} disabled={disabled}
        onChange={v => setInputs({ [i.key]: v })} />)}
      {group === "beds" && inputs.zipLinkSetups.map((s, n) => <View key={n} style={{ gap: 4 }}>
        <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Zip & link bed {n + 1}: primary setup</Text>
        <Pills p={p} title={`Zip & link bed ${n + 1} primary setup`} values={ZIP_SETUPS} value={s} label={v => ZIP_SETUP_LABEL[v]}
          onChange={v => setInputs({ zipLinkSetups: inputs.zipLinkSetups.map((x, k) => k === n ? v : x) })} />
      </View>)}
      {group === "rooms" && <>
        <ChoiceField p={p} label="TV setup" hideLabel={false} value={inputs.tv} options={TV_SETUPS.map(v => ({ value: v, label: TV_LABEL[v] }))} onChange={v => setInputs({ tv: v })} />
        <ChoiceField p={p} label="Window coverings" hideLabel={false} value={inputs.windowCovering} options={WINDOW_COVERINGS.map(v => ({ value: v, label: COVERING_LABEL[v] }))} onChange={v => setInputs({ windowCovering: v })} />
      </>}
    </View>)}
    <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text, marginTop: 8 }]}>Appliances & optional</Text>
    <ChoiceField p={p} label="Cooker type" hideLabel={false} value={inputs.cooker} options={COOKERS.map(v => ({ value: v, label: COOKER_LABEL[v] }))} onChange={v => setInputs({ cooker: v })} />
    {OPTION_KEYS.map(k => <Toggle key={k} p={p} label={OPTION_LABEL[k]} value={inputs[k]} disabled={disabled} onChange={v => setInputs({ [k]: v })} />)}
  </>;
}

function ProjectEditor({ p, catalogue, projectId, onBack, onSaved }: { p: Palette; catalogue: CatalogueItem[]; projectId: string | null; onBack: () => void; onSaved: (id: string) => void }) {
  const today = london(new Date());
  const [project, setProject] = useState<Project | null>(null), [form, setForm] = useState<ProjectForm>(() => emptyProjectForm(today));
  const [properties, setProperties] = useState<PropertyChoice[]>([]), [step, setStep] = useState<Step>("details");
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [note, setNote] = useState("");
  const [shopBy, setShopBy] = useState<"supplier" | "room">("supplier");
  const request = useRequestId(`furnishing:${projectId ?? "new"}:${project?.version ?? 0}`);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      readFurnishing(propertiesQuery()).then(r => { if (active) setProperties(propertyChoiceSchema.parse(r.data)); }).catch(() => { /* typed address instead */ });
      if (projectId) readFurnishing(projectQuery(projectId)).then(r => { if (!active) return; const x = projectSchema.parse(r.data); setProject(x); setForm(formFromProject(x)); setDirty(false); })
        .catch(e => { if (active) setError(message(e)); });
    });
    return () => { active = false; };
  }, [projectId]);
  const status: ProjectStatus = project?.status ?? "draft", locked = !editable(status) || !!project?.archived;
  // A draft follows the catalogue as it is now; a sent quote shows the lines it was sent with.
  const lines: EstimateLine[] = useMemo(() => project && !editable(status) ? savedLines(project.lines) : estimateLines(catalogue, form.inputs, form.overrides, form),
    [project, status, catalogue, form]);
  const totals = estimateTotals(lines, form);
  const change = (next: Partial<ProjectForm>) => { setForm(f => ({ ...f, ...next })); setDirty(true); setNote(""); };
  const override = (itemId: string, next: { units?: number; existing?: number }) => change({ overrides: { ...form.overrides, [itemId]: { ...form.overrides[itemId], ...next } } });
  const where = form.propertyId ? (properties.find(x => x.id === form.propertyId)?.name ?? project?.propertyName ?? "") + (form.address ? `, ${form.address}` : "") : form.address;

  async function run(action: string, body: () => Parameters<typeof writeFurnishing>[0], done: string) {
    if (busy) return;
    setBusy(true); setError(""); setNote("");
    try {
      const saved = projectSchema.parse((await writeFurnishing(body())).data);
      request.done(action); setProject(saved); setForm(formFromProject(saved)); setDirty(false); setNote(done);
      if (!projectId) onSaved(saved.id);
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const save = () => {
    const problem = projectFormError(form);
    if (problem) { setError(problem); return; }
    void run("save", () => saveProjectAction(form, lines, request.get("save")), "Draft saved.");
  };
  const move = (to: ProjectStatus) => project && void run("move:" + to, () => ({ action: "moveProject", requestId: request.get("move:" + to), id: project.id, version: project.version, status: to }), `Quote marked ${STATUS_LABEL[to].toLowerCase()}.`);
  const archive = (archived: boolean) => project && void run("archive", () => ({ action: "archiveProject", requestId: request.get("archive"), id: project.id, version: project.version, archived }), archived ? "Archived." : "Restored.");
  async function tick(line: EstimateLine, purchased: boolean, actualPence: number | null) {
    if (!project || !line.lineId || busy) return;
    setBusy(true); setError("");
    try {
      const saved = projectSchema.parse((await writeFurnishing({ action: "tickLine", requestId: crypto.randomUUID(), id: project.id, lineId: line.lineId, purchased, actualPence })).data);
      setProject(saved); setForm(formFromProject(saved));
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const docInput = () => ({ number: project?.number ?? "Draft", status, clientName: form.clientName, clientEmail: form.clientEmail.trim() || null, where, estimateOn: form.estimateOn,
    inputs: form.inputs, markupPercent: form.markupPercent, vat: form.vat, notes: form.notes, lines, totals });
  const download = async (kind: "quote" | "shopping-list") => {
    try { setNote(await openDocument(origin => kind === "quote" ? quoteHtml(docInput(), { origin }) : shoppingListHtml(docInput(), { origin, by: shopBy }), quoteFileName(project?.number ?? "furnishing", kind))); }
    catch (e) { setError(message(e)); }
  };
  const propertyOptions = useMemo(() => properties.map(x => ({ id: x.id, label: x.name, keywords: x.address })), [properties]);
  if (projectId && !project && !error) return <Loading p={p} rows={4} />;

  return (
    <View style={{ gap: space.section }}>
      <MotionPress accessibilityRole="link" accessibilityLabel="Back to all projects" onPress={onBack} style={[ui.row, { gap: 4, alignSelf: "flex-start", minHeight: 44 }]}>
        <Feather name="chevron-left" size={18} color={p.primary} /><Text style={{ color: p.primary, fontWeight: "600" }}>All projects</Text>
      </MotionPress>
      <View style={[ui.between, { gap: 12, flexWrap: "wrap" }]}>
        <View style={{ gap: 2, flexShrink: 1 }}>
          <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>{project ? `${project.clientName} · ${project.number}` : "New project"}</Text>
          {!!where && <Text style={[ui.small, { color: p.muted }]}>{where}</Text>}
        </View>
        <View style={[ui.row, { gap: 6 }]}>
          <Tag p={p} label={STATUS_LABEL[status]} tone={STATUS_TONE[status]} />
          {project?.archived && <Tag p={p} label="Archived" tone="plain" />}
        </View>
      </View>
      <StatGrid showZeros>
        {headerStats(totals).map(s => <StatTile key={s.key} p={p} icon={s.key === "estimate" ? "pie-chart" : s.key === "purchase" ? "shopping-cart" : "link"} label={s.label} value={s.value} detail={s.detail} />)}
      </StatGrid>
      <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
        {!locked && <Button label={busy ? "Saving…" : "Save draft"} icon="save" primary p={p} disabled={busy} onPress={save} />}
        <Button label="Download client quote" icon="download" p={p} onPress={() => void download("quote")} />
        <Button label="Download shopping list" icon="download" p={p} onPress={() => void download("shopping-list")} />
      </View>
      {!!error && <Notice p={p} text={error} tone="bad" />}
      {!!note && <Notice p={p} text={note} />}
      {locked && !project?.archived && <Notice p={p} text="This quote keeps the catalogue prices it was sent with. Reopen it to change quantities or details." />}
      <Pills p={p} title="Choose a step" values={STEPS} value={step} onChange={setStep} label={s => STEP_LABEL[s]} />

      {step === "details" && <View style={{ gap: space.row }}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>{GROUP_TITLE.property}</Text>
        <View pointerEvents={locked ? "none" : "auto"} style={{ gap: space.row }}>
          <Field p={p} label="Client name" value={form.clientName} onChange={v => change({ clientName: v })} placeholder="Who the quote is for" />
          <Field p={p} label="Client email (optional)" email value={form.clientEmail} onChange={v => change({ clientEmail: v })} />
          <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Property in Recharge (optional)</Text>
          <SearchPicker p={p} options={propertyOptions} value={form.propertyId ?? ""} clearable nouns="properties" placeholder="Search properties" empty="No properties yet. Type the address below."
            onChange={id => {
              const chosen = properties.find(x => x.id === id);
              change({ propertyId: id || null, ...(chosen && !form.address.trim() ? { address: chosen.address } : {}),
                ...(chosen && chosen.bedrooms > 0 ? { inputs: normaliseInputs({ ...form.inputs, bedrooms: chosen.bedrooms }) } : {}) });
            }} />
          <Field p={p} label={form.propertyId ? "Address or note" : "Property address or project name"} value={form.address} onChange={v => change({ address: v })} placeholder="For example 14 Example Terrace, Edinburgh" />
          <DateField p={p} label="Estimate date" mode="single" value={{ from: form.estimateOn, to: form.estimateOn }} onChange={v => v.from && change({ estimateOn: v.from })} />
          <PropertyDetails p={p} inputs={form.inputs} disabled={locked} onChange={inputs => change({ inputs })} />
          <Notice p={p} text="Labour starts at the catalogue's one-bedroom cap, plus the amount set per additional bedroom (GBP 250 to start)." />
        </View>
      </View>}

      {step === "catalogue" && <View style={{ gap: space.row }}>
        <Text style={[ui.small, { color: p.muted }]}>What each product's rule gives for this property. Change the products themselves in the Catalogue tab; fine-tune this quote's quantities in the Estimate.</Text>
        {FURNISHING_CATEGORIES.map(c => {
          const rows = lines.filter(l => l.category === c);
          return rows.length ? <Section key={c} title={categoryName(c)} p={p}>
            <List p={p} search={false} empty="">
              {rows.map((l, n) => <Row key={l.itemId} p={p} first={n === 0} title={l.name} detail={[l.rule || l.unit, l.supplier].filter(Boolean).join(" · ")} amount={`${formatCount(l.suggestedUnits)} needed`} />)}
            </List>
          </Section> : null;
        })}
      </View>}

      {step === "estimate" && <View style={{ gap: space.row }}>
        <Text style={[ui.small, { color: p.muted }]}>Change a quantity, or deduct stock already in the property. Retail units to buy are worked out in whole packs.</Text>
        {FURNISHING_CATEGORIES.map(c => {
          const rows = lines.filter(l => l.category === c);
          if (!rows.length) return null;
          return <Section key={c} title={`${categoryName(c)} · ${formatMoney(rows.reduce((t, l) => t + l.costPence, 0))}`} p={p}>
            <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 0, paddingVertical: 4 }]}>
              {rows.map((l, n) => <View key={l.itemId} style={{ gap: 8, paddingVertical: 12, borderTopWidth: n ? 1 : 0, borderColor: p.border }}>
                <View style={[ui.between, { gap: 8 }]}>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text style={{ color: p.text, fontWeight: "700" }}>{l.name}</Text>
                    <Text style={[ui.small, { color: p.muted }]}>{[l.rule, l.unit !== "each" ? l.unit : "", `${formatMoney(l.unitCostPence)} cap each`].filter(Boolean).join(" · ")}</Text>
                  </View>
                  <Text style={{ color: p.text, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{formatMoney(l.costPence)}</Text>
                </View>
                <View style={[ui.row, { gap: 10, flexWrap: "wrap", alignItems: "flex-end" }]}>
                  <CountBox p={p} label="Needed" value={l.units} disabled={locked} onChange={v => override(l.itemId, { units: v })} />
                  <CountBox p={p} label="In stock" value={l.existingUnits} disabled={locked} onChange={v => override(l.itemId, { existing: v })} />
                  <Text style={[ui.small, { color: p.muted, paddingBottom: 10 }]}>{`Buy ${l.packs}${l.packSize > 1 ? ` × ${l.unit}` : ""}${l.units !== l.suggestedUnits ? ` · rule gives ${l.suggestedUnits}` : ""}`}</Text>
                </View>
              </View>)}
            </View>
          </Section>;
        })}
        <Section title="Client quote" p={p}>
          <View pointerEvents={locked ? "none" : "auto"} style={{ gap: space.row }}>
            <Field p={p} label="Markup on prices (%)" value={String(form.markupPercent)} onChange={t => { const v = Number(t.replace(/[^\d.]/g, "")); if (Number.isFinite(v) && v <= 200) change({ markupPercent: Math.round(v * 100) / 100 }); }} />
            <MoneyField key={`fee:${project?.version ?? 0}`} p={p} label="Design and project fee (£)" pence={form.feePence} onChange={v => change({ feePence: v ?? 0 })} />
            <Toggle p={p} label="Add VAT at 20%" value={form.vat} disabled={locked} onChange={v => change({ vat: v })} />
            <Field p={p} label="Notes on the quote (optional)" multiline value={form.notes} onChange={v => change({ notes: v })} />
          </View>
          <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 6 }]}>
            {[["Maximum estimate (cost caps)", totals.estimatePence], ["Furnishings for the client", totals.subtotalPence], ["Fee", totals.feePence], ...(form.vat ? [["VAT", totals.vatPence] as [string, number]] : []), ["Margin before VAT", totals.marginPence]]
              .map(([label, value]) => <View key={label as string} style={ui.between}><Text style={{ color: p.muted }}>{label}</Text><Text style={{ color: p.text, fontVariant: ["tabular-nums"] }}>{formatMoney(value as number)}</Text></View>)}
            <View style={ui.between}><Text style={{ color: p.text, fontWeight: "700" }}>Client total</Text><Text style={{ color: p.primary, fontSize: 20, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{formatMoney(totals.quotePence)}</Text></View>
          </View>
        </Section>
        {project && <Section title="Status" p={p}>
          {dirty && <Text style={[ui.small, { color: p.muted }]}>Save the draft before moving the quote on.</Text>}
          <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
            {!project.archived && NEXT_STATUS[status].map(to => <Button key={to} p={p} label={MOVE_LABEL[to]} primary={to !== "draft" && to !== "declined"} disabled={busy || dirty} onPress={() => move(to)} />)}
            <Button p={p} quiet label={project.archived ? "Restore project" : "Archive project"} disabled={busy || dirty} onPress={() => archive(!project.archived)} />
          </View>
          {!!project.history.length && <View style={{ gap: 2 }}>
            {project.history.slice(-6).reverse().map((h, n) => <Text key={n} style={[ui.small, { color: p.muted }]}>
              {`${new Date(h.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" })} · ${h.action === "moved" && h.toStatus ? `Marked ${STATUS_LABEL[h.toStatus as ProjectStatus]?.toLowerCase() ?? h.toStatus}` : h.action[0].toUpperCase() + h.action.slice(1)}${h.by ? ` by ${h.by}` : ""}`}
            </Text>)}
          </View>}
        </Section>}
      </View>}

      {step === "shopping" && <ShoppingList p={p} lines={lines} status={status} by={shopBy} onBy={setShopBy} busy={busy} onTick={tick} />}
    </View>
  );
}

function ShoppingList({ p, lines, status, by, onBy, busy, onTick }: { p: Palette; lines: EstimateLine[]; status: ProjectStatus; by: "supplier" | "room"; onBy: (v: "supplier" | "room") => void; busy: boolean; onTick: (l: EstimateLine, purchased: boolean, actual: number | null) => void }) {
  const groups = shoppingGroups(lines, by), canTick = status === "accepted" || status === "purchasing", spend = spendSummary(lines);
  return (
    <View style={{ gap: space.row }}>
      <Pills p={p} title="Group the list by" values={["supplier", "room"] as const} value={by} onChange={onBy} label={v => v === "supplier" ? "By supplier" : "By room"} />
      {!buying(status) && <Notice p={p} text="Tick items off here once the client accepts the quote." />}
      {buying(status) && <StatGrid showZeros>
        <StatTile p={p} icon="check-square" label="Bought" value={`${spend.purchased} / ${spend.toBuy}`} detail="Lines ticked off" />
        <StatTile p={p} icon="credit-card" label="Actual spend" value={formatMoneyShort(spend.actualPence)} detail={varianceLine(spend.variancePence, spend.recorded)} />
      </StatGrid>}
      {!groups.length && <Notice p={p} text="Nothing to buy yet." />}
      {groups.map(g => <Section key={g.key} title={`${g.title} · ${formatMoney(g.costPence)}`} count={g.lines.length - g.purchased} p={p}>
        <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 0, paddingVertical: 4 }]}>
          {g.lines.map((l, n) => <ShoppingRow key={l.itemId} p={p} line={l} first={n === 0} by={by} canTick={canTick} busy={busy} onTick={onTick} />)}
        </View>
      </Section>)}
    </View>
  );
}

function ShoppingRow({ p, line: l, first, by, canTick, busy, onTick }: { p: Palette; line: EstimateLine; first: boolean; by: "supplier" | "room"; canTick: boolean; busy: boolean; onTick: (l: EstimateLine, purchased: boolean, actual: number | null) => void }) {
  const [actual, setActual] = useState(penceToPounds(l.actualPence ?? null));
  const actualPence = actual.trim() ? poundsToPence(actual) : null;
  return (
    <View style={{ gap: 8, paddingVertical: 12, borderTopWidth: first ? 0 : 1, borderColor: p.border }}>
      <View style={[ui.row, { gap: 12 }]}>
        <MotionPress accessibilityRole="checkbox" accessibilityLabel={`Bought: ${l.name}`} accessibilityState={{ checked: !!l.purchased, disabled: !canTick || busy }} disabled={!canTick || busy}
          onPress={() => onTick(l, !l.purchased, actualPence)} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
          <Feather name={l.purchased ? "check-square" : "square"} size={22} color={canTick ? p.primary : p.muted} />
        </MotionPress>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={{ color: p.text, fontWeight: "700", textDecorationLine: l.purchased ? "line-through" : "none" }}>{l.name}</Text>
          <Text style={[ui.small, { color: p.muted }]}>{[`Buy ${l.packs}${l.unit !== "each" ? ` × ${l.unit}` : ""}`, by === "supplier" ? categoryName(l.category) : (l.supplier || "No supplier yet"), `${formatMoney(l.unitCostPence)} cap each`, l.purchasedBy ? `ticked by ${l.purchasedBy}` : ""].filter(Boolean).join(" · ")}</Text>
        </View>
        <Text style={{ color: p.text, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{formatMoney(l.costPence)}</Text>
      </View>
      <View style={[ui.row, { gap: 10, flexWrap: "wrap", paddingLeft: 56 }]}>
        {!!l.productUrl && <MotionPress accessibilityRole="link" accessibilityLabel={`Open the product page for ${l.name}`} onPress={() => void Linking.openURL(l.productUrl!)} style={[ui.row, { gap: 4, minHeight: 36 }]}>
          <Feather name="external-link" size={14} color={p.primary} /><Text style={{ color: p.primary, fontWeight: "600" }}>Product link</Text>
        </MotionPress>}
        {!l.productUrl && <Text style={[ui.small, { color: p.muted }]}>No product link yet</Text>}
        {canTick && <View style={[ui.row, { gap: 8, alignItems: "flex-end" }]}>
          <View style={{ width: 120 }}><Field p={p} label="Actual spend (£)" value={actual} onChange={setActual} placeholder="0.00" /></View>
          <Button p={p} label="Save spend" disabled={busy || (!!actual.trim() && actualPence == null) || actualPence === (l.actualPence ?? null)} onPress={() => onTick(l, true, actualPence)} />
        </View>}
      </View>
    </View>
  );
}

// --- Catalogue ------------------------------------------------------------------------------------------------------------
const ALL = "all";
function Catalogue({ p, catalogue, onSaved }: { p: Palette; catalogue: CatalogueItem[]; onSaved: () => Promise<void> }) {
  const [query, setQuery] = useState(""), [room, setRoom] = useState<FurnishingCategory | typeof ALL>(ALL), [show, setShow] = useState<"active" | "inactive">("active");
  const [editing, setEditing] = useState<CatalogueItem | "new" | null>(null);
  const shown = catalogue.filter(i => i.active === (show === "active") && (room === ALL || i.category === room) && matchesSearch([i.name, i.supplier, i.unit, categoryName(i.category)].join(" "), query));
  return (
    <View style={{ gap: space.row }}>
      <Text style={[ui.small, { color: p.muted }]}>The products every quote is built from: what each costs at most (the cap), what the client pays (the retail price, else the cap), where to buy it, and how many a property needs.</Text>
      <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}><Button label="Add product" icon="plus" primary p={p} onPress={() => setEditing("new")} /></View>
      <Pills p={p} title="Show" values={["active", "inactive"] as const} value={show} onChange={setShow} label={v => v === "active" ? "In use" : "Not in use"} />
      <Dropdown p={p} label="Room" value={room} searchable onChange={setRoom} options={[{ value: ALL, label: "All rooms" }, ...FURNISHING_CATEGORIES.map(c => ({ value: c, label: categoryName(c) }))]} />
      <SearchBox p={p} value={query} onChange={setQuery} placeholder="Search products or suppliers" />
      <List p={p} search={false} empty={query.trim() ? "Nothing matches that search." : "No products here."}>
        {shown.map((i, n) => <Row key={i.id} p={p} first={n === 0} title={i.name}
          detail={[categoryName(i.category), i.unit, ruleLine(i.rule), i.stepPence ? `plus ${formatMoney(i.stepPence)} per extra bedroom` : "", i.supplier, i.productUrl ? "link" : "", i.inventory === "required" ? "" : INVENTORY_ROLE_LABEL[i.inventory].toLowerCase()].filter(Boolean).join(" · ")}
          amount={formatMoney(i.costCapPence)} onPress={() => setEditing(i)} />)}
      </List>
      <ItemSheet p={p} item={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await onSaved(); }} />
    </View>
  );
}

function ItemSheet({ p, item, onClose, onSaved }: { p: Palette; item: CatalogueItem | "new" | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const existing = item && item !== "new" ? item : null;
  const [form, setForm] = useState<ItemForm>(emptyItemForm()), [url, setUrl] = useState(""), [per, setPer] = useState("1"), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const request = useRequestId(item ? `furnishing-item:${existing?.id ?? "new"}:${existing?.version ?? 0}` : null);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (!active) return; const f = existing ? itemToForm(existing) : emptyItemForm(); setForm(f); setUrl(f.productUrl ?? ""); setPer(String(f.rule.per)); setError(""); });
    return () => { active = false; };
  }, [existing, item]);
  const set = (next: Partial<ItemForm>) => setForm(f => ({ ...f, ...next }));
  async function save() {
    const perValue = Number(per);
    if (!Number.isFinite(perValue) || perValue < 0 || perValue > 100 || !/^\d{1,3}(\.\d{1,2})?$/.test(per.trim())) { setError("The quantity per can be 0 to 100, up to two decimals."); return; }
    if (form.name.trim().length < 2) { setError("Name the product."); return; }
    setBusy(true); setError("");
    try {
      await writeFurnishing({ action: "saveItem", requestId: request.get("save"), ...(existing ? { id: existing.id, version: existing.version } : {}), ...form, name: form.name.trim(), unit: form.unit.trim(),
        supplier: form.supplier.trim(), productUrl: url.trim() || null, rule: { ...form.rule, per: perValue } });
      request.done("save");
      await onSaved();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={!!item} onClose={onClose} title={existing ? existing.name : "Add a product"} subtitle={existing ? categoryName(existing.category) : "Into the shared catalogue"} icon="sofa">
      {!!item && <View style={{ gap: space.row }}>
        <Field p={p} label="Name" value={form.name} onChange={v => set({ name: v })} />
        <Dropdown p={p} label="Room" value={form.category} searchable onChange={v => set({ category: v })} options={FURNISHING_CATEGORIES.map(c => ({ value: c, label: categoryName(c) }))} />
        <Field p={p} label="One retail unit is (for example each, pair, pack of 6)" value={form.unit} onChange={v => set({ unit: v })} />
        <Field p={p} label="Pieces in one retail unit" value={String(form.packSize)} onChange={t => set({ packSize: Math.min(1000, Math.max(1, Number(t.replace(/\D/g, "")) || 1)) })} />
        <MoneyField key={`cap:${existing?.id ?? "new"}`} p={p} label="Cost cap for one retail unit (£)" pence={form.costCapPence} onChange={v => set({ costCapPence: v ?? 0 })} />
        <MoneyField key={`retail:${existing?.id ?? "new"}`} p={p} label="Retail price for quotes (£, optional)" optional pence={form.retailPricePence} onChange={v => set({ retailPricePence: v })} />
        <Field p={p} label="Supplier" value={form.supplier} onChange={v => set({ supplier: v })} />
        <Field p={p} label="Product link (https://)" value={url} onChange={setUrl} placeholder="https://" />
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Quantity rule</Text>
        <Field p={p} label="Quantity" value={per} onChange={setPer} />
        <Dropdown p={p} label="Per" value={form.rule.basis} searchable onChange={(v: RuleBasis) => set({ rule: { ...form.rule, basis: v } })}
          options={RULE_BASES.map(b => ({ value: b, label: b === "fixed" ? "Per property" : `Per ${BASIS_LABEL[b][0]}` }))} />
        <Dropdown p={p} label="Only when" value={form.rule.when ?? ALL} searchable onChange={(v: RuleWhen | typeof ALL) => set({ rule: { ...form.rule, when: v === ALL ? null : v } })}
          options={[{ value: ALL, label: "Always" }, ...RULE_WHEN.map(w => ({ value: w, label: WHEN_LABEL[w][0].toUpperCase() + WHEN_LABEL[w].slice(1) }))]} />
        <Text style={[ui.small, { color: p.muted }]}>{ruleLine({ ...form.rule, per: Number(per) || 0 })}</Text>
        <MoneyField key={`step:${existing?.id ?? "new"}`} p={p} label="Add for each bedroom after the first (£)" pence={form.stepPence} onChange={v => set({ stepPence: v ?? 0 })} />
        <Toggle p={p} label="In use (offered in new quotes)" value={form.active} onChange={v => set({ active: v })} />
        <ChoiceField p={p} label="On a property's inventory (Launch Preparation)" hideLabel={false} value={form.inventory} options={INVENTORY_ROLES.map(v => ({ value: v, label: INVENTORY_ROLE_LABEL[v] }))} onChange={v => set({ inventory: v })} />
        <Text style={[ui.small, { color: p.muted }]}>Additional items can be removed from a property's inventory; when Recharge sets the property up, the owner accepts or rejects them.</Text>
        {!!existing?.updatedBy && <Text style={[ui.small, { color: p.muted }]}>{`Last changed by ${existing.updatedBy}`}</Text>}
        {!!error && <Notice p={p} text={error} tone="bad" />}
        <Button p={p} primary label={busy ? "Saving…" : "Save product"} disabled={busy} onPress={() => void save()} />
      </View>}
    </Sheet>
  );
}

// --- Analytics ------------------------------------------------------------------------------------------------------------
function Bars({ p, rows }: { p: Palette; rows: { key: string; label: string; value: number; detail: string }[] }) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return (
    <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 14 }]}>
      {rows.map(r => <View key={r.key} accessibilityLabel={`${r.label}, ${r.detail}`} style={{ gap: 4 }}>
        <View style={[ui.between, { gap: 8 }]}>
          <Text style={{ color: p.text, fontSize: 14, fontWeight: "600", flexShrink: 1 }}>{r.label}</Text>
          <Text style={[ui.small, { color: p.muted, fontVariant: ["tabular-nums"] }]}>{r.detail}</Text>
        </View>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: p.wash, overflow: "hidden" }}>
          <View style={{ width: `${Math.round(r.value / max * 100)}%`, height: 8, borderRadius: 4, backgroundColor: p.primary }} />
        </View>
      </View>)}
    </View>
  );
}

// The analytics read for a period, and the same read for the period before (for the comparison).
const readAnalytics = async (r: { from: string; to: string }) => analyticsSchema.parse((await readFurnishing(analyticsQuery(r.from, r.to))).data);
function Analytics({ p }: { p: Palette }) {
  // The last 12 months to start, quotes dated in the period, compared with the 12 months before.
  const period = usePeriod(STANDARD_PERIODS, "12m", london(new Date()));
  const { now: data, before, loading, error } = usePeriodData(readAnalytics, period);
  const model = useMemo(() => (data ? furnishingModel(data, before, period.against, monthName, s => STATUS_LABEL[s as keyof typeof STATUS_LABEL] ?? s) : null), [data, before, period.against]);
  return (
    <View style={{ gap: space.section }}>
      <AnalyticsPanel p={p} model={model} loading={loading} error={error} controls={<PeriodBar p={p} period={period} />} caption={`Quotes dated ${period.label}, ${period.against}.`} />
      {data && <>
        <StatGrid showZeros>
          <StatTile p={p} icon="home" label="Per bedroom" value={data.averagePerBedroomPence != null ? formatMoneyShort(data.averagePerBedroomPence) : "–"} detail="Average quote per bedroom" />
          <StatTile p={p} icon="trending-up" label="Spend variance" value={data.spend.recordedLines ? formatMoneyShort(data.spend.variancePence) : "–"}
            detail={data.spend.recordedLines ? `Actual ${formatMoney(data.spend.actualPence)} against ${formatMoney(data.spend.estimatePence)} estimated` : "No actual spend recorded yet"} />
        </StatGrid>
        <Section title="Quotes by status" p={p}>
          <Bars p={p} rows={data.byStatus.map(s => ({ key: s.status, label: STATUS_LABEL[s.status], value: s.projects, detail: `${formatCount(s.projects)} · ${formatMoney(s.quotePence)}` }))} />
        </Section>
        {data.byMonth.length > 1 && <Section title="Quotes per month" p={p}>
          <List p={p} search={false} empty="">
            {[...data.byMonth].reverse().map((m, n) => <Row key={m.month} p={p} first={n === 0} title={monthName(m.month)} detail={`${formatCount(m.projects)} projects · ${formatCount(m.sent)} sent · ${formatCount(m.accepted)} accepted`} amount={formatMoney(m.quotedPence)} />)}
          </List>
        </Section>}
        <Section title="Estimated against actual spend" p={p}>
          <Notice p={p} text={data.spend.recordedLines ? `${varianceLine(data.spend.variancePence, data.spend.recordedLines)} ${data.spend.variancePercent != null ? `(${data.spend.variancePercent > 0 ? "+" : ""}${data.spend.variancePercent}%)` : ""} ${formatCount(data.spend.purchasedLines)} lines bought on accepted quotes.` : "Record the actual spend on the shopping list as items are bought to compare it with the estimate."} />
        </Section>
        <Section title="Top items by quantity" p={p}>
          <List p={p} search={false} empty="No accepted quotes in these dates.">
            {data.topByUnits.map((x, n) => <Row key={x.itemId} p={p} first={n === 0} title={x.name} detail={categoryName(x.category)} amount={`${formatCount(x.packs)} units`} />)}
          </List>
        </Section>
        <Section title="Top items by spend" p={p}>
          <List p={p} search={false} empty="No accepted quotes in these dates.">
            {data.topBySpend.map((x, n) => <Row key={x.itemId} p={p} first={n === 0} title={x.name} detail={`${categoryName(x.category)} · ${formatCount(x.packs)} units`} amount={formatMoney(x.spendPence)} />)}
          </List>
        </Section>
      </>}
    </View>
  );
}
