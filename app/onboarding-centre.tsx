"use client";


import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  FileText,
  Home,
  Mail,
  MessageSquare,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type {
  Comparable,
  ListingLink,
  OnboardingCase,
  OnboardingData,
  OnboardingFileKind,
  OnboardingStatus,
  RepairPermission,
} from "@/lib/onboarding-types";
import type { WorkspaceRole } from "@/lib/modules";

type User = { name: string; email: string; role: WorkspaceRole };

const STATUS_LABELS: Record<OnboardingStatus, string> = {
  enquiry_received: "New enquiry",
  estimate_drafting: "Estimate in progress",
  estimate_received: "Estimate received",
  reviewing: "Client reviewing",
  not_proceeding: "Not proceeding",
  agreement_pending: "Agreement to sign",
  onboarding_form: "Onboarding form",
  inspection_to_book: "Inspection to book",
  inspection_booked: "Inspection booked",
  reports_received: "Reports received",
  purchase_order_review: "Purchase order review",
  purchase_order_approved: "Purchase order approved",
  purchase_order_rejected: "Purchase order changes",
  invoices_pending: "Invoices in progress",
  furnishing: "Furnishing",
  guest_ready_scheduled: "Guest-ready date set",
  guest_ready: "Guest ready",
  listings_in_progress: "Listings in progress",
  live: "Live",
};

const STATUS_PROGRESS: Record<OnboardingStatus, number> = {
  enquiry_received: 5,
  estimate_drafting: 10,
  estimate_received: 18,
  reviewing: 20,
  not_proceeding: 20,
  agreement_pending: 25,
  onboarding_form: 32,
  inspection_to_book: 42,
  inspection_booked: 50,
  reports_received: 58,
  purchase_order_review: 62,
  purchase_order_approved: 68,
  purchase_order_rejected: 62,
  invoices_pending: 72,
  furnishing: 78,
  guest_ready_scheduled: 84,
  guest_ready: 90,
  listings_in_progress: 95,
  live: 100,
};

export function OnboardingCentre({
  initialData,
  currentUser,
  mode,
  onBack,
  managedProperties,
}: {
  initialData: OnboardingData;
  currentUser: User;
  mode: "client" | "staff";
  onBack: () => void;
  managedProperties: string[];
}) {
  const [data, setData] = useState(initialData);
  const [selectedId, setSelectedId] = useState(initialData.cases[0]?.id || "");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const selected = data.cases.find((item) => item.id === selectedId) || data.cases[0];
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term
      ? data.cases.filter((item) =>
          [item.propertyAddress, item.propertyName, item.clientName, item.clientEmail]
            .join(" ")
            .toLowerCase()
            .includes(term),
        )
      : data.cases;
  }, [data.cases, search]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const response = await fetch("/api/onboarding", { cache: "no-store" }).catch(() => null);
      if (!active || !response?.ok) return;
      const result = (await response.json().catch(() => null)) as { data?: OnboardingData } | null;
      if (result?.data) {
        setData(result.data);
        setSelectedId((current) => current || result.data?.cases[0]?.id || "");
      }
    };
    const timer = window.setInterval(refresh, 4_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  async function act(payload: Record<string, unknown>) {
    setSaving(true);
    setError("");
    const response = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json().catch(() => null)) as
      | { error?: string; data?: OnboardingData; id?: string }
      | null;
    if (!response.ok || !result?.data) {
      setError(result?.error || "The onboarding record could not be updated.");
      setSaving(false);
      throw new Error(result?.error || "Update failed");
    }
    setData(result.data);
    if (result.id) setSelectedId(result.id);
    setSaving(false);
    return result;
  }

  async function upload(
    onboardingId: string,
    kind: OnboardingFileKind,
    file: File,
    roomLabel = "",
  ) {
    const form = new FormData();
    form.set("onboardingId", onboardingId);
    form.set("kind", kind);
    form.set("roomLabel", roomLabel);
    form.set("file", file);
    const response = await fetch("/api/onboarding/files", { method: "POST", body: form });
    const result = (await response.json().catch(() => null)) as
      | { error?: string; data?: OnboardingData }
      | null;
    if (!response.ok || !result?.data) throw new Error(result?.error || "File upload failed");
    setData(result.data);
  }

  if (!data.available) {
    return <Unavailable onBack={onBack} />;
  }

  return (
    <div className="space-y-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <Button variant="ghost" className="-ml-3 mb-4 text-[var(--muted-foreground)]" onClick={onBack}>
            <ArrowLeft /> Back
          </Button>
          <p className="eyebrow">{mode === "client" ? "Recharge Dashboard" : "Stays operations"}</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
            {mode === "client" ? "Your properties" : "Property Onboarding"}
          </h1>
          <p className="mt-3 max-w-3xl text-base leading-7 text-[var(--muted-foreground)]">
            {mode === "client"
              ? "Request a performance estimate and follow each property from enquiry to live listings."
              : "Manage every client estimate, agreement, inspection, invoice and launch from one shared record."}
          </p>
        </div>
        <NewEnquiryDialog currentUser={currentUser} act={act} upload={upload} saving={saving} />
      </div>

      {!data.emailConnected && (
        <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Mail className="mt-0.5 size-4 shrink-0" />
          <p>
            Email prompts and the 24-hour reminder are being queued. They will send automatically once the Recharge email connection is enabled.
          </p>
        </div>
      )}
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}

      {mode === "client" ? (
        <ClientDashboard
          cases={data.cases}
          selected={selected}
          setSelectedId={setSelectedId}
          currentUser={currentUser}
          managedProperties={managedProperties}
          act={act}
          upload={upload}
          saving={saving}
        />
      ) : (
        <StaffWorkspace
          cases={filtered}
          selected={selected}
          search={search}
          setSearch={setSearch}
          setSelectedId={setSelectedId}
          act={act}
          upload={upload}
          saving={saving}
        />
      )}
    </div>
  );
}

