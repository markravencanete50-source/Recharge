"use client";


import { FormEvent, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, ClipboardList, Clock3, MapPin, Search, Wrench, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { OperationsData, RoutineInspectionSubmission, RoutineMaintenanceBooking } from "@/lib/operations";

type Action = (payload: Record<string, unknown>) => Promise<boolean>;

export function RoutineMaintenanceCentre({ data, busy, action }: { data: OperationsData; busy: boolean; action: Action }) {
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("all");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [bookingPropertyId, setBookingPropertyId] = useState<string | null>(null);
  const [inspectionBookingId, setInspectionBookingId] = useState<string | null>(null);
  const regions = useMemo(() => Array.from(new Set(data.properties.map((property) => property.region.trim() || "Region Not Set"))).sort(), [data.properties]);
  const properties = data.properties.filter((property) => {
    const propertyRegion = property.region.trim() || "Region Not Set";
    return (region === "all" || propertyRegion === region) && `${property.name} ${property.address} ${propertyRegion}`.toLowerCase().includes(query.toLowerCase());
  });
  const grouped = regions.map((name) => ({ name, properties: properties.filter((property) => (property.region.trim() || "Region Not Set") === name) })).filter((group) => group.properties.length);
  const selectedProperty = data.properties.find((property) => property.id === bookingPropertyId) || null;
  const selectedInspection = data.routineMaintenanceBookings.find((booking) => booking.id === inspectionBookingId) || null;
  const selectedSubmission = data.routineInspectionSubmissions.find((submission) => submission.bookingId === inspectionBookingId) || null;

  return <>
    <section className="mb-6 rounded-3xl bg-[#1c3934] p-5 text-white sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">Ready property care</p>
      <div className="mt-2 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h2 className="text-2xl font-semibold">Plan every routine visit in one place</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-white/65">All active properties are grouped by region. Book work against a property and it appears instantly in the maintenance calendar.</p></div><Badge className="w-fit bg-white/10 px-4 py-2 text-white">{data.properties.length} properties ready</Badge></div>
    </section>
    <Tabs defaultValue="properties">
      <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto bg-[var(--muted)] sm:w-fit"><TabsTrigger value="properties">Properties by region</TabsTrigger><TabsTrigger value="calendar">Maintenance calendar</TabsTrigger><TabsTrigger value="forms">Inspection forms</TabsTrigger></TabsList>
      <TabsContent value="properties" className="mt-5 space-y-5">
        <div className="grid gap-3 rounded-3xl border border-[var(--border)] bg-white p-4 md:grid-cols-[1fr_15rem]">
          <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search property, address or region" /></div>
          <Select value={region} onValueChange={setRegion}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All regions</SelectItem>{regions.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
        </div>
        {grouped.map((group) => <section key={group.name} className="rounded-3xl border border-[var(--border)] bg-white p-5 sm:p-6"><div className="flex items-center justify-between gap-3"><div><p className="eyebrow">Region</p><h2 className="mt-1 text-2xl font-semibold">{group.name}</h2></div><Badge variant="outline">{group.properties.length} properties</Badge></div><div className="mt-5 grid gap-3 lg:grid-cols-2">{group.properties.map((property) => {
          const next = data.routineMaintenanceBookings.filter((item) => item.propertyId === property.id && item.status === "booked" && item.scheduledDate >= today()).sort((a, b) => `${a.scheduledDate}${a.startTime}`.localeCompare(`${b.scheduledDate}${b.startTime}`))[0];
          return <article key={property.id} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4"><div className="flex items-start justify-between gap-4"><div><h3 className="font-semibold">{property.name}</h3>{property.address && <p className="mt-1 flex items-start gap-1.5 text-sm text-[var(--muted-foreground)]"><MapPin className="mt-0.5 size-3.5 shrink-0" />{property.address}</p>}</div><Badge className="bg-[var(--muted)] text-[var(--muted-foreground)] capitalize">{property.status.replaceAll("_", " ")}</Badge></div>{next ? <div className="mt-4 rounded-xl bg-white p-3 text-sm"><p className="font-semibold text-[var(--muted-foreground)]">Next: {prettyDate(next.scheduledDate)}{next.startTime ? ` at ${next.startTime}` : ""}</p><p className="mt-1 text-[var(--muted-foreground)]">{categoryLabel(next.category)}{next.assignedTo ? ` · ${next.assignedTo}` : ""}</p></div> : <p className="mt-4 text-sm text-[var(--muted-foreground)]">No future maintenance booked.</p>}<Button onClick={() => setBookingPropertyId(property.id)} className="mt-4 w-full bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)]"><CalendarDays className="size-4" />Book maintenance</Button></article>;
        })}</div></section>)}
        {!grouped.length && <EmptyState />}
      </TabsContent>
      <TabsContent value="calendar" className="mt-5"><MaintenanceCalendar data={data} month={month} setMonth={setMonth} busy={busy} action={action} onOpenForm={setInspectionBookingId} /></TabsContent>
      <TabsContent value="forms" className="mt-5"><InspectionForms data={data} onOpenForm={setInspectionBookingId} /></TabsContent>
    </Tabs>
    <BookingDialog property={selectedProperty} open={Boolean(selectedProperty)} onOpenChange={(open) => { if (!open) setBookingPropertyId(null); }} busy={busy} action={action} onSaved={() => setBookingPropertyId(null)} />
    <InspectionFormDialog key={selectedInspection?.id || "none"} booking={selectedInspection} submission={selectedSubmission} open={Boolean(selectedInspection)} onOpenChange={(open) => { if (!open) setInspectionBookingId(null); }} busy={busy} action={action} onSaved={() => setInspectionBookingId(null)} />
  </>;
}

