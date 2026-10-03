"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Archive,
  BarChart3,
  Banknote,
  Bot,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  ChevronsUpDown,
  Download,
  FileText,
  Flag,
  History,
  ImagePlus,
  ListChecks,
  Plus,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRound,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  MAINTENANCE_CATEGORIES,
  type EvidenceKind,
  type MaintenanceData,
  type MaintenancePropertyOption,
  type MaintenanceStatus,
  type MaintenanceThreshold,
  type MaintenanceTicket,
} from "@/lib/maintenance-types";
import type { HostawayReservation } from "@/lib/hostaway-types";
import { checklistForCategory } from "@/lib/maintenance-checklists";
import type { WorkspaceRole } from "@/lib/modules";

export type MaintenanceWorkspace =
  | "stays"
  | "new_maintenance"
  | "ongoing_maintenance"
  | "referred_ready"
  | "complete_maintenance"
  | "reporting"
  | "ready"
  | "approvals"
  | "accounts"
  | "closed"
  | "thresholds"
  | "client";

type MaintenanceUser = {
  name: string;
  email: string;
  role: WorkspaceRole;
};

export function MaintenanceCentre({
  initialData,
  initialWorkspace,
  currentUser,
  onBack,
}: {
  initialData: MaintenanceData;
  initialWorkspace: MaintenanceWorkspace;
  currentUser: MaintenanceUser;
  onBack: () => void;
}) {
  const [data, setData] = useState(initialData);
  const [workspace, setWorkspace] = useState<MaintenanceWorkspace>(initialWorkspace);
  const [selectedId, setSelectedId] = useState(initialData.tickets[0]?.id || "");
  const [error, setError] = useState("");
  const [freshnessClock, setFreshnessClock] = useState(() => Date.now());
  const refreshing = useRef(false);
  const refreshTickets = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const response = await fetch("/api/maintenance", { cache: "no-store" });
      const result = (await response.json().catch(() => null)) as
        | { data?: MaintenanceData }
        | null;
      if (response.ok && result?.data) setData(result.data);
    } finally {
      refreshing.current = false;
    }
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setFreshnessClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => void refreshTickets(), 15_000);
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void refreshTickets();
    };
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [refreshTickets]);
  const availableTabs = useMemo(
    () => {
      if (initialWorkspace === "ready") {
        return [
          data.permissions.ready && { id: "ready" as const, label: "Workboard", icon: Wrench },
          (data.permissions.approvals || data.permissions.ready) && { id: "approvals" as const, label: "Approvals", icon: Flag },
          data.permissions.thresholds && { id: "thresholds" as const, label: "Thresholds", icon: ShieldCheck },
        ].filter(Boolean) as Array<{ id: MaintenanceWorkspace; label: string; icon: typeof Wrench }>;
      }
      if (initialWorkspace === "accounts") {
        return [
          data.permissions.accounts && { id: "accounts" as const, label: "Approved maintenance", icon: ReceiptText },
          data.permissions.accounts && { id: "closed" as const, label: "Reconciled", icon: Archive },
        ].filter(Boolean) as Array<{ id: MaintenanceWorkspace; label: string; icon: typeof Wrench }>;
      }
      if (initialWorkspace === "client") {
        return data.permissions.client
          ? [{ id: "client" as const, label: "Approved work", icon: Wrench }]
          : [];
      }
      return [
        data.permissions.stays && { id: "new_maintenance" as const, label: "New maintenance", icon: Plus },
        data.permissions.stays && { id: "ongoing_maintenance" as const, label: "Ongoing", icon: Clock3 },
        data.permissions.stays && { id: "referred_ready" as const, label: "Referred to Ready", icon: Wrench },
        data.permissions.stays && { id: "complete_maintenance" as const, label: "Complete", icon: CheckCircle2 },
        data.permissions.stays && { id: "reporting" as const, label: "Reporting", icon: BarChart3 },
      ].filter(Boolean) as Array<{ id: MaintenanceWorkspace; label: string; icon: typeof Wrench }>;
    },
    [data.permissions, initialWorkspace],
  );

  const activeWorkspace = availableTabs.some((tab) => tab.id === workspace)
    ? workspace
    : availableTabs[0]?.id || "new_maintenance";
  const tickets = ticketsForWorkspace(data, activeWorkspace, currentUser, initialWorkspace);
  const selected = tickets.find((ticket) => ticket.id === selectedId) || tickets[0];

  async function mutate(body: Record<string, unknown>) {
    setError("");
    try {
      const response = await fetch("/api/maintenance", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => null)) as
        | { data?: MaintenanceData; error?: string }
        | null;
      if (!response.ok || !result?.data) {
        setError(result?.error || "The ticket could not be updated.");
        return false;
      }
      setData(result.data);
      return true;
    } catch {
      setError("The ticket could not be updated. Please try again.");
      return false;
    }
  }

  async function upload(ticketId: string, kind: EvidenceKind, file: File) {
    setError("");
    const form = new FormData();
    form.set("ticketId", ticketId);
    form.set("kind", kind);
    form.set("file", file);
    try {
      const response = await fetch("/api/maintenance/evidence", { method: "POST", body: form });
      const result = (await response.json().catch(() => null)) as
        | { data?: MaintenanceData; error?: string }
        | null;
      if (!response.ok || !result?.data) {
        setError(result?.error || "The evidence could not be uploaded.");
        return false;
      }
      setData(result.data);
      return true;
    } catch {
      setError("The evidence could not be uploaded. Please try again.");
      return false;
    }
  }

  if (!data.available) {
    return (
      <div>
        <BackButton onBack={onBack} />
        <div className="rounded-3xl border border-[#ead8a5] bg-[#fff9e8] p-7 text-[#765e22]">
          Maintenance Reporting is temporarily unavailable. Please try again shortly.
        </div>
      </div>
    );
  }

  return (
    <div>
      <BackButton onBack={onBack} />
      <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
        <div>
          <p className="eyebrow">{maintenanceToolCopy(initialWorkspace).eyebrow}</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
            {maintenanceToolCopy(initialWorkspace).title}
          </h1>
          <p className="mt-3 max-w-3xl text-base leading-7 text-[#647577]">
            {maintenanceToolCopy(initialWorkspace).description}
          </p>
        </div>
        {initialWorkspace === "stays" && data.permissions.stays && (
          <NewTicketDialog
            properties={data.properties}
            onSaved={(next) => {
              setData(next);
              setWorkspace("new_maintenance");
            }}
          />
        )}
      </div>

      <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {maintenanceStats(data, initialWorkspace).map((stat) => (
          <MaintenanceStat key={stat.label} label={stat.label} value={stat.value} icon={stat.icon} />
        ))}
      </section>

      {error && (
        <div className="mt-5 rounded-2xl border border-[#efcaca] bg-[#fff1f1] px-5 py-4 text-sm font-medium text-[#923f3f]">
          {error}
        </div>
      )}

      <Tabs value={activeWorkspace} onValueChange={(value) => setWorkspace(value as MaintenanceWorkspace)} className="mt-6">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl bg-[#e3ebe7] p-1.5">
          {availableTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger key={tab.id} value={tab.id} className="min-h-10 shrink-0 gap-2 rounded-xl px-4">
                <Icon className="size-4" /> {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {activeWorkspace === "thresholds" ? (
        <ThresholdWorkspace thresholds={data.thresholds} onData={setData} onError={setError} />
      ) : activeWorkspace === "reporting" ? (
        <MaintenanceReporting tickets={data.tickets} nowMs={freshnessClock} />
      ) : (
        <>
          {activeWorkspace === "ready" && <ReadyCalendar tickets={tickets} />}
          <div className="mt-5 grid overflow-hidden rounded-[1.6rem] border border-[#d5dfdc] bg-white xl:h-[46rem] xl:grid-cols-[22rem_minmax(0,1fr)]">
            <aside className="border-b border-[#dfe7e4] bg-[#f7f9f8] xl:min-h-0 xl:border-r xl:border-b-0">
              <div className="border-b border-[#dfe7e4] px-5 py-4">
                <p className="text-sm font-semibold">{workspaceLabel(activeWorkspace)}</p>
                <p className="mt-1 text-xs text-[#718184]">{tickets.length} tickets</p>
              </div>
              <div className="max-h-72 overflow-y-auto xl:max-h-[calc(46rem-4.4rem)]">
                {tickets.map((ticket) => (
                  <TicketListItem
                    key={ticket.id}
                    ticket={ticket}
                    active={selected?.id === ticket.id}
                    onClick={() => setSelectedId(ticket.id)}
                    workspace={activeWorkspace}
                  />
                ))}
                {tickets.length === 0 && (
                  <p className="px-5 py-10 text-center text-sm leading-6 text-[#718184]">
                    No tickets in this queue.
                  </p>
                )}
              </div>
            </aside>
            {selected ? (
              <TicketDetail
                key={`${selected.id}:${selected.updatedAt}`}
                ticket={selected}
                data={data}
                currentUser={currentUser}
                toolWorkspace={initialWorkspace}
                mutate={mutate}
                upload={upload}
              />
            ) : (
              <div className="grid min-h-80 place-items-center p-8 text-center text-sm text-[#718184]">
                Select a ticket to see its connected workflow.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-[#4f6966] hover:text-[#1c3934]" onClick={onBack}>
      <ArrowLeft className="size-4" /> Back to department
    </button>
  );
}

function MaintenanceStat({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Wrench }) {
  return (
    <article className="rounded-2xl border border-[#d9e2df] bg-white p-5">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-medium text-[#647577]">{label}</p>
        <Icon className="size-4 text-[#527261]" />
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-[-0.04em]">{value}</p>
    </article>
  );
}

function NewTicketDialog({ properties, onSaved }: { properties: MaintenancePropertyOption[]; onSaved: (data: MaintenanceData) => void }) {
  const [open, setOpen] = useState(false);
  const [propertyPickerOpen, setPropertyPickerOpen] = useState(false);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>([]);
  const [reservations, setReservations] = useState<Record<string, HostawayReservation[]>>({});
  const [reservationsLoading, setReservationsLoading] = useState<Record<string, boolean>>({});
  const [reservationErrors, setReservationErrors] = useState<Record<string, string>>({});
  const [selectedReservations, setSelectedReservations] = useState<Record<string, HostawayReservation | null>>({});
  const [category, setCategory] = useState<"" | (typeof MAINTENANCE_CATEGORIES)[number]>("");
  const [priority, setPriority] = useState<"normal" | "urgent" | "emergency">("normal");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadReservations(property: MaintenancePropertyOption) {
    if (reservations[property.id] || reservationsLoading[property.id] || !property.hostawayListingIds.length) return;
    setReservationsLoading((current) => ({ ...current, [property.id]: true }));
    setReservationErrors((current) => ({ ...current, [property.id]: "" }));
    try {
      const results = await Promise.all(property.hostawayListingIds.map(async (listingId) => {
        const response = await fetch(`/api/hostaway/reservations?listingId=${encodeURIComponent(listingId)}`, { headers: { accept: "application/json" } });
        const result = (await response.json().catch(() => null)) as { reservations?: HostawayReservation[]; error?: string } | null;
        if (!response.ok || !result?.reservations) throw new Error(result?.error || "Reservations could not be loaded.");
        return result.reservations;
      }));
      const unique = [...new Map(results.flat().map((reservation) => [reservation.id, reservation])).values()];
      setReservations((current) => ({ ...current, [property.id]: unique }));
    } catch (loadError) {
      setReservationErrors((current) => ({ ...current, [property.id]: loadError instanceof Error ? loadError.message : "Reservations could not be loaded." }));
    } finally {
      setReservationsLoading((current) => ({ ...current, [property.id]: false }));
    }
  }

  function toggleProperty(property: MaintenancePropertyOption) {
    const selected = selectedPropertyIds.includes(property.id);
    setSelectedPropertyIds((current) => selected ? current.filter((id) => id !== property.id) : [...current, property.id]);
    if (!selected) void loadReservations(property);
    if (selected) setSelectedReservations((current) => ({ ...current, [property.id]: null }));
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPropertyIds.length) return setError("Select at least one property from the Management Property Database.");
    if (!category) return setError("Select the repair type so the correct troubleshooting steps can be followed.");
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const selections = selectedPropertyIds.map((propertyId) => {
      const reservation = selectedReservations[propertyId];
      return {
        propertyId,
        hostawayListingId: reservation?.listingId || "",
        hostawayReservationId: reservation?.id || "",
        guestName: reservation?.guestName || "",
        bookingReference: reservation?.bookingReference || "",
        reservationArrivalDate: reservation?.arrivalDate || "",
        reservationDepartureDate: reservation?.departureDate || "",
        reservationChannel: reservation?.channelName || "",
      };
    });
    const response = await fetch("/api/maintenance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ selections, category, priority, summary: form.get("summary"), details: form.get("details") }) });
    const result = (await response.json().catch(() => null)) as { data?: MaintenanceData; error?: string } | null;
    setSaving(false);
    if (!response.ok || !result?.data) return setError(result?.error || "The ticket could not be raised.");
    onSaved(result.data);
    setOpen(false);
    setSelectedPropertyIds([]);
    setSelectedReservations({});
    setCategory("");
  }

  const selectedProperties = properties.filter((property) => selectedPropertyIds.includes(property.id));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="h-11 rounded-xl bg-[#1c3934] px-5 text-white hover:bg-[#10271f]">
          <Plus /> Raise maintenance ticket
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl border-[#d9e2df] p-0 sm:max-w-3xl">
        <form onSubmit={submit}>
          <DialogHeader className="border-b border-[#e2e9e7] px-6 py-6 text-left">
            <DialogTitle className="text-2xl tracking-[-0.035em]">Raise maintenance ticket</DialogTitle>
            <DialogDescription>Select every affected property. Owner details come from the Management Property Database and each property creates a clearly identified ticket.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5 px-6 py-6">
            <Field label="Properties">
              <Popover open={propertyPickerOpen} onOpenChange={setPropertyPickerOpen}>
                <PopoverTrigger asChild><Button type="button" variant="outline" role="combobox" aria-expanded={propertyPickerOpen} className="w-full justify-between bg-white font-normal"><span className="truncate">{selectedPropertyIds.length ? `${selectedPropertyIds.length} ${selectedPropertyIds.length === 1 ? "property" : "properties"} selected` : "Select properties from the database"}</span><ChevronsUpDown className="size-4 opacity-50" /></Button></PopoverTrigger>
                <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0"><Command><CommandInput placeholder="Search property or address…" /><CommandList><CommandEmpty>No property found.</CommandEmpty><CommandGroup>{properties.map((property) => <CommandItem key={property.id} value={`${property.propertyName} ${property.propertyAddress}`} onSelect={() => toggleProperty(property)} className="items-start py-3"><Checkbox checked={selectedPropertyIds.includes(property.id)} className="mt-0.5" /><span className="min-w-0"><span className="block truncate font-medium">{property.propertyAddress || property.propertyName}</span><span className="mt-0.5 block truncate text-xs text-[#718184]">{property.clientName || "Owner details not yet recorded"}</span></span></CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent>
              </Popover>
            </Field>
            {selectedProperties.map((property) => {
              const selectedReservation = selectedReservations[property.id];
              const propertyReservations = reservations[property.id] || [];
              return <div key={property.id} className="rounded-2xl border border-[#dbe5df] bg-[#f7faf8] p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{property.propertyAddress || property.propertyName}</p><p className="mt-1 text-xs text-[#718184]">Client details linked automatically · reservation optional</p></div><Button type="button" variant="ghost" size="sm" onClick={() => toggleProperty(property)}>Remove</Button></div><div className="mt-4"><Select value={selectedReservation?.id || "none"} onValueChange={(id) => setSelectedReservations((current) => ({ ...current, [property.id]: id === "none" ? null : propertyReservations.find((reservation) => reservation.id === id) || null }))}><SelectTrigger disabled={reservationsLoading[property.id]}><SelectValue placeholder={reservationsLoading[property.id] ? "Loading reservations…" : "Select reservation"} /></SelectTrigger><SelectContent><SelectItem value="none">No reservation linked</SelectItem>{propertyReservations.map((reservation) => <SelectItem key={reservation.id} value={reservation.id}>{reservationLabel(reservation)} · {formatReservationDates(reservation)}</SelectItem>)}</SelectContent></Select>{reservationErrors[property.id] && <p className="mt-2 text-xs font-medium text-[#8a641c]">{reservationErrors[property.id]}</p>}</div></div>;
            })}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Repair type">
                <Select value={category} onValueChange={(value) => setCategory(value as typeof category)} required>
                  <SelectTrigger><SelectValue placeholder="Select repair type" /></SelectTrigger>
                  <SelectContent>{MAINTENANCE_CATEGORIES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Priority">
                <Select value={priority} onValueChange={(value) => setPriority(value as typeof priority)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                    <SelectItem value="emergency">Emergency</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Issue"><Input name="summary" required placeholder="Short description of the issue" /></Field>
            <Field label="Full details"><Textarea name="details" required rows={5} placeholder="What has happened, access details, guest impact and any evidence already received." /></Field>
            <div className="flex items-start gap-3 rounded-2xl border border-[#dbe5df] bg-[#f7faf8] p-4">
              <ListChecks className="mt-0.5 size-5 shrink-0 text-[#527261]" />
              <span>
                <span className="block text-sm font-semibold">Troubleshooting comes next</span>
                <span className="mt-1 block text-xs leading-5 text-[#718184]">The ticket stays with Stays until every issue-specific check is completed. If it remains unresolved, the connected Ready ticket is created then.</span>
              </span>
            </div>
            {error && <p className="text-sm font-medium text-red-700">{error}</p>}
          </div>
          <DialogFooter className="border-t border-[#e2e9e7] px-6 py-5">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={saving} className="bg-[#1c3934] text-white hover:bg-[#10271f]">{saving ? "Raising…" : "Raise ticket"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MaintenanceReporting({ tickets, nowMs }: { tickets: MaintenanceTicket[]; nowMs: number }) {
  const [period, setPeriod] = useState<"day" | "week" | "month" | "year">("week");
  const buckets = reportingBuckets(period);
  const current = buckets[buckets.length - 1];
  const opened = tickets.filter((ticket) => ticket.createdAt >= current.start && ticket.createdAt < current.end);
  const resolved = tickets.filter((ticket) => {
    const resolvedAt = ticketResolutionTime(ticket);
    return resolvedAt !== null && resolvedAt >= current.start && resolvedAt < current.end;
  });
  const averageHours = resolved.length ? resolved.reduce((sum, ticket) => sum + ((ticketResolutionTime(ticket) || ticket.createdAt) - ticket.createdAt) / 3600, 0) / resolved.length : 0;
  const overdue = tickets.filter((ticket) => isOpen(ticket) && nowMs / 1000 - ticket.updatedAt >= 86400).length;
  const trend = buckets.map((bucket) => ({ ...bucket, count: tickets.filter((ticket) => ticket.createdAt >= bucket.start && ticket.createdAt < bucket.end).length }));
  const maximum = Math.max(1, ...trend.map((bucket) => bucket.count));
  return <section className="mt-5 space-y-5"><div className="flex flex-col justify-between gap-4 rounded-[1.6rem] border border-[#d5dfdc] bg-white p-5 sm:flex-row sm:items-end"><div><p className="eyebrow">Maintenance analytics</p><h2 className="mt-2 text-2xl font-semibold">Ticket reporting</h2><p className="mt-2 text-sm text-[#647577]">New demand, resolution speed and update compliance.</p></div><Tabs value={period} onValueChange={(value) => setPeriod(value as typeof period)}><TabsList className="grid h-auto grid-cols-4 bg-[#e8efec]"><TabsTrigger value="day">Daily</TabsTrigger><TabsTrigger value="week">Weekly</TabsTrigger><TabsTrigger value="month">Monthly</TabsTrigger><TabsTrigger value="year">Yearly</TabsTrigger></TabsList></Tabs></div><div className="grid gap-3 md:grid-cols-3"><ReportMetric label={`New tickets · ${current.label}`} value={String(opened.length)} /><ReportMetric label="Average resolution time" value={resolved.length ? formatDuration(averageHours) : "—"} note={`${resolved.length} resolved in this period`} /><ReportMetric label="Over 24 hours without update" value={String(overdue)} alert={overdue > 0} note="Currently open tickets" /></div><div className="rounded-[1.6rem] border border-[#d5dfdc] bg-white p-5"><div className="flex items-center justify-between gap-4"><p className="font-semibold">New tickets over time</p><p className="text-xs text-[#718184]">{period === "day" ? "Last 14 days" : period === "week" ? "Last 12 weeks" : period === "month" ? "Last 12 months" : "Last 5 years"}</p></div><div className="mt-6 flex h-56 items-end gap-2 overflow-x-auto border-b border-[#dfe7e4] pb-1">{trend.map((bucket) => <div key={bucket.start} className="flex h-full min-w-10 flex-1 flex-col justify-end text-center"><span className="mb-2 text-xs font-semibold">{bucket.count}</span><div className="mx-auto w-full max-w-12 rounded-t-lg bg-[#76ad49]" style={{ height: `${Math.max(4, bucket.count / maximum * 150)}px` }} /><span className="mt-2 truncate text-[0.65rem] text-[#718184]">{bucket.shortLabel}</span></div>)}</div></div></section>;
}

function ReportMetric({ label, value, note, alert = false }: { label: string; value: string; note?: string; alert?: boolean }) { return <article className={`rounded-2xl border p-5 ${alert ? "border-red-200 bg-red-50" : "border-[#d9e2df] bg-white"}`}><p className="text-sm text-[#647577]">{label}</p><p className={`mt-3 text-3xl font-semibold ${alert ? "text-red-700" : ""}`}>{value}</p>{note && <p className="mt-2 text-xs text-[#718184]">{note}</p>}</article>; }

function ReadyCalendar({ tickets }: { tickets: MaintenanceTicket[] }) {
  const scheduled = tickets
    .filter((ticket) =>
      ticket.quoteAmountPence !== null &&
      (ticket.scheduledDate || ticket.proposedRepairDate) &&
      ["ready_to_schedule", "scheduled", "in_progress"].includes(ticket.status),
    )
    .sort((a, b) => `${a.scheduledDate || a.proposedRepairDate}${a.scheduledStartTime || ""}`.localeCompare(`${b.scheduledDate || b.proposedRepairDate}${b.scheduledStartTime || ""}`))
    .slice(0, 12);
  if (!scheduled.length) return null;
  return (
    <section className="mt-5 rounded-2xl border border-[#d9e2df] bg-white p-5">
      <div className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="size-4 text-[#527261]" /> Ready calendar</div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {scheduled.map((ticket) => (
          <div key={ticket.id} className="rounded-xl bg-[#f4f7f5] px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#607174]">{formatShortDate(ticket.scheduledDate || ticket.proposedRepairDate)}</p>
            <p className="mt-1 font-semibold">{ticket.scheduledDate ? `${ticket.scheduledStartTime}-${ticket.scheduledEndTime}` : "Approved · awaiting scheduling"}</p>
            <p className="mt-1 truncate text-sm text-[#647577]">{ticket.propertyName} · {ticket.summary}</p>
            <p className="mt-2 text-xs font-semibold text-[#527261]">{formatMoney(ticket.quoteAmountPence || 0)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function TicketListItem({
  ticket,
  active,
  onClick,
  workspace,
}: {
  ticket: MaintenanceTicket;
  active: boolean;
  onClick: () => void;
  workspace: MaintenanceWorkspace;
}) {
  const freshness = updateFreshness(ticket);
  return (
    <button className={`w-full border-b border-l-4 border-b-[#e4eae8] p-4 text-left transition-colors ${freshness.tone === "red" ? "border-l-red-500 bg-red-50/40" : freshness.tone === "yellow" ? "border-l-amber-400 bg-amber-50/40" : "border-l-transparent"} ${active ? "bg-white" : "hover:bg-white/70"}`} onClick={onClick}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#607174]">
          {workspace === "ready" ? ticket.readyReference : ticket.reference}
        </p>
        <StatusBadge status={ticket.status} />
      </div>
      <p className="mt-3 truncate text-sm font-semibold">{ticket.propertyName}</p>
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#718184]">
        {workspace === "closed" ? ticket.closedReason || ticket.summary : ticket.summary}
      </p>
      <div className="mt-3 flex items-center justify-between text-xs text-[#819093]">
        <span>{ticket.category}</span>
        <span className={freshness.tone === "red" ? "font-semibold text-red-700" : freshness.tone === "yellow" ? "font-semibold text-amber-700" : ""}>{freshness.shortLabel}</span>
      </div>
    </button>
  );
}

function UpdateDueAlert({ ticket }: { ticket: MaintenanceTicket }) {
  const freshness = updateFreshness(ticket);
  const tone = freshness.tone === "red" ? "border-red-200 bg-red-50 text-red-800" : freshness.tone === "yellow" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-[#cfe4c6] bg-[#f3fbe9] text-[#486337]";
  return <section className={`rounded-2xl border p-4 ${tone}`}><div className="flex items-start gap-3"><Clock3 className="mt-0.5 size-5 shrink-0" /><div><p className="font-semibold">{freshness.title}</p><p className="mt-1 text-sm leading-6">{freshness.description} Add an update in the activity section below; this requirement continues while the ticket is with Recharge Ready.</p></div></div></section>;
}

function TicketDetail({
  ticket,
  data,
  currentUser,
  toolWorkspace,
  mutate,
  upload,
}: {
  ticket: MaintenanceTicket;
  data: MaintenanceData;
  currentUser: MaintenanceUser;
  toolWorkspace: MaintenanceWorkspace;
  mutate: (body: Record<string, unknown>) => Promise<boolean>;
  upload: (ticketId: string, kind: EvidenceKind, file: File) => Promise<boolean>;
}) {
  return (
    <section className="min-h-0 overflow-y-auto bg-[#fbfcfb]">
      <header className="sticky top-0 z-10 border-b border-[#dfe7e4] bg-white/95 px-5 py-4 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold"><span className="text-[#718184]">Property:</span> {ticket.propertyName}</p>
              <PriorityBadge priority={ticket.priority} />
            </div>
            {ticket.propertyAddress && <p className="mt-1 text-xs text-[#718184]">{ticket.propertyAddress}</p>}
            <p className="mt-1 text-xs text-[#718184]">{ticket.reference}{ticket.readyReference ? ` · Ready ${ticket.readyReference}` : ""}</p>
          </div>
          <StatusBadge status={ticket.status} />
        </div>
      </header>
      <div className="space-y-5 p-5 sm:p-6">
        <section className="rounded-2xl border border-[#dfe7e4] bg-white p-5">
          <p className="text-lg font-semibold">{ticket.summary}</p>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#607174]">{ticket.details}</p>
          <div className="mt-5 grid gap-4 border-t border-[#e6ecea] pt-5 sm:grid-cols-2 xl:grid-cols-3">
            <Detail label="Repair type" value={ticket.category} />
            <Detail label="Raised by" value={ticket.raisedByName} />
            <Detail label="Client" value={ticket.clientName || ticket.clientEmail || "Not recorded"} />
            <Detail label="Guest" value={ticket.guestName || "Not recorded"} />
            <Detail label="Booking" value={ticket.bookingReference || "Not recorded"} />
            <Detail label="Stay dates" value={formatStayDates(ticket)} />
            <Detail label="Channel" value={ticket.reservationChannel || "Not recorded"} />
          </div>
        </section>

        {!isClosed(ticket) && currentUser.role !== "client" && <UpdateDueAlert ticket={ticket} />}

        {isClosed(ticket) && <ClosurePanel ticket={ticket} />}

        {toolWorkspace === "stays" && data.permissions.stays && ticket.status === "new" && !ticket.readyReference ? (
          <TroubleshootingPanel ticket={ticket} mutate={mutate} />
        ) : ticket.troubleshootingOutcome !== "pending" ? (
          <TroubleshootingRecord ticket={ticket} />
        ) : null}

        {ticket.quoteAmountPence !== null && (
          <section className="rounded-2xl bg-[#1c3934] p-5 text-white">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8fb3a2]">Ready quote</p>
                <p className="mt-2 text-3xl font-semibold">{formatMoney(ticket.quoteAmountPence)}</p>
              </div>
              <a className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-[#1c3934]" href={`/api/maintenance/${ticket.id}/proposal`}>
                <Download className="size-4" /> Client proposal
              </a>
            </div>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-white/70">{ticket.workRequired}</p>
            <p className="mt-3 text-xs text-white/50">Proposed date: {formatShortDate(ticket.proposedRepairDate)}</p>
            <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-4">
              <ApprovalStatusPill label="Management" status={ticket.managementApproval} />
              <ApprovalStatusPill label="Client" status={ticket.clientApproval} />
              {ticket.finalApproval !== "not_required" && <ApprovalStatusPill label="Completed work" status={ticket.finalApproval} />}
            </div>
          </section>
        )}

        {toolWorkspace === "ready" && data.permissions.ready && ticket.status === "quote_required" && <QuoteForm ticket={ticket} mutate={mutate} threshold={data.thresholds.find((item) => item.category === ticket.category)} />}
        {toolWorkspace === "ready" && (data.permissions.approvals || data.permissions.ready) && <ApprovalPanel ticket={ticket} currentUser={currentUser} mutate={mutate} />}
        {toolWorkspace === "ready" && data.permissions.ready && ticket.status === "ready_to_schedule" && <ScheduleForm ticket={ticket} currentUser={currentUser} mutate={mutate} />}
        {toolWorkspace === "ready" && data.permissions.ready && ["scheduled", "in_progress"].includes(ticket.status) && <ReadyProgress ticket={ticket} mutate={mutate} />}
        {toolWorkspace === "ready" && data.permissions.approvals && ticket.status === "management_review" && <FinalApproval ticket={ticket} mutate={mutate} />}
        {toolWorkspace === "accounts" && data.permissions.accounts && ticket.accountsStatus === "pending" && <AccountsPayment ticket={ticket} mutate={mutate} />}
        {toolWorkspace === "accounts" && data.permissions.accounts && ticket.accountsStatus === "paid" && <AccountsReconciliation ticket={ticket} mutate={mutate} />}

        <EvidencePanel ticket={ticket} permissions={data.permissions} toolWorkspace={toolWorkspace} upload={upload} />
        <Timeline ticket={ticket} canAddNote={currentUser.role !== "client"} mutate={mutate} />
      </div>
    </section>
  );
}

function TroubleshootingPanel({
  ticket,
  mutate,
}: {
  ticket: MaintenanceTicket;
  mutate: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const checklist = checklistForCategory(ticket.category);
  type AssistantAnswer = {
    id: string;
    label: string;
    result: "remains" | "resolved" | "unable";
    note: string;
  };
  const [safetyCleared, setSafetyCleared] = useState(false);
  const [safetyEscalation, setSafetyEscalation] = useState(false);
  const [answers, setAnswers] = useState<AssistantAnswer[]>([]);
  const [draft, setDraft] = useState("");
  const [closureReason, setClosureReason] = useState("");
  const [saving, setSaving] = useState<"resolved" | "ready_required" | null>(null);
  const [validationError, setValidationError] = useState("");
  const resolvedAnswer = answers.find((answer) => answer.result === "resolved");
  const currentStep = resolvedAnswer || safetyEscalation ? null : checklist[answers.length];
  const allReviewed = safetyEscalation || answers.length === checklist.length;

  function answerStep(result: AssistantAnswer["result"]) {
    if (!currentStep) return;
    if (draft.trim().length < 2) {
      setValidationError("Tell the assistant what happened during this check.");
      return;
    }
    setAnswers((current) => [
      ...current,
      { id: currentStep.id, label: currentStep.label, result, note: draft.trim() },
    ]);
    setDraft("");
    setValidationError("");
  }

  function transcript() {
    const safetyLine = safetyEscalation
      ? "Safety gate: immediate danger reported. Troubleshooting stopped and urgent referral required."
      : "Safety gate: no immediate danger reported; safe first-line troubleshooting continued.";
    const answerLines = answers.map((answer, index) => {
      const result = answer.result === "resolved" ? "resolved the issue" : answer.result === "unable" ? "could not be completed safely" : "issue remained";
      return `${index + 1}. ${answer.label}\nResult: ${result}.\nObservation: ${answer.note}`;
    });
    return [
      "Maintenance Troubleshooter conversation",
      safetyLine,
      ...answerLines,
      "Handoff: include the evidence gathered, guest impact and every check above when arranging further work.",
    ].join("\n\n");
  }

  async function finish(outcome: "resolved" | "ready_required") {
    setValidationError("");
    if (outcome === "ready_required" && !allReviewed) {
      setValidationError("Continue the conversation until every safe troubleshooting avenue has been reviewed.");
      return;
    }
    if (outcome === "resolved" && !resolvedAnswer) {
      setValidationError("Confirm which step resolved the issue before closing the ticket.");
      return;
    }
    if (outcome === "resolved" && closureReason.trim().length < 3) {
      setValidationError("Add the reason the ticket is being closed.");
      return;
    }
    setSaving(outcome);
    await mutate({
      action: "troubleshoot",
      id: ticket.id,
      completedItems: safetyEscalation ? checklist.map((item) => item.id) : answers.map((answer) => answer.id),
      notes: transcript(),
      outcome,
      closureReason: outcome === "resolved" ? closureReason : "",
    });
    setSaving(null);
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[#cedbd6] bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e2e9e6] bg-[#f7faf8] p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#1c3934] text-white"><Bot className="size-5" /></span>
          <div>
            <div className="flex items-center gap-2"><p className="font-semibold">AI Maintenance Troubleshooter</p><Badge className="border-0 bg-[#e4f5d7] text-[#456628]"><Sparkles className="mr-1 size-3" /> ClickUp SOP guided</Badge></div>
            <p className="mt-1 text-xs leading-5 text-[#718184]">A conversation using the {ticket.category.toLowerCase()} pathway and Recharge maintenance SOPs.</p>
          </div>
        </div>
        <span className="text-xs font-semibold text-[#527261]">{Math.min(answers.length, checklist.length)} / {checklist.length} avenues reviewed</span>
      </div>

      <div className="max-h-[34rem] space-y-4 overflow-y-auto bg-[#f4f7f5] p-5" aria-live="polite">
        <AssistantBubble>
          I’ll take you through the safe checks one at a time and create a clear handoff. Never ask a guest to open a boiler, gas appliance or electrical unit, touch exposed wiring, or repeatedly reset a breaker.
        </AssistantBubble>

        {!safetyCleared && !safetyEscalation && (
          <>
            <AssistantBubble>
              First, is there any immediate danger: injury, fire, smoke, sparks, burning smell, electric shock, exposed wiring, gas smell, uncontrolled water near electrics, or no safe way for the guest to enter or leave?
            </AssistantBubble>
            <div className="flex flex-wrap gap-2 pl-12">
              <Button type="button" onClick={() => setSafetyCleared(true)} className="bg-[#1c3934] text-white hover:bg-[#10271f]">No immediate danger</Button>
              <Button type="button" onClick={() => setSafetyEscalation(true)} variant="destructive">Yes — stop and escalate</Button>
            </div>
          </>
        )}

        {safetyCleared && <UserBubble>No immediate danger has been reported. Continue with safe first-line checks.</UserBubble>}
        {safetyEscalation && <UserBubble>Immediate danger reported. Stop troubleshooting and arrange urgent qualified attendance.</UserBubble>}

        {answers.map((answer) => (
          <div key={answer.id} className="space-y-3">
            <AssistantBubble>{answer.label}</AssistantBubble>
            <UserBubble>
              <span className="font-semibold">{answer.result === "resolved" ? "This resolved the issue." : answer.result === "unable" ? "This could not be completed safely." : "The issue remains."}</span>{" "}{answer.note}
            </UserBubble>
          </div>
        ))}

        {safetyCleared && currentStep && (
          <div className="space-y-3">
            <AssistantBubble>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#698077]">Next safe check</span>
              <span className="mt-1 block">{currentStep.label}</span>
            </AssistantBubble>
            <div className="ml-auto max-w-[42rem] rounded-2xl rounded-br-md border border-[#cbd9d3] bg-white p-4">
              <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} placeholder="Tell the assistant what you checked and what happened…" />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => answerStep("remains")} className="bg-[#1c3934] text-white hover:bg-[#10271f]">Checked — issue remains</Button>
                <Button type="button" size="sm" onClick={() => answerStep("resolved")} variant="outline"><Check className="size-4" /> This fixed it</Button>
                <Button type="button" size="sm" onClick={() => answerStep("unable")} variant="outline">Unable / not safe</Button>
              </div>
            </div>
          </div>
        )}

        {(allReviewed || resolvedAnswer) && (
          <AssistantBubble>
            {safetyEscalation
              ? "Stop here. Keep the guest away from the affected area and refer this for urgent qualified attendance."
              : resolvedAnswer
                ? "Good — the issue has been resolved. Add a clear closure reason and confirm the guest has tested the service normally."
                : "Every safe avenue in this SOP has now been reviewed. The Ready referral is unlocked and will include this conversation as the handoff record."}
          </AssistantBubble>
        )}
      </div>

      <div className="p-5">
        {resolvedAnswer && (
          <Field label="Closure reason">
            <Textarea value={closureReason} onChange={(event) => setClosureReason(event.target.value)} rows={3} placeholder="For example: pull-cord isolator switched on; shower restored; guest confirmed normal operation." />
          </Field>
        )}

      {validationError && <p className="mt-4 text-sm font-medium text-red-700">{validationError}</p>}
      <div className="mt-5 flex flex-wrap gap-2">
        {!resolvedAnswer && <Button type="button" disabled={Boolean(saving) || !allReviewed} onClick={() => finish("ready_required")} className="bg-[#1c3934] text-white hover:bg-[#10271f]"><Wrench /> {saving === "ready_required" ? "Creating Ready ticket…" : safetyEscalation ? "Urgent referral to Ready" : "Refer to Ready with transcript"}</Button>}
        {resolvedAnswer && <Button type="button" disabled={Boolean(saving)} onClick={() => finish("resolved")} className="bg-[#5f8b4a] text-white hover:bg-[#4b713a]"><Check /> {saving === "resolved" ? "Closing ticket…" : "Confirm resolved & close"}</Button>}
        {(answers.length > 0 || safetyCleared || safetyEscalation) && <Button type="button" variant="outline" disabled={Boolean(saving)} onClick={() => { setAnswers([]); setDraft(""); setClosureReason(""); setSafetyCleared(false); setSafetyEscalation(false); setValidationError(""); }}>Restart conversation</Button>}
      </div>
      {!resolvedAnswer && !allReviewed && <p className="mt-3 text-xs text-[#718184]">Ready remains locked until the assistant reaches a safe stopping point or all relevant checks have been reviewed.</p>}
      </div>
    </section>
  );
}

function AssistantBubble({ children }: { children: React.ReactNode }) {
  return <div className="flex max-w-[46rem] items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#1c3934] text-white"><Bot className="size-4" /></span><div className="rounded-2xl rounded-tl-md border border-[#dce5e1] bg-white px-4 py-3 text-sm leading-6 text-[#43585a]">{children}</div></div>;
}

function UserBubble({ children }: { children: React.ReactNode }) {
  return <div className="ml-auto flex max-w-[42rem] flex-row-reverse items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#ddefcf] text-[#456628]"><UserRound className="size-4" /></span><div className="rounded-2xl rounded-tr-md bg-[#dfeae5] px-4 py-3 text-sm leading-6 text-[#29443f]">{children}</div></div>;
}

function TroubleshootingRecord({ ticket }: { ticket: MaintenanceTicket }) {
  const checklist = checklistForCategory(ticket.category);
  const completed = new Set(ticket.troubleshootingCompletedItems);
  return (
    <section className="rounded-2xl border border-[#dbe5df] bg-[#f7faf8] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-semibold">
            <ListChecks className="size-4 text-[#527261]" /> Troubleshooting record
          </div>
          <p className="mt-1 text-xs text-[#718184]">
            {ticket.troubleshootingCompletedItems.length} of {checklist.length} safe avenues reviewed
          </p>
        </div>
        <Badge className="border-0 bg-[#e7efea] text-[#405f50]">
          {ticket.troubleshootingOutcome === "resolved" ? "Resolved in Stays" : "Referred to Ready"}
        </Badge>
      </div>
      <div className="mt-4 grid gap-2 lg:grid-cols-2">
        {checklist.map((item) => (
          <div key={item.id} className="flex items-start gap-2 rounded-xl bg-white px-3 py-2.5 text-xs leading-5 text-[#526568]">
            {completed.has(item.id) ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#5f8b4a]" /> : <Clock3 className="mt-0.5 size-4 shrink-0 text-[#9a8b70]" />}
            <span>{item.label}</span>
          </div>
        ))}
      </div>
      {ticket.troubleshootingNotes && (
        <div className="mt-4 rounded-xl bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#819093]">Notes</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#526568]">{ticket.troubleshootingNotes}</p>
        </div>
      )}
    </section>
  );
}

function ClosurePanel({ ticket }: { ticket: MaintenanceTicket }) {
  return (
    <section className="rounded-2xl border border-[#cfe2c1] bg-[#f2f9eb] p-5">
      <div className="flex items-center gap-2 font-semibold text-[#355420]">
        <Archive className="size-4" /> Closed ticket
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#526842]">
        {ticket.closedReason || "This ticket has been completed and closed."}
      </p>
      <p className="mt-3 text-xs text-[#6b7f5c]">
        {ticket.closedByName || "Recharge team"}
        {ticket.closedAt ? ` · ${formatDateTime(ticket.closedAt)}` : ""}
      </p>
    </section>
  );
}

function QuoteForm({ ticket, mutate, threshold }: { ticket: MaintenanceTicket; mutate: (body: Record<string, unknown>) => Promise<boolean>; threshold?: MaintenanceThreshold }) {
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    await mutate({
      action: "quote",
      id: ticket.id,
      amountPence: Math.round(Number(form.get("amount")) * 100),
      workRequired: form.get("workRequired"),
      proposedRepairDate: form.get("proposedRepairDate"),
    });
    setSaving(false);
  }
  return (
    <form onSubmit={submit} className="rounded-2xl border border-[#dbe5df] bg-white p-5">
      <div className="flex items-center gap-2 font-semibold"><Banknote className="size-4 text-[#527261]" /> Ready quote required</div>
      <p className="mt-2 text-xs leading-5 text-[#718184]">
        {threshold?.configured
          ? `No-approval limit ${formatMoney(threshold.managementLimitPence)} · client limit ${formatMoney(threshold.clientLimitPence)}`
          : "No threshold is configured for this repair type, so management and client approval will be required."}
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-[12rem_1fr]">
        <Field label="Quote (£)"><Input name="amount" required min="0" step="0.01" type="number" placeholder="0.00" /></Field>
        <Field label="Proposed repair date"><Input name="proposedRepairDate" required type="date" /></Field>
      </div>
      <div className="mt-4"><Field label="Work required"><Textarea name="workRequired" required rows={4} placeholder="Describe the repair, labour, parts and expected outcome." /></Field></div>
      <Button disabled={saving} className="mt-4 bg-[#1c3934] text-white hover:bg-[#10271f]">{saving ? "Saving quote…" : "Save quote & assess approval"}</Button>
    </form>
  );
}

function ApprovalPanel({ ticket, currentUser, mutate }: { ticket: MaintenanceTicket; currentUser: MaintenanceUser; mutate: (body: Record<string, unknown>) => Promise<boolean> }) {
  const managementPending = ticket.managementApproval === "pending";
  const clientPending = ticket.clientApproval === "pending";
  const canClientAct = currentUser.role === "client" || currentUser.role === "admin";
  if (!managementPending && !clientPending) return null;
  return (
    <section className="rounded-2xl border border-[#ead8a5] bg-[#fff9e8] p-5">
      <div className="flex items-center gap-2 font-semibold text-[#765e22]"><Flag className="size-4" /> Approval required</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {managementPending && currentUser.role === "admin" && <ApprovalBox ticket={ticket} kind="management" mutate={mutate} />}
        {clientPending && canClientAct && <ApprovalBox ticket={ticket} kind="client" mutate={mutate} />}
        {managementPending && currentUser.role !== "admin" && <ApprovalWaiting label="Management approval pending" />}
        {clientPending && !canClientAct && <ApprovalWaiting label="Client approval pending" />}
      </div>
    </section>
  );
}

function ApprovalBox({ ticket, kind, mutate }: { ticket: MaintenanceTicket; kind: "management" | "client"; mutate: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [saving, setSaving] = useState(false);
  async function decide(decision: "approved" | "rejected") {
    setSaving(true);
    await mutate({ action: "approval", id: ticket.id, approvalKind: kind, decision, note: "" });
    setSaving(false);
  }
  return (
    <div className="rounded-xl border border-[#eadfbd] bg-white p-4">
      <p className="text-sm font-semibold">{kind === "management" ? "Management decision" : "Client decision"}</p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" disabled={saving} onClick={() => decide("approved")} className="bg-[#1c3934] text-white"><Check /> Approve</Button>
        <Button size="sm" disabled={saving} onClick={() => decide("rejected")} variant="outline">Reject</Button>
      </div>
    </div>
  );
}

function ApprovalWaiting({ label }: { label: string }) {
  return <div className="flex items-center gap-2 rounded-xl border border-[#eadfbd] bg-white p-4 text-sm font-semibold"><Clock3 className="size-4 text-[#a47623]" /> {label}</div>;
}

function ApprovalStatusPill({ label, status }: { label: string; status: MaintenanceTicket["managementApproval"] }) {
  const display = status === "not_required" ? "Not required" : status[0].toUpperCase() + status.slice(1);
  return <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white/75">{label}: {display}</span>;
}

function ScheduleForm({ ticket, currentUser, mutate }: { ticket: MaintenanceTicket; currentUser: MaintenanceUser; mutate: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    await mutate({
      action: "schedule",
      id: ticket.id,
      scheduledDate: form.get("scheduledDate"),
      startTime: form.get("startTime"),
      endTime: form.get("endTime"),
      assignedName: form.get("assignedName"),
      assignedEmail: form.get("assignedEmail"),
    });
    setSaving(false);
  }
  return (
    <form onSubmit={submit} className="rounded-2xl border border-[#dbe5df] bg-white p-5">
      <div className="flex items-center gap-2 font-semibold"><CalendarDays className="size-4 text-[#527261]" /> Lock into Ready calendar</div>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field label="Date"><Input name="scheduledDate" required type="date" defaultValue={ticket.proposedRepairDate || ""} /></Field>
        <Field label="Start"><Input name="startTime" required type="time" /></Field>
        <Field label="End"><Input name="endTime" required type="time" /></Field>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Assigned to"><Input name="assignedName" required defaultValue={currentUser.name} /></Field>
        <Field label="Assignee email"><Input name="assignedEmail" required type="email" defaultValue={currentUser.email} /></Field>
      </div>
      <Button disabled={saving} className="mt-4 bg-[#1c3934] text-white">{saving ? "Scheduling…" : "Confirm schedule"}</Button>
    </form>
  );
}

function ReadyProgress({ ticket, mutate }: { ticket: MaintenanceTicket; mutate: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [saving, setSaving] = useState(false);
  async function action(next: "start" | "complete") {
    setSaving(true);
    await mutate({ action: next, id: ticket.id, note: "" });
    setSaving(false);
  }
  return (
    <section className="rounded-2xl border border-[#dbe5df] bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-semibold">Ready job progress</p>
          <p className="mt-1 text-xs text-[#718184]">{formatShortDate(ticket.scheduledDate)} · {ticket.scheduledStartTime}-{ticket.scheduledEndTime} · {ticket.assignedReadyName}</p>
        </div>
        {ticket.status === "scheduled" ? (
          <Button disabled={saving} onClick={() => action("start")} className="bg-[#1c3934] text-white">Start work</Button>
        ) : (
          <Button disabled={saving} onClick={() => action("complete")} className="bg-[#1c3934] text-white"><CheckCircle2 /> Mark work complete</Button>
        )}
      </div>
      {ticket.status === "in_progress" && !ticket.evidence.some((item) => item.kind === "completion") && (
        <p className="mt-3 text-xs font-medium text-[#8a641c]">Completion evidence is required before the job can be submitted to management.</p>
      )}
    </section>
  );
}

function FinalApproval({ ticket, mutate }: { ticket: MaintenanceTicket; mutate: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [saving, setSaving] = useState(false);
  async function decide(decision: "approved" | "rejected") {
    setSaving(true);
    await mutate({ action: "final_approval", id: ticket.id, decision, note: "" });
    setSaving(false);
  }
  return (
    <section className="rounded-2xl border border-[#cfe2c1] bg-[#f2f9eb] p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-semibold text-[#355420]">Management completion review</p>
          <p className="mt-1 text-xs text-[#60754e]">Review Ready&apos;s completion evidence before creating the Accounts ticket.</p>
        </div>
        <div className="flex gap-2">
          <Button disabled={saving} onClick={() => decide("approved")} className="bg-[#1c3934] text-white"><Check /> Approve work</Button>
          <Button disabled={saving} onClick={() => decide("rejected")} variant="outline">Return to Ready</Button>
        </div>
      </div>
    </section>
  );
}

function AccountsPayment({ ticket, mutate }: { ticket: MaintenanceTicket; mutate: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    await mutate({
      action: "mark_paid",
      id: ticket.id,
      paymentReference: form.get("paymentReference"),
      note: form.get("note"),
    });
    setSaving(false);
  }
  return (
    <form onSubmit={submit} className="rounded-2xl border border-[#d9dff0] bg-[#f5f6fc] p-5">
      <div className="flex items-center gap-2 font-semibold text-[#384978]"><Banknote className="size-4" /> Approved maintenance payment</div>
      <p className="mt-2 text-xs leading-5 text-[#67708a]">Upload the supplier invoice, make the payment and record its bank or payment reference.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Payment reference"><Input name="paymentReference" required placeholder="Bank or payment reference" /></Field>
        <Field label="Payment note"><Input name="note" placeholder="Optional payment detail" /></Field>
      </div>
      <Button disabled={saving} className="mt-4 bg-[#1c3934] text-white">{saving ? "Marking paid…" : "Move to paid"}</Button>
    </form>
  );
}

function AccountsReconciliation({ ticket, mutate }: { ticket: MaintenanceTicket; mutate: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    await mutate({ action: "reconcile", id: ticket.id, invoiceReference: form.get("invoiceReference"), note: form.get("note") });
    setSaving(false);
  }
  return (
    <form onSubmit={submit} className="rounded-2xl border border-[#d9dff0] bg-[#f5f6fc] p-5">
      <div className="flex items-center gap-2 font-semibold text-[#384978]"><ReceiptText className="size-4" /> Reconcile paid maintenance</div>
      <p className="mt-2 text-xs leading-5 text-[#67708a]">Payment {ticket.paymentReference || "recorded"}. Match the supplier invoice to {ticket.reference}, the property and the client payout deduction.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Invoice reference"><Input name="invoiceReference" required placeholder="Supplier invoice number" /></Field>
        <Field label="Reconciliation note"><Input name="note" placeholder="Account, payout or payment note" /></Field>
      </div>
      <Button disabled={saving} className="mt-4 bg-[#1c3934] text-white">{saving ? "Reconciling…" : "Mark reconciled"}</Button>
    </form>
  );
}

function EvidencePanel({
  ticket,
  permissions,
  toolWorkspace,
  upload,
}: {
  ticket: MaintenanceTicket;
  permissions: MaintenanceData["permissions"];
  toolWorkspace: MaintenanceWorkspace;
  upload: (ticketId: string, kind: EvidenceKind, file: File) => Promise<boolean>;
}) {
  return (
    <section className="rounded-2xl border border-[#dbe5df] bg-white p-5">
      <div className="flex items-center gap-2 font-semibold"><ImagePlus className="size-4 text-[#527261]" /> Evidence & invoices</div>
      <div className="mt-4 flex flex-wrap gap-2">
        {toolWorkspace === "stays" && permissions.stays && <EvidenceUpload ticket={ticket} kind="issue" label="Issue evidence" upload={upload} />}
        {toolWorkspace === "ready" && permissions.ready && <EvidenceUpload ticket={ticket} kind="completion" label="Completion evidence" upload={upload} />}
        {toolWorkspace === "accounts" && permissions.accounts && <EvidenceUpload ticket={ticket} kind="invoice" label="Supplier invoice" upload={upload} />}
      </div>
      <div className="mt-4 space-y-2">
        {ticket.evidence.map((item) => (
          <a key={item.id} href={`/api/maintenance/evidence/${item.id}`} className="flex items-center justify-between gap-4 rounded-xl bg-[#f5f8f6] px-4 py-3 text-sm hover:bg-[#edf3ef]">
            <span className="inline-flex min-w-0 items-center gap-2"><FileText className="size-4 shrink-0 text-[#527261]" /><span className="truncate font-medium">{item.fileName}</span></span>
            <span className="shrink-0 text-xs text-[#718184]">{evidenceKindLabel(item.kind)}</span>
          </a>
        ))}
        {ticket.evidence.length === 0 && <p className="text-sm text-[#718184]">No evidence uploaded yet.</p>}
      </div>
    </section>
  );
}

function EvidenceUpload({ ticket, kind, label, upload }: { ticket: MaintenanceTicket; kind: EvidenceKind; label: string; upload: (ticketId: string, kind: EvidenceKind, file: File) => Promise<boolean> }) {
  const [saving, setSaving] = useState(false);
  return (
    <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-[#d4dfdb] bg-white px-3 text-sm font-medium hover:bg-[#f6f8f7]">
      {saving ? <Clock3 className="size-4" /> : <Upload className="size-4" />} {saving ? "Uploading…" : label}
      <input
        className="sr-only"
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        disabled={saving}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          setSaving(true);
          await upload(ticket.id, kind, file);
          setSaving(false);
          event.target.value = "";
        }}
      />
    </label>
  );
}

function Timeline({ ticket, canAddNote, mutate }: { ticket: MaintenanceTicket; canAddNote: boolean; mutate: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <section className="rounded-2xl border border-[#dbe5df] bg-white p-5">
      <div className="flex items-center gap-2 font-semibold"><History className="size-4 text-[#527261]" /> Connected updates</div>
      {canAddNote && (
        <div className="mt-4 flex gap-2">
          <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add an update for every connected team" />
          <Button
            disabled={saving || note.trim().length < 2}
            onClick={async () => {
              setSaving(true);
              if (await mutate({ action: "note", id: ticket.id, note })) setNote("");
              setSaving(false);
            }}
            variant="outline"
          >
            Add update
          </Button>
        </div>
      )}
      <div className="mt-5 space-y-4 border-l border-[#dce5e2] pl-4">
        {ticket.updates.map((update) => (
          <div key={update.id} className="relative">
            <span className="absolute -left-[1.22rem] top-1.5 size-2 rounded-full bg-[#6c9560]" />
            <p className="text-sm leading-6 text-[#526568]">{update.note}</p>
            <p className="mt-1 text-xs text-[#819093]">{update.actorName} · {formatDateTime(update.createdAt)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ThresholdWorkspace({ thresholds, onData, onError }: { thresholds: MaintenanceThreshold[]; onData: (data: MaintenanceData) => void; onError: (error: string) => void }) {
  return (
    <section className="mt-5 rounded-[1.6rem] border border-[#d5dfdc] bg-white p-5 sm:p-6">
      <div className="max-w-3xl">
        <p className="eyebrow">Approval matrix</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">Repair thresholds</h2>
        <p className="mt-2 text-sm leading-6 text-[#647577]">
          Jobs up to the management limit can be scheduled without approval. Jobs above it need management approval; jobs above the client limit also need client approval.
        </p>
      </div>
      <div className="mt-6 space-y-3">
        {thresholds.map((threshold) => (
          <ThresholdRow key={`${threshold.category}:${threshold.managementLimitPence}:${threshold.clientLimitPence}`} threshold={threshold} onData={onData} onError={onError} />
        ))}
      </div>
    </section>
  );
}

function ThresholdRow({ threshold, onData, onError }: { threshold: MaintenanceThreshold; onData: (data: MaintenanceData) => void; onError: (error: string) => void }) {
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    onError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/maintenance", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        category: threshold.category,
        managementLimitPence: Math.round(Number(form.get("managementLimit")) * 100),
        clientLimitPence: Math.round(Number(form.get("clientLimit")) * 100),
      }),
    });
    const result = (await response.json().catch(() => null)) as { data?: MaintenanceData; error?: string } | null;
    setSaving(false);
    if (!response.ok || !result?.data) {
      onError(result?.error || "The threshold could not be saved.");
      return;
    }
    onData(result.data);
  }
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-2xl border border-[#e0e7e4] p-4 lg:grid-cols-[1fr_12rem_12rem_auto] lg:items-end">
      <div>
        <p className="font-semibold">{threshold.category}</p>
        <p className="mt-1 text-xs text-[#718184]">{threshold.configured ? "Configured" : "Approval required until configured"}</p>
      </div>
      <Field label="No approval up to (£)"><Input name="managementLimit" type="number" min="0" step="0.01" defaultValue={(threshold.managementLimitPence / 100).toFixed(2)} /></Field>
      <Field label="Client approval over (£)"><Input name="clientLimit" type="number" min="0" step="0.01" defaultValue={(threshold.clientLimitPence / 100).toFixed(2)} /></Field>
      <Button disabled={saving} variant="outline">{saving ? "Saving…" : "Save"}</Button>
    </form>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#819093]">{label}</p><p className="mt-1 text-sm font-medium text-[#40585b]">{value}</p></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>;
}

function StatusBadge({ status }: { status: MaintenanceStatus }) {
  const tone = status === "approval_pending" || status === "management_review"
    ? "bg-[#fff1ce] text-[#8a641c]"
    : status === "reconciled" || status === "closed"
      ? "bg-[#e8f7d6] text-[#36561d]"
      : status === "quote_required" || status === "accounts_pending"
        ? "bg-[#fee8e8] text-[#9c3737]"
        : "bg-[#edf2f0] text-[#526a64]";
  return <Badge className={`border-0 ${tone}`}>{statusLabel(status)}</Badge>;
}

function PriorityBadge({ priority }: { priority: MaintenanceTicket["priority"] }) {
  if (priority === "normal") return null;
  return <Badge className={`border-0 ${priority === "emergency" ? "bg-[#fee8e8] text-[#9c3737]" : "bg-[#fff1ce] text-[#8a641c]"}`}>{priority}</Badge>;
}

function ticketsForWorkspace(data: MaintenanceData, workspace: MaintenanceWorkspace, user: MaintenanceUser, rootWorkspace: MaintenanceWorkspace) {
  if (workspace === "client") {
    return data.tickets.filter((ticket) =>
      ticket.quoteAmountPence !== null &&
      !["quote_required", "approval_pending"].includes(ticket.status),
    );
  }
  if (workspace === "new_maintenance") return data.tickets.filter((ticket) => ticket.status === "new" && !ticket.readyReference);
  if (workspace === "ongoing_maintenance") return data.tickets.filter((ticket) => isOpen(ticket) && ticket.status !== "new" && !ticket.readyReference);
  if (workspace === "referred_ready") return data.tickets.filter((ticket) => Boolean(ticket.readyReference) && isOpen(ticket));
  if (workspace === "complete_maintenance") return data.tickets.filter(isClosed);
  if (workspace === "reporting") return [];
  if (workspace === "ready") return data.tickets.filter((ticket) => Boolean(ticket.readyReference) && !["accounts_pending", "accounts_paid", "reconciled", "closed"].includes(ticket.status));
  if (workspace === "approvals") {
    return data.tickets.filter((ticket) =>
      user.role === "client"
        ? ticket.clientApproval === "pending"
        : Boolean(ticket.readyReference) && (needsApproval(ticket) || ticket.status === "management_review"),
    );
  }
  if (workspace === "accounts") return data.tickets.filter((ticket) => ["pending", "paid"].includes(ticket.accountsStatus));
  if (workspace === "closed") {
    return rootWorkspace === "accounts"
      ? data.tickets.filter((ticket) => ticket.accountsStatus === "reconciled")
      : data.tickets.filter(isClosed);
  }
  return data.tickets.filter(isOpen);
}

function isOpen(ticket: MaintenanceTicket) {
  return !["reconciled", "closed"].includes(ticket.status);
}

function isClosed(ticket: MaintenanceTicket) {
  return ["reconciled", "closed"].includes(ticket.status);
}

function needsApproval(ticket: MaintenanceTicket) {
  return ticket.managementApproval === "pending" || ticket.clientApproval === "pending";
}

function workspaceLabel(workspace: MaintenanceWorkspace) {
  return {
    stays: "Stays maintenance tickets",
    new_maintenance: "New maintenance",
    ongoing_maintenance: "Ongoing maintenance",
    referred_ready: "Referred to Recharge Ready",
    complete_maintenance: "Completed maintenance",
    reporting: "Maintenance reporting",
    ready: "Recharge Ready repairs",
    approvals: "Approval queue",
    accounts: "Maintenance reconciliation",
    closed: "Completed maintenance tickets",
    thresholds: "Thresholds",
    client: "Approved property maintenance",
  }[workspace];
}

function statusLabel(status: MaintenanceStatus) {
  return {
    new: "New",
    quote_required: "Quote required",
    approval_pending: "Approval pending",
    ready_to_schedule: "Ready to schedule",
    scheduled: "Scheduled",
    in_progress: "In progress",
    management_review: "Management review",
    accounts_pending: "Accounts pending",
    accounts_paid: "Paid",
    reconciled: "Reconciled",
    closed: "Closed",
  }[status];
}

function maintenanceToolCopy(workspace: MaintenanceWorkspace) {
  if (workspace === "client") {
    return {
      eyebrow: "My Properties",
      title: "Property Maintenance",
      description: "Approved property works, full reports, quotations, scheduled visits, evidence and progress in one place.",
    };
  }
  if (workspace === "ready") {
    return {
      eyebrow: "Recharge Ready",
      title: "Ready Maintenance",
      description: "Referred repairs, quotes, approvals, thresholds, scheduling and completion evidence in one Ready workboard.",
    };
  }
  if (workspace === "accounts") {
    return {
      eyebrow: "Recharge Accounts",
      title: "Approved Maintenance",
      description: "Approved maintenance work moves from payment to reconciliation before the connected ticket closes.",
    };
  }
  return {
    eyebrow: "Recharge Stays",
    title: "Maintenance Reporting",
    description: "Raise guest and property issues, complete troubleshooting and refer unresolved repairs to Recharge Ready.",
  };
}

function maintenanceStats(data: MaintenanceData, workspace: MaintenanceWorkspace) {
  if (workspace === "client") {
    const quoted = data.tickets.filter((ticket) => ticket.quoteAmountPence !== null && !["quote_required", "approval_pending"].includes(ticket.status));
    return [
      { label: "Approved work", value: quoted.filter((ticket) => ticket.status === "ready_to_schedule").length, icon: CheckCircle2 },
      { label: "Scheduled", value: quoted.filter((ticket) => ticket.status === "scheduled").length, icon: CalendarDays },
      { label: "In progress", value: quoted.filter((ticket) => ticket.status === "in_progress").length, icon: Wrench },
      { label: "Completed", value: quoted.filter(isClosed).length, icon: Archive },
    ];
  }
  if (workspace === "ready") {
    return [
      { label: "Ready workboard", value: data.tickets.filter((ticket) => ticket.readyReference && !["accounts_pending", "accounts_paid", "reconciled", "closed"].includes(ticket.status)).length, icon: Wrench },
      { label: "Awaiting approval", value: data.tickets.filter((ticket) => ticket.readyReference && needsApproval(ticket)).length, icon: Flag },
      { label: "Scheduled", value: data.tickets.filter((ticket) => ticket.status === "scheduled").length, icon: CalendarDays },
      { label: "Management review", value: data.tickets.filter((ticket) => ticket.status === "management_review").length, icon: ShieldCheck },
    ];
  }
  if (workspace === "accounts") {
    return [
      { label: "Approved", value: data.tickets.filter((ticket) => ticket.accountsStatus === "pending").length, icon: ReceiptText },
      { label: "Paid", value: data.tickets.filter((ticket) => ticket.accountsStatus === "paid").length, icon: Banknote },
      { label: "Reconciled", value: data.tickets.filter((ticket) => ticket.accountsStatus === "reconciled").length, icon: CheckCircle2 },
      { label: "Invoice required", value: data.tickets.filter((ticket) => ticket.accountsStatus === "pending" && !ticket.evidence.some((item) => item.kind === "invoice")).length, icon: FileText },
    ];
  }
  return [
    { label: "Open tickets", value: data.tickets.filter(isOpen).length, icon: ListChecks },
    { label: "Troubleshooting", value: data.tickets.filter((ticket) => ticket.status === "new").length, icon: ShieldCheck },
    { label: "Passed to Ready", value: data.tickets.filter((ticket) => Boolean(ticket.readyReference) && isOpen(ticket)).length, icon: Wrench },
    { label: "Closed tickets", value: data.tickets.filter(isClosed).length, icon: Archive },
  ];
}

function reservationLabel(reservation: HostawayReservation) {
  return `${reservation.guestName || "Guest not named"} · ${reservation.bookingReference}`;
}

function formatReservationDates(reservation: HostawayReservation) {
  return [formatShortDate(reservation.arrivalDate), formatShortDate(reservation.departureDate)].join(" – ");
}

function formatStayDates(ticket: MaintenanceTicket) {
  if (!ticket.reservationArrivalDate && !ticket.reservationDepartureDate) return "Not recorded";
  return [formatShortDate(ticket.reservationArrivalDate), formatShortDate(ticket.reservationDepartureDate)].join(" – ");
}

function updateFreshness(ticket: MaintenanceTicket) {
  const hours = Math.max(0, (Date.now() / 1000 - ticket.updatedAt) / 3600);
  if (hours >= 24) return { tone: "red" as const, shortLabel: `${Math.floor(hours)}h without update`, title: "Update overdue", description: `This ticket has not been updated for ${Math.floor(hours)} hours.` };
  if (hours >= 12) return { tone: "yellow" as const, shortLabel: `${Math.floor(hours)}h without update`, title: "Update due soon", description: `This ticket has not been updated for ${Math.floor(hours)} hours and will become overdue at 24 hours.` };
  const remaining = Math.max(1, Math.ceil(24 - hours));
  return { tone: "green" as const, shortLabel: `Updated ${Math.floor(hours)}h ago`, title: "Update on time", description: `The next update is due within ${remaining} hours.` };
}

function ticketResolutionTime(ticket: MaintenanceTicket) { return ticket.closedAt || ticket.reconciledAt || ticket.completedAt || null; }
function formatDuration(hours: number) { if (hours < 24) return `${hours.toFixed(hours < 10 ? 1 : 0)} hours`; const days = hours / 24; return `${days.toFixed(days < 10 ? 1 : 0)} days`; }

function reportingBuckets(period: "day" | "week" | "month" | "year") {
  const now = new Date();
  if (period === "day") return Array.from({ length: 14 }, (_, index) => { const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (13 - index)); const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1); return { start: date.getTime() / 1000, end: end.getTime() / 1000, label: date.toLocaleDateString("en-GB", { day: "numeric", month: "long" }), shortLabel: date.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) }; });
  if (period === "week") { const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)); return Array.from({ length: 12 }, (_, index) => { const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - (11 - index) * 7); const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7); return { start: date.getTime() / 1000, end: end.getTime() / 1000, label: `Week commencing ${date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`, shortLabel: date.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) }; }); }
  if (period === "month") return Array.from({ length: 12 }, (_, index) => { const date = new Date(now.getFullYear(), now.getMonth() - (11 - index), 1); const end = new Date(date.getFullYear(), date.getMonth() + 1, 1); return { start: date.getTime() / 1000, end: end.getTime() / 1000, label: date.toLocaleDateString("en-GB", { month: "long", year: "numeric" }), shortLabel: date.toLocaleDateString("en-GB", { month: "short" }) }; });
  return Array.from({ length: 5 }, (_, index) => { const year = now.getFullYear() - (4 - index); return { start: new Date(year, 0, 1).getTime() / 1000, end: new Date(year + 1, 0, 1).getTime() / 1000, label: String(year), shortLabel: String(year) }; });
}

function evidenceKindLabel(kind: EvidenceKind) {
  return kind === "completion" ? "Completion" : kind === "invoice" ? "Invoice" : "Issue";
}

function formatMoney(pence: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);
}

function formatShortDate(value: string | null) {
  if (!value) return "Date not set";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function formatDateTime(value: number) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value * 1000));
}