function ClientDashboard({
  cases,
  selected,
  setSelectedId,
  currentUser,
  managedProperties,
  act,
  upload,
  saving,
}: {
  cases: OnboardingCase[];
  selected?: OnboardingCase;
  setSelectedId: (id: string) => void;
  currentUser: User;
  managedProperties: string[];
  act: (payload: Record<string, unknown>) => Promise<unknown>;
  upload: (id: string, kind: OnboardingFileKind, file: File, room?: string) => Promise<void>;
  saving: boolean;
}) {
  const live = cases.filter((item) => item.status === "live").length;
  return (
    <Tabs defaultValue="dashboard">
      <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl bg-[var(--muted)] p-1 sm:w-fit">
        <TabsTrigger value="dashboard" className="min-h-10 px-4">Dashboard</TabsTrigger>
        <TabsTrigger value="onboarding" className="min-h-10 px-4">Property onboarding</TabsTrigger>
      </TabsList>
      <TabsContent value="dashboard" className="mt-6 space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <DashboardCard icon={CalendarDays} title="Booking calendar" value={`${managedProperties.length} properties`} note="Your managed portfolio and booking calendar." />
          <DashboardCard icon={BarChart3} title="Property performance" value={`${live} live`} note="Performance reporting for your active properties." />
          <DashboardCard icon={ClipboardCheck} title="Property onboarding" value={`${cases.filter((item) => item.status !== "live" && item.status !== "not_proceeding").length} active`} note="Follow every onboarding milestone." />
        </div>
        <section className="rounded-[1.5rem] border border-[var(--border)] bg-white p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="eyebrow">Portfolio</p>
              <h2 className="mt-2 text-2xl font-semibold">Welcome, {firstName(currentUser.name)}</h2>
            </div>
            <Badge className="border-0 bg-[var(--muted)] text-[var(--muted-foreground)]">Client</Badge>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {managedProperties.map((property) => (
              <div key={property} className="rounded-xl bg-[var(--muted)] px-4 py-4 text-sm font-semibold">{property}</div>
            ))}
            {!managedProperties.length && (
              <p className="rounded-xl bg-[var(--muted)] px-4 py-5 text-sm text-[var(--muted-foreground)]">
                Your first property will appear here when it goes live.
              </p>
            )}
          </div>
        </section>
      </TabsContent>
      <TabsContent value="onboarding" className="mt-6">
        <div className="grid gap-5 xl:grid-cols-[21rem_minmax(0,1fr)]">
          <CaseList cases={cases} selectedId={selected?.id || ""} onSelect={setSelectedId} />
          {selected ? (
            <ClientCase caseItem={selected} act={act} upload={upload} saving={saving} />
          ) : (
            <EmptyCases />
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}

function StaffWorkspace({
  cases,
  selected,
  search,
  setSearch,
  setSelectedId,
  act,
  upload,
  saving,
}: {
  cases: OnboardingCase[];
  selected?: OnboardingCase;
  search: string;
  setSearch: (value: string) => void;
  setSelectedId: (id: string) => void;
  act: (payload: Record<string, unknown>) => Promise<unknown>;
  upload: (id: string, kind: OnboardingFileKind, file: File, room?: string) => Promise<void>;
  saving: boolean;
}) {
  const [group, setGroup] = useState<"new_enquiry" | "sign_them_up" | "onboarding" | "live" | "archived">("new_enquiry");
  const groupedCases = cases.filter((item) => onboardingGroup(item.status) === group);
  const groupedSelected = groupedCases.find((item) => item.id === selected?.id) || groupedCases[0];
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-4">
        <MiniStat label="New enquiries" value={cases.filter((item) => onboardingGroup(item.status) === "new_enquiry").length} />
        <MiniStat label="Sign them up" value={cases.filter((item) => onboardingGroup(item.status) === "sign_them_up").length} />
        <MiniStat label="Onboarding" value={cases.filter((item) => onboardingGroup(item.status) === "onboarding").length} />
        <MiniStat label="Live" value={cases.filter((item) => item.status === "live").length} accent />
      </div>
      <Tabs value={group} onValueChange={(value) => {
        const next = value as typeof group;
        setGroup(next);
        const first = cases.find((item) => onboardingGroup(item.status) === next);
        if (first) setSelectedId(first.id);
      }}>
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl bg-[var(--muted)] p-1">
          <TabsTrigger value="new_enquiry" className="min-h-10 px-4">New enquiry</TabsTrigger>
          <TabsTrigger value="sign_them_up" className="min-h-10 px-4">Sign them up</TabsTrigger>
          <TabsTrigger value="onboarding" className="min-h-10 px-4">Onboarding</TabsTrigger>
          <TabsTrigger value="live" className="min-h-10 px-4">Live</TabsTrigger>
          <TabsTrigger value="archived" className="min-h-10 px-4">Archived</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <div>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search property or client" className="h-11 bg-white pl-10" />
          </div>
          <CaseList cases={groupedCases} selectedId={groupedSelected?.id || ""} onSelect={setSelectedId} />
        </div>
        {groupedSelected ? (
          <StaffCase caseItem={groupedSelected} act={act} upload={upload} saving={saving} />
        ) : (
          <EmptyCases />
        )}
      </div>
    </>
  );
}

function onboardingGroup(status: OnboardingStatus) {
  if (status === "live") return "live";
  if (status === "not_proceeding") return "archived";
  if (["enquiry_received", "estimate_drafting"].includes(status)) return "new_enquiry";
  if (["estimate_received", "reviewing", "agreement_pending"].includes(status)) return "sign_them_up";
  return "onboarding";
}

function hasUnansweredClientQuestion(item: OnboardingCase) {
  if (!item.decisionFeedback || item.status !== "reviewing") return false;
  const questionAt = item.updates.find((update) => update.eventType === "client_decision")?.createdAt || 0;
  const answeredAt = item.updates.find((update) => update.eventType === "stays_response")?.createdAt || 0;
  return questionAt > answeredAt;
}

function CaseList({ cases, selectedId, onSelect }: { cases: OnboardingCase[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <div className="space-y-2">
      {cases.map((item) => (
        <button
          key={item.id}
          onClick={() => onSelect(item.id)}
          className={`w-full rounded-2xl border p-4 text-left transition ${selectedId === item.id ? "border-[var(--border)] bg-[#1c3934] text-white" : hasUnansweredClientQuestion(item) ? "border-amber-400 bg-amber-50 hover:border-amber-500" : "border-[var(--border)] bg-white hover:border-[var(--border)]"}`}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="truncate text-sm font-semibold">{item.propertyName || item.propertyAddress}</p>
            <span className={`text-[0.65rem] font-semibold ${selectedId === item.id ? "text-[var(--muted-foreground)]" : "text-[var(--muted-foreground)]"}`}>{STATUS_PROGRESS[item.status]}%</span>
          </div>
          <p className={`mt-1 truncate text-xs ${selectedId === item.id ? "text-white/55" : "text-[var(--muted-foreground)]"}`}>{item.clientName}</p>
          <p className={`mt-2 text-xs ${selectedId === item.id ? "text-white/55" : "text-[var(--muted-foreground)]"}`}>Received {dateTime(item.createdAt)}</p>
          <p className={`mt-3 text-xs font-semibold ${selectedId === item.id ? "text-white/80" : "text-[var(--muted-foreground)]"}`}>{STATUS_LABELS[item.status]}</p>
          {hasUnansweredClientQuestion(item) && <p className={`mt-2 text-xs font-semibold ${selectedId === item.id ? "text-amber-200" : "text-amber-800"}`}>Client question waiting</p>}
        </button>
      ))}
      {!cases.length && <EmptyCases />}
    </div>
  );
}

function ClientCase({ caseItem, act, upload, saving }: CaseActionProps) {
  useEffect(() => {
    if (caseItem.estimatePublishedAt && !caseItem.estimateViewedAt) {
      act({ action: "mark_estimate_viewed", id: caseItem.id }).catch(
        () => undefined,
      );
    }
  }, [act, caseItem.estimatePublishedAt, caseItem.estimateViewedAt, caseItem.id]);
  return (
    <CaseShell caseItem={caseItem}>
      {caseItem.estimatePublishedAt && ["estimate_received", "reviewing"].includes(caseItem.status) && <EstimatePresentation caseItem={caseItem} />}
      {["estimate_received", "reviewing"].includes(caseItem.status) && (
        <ClientDecisionForm caseItem={caseItem} act={act} saving={saving} />
      )}
      {caseItem.status === "agreement_pending" && (
        <AgreementForm caseItem={caseItem} act={act} saving={saving} />
      )}
      {caseItem.agreementSignedAt && caseItem.status !== "live" && <OnboardingChecklist caseItem={caseItem} />}
      {caseItem.status === "onboarding_form" && <ClientOnboardingForm caseItem={caseItem} act={act} saving={saving} />}
      {caseItem.formSubmittedAt && caseItem.furnishingChoice === "self" && !caseItem.selfFurnishInspectionDate && <SelfFurnishInspectionDate caseItem={caseItem} act={act} saving={saving} />}
      {caseItem.status === "purchase_order_review" && (
        <PurchaseOrderDecision caseItem={caseItem} act={act} saving={saving} />
      )}
      <Documents caseItem={caseItem} upload={upload} client />
      <PropertyGroupChat caseItem={caseItem} act={act} saving={saving} client />
      <ActivityTimeline caseItem={caseItem} />
    </CaseShell>
  );
}

export function ClientPropertyOnboarding({
  caseItem,
  onUpdated,
}: {
  caseItem: OnboardingCase;
  onUpdated: (caseItem: OnboardingCase) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const act = useCallback(async (payload: Record<string, unknown>) => {
    setSaving(true);
    setError("");
    const response = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json().catch(() => null)) as { error?: string; data?: OnboardingData } | null;
    setSaving(false);
    if (!response.ok || !result?.data) {
      const message = result?.error || "Your onboarding could not be updated.";
      setError(message);
      throw new Error(message);
    }
    const updated = result.data.cases.find((item) => item.id === caseItem.id);
    if (updated) onUpdated(updated);
    return result;
  }, [caseItem.id, onUpdated]);

  const upload = useCallback(async (onboardingId: string, kind: OnboardingFileKind, file: File, roomLabel = "") => {
    const form = new FormData();
    form.set("onboardingId", onboardingId);
    form.set("kind", kind);
    form.set("roomLabel", roomLabel);
    form.set("file", file);
    const response = await fetch("/api/onboarding/files", { method: "POST", body: form });
    const result = (await response.json().catch(() => null)) as { error?: string; data?: OnboardingData } | null;
    if (!response.ok || !result?.data) throw new Error(result?.error || "File upload failed");
    const updated = result.data.cases.find((item) => item.id === caseItem.id);
    if (updated) onUpdated(updated);
  }, [caseItem.id, onUpdated]);

  useEffect(() => {
    if (caseItem.estimatePublishedAt && !caseItem.estimateViewedAt) {
      act({ action: "mark_estimate_viewed", id: caseItem.id }).catch(() => undefined);
    }
  }, [act, caseItem.estimatePublishedAt, caseItem.estimateViewedAt, caseItem.id]);

  return (
    <div className="space-y-5">
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}
      {["enquiry_received", "estimate_drafting", "estimate_received", "reviewing"].includes(caseItem.status) && <ServicesAndProcess />}
      {caseItem.estimatePublishedAt && ["estimate_received", "reviewing"].includes(caseItem.status) && <EstimatePresentation caseItem={caseItem} compact />}
      {["estimate_received", "reviewing"].includes(caseItem.status) && (
        <ClientDecisionForm caseItem={caseItem} act={act} saving={saving} />
      )}
      {caseItem.status === "agreement_pending" && <AgreementForm caseItem={caseItem} act={act} saving={saving} />}
      {caseItem.agreementSignedAt && caseItem.status !== "live" && <OnboardingChecklist caseItem={caseItem} />}
      {caseItem.status === "onboarding_form" && <ClientOnboardingForm caseItem={caseItem} act={act} saving={saving} />}
      {caseItem.formSubmittedAt && caseItem.furnishingChoice === "self" && !caseItem.selfFurnishInspectionDate && <SelfFurnishInspectionDate caseItem={caseItem} act={act} saving={saving} />}
      {caseItem.status === "purchase_order_review" && <PurchaseOrderDecision caseItem={caseItem} act={act} saving={saving} />}
      <Documents caseItem={caseItem} upload={upload} client />
      <PropertyGroupChat caseItem={caseItem} act={act} saving={saving} client />
      <ActivityTimeline caseItem={caseItem} />
    </div>
  );
}

function StaffCase({ caseItem, act, upload, saving }: CaseActionProps) {
  return (
    <CaseShell caseItem={caseItem}>
      <Tabs defaultValue="next-action">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl bg-[var(--muted)] p-1 sm:w-fit">
          <TabsTrigger value="next-action" className="min-h-10 px-4">Next action</TabsTrigger>
          <TabsTrigger value="documents" className="min-h-10 px-4">Documents</TabsTrigger>
          <TabsTrigger value="accounts" className="min-h-10 px-4">Accounts</TabsTrigger>
          <TabsTrigger value="activity" className="min-h-10 px-4">Activity</TabsTrigger>
          <TabsTrigger value="chat" className="min-h-10 px-4">Property chat</TabsTrigger>
        </TabsList>
        <TabsContent value="next-action" className="mt-5 space-y-5">
          {caseItem.status === "enquiry_received" && <EstimateBuilder caseItem={caseItem} act={act} saving={saving} />}
          {["enquiry_received", "estimate_drafting"].includes(caseItem.status) && <EstimatePhotos caseItem={caseItem} />}
          {caseItem.status === "onboarding_form" && !caseItem.formSubmittedAt && <ActionCard icon={Clock3} eyebrow="Waiting on client" title="Waiting for the onboarding form" description="The management agreement is signed and the onboarding invoice ticket is with Accounts. The next Stays action begins when the client submits their property details." />}
          {["reviewing", "not_proceeding"].includes(caseItem.status) && <StaffReviewResponse caseItem={caseItem} act={act} saving={saving} />}
          {caseItem.formSubmittedAt && !caseItem.inspectionBookedAt && <InspectionBooking caseItem={caseItem} act={act} saving={saving} />}
          {caseItem.inspectionBookedAt && !caseItem.reportsPublishedAt && <ReportPublishing caseItem={caseItem} act={act} upload={upload} saving={saving} />}
          {caseItem.status === "purchase_order_rejected" && <QuoteRevisionPanel caseItem={caseItem} act={act} saving={saving} />}
          {caseItem.supplierInvoiceStatus === "settled" && !caseItem.estimatedGuestReadyDate && <GuestReadyDate caseItem={caseItem} act={act} saving={saving} />}
          {caseItem.healthSafetyPercent === 100 && caseItem.status !== "guest_ready" && caseItem.status !== "live" && <GuestReadyConfirmation caseItem={caseItem} act={act} saving={saving} />}
          {caseItem.status === "guest_ready" && <LaunchChecklist caseItem={caseItem} act={act} saving={saving} />}
          {!nextActionVisible(caseItem) && <NextStepSummary caseItem={caseItem} />}
        </TabsContent>
        <TabsContent value="documents" className="mt-5"><Documents caseItem={caseItem} upload={upload} /></TabsContent>
        <TabsContent value="accounts" className="mt-5"><AccountsControls caseItem={caseItem} act={act} saving={saving} /></TabsContent>
        <TabsContent value="activity" className="mt-5"><ActivityTimeline caseItem={caseItem} /></TabsContent>
        <TabsContent value="chat" className="mt-5"><PropertyGroupChat caseItem={caseItem} act={act} saving={saving} /></TabsContent>
      </Tabs>
    </CaseShell>
  );
}

type CaseActionProps = {
  caseItem: OnboardingCase;
  act: (payload: Record<string, unknown>) => Promise<unknown>;
  upload: (id: string, kind: OnboardingFileKind, file: File, room?: string) => Promise<void>;
  saving: boolean;
};

function CaseShell({ caseItem, children }: { caseItem: OnboardingCase; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[1.6rem] border border-[var(--border)] bg-white">
      <div className="bg-[#1c3934] px-6 py-6 text-white sm:px-7">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">Enquiry received {dateTime(caseItem.createdAt)}</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">{caseItem.propertyName || caseItem.propertyAddress}</h2>
            <p className="mt-2 text-sm text-white/60">{caseItem.propertyAddress} · {caseItem.propertyType} · {caseItem.bedrooms} bed · {caseItem.bathrooms} bath</p>
          </div>
          <Badge className="w-fit border-0 bg-white/10 text-white">{STATUS_LABELS[caseItem.status]}</Badge>
        </div>
        <OnboardingJourneyButton caseItem={caseItem} inverse />
      </div>
      <div className="space-y-6 p-5 sm:p-7">{children}</div>
    </section>
  );
}

export function OnboardingJourneyButton({ caseItem, inverse = false }: { caseItem: OnboardingCase; inverse?: boolean }) {
  const current = journeyStageIndex(caseItem.status);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className={`mt-6 flex w-full items-center gap-3 rounded-xl p-2 text-left transition ${inverse ? "hover:bg-white/5" : "hover:bg-[var(--muted)]"}`}>
          <Progress value={STATUS_PROGRESS[caseItem.status]} className={`h-2 ${inverse ? "bg-white/15 [&_[data-slot=progress-indicator]]:bg-[#315f50]" : "bg-[var(--muted)] [&_[data-slot=progress-indicator]]:bg-[#315f50]"}`} />
          <span className={`shrink-0 text-xs font-semibold ${inverse ? "text-[var(--muted-foreground)]" : "text-[var(--muted-foreground)]"}`}>{STATUS_PROGRESS[caseItem.status]}%</span>
          <span className={`shrink-0 text-xs underline-offset-4 hover:underline ${inverse ? "text-white/70" : "text-[var(--muted-foreground)]"}`}>View journey</span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl border-[var(--border)] p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-[var(--border)] px-6 py-6 text-left">
          <DialogTitle className="text-2xl">Property onboarding journey</DialogTitle>
          <DialogDescription>{caseItem.propertyName || caseItem.propertyAddress} · every step from enquiry to live.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-6 py-6">
          {JOURNEY_STAGES.map((stage, index) => {
            const complete = index < current || caseItem.status === "live";
            const active = index === current && caseItem.status !== "live";
            return <div key={stage.title} className={`flex gap-4 rounded-2xl border p-4 ${active ? "border-[var(--border)] bg-[var(--muted)]" : complete ? "border-[var(--border)] bg-[var(--card)]" : "border-[var(--border)] bg-white"}`}><span className={`grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold ${complete ? "bg-[#315f50] text-white" : active ? "bg-[#1c3934] text-white" : "bg-[var(--muted)] text-[var(--muted-foreground)]"}`}>{complete ? <CheckCircle2 className="size-4" /> : String(index + 1).padStart(2, "0")}</span><div><p className="font-semibold">{stage.title}</p><p className="mt-1 text-sm leading-5 text-[var(--muted-foreground)]">{stage.description}</p>{active && <Badge className="mt-2 border-0 bg-[#1c3934] text-white">Current stage</Badge>}</div></div>;
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const JOURNEY_STAGES = [
  { title: "Enquiry received", description: "The client submits the property and Recharge prepares the performance estimate." },
  { title: "Estimate review", description: "The client reviews the estimate, asks questions and chooses whether to proceed." },
  { title: "Management agreement", description: "The client signs the pre-signed management agreement electronically." },
  { title: "Form and onboarding invoice", description: "Property details are submitted while Accounts issues and tracks the onboarding invoice." },
  { title: "Guest-readiness inspection", description: "Ready records safety, amenities, Wi-Fi, meters and guest-guide videos." },
  { title: "Quote and approvals", description: "The client accepts, considers, contests or rejects the itemised furnishing plan." },
  { title: "Ordering and installation", description: "Accounts places orders; Ready records deliveries, installation and the photographic inventory." },
  { title: "Guest ready", description: "All rooms and requirements reach 100% and the property joins routine maintenance." },
  { title: "Going live", description: "Stays completes listings, pricing, messaging, guidebook, photos and management approval." },
  { title: "Live", description: "The client receives the direct booking link and performance reporting begins." },
] as const;

function journeyStageIndex(status: OnboardingStatus) {
  if (["enquiry_received", "estimate_drafting"].includes(status)) return 0;
  if (["estimate_received", "reviewing", "not_proceeding"].includes(status)) return 1;
  if (status === "agreement_pending") return 2;
  if (status === "onboarding_form") return 3;
  if (["inspection_to_book", "inspection_booked", "reports_received"].includes(status)) return 4;
  if (["purchase_order_review", "purchase_order_approved", "purchase_order_rejected"].includes(status)) return 5;
  if (["invoices_pending", "furnishing", "guest_ready_scheduled"].includes(status)) return 6;
  if (status === "guest_ready") return 7;
  if (status === "listings_in_progress") return 8;
  return 9;
}

function EstimateBuilder({ caseItem, act, saving }: Omit<CaseActionProps, "upload">) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const comparables: Comparable[] = [0, 1, 2]
      .map((index) => ({
        name: String(form.get(`compName${index}`) || "").trim(),
        url: String(form.get(`compUrl${index}`) || "").trim(),
        adrPence: pounds(form.get(`compAdr${index}`)),
      }))
      .filter((item) => item.name);
    await act({
      action: "publish_estimate",
      id: caseItem.id,
      lowRatePence: pounds(form.get("low")),
      mediumRatePence: pounds(form.get("medium")),
      highRatePence: pounds(form.get("high")),
      comparables,
      comments: String(form.get("comments") || ""),
    }).catch(() => undefined);
  }
  return (
    <ActionCard icon={CircleDollarSign} eyebrow="Stays task" title="Build the performance estimate" description="Enter the projected nightly rates and up to three comparable properties. Monthly figures calculate at 75% occupancy.">
      <form onSubmit={submit} className="mt-5 space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <MoneyField name="low" label="Low nightly rate" />
          <MoneyField name="medium" label="Medium nightly rate" />
          <MoneyField name="high" label="High nightly rate" />
        </div>
        <div>
          <Label>Comparable properties</Label>
          <div className="mt-2 space-y-3">
            {[0, 1, 2].map((index) => (
              <div key={index} className="grid gap-2 rounded-xl bg-[var(--muted)] p-3 sm:grid-cols-[1fr_1.25fr_8rem]">
                <Input name={`compName${index}`} placeholder={`Comparable ${index + 1}`} />
                <Input name={`compUrl${index}`} type="url" placeholder="Listing URL" />
                <Input name={`compAdr${index}`} type="number" min="0" step="0.01" placeholder="ADR £" />
              </div>
            ))}
          </div>
        </div>
        <Field label="Additional comments"><Textarea name="comments" rows={4} placeholder="Seasonality, demand drivers, limitations or recommended positioning." /></Field>
        <Button disabled={saving} className="bg-[#1c3934] text-white hover:bg-[#10271f]">{saving ? "Publishing…" : "Publish estimate"} <ArrowRight /></Button>
      </form>
    </ActionCard>
  );
}

function EstimatePresentation({ caseItem, compact = false }: { caseItem: OnboardingCase; compact?: boolean }) {
  const [occupancy, setOccupancy] = useState(75);
  const rates = [
    ["Low", caseItem.lowNightlyRatePence],
    ["Medium", caseItem.mediumNightlyRatePence],
    ["High", caseItem.highNightlyRatePence],
  ] as const;
  return (
    <div className="space-y-5">
      {!compact && <ServicesAndProcess />}
      <ActionCard icon={BarChart3} eyebrow="Performance estimate" title="See how occupancy changes your revenue" description="Adjust the occupancy level to compare projected gross revenue by month and year.">
        <div className="mt-5 rounded-2xl bg-[#1c3934] p-5 text-white sm:p-6">
          <div className="flex items-end justify-between gap-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60">Projected occupancy</p><p className="mt-1 text-sm text-white/70">Move the slider to model different booking levels.</p></div>
            <span className="text-3xl font-semibold text-[var(--muted-foreground)]">{occupancy}%</span>
          </div>
          <Slider aria-label="Projected occupancy percentage" value={[occupancy]} onValueChange={(value) => setOccupancy(value[0])} min={10} max={100} step={5} className="mt-6 [&_[data-slot=slider-range]]:bg-[#315f50] [&_[data-slot=slider-thumb]]:border-[var(--border)]" />
          <div className="mt-3 flex justify-between text-xs text-white/50"><span>10%</span><span>100%</span></div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {rates.map(([label, value]) => (
            <div key={label} className="rounded-xl bg-[var(--muted)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">{label}</p>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">{money(value)} average nightly rate</p>
              <div className="mt-4 border-t border-[var(--border)] pt-4"><p className="text-xs text-[var(--muted-foreground)]">Per month</p><p className="mt-1 text-2xl font-semibold">{money(value ? Math.round(value * 30 * occupancy / 100) : null)}</p></div>
              <div className="mt-3"><p className="text-xs text-[var(--muted-foreground)]">Per year</p><p className="mt-1 text-lg font-semibold text-[var(--muted-foreground)]">{money(value ? Math.round(value * 365 * occupancy / 100) : null)}</p></div>
            </div>
          ))}
        </div>
        {caseItem.comparables.length > 0 && (
          <div className="mt-5 divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
            {caseItem.comparables.map((item) => (
              <div key={`${item.name}-${item.url}`} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                <a href={item.url || undefined} target="_blank" rel="noreferrer" className="font-semibold hover:underline">{item.name}</a>
                <span>{money(item.adrPence)} ADR</span>
              </div>
            ))}
          </div>
        )}
        {caseItem.estimateComments && <p className="mt-5 text-sm leading-6 text-[var(--muted-foreground)]">{caseItem.estimateComments}</p>}
      </ActionCard>
    </div>
  );
}

function ServicesAndProcess() {
  const stages = [
    ["01", "Performance estimate", "We review your property, local demand, comparable listings and achievable nightly rates."],
    ["02", "Agreement", "You review the management terms and sign securely through your dashboard."],
    ["03", "Property details", "We collect access, utilities, owner, banking and operational information in one place."],
    ["04", "Inspection", "Our team inspects every room, records condition and identifies guest-ready and safety requirements."],
    ["05", "Plan and approvals", "You receive clear inspection reports, furnishing requirements and costs for approval."],
    ["06", "Property preparation", "Recharge Ready coordinates furnishing, maintenance, compliance and final presentation."],
    ["07", "Listing launch", "We create and optimise listings, pricing, guest messaging, guidebooks and booking calendars."],
    ["08", "Ongoing performance", "We monitor pricing, occupancy, reviews and property standards after launch."],
  ];
  return (
    <div className="space-y-5">
      <ActionCard icon={Sparkles} eyebrow="What Recharge delivers" title="More than management: a complete route to stronger bookings" description="Open each service to see the work that goes into launching, protecting and growing your property.">
        <Accordion type="single" collapsible defaultValue="management" className="mt-5 overflow-hidden rounded-2xl border border-[var(--border)]">
          <ServiceAccordion value="management" number="01" title="Full-service property management">
            <p>We take responsibility for the entire guest journey and the day-to-day performance of your property—not simply putting a listing online.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[
                ["Listings that convert", "Professional listing copy, platform setup, photography coordination and continual optimisation across Airbnb, Booking.com, Comfy Workers and contractor networks."],
                ["Revenue and occupancy", "Active rate management, local demand monitoring, minimum-stay controls and calendar decisions designed to secure bookings without undervaluing your property."],
                ["Guest care", "Guest screening, enquiries, check-in guidance, stay support, issue resolution and review management throughout every reservation."],
                ["Reliable operations", "Cleaning coordination, linen, replenishments, four commercial waste collections each week and monthly garden care where required."],
                ["Property protection", "Monthly health and safety inspections, maintenance reporting, repair coordination and a clear record of property condition."],
                ["Clear owner reporting", "Transparent income, deductions and payout records, with one team coordinating Stays, Cleans and Recharge Ready."],
              ].map(([title, text]) => <div key={title} className="rounded-xl bg-white p-4"><p className="font-semibold text-[var(--foreground)]">{title}</p><p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">{text}</p></div>)}
            </div>
          </ServiceAccordion>
          <ServiceAccordion value="furnishing" number="02" title="Furnishing by Recharge Ready">
            <p>From an empty or tired property to a cohesive, guest-ready space. We inspect, build a room-by-room plan, prepare an itemised quote, source furniture and essentials, coordinate delivery and installation, and complete the final presentation check. Owners who prefer to furnish directly can use our requirements and calculator as their guide.</p>
          </ServiceAccordion>
          <ServiceAccordion value="licensing" number="03" title="Licensing and compliance support">
            <p>We coordinate the licensing journey, organise the supporting documents and safety evidence, track inspection and application milestones, and keep the requirements visible in your onboarding dashboard. Where specialist certificates or works are required, we help coordinate the appropriate contractor.</p>
          </ServiceAccordion>
        </Accordion>
      </ActionCard>
      <ActionCard icon={ClipboardCheck} eyebrow="Onboarding process" title="Your route from enquiry to booked-out property" description="Every stage is tracked in your dashboard, with the next action and responsible team made clear.">
        <div className="relative mt-6 grid gap-3 md:grid-cols-2">
          {stages.map(([number, title, text]) => <div key={number} className="group relative rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 transition hover:border-[var(--border)] hover:bg-[var(--muted)]"><div className="flex gap-4"><span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#1c3934] text-xs font-bold text-[var(--muted-foreground)]">{number}</span><div><p className="font-semibold text-[var(--foreground)]">{title}</p><p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">{text}</p></div></div></div>)}
        </div>
      </ActionCard>
    </div>
  );
}

function ClientDecisionForm({ caseItem, act, saving }: Omit<CaseActionProps, "upload">) {
  const [decision, setDecision] = useState<"proceed" | "reviewing" | "not_proceeding">("proceed");
  const [submitted, setSubmitted] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try { await act({
      action: "client_decision",
      id: caseItem.id,
      decision,
      feedback: String(form.get("feedback") || ""),
      reviewFollowUpDate: decision === "reviewing" ? form.get("reviewDate") || null : null,
    }); setSubmitted(true); } catch { setSubmitted(false); }
  }
  if (submitted) return <ActionCard icon={CheckCircle2} eyebrow="Submitted" title="Your response has been submitted" description={decision === "reviewing" ? "The Recharge team has received your questions and follow-up date. You do not need to click again." : decision === "proceed" ? "Your approval has been recorded. The management agreement is now ready." : "Your decision and feedback have been recorded."}><div className="mt-5 rounded-xl bg-[var(--muted)] px-4 py-4 text-sm font-semibold text-[var(--muted-foreground)]">Submitted successfully</div></ActionCard>;
  return (
    <div className="space-y-5">
    <ActionCard icon={CheckCircle2} eyebrow="Your decision" title="How would you like to proceed?" description="You can return and change a reviewing decision to proceed at any time.">
      <form onSubmit={submit} className="mt-5 space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <DecisionButton active={decision === "proceed"} tone="green" title="Approve estimate & proceed" onClick={() => setDecision("proceed")} />
          <DecisionButton active={decision === "reviewing"} tone="amber" title="I need more time" onClick={() => setDecision("reviewing")} />
          <DecisionButton active={decision === "not_proceeding"} tone="red" title="I won't proceed" onClick={() => setDecision("not_proceeding")} />
        </div>
        {decision === "reviewing" && <div className="grid gap-4 sm:grid-cols-2"><Field label="Questions for the Recharge team"><Textarea name="feedback" rows={4} required placeholder="Ask anything you would like us to clarify about the estimate or service." /></Field><Field label="When should we check in again?"><Input name="reviewDate" type="date" required /></Field></div>}
        {decision === "not_proceeding" && <Field label="Why have you decided not to proceed?"><Textarea name="feedback" rows={3} required placeholder="Your feedback helps us understand whether we can improve the proposal." /></Field>}
        <Button disabled={saving} className="bg-[#1c3934] text-white hover:bg-[#10271f]">Confirm response</Button>
      </form>
    </ActionCard>
    <FrequentlyAskedQuestions />
    </div>
  );
}

function AgreementForm({ caseItem, act, saving }: Omit<CaseActionProps, "upload">) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await act({ action: "sign_agreement", id: caseItem.id, signedName: String(form.get("signedName") || ""), responsiblePartyName: String(form.get("responsiblePartyName") || "") }).catch(() => undefined);
  }
  return (
    <ActionCard icon={FileCheck2} eyebrow="Management agreement" title="Review and sign the agreement" description="Confirm the legal person or business responsible for operating the property, read every section carefully, then enter your legal name and sign electronically. A completed copy will be stored in Documents.">
      <form onSubmit={submit} className="mt-5 space-y-4">
        <Field label="Person or business legally responsible for operating the property"><Input name="responsiblePartyName" required defaultValue={caseItem.businessName || caseItem.clientName} /></Field>
        <AgreementPreview caseItem={caseItem} />
        <div className="rounded-xl bg-[var(--muted)] p-4 text-sm leading-6 text-[var(--muted-foreground)]">
          Management fee: 15% + VAT. Onboarding fee: £475 including VAT per property. Payouts are calculated after applicable OTA, cleaning, repair and maintenance deductions and are normally paid between the 5th and 10th of the following month.
        </div>
        <Field label="Your full legal name"><Input name="signedName" required defaultValue={caseItem.clientName} /></Field>
        <label className="flex items-start gap-3 rounded-xl border border-[var(--border)] p-4 text-sm leading-6">
          <Checkbox required />
          <span>I have reviewed the management agreement and agree to sign electronically.</span>
        </label>
        <Button disabled={saving} className="bg-[#1c3934] text-white hover:bg-[#10271f]">Sign agreement <ArrowRight /></Button>
      </form>
    </ActionCard>
  );
}

function OnboardingChecklist({ caseItem }: { caseItem: OnboardingCase }) { const settled=caseItem.onboardingInvoiceStatus==="settled"; return <ActionCard icon={CheckCircle2} eyebrow="Your onboarding progress" title={settled?"Onboarding invoice settled":"Agreement signed"} description={settled?"Your agreement and onboarding invoice are complete.":"Your signed agreement is stored in Documents. Complete the onboarding form while Accounts prepares your £475 VAT-inclusive invoice."}><div className="mt-4 space-y-2"><div className="flex items-center gap-3 rounded-xl bg-[var(--muted)] px-4 py-3 text-sm font-semibold text-[var(--muted-foreground)]"><CheckCircle2 className="size-4" /><span className="line-through">Sign management agreement</span></div><div className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold ${settled?"bg-[var(--muted)] text-[var(--muted-foreground)]":"border border-[var(--border)]"}`}>{settled?<CheckCircle2 className="size-4" />:<span className="size-4 rounded-full border border-[var(--border)]" />}<span className={settled?"line-through":""}>Settle onboarding invoice</span></div></div></ActionCard>; }

function AgreementPreview({ caseItem }: { caseItem: OnboardingCase }) {
  const sections = [
    ["1. Appointment and services", "Recharge Group Ltd, trading as Recharge, is appointed as exclusive short-term-let manager. Services include guest communications, bookings, listings, pricing, housekeeping, maintenance coordination, supplies, reporting and client support."],
    ["2. Fees and payment", "The management fee is 15% + VAT after cleaning and OTA/payment fees. A separate onboarding fee of £475 including VAT applies per property. The client balance is normally paid between the 5th and 10th of the following month."],
    ["3. Client responsibilities", "The Client remains responsible for ownership or tenancy authority, mortgage or rent, utilities, council tax, insurance, licensing, safety certificates, repairs and accurate operational information."],
    ["4. Maintenance and emergencies", "Recharge may arrange routine work within recorded authority limits and take reasonable urgent action where delay risks a guest, the property or neighbouring premises."],
    ["5. Listings and bookings", "Recharge may manage listings, rates, minimum stays, promotions and availability. Revenue and occupancy are not guaranteed."],
    ["6. Guest damage and liability", "Recharge will assist with platform and insurance recovery. Unrecovered losses remain the Client’s responsibility unless caused by Recharge’s negligence or breach."],
    ["7. Term and termination", "The agreement continues until either party gives 90 days’ written notice, with immediate termination available for serious breach, illegality or unsafe conditions."],
    ["8–11. Data, confidentiality and law", "Both parties will protect confidential and personal information. Written variations, severability, Scots law and exclusive Scottish court jurisdiction apply."],
  ];
  return <div className="max-h-96 overflow-y-auto rounded-2xl border border-[var(--border)] bg-white p-5 text-sm leading-6"><h4 className="text-base font-semibold">Short-Term Let Management Agreement</h4><p className="mt-2 text-[var(--muted-foreground)]">Recharge Group Ltd (SC799955), trading as Recharge, 14 Newton Place, Glasgow, G3 7PY. Property: {caseItem.propertyAddress}.</p><div className="mt-4 rounded-xl bg-[var(--muted)] p-4 font-semibold">15% + VAT management fee · £475 onboarding fee including VAT per property</div>{sections.map(([title,text])=><div key={title} className="mt-4"><p className="font-semibold">{title}</p><p className="mt-1 text-[var(--muted-foreground)]">{text}</p></div>)}<div className="mt-6 border-t border-[var(--border)] pt-4"><p className="font-['Brush_Script_MT',cursive] text-3xl">Alexander Coghill</p><p className="font-semibold">Alexander Coghill</p><p className="text-[var(--muted-foreground)]">Director, Recharge Group Ltd · signed for the Manager</p></div></div>;
}

function EstimatePhotos({ caseItem }: { caseItem: OnboardingCase }) { const photos=caseItem.files.filter((file)=>file.kind==="enquiry_media" && file.contentType.startsWith("image/")); return <ActionCard icon={Sparkles} eyebrow="Photos" title="Estimate photos" description="Property images supplied with the enquiry are displayed here for estimate preparation.">{photos.length?<div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-3">{photos.map((file)=><a key={file.id} href={`/api/onboarding/files/${file.id}`} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-xl border border-[var(--border)]"><img src={`/api/onboarding/files/${file.id}`} alt={file.fileName} className="aspect-[4/3] w-full object-cover transition group-hover:scale-[1.02]" /><p className="truncate px-3 py-2 text-xs font-semibold">{file.fileName}</p></a>)}</div>:<p className="mt-4 rounded-xl bg-[var(--muted)] px-4 py-4 text-sm text-[var(--muted-foreground)]">No estimate photos were supplied.</p>}</ActionCard>; }

function ClientOnboardingForm({ caseItem, act, saving }: Omit<CaseActionProps, "upload">) {
  const [utilities, setUtilities] = useState(true);
  const [prepayment, setPrepayment] = useState(false);
  const [broadband, setBroadband] = useState(true);
  const [broadbandSetup, setBroadbandSetup] = useState(true);
  const [prepaymentSwitch, setPrepaymentSwitch] = useState(true);
  const [licensing, setLicensing] = useState(false);
  const [garden, setGarden] = useState(false);
  const [furnishing, setFurnishing] = useState<"self" | "recharge">("recharge");
  const [fullPermission, setFullPermission] = useState<Record<string, boolean>>({});
  const categories = ["Boiler & heating", "Electrical", "Plumbing", "Appliances", "Access & locks", "Other repairs"];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const permissions: RepairPermission[] = categories.map((category, index) => ({
      category,
      amountPence: fullPermission[category] ? 0 : pounds(form.get(`repair${index}`)),
      fullPermission: Boolean(fullPermission[category]),
    }));
    await act({
      action: "submit_onboarding_form",
      id: caseItem.id,
      businessName: form.get("businessName"),
      bankAccountName: form.get("bankAccountName"),
      bankAccountNumber: form.get("bankAccountNumber"),
      bankSortCode: form.get("bankSortCode"),
      accessDate: form.get("accessDate"),
      accessInfo: form.get("accessInfo"),
      utilitiesConnected: utilities,
      utilityInstallDate: utilities ? null : form.get("utilityInstallDate") || null,
      prepaymentMeters: prepayment,
      creditSwitchDate: prepayment ? form.get("creditSwitchDate") || null : null,
      broadbandConnected: broadband,
      broadbandInstallDate: broadband ? null : form.get("broadbandInstallDate") || null,
      hasGarden: garden,
      mailPreference: form.get("mailPreference"),
      warrantyDetails: form.get("warrantyDetails"),
      repairPermissions: permissions,
      furnishingChoice: furnishing,
      inspectionDate: furnishing === "self" ? form.get("inspectionDate") || null : null,
      broadbandSetupByRecharge: !broadband && broadbandSetup,
      broadbandCreditDetails: !broadband && broadbandSetup ? [
        `Name: ${String(form.get("wifiCreditName") || "")}`,
        `Date of birth: ${String(form.get("wifiDob") || "")}`,
        `Address history: ${String(form.get("wifiAddressHistory") || "")}`,
        `Bank account name: ${String(form.get("wifiBankName") || "")}`,
        `Sort code: ${String(form.get("wifiSortCode") || "")}`,
        `Account number: ${String(form.get("wifiAccountNumber") || "")}`,
        `Credit check consent: ${form.get("wifiConsent") ? "Yes" : "No"}`,
      ].join("\n") : "",
      prepaymentSwitchByRecharge: prepayment && prepaymentSwitch,
      licensingRequired: licensing,
    }).catch(() => undefined);
  }
  return (
    <ActionCard icon={Building2} eyebrow="Property onboarding" title="Complete your onboarding form" description="Follow each section and provide the confirmed information Recharge needs to set up, operate and pay out your property correctly.">
      <form onSubmit={submit} className="mt-5 space-y-6">
        <div className="rounded-2xl border border-[var(--border)] p-5">
          <h4 className="font-semibold">Property operation</h4>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">Confirm access and the person or business responsible for this property.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Responsible person or business"><Input name="businessName" required defaultValue={caseItem.businessName || caseItem.clientName} /></Field>
          <Field label="Property access date"><Input name="accessDate" type="date" required /></Field>
          </div>
          <div className="mt-4"><Field label="Access information"><Textarea name="accessInfo" required rows={3} placeholder="Keys, codes, parking and access instructions." /></Field></div>
        </div>
        <div className="rounded-2xl border border-[var(--border)] p-5">
          <h4 className="font-semibold">Payout information</h4>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">Enter the bank account Recharge should use for property payouts.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Account name"><Input name="bankAccountName" required /></Field>
          <Field label="Account number"><Input name="bankAccountNumber" inputMode="numeric" pattern="\d{8}" required /></Field>
          <Field label="Sort code"><Input name="bankSortCode" placeholder="00-00-00" pattern="\d{2}-?\d{2}-?\d{2}" required /></Field>
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--border)] p-5">
          <h4 className="font-semibold">Recharge Mailbox</h4>
          <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">All property mail will be photographed and added to your Recharge Mailbox. Choose whether envelopes may be opened for photographing or kept unopened for collection.</p>
          <div className="mt-4"><Field label="Mail handling preference"><Select name="mailPreference" required defaultValue="Open, photograph and upload to my Recharge Mailbox"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Open, photograph and upload to my Recharge Mailbox">Open, photograph and upload</SelectItem><SelectItem value="Photograph envelope only and keep unopened for collection">Keep unopened for collection</SelectItem></SelectContent></Select></Field></div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <YesNo title="Gas and electric connected?" value={utilities} onChange={setUtilities} />
          <YesNo title="Prepayment meters?" value={prepayment} onChange={setPrepayment} />
          <YesNo title="Does the property have Wi-Fi?" value={broadband} onChange={setBroadband} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {!utilities && <Field label="Utility installation date"><Input name="utilityInstallDate" type="date" required /></Field>}
          {prepayment && !prepaymentSwitch && <Field label="Credit meter switch date"><Input name="creditSwitchDate" type="date" required /></Field>}
          {!broadband && !broadbandSetup && <Field label="Wi-Fi installation date"><Input name="broadbandInstallDate" type="date" required /></Field>}
        </div>
        {prepayment && <div className="rounded-xl border border-[var(--border)] p-4"><YesNo title="Would you like Recharge to switch the prepayment meter to credit?" value={prepaymentSwitch} onChange={setPrepaymentSwitch} />{prepaymentSwitch && <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">A £50 labour charge applies for staff time to arrange the switch.</p>}</div>}
        {!broadband && <div className="space-y-4 rounded-xl border border-[var(--border)] p-4"><YesNo title="Would you like Recharge to arrange Wi-Fi installation?" value={broadbandSetup} onChange={setBroadbandSetup} />{broadbandSetup ? <><p className="text-sm leading-6 text-[var(--muted-foreground)]">A £50 labour charge applies for staff time. Complete each field below so the provider account and credit check can be arranged correctly.</p><div className="grid gap-4 sm:grid-cols-2"><Field label="Full legal name"><Input name="wifiCreditName" required /></Field><Field label="Date of birth"><Input name="wifiDob" type="date" required /></Field><Field label="Name on bank account"><Input name="wifiBankName" required /></Field><Field label="Sort code"><Input name="wifiSortCode" required placeholder="00-00-00" /></Field><Field label="Account number"><Input name="wifiAccountNumber" required inputMode="numeric" /></Field></div><Field label="Last three years of address history"><Textarea name="wifiAddressHistory" rows={4} required /></Field><label className="flex items-start gap-3 rounded-xl bg-[var(--muted)] p-4 text-sm leading-6"><Checkbox name="wifiConsent" required /><span>I consent to Recharge arranging the provider credit check on my behalf.</span></label></> : <p className="text-sm text-[var(--muted-foreground)]">You will need to provide the confirmed Wi-Fi installation date before onboarding can be completed.</p>}</div>}
        <YesNo title="Do you require licensing and compliance support?" value={licensing} onChange={setLicensing} />
        {licensing && <p className="rounded-xl bg-[var(--muted)] px-4 py-3 text-sm text-[var(--muted-foreground)]">A member of the Recharge licensing team will be in touch with you soon.</p>}
        <YesNo title="Does the property need routine garden maintenance?" value={garden} onChange={setGarden} />
        {garden && <p className="rounded-xl bg-[var(--muted)] px-4 py-3 text-sm text-[var(--muted-foreground)]">Our maintenance team will be in touch with a quote.</p>}
        <Field label="Warranty or repair contacts"><Textarea name="warrantyDetails" rows={3} placeholder="Optional warranty providers we should contact before arranging repairs." /></Field>
        <div>
          <Label>Repair auto-permission</Label>
          <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">Set the amount we can authorise without contacting you. We will seek the most cost-effective price. In an emergency, we may need to exceed a limit if a delayed response risks the property or guest.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {categories.map((category, index) => (
              <div key={category} className="rounded-xl border border-[var(--border)] p-4">
                <p className="text-sm font-semibold">{category}</p>
                <div className="mt-3 flex items-center gap-3">
                  <Input name={`repair${index}`} type="number" min="0" step="1" placeholder="£ limit" disabled={fullPermission[category]} required={!fullPermission[category]} />
                  <label className="flex shrink-0 items-center gap-2 text-xs"><Checkbox checked={Boolean(fullPermission[category])} onCheckedChange={(value) => setFullPermission((current) => ({ ...current, [category]: value === true }))} />Full permission</label>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <Label>Furnishing route</Label>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <ChoiceCard active={furnishing === "recharge"} title="Recharge furnishing" text="Ready will inspect, quote, source and install." onClick={() => setFurnishing("recharge")} />
            <ChoiceCard active={furnishing === "self"} title="Self-furnish" text="Use the self-furnishing calculator and choose an inspection date." onClick={() => setFurnishing("self")} />
          </div>
        </div>
        {furnishing === "self" && (
          <div className="rounded-xl bg-[var(--muted)] p-4">
            <a className="text-sm font-semibold text-[var(--foreground)] underline" href="/tool/client-furnishing" target="_blank">Open the self-furnishing calculator</a>
            <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">Enter the inspection date only when you are absolutely certain. There is no rush—Ready will use the date you provide to schedule the inspection team.</p>
            <div className="mt-4"><Field label="Confirmed inspection date (optional for now)"><Input name="inspectionDate" type="date" /></Field></div>
          </div>
        )}
        <Button disabled={saving} className="bg-[#1c3934] text-white hover:bg-[#10271f]">Submit onboarding form <ArrowRight /></Button>
      </form>
    </ActionCard>
  );
}

function StaffReviewResponse({ caseItem, act, saving }: Omit<CaseActionProps, "upload">) {
  const overdue = caseItem.reviewFollowUpDate && new Date(`${caseItem.reviewFollowUpDate}T23:59:59`).getTime() < Date.now();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await act({ action: "staff_update", id: caseItem.id, note: form.get("note"), nextFollowUpDate: form.get("nextFollowUpDate") || null, resolution: form.get("resolution") }).catch(() => undefined);
    event.currentTarget.reset();
  }
  return <ActionCard icon={Clock3} eyebrow="Sign-up activity" title={caseItem.status === "not_proceeding" ? "Review the client's feedback" : overdue ? "Follow-up overdue" : `Follow up ${caseItem.reviewFollowUpDate ? `on ${caseItem.reviewFollowUpDate}` : "within 48 hours"}`} description={caseItem.decisionFeedback || "Respond to the client's questions and keep the next follow-up date visible to both sides."}><form onSubmit={submit} className="mt-5 space-y-4"><Field label="Response or update"><Textarea name="note" rows={4} required placeholder="Answer each question or record the latest follow-up outcome." /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Next follow-up date"><Input name="nextFollowUpDate" type="date" /></Field><Field label="Outcome"><Select name="resolution" defaultValue={caseItem.status === "not_proceeding" ? "archive" : "response"}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="response">Reply and keep current status</SelectItem><SelectItem value="continue">Continue conversation</SelectItem><SelectItem value="archive">Archive as not proceeding</SelectItem></SelectContent></Select></Field></div><Button disabled={saving} className="bg-[#1c3934] text-white">Send update to client</Button></form></ActionCard>;
}

function SelfFurnishInspectionDate({ caseItem, act, saving }: Omit<CaseActionProps, "upload">) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await act({ action: "set_self_inspection_date", id: caseItem.id, inspectionDate: form.get("inspectionDate") }).catch(() => undefined);
  }
  return <ActionCard icon={CalendarDays} eyebrow="Self-furnishing" title="Confirm your guest-readiness inspection date" description="Only enter this once you are absolutely certain. There is no rush—the inspection team will use this date when planning the visit."><form onSubmit={submit} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end"><Field label="Confirmed inspection date"><Input name="inspectionDate" type="date" required /></Field><Button disabled={saving} className="bg-[#1c3934] text-white">Confirm inspection date</Button></form><a className="mt-4 inline-flex text-sm font-semibold text-[var(--foreground)] underline" href="/tool/client-furnishing" target="_blank">Open the self-furnishing calculator</a></ActionCard>;
}

function InspectionBooking({ caseItem, act, saving }: Omit<CaseActionProps, "upload">) {
  return <SimpleDateAction icon={CalendarDays} title="Book the Ready inspection" label="Inspection date" action="book_inspection" caseItem={caseItem} act={act} saving={saving} />;
}

function GuestReadyDate({ caseItem, act, saving }: Omit<CaseActionProps, "upload">) {
  return <SimpleDateAction icon={CalendarDays} title="Set the estimated guest-ready date" label="Estimated guest-ready date" action="set_guest_ready_date" caseItem={caseItem} act={act} saving={saving} />;
}

function SimpleDateAction({ icon, title, label, action, caseItem, act, saving }: { icon: typeof CalendarDays; title: string; label: string; action: string } & Omit<CaseActionProps, "upload">) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await act({ action, id: caseItem.id, date: form.get("date"), inspectionDate: form.get("date") }).catch(() => undefined);
  }
  return <ActionCard icon={icon} eyebrow="Ready task" title={title} description="This date updates the client dashboard and queues an email notification."><form onSubmit={submit} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end"><Field label={label}><Input name="date" type="date" required /></Field><Button disabled={saving} className="h-10 bg-[#1c3934] text-white">Save date</Button></form></ActionCard>;
}

function ReportPublishing({ caseItem, act, upload, saving }: CaseActionProps) {
  const [percent, setPercent] = useState(caseItem.healthSafetyPercent);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await act({ action: "publish_reports", id: caseItem.id, healthSafetyPercent: percent }).catch(() => undefined);
  }
  return (
    <ActionCard icon={ShieldCheck} eyebrow="Ready inspection" title="Publish the guest-readiness report and quote" description="Record guest safety, amenities, working Wi-Fi, meter type, how-to videos for the guest guidebook, and three labelled photos of every room.">
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <a className="rounded-xl border border-[var(--border)] p-4 text-sm font-semibold hover:bg-[var(--muted)]" href="/tool/purchase-order" target="_blank">Open Purchase Order Quotes →</a>
        <a className="rounded-xl border border-[var(--border)] p-4 text-sm font-semibold hover:bg-[var(--muted)]" href="/tool/safety-maintenance" target="_blank">Open Health & Safety Report →</a>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <QuickUpload label="Upload purchase order" caseItem={caseItem} kind="purchase_order" upload={upload} />
        <QuickUpload label="Upload safety report" caseItem={caseItem} kind="health_safety_report" upload={upload} />
      </div>
      <RoomPhotoUpload caseItem={caseItem} upload={upload} />
      <form onSubmit={submit} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Health & safety completion %"><Input type="number" min="0" max="100" value={percent} onChange={(event) => setPercent(Number(event.target.value))} /></Field>
        <Button disabled={saving} className="h-10 bg-[#1c3934] text-white">Publish reports to client</Button>
      </form>
    </ActionCard>
  );
}

function PurchaseOrderDecision({ caseItem, act, saving }: Omit<CaseActionProps, "upload">) {
  const [decision, setDecision] = useState<"accept" | "consider" | "contest" | "reject">("accept");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await act({ action: "quote_decision", id: caseItem.id, decision, reason: String(form.get("reason") || ""), followUpDate: decision === "consider" ? form.get("followUpDate") || null : null }).catch(() => undefined);
  }
  return (
    <ActionCard icon={FileCheck2} eyebrow="Your approval" title="Review the guest-readiness report and quote" description="Choose what happens next. You can ask Ready to revise the quote before accepting it.">
      <form onSubmit={submit} className="mt-5 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DecisionButton active={decision === "accept"} tone="green" title="Accept quote" onClick={() => setDecision("accept")} />
          <DecisionButton active={decision === "consider"} tone="amber" title="Consider quote" onClick={() => setDecision("consider")} />
          <DecisionButton active={decision === "contest"} tone="amber" title="Contest quote" onClick={() => setDecision("contest")} />
          <DecisionButton active={decision === "reject"} tone="red" title="Reject quote" onClick={() => setDecision("reject")} />
        </div>
        {decision === "consider" && <Field label="When should Ready follow up?"><Input name="followUpDate" type="date" required /></Field>}
        {["contest", "reject"].includes(decision) && <Field label={decision === "contest" ? "What would you like changed?" : "Why are you rejecting the quote?"}><Textarea name="reason" required rows={3} /></Field>}
        <Button disabled={saving} className="bg-[#1c3934] text-white">Confirm decision</Button>
      </form>
    </ActionCard>
  );
}

function QuoteRevisionPanel({ caseItem, act, saving }: Omit<CaseActionProps, "upload">) {
  return <ActionCard icon={FileCheck2} eyebrow="Ready response" title="Respond and send a revised quote" description={caseItem.purchaseOrderRejectionReason || "Review the client's feedback within 24 hours and decide whether to revise or archive the furnishing quote."}><div className="mt-5 flex flex-wrap gap-3"><Button disabled={saving} className="bg-[#1c3934] text-white" onClick={() => act({ action: "publish_reports", id: caseItem.id, healthSafetyPercent: caseItem.healthSafetyPercent }).catch(() => undefined)}>Send revised quote</Button><Button variant="outline" disabled={saving} onClick={() => act({ action: "staff_update", id: caseItem.id, note: "Ready reviewed the rejected quote and archived the furnishing proposal. Property onboarding remains active.", nextFollowUpDate: null, resolution: "response" }).catch(() => undefined)}>Archive furnishing quote</Button></div></ActionCard>;
}

function AccountsControls({ caseItem, act, saving }: Omit<CaseActionProps, "upload">) {
  const invoices = [
    ["onboarding", "Onboarding invoice", caseItem.onboardingInvoiceStatus],
    ["purchase_order", "Purchase order invoice", caseItem.purchaseOrderInvoiceStatus],
    ["supplier", "Ready supplier invoice", caseItem.supplierInvoiceStatus],
  ] as const;
  return (
    <ActionCard icon={CircleDollarSign} eyebrow="Accounts workflow" title="Invoice settlement" description="The downstream Accounts boards mirror these states on the same onboarding record.">
      <div className="mt-5 space-y-3">
        {invoices.map(([invoice, label, status]) => (
          <div key={invoice} className="flex flex-col justify-between gap-3 rounded-xl border border-[var(--border)] p-4 sm:flex-row sm:items-center">
            <div><p className="text-sm font-semibold">{label}</p><p className="mt-1 text-xs text-[var(--muted-foreground)]">Status: {humanise(status)}</p></div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={saving || status === "pending"} onClick={() => act({ action: "invoice_status", id: caseItem.id, invoice, status: "pending" }).catch(() => undefined)}>Invoice sent</Button>
              <Button size="sm" disabled={saving || status === "settled"} className="bg-[#1c3934] text-white" onClick={() => act({ action: "invoice_status", id: caseItem.id, invoice, status: "settled" }).catch(() => undefined)}>Settled</Button>
            </div>
          </div>
        ))}
      </div>
    </ActionCard>
  );
}

function GuestReadyConfirmation({ caseItem, act, saving }: Omit<CaseActionProps, "upload">) {
  const rooms = roomCounts(caseItem);
  return <ActionCard icon={CheckCircle2} eyebrow="Final inspection" title="Confirm the property is guest ready" description="A 100% guest-readiness result and three photos per labelled room are required."><div className="mt-4 flex flex-wrap gap-2">{Object.entries(rooms).map(([room, count]) => <Badge key={room} variant="outline">{room}: {count}/3 photos</Badge>)}</div><Button disabled={saving} className="mt-5 bg-[#1c3934] text-white" onClick={() => act({ action: "confirm_guest_ready", id: caseItem.id }).catch(() => undefined)}>Mark guest ready</Button></ActionCard>;
}

function LaunchChecklist({ caseItem, act, saving }: Omit<CaseActionProps, "upload">) {
  const [messages, setMessages] = useState(false);
  const [photos, setPhotos] = useState(false);
  const [pricing, setPricing] = useState(false);
  const [amenities, setAmenities] = useState(false);
  const [secondary, setSecondary] = useState(false);
  const [approval, setApproval] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const platforms = ["Airbnb", "Booking.com", "Comfy Workers", "Direct"] as const;
    const listingLinks: ListingLink[] = platforms.map((platform, index) => ({ platform, url: String(form.get(`link${index}`) || "") }));
    await act({ action: "publish_live", id: caseItem.id, listingLinks, automatedMessagesReady: messages, socialPostReady: photos && pricing && amenities && secondary && approval, guidebookUrl: form.get("guidebookUrl") }).catch(() => undefined);
  }
  return (
    <ActionCard icon={Home} eyebrow="Stays launch" title="Prepare listings for management approval" description="Complete every launch control, then submit the property for the manager to make live.">
      <form onSubmit={submit} className="mt-5 space-y-4">
        <div className="rounded-2xl border border-[var(--border)] p-4"><div className="flex items-center justify-between gap-3"><Label>AI listing copy</Label><Button type="button" variant="outline" size="sm" onClick={() => { setTitle(`${caseItem.bedrooms}-bed stay in ${caseItem.propertyAddress.split(",").at(-2)?.trim() || "Scotland"}`); setDescription(`A comfortable ${caseItem.propertyType.toLowerCase()} prepared for reliable short and extended stays, with ${caseItem.bedrooms} bedrooms and convenient access to the surrounding area.`); }}>Generate with AI</Button></div><div className="mt-3 grid gap-3"><Input value={title} onChange={(event) => setTitle(event.target.value)} required placeholder="Listing title" /><Textarea value={description} onChange={(event) => setDescription(event.target.value)} required rows={4} placeholder="Listing description" /></div></div>
        <div className="grid gap-3 sm:grid-cols-2">
          {["Airbnb", "Booking.com", "Comfy Workers", "Direct"].map((platform, index) => <Field key={platform} label={`${platform} link`}><Input name={`link${index}`} type="url" required /></Field>)}
        </div>
        <Field label="Guest guidebook URL"><Input name="guidebookUrl" type="url" required /></Field>
        <div className="grid gap-3 sm:grid-cols-2">{[[messages,setMessages,"Automated guest messages added"],[photos,setPhotos,"All Ready photos improved with AI"],[pricing,setPricing,"Minimum stay and PriceLabs pricing set"],[amenities,setAmenities,"AI amenity check completed"],[secondary,setSecondary,"Secondary 14-night enquiry listing created"],[approval,setApproval,"Management approval received"]].map(([checked,setChecked,label]) => <label key={String(label)} className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3 text-sm"><Checkbox checked={checked as boolean} onCheckedChange={(value) => (setChecked as (value:boolean)=>void)(value === true)} />{String(label)}</label>)}</div>
        <Button disabled={saving || !messages || !photos || !pricing || !amenities || !secondary || !approval} className="bg-[#1c3934] text-white">Publish property live <Sparkles /></Button>
      </form>
    </ActionCard>
  );
}

function Documents({ caseItem, upload, client = false }: { caseItem: OnboardingCase; upload: CaseActionProps["upload"]; client?: boolean }) {
  return (
    <ActionCard icon={FileText} eyebrow="Shared documents" title="Files on this onboarding" description="Documents stay attached to the same record for the client and every Recharge team.">
      <div className="mt-5 space-y-2">
        {caseItem.files.map((file) => (
          <a key={file.id} href={`/api/onboarding/files/${file.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-4 py-3 text-sm hover:bg-[var(--card)]">
            <span className="min-w-0 truncate font-semibold">{file.fileName}{file.roomLabel ? ` · ${file.roomLabel}` : ""}</span>
            <span className="shrink-0 text-xs text-[var(--muted-foreground)]">{humanise(file.kind)}</span>
          </a>
        ))}
        {!caseItem.files.length && <p className="rounded-xl bg-[var(--muted)] px-4 py-4 text-sm text-[var(--muted-foreground)]">No files uploaded yet.</p>}
      </div>
      {client && caseItem.status === "enquiry_received" && <QuickUpload label="Add another property photo or video" caseItem={caseItem} kind="enquiry_media" upload={upload} />}
      {!client && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <QuickUpload label="Attach pre-signed agreement" caseItem={caseItem} kind="management_agreement" upload={upload} />
          <QuickUpload label="Attach purchase order" caseItem={caseItem} kind="purchase_order" upload={upload} />
          <QuickUpload label="Attach health & safety report" caseItem={caseItem} kind="health_safety_report" upload={upload} />
          <QuickUpload label="Attach Ready supplier invoice" caseItem={caseItem} kind="supplier_invoice" upload={upload} />
        </div>
      )}
    </ActionCard>
  );
}

