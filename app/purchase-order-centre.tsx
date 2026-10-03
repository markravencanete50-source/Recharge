"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CirclePoundSterling,
  ClipboardCheck,
  FileImage,
  PackageCheck,
  Plus,
  ReceiptText,
  RotateCcw,
  Send,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ModuleId, WorkspaceRole } from "@/lib/modules";
import type {
  PurchaseOrderCase,
  PurchaseOrderData,
  PurchaseOrderItem,
  PurchaseOrderWorkspace,
} from "@/lib/purchase-order-types";

export type { PurchaseOrderWorkspace } from "@/lib/purchase-order-types";

type CurrentUser = {
  name: string;
  email: string;
  role: WorkspaceRole;
  modules: ModuleId[];
};

const workspaceCopy: Record<
  PurchaseOrderWorkspace,
  { label: string; description: string; icon: typeof PackageCheck }
> = {
  stays: {
    label: "Stays requests",
    description: "Raise a furnishing quotation request and follow it through every department.",
    icon: Send,
  },
  ready: {
    label: "Ready quotations",
    description: "Confirm what the property needs, cost the order and record purchase evidence.",
    icon: PackageCheck,
  },
  management: {
    label: "Management approval",
    description: "Review quantities, apply the Recharge fee and approve the client quote.",
    icon: ClipboardCheck,
  },
  client: {
    label: "Client quotes",
    description: "Review, accept or reject a clear itemised purchase order quote.",
    icon: ReceiptText,
  },
  accounts: {
    label: "Accounts",
    description: "Issue invoices, track supplier payment and close the final balance.",
    icon: CirclePoundSterling,
  },
};

const statusCopy: Record<string, string> = {
  new: "New request",
  ready_draft: "Ready draft",
  management_review: "Management review",
  revision_requested: "Review requested",
  client_review: "Client decision",
  client_rejected: "Client rejected",
  client_accepted: "Accepted · invoice due",
  purchasing: "Purchasing",
  reconciliation: "Reconciliation",
  complete: "Complete",
};