function BookingDialog({ property, open, onOpenChange, busy, action, onSaved }: { property: OperationsData["properties"][number] | null; open: boolean; onOpenChange: (open: boolean) => void; busy: boolean; action: Action; onSaved: () => void }) {
  const [category, setCategory] = useState<RoutineMaintenanceBooking["category"]>("general_check");
  if (!property) return null;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await action({ action: "create_routine_maintenance", propertyId: property!.id, category, scheduledDate: form.get("scheduledDate"), startTime: form.get("startTime"), endTime: form.get("endTime"), assignedTo: form.get("assignedTo"), notes: form.get("notes") });
    if (ok) onSaved();
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>Book routine maintenance</DialogTitle><DialogDescription>{property.name} · {property.region || "Region Not Set"}</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-4"><Field label="Maintenance type"><Select value={category} onValueChange={(value) => setCategory(value as typeof category)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="safety_inspection">Safety inspection</SelectItem><SelectItem value="garden">Garden maintenance</SelectItem><SelectItem value="bins">Bin collection</SelectItem><SelectItem value="general_check">General property check</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></Field><div className="grid gap-4 sm:grid-cols-3"><Field label="Date"><Input required name="scheduledDate" type="date" min={today()} /></Field><Field label="Start time"><Input name="startTime" type="time" /></Field><Field label="End time"><Input name="endTime" type="time" /></Field></div><Field label="Assigned to"><Input name="assignedTo" placeholder="Team member or contractor" /></Field><Field label="Notes"><Textarea name="notes" rows={4} placeholder="Work required, access instructions or materials needed" /></Field><Button disabled={busy} className="w-full bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)]">{busy ? "Saving…" : "Book maintenance"}</Button></form></DialogContent></Dialog>;
}