function PropertyGroupChat({ caseItem, act, saving, client = false }: { caseItem: OnboardingCase; act: CaseActionProps["act"]; saving: boolean; client?: boolean }) {
  const messages = caseItem.updates.filter((update) => update.eventType === "property_chat");
  const [sent, setSent] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await act({ action: "post_chat_message", id: caseItem.id, message: String(data.get("message") || "") });
      form.reset();
      setSent(true);
      window.setTimeout(() => setSent(false), 3500);
    } catch { setSent(false); }
  }
  return <ActionCard icon={MessageSquare} eyebrow="Property group chat" title={caseItem.propertyName || caseItem.propertyAddress} description="Keep questions, decisions and property updates in one shared conversation for the client and Recharge teams.">
    <div className="mt-5 max-h-80 space-y-3 overflow-y-auto rounded-2xl bg-[var(--muted)] p-4">
      {messages.map((message) => { const mine = client ? message.actorName === caseItem.clientName : message.actorName !== caseItem.clientName; return <div key={message.id} className={`max-w-[88%] rounded-2xl px-4 py-3 ${mine ? "ml-auto bg-[#1c3934] text-white" : "bg-white"}`}><p className="text-sm leading-6">{message.note}</p><p className={`mt-2 text-xs ${mine ? "text-white/55" : "text-[var(--muted-foreground)]"}`}>{message.actorName} · {dateTime(message.createdAt)}</p></div>; })}
      {!messages.length && <p className="text-sm text-[var(--muted-foreground)]">No messages yet. Start the property conversation below.</p>}
    </div>
    <form onSubmit={submit} className="mt-4 space-y-3"><Field label="Message"><Textarea name="message" rows={3} required placeholder="Ask a question or post an update for this property…" /></Field><div className="flex items-center gap-3"><Button disabled={saving} className="bg-[#1c3934] text-white">Send message</Button>{sent && <span className="text-sm font-semibold text-[var(--muted-foreground)]">Message submitted</span>}</div></form>
  </ActionCard>;
}

