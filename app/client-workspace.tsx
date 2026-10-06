"use client";


import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, LoaderCircle, Plus, WalletCards } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { HostawayReservation } from "@/lib/hostaway-types";
import type { OnboardingCase, OnboardingStatus } from "@/lib/onboarding-types";
import type { ManagementProperty, PropertyDatabaseData } from "@/lib/property-database";
import type { OperationsData, WeeklyReport } from "@/lib/operations";
import { ClientPropertyOnboarding, OnboardingJourneyButton } from "@/app/onboarding-centre";

const stages: Array<{ status: OnboardingStatus; label: string }> = [
  { status: "enquiry_received", label: "Estimate in progress" },
  { status: "estimate_received", label: "Estimate ready for review" },
  { status: "agreement_pending", label: "Management agreement ready to sign" },
  { status: "onboarding_form", label: "Onboarding form to complete" },
  { status: "inspection_booked", label: "Property inspection" },
  { status: "purchase_order_review", label: "Review requirements" },
  { status: "furnishing", label: "Property preparation" },
  { status: "guest_ready", label: "Guest-ready checks" },
  { status: "listings_in_progress", label: "Listings prepared" },
  { status: "live", label: "Live" },
];

export function ClientWorkspace({ propertyData, onboardingCases, initialTool, onBack }: { propertyData?: PropertyDatabaseData; onboardingCases: OnboardingCase[]; initialTool: "properties" | "calendar"; onBack: () => void }) {
  const storedProperties = (propertyData?.properties || []).filter((property) => property.status !== "archived");
  const tool = initialTool;
  const [selectedId, setSelectedId] = useState(storedProperties[0]?.id || "");
  const [reservations, setReservations] = useState<Record<string, HostawayReservation[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [visibleIds, setVisibleIds] = useState<string[]>(storedProperties.map((property) => property.id));
  const [propertySearch, setPropertySearch] = useState("");
  const [onboardingRecords, setOnboardingRecords] = useState(onboardingCases);
  const properties = useMemo(() => {
    const existing = new Set(storedProperties.flatMap((property) => [normalise(property.propertyName), normalise(property.propertyAddress)]).filter(Boolean));
    const enquiries = onboardingRecords.filter((item) => item.status !== "not_proceeding" && ![normalise(item.propertyName), normalise(item.propertyAddress)].some((key) => key && existing.has(key))).map(propertyFromOnboarding);
    return [...enquiries, ...storedProperties];
  }, [onboardingRecords, propertyData?.properties]);
  const [weeklyReports, setWeeklyReports] = useState<WeeklyReport[]>([]);
  const updateOnboardingRecord = useCallback((updated: OnboardingCase) => {
    setOnboardingRecords((current) => current.map((item) => item.id === updated.id ? updated : item));
  }, []);
  const selected = properties.find((property) => property.id === selectedId) || properties[0];
  const filteredProperties = properties.filter((property) => `${property.propertyName} ${property.propertyAddress}`.toLowerCase().includes(propertySearch.trim().toLowerCase()));

  async function loadReservations(property: ManagementProperty) {
    if (reservations[property.id] || loading[property.id] || !property.hostawayListingIds.length && !property.hostawayListingId) return;
    setLoading((current) => ({ ...current, [property.id]: true }));
    const response = await fetch(`/api/client-reservations?propertyId=${encodeURIComponent(property.id)}`);
    const result = await response.json().catch(() => null) as { reservations?: HostawayReservation[]; error?: string } | null;
    setLoading((current) => ({ ...current, [property.id]: false }));
    if (!response.ok || !result?.reservations) {
      setErrors((current) => ({ ...current, [property.id]: result?.error || "Performance data is temporarily unavailable." }));
      return;
    }
    setReservations((current) => ({ ...current, [property.id]: result.reservations || [] }));
  }

  useEffect(() => { if (selected) void loadReservations(selected); }, [selected?.id]);
  useEffect(() => { if (tool === "calendar") properties.filter((property) => visibleIds.includes(property.id)).forEach((property) => void loadReservations(property)); }, [tool, visibleIds.join("|")]);
  useEffect(() => { if (tool !== "properties") return; void fetch("/api/operations", { cache: "no-store" }).then(async (response) => await response.json() as OperationsData).then((result: OperationsData) => setWeeklyReports(result.reports || [])).catch(() => undefined); }, [tool]);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const response = await fetch("/api/onboarding", { cache: "no-store" }).catch(() => null);
      if (!active || !response?.ok) return;
      const result = await response.json().catch(() => null) as { data?: { cases?: OnboardingCase[] } } | null;
      if (result?.data?.cases) setOnboardingRecords(result.data.cases);
    };
    const timer = window.setInterval(refresh, 4_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  return (
    <div>
      <Button variant="ghost" className="-ml-3 mb-5 text-[var(--muted-foreground)]" onClick={onBack}><ArrowLeft /> Back to Clients</Button>
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Client portfolio</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">{tool === "properties" ? "My Properties" : "My Calendar"}</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--muted-foreground)]">{tool === "properties" ? "Your managed and onboarding properties, progress and performance." : "Your Hostaway booking calendar across the properties you choose."}</p>
        </div>
        {tool === "properties" ? <NewEnquiryDialog onCreated={(records, id) => { setOnboardingRecords(records); setSelectedId(`onboarding:${id}`); }} /> : <Badge variant="outline" className="h-fit border-[var(--border)] bg-white px-3 py-1.5 text-[var(--muted-foreground)]">{properties.length} {properties.length === 1 ? "property" : "properties"}</Badge>}
      </div>

      <Tabs value={tool} className="mt-7">
        <TabsContent value="properties" className="mt-6">
          {selected ? (
            <div className="mt-5 grid gap-5 xl:grid-cols-[19rem_minmax(0,1fr)]">
              <aside className="overflow-hidden rounded-[1.5rem] border border-[var(--border)] bg-white">
                <div className="border-b border-[var(--border)] p-3"><Label htmlFor="property-search" className="sr-only">Search properties</Label><Input id="property-search" type="search" value={propertySearch} onChange={(event) => setPropertySearch(event.target.value)} placeholder="Search properties…" /></div>
                {filteredProperties.map((property) => { const onboarding = findOnboarding(property, onboardingRecords); return <button key={property.id} onClick={() => setSelectedId(property.id)} className={`w-full border-b border-[var(--border)] px-5 py-4 text-left last:border-0 ${selected.id === property.id ? "bg-[var(--muted)]" : "hover:bg-[var(--card)]"}`}><p className="font-semibold">{property.propertyName}</p><div className="mt-2 flex items-center justify-between gap-3"><p className="truncate text-xs text-[var(--muted-foreground)]">{property.propertyAddress || "Address being confirmed"}</p><ClientStatus property={property} onboarding={onboarding} /></div></button>; })}
                {!filteredProperties.length && <p className="px-5 py-8 text-center text-sm text-[var(--muted-foreground)]">No matching properties</p>}
              </aside>
              <PropertyView property={selected} onboarding={findOnboarding(selected, onboardingRecords)} reservations={reservations[selected.id] || []} reports={weeklyReports.filter((report) => report.propertyId === selected.id || normalise(report.propertyName) === normalise(selected.propertyName))} loading={Boolean(loading[selected.id])} error={errors[selected.id]} onOnboardingUpdated={updateOnboardingRecord} />
            </div>
          ) : <EmptyPortfolio />}
        </TabsContent>
        <TabsContent value="calendar" className="mt-6"><HostawayCalendar properties={properties} visibleIds={visibleIds} setVisibleIds={setVisibleIds} reservations={reservations} loading={loading} /></TabsContent>
      </Tabs>
    </div>
  );
}

function NewEnquiryDialog({ onCreated }: { onCreated: (records: OnboardingCase[], id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/onboarding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create_enquiry", propertyAddress: form.get("propertyAddress"), propertyType: form.get("propertyType"), bedrooms: Number(form.get("bedrooms")), bathrooms: Number(form.get("bathrooms")) }) });
    const result = await response.json().catch(() => null) as { id?: string; error?: string; data?: { cases?: OnboardingCase[] } } | null;
    if (!response.ok || !result?.id) { setMessage(result?.error || "Your enquiry could not be submitted."); setSaving(false); return; }
    const files = form.getAll("media").filter((value): value is File => value instanceof File && value.size > 0);
    for (const file of files) { const upload = new FormData(); upload.set("onboardingId", result.id); upload.set("kind", "enquiry_media"); upload.set("roomLabel", ""); upload.set("file", file); await fetch("/api/onboarding/files", { method: "POST", body: upload }); }
    if (result.data?.cases) onCreated(result.data.cases, result.id);
    setSaving(false); setSubmitted(true);
  }
  return <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) setSubmitted(false); }}><DialogTrigger asChild><Button className="h-11 bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)]"><Plus /> New enquiry</Button></DialogTrigger><DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl border-[var(--border)] p-0 sm:max-w-2xl">{submitted ? <div className="p-8 text-center"><div className="mx-auto grid size-14 place-items-center rounded-full bg-[var(--muted)] text-[var(--muted-foreground)]"><CheckCircle2 /></div><DialogTitle className="mt-5 text-2xl">Estimate request submitted</DialogTitle><DialogDescription className="mx-auto mt-3 max-w-md leading-6">Your performance estimate request has been submitted. A member of the Recharge team will send your estimate within 48 hours.</DialogDescription><Button className="mt-6 bg-[var(--primary)] text-[var(--primary-foreground)]" onClick={() => setOpen(false)}>Done</Button></div> : <form onSubmit={submit}><DialogHeader className="border-b border-[var(--border)] px-6 py-6 text-left"><DialogTitle className="text-2xl">Request a performance estimate</DialogTitle><DialogDescription>Tell us about the property. Recharge aims to deliver your estimate within 48 hours.</DialogDescription></DialogHeader><div className="space-y-5 px-6 py-6"><Field label="Property address"><Textarea name="propertyAddress" rows={3} required placeholder="Full property address including postcode" /></Field><div className="grid gap-4 sm:grid-cols-3"><Field label="Property type"><Select name="propertyType" required><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent><SelectItem value="Flat">Flat</SelectItem><SelectItem value="House">House</SelectItem><SelectItem value="Cottage">Cottage</SelectItem><SelectItem value="Apartment">Apartment</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent></Select></Field><Field label="Bedrooms"><Input name="bedrooms" type="number" min="0" max="40" required /></Field><Field label="Bathrooms"><Input name="bathrooms" type="number" min="0" max="40" required /></Field></div><Field label="Photos and videos (optional)"><Input name="media" type="file" accept="image/*,video/*" multiple /></Field>{message && <p className="rounded-xl bg-[var(--rc-danger-bg)] p-3 text-sm text-[var(--rc-danger-text)]">{message}</p>}</div><DialogFooter className="border-t border-[var(--border)] px-6 py-5"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={saving} className="bg-[var(--primary)] text-[var(--primary-foreground)]">{saving ? "Submitting…" : "Submit enquiry"}</Button></DialogFooter></form>}</DialogContent></Dialog>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }

function PropertyView({ property, onboarding, reservations, reports, loading, error, onOnboardingUpdated }: { property: ManagementProperty; onboarding?: OnboardingCase; reservations: HostawayReservation[]; reports: WeeklyReport[]; loading: boolean; error?: string; onOnboardingUpdated: (caseItem: OnboardingCase) => void }) {
  const [period, setPeriod] = useState<"week" | "month" | "year">("week");
  const [periodValue, setPeriodValue] = useState(currentWeek());
  const range = performanceRange(period, periodValue);
  const metrics = performance(reservations, property, range.start, range.end);
  const periodOptions = performancePeriodOptions(period);
  function changePeriod(next: "week" | "month" | "year") { setPeriod(next); setPeriodValue(next === "week" ? currentWeek() : next === "month" ? currentMonth() : String(new Date().getFullYear())); }
  return <div className="space-y-5">
    <section className="rounded-[1.7rem] border border-[var(--border)] bg-white p-5 sm:p-7"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><ClientStatus property={property} onboarding={onboarding} /><h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">{property.propertyName}</h2><p className="mt-2 text-sm text-[var(--muted-foreground)]">{property.propertyAddress}</p></div><div className="rounded-2xl bg-[var(--muted)] px-4 py-3 text-sm"><span className="text-[var(--muted-foreground)]">Current stage</span><p className="mt-1 font-semibold">{clientStatusLabel(property, onboarding)}</p></div></div></section>
    <OnboardingProgress property={property} onboarding={onboarding} />
    {property.status !== "live" && onboarding && <ClientPropertyOnboarding caseItem={onboarding} onUpdated={onOnboardingUpdated} />}
    <section className="rounded-[1.7rem] border border-[var(--border)] bg-white p-5 sm:p-7"><div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end"><div><p className="eyebrow">Performance</p><h3 className="mt-2 text-2xl font-semibold">Booking performance</h3></div><div className="flex flex-col gap-3 sm:flex-row sm:items-end"><Tabs value={period} onValueChange={(value) => changePeriod(value as "week" | "month" | "year")}><TabsList className="grid grid-cols-3 bg-[var(--muted)]"><TabsTrigger value="week">Week</TabsTrigger><TabsTrigger value="month">Month</TabsTrigger><TabsTrigger value="year">Year</TabsTrigger></TabsList></Tabs><div><Label>Select {period}</Label><Select value={periodValue} onValueChange={setPeriodValue}><SelectTrigger aria-label={`Select performance ${period}`} className="mt-2 w-full sm:w-64"><SelectValue /></SelectTrigger><SelectContent className="max-h-80">{periodOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div></div></div>
      {loading ? <div className="grid min-h-52 place-items-center"><LoaderCircle className="animate-spin text-[var(--muted-foreground)]" /></div> : error ? <p className="mt-5 rounded-xl bg-[var(--muted)] p-4 text-sm text-[var(--rc-danger-text)]">{error}</p> : <><div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Nightly rate" value={money(metrics.nightlyRate)} /><Metric label="Occupancy" value={`${metrics.occupancy.toFixed(0)}%`} /><Metric label="Gross revenue" value={money(metrics.gross)} help="The total accommodation revenue paid by guests for this selected week." /><Metric label="Net revenue" value={money(metrics.net)} help="Revenue after Airbnb, Booking.com, VRBO or direct payment-processing fees and estimated cleaning costs." accent /></div><div className="mt-6 grid gap-5 lg:grid-cols-[1fr_18rem]"><div className="space-y-5"><div className="property-health"><div className="flex justify-between gap-4"><p className="text-sm font-medium">{property.propertyName}</p><p className="text-sm font-semibold tabular-nums">Occupied {metrics.occupancy.toFixed(0)}%</p></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--rc-elevated)]"><div style={{width:`${metrics.occupancy}%`}} className="h-full rounded-full bg-[var(--rc-primary)]" /></div><p className="mt-2 text-xs text-[var(--muted-foreground)]">Recorded booked nights in the selected week</p></div><ChannelMix channels={metrics.channels} /></div><div className="rounded-2xl bg-[var(--muted)] p-5"><p className="text-sm font-semibold">Deductions</p><div className="mt-4 space-y-3 text-sm"><Line label="OTA/payment fees" value={money(metrics.otaCosts)} /><Line label={`Cleaning · ${metrics.changeovers} changeovers`} value={money(metrics.cleaningCosts)} /><Line label="Owner net revenue" value={money(metrics.net)} strong /></div></div></div></>}
    </section>
    {reports.length > 0 && <section className="rounded-[1.7rem] border border-[var(--border)] bg-white p-5 sm:p-7"><p className="eyebrow">Pricing updates</p><h3 className="mt-2 text-2xl font-semibold">Weekly performance reports</h3><div className="mt-5 space-y-3">{reports.slice(0, 8).map((report) => <article key={report.id} className="rounded-2xl bg-[var(--muted)] p-4"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><p className="font-semibold">Week of {formatBookingDate(report.weekStart)}</p><p className="mt-1 text-sm text-[var(--muted-foreground)]">{report.summary}</p></div><div className="text-left sm:text-right"><p className="text-xs uppercase tracking-[0.08em] text-[var(--muted-foreground)]">Next 14 days</p><p className="mt-1 text-xl font-semibold">{money(report.revenue14dPence)}</p></div></div><div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-[var(--muted-foreground)]"><span className="rounded-full bg-white px-3 py-1">{report.priceChanges.length} pricing decisions</span><span className="rounded-full bg-white px-3 py-1">{report.calendarItems.length} local signals</span>{report.calendarItems.some((item) => item.isNew) && <span className="rounded-full bg-[#315f50] px-3 py-1 text-[var(--foreground)]">New events/work</span>}</div></article>)}</div></section>}
  </div>;
}

function OnboardingProgress({ property, onboarding }: { property: ManagementProperty; onboarding?: OnboardingCase }) {
  if (property.status === "live") return <section className="rounded-[1.5rem] border border-[var(--border)] bg-[var(--card)] p-5"><div className="flex items-center gap-3"><CheckCircle2 className="text-[var(--muted-foreground)]" /><div><p className="font-semibold">This property is live</p><p className="mt-1 text-sm text-[var(--muted-foreground)]">Bookings and performance now update from Hostaway.</p></div></div></section>;
  const index = onboarding ? clientStageIndex(onboarding.status) : 0;
  const next = clientAction(onboarding?.status);
  return <section className="rounded-[1.7rem] border border-[var(--border)] bg-white p-5 sm:p-7"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Onboarding</p><h3 className="mt-2 text-2xl font-semibold">{statusLabel(onboarding?.status)}</h3></div><span className="text-sm font-semibold text-[var(--muted-foreground)]">{Math.round((index + 1) / stages.length * 100)}%</span></div>{onboarding ? <OnboardingJourneyButton caseItem={onboarding} /> : <Progress value={(index + 1) / stages.length * 100} className="mt-5 h-2 bg-[var(--muted)] [&_[data-slot=progress-indicator]]:bg-[#315f50]" />}<div className="mt-6 rounded-2xl bg-[var(--muted)] p-5"><div className="flex gap-3"><CircleAlert className="mt-0.5 size-5 shrink-0 text-[var(--muted-foreground)]" /><div><p className="font-semibold">Your next step</p><p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">{next}</p></div></div></div><div className="mt-5 grid gap-2 sm:grid-cols-2">{stages.slice(0, Math.max(2, index + 2)).map((stage, stageIndex) => <div key={stage.status} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${stageIndex <= index ? "bg-[var(--muted)] text-[var(--muted-foreground)]" : "bg-[var(--muted)] text-[var(--muted-foreground)]"}`}>{stageIndex <= index ? <CheckCircle2 className="size-4" /> : <span className="size-4 rounded-full border border-[var(--border)]" />}{stage.label}</div>)}</div></section>;
}

function propertyFromOnboarding(item: OnboardingCase): ManagementProperty {
  return { id: `onboarding:${item.id}`, hostawayListingId: null, hostawayListingIds: [], clickupTaskId: null, clickupUrl: "", sourceStatus: item.status, sourcePriority: "", sourceDueAt: "", sourceCreatedAt: "", sourceUpdatedAt: "", propertyName: item.propertyName || item.propertyAddress.split(",")[0] || "New property", propertyAddress: item.propertyAddress, region: "", propertyType: item.propertyType, bedrooms: String(item.bedrooms), beds: "", bathrooms: String(item.bathrooms), wcCount: "", parking: "", garden: item.hasGarden ? "Yes" : "", ownerName: item.clientName, ownerCompany: item.businessName, ownerEmail: item.clientEmail, ownerPhone: "", correspondenceAddress: "", existingClient: "Yes", accessCode: "", accessInfo: item.accessInfo, guidebookUrl: item.guidebookUrl, listingLinks: [], payoutSchedule: "", managementFeePercent: 15, cleaningCostPence: 0, payoutNotes: "", currentlyOperating: "", furnishingPreference: item.furnishingChoice, licensingPreference: "", startPreference: "", enquiryReason: "", additionalNotes: "", sourceDescription: "", sourceCustomFields: {}, sourceChecklists: [], sourceComments: [], sourceAttachments: [], sourceLinkedTaskIds: [], sourceRecords: [], clickupImportedAt: null, status: item.status === "live" ? "live" : "onboarding", lastSyncedAt: null, updatedAt: item.updatedAt };
}

function HostawayCalendar({ properties, visibleIds, setVisibleIds, reservations, loading }: { properties: ManagementProperty[]; visibleIds: string[]; setVisibleIds: (ids: string[]) => void; reservations: Record<string, HostawayReservation[]>; loading: Record<string, boolean> }) {
  const [mode, setMode] = useState<"multi" | "single">("multi");
  const [start, setStart] = useState(() => startOfDay(new Date()));
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedId, setSelectedId] = useState(properties[0]?.id || "");
  const [selectedReservation, setSelectedReservation] = useState<{ reservation: HostawayReservation; property: ManagementProperty } | null>(null);
  const shown = properties.filter((property) => visibleIds.includes(property.id));
  const timelineDays = Array.from({ length: 14 }, (_, index) => addDays(start, index));
  const selected = properties.find((property) => property.id === selectedId) || properties[0];
  const busy = Object.values(loading).some(Boolean);
  return <section className="overflow-hidden rounded-[1.7rem] border border-[var(--border)] bg-white">
    <div className="flex flex-col justify-between gap-4 border-b border-[var(--border)] p-5 lg:flex-row lg:items-center"><div><p className="eyebrow">Hostaway calendar</p><h2 className="mt-1 text-2xl font-semibold">Reservations and revenue</h2></div><Tabs value={mode} onValueChange={(value) => setMode(value as "multi" | "single")}><TabsList className="grid grid-cols-2 bg-[var(--muted)]"><TabsTrigger value="multi">Multi-property</TabsTrigger><TabsTrigger value="single">Single property</TabsTrigger></TabsList></Tabs></div>
    <div className="flex flex-wrap gap-3 border-b border-[var(--border)] px-5 py-3 text-xs font-semibold">{(["Airbnb","Booking.com","VRBO","Direct"] as const).map((name) => <span key={name} className="flex items-center gap-2"><span className="size-3 rounded-full" style={{backgroundColor:CHANNEL_COLOURS[name]}} />{name === "Direct" ? "Direct · Recharge" : name}</span>)}</div>
    {mode === "multi" ? <>
      <div className="flex flex-col justify-between gap-4 border-b border-[var(--border)] p-4 sm:flex-row sm:items-center"><div className="flex items-center gap-2"><Button variant="outline" size="icon" onClick={() => setStart(addDays(start,-14))}><ArrowLeft /></Button><Button variant="outline" onClick={() => setStart(startOfDay(new Date()))}>Today</Button><Button variant="outline" size="icon" onClick={() => setStart(addDays(start,14))}><ArrowRight /></Button></div><p className="font-semibold">{formatShortDate(start)} – {formatShortDate(addDays(start,13))}</p></div>
      <div className="overflow-auto"><div className="min-w-[88rem]"><div className="grid grid-cols-[18rem_minmax(0,1fr)] border-b border-[var(--border)]"><div className="sticky left-0 z-20 bg-[var(--muted)] p-4 text-sm font-semibold">Properties</div><div className="grid grid-cols-14 bg-[var(--muted)]">{timelineDays.map((day) => <div key={day.toISOString()} className="border-l border-[var(--border)] px-1 py-3 text-center text-xs"><span className="block text-[var(--muted-foreground)]">{day.toLocaleDateString("en-GB",{weekday:"short"})}</span><strong>{day.getDate()}</strong></div>)}</div></div>
        {properties.map((property) => { const active = (reservations[property.id] || []).filter((reservation) => !/cancel/i.test(reservation.status) && overlaps(reservation,start,addDays(start,14))); const rowHeight = Math.max(76, 14 + active.length * 52); return <div key={property.id} className="grid grid-cols-[18rem_minmax(0,1fr)] border-b border-[var(--border)]" style={{minHeight:rowHeight}}><div className="sticky left-0 z-20 flex gap-3 bg-white p-4"><Checkbox checked={visibleIds.includes(property.id)} onCheckedChange={(checked) => setVisibleIds(checked ? Array.from(new Set([...visibleIds,property.id])) : visibleIds.filter((id) => id !== property.id))} /><div><p className="text-sm font-semibold">{property.propertyName}</p><p className="mt-1 line-clamp-2 text-xs text-[var(--muted-foreground)]">{property.propertyAddress}</p></div></div><div className="relative overflow-hidden"><div className="absolute inset-0 grid grid-cols-14">{timelineDays.map((day) => <div key={day.toISOString()} className="border-l border-[var(--border)]" />)}</div>{visibleIds.includes(property.id) && active.map((reservation,index) => { const arrival=parseDate(reservation.arrivalDate), departure=parseDate(reservation.departureDate); const left=Math.max(0,dayDistance(start,arrival)); const end=Math.min(14,dayDistance(start,departure)); const name=channel(reservation.channelName); return <button type="button" onClick={() => setSelectedReservation({ reservation, property })} key={reservation.id} className="absolute z-10 h-11 overflow-hidden rounded-lg px-3 py-1.5 text-left text-xs shadow-sm transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2" style={{left:`${left/14*100}%`,width:`${Math.max(1,end-left)/14*100}%`,top:7+index*52,backgroundColor:CHANNEL_COLOURS[name],color:channelText(name)}} title={`Open reservation for ${reservation.guestName}`}><strong className="block truncate">{reservation.guestName} · {reservation.guestCount} guest{reservation.guestCount === 1 ? "" : "s"}</strong><span className="block truncate opacity-90">Gross {money(reservation.grossRevenuePence)} · Owner net {money(bookingFinancials(reservation, property).ownerNet)}</span></button>; })}</div></div>; })}</div></div>
    </> : <SinglePropertyMonth properties={properties} selected={selected} selectedId={selectedId} setSelectedId={setSelectedId} reservations={selected ? reservations[selected.id] || [] : []} month={month} setMonth={setMonth} onSelectReservation={(reservation) => { if (selected) setSelectedReservation({ reservation, property: selected }); }} />}
    {busy && <div className="flex items-center gap-2 border-t p-4 text-sm text-[var(--muted-foreground)]"><LoaderCircle className="size-4 animate-spin" /> Updating Hostaway bookings…</div>}
    <ReservationDetails reservation={selectedReservation} onClose={() => setSelectedReservation(null)} />
  </section>;
}

function SinglePropertyMonth({ properties, selected, selectedId, setSelectedId, reservations, month, setMonth, onSelectReservation }: { properties: ManagementProperty[]; selected?: ManagementProperty; selectedId: string; setSelectedId: (id:string)=>void; reservations: HostawayReservation[]; month: Date; setMonth: (date:Date)=>void; onSelectReservation: (reservation:HostawayReservation)=>void }) {
  const days=calendarDays(month);
  return <><div className="flex flex-col justify-between gap-4 border-b border-[var(--border)] p-4 lg:flex-row lg:items-center"><div className="flex items-center gap-2"><Button variant="outline" size="icon" onClick={() => setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}><ArrowLeft /></Button><Button variant="outline" onClick={() => setMonth(new Date(new Date().getFullYear(),new Date().getMonth(),1))}>Today</Button><Button variant="outline" size="icon" onClick={() => setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}><ArrowRight /></Button><strong className="ml-2">{month.toLocaleDateString("en-GB",{month:"long",year:"numeric"})}</strong></div><Select value={selected?.id || selectedId} onValueChange={setSelectedId}><SelectTrigger className="w-full lg:w-80"><SelectValue placeholder="Select property" /></SelectTrigger><SelectContent>{properties.map((property) => <SelectItem key={property.id} value={property.id}>{property.propertyName}</SelectItem>)}</SelectContent></Select></div><div className="overflow-auto"><div className="min-w-[70rem]"><div className="grid grid-cols-7 border-b border-[var(--border)] bg-[var(--muted)] text-center text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">{["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((day)=><div key={day} className="py-3">{day}</div>)}</div><div className="grid grid-cols-7">{days.map((day)=>{const bookings=reservations.filter((reservation)=>!/cancel/i.test(reservation.status)&&isDateWithin(day,reservation.arrivalDate,reservation.departureDate));return <div key={day.toISOString()} className={`min-h-36 border-r border-b border-[var(--border)] p-2 ${day.getMonth()===month.getMonth()?"":"bg-[var(--card)] text-[var(--muted-foreground)]"}`}><p className="text-sm font-semibold">{day.getDate()}</p><div className="mt-2 space-y-1.5">{bookings.map((reservation)=>{const name=channel(reservation.channelName);return <button type="button" onClick={() => onSelectReservation(reservation)} key={reservation.id} className="block w-full rounded-lg p-2 text-left text-xs transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2" style={{backgroundColor:CHANNEL_COLOURS[name],color:channelText(name)}} title={`Open reservation for ${reservation.guestName}`}><strong className="block truncate">{reservation.guestName} · {reservation.guestCount} guest{reservation.guestCount===1?"":"s"}</strong><span className="mt-1 block">Gross {money(reservation.grossRevenuePence)}</span><span className="block opacity-90">Owner net {money(selected ? bookingFinancials(reservation, selected).ownerNet : netAfterOta(reservation))}</span></button>;})}</div></div>;})}</div></div></div></>;
}

function ReservationDetails({ reservation, onClose }: { reservation: { reservation: HostawayReservation; property: ManagementProperty } | null; onClose: () => void }) {
  if (!reservation) return null;
  const booking = reservation.reservation;
  const property = reservation.property;
  const bookingChannel=channel(booking.channelName), nights=Math.max(1,dayDistance(parseDate(booking.arrivalDate),parseDate(booking.departureDate)));
  const finances = bookingFinancials(booking, property);
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl border-[var(--border)] sm:max-w-xl"><DialogHeader><div className="mb-2 flex items-center gap-2"><span className="size-3 rounded-full" style={{backgroundColor:CHANNEL_COLOURS[bookingChannel]}} /><span className="text-sm font-semibold">{bookingChannel === "Direct" ? "Direct · Recharge" : bookingChannel}</span></div><DialogTitle className="text-2xl">{booking.guestName}</DialogTitle><DialogDescription>{property.propertyName} · {formatBookingDate(booking.arrivalDate)} – {formatBookingDate(booking.departureDate)}</DialogDescription></DialogHeader><div className="grid grid-cols-2 gap-3 py-3"><ReservationMetric label="Number of nights" value={String(nights)} /><ReservationMetric label="Number of guests" value={String(booking.guestCount)} /><ReservationMetric label="Gross revenue" value={money(booking.grossRevenuePence)} /><ReservationMetric label="Owner net revenue" value={money(finances.ownerNet)} accent /></div><div className="rounded-2xl bg-[var(--muted)] p-4 text-sm"><Line label="Guest-paid gross revenue" value={money(booking.grossRevenuePence)} /><div className="mt-3"><Line label={`${bookingChannel === "Direct" ? "Payment processing" : `${bookingChannel} OTA`} fee`} value={`−${money(finances.otaFee)}`} /></div><div className="mt-3"><Line label="Cleaning cost" value={`−${money(finances.cleaningCost)}`} /></div><div className="mt-3"><Line label="Revenue after channel and cleaning costs" value={money(finances.managementBasis)} /></div><div className="mt-3"><Line label={`Management fee · ${finances.managementFeePercent.toFixed(2).replace(/\.00$/, "")}%`} value={`−${money(finances.managementFee)}`} /></div><div className="mt-3"><Line label="Owner net revenue" value={money(finances.ownerNet)} strong /></div></div><div className="grid gap-2 rounded-2xl border border-[var(--border)] p-4 text-sm sm:grid-cols-2"><BookingInfo label="Booking reference" value={booking.bookingReference || booking.id} /><BookingInfo label="Status" value={booking.status || "Confirmed"} /><BookingInfo label="Guest email" value={booking.guestEmail || "Not supplied"} /><BookingInfo label="Guest phone" value={booking.guestPhone || "Not supplied"} /></div><DialogFooter><Button onClick={onClose} className="bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)]">Close</Button></DialogFooter></DialogContent></Dialog>;
}

function BookingInfo({ label, value }: { label: string; value: string }) { return <div><span className="text-[var(--muted-foreground)]">{label}</span><strong className="mt-1 block break-words">{value}</strong></div>; }

function ReservationMetric({ label, value, accent=false }: { label:string; value:string; accent?:boolean }) { return <div className={`rounded-2xl p-4 ${accent?"bg-[var(--primary)] text-[var(--primary-foreground)]":"bg-[var(--muted)]"}`}><p className={`text-sm ${accent?"text-white/65":"text-[var(--muted-foreground)]"}`}>{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>; }

function PortfolioCalendar({ properties, visibleIds, setVisibleIds, reservations, loading }: { properties: ManagementProperty[]; visibleIds: string[]; setVisibleIds: (ids: string[]) => void; reservations: Record<string, HostawayReservation[]>; loading: Record<string, boolean> }) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const days = calendarDays(month);
  const colours = ["bg-[#315f50]", "bg-[var(--muted)]", "bg-[var(--rc-warning-bg)]", "bg-[var(--rc-info-bg)]", "bg-[var(--muted)]"];
  return <div className="grid gap-5 xl:grid-cols-[18rem_minmax(0,1fr)]"><aside className="rounded-[1.5rem] border border-[var(--border)] bg-white p-5"><p className="font-semibold">Properties shown</p><div className="mt-4 space-y-3">{properties.map((property, index) => <label key={property.id} className="flex cursor-pointer items-start gap-3 text-sm"><Checkbox checked={visibleIds.includes(property.id)} onCheckedChange={(checked) => setVisibleIds(checked ? [...visibleIds, property.id] : visibleIds.filter((id) => id !== property.id))} /><span><span className={`mr-2 inline-block size-2 rounded-full ${colours[index % colours.length]}`} />{property.propertyName}</span></label>)}</div></aside><section className="overflow-hidden rounded-[1.7rem] border border-[var(--border)] bg-white"><div className="flex items-center justify-between border-b border-[var(--border)] p-5"><Button variant="outline" size="icon" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ArrowLeft /></Button><h2 className="text-xl font-semibold">{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</h2><Button variant="outline" size="icon" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ArrowRight /></Button></div><div className="grid grid-cols-7 border-b border-[var(--border)] bg-[var(--muted)] text-center text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">{["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((day) => <div key={day} className="py-3">{day}</div>)}</div><div className="grid grid-cols-7">{days.map((day) => { const bookings = properties.flatMap((property, index) => visibleIds.includes(property.id) ? (reservations[property.id] || []).filter((reservation) => isDateWithin(day, reservation.arrivalDate, reservation.departureDate)).map((reservation) => ({ reservation, property, colour: colours[index % colours.length] })) : []); return <div key={day.toISOString()} className={`min-h-28 border-r border-b border-[var(--border)] p-2 ${day.getMonth() === month.getMonth() ? "" : "bg-[var(--card)] text-[var(--muted-foreground)]"}`}><p className="text-xs font-semibold">{day.getDate()}</p><div className="mt-2 space-y-1">{bookings.slice(0,3).map(({reservation, property, colour}) => <div key={`${property.id}-${reservation.id}`} title={`${property.propertyName} · ${reservation.guestName}`} className={`truncate rounded-md px-2 py-1 text-[0.68rem] font-semibold text-[var(--foreground)] ${colour}`}>{property.propertyName}</div>)}{bookings.length > 3 && <p className="text-[0.68rem] text-[var(--muted-foreground)]">+{bookings.length - 3} more</p>}</div></div>; })}</div>{Object.values(loading).some(Boolean) && <div className="flex items-center gap-2 border-t p-4 text-sm text-[var(--muted-foreground)]"><LoaderCircle className="size-4 animate-spin" /> Updating Hostaway bookings…</div>}</section></div>;
}

function performance(reservations: HostawayReservation[], property: ManagementProperty, start: Date, end: Date) {
  const active = reservations.filter((reservation) => !/cancel/i.test(reservation.status) && overlaps(reservation, start, end));
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
  let bookedNights = 0, gross = 0;
  const channels = { Airbnb: 0, "Booking.com": 0, VRBO: 0, Direct: 0 };
  for (const reservation of active) {
    const arrival = parseDate(reservation.arrivalDate), departure = parseDate(reservation.departureDate);
    const totalNights = Math.max(1, Math.round((departure.getTime() - arrival.getTime()) / 86400000));
    const overlapStart = new Date(Math.max(arrival.getTime(), start.getTime()));
    const overlapEnd = new Date(Math.min(departure.getTime(), end.getTime()));
    const nights = Math.max(0, Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 86400000));
    const allocated = Math.round(reservation.grossRevenuePence * nights / totalNights);
    bookedNights += nights; gross += allocated; channels[channel(reservation.channelName)] += allocated;
  }
  const otaCosts = Math.round(channels.Airbnb * .185 + channels["Booking.com"] * .18 + channels.VRBO * .15 + channels.Direct * .03);
  const cleaningCosts = active.length * property.cleaningCostPence;
  return { gross, nightlyRate: bookedNights ? gross / bookedNights : 0, occupancy: Math.min(100, bookedNights / days * 100), channels, otaCosts, cleaningCosts, changeovers: active.length, net: Math.max(0, gross - otaCosts - cleaningCosts) };
}

const CHANNEL_COLOURS: Record<"Airbnb" | "Booking.com" | "VRBO" | "Direct", string> = { Airbnb: "#ff5a5f", "Booking.com": "#003580", VRBO: "#f5c542", Direct: "#76ad49" };
function ChannelMix({ channels }: { channels: Record<string, number> }) { const total = Object.values(channels).reduce((sum, value) => sum + value, 0); const entries = Object.entries(channels); let cursor = 0; const stops = entries.map(([name,value]) => { const start = cursor; cursor += total ? value / total * 100 : 0; return `${CHANNEL_COLOURS[name as keyof typeof CHANNEL_COLOURS]} ${start}% ${cursor}%`; }).join(", "); return <div><p className="text-sm font-semibold">Booking channel split</p><div className="mt-4 flex flex-col items-center gap-6 sm:flex-row"><div role="img" aria-label="Booking channel revenue split" className="relative size-44 shrink-0 rounded-full" style={{ background: total ? `conic-gradient(${stops})` : "#e7edea" }}><div className="absolute inset-9 grid place-items-center rounded-full bg-white text-center"><span><strong className="block text-xl">{total ? "100%" : "0%"}</strong><span className="text-xs text-[var(--muted-foreground)]">revenue</span></span></div></div><div className="w-full space-y-3">{entries.map(([name,value]) => <div key={name} className="flex items-center justify-between gap-4 text-sm"><span className="flex items-center gap-2"><span className="size-3 rounded-full" style={{backgroundColor:CHANNEL_COLOURS[name as keyof typeof CHANNEL_COLOURS]}} />{name === "Direct" ? "Direct · Recharge" : name}</span><span className="font-semibold">{total ? (value/total*100).toFixed(0) : 0}%</span></div>)}</div></div></div>; }
function Metric({ label, value, accent=false, help }: { label: string; value: string; accent?: boolean; help?: string }) { const card = <article className={`rounded-2xl p-5 ${accent ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "bg-[var(--muted)]"}`}><p className={`text-sm ${accent ? "text-white/60" : "text-[var(--muted-foreground)]"}`}>{label}{help && <span className="ml-1 text-xs">ⓘ</span>}</p><p className="mt-4 text-3xl font-semibold tracking-[-0.04em]">{value}</p></article>; return help ? <TooltipProvider><Tooltip><TooltipTrigger asChild><button className="text-left">{card}</button></TooltipTrigger><TooltipContent className="max-w-64 leading-5">{help}</TooltipContent></Tooltip></TooltipProvider> : card; }
function Line({ label, value, strong=false }: { label: string; value: string; strong?: boolean }) { return <div className={`flex justify-between gap-3 ${strong ? "border-t border-[var(--border)] pt-3 font-semibold" : ""}`}><span className="text-[var(--muted-foreground)]">{label}</span><span>{value}</span></div>; }
function ClientStatus({ property, onboarding }: { property: ManagementProperty; onboarding?: OnboardingCase }) { return <Badge className={`border-0 ${property.status === "live" ? "bg-[var(--muted)] text-[var(--muted-foreground)]" : "bg-[var(--muted)] text-[var(--rc-danger-text)]"}`}>{clientStatusLabel(property, onboarding)}</Badge>; }
function EmptyPortfolio() { return <section className="rounded-[1.5rem] border border-dashed border-[var(--border)] bg-white p-10 text-center"><WalletCards className="mx-auto text-[var(--muted-foreground)]" /><p className="mt-4 font-semibold">No properties linked yet</p><p className="mt-1 text-sm text-[var(--muted-foreground)]">New enquiries and managed properties will appear here automatically.</p></section>; }
function findOnboarding(property: ManagementProperty, cases: OnboardingCase[]) { const keys = [property.propertyName, property.propertyAddress].map(normalise); return cases.find((item) => [item.propertyName, item.propertyAddress].map(normalise).some((key) => key && keys.includes(key))); }
function normalise(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function statusLabel(status?: OnboardingStatus) { const labels: Partial<Record<OnboardingStatus,string>> = { enquiry_received:"Estimate in progress", estimate_drafting:"Estimate in progress", estimate_received:"Estimate ready for review", reviewing:"Estimate under review", not_proceeding:"Not proceeding", agreement_pending:"Management agreement ready to sign", onboarding_form:"Onboarding form to complete", inspection_to_book:"Inspection being arranged", inspection_booked:"Inspection booked", reports_received:"Inspection reports ready", purchase_order_review:"Requirements ready for approval", purchase_order_approved:"Requirements approved", purchase_order_rejected:"Requirements changes requested", invoices_pending:"Invoice awaiting settlement", furnishing:"Property preparation in progress", guest_ready_scheduled:"Guest-ready date scheduled", guest_ready:"Guest-ready checks complete", listings_in_progress:"Listings being prepared", live:"Live and accepting bookings" }; return status ? labels[status] || status.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()) : "Estimate in progress"; }
function clientStatusLabel(property: ManagementProperty, onboarding?: OnboardingCase) { return property.status === "live" ? "Live" : onboarding ? statusLabel(onboarding.status) : "Onboarding in progress"; }
function clientStageIndex(status: OnboardingStatus) { if (["enquiry_received","estimate_drafting"].includes(status)) return 0; if (["estimate_received","reviewing","not_proceeding"].includes(status)) return 1; if (status === "agreement_pending") return 2; if (status === "onboarding_form") return 3; if (["inspection_to_book","inspection_booked","reports_received"].includes(status)) return 4; if (["purchase_order_review","purchase_order_approved","purchase_order_rejected","invoices_pending"].includes(status)) return 5; if (status === "furnishing") return 6; if (["guest_ready_scheduled","guest_ready"].includes(status)) return 7; if (status === "listings_in_progress") return 8; return 9; }
function clientAction(status?: OnboardingStatus) { if (!status || status === "enquiry_received" || status === "estimate_drafting") return "No action is needed yet. We are preparing your performance estimate."; if (["estimate_received", "reviewing"].includes(status)) return "Review the performance estimate and tell us whether you would like to proceed."; if (status === "agreement_pending") return "Read and sign the management agreement."; if (status === "onboarding_form") return "Complete the property, access, utilities and payout information."; if (status === "purchase_order_review") return "Review and approve or reject the property requirements."; if (status === "invoices_pending") return "Settle the outstanding onboarding or purchase-order invoice."; return "No client action is currently required. The Recharge team is progressing this stage."; }
function currentWeek() { const date = new Date(); const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())); const day = utc.getUTCDay() || 7; utc.setUTCDate(utc.getUTCDate() + 4 - day); const yearStart = new Date(Date.UTC(utc.getUTCFullYear(),0,1)); const week = Math.ceil((((utc.getTime()-yearStart.getTime())/86400000)+1)/7); return `${utc.getUTCFullYear()}-W${String(week).padStart(2,"0")}`; }
function weekRange(value: string) { const [yearText, weekText] = value.split("-W"); const year = Number(yearText), week = Number(weekText); const jan4 = new Date(year,0,4); const monday = new Date(year,0,4-((jan4.getDay()+6)%7)+(week-1)*7); return { start: monday, end: new Date(monday.getFullYear(),monday.getMonth(),monday.getDate()+7) }; }
function currentMonth() { const date=new Date(); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`; }
function performancePeriodOptions(period: "week" | "month" | "year") {
  const year=new Date().getFullYear();
  if (period === "week") return Array.from({length:isoWeeksInYear(year)},(_,index)=>{const value=`${year}-W${String(index+1).padStart(2,"0")}`; const range=weekRange(value); return {value,label:`Week ${index+1} · ${range.start.toLocaleDateString("en-GB",{day:"numeric",month:"short"})}–${addDays(range.end,-1).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}`};});
  if (period === "month") return Array.from({length:12},(_,index)=>{const date=new Date(year,index,1); return {value:`${year}-${String(index+1).padStart(2,"0")}`,label:date.toLocaleDateString("en-GB",{month:"long",year:"numeric"})};});
  return Array.from({length:5},(_,index)=>{const value=String(year+2-index); return {value,label:value};});
}
function isoWeeksInYear(year:number) { const date=new Date(year,11,31); const day=date.getDay(); return day===4 || (day===5 && new Date(year,1,29).getMonth()===1) ? 53 : 52; }
function performanceRange(period: "week" | "month" | "year", value: string) { if (period === "week") return weekRange(value || currentWeek()); if (period === "month") { const [year,month]=value.split("-").map(Number); const start=new Date(year,month-1,1); return {start,end:new Date(year,month,1)}; } const year=Number(value)||new Date().getFullYear(); return {start:new Date(year,0,1),end:new Date(year+1,0,1)}; }
function parseDate(value: string) { const [year,month,day] = value.slice(0,10).split("-").map(Number); return new Date(year, (month||1)-1, day||1); }
function overlaps(reservation: HostawayReservation, start: Date, end: Date) { return parseDate(reservation.arrivalDate) < end && parseDate(reservation.departureDate) > start; }
function isDateWithin(day: Date, arrival: string, departure: string) { const value = new Date(day.getFullYear(),day.getMonth(),day.getDate()).getTime(); return value >= parseDate(arrival).getTime() && value < parseDate(departure).getTime(); }
function channel(value: string): "Airbnb" | "Booking.com" | "VRBO" | "Direct" { if (/airbnb/i.test(value)) return "Airbnb"; if (/booking/i.test(value)) return "Booking.com"; if (/vrbo|homeaway/i.test(value)) return "VRBO"; return "Direct"; }
function netAfterOta(reservation: HostawayReservation) { const rate={Airbnb:.185,"Booking.com":.18,VRBO:.15,Direct:.03}[channel(reservation.channelName)]; return Math.max(0,Math.round(reservation.grossRevenuePence*(1-rate))); }
function bookingFinancials(reservation: HostawayReservation, property: ManagementProperty) {
  const afterOta = netAfterOta(reservation);
  const otaFee = Math.max(0, reservation.grossRevenuePence - afterOta);
  const cleaningCost = Math.max(0, property.cleaningCostPence || 0);
  const managementBasis = Math.max(0, afterOta - cleaningCost);
  const managementFeePercent = property.managementFeePercent > 0 ? property.managementFeePercent : 15;
  const managementFee = Math.round(managementBasis * managementFeePercent / 100);
  return { otaFee, cleaningCost, managementBasis, managementFeePercent, managementFee, ownerNet: Math.max(0, managementBasis - managementFee) };
}
function channelText(name: "Airbnb" | "Booking.com" | "VRBO" | "Direct") { return name === "VRBO" ? "#23322f" : "#ffffff"; }
function startOfDay(date: Date) { return new Date(date.getFullYear(),date.getMonth(),date.getDate()); }
function addDays(date: Date, amount: number) { return new Date(date.getFullYear(),date.getMonth(),date.getDate()+amount); }
function dayDistance(from: Date, to: Date) { return Math.round((startOfDay(to).getTime()-startOfDay(from).getTime())/86400000); }
function formatShortDate(date: Date) { return date.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}); }
function formatBookingDate(value: string) { return parseDate(value).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}); }
function money(pence: number) { return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(pence/100); }
function calendarDays(month: Date) { const first = new Date(month.getFullYear(),month.getMonth(),1); const start = new Date(first); start.setDate(1-((first.getDay()+6)%7)); return Array.from({length:42},(_,index) => new Date(start.getFullYear(),start.getMonth(),start.getDate()+index)); }