function InspectionForms({ data, onOpenForm }: { data: OperationsData; onOpenForm: (bookingId: string) => void }) {
  const [filter, setFilter] = useState<"all" | "outstanding" | "submitted">("all");
  const bookings = data.routineMaintenanceBookings
    .filter((booking) => booking.status !== "cancelled")
    .filter((booking) => {
      const submitted = data.routineInspectionSubmissions.some((item) => item.bookingId === booking.id);
      return filter === "all" || (filter === "submitted" ? submitted : !submitted);
    })
    .sort((a, b) => {
      const aSubmitted = data.routineInspectionSubmissions.some((item) => item.bookingId === a.id);
      const bSubmitted = data.routineInspectionSubmissions.some((item) => item.bookingId === b.id);
      return Number(aSubmitted) - Number(bSubmitted) || `${a.scheduledDate}${a.startTime}`.localeCompare(`${b.scheduledDate}${b.startTime}`);
    });
  const outstanding = data.routineMaintenanceBookings.filter((booking) => booking.status !== "cancelled" && !data.routineInspectionSubmissions.some((item) => item.bookingId === booking.id)).length;
  return <div className="space-y-5"><section className="flex flex-col justify-between gap-4 rounded-3xl border border-[var(--border)] bg-white p-5 sm:flex-row sm:items-center"><div><p className="eyebrow">Scheduled inspection records</p><h2 className="mt-2 text-2xl font-semibold">{outstanding} forms outstanding</h2><p className="mt-1 text-sm text-[var(--muted-foreground)]">Submit the visit checklist to complete its scheduled booking.</p></div><Select value={filter} onValueChange={(value) => setFilter(value as typeof filter)}><SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All forms</SelectItem><SelectItem value="outstanding">Outstanding</SelectItem><SelectItem value="submitted">Submitted</SelectItem></SelectContent></Select></section><div className="grid gap-4 xl:grid-cols-2">{bookings.map((booking) => {
    const submission = data.routineInspectionSubmissions.find((item) => item.bookingId === booking.id);
    return <article key={booking.id} className="rounded-3xl border border-[var(--border)] bg-white p-5"><div className="flex items-start justify-between gap-4"><div><h3 className="text-lg font-semibold">{booking.propertyName}</h3><p className="mt-1 text-sm text-[var(--muted-foreground)]">{booking.region || "Region Not Set"} · {prettyDate(booking.scheduledDate)}{booking.startTime ? ` at ${booking.startTime}` : ""}</p></div><Badge className={submission ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>{submission ? "Submitted" : "Outstanding"}</Badge></div><div className="mt-4 rounded-2xl bg-[var(--muted)] p-4 text-sm"><p className="font-semibold">{categoryLabel(booking.category)}</p><p className="mt-1 text-[var(--muted-foreground)]">{booking.assignedTo || "Not yet assigned"}</p>{submission && <p className="mt-2 text-[var(--muted-foreground)]">Overall condition: <strong className="capitalize">{submission.overallCondition}</strong>{submission.followUpRequired ? " · Follow-up required" : ""}</p>}</div><Button onClick={() => onOpenForm(booking.id)} className="mt-4 w-full bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)]"><ClipboardList className="size-4" />{submission ? "View or update form" : "Fill out inspection form"}</Button></article>;
  })}{bookings.length === 0 && <EmptyForms />}</div></div>;
}

function InspectionFormDialog({ booking, submission, open, onOpenChange, busy, action, onSaved }: { booking: RoutineMaintenanceBooking | null; submission: RoutineInspectionSubmission | null; open: boolean; onOpenChange: (open: boolean) => void; busy: boolean; action: Action; onSaved: () => void }) {
  const checklistItems = [
    ["access", "Access, keys and entry"], ["alarms", "Smoke and carbon monoxide alarms"], ["heating", "Heating and hot water"], ["electrics", "Lights, sockets and electrics"], ["plumbing", "Plumbing, taps and drainage"], ["appliances", "Appliances and equipment"], ["cleanliness", "Cleanliness and property condition"], ["garden", "Garden and external areas"], ["bins", "Bins and waste arrangements"],
  ] as const;
  const initialChecklist = Object.fromEntries(checklistItems.map(([key]) => [key, submission?.checklist[key] || "pass"])) as Record<(typeof checklistItems)[number][0], "pass" | "attention" | "na">;
  const [checklist, setChecklist] = useState(initialChecklist);
  const [overallCondition, setOverallCondition] = useState<RoutineInspectionSubmission["overallCondition"]>(submission?.overallCondition || "good");
  const [followUpRequired, setFollowUpRequired] = useState(submission?.followUpRequired || false);
  if (!booking) return null;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await action({ action: "submit_routine_inspection", bookingId: booking!.id, checklist, overallCondition, workCompleted: form.get("workCompleted"), issuesFound: form.get("issuesFound"), followUpRequired, followUpDetails: form.get("followUpDetails") });
    if (ok) onSaved();
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Routine inspection form</DialogTitle><DialogDescription>{booking.propertyName} · {booking.region || "Region Not Set"} · {prettyDate(booking.scheduledDate)}</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-5"><div className="rounded-2xl bg-[var(--muted)] p-4"><p className="font-semibold">{categoryLabel(booking.category)}</p><p className="mt-1 text-sm text-[var(--muted-foreground)]">{booking.assignedTo || "Not assigned"}{booking.startTime ? ` · ${booking.startTime}${booking.endTime ? `–${booking.endTime}` : ""}` : ""}</p>{booking.notes && <p className="mt-2 text-sm text-[var(--muted-foreground)]">{booking.notes}</p>}</div><section><h3 className="font-semibold">Property checklist</h3><div className="mt-3 grid gap-3 sm:grid-cols-2">{checklistItems.map(([key, label]) => <div key={key} className="rounded-xl border border-[var(--border)] p-3"><Label className="mb-2 block leading-5">{label}</Label><Select value={checklist[key]} onValueChange={(value) => setChecklist((current) => ({ ...current, [key]: value as "pass" | "attention" | "na" }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pass">Pass</SelectItem><SelectItem value="attention">Needs attention</SelectItem><SelectItem value="na">Not applicable</SelectItem></SelectContent></Select></div>)}</div></section><Field label="Overall condition"><Select value={overallCondition} onValueChange={(value) => setOverallCondition(value as typeof overallCondition)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="good">Good</SelectItem><SelectItem value="attention">Needs attention</SelectItem><SelectItem value="urgent">Urgent issue</SelectItem></SelectContent></Select></Field><Field label="Work completed during visit"><Textarea name="workCompleted" defaultValue={submission?.workCompleted || ""} rows={3} placeholder="List any checks, repairs or routine work completed" /></Field><Field label="Issues found"><Textarea name="issuesFound" defaultValue={submission?.issuesFound || ""} rows={3} placeholder="Record any faults, damage or concerns" /></Field><label className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-4 text-sm font-medium"><Checkbox checked={followUpRequired} onCheckedChange={(value) => setFollowUpRequired(Boolean(value))} />Follow-up work is required</label>{followUpRequired && <Field label="Follow-up details"><Textarea required name="followUpDetails" defaultValue={submission?.followUpDetails || ""} rows={3} placeholder="What needs done, by whom and how urgently?" /></Field>}<Button disabled={busy} className="w-full bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)]">{busy ? "Submitting…" : submission ? "Update submitted form" : "Submit inspection form"}</Button></form></DialogContent></Dialog>;
}

