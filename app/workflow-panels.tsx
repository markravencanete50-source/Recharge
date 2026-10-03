"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Leaf,
  Plus,
  Send,
  ShieldCheck,
  Sofa,
  SprayCan,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  ReferralType,
  WorkflowBoard,
  WorkflowData,
  WorkflowStatus,
  WorkflowTicket,
} from "@/lib/workflows";

type Department =
  | "cleans"
  | "ready"
  | "stays"
  | "clients"
  | "accounts"
  | "marketing";

const READY_BOARDS: Array<{
  board: WorkflowBoard;
  title: string;
  description: string;
  icon: typeof Wrench;
}> = [
  {
    board: "spot_maintenance",
    title: "Spot Maintenance",
    description: "Repair and maintenance tasks referred by Stays.",
    icon: Wrench,
  },
  {
    board: "property_furnishing",
    title: "Property Furnishing",
    description: "Furnishing tasks ready for the Ready team.",
    icon: Sofa,
  },
  {
    board: "new_property_inspection",
    title: "New Property Inspection",
    description: "New-property inspections referred by Stays.",
    icon: ClipboardCheck,
  },
  {
    board: "routine_bin_garden",
    title: "Routine Bin & Garden",
    description: "Completed onboardings waiting to join a recurring cycle.",
    icon: Leaf,
  },
];

const STAYS_REPORT_BOARDS: Array<{
  board: WorkflowBoard;
  title: string;
  description: string;
  icon: typeof Wrench;
}> = [
  {
    board: "aircover_reporting",
    title: "AirCover reports",
    description: "Guest damage and claim enquiries raised from the Communication Centre.",
    icon: ShieldCheck,
  },
];

export function WorkflowPanels({
  section,
  data,
}: {
  section: Department;
  data?: WorkflowData;
}) {
  if (!data || section === "clients" || section === "marketing")
    return null;
  if (!data.available) {
    return (
      <div className="mt-8 rounded-2xl border border-[#d9e2df] bg-white p-5 text-sm text-[#647577]">
        Department workflows are temporarily unavailable. Please try again shortly.
      </div>
    );
  }

  if (section === "stays") return null;
  if (section === "ready") return null;
  if (section === "accounts") return <AccountsWorkflow data={data} />;
  return <CleansWorkflow data={data} />;
}

function StaysWorkflow({ data }: { data: WorkflowData }) {
  const recentReferrals = data.tickets
    .filter((ticket) => ticket.triggerType === "manual_referral")
    .slice(0, 6);

  return (
    <section className="mt-8 space-y-4">
      <div className="grid gap-4">
        <article className="rounded-[1.5rem] bg-[#1c3934] p-6 text-white sm:p-7">
        <div className="flex items-start justify-between gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8fb3a2]">
              Stays → Ready
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.035em]">
              Refer work to Ready
            </h2>
            <p className="mt-2 max-w-lg text-sm leading-6 text-white/60">
              Send maintenance, furnishing or inspection work directly to the
              correct Ready board.
            </p>
          </div>
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/10 text-[#8fb3a2]">
            <Send className="size-5" />
          </div>
        </div>
        <ReferralDialog />
        <CompactTicketList tickets={recentReferrals} empty="No referrals sent yet." />
        </article>

      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {STAYS_REPORT_BOARDS.map((board) => (
          <TicketBoard
            key={board.board}
            {...board}
            tickets={data.tickets.filter((ticket) => ticket.board === board.board)}
          />
        ))}
      </div>
    </section>
  );
}

function ReferralDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ReferralType>("maintenance");
  const [priority, setPriority] = useState<"normal" | "urgent">("normal");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const dueDate = String(form.get("dueDate") || "");
    const response = await fetch("/api/workflows/referrals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type,
        priority,
        propertyName: form.get("propertyName"),
        propertyAddress: form.get("propertyAddress"),
        title: form.get("title"),
        details: form.get("details"),
        dueDate: dueDate || null,
      }),
    });
    const result = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    if (!response.ok) {
      setError(result?.error || "The referral could not be sent.");
      setSaving(false);
      return;
    }
    setOpen(false);
    setSaving(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="mt-6 h-11 rounded-xl bg-[#315f50] px-5 font-semibold text-[#1c3934] hover:bg-[#c8fa7c]">
          <Plus /> New Ready referral
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl border-[#d9e2df] p-0 sm:max-w-2xl">
        <form onSubmit={submit}>
          <DialogHeader className="border-b border-[#e2e9e7] px-6 py-6 text-left">
            <DialogTitle className="text-2xl tracking-[-0.035em]">
              Refer work to Recharge Ready
            </DialogTitle>
            <DialogDescription>
              The referral will appear on the matching Ready board immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 px-6 py-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Referral type">
                <Select value={type} onValueChange={(value) => setType(value as ReferralType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="maintenance">Maintenance</SelectItem>
                    <SelectItem value="furnishing">Property furnishing</SelectItem>
                    <SelectItem value="inspection">Property inspection</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Priority">
                <Select value={priority} onValueChange={(value) => setPriority(value as "normal" | "urgent")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Property"><Input name="propertyName" required placeholder="Property name" /></Field>
              <Field label="Address"><Input name="propertyAddress" placeholder="Property address" /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
              <Field label="Task"><Input name="title" required placeholder="What does Ready need to do?" /></Field>
              <Field label="Due date"><Input name="dueDate" type="date" /></Field>
            </div>
            <Field label="Details">
              <Textarea name="details" required rows={5} placeholder="Add the context, access details and expected outcome." />
            </Field>
            {error && <p className="text-sm font-medium text-red-700">{error}</p>}
          </div>
          <DialogFooter className="border-t border-[#e2e9e7] px-6 py-5">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={saving} className="bg-[#1c3934] text-white hover:bg-[#10271f]">
              {saving ? "Sending…" : "Send to Ready"} <ArrowRight />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReadyWorkflow({ data }: { data: WorkflowData }) {
  return (
    <section className="mt-8">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="eyebrow">Live referrals</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">Ready work boards</h2>
        </div>
        <Badge variant="outline" className="border-[#cddbd6] bg-white text-[#40585b]">
          {data.tickets.filter((ticket) => ticket.targetBusiness === "Ready" && ticket.status !== "complete").length} open
        </Badge>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {READY_BOARDS.map((board) => (
          <TicketBoard
            key={board.board}
            {...board}
            tickets={data.tickets.filter((ticket) => ticket.board === board.board)}
          />
        ))}
      </div>
    </section>
  );
}

function CleansWorkflow({ data }: { data: WorkflowData }) {
  const onboardingTickets = data.tickets.filter(
    (ticket) => ticket.board === "clean_property_onboarding",
  );
  const issueTickets = data.tickets.filter(
    (ticket) => ticket.board === "clean_issues",
  );
  return (
    <section className="mt-8">
      <div className="mb-4">
        <p className="eyebrow">Stays → Cleans</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">
          Clean Property Onboarding Tracker
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#647577]">
          Properties appear under New Enquiry as soon as Stays marks onboarding 100% complete.
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <TicketBoard
          board="clean_property_onboarding"
          title="New Enquiry"
          description="New properties waiting for Recharge Cleans onboarding."
          icon={SprayCan}
          tickets={onboardingTickets}
        />
        <TicketBoard
          board="clean_issues"
          title="Guest clean issues"
          description="Cleaning issues reported directly from guest conversations."
          icon={SprayCan}
          tickets={issueTickets}
        />
      </div>
    </section>
  );
}

function AccountsWorkflow({ data }: { data: WorkflowData }) {
  const boards = [
    {
      board: "onboarding_invoices" as const,
      title: "Onboarding Invoices",
      description: "Issue the £475 VAT-inclusive onboarding invoice and confirm settlement.",
    },
    {
      board: "purchase_order_invoices" as const,
      title: "Purchase Order Invoices",
      description: "Approved client purchase orders waiting to be invoiced and settled.",
    },
    {
      board: "purchase_order_accounts" as const,
      title: "Purchase Order Accounts",
      description: "Ready supplier invoices waiting for Accounts to settle.",
    },
  ];
  return (
    <section className="mt-8">
      <div className="mb-4">
        <p className="eyebrow">Onboarding accounts</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">
          Property onboarding invoices
        </h2>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        {boards.map((board) => (
          <TicketBoard
            key={board.board}
            {...board}
            icon={FileText}
            tickets={data.tickets.filter((ticket) => ticket.board === board.board)}
          />
        ))}
      </div>
    </section>
  );
}

function TicketBoard({
  title,
  description,
  icon: Icon,
  tickets,
}: {
  board: WorkflowBoard;
  title: string;
  description: string;
  icon: typeof Wrench;
  tickets: WorkflowTicket[];
}) {
  return (
    <article className="rounded-[1.5rem] border border-[#d9e2df] bg-white p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#edf5f0] text-[#315f4d]">
            <Icon className="size-4.5" />
          </div>
          <div>
            <h3 className="font-semibold">{title}</h3>
            <p className="mt-1 text-xs leading-5 text-[#718184]">{description}</p>
          </div>
        </div>
        <Badge className="border-0 bg-[#f1f5f3] text-[#526a64]">
          {tickets.filter((ticket) => ticket.status !== "complete").length} open
        </Badge>
      </div>
      <div className="mt-5 space-y-3">
        {tickets.slice(0, 12).map((ticket) => (
          <TicketRow key={ticket.id} ticket={ticket} />
        ))}
        {tickets.length === 0 && (
          <div className="rounded-xl border border-dashed border-[#d5e0dc] bg-[#f8faf9] px-4 py-5 text-center text-sm text-[#718184]">
            No tickets on this board yet.
          </div>
        )}
      </div>
    </article>
  );
}

function TicketRow({ ticket }: { ticket: WorkflowTicket }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const onboardingInvoice = ticket.board === "onboarding_invoices";

  async function update(status: WorkflowStatus) {
    setSaving(true);
    const response = await fetch("/api/workflows/tickets", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: ticket.id, status }),
    });
    setSaving(false);
    if (response.ok) router.refresh();
  }

  return (
    <div className="rounded-xl border border-[#e3e9e7] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{ticket.propertyName}</p>
            {ticket.priority === "urgent" && (
              <Badge className="border-0 bg-[#fff0f0] text-[#9a3e3e]">Urgent</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-[#526568]">{ticket.title}</p>
          {ticket.details && (
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-[#718184]">{ticket.details}</p>
          )}
        </div>
          {ticket.status === "complete" && <CheckCircle2 className="size-5 shrink-0 text-[#5f8c38]" />}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#edf1f0] pt-3">
        <span className="text-[0.68rem] font-medium text-[#819093]">
          {onboardingInvoice ? ticket.status === "new" ? "New invoice" : ticket.status === "in_progress" ? "Invoice sent" : "Invoice settled" : ticket.lane === "new_enquiry" ? "New Enquiry" : ticket.lane === "to_schedule" ? "To schedule" : formatDate(ticket.createdAt)}
        </span>
        <Select value={ticket.status} disabled={saving} onValueChange={(value) => update(value as WorkflowStatus)}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="new">{onboardingInvoice ? "New invoice" : "New"}</SelectItem>
            <SelectItem value="in_progress">{onboardingInvoice ? "Invoice sent" : "In progress"}</SelectItem>
            <SelectItem value="complete">{onboardingInvoice ? "Invoice settled" : "Complete"}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function CompactTicketList({ tickets, empty }: { tickets: WorkflowTicket[]; empty: string }) {
  return (
    <div className="mt-6 space-y-2 border-t border-white/10 pt-5">
      {tickets.map((ticket) => (
        <div className="flex items-center justify-between gap-4 rounded-xl bg-white/[0.06] px-4 py-3" key={ticket.id}>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{ticket.propertyName}</p>
            <p className="mt-0.5 truncate text-xs text-white/45">{ticket.title}</p>
          </div>
          <Badge className="border-0 bg-white/10 text-white/70">{boardName(ticket.board)}</Badge>
        </div>
      ))}
      {tickets.length === 0 && <p className="text-sm text-white/45">{empty}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function boardName(board: WorkflowBoard) {
  return {
    spot_maintenance: "Maintenance",
    property_furnishing: "Furnishing",
    new_property_inspection: "Inspection",
    routine_bin_garden: "Bin & garden",
    clean_property_onboarding: "Cleans",
    clean_issues: "Clean issue",
    aircover_reporting: "AirCover",
    onboarding_invoices: "Onboarding invoice",
    purchase_order_invoices: "Purchase order invoice",
    purchase_order_accounts: "Supplier invoice",
  }[board];
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(new Date(timestamp * 1000));
}