export function PurchaseOrderCentre({
  currentUser,
  initialWorkspace,
  onBack,
}: {
  currentUser: CurrentUser;
  initialWorkspace: PurchaseOrderWorkspace;
  onBack: () => void;
}) {
  const [data, setData] = useState<PurchaseOrderData | null>(null);
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [selectedId, setSelectedId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  const workspaces = useMemo(
    () => allowedWorkspaces(currentUser),
    [currentUser],
  );
  const orders = useMemo(
    () => filterOrders(data?.orders || [], workspace),
    [data?.orders, workspace],
  );
  const selected =
    (data?.orders || []).find((order) => order.id === selectedId) || orders[0] || null;

  useEffect(() => {
    if (orders.length && !orders.some((order) => order.id === selectedId)) {
      setSelectedId(orders[0].id);
    }
  }, [orders, selectedId]);

  async function load() {
    try {
      const response = await fetch("/api/purchase-orders", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Purchase orders could not be loaded");
      setData(payload.data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Purchase orders could not be loaded");
    }
  }

  async function mutate(method: "POST" | "PATCH", body: unknown) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/purchase-orders", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Purchase order update failed");
      setData(payload.data);
      setMessage("Purchase order updated");
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Purchase order update failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function upload(orderId: string, itemId: string, kind: "receipt" | "photo", file: File) {
    setBusy(true);
    setMessage("");
    try {
      const form = new FormData();
      form.set("orderId", orderId);
      form.set("itemId", itemId);
      form.set("kind", kind);
      form.set("file", file);
      const response = await fetch("/api/purchase-orders/files", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Evidence upload failed");
      setData(payload.data);
      setMessage(kind === "receipt" ? "Receipt uploaded" : "Item photo uploaded");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Evidence upload failed");
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <section className="rounded-[1.5rem] border border-[#d9e2df] bg-white p-8">
        <p className="text-sm text-[#647577]">Loading Recharge Purchase Orders…</p>
        {message && <p className="mt-3 text-sm text-[#9a4747]">{message}</p>}
      </section>
    );
  }

  const Icon = workspaceCopy[workspace].icon;
  return (
    <div>
      <button
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm font-semibold text-[#49605d]"
      >
        <ArrowLeft className="size-4" /> Back to department
      </button>

      <div className="mt-6 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <div className="grid size-12 place-items-center rounded-2xl bg-[#e5f0e9] text-[#315f4d]">
            <Icon className="size-5" />
          </div>
          <p className="eyebrow mt-5">Recharge Purchase Orders</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
            {workspaceCopy[workspace].label}
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-[#647577]">
            {workspaceCopy[workspace].description}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {workspaces.map((item) => (
            <Button
              key={item}
              type="button"
              variant={workspace === item ? "default" : "outline"}
              className={
                workspace === item
                  ? "bg-[#1c3934] text-white hover:bg-[#264a43]"
                  : "border-[#cddbd6] bg-white text-[#40585b]"
              }
              onClick={() => {
                setWorkspace(item);
                setSelectedId("");
              }}
            >
              {workspaceCopy[item].label}
            </Button>
          ))}
        </div>
      </div>

      {message && (
        <div className="mt-5 rounded-xl border border-[#d4e1dc] bg-[#f3f8f5] px-4 py-3 text-sm text-[#315f4d]">
          {message}
        </div>
      )}

      {workspace === "stays" && (
        <RequestForm busy={busy} onCreate={(body) => mutate("POST", body)} />
      )}

      <div className="mt-8 grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <TicketList
          orders={orders}
          selectedId={selected?.id || ""}
          onSelect={setSelectedId}
          workspace={workspace}
        />
        {selected ? (
          <OrderWorkspace
            key={`${selected.id}-${workspace}-${selected.updatedAt}`}
            order={selected}
            workspace={workspace}
            busy={busy}
            mutate={mutate}
            upload={upload}
          />
        ) : (
          <EmptyWorkspace workspace={workspace} />
        )}
      </div>
    </div>
  );
}

function RequestForm({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (body: unknown) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    propertyName: "",
    clientName: "",
    clientEmail: "",
    propertyType: "Flat",
    bedrooms: 2,
    beds: 2,
    sofaBeds: 0,
    bathrooms: 1,
    livingRooms: 1,
    guests: 4,
    notes: "",
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await onCreate(form)) {
      setOpen(false);
      setForm((current) => ({ ...current, propertyName: "", clientName: "", clientEmail: "", notes: "" }));
    }
  }

  return (
    <section className="mt-7 rounded-[1.5rem] border border-[#d9e2df] bg-white p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-xl font-semibold">New quotation request</h2>
          <p className="mt-1 text-sm leading-6 text-[#68797b]">
            Property size creates the first recommended item and quantity list automatically.
          </p>
        </div>
        <Button
          type="button"
          className="bg-[#1c3934] text-white hover:bg-[#264a43]"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X className="mr-2 size-4" /> : <Plus className="mr-2 size-4" />}
          {open ? "Close" : "New request"}
        </Button>
      </div>
      {open && (
        <form onSubmit={submit} className="mt-6 grid gap-4 border-t border-[#e2e9e7] pt-6 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Property name"><Input required value={form.propertyName} onChange={(event) => setForm({ ...form, propertyName: event.target.value })} /></Field>
          <Field label="Client name"><Input required value={form.clientName} onChange={(event) => setForm({ ...form, clientName: event.target.value })} /></Field>
          <Field label="Client email"><Input required type="email" value={form.clientEmail} onChange={(event) => setForm({ ...form, clientEmail: event.target.value })} /></Field>
          <Field label="Property type"><Input required value={form.propertyType} onChange={(event) => setForm({ ...form, propertyType: event.target.value })} /></Field>
          {([
            ["Bedrooms", "bedrooms"], ["Beds", "beds"], ["Sofa beds", "sofaBeds"],
            ["Bathrooms", "bathrooms"], ["Living rooms", "livingRooms"], ["Guest capacity", "guests"],
          ] as const).map(([label, key]) => (
            <Field key={key} label={label}>
              <Input type="number" min={key === "guests" ? 1 : 0} required value={form[key]} onChange={(event) => setForm({ ...form, [key]: Number(event.target.value) })} />
            </Field>
          ))}
          <div className="md:col-span-2 xl:col-span-4">
            <Field label="Request notes"><Textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Access, furnishing brief, deadlines or anything Ready should know" /></Field>
          </div>
          <div className="md:col-span-2 xl:col-span-4">
            <Button disabled={busy} className="bg-[#1c3934] text-white hover:bg-[#264a43]">
              Send to Recharge Ready <ChevronRight className="ml-2 size-4" />
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function TicketList({
  orders,
  selectedId,
  onSelect,
  workspace,
}: {
  orders: PurchaseOrderCase[];
  selectedId: string;
  onSelect: (id: string) => void;
  workspace: PurchaseOrderWorkspace;
}) {
  return (
    <aside className="overflow-hidden rounded-[1.5rem] border border-[#d9e2df] bg-white">
      <div className="border-b border-[#e2e9e7] px-5 py-4">
        <p className="text-sm font-semibold">{workspace === "ready" ? "New & active tickets" : "Purchase order tickets"}</p>
        <p className="mt-1 text-xs text-[#78888a]">{orders.length} {orders.length === 1 ? "record" : "records"}</p>
      </div>
      <div className="max-h-[44rem] overflow-y-auto p-2">
        {orders.map((order) => (
          <button
            key={order.id}
            type="button"
            onClick={() => onSelect(order.id)}
            className={`mb-1 w-full rounded-xl px-3 py-3 text-left transition ${selectedId === order.id ? "bg-[#e9f1ed]" : "hover:bg-[#f5f8f6]"}`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-[#1c3934]">{order.propertyName}</p>
              <ChevronRight className="mt-0.5 size-4 shrink-0 text-[#82918f]" />
            </div>
            <p className="mt-1 text-xs text-[#748486]">{order.reference} · {order.clientName}</p>
            <Badge className="mt-2 border-0 bg-[#f0f5f2] text-[0.68rem] text-[#526965]">
              {statusCopy[order.status]}
            </Badge>
          </button>
        ))}
        {!orders.length && <p className="px-3 py-10 text-center text-sm leading-6 text-[#78888a]">No tickets are waiting in this view.</p>}
      </div>
    </aside>
  );
}

function OrderWorkspace({
  order,
  workspace,
  busy,
  mutate,
  upload,
}: {
  order: PurchaseOrderCase;
  workspace: PurchaseOrderWorkspace;
  busy: boolean;
  mutate: (method: "POST" | "PATCH", body: unknown) => Promise<boolean>;
  upload: (orderId: string, itemId: string, kind: "receipt" | "photo", file: File) => Promise<void>;
}) {
  if (workspace === "ready") return <ReadyOrder order={order} busy={busy} mutate={mutate} upload={upload} />;
  if (workspace === "management") return <ManagementOrder order={order} busy={busy} mutate={mutate} />;
  if (workspace === "client") return <ClientOrder order={order} busy={busy} mutate={mutate} />;
  if (workspace === "accounts") return <AccountsOrder order={order} busy={busy} mutate={mutate} />;
  return <StaysOrder order={order} />;
}

function OrderHeader({ order }: { order: PurchaseOrderCase }) {
  return (
    <div className="flex flex-col justify-between gap-4 border-b border-[#e2e9e7] p-5 sm:flex-row sm:items-start sm:p-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-2xl font-semibold tracking-[-0.03em]">{order.propertyName}</h2>
          <Badge className="border-0 bg-[#eef5df] text-[#506c2d]">{statusCopy[order.status]}</Badge>
        </div>
        <p className="mt-2 text-sm text-[#6f7f81]">{order.reference} · {order.clientName} · {order.clientEmail}</p>
      </div>
      <p className="text-sm font-semibold text-[#526965]">{order.bedrooms} bed · {order.bathrooms} bath · sleeps {order.guests}</p>
    </div>
  );
}

function StaysOrder({ order }: { order: PurchaseOrderCase }) {
  return (
    <article className="overflow-hidden rounded-[1.5rem] border border-[#d9e2df] bg-white">
      <OrderHeader order={order} />
      <div className="p-5 sm:p-6">
        <p className="text-sm leading-6 text-[#637477]">{order.notes || "No additional request notes."}</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Metric label="Items estimate" value={money(order.estimatedItemsTotalPence)} />
          <Metric label="Approved client total" value={order.status === "new" ? "Pending" : money(order.approvedClientTotalPence)} />
          <Metric label="Current status" value={statusCopy[order.status]} />
        </div>
        <Timeline order={order} />
      </div>
    </article>
  );
}

function ReadyOrder({
  order,
  busy,
  mutate,
  upload,
}: {
  order: PurchaseOrderCase;
  busy: boolean;
  mutate: (method: "POST" | "PATCH", body: unknown) => Promise<boolean>;
  upload: (orderId: string, itemId: string, kind: "receipt" | "photo", file: File) => Promise<void>;
}) {
  const [items, setItems] = useState(order.items.map(cloneItem));
  const [labour, setLabour] = useState(pounds(order.labourEstimatePence));
  const editable = ["new", "ready_draft", "revision_requested"].includes(order.status);
  const purchasing = order.status === "purchasing";
  const readyTask = ["client_accepted", "purchasing", "reconciliation"].includes(order.status);

  useEffect(() => {
    setItems(order.items.map(cloneItem));
    setLabour(pounds(order.labourEstimatePence));
  }, [order]);

  async function saveQuote() {
    await mutate("PATCH", {
      action: "save_ready_quote",
      id: order.id,
      labourEstimatePence: pence(labour),
      items: serialiseItems(items),
    });
  }

  async function saveActuals() {
    await mutate("PATCH", { action: "save_actuals", id: order.id, items: serialiseItems(items) });
  }

  return (
    <article className="overflow-hidden rounded-[1.5rem] border border-[#d9e2df] bg-white">
      <OrderHeader order={order} />
      <div className="p-5 sm:p-6">
        {order.status === "revision_requested" && (
          <Notice title="Management requested a review" text={order.managementNotes || "Review the quantities and costs before resubmitting."} tone="amber" />
        )}
        {readyTask && (
          <Notice
            title={`Ready supplier invoice: ${money(order.readyInvoicePence)}`}
            text={order.readyInvoiceStatus === "requested" ? "Send this invoice to Accounts. The purchase can begin once the client invoice is marked paid." : `Supplier invoice status: ${order.readyInvoiceStatus.replaceAll("_", " ")}.`}
          />
        )}
        {order.status === "reconciliation" && order.balancePence < 0 && (
          <Notice
            title={`Invoice Accounts for the ${money(Math.abs(order.balancePence))} difference`}
            text="The evidenced purchase cost exceeded the approved balance. Accounts has a matching anticipated-invoice task."
            tone="amber"
          />
        )}
        {order.status === "reconciliation" && order.balancePence > 0 && (
          <Notice
            title={`${money(order.balancePence)} must be returned to Recharge`}
            text="The purchase came in under budget. Accounts has a matching ticket to invoice the excess balance."
            tone="amber"
          />
        )}
        {editable && (
          <>
            <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <p className="eyebrow">Calculated furnishing schedule</p>
                <h3 className="mt-2 text-xl font-semibold">Required, already there, and to order</h3>
              </div>
              <Button type="button" variant="outline" className="border-[#cddbd6]" onClick={() => setItems([...items, newItem(items.length)])}>
                <Plus className="mr-2 size-4" /> Add item
              </Button>
            </div>
            <ItemEditor items={items} onChange={setItems} mode="quote" />
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <Metric label="Items estimate" value={money(estimatedTotal(items))} />
              <Field label="Labour cost (£)"><Input type="number" min="0" step="0.01" value={labour} onChange={(event) => setLabour(event.target.value)} /></Field>
              <Metric label="Ready quote total" value={money(estimatedTotal(items) + pence(labour))} />
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button disabled={busy} variant="outline" className="border-[#b9cac5]" onClick={saveQuote}>Save draft</Button>
              <Button disabled={busy || order.status === "new"} className="bg-[#1c3934] text-white hover:bg-[#264a43]" onClick={() => mutate("PATCH", { action: "submit_management", id: order.id })}>
                Submit for management approval <ChevronRight className="ml-2 size-4" />
              </Button>
            </div>
          </>
        )}

        {order.status === "client_accepted" && (
          <div className="mt-5">
            <Button disabled={busy || order.clientInvoiceStatus !== "paid"} className="bg-[#1c3934] text-white hover:bg-[#264a43]" onClick={() => mutate("PATCH", { action: "start_purchasing", id: order.id })}>
              <ShoppingCart className="mr-2 size-4" /> Start purchasing
            </Button>
            {order.clientInvoiceStatus !== "paid" && <p className="mt-2 text-sm text-[#7b898b]">Waiting for Accounts to mark the client invoice paid.</p>}
          </div>
        )}

        {(purchasing || order.status === "reconciliation" || order.status === "complete") && (
          <>
            <div className="mt-2 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <p className="eyebrow">Purchase proof</p>
                <h3 className="mt-2 text-xl font-semibold">Actual costs, receipts and photos</h3>
                <p className="mt-1 text-sm text-[#69797b]">Every purchased line needs an actual unit value, receipt and item photo.</p>
              </div>
              <Metric label="Actual items" value={money(actualTotal(items))} compact />
            </div>
            <EvidenceEditor order={order} items={items} onChange={setItems} upload={upload} disabled={!purchasing || busy} />
            {purchasing && (
              <div className="mt-6 flex flex-wrap gap-3">
                <Button disabled={busy} variant="outline" className="border-[#b9cac5]" onClick={saveActuals}>Save actual costs</Button>
                <Button disabled={busy} className="bg-[#1c3934] text-white hover:bg-[#264a43]" onClick={() => mutate("PATCH", { action: "submit_evidence", id: order.id })}>
                  Submit for reconciliation <ChevronRight className="ml-2 size-4" />
                </Button>
              </div>
            )}
          </>
        )}

        {!editable && !readyTask && order.status !== "client_accepted" && order.status !== "client_rejected" && (
          <Notice title="This ticket has moved forward" text={`Current stage: ${statusCopy[order.status]}. All departments are viewing this same purchase order record.`} />
        )}
      </div>
    </article>
  );
}

function ManagementOrder({
  order,
  busy,
  mutate,
}: {
  order: PurchaseOrderCase;
  busy: boolean;
  mutate: (method: "POST" | "PATCH", body: unknown) => Promise<boolean>;
}) {
  const [items, setItems] = useState(order.items.map(cloneItem));
  const [fee, setFee] = useState(pounds(order.rechargeFeePence));
  const [readyInvoice, setReadyInvoice] = useState(pounds(order.readyInvoicePence || order.labourEstimatePence));
  const [notes, setNotes] = useState(order.managementNotes);
  const editable = order.status === "management_review";
  const total = estimatedTotal(items) + order.labourEstimatePence + pence(fee);

  useEffect(() => {
    setItems(order.items.map(cloneItem));
    setFee(pounds(order.rechargeFeePence));
    setReadyInvoice(pounds(order.readyInvoicePence || order.labourEstimatePence));
    setNotes(order.managementNotes);
  }, [order]);

  async function decide(decision: "approve" | "request_revision") {
    await mutate("PATCH", {
      action: "management_decision",
      id: order.id,
      decision,
      rechargeFeePence: pence(fee),
      readyInvoicePence: pence(readyInvoice),
      managementNotes: notes,
      items: serialiseItems(items),
    });
  }

  return (
    <article className="overflow-hidden rounded-[1.5rem] border border-[#d9e2df] bg-white">
      <OrderHeader order={order} />
      <div className="p-5 sm:p-6">
        {editable ? (
          <>
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div><p className="eyebrow">Management control</p><h3 className="mt-2 text-xl font-semibold">Review and amend the quote</h3></div>
              <Button type="button" variant="outline" className="border-[#cddbd6]" onClick={() => setItems([...items, newItem(items.length)])}><Plus className="mr-2 size-4" /> Add item</Button>
            </div>
            <ItemEditor items={items} onChange={setItems} mode="quote" />
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Items" value={money(estimatedTotal(items))} />
              <Metric label="Ready labour" value={money(order.labourEstimatePence)} />
              <Field label="Recharge fee (£)"><Input type="number" min="0" step="0.01" value={fee} onChange={(event) => setFee(event.target.value)} /></Field>
              <Metric label="Client total" value={money(total)} />
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Ready manager invoice amount (£)"><Input type="number" min="0" step="0.01" value={readyInvoice} onChange={(event) => setReadyInvoice(event.target.value)} /></Field>
              <Field label="Management notes"><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Reason for amendments or review instructions" /></Field>
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button disabled={busy} variant="outline" className="border-[#d9b76b] text-[#76531c]" onClick={() => decide("request_revision")}><RotateCcw className="mr-2 size-4" /> Request Ready review</Button>
              <Button disabled={busy} className="bg-[#1c3934] text-white hover:bg-[#264a43]" onClick={() => decide("approve")}><Check className="mr-2 size-4" /> Approve and send to client</Button>
            </div>
          </>
        ) : (
          <Notice title="No management action is required" text={`This ticket is currently ${statusCopy[order.status].toLowerCase()}.`} />
        )}
      </div>
    </article>
  );
}

function ClientOrder({
  order,
  busy,
  mutate,
}: {
  order: PurchaseOrderCase;
  busy: boolean;
  mutate: (method: "POST" | "PATCH", body: unknown) => Promise<boolean>;
}) {
  const [note, setNote] = useState(order.clientDecisionNotes);
  const awaiting = order.status === "client_review";
  return (
    <article className="overflow-hidden rounded-[1.5rem] border border-[#d9e2df] bg-white">
      <OrderHeader order={order} />
      <div className="p-5 sm:p-6">
        <div className="rounded-[1.3rem] bg-[#1c3934] p-5 text-white sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/55">Purchase order quote</p>
          <div className="mt-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div><h3 className="text-2xl font-semibold">{order.propertyName}</h3><p className="mt-1 text-sm text-white/65">Prepared by Recharge · {order.reference}</p></div>
            <p className="text-3xl font-semibold tracking-[-0.04em]">{money(order.approvedClientTotalPence)}</p>
          </div>
        </div>
        <ClientQuote order={order} />
        {awaiting ? (
          <div className="mt-6 border-t border-[#e2e9e7] pt-6">
            <Field label="Decision notes"><Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional for acceptance; required if rejecting" /></Field>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button disabled={busy || !note.trim()} variant="outline" className="border-[#e5a5a5] text-[#8c3d3d]" onClick={() => mutate("PATCH", { action: "client_decision", id: order.id, decision: "reject", note })}><X className="mr-2 size-4" /> Reject quote</Button>
              <Button disabled={busy} className="bg-[#1c3934] text-white hover:bg-[#264a43]" onClick={() => mutate("PATCH", { action: "client_decision", id: order.id, decision: "accept", note })}><Check className="mr-2 size-4" /> Accept quote</Button>
            </div>
          </div>
        ) : (
          <Notice title={order.status === "client_rejected" ? "Quote rejected" : order.status === "complete" ? "Order complete" : "Decision recorded"} text={order.clientDecisionNotes || `Current status: ${statusCopy[order.status]}.`} tone={order.status === "client_rejected" ? "red" : "green"} />
        )}
        {order.items.some((item) => item.files.length) && <ClientProof order={order} />}
      </div>
    </article>
  );
}

function AccountsOrder({
  order,
  busy,
  mutate,
}: {
  order: PurchaseOrderCase;
  busy: boolean;
  mutate: (method: "POST" | "PATCH", body: unknown) => Promise<boolean>;
}) {
  const accountAction = (update: string) => mutate("PATCH", { action: "accounts_update", id: order.id, update });
  return (
    <article className="overflow-hidden rounded-[1.5rem] border border-[#d9e2df] bg-white">
      <OrderHeader order={order} />
      <div className="p-5 sm:p-6">
        <div className="grid gap-4 lg:grid-cols-3">
          <AccountTask title="Client invoice" amount={order.approvedClientTotalPence} status={order.clientInvoiceStatus}>
            {order.clientInvoiceStatus === "to_send" && <Button disabled={busy} size="sm" className="bg-[#1c3934] text-white" onClick={() => accountAction("client_invoice_sent")}>Mark invoice sent</Button>}
            {order.clientInvoiceStatus === "sent" && <Button disabled={busy} size="sm" className="bg-[#1c3934] text-white" onClick={() => accountAction("client_invoice_paid")}>Mark client paid</Button>}
          </AccountTask>
          <AccountTask title="Ready manager invoice" amount={order.readyInvoicePence} status={order.readyInvoiceStatus}>
            {order.readyInvoiceStatus === "requested" && <Button disabled={busy} size="sm" variant="outline" onClick={() => accountAction("ready_invoice_received")}>Mark invoice received</Button>}
            {order.readyInvoiceStatus === "received" && <Button disabled={busy} size="sm" className="bg-[#1c3934] text-white" onClick={() => accountAction("ready_invoice_settled")}>Mark Ready paid</Button>}
          </AccountTask>
          <AccountTask title="Final balance" amount={Math.abs(order.balancePence)} status={order.reconciliationStatus}>
            {order.status === "reconciliation" && order.reconciliationStatus !== "settled" && <Button disabled={busy} size="sm" className="bg-[#1c3934] text-white" onClick={() => accountAction("reconciliation_settled")}>Mark balance settled</Button>}
          </AccountTask>
        </div>
        {order.status === "reconciliation" && (
          <Notice
            tone={order.balancePence === 0 ? "green" : "amber"}
            title={order.balancePence > 0 ? `Invoice Ready for the ${money(order.balancePence)} excess` : order.balancePence < 0 ? `Expect a Ready invoice for the ${money(Math.abs(order.balancePence))} difference` : "Purchase order balances exactly"}
            text={`Approved client total ${money(order.approvedClientTotalPence)} · Actual items, Ready invoice and Recharge fee ${money(order.actualTotalPence)}.`}
          />
        )}
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Metric label="Approved client total" value={money(order.approvedClientTotalPence)} />
          <Metric label="Actual purchased items" value={money(order.actualItemsTotalPence)} />
          <Metric label="Difference" value={money(order.balancePence)} />
        </div>
      </div>
    </article>
  );
}

function ItemEditor({
  items,
  onChange,
  mode,
}: {
  items: PurchaseOrderItem[];
  onChange: (items: PurchaseOrderItem[]) => void;
  mode: "quote";
}) {
  void mode;
  return (
    <div className="mt-5 overflow-x-auto rounded-xl border border-[#dce5e2]">
      <table className="w-full min-w-[850px] text-left text-sm">
        <thead className="bg-[#f4f7f5] text-xs uppercase tracking-[0.08em] text-[#657678]"><tr><th className="px-3 py-3">Area / item</th><th className="px-3 py-3">Required</th><th className="px-3 py-3">Already there</th><th className="px-3 py-3">To order</th><th className="px-3 py-3">Unit £</th><th className="px-3 py-3 text-right">Line total</th><th className="w-12" /></tr></thead>
        <tbody className="divide-y divide-[#e7edeb]">
          {items.map((item, index) => {
            const missing = Math.max(0, item.requiredQty - item.inPropertyQty);
            return (
              <tr key={item.id || `new-${index}`}>
                <td className="min-w-72 px-3 py-2"><Input aria-label="Area" className="mb-2 h-8 text-xs" value={item.area} onChange={(event) => updateItem(items, onChange, index, { area: event.target.value })} /><Input aria-label="Item name" value={item.name} onChange={(event) => updateItem(items, onChange, index, { name: event.target.value })} /></td>
                <td className="px-3 py-2"><Input aria-label="Required quantity" className="w-24" type="number" min="0" value={item.requiredQty} onChange={(event) => updateItem(items, onChange, index, { requiredQty: Number(event.target.value) })} /></td>
                <td className="px-3 py-2"><Input aria-label="Already in property" className="w-24" type="number" min="0" value={item.inPropertyQty} onChange={(event) => updateItem(items, onChange, index, { inPropertyQty: Number(event.target.value) })} /></td>
                <td className="px-3 py-2 font-semibold text-[#315f4d]">{missing}</td>
                <td className="px-3 py-2"><Input aria-label="Estimated unit cost" className="w-28" type="number" min="0" step="0.01" value={pounds(item.estimateUnitCostPence)} onChange={(event) => updateItem(items, onChange, index, { estimateUnitCostPence: pence(event.target.value) })} /></td>
                <td className="px-3 py-2 text-right font-semibold">{money(missing * item.estimateUnitCostPence)}</td>
                <td className="pr-2"><button type="button" aria-label={`Remove ${item.name}`} className="grid size-8 place-items-center rounded-lg text-[#9a5a5a] hover:bg-[#fff0f0]" onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="size-4" /></button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EvidenceEditor({
  order,
  items,
  onChange,
  upload,
  disabled,
}: {
  order: PurchaseOrderCase;
  items: PurchaseOrderItem[];
  onChange: (items: PurchaseOrderItem[]) => void;
  upload: (orderId: string, itemId: string, kind: "receipt" | "photo", file: File) => Promise<void>;
  disabled: boolean;
}) {
  const purchased = items.filter((item) => Math.max(0, item.requiredQty - item.inPropertyQty) > 0);
  return (
    <div className="mt-5 space-y-3">
      {purchased.map((item) => {
        const index = items.findIndex((candidate) => candidate.id === item.id);
        const quantity = Math.max(0, item.requiredQty - item.inPropertyQty);
        const receipts = item.files.filter((file) => file.kind === "receipt");
        const photos = item.files.filter((file) => file.kind === "photo");
        return (
          <div key={item.id} className="rounded-xl border border-[#dce5e2] p-4">
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
              <div><p className="font-semibold">{item.name}</p><p className="mt-1 text-xs text-[#748486]">{quantity} to purchase · estimated {money(quantity * item.estimateUnitCostPence)}</p></div>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Actual unit £"><Input disabled={disabled} className="w-28" type="number" min="0" step="0.01" value={pounds(item.actualUnitCostPence)} onChange={(event) => updateItem(items, onChange, index, { actualUnitCostPence: pence(event.target.value) })} /></Field>
                <UploadButton disabled={disabled} label="Receipt" icon={ReceiptText} onFile={(file) => upload(order.id, item.id, "receipt", file)} />
                <UploadButton disabled={disabled} label="Photo" icon={FileImage} onFile={(file) => upload(order.id, item.id, "photo", file)} />
              </div>
            </div>
            {(receipts.length > 0 || photos.length > 0) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {[...receipts, ...photos].map((file) => <a key={file.id} href={`/api/purchase-orders/files/${file.id}`} target="_blank" rel="noreferrer" className="rounded-full bg-[#eef4f0] px-3 py-1 text-xs font-semibold text-[#436352]">{file.kind === "receipt" ? "Receipt" : "Photo"}: {file.fileName}</a>)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ClientQuote({ order }: { order: PurchaseOrderCase }) {
  const visible = order.items.filter((item) => Math.max(0, item.requiredQty - item.inPropertyQty) > 0);
  const areas = Array.from(new Set(visible.map((item) => item.area)));
  return (
    <div className="mt-6 space-y-5">
      {areas.map((area) => (
        <section key={area}>
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#708083]">{area}</p>
          <div className="mt-2 divide-y divide-[#e8eeec] rounded-xl border border-[#dce5e2]">
            {visible.filter((item) => item.area === area).map((item) => {
              const quantity = Math.max(0, item.requiredQty - item.inPropertyQty);
              return <div key={item.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm"><span>{item.name} <span className="text-[#82908f]">× {quantity}</span></span><span className="font-semibold">{money(quantity * item.estimateUnitCostPence)}</span></div>;
            })}
          </div>
        </section>
      ))}
      <div className="ml-auto max-w-md space-y-2 rounded-xl bg-[#f4f7f5] p-4 text-sm">
        <TotalLine label="Furnishing items" value={money(order.estimatedItemsTotalPence)} />
        <TotalLine label="Setup and labour" value={money(order.labourEstimatePence)} />
        <TotalLine label="Recharge project fee" value={money(order.rechargeFeePence)} />
        <div className="border-t border-[#d5dfdb] pt-2"><TotalLine label="Total" value={money(order.approvedClientTotalPence)} strong /></div>
      </div>
    </div>
  );
}

function ClientProof({ order }: { order: PurchaseOrderCase }) {
  return (
    <section className="mt-8 border-t border-[#e2e9e7] pt-6">
      <h3 className="text-xl font-semibold">Purchase evidence</h3>
      <p className="mt-1 text-sm text-[#6b7b7d]">Receipts and photos uploaded against the purchased items.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {order.items.filter((item) => item.files.length).map((item) => (
          <div key={item.id} className="rounded-xl border border-[#dce5e2] p-4"><p className="font-semibold">{item.name}</p><p className="mt-1 text-sm text-[#6e7d7f]">Actual unit value {money(item.actualUnitCostPence)}</p><div className="mt-3 flex flex-wrap gap-2">{item.files.map((file) => <a key={file.id} href={`/api/purchase-orders/files/${file.id}`} target="_blank" rel="noreferrer" className="rounded-full bg-[#eef4f0] px-3 py-1 text-xs font-semibold text-[#436352]">{file.kind === "receipt" ? "Receipt" : "Photo"}</a>)}</div></div>
        ))}
      </div>
    </section>
  );
}

function AccountTask({ title, amount, status, children }: { title: string; amount: number; status: string; children?: React.ReactNode }) {
  return <section className="rounded-[1.2rem] border border-[#dce5e2] p-4"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#708083]">{title}</p><p className="mt-3 text-2xl font-semibold">{money(amount)}</p><p className="mt-1 text-sm capitalize text-[#6f7f81]">{status.replaceAll("_", " ")}</p>{children && <div className="mt-4">{children}</div>}</section>;
}

function Timeline({ order }: { order: PurchaseOrderCase }) {
  const stages = ["Stays request", "Ready quote", "Management", "Client", "Accounts", "Purchase", "Reconcile"];
  const index = ({ new: 0, ready_draft: 1, revision_requested: 1, management_review: 2, client_review: 3, client_rejected: 3, client_accepted: 4, purchasing: 5, reconciliation: 6, complete: 7 } as Record<string, number>)[order.status] || 0;
  return <div className="mt-7 grid gap-2 sm:grid-cols-7">{stages.map((stage, stageIndex) => <div key={stage} className={`rounded-lg px-3 py-3 text-xs font-semibold ${stageIndex <= index ? "bg-[#e8f6d7] text-[#3e6326]" : "bg-[#f1f5f3] text-[#84918f]"}`}>{stage}</div>)}</div>;
}

function EmptyWorkspace({ workspace }: { workspace: PurchaseOrderWorkspace }) {
  return <section className="grid min-h-72 place-items-center rounded-[1.5rem] border border-dashed border-[#bdcbc7] bg-white p-8 text-center"><div><PackageCheck className="mx-auto size-8 text-[#658072]" /><h2 className="mt-4 text-xl font-semibold">Nothing waiting here</h2><p className="mt-2 max-w-md text-sm leading-6 text-[#748486]">{workspace === "stays" ? "Create the first purchase order request above." : "Tickets will appear automatically when the previous department completes its step."}</p></div></section>;
}

function Notice({ title, text, tone = "green" }: { title: string; text: string; tone?: "green" | "amber" | "red" }) {
  const classes = tone === "amber" ? "border-[#ead59c] bg-[#fff9e8] text-[#76531c]" : tone === "red" ? "border-[#efcaca] bg-[#fff4f4] text-[#8a4444]" : "border-[#cfe0d8] bg-[#f1f7f3] text-[#315f4d]";
  return <div className={`mb-5 rounded-xl border px-4 py-3 ${classes}`}><p className="font-semibold">{title}</p><p className="mt-1 text-sm leading-6 opacity-80">{text}</p></div>;
}

function Metric({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return <div className={`rounded-xl bg-[#f4f7f5] ${compact ? "px-4 py-3" : "p-4"}`}><p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#718184]">{label}</p><p className={`${compact ? "mt-1 text-lg" : "mt-3 text-2xl"} font-semibold tracking-[-0.03em]`}>{value}</p></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><Label className="mb-2 block text-sm text-[#4e6462]">{label}</Label>{children}</label>;
}

function UploadButton({ disabled, label, icon: Icon, onFile }: { disabled: boolean; label: string; icon: typeof ReceiptText; onFile: (file: File) => void }) {
  return <label className={`inline-flex h-10 cursor-pointer items-center rounded-lg border border-[#cbd8d4] bg-white px-3 text-sm font-semibold text-[#405b54] ${disabled ? "pointer-events-none opacity-50" : "hover:bg-[#f3f7f5]"}`}><Icon className="mr-2 size-4" />{label}<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file); event.currentTarget.value = ""; }} /></label>;
}

function TotalLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={`flex items-center justify-between gap-4 ${strong ? "text-base font-semibold" : "text-[#596d69]"}`}><span>{label}</span><span>{value}</span></div>;
}

function updateItem(items: PurchaseOrderItem[], onChange: (items: PurchaseOrderItem[]) => void, index: number, patch: Partial<PurchaseOrderItem>) {
  onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
}

function newItem(position: number): PurchaseOrderItem {
  return { id: "", orderId: "", area: "Other", name: "New item", requiredQty: 1, inPropertyQty: 0, estimateUnitCostPence: 0, actualUnitCostPence: 0, note: "", position, files: [] };
}

function cloneItem(item: PurchaseOrderItem) {
  return { ...item, files: [...item.files] };
}

function serialiseItems(items: PurchaseOrderItem[]) {
  return items.map((item, position) => ({ ...item, id: item.id || undefined, files: undefined, position }));
}

function estimatedTotal(items: PurchaseOrderItem[]) {
  return items.reduce((total, item) => total + Math.max(0, item.requiredQty - item.inPropertyQty) * item.estimateUnitCostPence, 0);
}

function actualTotal(items: PurchaseOrderItem[]) {
  return items.reduce((total, item) => total + Math.max(0, item.requiredQty - item.inPropertyQty) * item.actualUnitCostPence, 0);
}

function money(value: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value / 100);
}

function pounds(value: number) {
  return (value / 100).toFixed(2);
}

function pence(value: string | number) {
  return Math.max(0, Math.round(Number(value || 0) * 100));
}

function allowedWorkspaces(user: CurrentUser): PurchaseOrderWorkspace[] {
  if (user.role === "admin") return ["stays", "ready", "management", "client", "accounts"];
  if (user.role === "client") return ["client"];
  if (user.role === "ready") return ["ready"];
  return ["stays", "ready"];
}

function filterOrders(orders: PurchaseOrderCase[], workspace: PurchaseOrderWorkspace) {
  if (workspace === "management") return orders.filter((order) => order.status === "management_review");
  if (workspace === "client") return orders.filter((order) => ["client_review", "client_rejected", "client_accepted", "purchasing", "reconciliation", "complete"].includes(order.status));
  if (workspace === "accounts") return orders.filter((order) => ["client_accepted", "purchasing", "reconciliation", "complete"].includes(order.status));
  if (workspace === "ready") return orders.filter((order) => order.status !== "client_rejected");
  return orders;
}