function MaintenanceCalendar({ data, month, setMonth, busy, action, onOpenForm }: { data: OperationsData; month: string; setMonth: (month: string) => void; busy: boolean; action: Action; onOpenForm: (bookingId: string) => void }) {
  const events = data.routineMaintenanceBookings.filter((event) => event.status !== "cancelled" && event.scheduledDate.startsWith(month));
  const days = monthDays(month);
  return <div className="space-y-5"><div className="flex flex-col justify-between gap-3 rounded-3xl border border-[var(--border)] bg-white p-4 sm:flex-row sm:items-center"><Input className="sm:w-56" type="month" value={month} onChange={(event) => setMonth(event.target.value)} /><Badge variant="outline" className="h-10 w-fit px-4">{events.length} booked</Badge></div><section className="overflow-x-auto rounded-3xl border border-[var(--border)] bg-white"><div className="grid min-w-[900px] grid-cols-7 border-b border-[var(--border)] bg-[var(--card)] text-center text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">{["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((day) => <div className="p-3" key={day}>{day}</div>)}</div><div className="grid min-w-[900px] grid-cols-7">{days.map((day, index) => <div key={`${day.date}-${index}`} className={`min-h-40 border-b border-r border-[var(--border)] p-2 ${day.inside ? "bg-white" : "bg-[var(--card)] text-[var(--muted-foreground)]"}`}><div className="text-sm font-semibold">{day.number}</div><div className="mt-2 space-y-2">{events.filter((event) => event.scheduledDate === day.date).map((event) => <CalendarEvent key={event.id} event={event} busy={busy} action={action} onOpenForm={onOpenForm} hasSubmission={data.routineInspectionSubmissions.some((item) => item.bookingId === event.id)} />)}</div></div>)}</div></section></div>;
}

function CalendarEvent({ event, busy, action, onOpenForm, hasSubmission }: { event: RoutineMaintenanceBooking; busy: boolean; action: Action; onOpenForm: (bookingId: string) => void; hasSubmission: boolean }) {
  return <div className={`rounded-xl border p-2 text-xs ${hasSubmission ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-orange-200 bg-orange-50 text-orange-900"}`}><p className="truncate font-semibold">{event.propertyName}</p><p className="mt-1 truncate">{categoryLabel(event.category)}</p>{event.startTime && <p className="mt-1 flex items-center gap-1 opacity-75"><Clock3 className="size-3" />{event.startTime}{event.endTime ? `–${event.endTime}` : ""}</p>}{event.assignedTo && <p className="mt-1 truncate opacity-75">{event.assignedTo}</p>}<div className="mt-2 flex gap-1"><button onClick={() => onOpenForm(event.id)} className="rounded-md bg-white/80 p-1.5" title={hasSubmission ? "View inspection form" : "Fill inspection form"}>{hasSubmission ? <CheckCircle2 className="size-3.5" /> : <ClipboardList className="size-3.5" />}</button>{!hasSubmission && <button disabled={busy} onClick={() => action({ action: "update_routine_maintenance_status", id: event.id, status: "cancelled" })} className="rounded-md bg-white/80 p-1.5" title="Cancel booking"><XCircle className="size-3.5" /></button>}</div></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div><Label className="mb-2 block">{label}</Label>{children}</div>; }
function EmptyState() { return <div className="rounded-3xl border border-dashed border-[var(--border)] bg-white p-10 text-center"><Wrench className="mx-auto size-6 text-[var(--muted-foreground)]" /><h3 className="mt-3 font-semibold">No properties found</h3><p className="mt-1 text-sm text-[var(--muted-foreground)]">Try another search or region.</p></div>; }
function EmptyForms() { return <div className="rounded-3xl border border-dashed border-[var(--border)] bg-white p-10 text-center xl:col-span-2"><ClipboardList className="mx-auto size-6 text-[var(--muted-foreground)]" /><h3 className="mt-3 font-semibold">No forms in this view</h3><p className="mt-1 text-sm text-[var(--muted-foreground)]">Scheduled maintenance visits will appear here.</p></div>; }
function categoryLabel(category: RoutineMaintenanceBooking["category"]) { return category === "safety_inspection" ? "Safety inspection" : category === "garden" ? "Garden maintenance" : category === "bins" ? "Bin collection" : category === "general_check" ? "General property check" : "Other maintenance"; }
function prettyDate(value: string) { return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00Z`)); }
function today() { return new Date().toISOString().slice(0, 10); }
function monthDays(month: string) { const [year, monthNumber] = month.split("-").map(Number); const first = new Date(Date.UTC(year, monthNumber - 1, 1)); const gridStart = new Date(first); const day = first.getUTCDay(); gridStart.setUTCDate(first.getUTCDate() - (day === 0 ? 6 : day - 1)); return Array.from({ length: 42 }, (_, index) => { const date = new Date(gridStart); date.setUTCDate(gridStart.getUTCDate() + index); return { date: date.toISOString().slice(0, 10), number: date.getUTCDate(), inside: date.getUTCMonth() === monthNumber - 1 }; }); }