function ActivityTimeline({ caseItem }: { caseItem: OnboardingCase }) {
  return (
    <ActionCard icon={Clock3} eyebrow="Shared history" title="Onboarding activity" description="Every client and team update is recorded here.">
      <div className="mt-5 space-y-4">
        {caseItem.updates.map((item) => (
          <div key={item.id} className="flex gap-3">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-[#76ad49]" />
            <div><p className="text-sm font-medium">{item.note}</p><p className="mt-1 text-xs text-[var(--muted-foreground)]">{item.actorName} · {dateTime(item.createdAt)}</p></div>
          </div>
        ))}
      </div>
    </ActionCard>
  );
}

function NewEnquiryDialog({ currentUser, act, upload, saving }: { currentUser: User; act: CaseActionProps["act"]; upload: CaseActionProps["upload"]; saving: boolean }) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = (await act({
        action: "create_enquiry",
        clientName: currentUser.role === "client" ? undefined : form.get("clientName"),
        clientEmail: currentUser.role === "client" ? undefined : form.get("clientEmail"),
        propertyAddress: form.get("propertyAddress"),
        propertyType: form.get("propertyType"),
        bedrooms: Number(form.get("bedrooms")),
        bathrooms: Number(form.get("bathrooms")),
      })) as { id?: string };
      const files = form.getAll("media").filter((value): value is File => value instanceof File && value.size > 0);
      if (result.id && files.length) {
        setUploading(true);
        for (const file of files) await upload(result.id, "enquiry_media", file);
        setUploading(false);
      }
      setSubmitted(true);
    } catch {
      setUploading(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) setSubmitted(false); }}>
      <DialogTrigger asChild><Button className="h-11 rounded-xl bg-[#1c3934] px-5 text-white hover:bg-[#10271f]"><Plus /> New property enquiry</Button></DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl border-[var(--border)] p-0 sm:max-w-2xl">
        {submitted ? <div className="p-8 text-center"><div className="mx-auto grid size-14 place-items-center rounded-full bg-[var(--muted)] text-[var(--muted-foreground)]"><CheckCircle2 /></div><DialogTitle className="mt-5 text-2xl">Estimate request submitted</DialogTitle><DialogDescription className="mx-auto mt-3 max-w-md text-sm leading-6">Your performance estimate request has been submitted. A member of the Recharge team will send your estimate within 48 hours.</DialogDescription><Button className="mt-6 bg-[#1c3934] text-white" onClick={() => setOpen(false)}>Done</Button></div> : <form onSubmit={submit}>
          <DialogHeader className="border-b border-[var(--border)] px-6 py-6 text-left">
            <DialogTitle className="text-2xl tracking-[-0.035em]">Request a performance estimate</DialogTitle>
            <DialogDescription>Tell us about the property and add any useful photos or videos. We aim to deliver your estimate within 48 hours.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5 px-6 py-6">
            {currentUser.role !== "client" && <div className="grid gap-4 sm:grid-cols-2"><Field label="Client name"><Input name="clientName" required /></Field><Field label="Client email"><Input name="clientEmail" type="email" required /></Field></div>}
            <Field label="Property address"><Textarea name="propertyAddress" rows={3} required placeholder="Full property address including postcode" /></Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Property type"><Select name="propertyType" required><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent><SelectItem value="Flat">Flat</SelectItem><SelectItem value="House">House</SelectItem><SelectItem value="Cottage">Cottage</SelectItem><SelectItem value="Apartment">Apartment</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent></Select></Field>
              <Field label="Bedrooms"><Input name="bedrooms" type="number" min="0" max="40" required /></Field>
              <Field label="Bathrooms"><Input name="bathrooms" type="number" min="0" max="40" required /></Field>
            </div>
            <Field label="Photos and videos (optional)"><Input name="media" type="file" accept="image/*,video/*" multiple /></Field>
            <div className="rounded-xl bg-[var(--muted)] px-4 py-3 text-sm leading-6 text-[var(--muted-foreground)]">Thank you for filling out the form. Recharge aims to deliver performance estimates within 48 hours of your request.</div>
          </div>
          <DialogFooter className="border-t border-[var(--border)] px-6 py-5"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={saving || uploading} className="bg-[#1c3934] text-white">{uploading ? "Uploading…" : saving ? "Submitting…" : "Submit enquiry"}</Button></DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>
  );
}

