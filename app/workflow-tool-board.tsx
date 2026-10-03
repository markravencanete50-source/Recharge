"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, CheckCircle2, Clock3, ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { WorkflowData, WorkflowTicket, WorkflowStatus } from "@/lib/workflows";

export type WorkflowToolMode = "onboarding-invoices" | "new-property-inspections" | "property-furnishing" | "routine-bin-garden" | "aircover-reporting";
const boardForMode = {
  "onboarding-invoices": "onboarding_invoices", "new-property-inspections": "new_property_inspection",
  "property-furnishing": "property_furnishing", "routine-bin-garden": "routine_bin_garden", "aircover-reporting": "aircover_reporting",
} as const;
const names = { "onboarding-invoices": "Property Onboarding Invoices", "new-property-inspections": "New Property Inspections", "property-furnishing": "Property Furnishing", "routine-bin-garden": "Routine Bin and Garden", "aircover-reporting": "AirCover Reports" };

export function WorkflowToolBoard({ mode, initialData, onBack }: { mode: WorkflowToolMode; initialData?: WorkflowData; onBack: () => void }) {
  const [data, setData] = useState(initialData);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const response = await fetch("/api/workflows/tickets", { cache: "no-store" }).catch(() => null);
      const result = response?.ok ? await response.json().catch(() => null) as { data?: WorkflowData } | null : null;
      if (active && result?.data) setData(result.data);
    };
    const timer = window.setInterval(refresh, 4_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const board = boardForMode[mode];
  const tickets = useMemo(() => (data?.tickets || []).filter((ticket) => ticket.board === board), [board, data]);
  const columns = mode === "onboarding-invoices"
    ? [{ status: "new" as const, title: "New invoice" }, { status: "in_progress" as const, title: "Invoice sent" }, { status: "complete" as const, title: "Invoice settled" }]
    : mode === "new-property-inspections" ? [{ status: "new" as const, title: "New enquiry" }, { status: "in_progress" as const, title: "Inspection booked" }, { status: "complete" as const, title: "Complete" }]
    : [{ status: "new" as const, title: "New" }, { status: "in_progress" as const, title: "In progress" }, { status: "complete" as const, title: "Complete" }];
  async function move(ticket: WorkflowTicket, status: WorkflowStatus) {
    setSaving(ticket.id);
    setError("");
    try {
    const response = await fetch("/api/workflows/tickets", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: ticket.id, status }) });
    if (!response.ok) { const result = await response.json().catch(() => null) as {error?: string} | null; throw new Error(result?.error || "The ticket could not be updated. Please try again."); }
    setData((current) => current ? ({ ...current, tickets: current.tickets.map((item) => item.id === ticket.id ? { ...item, status, lane: status === "new" ? (mode === "onboarding-invoices" ? "new_invoice" : mode === "new-property-inspections" ? "new_enquiry" : "new") : status === "in_progress" ? (mode === "onboarding-invoices" ? "invoice_sent" : mode === "new-property-inspections" ? "inspection_booked" : "in_progress") : (mode === "onboarding-invoices" ? "invoice_settled" : "complete") } : item) }) : current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The ticket could not be updated. Please try again."); }
    finally { setSaving(""); }
  }
  return <div className="space-y-7">
    <Button variant="outline" onClick={onBack}><ArrowLeft /> Back</Button>
    <div><p className="eyebrow">{mode === "onboarding-invoices" ? "Accounts" : mode === "aircover-reporting" ? "Recharge Stays" : "Recharge Ready"}</p><h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em]">{names[mode]}</h1><p className="mt-3 text-[#647577]">{mode === "onboarding-invoices" ? "A dedicated board for issuing, tracking and settling each £475 VAT-inclusive onboarding invoice." : mode === "new-property-inspections" ? "A dedicated ticket board for booking and completing guest-readiness inspections. The Ready calendar remains a separate tool." : "Review incoming work, follow progress and track completed tickets in one place."}</p></div>
    {error && <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    <div className="grid gap-5 xl:grid-cols-3">{columns.map((column) => <section key={column.status} className="rounded-[1.5rem] border border-[#d9e2df] bg-[#f7f9f8] p-4"><div className="flex items-center justify-between"><h2 className="font-semibold">{column.title}</h2><Badge variant="outline">{tickets.filter((ticket) => ticket.status === column.status).length}</Badge></div><div className="mt-4 space-y-3">{tickets.filter((ticket) => ticket.status === column.status).map((ticket) => <article key={ticket.id} className="rounded-2xl bg-white p-5 shadow-sm"><div className="flex items-start gap-3">{mode === "onboarding-invoices" ? <ReceiptText className="mt-0.5 size-5" /> : <CalendarDays className="mt-0.5 size-5" />}<div className="min-w-0"><h3 className="font-semibold">{ticket.propertyName || ticket.propertyAddress}</h3><p className="mt-1 text-sm text-[#647577]">{ticket.propertyAddress}</p></div></div><p className="mt-4 text-sm font-semibold">{ticket.title}</p><p className="mt-2 text-sm leading-6 text-[#647577]">{ticket.details}</p>{ticket.dueDate && <p className="mt-3 flex items-center gap-2 text-xs text-[#647577]"><Clock3 className="size-3.5" /> {ticket.dueDate}</p>}<div className="mt-4 flex flex-wrap gap-2">{column.status === "new" && <Button size="sm" disabled={saving === ticket.id} onClick={() => move(ticket, "in_progress")}>{mode === "onboarding-invoices" ? "Mark invoice sent" : "Mark inspection booked"}</Button>}{column.status === "in_progress" && <Button size="sm" disabled={saving === ticket.id} onClick={() => move(ticket, "complete")}><CheckCircle2 /> {mode === "onboarding-invoices" ? "Mark settled" : "Mark complete"}</Button>}</div></article>)}{!tickets.some((ticket) => ticket.status === column.status) && <p className="rounded-xl border border-dashed border-[#ccd9d5] px-4 py-8 text-center text-sm text-[#718184]">No tickets</p>}</div></section>)}</div>
  </div>;
}
