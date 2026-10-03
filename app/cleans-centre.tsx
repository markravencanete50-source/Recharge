"use client";


import { FormEvent, Fragment, cloneElement, createContext, isValidElement, useContext, useId, useMemo, useState } from "react";
import {
  ArrowLeft,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CloudDownload,
  FileImage,
  FileVideo,
  Mail,
  Plus,
  Search,
  SprayCan,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent as BaseDialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger as BaseSelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { CleansData, CleanFileKind, CleanProperty, Cleaner, CleanTicket } from "@/lib/cleans-types";
import type { ModuleId, WorkspaceRole } from "@/lib/modules";

export type CleansMode = Extract<ModuleId,
  | "clean-client-database"
  | "cleaner-database"
  | "cleaning-schedule"
  | "cleaner-performance"
  | "clean-property-onboarding"
  | "cleans-invoices"
  | "clean-reporting"
  | "client-mailbox"
  | "replenishment-requests"
>;

type ActionBody = Record<string, unknown> & { action: string };
const CleansErrorContext = createContext("");
const FieldIdContext = createContext<string | undefined>(undefined);
function SelectTrigger(props: React.ComponentProps<typeof BaseSelectTrigger>) {
  const id = useContext(FieldIdContext);
  return <BaseSelectTrigger {...props} id={props.id || id} aria-labelledby={props["aria-labelledby"] || (id ? `${id}-label` : undefined)} />;
}

function DialogContent({children, ...props}: React.ComponentProps<typeof BaseDialogContent>) {
  const error = useContext(CleansErrorContext);
  return <BaseDialogContent {...props}>{children}{error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}</BaseDialogContent>;
}

const modeTitles: Record<CleansMode, string> = {
  "clean-client-database": "Clean Client Database",
  "cleaner-database": "Cleaner Database",
  "cleaning-schedule": "Clean Calendar",
  "cleaner-performance": "Cleaner Performance",
  "clean-property-onboarding": "Clean Onboarding Tracker",
  "cleans-invoices": "Cleaner Invoices",
  "clean-reporting": "Stays Clean Reporting",
  "client-mailbox": "Mailbox",
  "replenishment-requests": "Replenishment Requests",
};

export function CleansCentre({ initialData, mode, role, onBack }: { initialData: CleansData; mode: CleansMode; role: WorkspaceRole; onBack: () => void }) {
  const [data, setData] = useState(initialData);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function action(body: ActionBody) {
    setBusy(true); setError("");
    try {
    const response = await fetch("/api/cleans", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => null) as { data?: CleansData; error?: string } | null;
    if (!response.ok || !result?.data) { setError(result?.error || "The update could not be saved"); setBusy(false); return false; }
    setData(result.data); setBusy(false); return true;
    } catch { setError("The update could not be saved. Check your connection and try again."); return false; }
    finally { setBusy(false); }
  }

  async function upload(ticketId: string, kind: CleanFileKind, file: File) {
    setBusy(true); setError("");
    const form = new FormData(); form.set("ticketId", ticketId); form.set("kind", kind); form.set("file", file);
    const response = await fetch("/api/cleans/files", { method: "POST", body: form });
    const result = await response.json().catch(() => null) as { data?: CleansData; error?: string } | null;
    if (!response.ok || !result?.data) { setError(result?.error || "The evidence could not be uploaded"); setBusy(false); return false; }
    setData(result.data); setBusy(false); return true;
  }

  async function sync() {
    setBusy(true); setError("");
    const response = await fetch("/api/cleans/sync", { method: "POST" });
    const result = await response.json().catch(() => null) as { data?: CleansData; error?: string } | null;
    if (!response.ok || !result?.data) setError(result?.error || "Hostaway could not be synced"); else setData(result.data);
    setBusy(false);
  }

  if (!data.available) return <EmptyState title="Recharge Cleans is temporarily unavailable" description="The workspace could not reach its live data. Please refresh and try again." />;
  return (
    <CleansErrorContext.Provider value={error}><div>
      <Button variant="ghost" className="-ml-3 mb-5 text-[var(--muted-foreground)]" onClick={onBack}><ArrowLeft /> Back</Button>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><p className="eyebrow">Connected workflow</p><h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">{modeTitles[mode]}</h1></div>
        {mode === "cleaning-schedule" && <Button className="h-11 rounded-xl bg-[#1c3934] text-white" onClick={sync} disabled={busy || !data.hostawayConnected}><CloudDownload /> {busy ? "Syncing…" : "Sync Hostaway"}</Button>}
      </div>
      {error && <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      <div className="mt-8">
        {mode === "clean-client-database" && <PropertyDatabase data={data} action={action} busy={busy} />}
        {mode === "cleaner-database" && <CleanerDatabase data={data} action={action} busy={busy} />}
        {mode === "cleaning-schedule" && <CleanCalendar data={data} action={action} upload={upload} busy={busy} />}
        {mode === "cleaner-performance" && <CleanerPerformance data={data} action={action} busy={busy} />}
        {mode === "clean-property-onboarding" && <CleanOnboarding data={data} action={action} busy={busy} />}
        {mode === "cleans-invoices" && <CleanerInvoices data={data} action={action} busy={busy} />}
        {mode === "clean-reporting" && <CleanReporting data={data} action={action} upload={upload} busy={busy} />}
        {mode === "client-mailbox" && <ClientMailbox data={data} action={action} busy={busy} client={role === "client"} />}
        {mode === "replenishment-requests" && <Replenishments data={data} action={action} busy={busy} />}
      </div>
    </div></CleansErrorContext.Provider>
  );
}

function PropertyDatabase({ data, action, busy }: ScreenProps) {
  const [query, setQuery] = useState("");
  const rows = data.properties.filter((p) => `${p.propertyName} ${p.propertyAddress} ${p.clientName} ${p.cleanerName}`.toLowerCase().includes(query.toLowerCase()));
  return <div>
    <div className="flex flex-col gap-3 sm:flex-row sm:justify-between"><SearchBox value={query} onChange={setQuery} placeholder="Search property, client or cleaner" /><PropertyDialog cleaners={data.cleaners} action={action} busy={busy} /></div>
    <div className="mt-5 overflow-hidden rounded-3xl border border-[var(--border)] bg-white">
      {rows.map((property) => <div className="grid gap-4 border-b border-[var(--border)] p-5 last:border-0 lg:grid-cols-[1.1fr_1.3fr_1fr_auto] lg:items-center" key={property.id}>
        <div><p className="font-semibold">{property.propertyName}</p><p className="mt-1 text-xs text-[var(--muted-foreground)]">{property.clientName || "Client not linked"}</p></div>
        <div><p className="text-sm text-[var(--muted-foreground)]">{property.propertyAddress}</p><p className="mt-1 line-clamp-2 text-xs text-[var(--muted-foreground)]">{property.accessInstructions || "No access instructions yet"}</p></div>
        <div><p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Cleaner</p><p className="mt-1 text-sm font-semibold">{property.cleanerName || "Unassigned"}</p></div>
        <PropertyDialog property={property} cleaners={data.cleaners} action={action} busy={busy} />
      </div>)}
      {!rows.length && <EmptyRow text="No cleaning properties match this search." />}
    </div>
  </div>;
}

function PropertyDialog({ property, cleaners, action, busy }: { property?: CleanProperty; cleaners: Cleaner[]; action: (body: ActionBody) => Promise<boolean>; busy: boolean }) {
  const [open, setOpen] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const ok = await action({ action: "save_property", id: property?.id, propertyName: form.get("propertyName"), propertyAddress: form.get("propertyAddress"), accessInstructions: form.get("accessInstructions"), clientName: form.get("clientName"), clientEmail: form.get("clientEmail"), cleanerId: form.get("cleanerId") === "none" ? null : form.get("cleanerId"), cleanPricePence: Math.round(Number(form.get("cleanPrice")) * 100), status: form.get("status") });
    if (ok) setOpen(false);
  }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild>{property ? <Button variant="outline" className="rounded-xl">Edit</Button> : <Button className="rounded-xl bg-[#1c3934] text-white"><Plus /> Add property</Button>}</DialogTrigger><DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-2xl"><form onSubmit={submit}><DialogHeader><DialogTitle>{property ? "Edit cleaning property" : "Add cleaning property"}</DialogTitle><DialogDescription>Store access, client, cleaner and agreed clean pricing in one record.</DialogDescription></DialogHeader><div className="mt-6 grid gap-4 sm:grid-cols-2">
    <Field label="Property name"><Input name="propertyName" required defaultValue={property?.propertyName} /></Field><Field label="Property address"><Input name="propertyAddress" required defaultValue={property?.propertyAddress} /></Field><Field label="Client name"><Input name="clientName" defaultValue={property?.clientName} /></Field><Field label="Client email"><Input type="email" name="clientEmail" defaultValue={property?.clientEmail} /></Field><Field label="Cleaner"><Select name="cleanerId" defaultValue={property?.cleanerId || "none"}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem>{cleaners.filter((c) => c.status === "active").map((c) => <SelectItem value={c.id} key={c.id}>{c.fullName}</SelectItem>)}</SelectContent></Select></Field><Field label="Clean price (£)"><Input type="number" min="0" step="0.01" name="cleanPrice" defaultValue={((property?.cleanPricePence || 0) / 100).toFixed(2)} /></Field><div className="sm:col-span-2"><Field label="Access instructions"><Textarea name="accessInstructions" defaultValue={property?.accessInstructions} rows={4} /></Field></div><Field label="Status"><Select name="status" defaultValue={property?.status || "active"}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent></Select></Field>
  </div><DialogFooter className="mt-6"><Button type="submit" disabled={busy} className="bg-[#1c3934] text-white">{busy ? "Saving…" : "Save property"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function CleanerDatabase({ data, action, busy }: ScreenProps) {
  const [query, setQuery] = useState("");
  const rows = data.cleaners.filter((c) => `${c.fullName} ${c.email} ${c.phone}`.toLowerCase().includes(query.toLowerCase()));
  const unassigned = data.properties.filter((property) => property.status === "active" && !property.cleanerId).length;
  return <Tabs defaultValue="cleaners">
    <TabsList><TabsTrigger value="cleaners">Cleaners ({data.cleaners.length})</TabsTrigger><TabsTrigger value="properties">Property assignments ({unassigned} unassigned)</TabsTrigger></TabsList>
    <TabsContent value="cleaners" className="mt-5"><div><div className="flex flex-col gap-3 sm:flex-row sm:justify-between"><SearchBox value={query} onChange={setQuery} placeholder="Search cleaners" /><CleanerDialog action={action} busy={busy} /></div><div className="mt-5 grid gap-4 lg:grid-cols-2">{rows.map((cleaner) => <article className="rounded-3xl border border-[var(--border)] bg-white p-5" key={cleaner.id}><div className="flex justify-between gap-3"><div className="flex gap-3"><div className="grid size-11 place-items-center rounded-2xl bg-[var(--muted)]"><UserRound className="size-5" /></div><div><p className="font-semibold">{cleaner.fullName}</p><p className="text-xs text-[var(--muted-foreground)]">{cleaner.email || cleaner.phone || "Contact details pending"}</p></div></div><CleanerDialog cleaner={cleaner} action={action} busy={busy} /></div><div className="mt-5 grid grid-cols-3 gap-2"><MiniStat label="Properties" value={String(cleaner.assignedProperties)} /><MiniStat label="Successful" value={String(cleaner.approvedCleans)} /><MiniStat label="Success" value={cleaner.successRate === null ? "—" : `${cleaner.successRate}%`} alert={cleaner.successRate !== null && cleaner.successRate < 95} /></div><p className="mt-4 text-sm text-[var(--muted-foreground)]">{data.properties.filter((p) => p.cleanerId === cleaner.id).map((p) => p.propertyName).join(", ") || "No properties assigned"}</p></article>)}</div>{!rows.length && <EmptyState title="No cleaners found" description="Add the first cleaner to start assigning properties and cleans." />}</div></TabsContent>
    <TabsContent value="properties" className="mt-5"><PropertyAssignments properties={data.properties} cleaners={data.cleaners} action={action} busy={busy} /></TabsContent>
  </Tabs>;
}

function PropertyAssignments({ properties, cleaners, action, busy }: { properties: CleanProperty[]; cleaners: Cleaner[]; action: (body: ActionBody) => Promise<boolean>; busy: boolean }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("unassigned");
  const rows = properties.filter((property) => {
    const matchesQuery = `${property.propertyName} ${property.propertyAddress} ${property.cleanerName}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === "all" || (filter === "assigned" ? Boolean(property.cleanerId) : !property.cleanerId);
    return matchesQuery && matchesFilter;
  });
  return <div><div className="grid gap-3 sm:grid-cols-[1fr_220px]"><SearchBox value={query} onChange={setQuery} placeholder="Search properties or cleaners" /><Select value={filter} onValueChange={setFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unassigned">Unassigned properties</SelectItem><SelectItem value="assigned">Assigned properties</SelectItem><SelectItem value="all">All properties</SelectItem></SelectContent></Select></div><div className="mt-5 space-y-3">{rows.map((property) => <PropertyAssignmentRow key={property.id} property={property} cleaners={cleaners} action={action} busy={busy} />)}{!rows.length && <EmptyState title="No properties in this view" description={filter === "unassigned" ? "Every property currently has a cleaner assigned." : "Try another search or assignment filter."} />}</div></div>;
}

function PropertyAssignmentRow({ property, cleaners, action, busy }: { property: CleanProperty; cleaners: Cleaner[]; action: (body: ActionBody) => Promise<boolean>; busy: boolean }) {
  const [cleanerId, setCleanerId] = useState(property.cleanerId || "none");
  const changed = cleanerId !== (property.cleanerId || "none");
  return <article className="grid gap-4 rounded-2xl border border-[var(--border)] bg-white p-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.7fr)_auto] lg:items-center"><div className="flex min-w-0 gap-3"><div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[var(--muted)] text-[var(--muted-foreground)]"><Building2 className="size-5" /></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-semibold">{property.propertyName}</p>{property.status === "inactive" && <Badge variant="secondary">Inactive</Badge>}</div><p className="mt-1 truncate text-xs text-[var(--muted-foreground)]">{property.propertyAddress || "Address pending"}</p></div></div><Select value={cleanerId} onValueChange={setCleanerId}><SelectTrigger className="w-full"><SelectValue placeholder="Choose cleaner" /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem>{cleaners.filter((cleaner) => cleaner.status === "active").map((cleaner) => <SelectItem value={cleaner.id} key={cleaner.id}>{cleaner.fullName} · {cleaner.assignedProperties} properties</SelectItem>)}</SelectContent></Select><Button disabled={busy || !changed} onClick={() => action({ action: "assign_property_cleaner", propertyId: property.id, cleanerId: cleanerId === "none" ? null : cleanerId })} className="bg-[#1c3934] text-white">Save assignment</Button></article>;
}

function CleanerDialog({ cleaner, action, busy }: { cleaner?: Cleaner; action: (body: ActionBody) => Promise<boolean>; busy: boolean }) {
  const [open, setOpen] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const ok = await action({ action: "save_cleaner", id: cleaner?.id, fullName: form.get("fullName"), email: form.get("email"), phone: form.get("phone"), notes: form.get("notes"), status: form.get("status") }); if (ok) setOpen(false); }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild>{cleaner ? <Button variant="outline" size="sm">Edit</Button> : <Button className="rounded-xl bg-[#1c3934] text-white"><Plus /> Add cleaner</Button>}</DialogTrigger><DialogContent className="rounded-3xl"><form onSubmit={submit}><DialogHeader><DialogTitle>{cleaner ? "Edit cleaner" : "Add cleaner"}</DialogTitle><DialogDescription>Contact details and status for this cleaning team member.</DialogDescription></DialogHeader><div className="mt-6 space-y-4"><Field label="Full name"><Input required name="fullName" defaultValue={cleaner?.fullName} /></Field><Field label="Email"><Input type="email" name="email" defaultValue={cleaner?.email} /></Field><Field label="Phone"><Input name="phone" defaultValue={cleaner?.phone} /></Field><Field label="Notes"><Textarea name="notes" defaultValue={cleaner?.notes} /></Field><Field label="Status"><Select name="status" defaultValue={cleaner?.status || "active"}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent></Select></Field></div><DialogFooter className="mt-6"><Button disabled={busy} className="bg-[#1c3934] text-white">Save cleaner</Button></DialogFooter></form></DialogContent></Dialog>;
}

function CleanCalendar({ data, action, upload, busy }: ScreenProps & UploadProps) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [query, setQuery] = useState("");
  const tickets = data.tickets.filter((ticket) => `${ticket.propertyName} ${ticket.guestName} ${ticket.assignedCleanerName} ${ticket.bookingReference}`.toLowerCase().includes(query.toLowerCase()));
  const today = dateOffsetFromToday(0);
  const releaseCutoff = dateOffsetFromToday(1);
  const releasedTickets = tickets.filter((ticket) => ticket.cleanDate >= today && ticket.cleanDate <= releaseCutoff && ["scheduled", "in_progress"].includes(ticket.status));
  return <div><div className="mb-5 grid gap-3 sm:grid-cols-[1fr_auto]"><SearchBox value={query} onChange={setQuery} placeholder="Search property, guest, cleaner or booking" />{!data.hostawayConnected && <Badge className="border-0 bg-amber-100 text-amber-900">Hostaway connection required</Badge>}</div><Tabs defaultValue="calendar"><TabsList><TabsTrigger value="calendar">Calendar view</TabsTrigger><TabsTrigger value="tickets">Ticket view ({releasedTickets.length})</TabsTrigger></TabsList><TabsContent value="calendar" className="mt-5"><MonthCalendar month={month} onMonth={setMonth} tickets={tickets} cleaners={data.cleaners} action={action} upload={upload} busy={busy} /></TabsContent><TabsContent value="tickets" className="mt-5"><p className="mb-4 rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-sm text-[var(--muted-foreground)]">Clean tickets are released one day before the clean. Later bookings remain visible in Calendar View.</p><TicketList tickets={releasedTickets} cleaners={data.cleaners} action={action} upload={upload} busy={busy} /></TabsContent></Tabs></div>;
}

function MonthCalendar({ month, onMonth, tickets, ...props }: { month: string; onMonth: (value: string) => void; tickets: CleanTicket[] } & TicketProps) {
  const monthDate = new Date(`${month}-01T12:00:00Z`);
  const days = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0)).getUTCDate();
  const monthStart = `${month}-01`;
  const nextMonth = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  const today = dateOffsetFromToday(0);
  const visibleTickets = tickets.filter((ticket) => (ticket.arrivalDate || ticket.cleanDate) < nextMonth && ticket.cleanDate >= monthStart);
  const properties = Array.from(new Set(visibleTickets.map((ticket) => ticket.propertyName))).sort((a, b) => a.localeCompare(b));
  const gridStyle = { gridTemplateColumns: `220px repeat(${days}, minmax(58px, 1fr))`, minWidth: `${220 + days * 58}px` };
  function move(delta: number) { const date = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + delta, 1)); onMonth(date.toISOString().slice(0, 7)); }
  return <div className="overflow-hidden rounded-3xl border border-[var(--border)] bg-white">
    <div className="flex flex-col gap-3 border-b border-[var(--border)] p-4 sm:flex-row sm:items-center sm:justify-between">
      <Button variant="ghost" size="icon" onClick={() => move(-1)}><ChevronLeft /></Button>
      <div className="text-center"><p className="font-semibold">{new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(monthDate)}</p><p className="mt-0.5 text-xs text-[var(--muted-foreground)]">Bookings run from check-in to checkout · Clean is due at checkout</p></div>
      <Button variant="ghost" size="icon" onClick={() => move(1)}><ChevronRight /></Button>
    </div>
    <div className="flex flex-wrap gap-3 border-b border-[var(--border)] px-4 py-3 text-xs font-medium text-[var(--muted-foreground)]">
      <Legend swatch="bg-[var(--muted)] border-[var(--border)]" label="Upcoming" />
      <Legend swatch="bg-amber-100 border-amber-200" label="Due today" />
      <Legend swatch="bg-emerald-100 border-emerald-300" label="Complete" />
      <Legend swatch="bg-red-100 border-red-300" label="Unsuccessful" />
    </div>
    <div className="overflow-x-auto">
      <div className="grid bg-[var(--muted)]" style={gridStyle}>
        <div className="sticky left-0 z-20 border-r border-[var(--border)] bg-[var(--muted)] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Property</div>
        {Array.from({ length: days }).map((_, index) => {
          const date = `${month}-${String(index + 1).padStart(2, "0")}`;
          const day = new Date(`${date}T12:00:00Z`);
          return <div className={`border-r border-[var(--border)] px-1 py-2 text-center ${date === today ? "bg-[var(--muted)]" : ""}`} key={date}><p className="text-[0.62rem] font-semibold uppercase text-[var(--muted-foreground)]">{new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(day)}</p><p className="mt-0.5 text-sm font-semibold">{index + 1}</p></div>;
        })}
      </div>
      {properties.map((propertyName) => {
        const propertyTickets = visibleTickets.filter((ticket) => ticket.propertyName === propertyName);
        const bookings = calendarBookings(propertyTickets, monthStart, days);
        const laneCount = Math.max(1, ...bookings.map((booking) => booking.lane + 1));
        const cleaner = propertyTickets.find((ticket) => ticket.assignedCleanerName)?.assignedCleanerName;
        const propertyGridStyle = { ...gridStyle, gridTemplateRows: `repeat(${laneCount}, 4.5rem)` };
        return <div className="relative grid border-t border-[var(--border)]" style={propertyGridStyle} key={propertyName}>
          <div className="sticky left-0 z-20 border-r border-[var(--border)] bg-white px-4 py-4" style={{ gridRow: `1 / ${laneCount + 1}` }}><p className="truncate text-sm font-semibold">{propertyName}</p><p className="mt-1 truncate text-xs text-[var(--muted-foreground)]">{cleaner || "Cleaner unassigned"}</p></div>
          {Array.from({ length: days }).map((_, index) => {
            const date = `${month}-${String(index + 1).padStart(2, "0")}`;
            return <div className={`border-r border-[var(--border)] ${date === today ? "bg-[var(--card)]" : index % 2 ? "bg-[var(--card)]" : "bg-white"}`} style={{ gridColumn: index + 2, gridRow: `1 / ${laneCount + 1}` }} key={date} />;
          })}
          {bookings.map(({ ticket, start, end, nights, lane }) => {
            const tone = calendarTone(ticket, today);
            const guestCount = guestCountLabel(ticket);
            const bar = <div className={`h-9 w-full truncate rounded-lg border px-3 py-2 text-left text-xs font-semibold shadow-sm transition hover:brightness-95 ${tone}`} title={`${ticket.guestName || "Guest"} · ${guestCount} · ${nights} night${nights === 1 ? "" : "s"}`}><span>{ticket.guestName || "Guest"}</span><span className="ml-1 opacity-65">· {nights}n</span></div>;
            const cleanDay = ticket.cleanDate >= monthStart && ticket.cleanDate < nextMonth ? Number(ticket.cleanDate.slice(-2)) : null;
            return <Fragment key={ticket.id}>
              <div className="z-10 self-start px-1 pt-2" style={{ gridColumn: `${start + 2} / ${end + 2}`, gridRow: lane + 1 }}><CleanTicketDialog ticket={ticket} {...props} trigger={<button className="w-full" aria-label={`Open ${ticket.propertyName} clean for ${ticket.guestName || "guest"}`}>{bar}</button>} /></div>
              {cleanDay && <div className="z-10 self-end px-1 pb-2" style={{ gridColumn: cleanDay + 1, gridRow: lane + 1 }}><span className={`block truncate rounded-md border px-1.5 py-1 text-center text-[0.58rem] font-bold uppercase tracking-wide ${tone}`}>Clean</span></div>}
            </Fragment>;
          })}
        </div>;
      })}
      {!properties.length && <div className="p-10 text-center text-sm text-[var(--muted-foreground)]">No Hostaway bookings fall within this month.</div>}
    </div>
  </div>;
}

function TicketList({ tickets, ...props }: { tickets: CleanTicket[] } & TicketProps) {
  return <div className="space-y-3">{tickets.map((ticket) => <CleanTicketDialog ticket={ticket} {...props} key={ticket.id} trigger={<button className="grid w-full gap-3 rounded-2xl border border-[var(--border)] bg-white p-4 text-left transition hover:border-[var(--border)] sm:grid-cols-[1fr_auto_auto] sm:items-center"><div><p className="font-semibold">{ticket.propertyName}</p><p className="mt-1 text-xs text-[var(--muted-foreground)]">{ticket.guestName || "Guest pending"} · {ticket.bookingReference || "Hostaway booking"}</p></div><p className="text-sm font-medium">{formatDate(ticket.cleanDate)}</p><Status value={ticket.status} /></button>} />)}{!tickets.length && <EmptyState title="No clean tickets" description="Sync Hostaway to pull booking departures into the calendar." />}</div>;
}

type TicketProps = { cleaners: Cleaner[]; action: (body: ActionBody) => Promise<boolean>; upload: (ticketId: string, kind: CleanFileKind, file: File) => Promise<boolean>; busy: boolean };
function CleanTicketDialog({ ticket, cleaners, action, upload, busy, trigger }: TicketProps & { ticket: CleanTicket; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false); const [cleanerId, setCleanerId] = useState(ticket.assignedCleanerId || ""); const [broadband, setBroadband] = useState(ticket.broadbandWorking ?? true); const [heating, setHeating] = useState(ticket.heatingWorking ?? true); const [hotWater, setHotWater] = useState(ticket.hotWaterWorking ?? true); const [mail, setMail] = useState(ticket.mailPresent);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const ok = await action({ action: "submit_clean", id: ticket.id, broadbandWorking: broadband, heatingWorking: heating, hotWaterWorking: hotWater, maintenanceNotes: form.get("maintenanceNotes"), replenishmentNotes: form.get("replenishmentNotes"), mailPresent: mail, mailNotes: form.get("mailNotes") }); if (ok) setOpen(false); }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild>{trigger}</DialogTrigger><DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-3xl"><DialogHeader><div className="flex items-center gap-3"><Status value={ticket.status} /><span className="text-xs text-[var(--muted-foreground)]">{formatDate(ticket.cleanDate)}</span></div><DialogTitle className="mt-2 text-2xl">{ticket.propertyName}</DialogTitle><DialogDescription>{ticket.propertyAddress}<br />{ticket.guestName || "Guest name unavailable"} · {guestCountLabel(ticket)} · {ticket.bookingReference || "No booking reference"}</DialogDescription></DialogHeader><div className="mt-6 space-y-6"><section className="rounded-2xl bg-[var(--muted)] p-4"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Assigned cleaner</p><div className="mt-3 flex gap-2"><Select value={cleanerId} onValueChange={setCleanerId}><SelectTrigger className="bg-white"><SelectValue placeholder="Choose cleaner" /></SelectTrigger><SelectContent>{cleaners.filter((c) => c.status === "active").map((c) => <SelectItem value={c.id} key={c.id}>{c.fullName}</SelectItem>)}</SelectContent></Select><Button variant="outline" disabled={!cleanerId || busy} onClick={() => action({ action: "assign_cleaner", id: ticket.id, cleanerId })}>Assign</Button>{ticket.status === "scheduled" && <Button disabled={busy || !ticket.assignedCleanerId} onClick={() => action({ action: "start_clean", id: ticket.id })} className="bg-[#1c3934] text-white">Start</Button>}</div></section>
  {(ticket.status === "scheduled" || ticket.status === "in_progress") && <form onSubmit={submit} className="space-y-5"><div><p className="font-semibold">Property checks</p><p className="mt-1 text-sm text-[var(--muted-foreground)]">Confirm each service is working before leaving.</p><div className="mt-3 grid gap-3 sm:grid-cols-3"><CheckToggle label="Broadband" checked={broadband} onChange={setBroadband} /><CheckToggle label="Heating" checked={heating} onChange={setHeating} /><CheckToggle label="Hot water" checked={hotWater} onChange={setHotWater} /></div></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Repairs or maintenance required"><Textarea name="maintenanceNotes" defaultValue={ticket.maintenanceNotes} placeholder="Describe any problem, location and urgency" /></Field><Field label="Replenishable items required"><Textarea name="replenishmentNotes" defaultValue={ticket.replenishmentNotes} placeholder="List each item and quantity" /></Field></div><div className="space-y-3"><label className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3"><Checkbox checked={mail} onCheckedChange={(value) => setMail(Boolean(value))} /><span className="text-sm font-medium">Mail has arrived at the property</span></label>{mail && <Field label="Mail note"><Textarea name="mailNotes" defaultValue={ticket.mailNotes} placeholder="Who the letter is addressed to, if visible" /></Field>}</div><div className="grid gap-3 sm:grid-cols-2"><UploadButton ticket={ticket} kind="property_video" label="Property video" icon={FileVideo} upload={upload} busy={busy} accept="video/mp4,video/quicktime,video/webm" required />{mail && <UploadButton ticket={ticket} kind="mail_photo" label="Mail photo" icon={FileImage} upload={upload} busy={busy} accept="image/*,application/pdf" required />}</div><div className="rounded-xl bg-[var(--card)] p-3 text-xs leading-5 text-[var(--rc-danger-text)]">The walkthrough must show every room, bed sheets and under each bed. Issues create Stays maintenance tickets; stock requests go to Accounts; mail goes to the client.</div><Button disabled={busy || !ticket.assignedCleanerId} className="w-full bg-[#1c3934] text-white">Submit completed clean</Button></form>}
  {ticket.files.length > 0 && <div><p className="text-sm font-semibold">Evidence</p><div className="mt-2 flex flex-wrap gap-2">{ticket.files.map((file) => <a className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs font-medium" href={`/api/cleans/files/${file.id}`} target="_blank" key={file.id}>{file.fileName}</a>)}</div></div>}
  {!["scheduled","in_progress"].includes(ticket.status) && <div className="rounded-2xl border border-[var(--border)] p-4 text-sm text-[var(--muted-foreground)]"><p><strong>Maintenance:</strong> {ticket.maintenanceNotes || "No issue reported"}</p><p className="mt-2"><strong>Replenishments:</strong> {ticket.replenishmentNotes || "None requested"}</p><p className="mt-2"><strong>Mail:</strong> {ticket.mailPresent ? ticket.mailNotes || "Photo supplied" : "None"}</p></div>}
  </div></DialogContent></Dialog>;
}

function CleanReporting({ data, action, upload, busy }: ScreenProps & UploadProps) {
  const submitted = data.tickets.filter((t) => t.status === "submitted"); const closed = data.tickets.filter((t) => ["approved","unsuccessful","invoiced"].includes(t.status));
  return <Tabs defaultValue="submitted"><TabsList><TabsTrigger value="submitted">Awaiting guest outcome ({submitted.length})</TabsTrigger><TabsTrigger value="closed">Reviewed ({closed.length})</TabsTrigger></TabsList><TabsContent value="submitted" className="mt-5 space-y-4">{submitted.map((ticket) => <ReviewCleanCard ticket={ticket} action={action} upload={upload} busy={busy} key={ticket.id} />)}{!submitted.length && <EmptyState title="Nothing awaiting review" description="Submitted cleans appear here until the guest confirms the property is okay." />}</TabsContent><TabsContent value="closed" className="mt-5"><TicketList tickets={closed} cleaners={data.cleaners} action={action} upload={upload} busy={busy} /></TabsContent></Tabs>;
}

function ReviewCleanCard({ ticket, action, upload, busy }: { ticket: CleanTicket } & Pick<TicketProps,"action"|"upload"|"busy">) {
  const [notes, setNotes] = useState(""); const [complaint, setComplaint] = useState(""); const [refund, setRefund] = useState(false);
  return <article className="rounded-3xl border border-[var(--border)] bg-white p-5"><div className="flex flex-col justify-between gap-3 sm:flex-row"><div><p className="text-lg font-semibold">{ticket.propertyName}</p><p className="mt-1 text-sm text-[var(--muted-foreground)]">Cleaned by {ticket.assignedCleanerName || "unassigned"} · {formatDate(ticket.cleanDate)}</p></div><Status value={ticket.status} /></div><div className="mt-5 grid gap-3 sm:grid-cols-3"><CheckReadout label="Broadband" value={ticket.broadbandWorking} /><CheckReadout label="Heating" value={ticket.heatingWorking} /><CheckReadout label="Hot water" value={ticket.hotWaterWorking} /></div><div className="mt-5 grid gap-5 lg:grid-cols-2"><section className="rounded-2xl bg-[var(--muted)] p-4"><p className="font-semibold text-[var(--muted-foreground)]">Guest confirms property is okay</p><Textarea className="mt-3 bg-white" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Record the guest confirmation or review note" /><Button disabled={busy} onClick={() => action({ action: "approve_clean", id: ticket.id, guestConfirmationNotes: notes })} className="mt-3 w-full bg-[#315d4d] text-white"><Check /> Approve clean</Button></section><section className="rounded-2xl bg-[var(--muted)] p-4"><p className="font-semibold text-[var(--rc-danger-text)]">Guest reports a problem</p><Textarea className="mt-3 bg-white" value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder="Describe the complaint and evidence" /><label className="mt-3 flex items-center gap-2 text-sm"><Checkbox checked={refund} onCheckedChange={(value) => setRefund(Boolean(value))} /> Resulted in refund or cancellation</label><UploadButton ticket={ticket} kind="guest_evidence" label="Guest evidence" icon={FileImage} upload={upload} busy={busy} accept="image/*,application/pdf" required compact /><Button variant="destructive" disabled={busy} onClick={() => action({ action: "mark_unsuccessful", id: ticket.id, complaintNotes: complaint, refundOrCancellation: refund })} className="mt-3 w-full">Mark unsuccessful</Button></section></div></article>;
}

function CleanerPerformance({ data, action, busy }: ScreenProps) {
  return <div className="space-y-6"><div className="grid gap-4 sm:grid-cols-3"><Metric label="Required standard" value="95%" note="Minimum successful cleans" /><Metric label="Open reviews" value={String(data.reviews.filter((r) => r.status === "open").length)} note="Created automatically" alert={data.reviews.some((r) => r.status === "open")} /><Metric label="Tracked cleaners" value={String(data.cleaners.length)} note="Successful + unsuccessful cleans" /></div><div className="grid gap-4 lg:grid-cols-2">{data.cleaners.map((cleaner) => <article className="rounded-3xl border border-[var(--border)] bg-white p-5" key={cleaner.id}><div className="flex items-center justify-between"><div><p className="font-semibold">{cleaner.fullName}</p><p className="text-xs text-[var(--muted-foreground)]">{cleaner.approvedCleans} successful · {cleaner.unsuccessfulCleans} unsuccessful</p></div><span className={`text-3xl font-semibold ${cleaner.successRate !== null && cleaner.successRate < 95 ? "text-red-700" : "text-[var(--foreground)]"}`}>{cleaner.successRate === null ? "—" : `${cleaner.successRate}%`}</span></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--muted)]"><div className={`h-full ${cleaner.successRate !== null && cleaner.successRate < 95 ? "bg-red-500" : "bg-[#79a856]"}`} style={{ width: `${cleaner.successRate || 0}%` }} /></div></article>)}</div><section><h2 className="text-xl font-semibold">Management review tickets</h2><div className="mt-4 space-y-3">{data.reviews.map((review) => <div className="flex flex-col justify-between gap-3 rounded-2xl border border-[var(--border)] bg-white p-4 sm:flex-row sm:items-center" key={review.id}><div><p className="font-semibold">{review.cleanerName} · {review.successRate}%</p><p className="mt-1 text-sm text-[var(--muted-foreground)]">{review.reason}</p></div>{review.status === "open" ? <Button variant="outline" disabled={busy} onClick={() => action({ action: "close_review", id: review.id })}>Close review</Button> : <Status value="closed" />}</div>)}{!data.reviews.length && <EmptyRow text="No cleaner reviews have been triggered." />}</div></section></div>;
}

function CleanerInvoices({ data, action, busy }: ScreenProps) {
  const eligible = data.tickets.filter((t) => t.status === "approved"); const invoiced = data.tickets.filter((t) => t.status === "invoiced"); const [week, setWeek] = useState(mondayOfCurrentWeek());
  const groups = useMemo(() => { const result = new Map<string,{ cleaner: string; week: string; tickets: CleanTicket[]; total: number }>(); for (const ticket of invoiced) { const key = `${ticket.assignedCleanerId}:${ticket.invoiceWeek}`; const property = data.properties.find((p) => p.id === ticket.propertyId); const group = result.get(key) || { cleaner: ticket.assignedCleanerName || "Unassigned", week: ticket.invoiceWeek || "", tickets: [], total: 0 }; group.tickets.push(ticket); group.total += property?.cleanPricePence || 0; result.set(key, group); } return Array.from(result.values()); }, [data, invoiced]);
  return <div className="space-y-8"><section><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h2 className="text-xl font-semibold">Approved cleans ready for invoice</h2><p className="mt-1 text-sm text-[var(--muted-foreground)]">Unsuccessful cleans cannot enter the invoice journey.</p></div><Field label="Invoice week commencing"><Input type="date" value={week} onChange={(e) => setWeek(e.target.value)} /></Field></div><div className="mt-4 space-y-3">{eligible.map((ticket) => <div className="flex flex-col justify-between gap-3 rounded-2xl border border-[var(--border)] bg-white p-4 sm:flex-row sm:items-center" key={ticket.id}><div><p className="font-semibold">{ticket.assignedCleanerName} · {ticket.propertyName}</p><p className="text-xs text-[var(--muted-foreground)]">{formatDate(ticket.cleanDate)} · {money(data.properties.find((p) => p.id === ticket.propertyId)?.cleanPricePence || 0)}</p></div><Button disabled={busy || !week} onClick={() => action({ action: "add_to_invoice", id: ticket.id, invoiceWeek: week })} className="bg-[#1c3934] text-white">Add to weekly invoice</Button></div>)}{!eligible.length && <EmptyRow text="No approved cleans are waiting to be invoiced." />}</div></section><section><h2 className="text-xl font-semibold">Weekly invoices</h2><div className="mt-4 grid gap-4 lg:grid-cols-2">{groups.map((group) => <article className="rounded-3xl border border-[var(--border)] bg-white p-5" key={`${group.cleaner}-${group.week}`}><p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Week commencing {formatDate(group.week)}</p><p className="mt-2 text-xl font-semibold">{group.cleaner}</p><p className="mt-4 text-3xl font-semibold">{money(group.total)}</p><p className="mt-1 text-sm text-[var(--muted-foreground)]">{group.tickets.length} approved {group.tickets.length === 1 ? "clean" : "cleans"}</p></article>)}{!groups.length && <EmptyRow text="Weekly invoices will appear here once approved cleans are added." />}</div></section></div>;
}

function CleanOnboarding({ data, action, busy }: ScreenProps) {
  return <div className="space-y-4">{data.onboarding.map((ticket) => <OnboardingCard key={ticket.id} ticket={ticket} cleaners={data.cleaners} action={action} busy={busy} />)}{!data.onboarding.length && <EmptyState title="No clean onboarding enquiries" description="When Stays marks a property as needing a cleaner, its onboarding ticket appears here." />}</div>;
}
function OnboardingCard({ ticket, cleaners, action, busy }: { ticket: CleansData["onboarding"][number]; cleaners: Cleaner[]; action: (body: ActionBody) => Promise<boolean>; busy: boolean }) {
  const [cleanerId, setCleanerId] = useState(""); const [access, setAccess] = useState(""); const [price, setPrice] = useState(0);
  return <article className="rounded-3xl border border-[var(--border)] bg-white p-5"><div className="flex justify-between gap-3"><div><p className="text-lg font-semibold">{ticket.propertyName}</p><p className="mt-1 text-sm text-[var(--muted-foreground)]">{ticket.propertyAddress}</p></div><Status value={ticket.status} /></div>{ticket.status !== "complete" && <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1.5fr_0.7fr_auto] lg:items-end"><Field label="Assign cleaner"><Select value={cleanerId} onValueChange={setCleanerId}><SelectTrigger className="w-full"><SelectValue placeholder="Choose cleaner" /></SelectTrigger><SelectContent>{cleaners.filter((c) => c.status === "active").map((c) => <SelectItem value={c.id} key={c.id}>{c.fullName}</SelectItem>)}</SelectContent></Select></Field><Field label="Access instructions"><Input value={access} onChange={(e) => setAccess(e.target.value)} /></Field><Field label="Clean price (£)"><Input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(Number(e.target.value))} /></Field><Button disabled={busy || !cleanerId || access.length < 3} onClick={() => action({ action: "complete_onboarding", id: ticket.id, cleanerId, accessInstructions: access, cleanPricePence: Math.round(price * 100) })} className="bg-[#1c3934] text-white">Assign & close</Button></div>}</article>;
}

function ClientMailbox({ data, action, busy, client }: ScreenProps & { client: boolean }) {
  return <div><p className="mb-5 max-w-2xl text-sm leading-6 text-[var(--muted-foreground)]">Mail photographed during a property clean appears here with the property it arrived at. {client ? "Mark an item reviewed once you have seen it." : "Client delivery follows the email on the cleaning property record."}</p><div className="grid gap-4 lg:grid-cols-2">{data.mail.map((item) => <article className="rounded-3xl border border-[var(--border)] bg-white p-5" key={item.id}><div className="flex justify-between"><div className="grid size-11 place-items-center rounded-2xl bg-[var(--muted)] text-[var(--rc-danger-text)]"><Mail className="size-5" /></div><Status value={item.status} /></div><h2 className="mt-5 text-lg font-semibold">{item.propertyName}</h2><p className="mt-1 text-sm text-[var(--muted-foreground)]">{item.propertyAddress}</p><p className="mt-4 rounded-xl bg-[var(--muted)] p-3 text-sm">{item.note || "Mail photo received"}</p><div className="mt-4 flex flex-wrap gap-2">{item.photoFileId && <Button asChild variant="outline"><a href={`/api/cleans/files/${item.photoFileId}`} target="_blank"><FileImage /> View mail</a></Button>}{item.status === "new" && <Button disabled={busy} onClick={() => action({ action: "mail_status", id: item.id, status: "reviewed" })}>Mark reviewed</Button>}{item.status === "reviewed" && <Button variant="outline" disabled={busy} onClick={() => action({ action: "mail_status", id: item.id, status: "archived" })}>Archive</Button>}</div></article>)}{!data.mail.length && <EmptyState title="Mailbox is clear" description="New mail photographed during a clean will appear here." />}</div></div>;
}

function Replenishments({ data, action, busy }: ScreenProps) {
  return <div className="space-y-3">{data.replenishments.map((request) => <div className="grid gap-4 rounded-2xl border border-[var(--border)] bg-white p-5 sm:grid-cols-[1fr_auto] sm:items-center" key={request.id}><div><div className="flex items-center gap-3"><p className="font-semibold">{request.propertyName}</p><Status value={request.status} /></div><p className="mt-2 text-sm text-[var(--muted-foreground)]">{request.items}</p></div><div className="flex gap-2">{request.status === "new" && <Button disabled={busy} onClick={() => action({ action: "replenishment_status", id: request.id, status: "ordered" })}>Mark ordered</Button>}{request.status === "ordered" && <Button disabled={busy} onClick={() => action({ action: "replenishment_status", id: request.id, status: "complete" })}>Mark complete</Button>}</div></div>)}{!data.replenishments.length && <EmptyState title="No replenishment requests" description="Items noted during a clean will be passed to Accounts here." />}</div>;
}

function UploadButton({ ticket, kind, label, icon: Icon, upload, busy, accept, required, compact = false }: { ticket: CleanTicket; kind: CleanFileKind; label: string; icon: typeof FileImage; upload: UploadProps["upload"]; busy: boolean; accept: string; required?: boolean; compact?: boolean }) {
  const uploaded = ticket.files.filter((f) => f.kind === kind);
  return <label className={`block cursor-pointer rounded-xl border border-dashed border-[var(--border)] bg-[var(--card)] ${compact ? "mt-3 p-3" : "p-4"}`}><span className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-sm font-semibold"><Icon className="size-4" /> {label}{required && <span className="text-red-600">*</span>}</span>{uploaded.length > 0 && <Badge className="border-0 bg-[var(--muted)] text-[var(--muted-foreground)]">{uploaded.length} uploaded</Badge>}</span><input className="sr-only" type="file" accept={accept} disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(ticket.id, kind, file); }} /></label>;
}

type ScreenProps = { data: CleansData; action: (body: ActionBody) => Promise<boolean>; busy: boolean };
type UploadProps = { upload: (ticketId: string, kind: CleanFileKind, file: File) => Promise<boolean> };
function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) { return <div className="relative w-full max-w-xl"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" /><Input className="h-11 bg-white pl-10" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} /></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  return <FieldIdContext.Provider value={id}><div className="space-y-2"><Label id={`${id}-label`} htmlFor={id}>{label}</Label>{isValidElement<{id?: string; "aria-labelledby"?: string}>(children) ? cloneElement(children, {id, "aria-labelledby": `${id}-label`}) : children}</div></FieldIdContext.Provider>;
}
function CheckToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <button type="button" onClick={() => onChange(!checked)} className={`flex items-center justify-between rounded-xl border p-3 text-sm font-semibold ${checked ? "border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]" : "border-red-200 bg-red-50 text-red-800"}`}><span>{label}</span>{checked ? <Check className="size-4" /> : <CircleAlert className="size-4" />}</button>; }
function CheckReadout({ label, value }: { label: string; value: boolean | null }) { return <div className={`rounded-xl p-3 text-sm font-semibold ${value === false ? "bg-red-50 text-red-800" : "bg-[var(--muted)] text-[var(--muted-foreground)]"}`}>{label}: {value === false ? "Issue" : value === true ? "Working" : "Not checked"}</div>; }
function Legend({ swatch, label }: { swatch: string; label: string }) { return <span className="flex items-center gap-1.5"><span className={`size-3 rounded-sm border ${swatch}`} />{label}</span>; }
function Metric({ label, value, note, alert }: { label: string; value: string; note: string; alert?: boolean }) { return <article className={`rounded-3xl border bg-white p-5 ${alert ? "border-red-200" : "border-[var(--border)]"}`}><p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{label}</p><p className={`mt-5 text-4xl font-semibold ${alert ? "text-red-700" : ""}`}>{value}</p><p className="mt-1 text-xs text-[var(--muted-foreground)]">{note}</p></article>; }
function MiniStat({ label, value, alert }: { label: string; value: string; alert?: boolean }) { return <div className={`rounded-xl p-3 ${alert ? "bg-red-50 text-red-800" : "bg-[var(--muted)]"}`}><p className="text-[0.62rem] uppercase tracking-wide opacity-70">{label}</p><p className="mt-1 font-semibold">{value}</p></div>; }
function Status({ value }: { value: string }) { return <Badge className={`w-fit border-0 capitalize ${statusTone(value)}`}>{value.replaceAll("_", " ")}</Badge>; }
function statusTone(status: string) { if (["approved","invoiced","complete","reviewed"].includes(status)) return "bg-[var(--muted)] text-[var(--muted-foreground)]"; if (["unsuccessful","open"].includes(status)) return "bg-red-100 text-red-800"; if (["submitted","ordered","in_progress"].includes(status)) return "bg-amber-100 text-amber-900"; return "bg-[var(--muted)] text-[var(--muted-foreground)]"; }
function EmptyRow({ text }: { text: string }) { return <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white p-8 text-center text-sm text-[var(--muted-foreground)]">{text}</div>; }
function EmptyState({ title, description }: { title: string; description: string }) { return <section className="rounded-3xl border border-dashed border-[var(--border)] bg-white p-10 text-center"><div className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--muted)]"><SprayCan className="size-5" /></div><h2 className="mt-4 text-xl font-semibold">{title}</h2><p className="mx-auto mt-2 max-w-lg text-sm text-[var(--muted-foreground)]">{description}</p></section>; }
function formatDate(value: string) { if (!value) return "Date pending"; return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)); }
function money(pence: number) { return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100); }
function mondayOfCurrentWeek() { const date = new Date(); const day = date.getUTCDay(); date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1)); return date.toISOString().slice(0,10); }
function dateOffsetFromToday(days: number) { const date = new Date(); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0,10); }
function daysBetween(start: string, end: string) { const startTime = new Date(`${start}T12:00:00Z`).getTime(); const endTime = new Date(`${end}T12:00:00Z`).getTime(); return Math.round((endTime - startTime) / 86_400_000); }
function calendarBookings(tickets: CleanTicket[], monthStart: string, days: number) {
  const laneEnds: number[] = [];
  return [...tickets]
    .sort((a, b) => `${a.arrivalDate || a.cleanDate}-${a.cleanDate}`.localeCompare(`${b.arrivalDate || b.cleanDate}-${b.cleanDate}`))
    .map((ticket) => {
      const arrival = ticket.arrivalDate || ticket.cleanDate;
      const start = Math.max(0, daysBetween(monthStart, arrival));
      const end = Math.min(days, Math.max(start + 1, daysBetween(monthStart, ticket.cleanDate)));
      let lane = laneEnds.findIndex((laneEnd) => start >= laneEnd);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = end;
      return { ticket, start, end, lane, nights: Math.max(1, daysBetween(arrival, ticket.cleanDate)) };
    });
}
function guestCountLabel(ticket: CleanTicket) { return ticket.guestCount > 0 ? `${ticket.guestCount} ${ticket.guestCount === 1 ? "guest" : "guests"}` : "Guest count unavailable"; }
function calendarTone(ticket: CleanTicket, today: string) { if (ticket.status === "unsuccessful") return "border-red-300 bg-red-100 text-red-900"; if (["submitted", "approved", "invoiced"].includes(ticket.status)) return "border-emerald-300 bg-emerald-100 text-emerald-900"; if (ticket.cleanDate === today) return "border-amber-200 bg-amber-100 text-amber-900"; return "border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]"; }