function QuickUpload({ label, caseItem, kind, upload }: { label: string; caseItem: OnboardingCase; kind: OnboardingFileKind; upload: CaseActionProps["upload"] }) {
  const [busy, setBusy] = useState(false);
  return <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed border-[var(--border)] bg-[var(--card)] px-4 py-4 text-sm font-semibold hover:bg-[var(--muted)]"><span>{busy ? "Uploading…" : label}</span><Upload className="size-4" /><input className="sr-only" type="file" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; setBusy(true); await upload(caseItem.id, kind, file).catch(() => undefined); setBusy(false); }} /></label>;
}

function RoomPhotoUpload({ caseItem, upload }: { caseItem: OnboardingCase; upload: CaseActionProps["upload"] }) {
  const [room, setRoom] = useState("");
  const [busy, setBusy] = useState(false);
  return <div className="mt-4 rounded-xl border border-[var(--border)] p-4"><Label>Room inspection photos</Label><p className="mt-1 text-xs text-[var(--muted-foreground)]">Enter the room name and upload three photos from different angles.</p><div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr]"><Input value={room} onChange={(event) => setRoom(event.target.value)} placeholder="e.g. Main bedroom" /><Input type="file" accept="image/*" multiple onChange={async (event) => { const files = Array.from(event.target.files || []); if (!room.trim() || !files.length) return; setBusy(true); for (const file of files) await upload(caseItem.id, "room_photo", file, room).catch(() => undefined); setBusy(false); }} /></div>{busy && <p className="mt-2 text-xs text-[var(--muted-foreground)]">Uploading room photos…</p>}</div>;
}

function ActionCard({ icon: Icon, eyebrow, title, description, children }: { icon: typeof Home; eyebrow: string; title: string; description: string; children?: React.ReactNode }) {
  return <section className="rounded-[1.35rem] border border-[var(--border)] bg-white p-5"><div className="flex items-start gap-4"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--muted)] text-[var(--muted-foreground)]"><Icon className="size-4" /></div><div><p className="text-[0.66rem] font-semibold uppercase tracking-[0.15em] text-[var(--muted-foreground)]">{eyebrow}</p><h3 className="mt-1.5 text-xl font-semibold tracking-[-0.025em]">{title}</h3><p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">{description}</p></div></div>{children}</section>;
}

function DashboardCard({ icon: Icon, title, value, note }: { icon: typeof Home; title: string; value: string; note: string }) {
  return <article className="rounded-[1.35rem] border border-[var(--border)] bg-white p-5"><div className="flex items-center justify-between"><Icon className="size-5 text-[var(--muted-foreground)]" /><span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">{title}</span></div><p className="mt-8 text-3xl font-semibold tracking-[-0.04em]">{value}</p><p className="mt-2 text-sm text-[var(--muted-foreground)]">{note}</p></article>;
}

function MiniStat({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return <article className={`rounded-[1.25rem] border p-4 ${accent ? "border-[var(--border)] bg-[var(--muted)]" : "border-[var(--border)] bg-white"}`}><p className="text-xs font-semibold uppercase tracking-[0.11em] text-[var(--muted-foreground)]">{label}</p><p className="mt-5 text-3xl font-semibold">{value}</p></article>;
}

function DecisionButton({ active, tone, title, onClick }: { active: boolean; tone: "green" | "amber" | "red"; title: string; onClick: () => void }) {
  const tones = { green: "border-green-300 bg-green-50 text-green-900", amber: "border-amber-300 bg-amber-50 text-amber-900", red: "border-red-300 bg-red-50 text-red-900" };
  return <button type="button" onClick={onClick} className={`rounded-xl border p-4 text-left text-sm font-semibold transition ${active ? tones[tone] : "border-[var(--border)] bg-white text-[var(--muted-foreground)]"}`}>{title}</button>;
}

function ChoiceCard({ active, title, text, onClick }: { active: boolean; title: string; text: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`rounded-xl border p-4 text-left ${active ? "border-[var(--border)] bg-[var(--muted)]" : "border-[var(--border)]"}`}><span className="block text-sm font-semibold">{title}</span><span className="mt-1 block text-xs leading-5 text-[var(--muted-foreground)]">{text}</span></button>;
}

function YesNo({ title, value, onChange }: { title: string; value: boolean; onChange: (value: boolean) => void }) {
  return <div className="rounded-xl border border-[var(--border)] p-4"><p className="text-sm font-semibold">{title}</p><div className="mt-3 flex gap-2"><Button type="button" size="sm" variant={value ? "default" : "outline"} className={value ? "bg-[#1c3934] text-white" : ""} onClick={() => onChange(true)}>Yes</Button><Button type="button" size="sm" variant={!value ? "default" : "outline"} className={!value ? "bg-[#1c3934] text-white" : ""} onClick={() => onChange(false)}>No</Button></div></div>;
}

function ServiceAccordion({ value, number, title, children }: { value: string; number: string; title: string; children: React.ReactNode }) {
  return <AccordionItem value={value} className="border-[var(--border)] bg-[var(--muted)] px-5"><AccordionTrigger className="py-5 text-base font-semibold text-[var(--foreground)] hover:no-underline"><span className="flex items-center gap-3"><span className="text-xs font-bold tracking-[0.12em] text-[var(--muted-foreground)]">{number}</span>{title}</span></AccordionTrigger><AccordionContent className="pb-5 text-sm leading-6 text-[var(--muted-foreground)]">{children}</AccordionContent></AccordionItem>;
}

function FrequentlyAskedQuestions() {
  const questions = [
    ["How much do you charge?", <><p>Our management fee is <strong>15% + VAT</strong>.</p><p className="mt-2">Your payout is calculated from gross booking revenue, less booking-platform fees, cleaning charges, our management fee, and any authorised repairs or maintenance. The remaining balance is paid between the 5th and 10th of the following month with a clear breakdown.</p></>],
    ["How do you dispose of waste?", <p>We work with a commercial waste collector who collects waste from your property four times a week, helping ensure it remains waste-free between and during guest stays.</p>],
    ["How do you maintain gardens?", <p>Garden maintenance is arranged monthly. During winter, we review the required frequency so visits remain appropriate for the season and the property.</p>],
    ["How do you maintain properties?", <p>We complete monthly health and safety inspection reports, record any concerns and coordinate required maintenance through Recharge Ready. This creates a consistent record of standards and helps us deal with issues before they affect guests.</p>],
    ["Where do you list properties?", <p>We list across Airbnb, Booking.com and Comfy Workers, as well as other contractor networks. We manage the calendars and positioning together so the property can reach leisure, business and longer-stay guests.</p>],
  ];
  return <ActionCard icon={FileText} eyebrow="Frequently asked questions" title="What property owners usually ask us" description="Clear answers about fees, operations and how we look after your property."><Accordion type="single" collapsible className="mt-5 rounded-2xl border border-[var(--border)] px-5">{questions.map(([question, answer]) => <AccordionItem key={String(question)} value={String(question)} className="border-[var(--border)]"><AccordionTrigger className="py-5 text-base font-semibold text-[var(--foreground)] hover:no-underline">{question}</AccordionTrigger><AccordionContent className="pb-5 text-sm leading-6 text-[var(--muted-foreground)]">{answer}</AccordionContent></AccordionItem>)}</Accordion></ActionCard>;
}

function MoneyField({ name, label }: { name: string; label: string }) {
  return <Field label={label}><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--muted-foreground)]">£</span><Input name={name} type="number" min="1" step="0.01" required className="pl-7" /></div></Field>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0 space-y-2"><Label>{label}</Label>{children}</div>;
}

function EmptyCases() {
  return <div className="rounded-[1.5rem] border border-dashed border-[var(--border)] bg-white px-6 py-12 text-center"><Building2 className="mx-auto size-7 text-[var(--muted-foreground)]" /><h2 className="mt-4 text-xl font-semibold">No property enquiries yet</h2><p className="mt-2 text-sm text-[var(--muted-foreground)]">Create a new property enquiry to begin the onboarding journey.</p></div>;
}

function Unavailable({ onBack }: { onBack: () => void }) {
  return <section className="rounded-[1.5rem] border border-[var(--border)] bg-white p-8"><Button variant="ghost" onClick={onBack}><ArrowLeft /> Back</Button><h1 className="mt-5 text-3xl font-semibold">Property onboarding is temporarily unavailable</h1><p className="mt-3 text-[var(--muted-foreground)]">Please try again shortly.</p></section>;
}

function NextStepSummary({ caseItem }: { caseItem: OnboardingCase }) {
  return <ActionCard icon={Clock3} eyebrow="Current position" title={STATUS_LABELS[caseItem.status]} description={caseItem.status === "live" ? "This property is fully onboarded and stored in the Management Property Database." : "The next action sits with the client or another Recharge department. Updates will appear here automatically."} />;
}

function nextActionVisible(item: OnboardingCase) {
  return item.status === "enquiry_received" || (item.formSubmittedAt && !item.inspectionBookedAt) || (item.inspectionBookedAt && !item.reportsPublishedAt) || (item.supplierInvoiceStatus === "settled" && !item.estimatedGuestReadyDate) || (item.healthSafetyPercent === 100 && item.status !== "guest_ready" && item.status !== "live") || item.status === "guest_ready";
}

function roomCounts(item: OnboardingCase) {
  return item.files.filter((file) => file.kind === "room_photo").reduce<Record<string, number>>((counts, file) => ({ ...counts, [file.roomLabel]: (counts[file.roomLabel] || 0) + 1 }), {});
}

function pounds(value: FormDataEntryValue | null) {
  return Math.round(Number(value || 0) * 100);
}

function money(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value / 100);
}

function dateTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp * 1000));
}

function humanise(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function firstName(value: string) {
  return value.includes("@") ? value.split("@")[0] : value.split(" ")[0];
}
