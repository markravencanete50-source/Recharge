"use client";

import { FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Clock3,
  ExternalLink,
  Inbox,
  Mail,
  MessageCircle,
  MessagesSquare,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  SprayCan,
  Trash2,
  Users,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type {
  CommunicationCentreData,
  CommunicationMessage,
  CommunicationSource,
  CommunicationThread,
  CommunicationWorkflow,
} from "@/lib/communications";
import type { HostawayReservation } from "@/lib/hostaway-types";
import type { WorkspaceRole } from "@/lib/modules";
import { MAINTENANCE_CHECKLISTS } from "@/lib/maintenance-checklists";
import type { MaintenanceCategory } from "@/lib/maintenance-types";

type CentreUser = {
  name: string;
  email: string;
  role: WorkspaceRole;
};

const sourceDetails: Record<
  CommunicationSource,
  {
    title: string;
    description: string;
    icon: typeof Inbox;
    connection: keyof CommunicationCentreData["integrations"];
    amberSeconds: number;
    redSeconds: number;
  }
> = {
  guests: {
    title: "Guest inbox",
    description: "All guest conversations received through Hostaway.",
    icon: MessagesSquare,
    connection: "hostaway",
    amberSeconds: 300,
    redSeconds: 600,
  },
  email: {
    title: "Email inbox",
    description: "Fasthosts mailboxes, subjects, ownership and response times.",
    icon: Mail,
    connection: "email",
    amberSeconds: 300,
    redSeconds: 600,
  },
  whatsapp: {
    title: "WhatsApp inbox",
    description: "Direct WhatsApp Business conversations kept separate from Hostaway.",
    icon: MessageCircle,
    connection: "whatsapp",
    amberSeconds: 300,
    redSeconds: 600,
  },
};

export function CommunicationCentre({
  data,
  currentUser,
  onBack,
}: {
  data?: CommunicationCentreData;
  currentUser: CentreUser;
  onBack: () => void;
}) {
  const [liveData, setLiveData] = useState<CommunicationCentreData | null>(null);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "live" | "error">(
    "idle",
  );
  const [syncMessage, setSyncMessage] = useState("");

  useEffect(() => {
    if (!data?.integrations.hostaway) return;

    let cancelled = false;
    let running = false;
    async function sync() {
      if (running) return;
      running = true;
      setSyncState((current) => (current === "live" ? current : "syncing"));
      try {
        const response = await fetch("/api/communications/hostaway/sync", {
          method: "POST",
        });
        const result = (await response.json().catch(() => null)) as
          | { data?: CommunicationCentreData; error?: string }
          | null;
        if (cancelled) return;
        if (!response.ok || !result?.data) {
          setSyncState("error");
          setSyncMessage(result?.error || "Hostaway will retry automatically.");
          return;
        }
        setLiveData(result.data);
        setSyncState("live");
        setSyncMessage("");
      } catch {
        if (!cancelled) {
          setSyncState("error");
          setSyncMessage("Hostaway will retry automatically.");
        }
      } finally {
        running = false;
      }
    }

    void sync();
    const timer = window.setInterval(() => void sync(), 4_000);
    const reconnect = () => void sync();
    window.addEventListener("focus", reconnect);
    document.addEventListener("visibilitychange", reconnect);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", reconnect);
      document.removeEventListener("visibilitychange", reconnect);
    };
  }, [data?.integrations.hostaway]);

  const safeData = liveData ?? data ?? unavailableData();

  return (
    <div>
      <button
        className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-[#4f6966] hover:text-[#1c3934]"
        onClick={onBack}
      >
        <ArrowLeft className="size-4" /> Back to Stays
      </button>

      <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
        <div>
          <p className="eyebrow">Recharge Stays</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
            Communication Centre
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-[#647577]">
            Live guest messages, friendly assisted replies and clear response accountability.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ConnectionBadge
            label={
              syncState === "syncing"
                ? "Hostaway syncing"
                : syncState === "error"
                  ? "Hostaway needs attention"
                  : syncState === "live"
                    ? "Hostaway live"
                    : "Hostaway"
            }
            connected={safeData.integrations.hostaway && syncState !== "error"}
          />
        </div>
      </div>

      {syncMessage && (
        <div className="mt-6 rounded-2xl border border-[#ead8a5] bg-[#fff9e8] px-5 py-4 text-sm leading-6 text-[#765e22]">
          {syncMessage}
        </div>
      )}

      {!safeData.available && (
        <div className="mt-6 rounded-2xl border border-[#ead8a5] bg-[#fff9e8] px-5 py-4 text-sm leading-6 text-[#765e22]">
          The Communication Centre is ready, but its live connections still need to be authorised. Typed workflows are available after the new workspace database finishes activating.
        </div>
      )}

      <Tabs defaultValue="guests" className="mt-7">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl bg-[#e3ebe7] p-1.5">
          <CentreTab value="guests" icon={MessagesSquare} label="Guests" />
          <CentreTab value="whatsapp" icon={MessageCircle} label="WhatsApp" />
          <CentreTab value="email" icon={Mail} label="Email" />
          <CentreTab value="workflows" icon={Sparkles} label="Workflows" />
          <CentreTab value="performance" icon={Users} label="Response report" />
        </TabsList>

        <TabsContent value="guests" className="mt-5">
          <ChannelWorkspace
            source="guests"
            data={safeData}
            currentUser={currentUser}
            onData={setLiveData}
          />
        </TabsContent>
        <TabsContent value="whatsapp" className="mt-5">
          <ChannelWorkspace source="whatsapp" data={safeData} currentUser={currentUser} onData={setLiveData} />
        </TabsContent>
        <TabsContent value="email" className="mt-5">
          <ChannelWorkspace source="email" data={safeData} currentUser={currentUser} onData={setLiveData} />
        </TabsContent>
        <TabsContent value="workflows" className="mt-5">
          <WorkflowWorkspace data={safeData} currentUser={currentUser} />
        </TabsContent>
        <TabsContent value="performance" className="mt-5">
          <PerformanceWorkspace data={safeData} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CentreTab({
  value,
  icon: Icon,
  label,
}: {
  value: string;
  icon: typeof Inbox;
  label: string;
}) {
  return (
    <TabsTrigger value={value} className="min-h-10 shrink-0 gap-2 rounded-xl px-4">
      <Icon className="size-4" /> {label}
    </TabsTrigger>
  );
}

function ChannelWorkspace({
  source,
  data,
  currentUser,
  onData,
}: {
  source: CommunicationSource;
  data: CommunicationCentreData;
  currentUser: CentreUser;
  onData: (data: CommunicationCentreData) => void;
}) {
  const details = sourceDetails[source];
  const threads = data.threads.filter((thread) => thread.source === source);
  const [search, setSearch] = useState("");
  const [queue, setQueue] = useState<"new" | "responded">("new");
  const [sortBy, setSortBy] = useState<"unopened" | "newest" | "property">("unopened");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const properties = useMemo(() => Array.from(new Set(threads.map((thread) => thread.propertyName).filter(Boolean))).sort((a, b) => a.localeCompare(b, "en-GB", { sensitivity: "base" })), [threads]);
  const newCount = threads.filter((thread) => Boolean(waitingMessage(thread))).length;
  const respondedCount = threads.length - newCount;
  const visibleThreads = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = threads.filter((thread) => {
      const waiting = Boolean(waitingMessage(thread));
      if ((queue === "new") !== waiting) return false;
      if (propertyFilter !== "all" && thread.propertyName !== propertyFilter) return false;
      return !query ||
          [
            thread.guestName,
            thread.propertyName,
            thread.senderAddress,
            thread.subject,
            ...thread.messages.map((message) => message.body),
          ]
            .join(" ")
            .toLowerCase()
            .includes(query);
    });
    return [...filtered].sort((a, b) => {
      if (sortBy === "unopened" && a.unread !== b.unread) return Number(b.unread) - Number(a.unread);
      if (sortBy === "property") {
        return a.propertyName.localeCompare(b.propertyName, "en-GB", { sensitivity: "base" });
      }
      return latestThreadTime(b) - latestThreadTime(a);
    });
  }, [propertyFilter, queue, search, sortBy, threads]);
  const [selectedId, setSelectedId] = useState(threads[0]?.id ?? "");
  const selected = visibleThreads.find((thread) => thread.id === selectedId) ?? visibleThreads[0];
  const connected = data.integrations[details.connection];
  const [draft, setDraft] = useState("");
  const [reservation, setReservation] = useState<HostawayReservation | null>(null);
  const [reservationLoading, setReservationLoading] = useState(false);
  const markingRead = useRef(new Set<string>());

  useEffect(() => {
    if (source !== "guests" || !selected?.hostawayListingId) {
      setReservation(null);
      return;
    }
    let cancelled = false;
    setReservationLoading(true);
    void fetch(`/api/hostaway/reservations?listingId=${encodeURIComponent(selected.hostawayListingId)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((result: { reservations?: HostawayReservation[] }) => {
        if (cancelled) return;
        const match = result.reservations?.find((item) => item.id === selected.hostawayReservationId || item.bookingReference === bookingReference(selected));
        setReservation(match || null);
      })
      .catch(() => { if (!cancelled) setReservation(null); })
      .finally(() => { if (!cancelled) setReservationLoading(false); });
    return () => { cancelled = true; };
  }, [selected?.hostawayListingId, selected?.hostawayReservationId, selected?.id, source]);

  useEffect(() => {
    if (!selected?.unread || document.visibilityState !== "visible" || !document.hasFocus() || markingRead.current.has(selected.id)) return;
    markingRead.current.add(selected.id);
    void fetch("/api/communications/threads", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: selected.id, action: "read" }),
    }).then(async (response) => {
      const result = await response.json().catch(() => null) as { data?: CommunicationCentreData } | null;
      if (response.ok && result?.data) onData(result.data);
    }).finally(() => markingRead.current.delete(selected.id));
  }, [onData, selected]);

  if (threads.length === 0) {
    return (
      <ChannelEmptyState
        source={source}
        connected={connected}
        details={details}
      />
    );
  }

  return (
    <div className="surface grid overflow-hidden rounded-[1.6rem] border border-[#d5dfdc] bg-white xl:h-[40rem] xl:grid-cols-[20rem_minmax(0,1fr)_21rem]">
      <aside className="min-h-0 border-b border-[#dfe7e4] bg-[#f7f9f8] xl:border-r xl:border-b-0">
        <div className="space-y-3 border-b border-[#dfe7e4] p-4">
          <p className="text-sm font-semibold">{details.title}</p>
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-[#e7eeeb] p-1">
            <button className={`rounded-lg px-3 py-2 text-xs font-semibold ${queue === "new" ? "bg-[#1c3934] text-white" : "text-[#526b67]"}`} onClick={() => { setQueue("new"); setSelectedId(""); }}>New messages · {newCount}</button>
            <button className={`rounded-lg px-3 py-2 text-xs font-semibold ${queue === "responded" ? "bg-[#1c3934] text-white" : "text-[#526b67]"}`} onClick={() => { setQueue("responded"); setSelectedId(""); }}>Responded · {respondedCount}</button>
          </div>
          <p className="text-xs text-[#718184]">{threads.filter((thread) => thread.unread).length} unopened · {threads.length} conversations</p>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#718184]" />
            <Input
              aria-label="Search guest messages"
              className="h-10 bg-white pl-9"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search guest messages"
            />
          </div>
          <Select value={propertyFilter} onValueChange={setPropertyFilter}>
            <SelectTrigger aria-label="Filter messages by property" className="h-10 bg-white"><SelectValue placeholder="All properties" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All properties</SelectItem>{properties.map((property) => <SelectItem key={property} value={property}>{property}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(value) => setSortBy(value as "unopened" | "newest" | "property")}> 
            <SelectTrigger aria-label="Sort guest messages" className="h-10 bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unopened">Unopened first</SelectItem>
              <SelectItem value="newest">Newest message first</SelectItem>
              <SelectItem value="property">Property name A–Z</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="max-h-56 overflow-y-auto xl:max-h-[calc(40rem-13rem)]">
          {visibleThreads.map((thread) => (
            <ThreadListItem
              key={thread.id}
              thread={thread}
              source={source}
              active={selected?.id === thread.id}
              onClick={() => {
                setSelectedId(thread.id);
                setDraft("");
              }}
            />
          ))}
          {visibleThreads.length === 0 && (
            <p className="px-5 py-10 text-center text-sm text-[#718184]">{queue === "new" ? "No new messages need a response." : "No responded conversations match these filters."}</p>
          )}
        </div>
      </aside>

      {selected && (
        <>
          <ConversationPanel
            thread={selected}
            source={source}
            connected={connected}
            currentUser={currentUser}
            draft={draft}
            onDraftChange={setDraft}
            onData={onData}
            reservation={reservation}
            reservationLoading={reservationLoading}
          />
          <GuidancePanel
            thread={selected}
            workflows={data.workflows}
            onUseResponse={setDraft}
          />
        </>
      )}
    </div>
  );
}

function ChannelEmptyState({
  source,
  connected,
  details,
}: {
  source: CommunicationSource;
  connected: boolean;
  details: (typeof sourceDetails)[CommunicationSource];
}) {
  const Icon = details.icon;
  return (
    <section className="surface grid overflow-hidden rounded-[1.6rem] border border-[#d5dfdc] bg-white lg:grid-cols-[1.2fr_0.8fr]">
      <div className="p-7 sm:p-9">
        <div className="grid size-12 place-items-center rounded-2xl bg-[#eaf2ee] text-[#315f4d]">
          <Icon className="size-5" />
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-semibold tracking-[-0.035em]">{details.title}</h2>
          <ConnectionBadge label={connected ? "Connected" : "Awaiting connection"} connected={connected} />
        </div>
        <p className="mt-3 max-w-xl text-base leading-7 text-[#647577]">{details.description}</p>
        {connected && source === "guests" && (
          <p className="mt-3 text-sm leading-6 text-[#527261]">
            Hostaway is connected. New conversations will appear here automatically while this page is open.
          </p>
        )}
        <div className="mt-7 rounded-2xl bg-[#f4f7f5] p-5">
          <p className="text-sm font-semibold">Response timer</p>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <LegendDot tone="bg-[#78a84f]" label="Light green · under 5 min" />
            <LegendDot tone="bg-[#d39a2f]" label="Amber · 5+ min" />
            <LegendDot tone="bg-[#c24c4c]" label="Red · 10+ min" />
          </div>
        </div>
      </div>
      <div className="forest-panel border-t border-[#dfe7e4] bg-[#1c3934] p-7 text-white sm:p-9 lg:border-t-0 lg:border-l lg:border-white/10">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#8fb3a2]">Connection route</p>
        <h3 className="mt-4 text-xl font-semibold">{connectionTitle(source)}</h3>
        <p className="mt-3 text-sm leading-6 text-white/60">{connectionCopy(source)}</p>
        <div className="mt-7 flex items-center gap-2 text-sm font-semibold text-white/80">
          <ShieldCheck className="size-4 text-[#8fb3a2]" /> Secure, private workspace
        </div>
      </div>
    </section>
  );
}

function ThreadListItem({
  thread,
  source,
  active,
  onClick,
}: {
  thread: CommunicationThread;
  source: CommunicationSource;
  active: boolean;
  onClick: () => void;
}) {
  const waiting = waitingMessage(thread);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [waiting]);
  const elapsed = waiting ? Math.max(0, now - waiting.sentAt) : 0;
  const waitingTone = waiting
    ? elapsed >= 600
      ? "bg-[#fde8e8] hover:bg-[#f9dddd]"
      : elapsed >= 300
        ? "bg-[#fff2cf] hover:bg-[#f9e8b9]"
        : "bg-[#e9f7dc] hover:bg-[#ddf0cd]"
    : active
      ? "bg-white"
      : "hover:bg-white/70";
  return (
    <button
      className={`w-full border-b border-[#e4eae8] p-4 text-left transition-colors ${waitingTone} ${active ? "ring-1 ring-inset ring-[#9aafa8]" : ""}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2"><ChannelLogo thread={thread} source={source} /><p className={`truncate text-sm ${thread.unread ? "font-bold" : "font-semibold"}`}>{source === "email" ? thread.senderAddress : thread.guestName || "Guest"}</p>{thread.unread && <Badge className="shrink-0 border-0 bg-[#315f50] px-2 py-0.5 text-[0.65rem] font-bold text-white">NEW{thread.unreadCount > 1 ? ` · ${thread.unreadCount}` : ""}</Badge>}</div>
          <p className="mt-1 truncate text-xs font-medium text-[#5e7470]">{thread.propertyName || "Property not identified"}</p>
        </div>
        <div className="shrink-0 text-right"><p className="text-[0.68rem] font-medium text-[#718184]">{thread.messages.at(-1) ? formatListTimestamp(thread.messages.at(-1)!.sentAt) : ""}</p>{waiting && <div className="mt-1"><ResponseTimer message={waiting} source={source} compact /></div>}</div>
      </div>
      <p className="mt-3 line-clamp-2 text-xs leading-5 text-[#607174]">
        {messagePreview(thread.messages.at(-1))}
      </p>
      <div className="mt-3 flex items-center justify-between text-[0.7rem] text-[#819093]">
        <span>{thread.unread ? "Unopened" : "Opened"}</span>
        <ChevronRight className="size-3.5" />
      </div>
    </button>
  );
}

function ConversationPanel({
  thread,
  source,
  connected,
  currentUser,
  draft,
  onDraftChange,
  onData,
  reservation,
  reservationLoading,
}: {
  thread: CommunicationThread;
  source: CommunicationSource;
  connected: boolean;
  currentUser: CentreUser;
  draft: string;
  onDraftChange: (value: string) => void;
  onData: (data: CommunicationCentreData) => void;
  reservation: HostawayReservation | null;
  reservationLoading: boolean;
}) {
  const router = useRouter();
  const messageWindowRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [replyError, setReplyError] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [tidiedDraft, setTidiedDraft] = useState("");

  useEffect(() => {
    const messageWindow = messageWindowRef.current;
    if (messageWindow) messageWindow.scrollTop = messageWindow.scrollHeight;
  }, [thread.id, thread.messages.length]);

  async function act(action: "junk" | "close" | "reopen") {
    setSaving(true);
    const response = await fetch("/api/communications/threads", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: thread.id, action }),
    });
    setSaving(false);
    if (response.ok) router.refresh();
  }

  async function sendReply(bodyOverride?: string) {
    const body = (bodyOverride ?? draft).trim();
    if (!body || saving) return;
    setSaving(true);
    setReplyError("");
    try {
      const response = await fetch("/api/communications/hostaway/reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: thread.id, body }),
      });
      const result = (await response.json().catch(() => null)) as
        | { data?: CommunicationCentreData; error?: string }
        | null;
      if (!response.ok || !result?.data) {
        setReplyError(result?.error || "The reply could not be sent.");
        return;
      }
      onDraftChange("");
      setReviewOpen(false);
      onData(result.data);
    } catch {
      setReplyError("The reply could not be sent. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function reviewReply() {
    setTidiedDraft(tidyGuestReply(draft, thread.guestName));
    setReviewOpen(true);
  }

  return (
    <section className="flex h-[34rem] min-h-0 flex-col xl:h-full">
      <header className="border-b border-[#dfe7e4] px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2"><ChannelLogo thread={thread} source={source} large /><p className="font-semibold">{thread.guestName || thread.senderAddress || "Conversation"}</p></div>
            <p className="mt-1 text-sm font-medium text-[#526b67]">{thread.propertyName || "Property not identified"}</p>
            <details className="mt-3 rounded-xl border border-[#d8e2de] bg-[#f6f9f7] px-3 py-2 text-xs text-[#526b67]">
              <summary className="cursor-pointer font-semibold">Booking details</summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <BookingDetail label="Channel" value={communicationPlatform(thread, source)} />
                <BookingDetail label="Booking reference" value={bookingReference(thread) || "Not supplied"} />
                <BookingDetail label="Guest" value={thread.guestName || "Not supplied"} />
                <BookingDetail label="Guest email" value={thread.senderAddress || "Not supplied"} />
                <BookingDetail label="Phone number" value={reservationLoading ? "Loading…" : reservation?.guestPhone || "Not supplied"} />
                <BookingDetail label="Number of guests" value={reservationLoading ? "Loading…" : reservation?.guestCount ? String(reservation.guestCount) : "Not supplied"} />
                <BookingDetail label="Booking value" value={reservationLoading ? "Loading…" : reservation ? formatMoney(reservation.grossRevenuePence) : "Not supplied"} />
                <BookingDetail label="Stay dates" value={reservationLoading ? "Loading…" : reservation ? `${formatBookingDate(reservation.arrivalDate)} – ${formatBookingDate(reservation.departureDate)}` : "Not supplied"} />
                <BookingDetail label="Property" value={thread.propertyName || "Not identified"} />
                <BookingDetail label="Conversation" value={thread.status === "closed" ? "Closed" : "Open"} />
              </div>
              {(thread.hostawayReservationId || thread.hostawayListingId) && <div className="mt-3 flex flex-wrap gap-2">{thread.hostawayReservationId && <a href={`https://dashboard.hostaway.com/reservations/${encodeURIComponent(thread.hostawayReservationId)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-[#cfdbd7] bg-white px-3 py-1.5 font-semibold text-[#315f50]">Open full booking <ExternalLink className="size-3" /></a>}{thread.hostawayListingId && <a href={`https://dashboard.hostaway.com/listings/${encodeURIComponent(thread.hostawayListingId)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-[#cfdbd7] bg-white px-3 py-1.5 font-semibold text-[#315f50]">Open property <ExternalLink className="size-3" /></a>}</div>}
            </details>
          </div>
          <div className="flex flex-wrap gap-2">
            {source === "email" && (
              <Button size="sm" variant="outline" disabled={saving} onClick={() => act("junk")}>
                <Trash2 /> Junk
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={saving} onClick={() => act(thread.status === "closed" ? "reopen" : "close")}>
              <Check /> {thread.status === "closed" ? "Reopen" : "Close"}
            </Button>
          </div>
        </div>
      </header>

      <div
        ref={messageWindowRef}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-[#fbfcfb] p-5"
      >
        {thread.messages.map((message) => (
          <MessageBubble key={message.id} message={message} source={source} />
        ))}
      </div>

      <footer className="border-t border-[#dfe7e4] p-4">
        <Textarea
          disabled={!connected}
          rows={3}
          placeholder={connected ? "Write a reply…" : "Connect this channel to send replies."}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
        />
        {replyError && <p className="mt-2 text-sm font-medium text-red-700">{replyError}</p>}
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-[#718184]">
            Replies will be attributed to {currentUser.name}.
          </p>
          <Button
            disabled={!connected || !draft.trim() || saving}
            className="bg-[#1c3934] text-white"
            onClick={reviewReply}
          >
            Review reply <Sparkles />
          </Button>
        </div>
      </footer>
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="rounded-3xl border-[#d8e2de] sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>AI-tidied reply</DialogTitle>
            <DialogDescription>Spelling, grammar and tone have been improved without changing the meaning. You can edit it before sending.</DialogDescription>
          </DialogHeader>
          <Textarea rows={8} value={tidiedDraft} onChange={(event) => setTidiedDraft(event.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>Keep editing</Button>
            <Button disabled={saving || !tidiedDraft.trim()} className="bg-[#1c3934] text-white" onClick={() => void sendReply(tidiedDraft)}>{saving ? "Sending…" : "Send tidied reply"} <Send /></Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function MessageBubble({
  message,
  source,
}: {
  message: CommunicationMessage;
  source: CommunicationSource;
}) {
  const inbound = message.direction === "inbound";
  return (
    <div className={`flex ${inbound ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[82%] rounded-2xl px-4 py-3 ${inbound ? "border border-[#dfe7e4] bg-white" : "bg-[#1c3934] text-white"}`}>
        {message.body && <p className="break-words whitespace-pre-wrap text-sm leading-6">{message.body}</p>}
        {message.attachments.length > 0 && (
          <div className={`${message.body ? "mt-3" : ""} grid gap-2`}>
            {message.attachments.map((attachment, index) => <AttachmentPreview key={`${attachment.url}-${index}`} attachment={attachment} />)}
          </div>
        )}
        <div className={`mt-2 flex flex-wrap items-center gap-2 text-xs ${inbound ? "text-[#6e807d]" : "text-white/55"}`}>
          <span className="font-medium">{inbound ? "Received" : "Sent"} {formatTimestamp(message.sentAt)}</span>
          {inbound && <ResponseTimer message={message} source={source} />}
          {!inbound && message.respondedByName && <span>· {message.respondedByName}</span>}
          {!inbound && message.isAutomated && <span>· Automated</span>}
        </div>
      </div>
    </div>
  );
}

function AttachmentPreview({ attachment }: { attachment: CommunicationMessage["attachments"][number] }) {
  const type = attachment.contentType.toLowerCase();
  if (type.startsWith("image") || /\.(jpg|jpeg|png|gif|webp|heic)(\?|$)/i.test(attachment.url)) {
    return <a href={attachment.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-black/10 bg-black/5"><img src={attachment.url} alt={attachment.name || "Guest photo"} className="max-h-72 w-full object-contain" /></a>;
  }
  if (type.startsWith("video") || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(attachment.url)) {
    return <video controls preload="metadata" className="max-h-72 w-full rounded-xl border border-black/10 bg-black" src={attachment.url}>Your browser cannot play this guest video.</video>;
  }
  return <a href={attachment.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-[#cfdbd7] bg-white px-3 py-2 text-sm font-semibold text-[#315f50]">Open {attachment.name || "attachment"} <ExternalLink className="size-4" /></a>;
}

function ResponseTimer({
  message,
  source,
  compact = false,
}: {
  message: CommunicationMessage;
  source: CommunicationSource;
  compact?: boolean;
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (message.respondedAt) return;
    const timer = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [message.respondedAt]);

  const elapsed = Math.max(0, (message.respondedAt ?? now) - message.sentAt);
  const { amberSeconds, redSeconds } = sourceDetails[source];
  const tone =
    elapsed >= redSeconds
      ? "bg-[#fee8e8] text-[#9c3737]"
      : elapsed >= amberSeconds
        ? "bg-[#fff1ce] text-[#8a641c]"
        : "bg-[#e4f5d7] text-[#426529]";

  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-semibold ${tone} ${compact ? "px-2 py-1 text-[0.66rem]" : "px-2 py-1"}`}>
      <Clock3 className="size-3" /> {formatDuration(elapsed)}
    </span>
  );
}

function GuidancePanel({
  thread,
  workflows,
  onUseResponse,
}: {
  thread: CommunicationThread;
  workflows: CommunicationWorkflow[];
  onUseResponse: (response: string) => void;
}) {
  const workflow = useMemo(
    () => matchWorkflow(thread, workflows),
    [thread, workflows],
  );
  const latestInbound = [...thread.messages]
    .reverse()
    .find((message) => message.direction === "inbound");
  const replyNeeded = waitingMessage(thread);
  const responseContext = latestInbound?.body || thread.subject || `Message from ${thread.guestName || "guest"}`;
  const maintenance = detectMaintenanceCategory(responseContext);
  const directBooking = detectDirectBookingOpportunity(responseContext);
  const suggestedResponse = replyNeeded ? buildSuggestedResponse(thread, responseContext, workflow, maintenance) : "";
  const sentiment = guestSentiment(thread);
  const experienceSummary = summariseGuestExperience(thread);
  const travelReason = detectTravelReason(thread);
  const suggestedTargets: ReportTarget[] = [
    ...(maintenance ? ["ready" as const] : []),
    ...(workflow?.escalationTarget === "cleans" ? ["cleans" as const] : []),
    ...(directBooking ? ["direct" as const] : []),
  ];

  return (
    <aside className="max-h-[34rem] overflow-y-auto border-t border-[#dfe7e4] bg-[#f5f8f6] p-5 xl:max-h-none xl:border-t-0 xl:border-l">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="size-4 text-[#557c3a]" /> AI response assistant
      </div>
      <div className="mt-4 grid gap-2">
        <InsightCard label="Guest sentiment" value={sentiment.label} note={sentiment.note} tone={sentiment.tone} />
        <InsightCard label="Experience summary" value={experienceSummary} />
        <InsightCard label="Reason for travel" value={travelReason} />
      </div>
      {replyNeeded && suggestedTargets.length > 0 && (
        <ReportActions
          key={thread.id}
          thread={thread}
          message={replyNeeded}
          suggestedTargets={suggestedTargets}
        />
      )}
      {workflow ? (
        <div className="mt-4 space-y-4">
          <div className="surface rounded-2xl border border-[#dbe5df] bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold">{workflow.name}</p>
              {workflow.priority === "urgent" && (
                <Badge className="border-0 bg-[#fee8e8] text-[#9c3737]">Urgent</Badge>
              )}
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#5e7072]">{workflow.instructions}</p>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-[#cbd8d3] bg-white p-5">
          <p className="text-sm font-semibold">Common-sense response guidance</p>
          <p className="mt-2 text-xs leading-5 text-[#718184]">
            No exact SOP matched, so the suggestion uses the guest&apos;s message, context and Recharge&apos;s warm service tone.
          </p>
        </div>
      )}
      {replyNeeded ? <div className="forest-panel mt-4 rounded-2xl bg-[#1c3934] p-4 text-white"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8fb3a2]">Recommended response</p><Badge className="border-0 bg-white/10 text-white">Reply needed</Badge></div><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-white/80">{suggestedResponse}</p><p className="mt-3 text-xs leading-5 text-white/50">Based on the guest&apos;s latest unanswered message, the matched workflow and Recharge&apos;s warm service tone.</p><Button size="sm" className="mt-4 bg-white text-[#1c3934] hover:bg-white/90" onClick={() => onUseResponse(suggestedResponse)}>Use response</Button></div> : <div className="surface mt-4 rounded-2xl border border-[#cbd8d3] bg-white p-4"><div className="flex items-center gap-2 text-sm font-semibold text-[#315f50]"><Check className="size-4" /> Response sent</div><p className="mt-2 text-xs leading-5 text-[#718184]">No further reply is suggested. This conversation will return to New messages if the guest sends another message.</p></div>}
    </aside>
  );
}

function InsightCard({ label, value, note, tone = "neutral" }: { label: string; value: string; note?: string; tone?: "neutral" | "positive" | "warning" | "negative" }) {
  const toneClass = tone === "positive" ? "border-[#b8d2c6] bg-[#edf5f1]" : tone === "warning" ? "border-[#e7d19c] bg-[#fff8e7]" : tone === "negative" ? "border-[#e7b7b7] bg-[#fff1f1]" : "border-[#dbe5df] bg-white";
  return <div className={`rounded-2xl border p-4 ${toneClass}`}><p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-[#718184]">{label}</p><p className="mt-2 text-sm font-semibold leading-5 text-[#29443e]">{value}</p>{note && <p className="mt-1 text-xs leading-5 text-[#718184]">{note}</p>}</div>;
}

type ReportTarget = "ready" | "cleans" | "direct";

const reportActions: Array<{
  target: ReportTarget;
  label: string;
  destination: string;
  icon: typeof Wrench;
}> = [
  { target: "ready", label: "Approve maintenance ticket", destination: "Maintenance board", icon: Wrench },
  { target: "cleans", label: "Clean issue", destination: "Cleans", icon: SprayCan },
  { target: "direct", label: "Create direct booking ticket", destination: "Direct bookings", icon: Plus },
];

function ReportActions({
  thread,
  message,
  suggestedTargets,
}: {
  thread: CommunicationThread;
  message: CommunicationMessage;
  suggestedTargets: ReportTarget[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState<ReportTarget | null>(null);
  const [done, setDone] = useState<ReportTarget[]>([]);
  const [error, setError] = useState("");

  async function report(target: ReportTarget) {
    setSaving(target);
    setError("");
    try {
      const response = await fetch("/api/communications/escalate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          messageId: message.id,
          target,
        }),
      });
      const result = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        setError(result?.error || "The report could not be created.");
        return;
      }
      setDone((current) =>
        current.includes(target) ? current : [...current, target],
      );
      router.refresh();
    } catch {
      setError("The report could not be created. Please try again.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="surface mt-4 rounded-2xl border border-[#dbe5df] bg-white p-4">
      <p className="text-sm font-semibold">Action required</p>
      <p className="mt-1 text-xs leading-5 text-[#718184]">
        A possible issue was detected. Approve the ticket before it is added to the relevant board.
      </p>
      <div className="mt-3 space-y-2">
        {reportActions.filter((action) => suggestedTargets.includes(action.target)).map((action) => {
          const Icon = action.icon;
          const complete = done.includes(action.target);
          const isRecommended = suggestedTargets.includes(action.target);
          return (
            <Button
              key={action.target}
              variant="outline"
              className={`w-full justify-between ${isRecommended ? "border-[#86aa68] bg-[#f1f8e9]" : ""}`}
              disabled={saving !== null || complete}
              onClick={() => report(action.target)}
            >
              <span className="inline-flex items-center gap-2">
                {complete ? <Check /> : <Icon />}
                {complete ? (action.target === "ready" ? "Maintenance ticket created" : action.target === "direct" ? "Direct booking ticket created" : "Clean issue created") : action.label}
              </span>
              <span className="text-xs font-medium text-[#718184]">
                {isRecommended ? "Recommended" : action.destination}
              </span>
            </Button>
          );
        })}
      </div>
      {error && <p className="mt-3 text-xs font-medium text-red-700">{error}</p>}
    </div>
  );
}

function WorkflowWorkspace({
  data,
  currentUser,
}: {
  data: CommunicationCentreData;
  currentUser: CentreUser;
}) {
  const hostawayWorkflows = data.workflows.filter(
    (workflow) => workflow.channel === "all" || workflow.channel === "guests",
  );

  return (
    <div>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Response standards</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Typed workflows</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#647577]">
            Guidance is matched to incoming messages and shown beside the conversation.
          </p>
        </div>
        {currentUser.role === "admin" && <WorkflowDialog />}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {hostawayWorkflows.map((workflow) => (
          <WorkflowCard key={workflow.id} workflow={workflow} admin={currentUser.role === "admin"} />
        ))}
      </div>
      {hostawayWorkflows.length === 0 && (
        <div className="mt-6 rounded-[1.5rem] border border-dashed border-[#bdcbc7] bg-white p-10 text-center">
          <Sparkles className="mx-auto size-6 text-[#527261]" />
          <h3 className="mt-4 font-semibold">No workflows added yet</h3>
          <p className="mt-2 text-sm text-[#718184]">Admin users can type the first response workflow here.</p>
        </div>
      )}
    </div>
  );
}

function WorkflowDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [priority, setPriority] = useState<"standard" | "urgent">("standard");
  const [escalationTarget, setEscalationTarget] = useState<"none" | "ready" | "cleans">("none");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/communications/workflows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        channel: "guests",
        triggerText: form.get("triggerText"),
        instructions: form.get("instructions"),
        approvedResponse: form.get("approvedResponse"),
        escalationTarget,
        priority,
      }),
    });
    const result = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setError(result?.error || "The workflow could not be saved.");
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
        <Button className="h-11 rounded-xl bg-[#1c3934] px-5 text-white hover:bg-[#10271f]">
          <Plus /> Add workflow
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl border-[#d9e2df] p-0 sm:max-w-2xl">
        <form onSubmit={submit}>
          <DialogHeader className="border-b border-[#e2e9e7] px-6 py-6 text-left">
            <DialogTitle className="text-2xl tracking-[-0.035em]">Add response workflow</DialogTitle>
            <DialogDescription>Type the trigger, required steps and approved response wording.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5 px-6 py-6">
            <Field label="Workflow name"><Input name="name" required placeholder="No heating or hot water" /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Priority">
                <Select value={priority} onValueChange={(value) => setPriority(value as "standard" | "urgent")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="standard">Standard</SelectItem><SelectItem value="urgent">Urgent</SelectItem></SelectContent>
                </Select>
              </Field>
              <Field label="Escalation">
                <Select value={escalationTarget} onValueChange={(value) => setEscalationTarget(value as "none" | "ready" | "cleans")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">None</SelectItem><SelectItem value="ready">Ready</SelectItem><SelectItem value="cleans">Cleans</SelectItem></SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Trigger words or situations">
              <Textarea name="triggerText" required rows={3} placeholder="heating, boiler, no hot water, radiator" />
            </Field>
            <Field label="Instructions">
              <Textarea name="instructions" required rows={6} placeholder={"1. Acknowledge the guest\n2. Check the property notes\n3. Provide the approved troubleshooting\n4. Escalate if unresolved"} />
            </Field>
            <Field label="Approved response (optional)">
              <Textarea name="approvedResponse" rows={5} placeholder="Hello {{guest_name}}, thank you for letting us know…" />
            </Field>
            {error && <p className="text-sm font-medium text-red-700">{error}</p>}
          </div>
          <DialogFooter className="border-t border-[#e2e9e7] px-6 py-5">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={saving} className="bg-[#1c3934] text-white hover:bg-[#10271f]">{saving ? "Saving…" : "Save workflow"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WorkflowCard({ workflow, admin }: { workflow: CommunicationWorkflow; admin: boolean }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  async function toggle() {
    setSaving(true);
    const response = await fetch("/api/communications/workflows", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: workflow.id, status: workflow.status === "active" ? "inactive" : "active" }),
    });
    setSaving(false);
    if (response.ok) router.refresh();
  }
  return (
    <article className="surface rounded-[1.4rem] border border-[#d9e2df] bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{workflow.name}</h3>
            {workflow.priority === "urgent" && <Badge className="border-0 bg-[#fee8e8] text-[#9c3737]">Urgent</Badge>}
          </div>
          <p className="mt-1 text-xs font-medium uppercase tracking-[0.1em] text-[#819093]">Hostaway guests</p>
        </div>
        <Badge className={workflow.status === "active" ? "border-0 bg-[#e8f7d6] text-[#36561d]" : "border-0 bg-[#eef1f0] text-[#667977]"}>{workflow.status}</Badge>
      </div>
      <p className="mt-4 text-xs leading-5 text-[#718184]">Triggers: {workflow.triggerText}</p>
      <p className="mt-4 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-[#526568]">{workflow.instructions}</p>
      <div className="mt-5 flex items-center justify-between border-t border-[#e6ecea] pt-4">
        <span className="text-xs text-[#819093]">Updated {formatDate(workflow.updatedAt)}</span>
        {admin && <Button size="sm" variant="ghost" disabled={saving} onClick={toggle}>{workflow.status === "active" ? "Pause" : "Activate"}</Button>}
      </div>
    </article>
  );
}

function PerformanceWorkspace({ data }: { data: CommunicationCentreData }) {
  const guestThreads = data.threads.filter((thread) => thread.source === "guests");
  const inbound = guestThreads.flatMap((thread) => thread.messages.filter((message) => message.direction === "inbound"));
  const answered = inbound.filter((message) => message.respondedAt);
  const responseSeconds = answered.map((message) => Math.max(0, (message.respondedAt || message.sentAt) - message.sentAt));
  const average = responseSeconds.length ? responseSeconds.reduce((sum, value) => sum + value, 0) / responseSeconds.length : 0;
  const green = responseSeconds.filter((seconds) => seconds < 300).length;
  const amber = responseSeconds.filter((seconds) => seconds >= 300 && seconds < 600).length;
  const red = responseSeconds.filter((seconds) => seconds >= 600).length;
  const overThirtyMinutes = responseSeconds.filter((seconds) => seconds > 1800).length;
  const overOneHour = responseSeconds.filter((seconds) => seconds > 3600).length;
  const team = new Map<string, { responses: number; seconds: number }>();
  for (const message of answered) {
    const name = message.respondedByName || "Unattributed";
    const current = team.get(name) || { responses: 0, seconds: 0 };
    current.responses += 1;
    current.seconds += Math.max(0, (message.respondedAt || message.sentAt) - message.sentAt);
    team.set(name, current);
  }

  return (
    <div>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CentreStat label="Average response" value={formatDuration(Math.round(average))} note="Across Hostaway messages" />
        <CentreStat label="Green responses" value={String(green)} note="Answered within 5 minutes" tone="green" />
        <CentreStat label="Amber responses" value={String(amber)} note="Answered within 5–10 minutes" tone="amber" />
        <CentreStat label="Red responses" value={String(red)} note="Answered after 10 minutes" tone="red" />
      </section>
      <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CentreStat label="Messages answered" value={String(answered.length)} note="Hostaway replies recorded" />
        <CentreStat label="Open conversations" value={String(guestThreads.filter((thread) => thread.status === "open").length)} note="Hostaway guest threads" />
        <CentreStat label="Over 30 minutes" value={String(overThirtyMinutes)} note="Responses taking more than 30 minutes" tone="amber" alert={overThirtyMinutes > 0} />
        <CentreStat label="Over 1 hour" value={String(overOneHour)} note="Responses taking more than 60 minutes" tone="red" alert={overOneHour > 0} />
      </section>
      <section className="surface mt-5 overflow-hidden rounded-[1.5rem] border border-[#d9e2df] bg-white">
        <div className="grid grid-cols-[1fr_auto_auto] gap-4 border-b border-[#e2e9e7] bg-[#f6f8f7] px-5 py-4 text-xs font-semibold uppercase tracking-[0.1em] text-[#718184]">
          <span>Team member</span><span>Responses</span><span>Average</span>
        </div>
        {[...team.entries()].map(([name, result]) => (
          <div key={name} className="grid grid-cols-[1fr_auto_auto] gap-6 border-b border-[#e6ecea] px-5 py-4 last:border-0">
            <span className="text-sm font-semibold">{name}</span>
            <span className="text-sm text-[#647577]">{result.responses}</span>
            <span className="text-sm font-semibold">{formatDuration(Math.round(result.seconds / result.responses))}</span>
          </div>
        ))}
        {team.size === 0 && <p className="px-5 py-10 text-center text-sm text-[#718184]">Performance will populate as team members respond through Recharge.</p>}
      </section>
      <section className="surface mt-5 overflow-hidden rounded-[1.5rem] border border-[#d9e2df] bg-white">
        <div className="border-b border-[#e2e9e7] bg-[#f6f8f7] px-5 py-4">
          <p className="text-sm font-semibold">Scheduled communication cover</p>
          <p className="mt-1 text-xs text-[#718184]">The next seven days from My Recharge. Response ownership is measured against the staff rota.</p>
        </div>
        {data.schedule.map((shift) => (
          <div key={shift.id} className="grid gap-2 border-b border-[#e6ecea] px-5 py-4 last:border-0 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-6">
            <span className="text-sm font-semibold">{shift.name}</span>
            <span className="text-sm text-[#647577]">{formatScheduleDate(shift.shiftDate)}</span>
            <span className="text-sm font-semibold">{shift.startTime}–{shift.endTime}</span>
          </div>
        ))}
        {data.schedule.length === 0 && (
          <p className="px-5 py-8 text-center text-sm text-[#718184]">No communication shifts are scheduled in the next seven days.</p>
        )}
      </section>
    </div>
  );
}

function CentreStat({ label, value, note, alert = false, tone = "neutral" }: { label: string; value: string; note: string; alert?: boolean; tone?: "neutral" | "green" | "amber" | "red" }) {
  const toneClass = tone === "green" ? "border-[#bdd9a9] bg-[#eef8e6]" : tone === "amber" ? "border-[#ead39b] bg-[#fff7df]" : tone === "red" ? "border-[#ebbbbb] bg-[#fff0f0]" : "border-[#d9e2df] bg-white";
  return (
    <article className={`rounded-[1.4rem] border p-5 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#718184]">{label}</p>
        {alert && <AlertTriangle className="size-4 text-[#ba7b26]" />}
      </div>
      <p className="mt-6 text-4xl font-semibold tracking-[-0.05em]">{value}</p>
      <p className="mt-2 text-xs text-[#819093]">{note}</p>
    </article>
  );
}

function ConnectionBadge({ label, connected }: { label: string; connected: boolean }) {
  return (
    <Badge variant="outline" className={`gap-2 px-3 py-1.5 ${connected ? "border-[#bfd6ae] bg-[#eef8e5] text-[#426529]" : "border-[#d5dfdc] bg-white text-[#667977]"}`}>
      <span className={`size-1.5 rounded-full ${connected ? "bg-[#68a23f]" : "bg-[#a7b2af]"}`} />
      {label}
    </Badge>
  );
}

function LegendDot({ tone, label }: { tone: string; label: string }) {
  return <span className="inline-flex items-center gap-2"><span className={`size-2 rounded-full ${tone}`} />{label}</span>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>;
}

function waitingMessage(thread: CommunicationThread) {
  return [...thread.messages]
    .reverse()
    .find((message) => message.direction === "inbound" && !message.respondedAt);
}

function messagePreview(message?: CommunicationMessage) {
  if (!message) return "No message preview";
  if (message.body.trim()) return message.body;
  if (message.attachments.some((item) => item.contentType.toLowerCase().startsWith("image") || /\.(jpe?g|png|gif|webp|heic)(\?|$)/i.test(item.url))) return "Photo";
  if (message.attachments.some((item) => item.contentType.toLowerCase().startsWith("video") || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(item.url))) return "Video";
  return message.attachments.length ? "Attachment" : "No message preview";
}

function tidyGuestReply(value: string, guestName: string) {
  const guest = guestName.trim().split(/\s+/)[0] || "there";
  let body = value
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+([,.!?])/g, "$1");

  if (!/^(hi|hello|good (morning|afternoon|evening))\b/i.test(body)) {
    body = `Hi ${guest},\n\n${body}`;
  }

  const lines = body.split("\n");
  const lastContentIndex = lines.findLastIndex((line) => Boolean(line.trim()));
  if (lastContentIndex >= 0) {
    const line = lines[lastContentIndex].trim();
    if (!/[.!?]$/.test(line) && !/^(kind regards|many thanks|best wishes|thanks)$/i.test(line)) {
      lines[lastContentIndex] = `${line}.`;
    }
  }
  body = lines.join("\n");

  if (!/(kind regards|many thanks|best wishes|recharge stays)\s*[,.!]*$/i.test(body)) {
    body = `${body}\n\nKind regards,\nRecharge Stays`;
  }
  return body;
}

function matchWorkflow(thread: CommunicationThread, workflows: CommunicationWorkflow[]) {
  const text = [...thread.messages].reverse().find((message) => message.direction === "inbound")?.body.toLowerCase() || "";
  return workflows.find((workflow) => {
    if (workflow.status !== "active") return false;
    if (workflow.channel !== "all" && workflow.channel !== thread.source) return false;
    const triggers = workflow.triggerText.split(/[,\n]/).map((item) => item.trim().toLowerCase()).filter(Boolean);
    return triggers.some((trigger) => text.includes(trigger));
  });
}

function guestSentiment(thread: CommunicationThread): { label: string; note: string; tone: "neutral" | "positive" | "warning" | "negative" } {
  const inbound = thread.messages.filter((message) => message.direction === "inbound").slice(-4).map((message) => message.body.toLowerCase()).join(" ");
  if (/danger|unsafe|emergency|furious|disgusting|unacceptable|worst|refund|complaint|very disappointed/.test(inbound)) return { label: "Negative · urgent attention", note: "Acknowledge the impact before giving the next action.", tone: "negative" };
  if (/annoyed|frustrated|disappointed|not happy|still not|again|problem|issue|broken|not working|no hot water|no heating/.test(inbound)) return { label: "Concerned or frustrated", note: "Respond with empathy, ownership and a clear timescale.", tone: "warning" };
  if (/thank you|thanks|lovely|great|perfect|amazing|wonderful|enjoying|happy/.test(inbound)) return { label: "Positive", note: "Keep the reply warm and concise.", tone: "positive" };
  return { label: "Neutral", note: "The guest appears to be asking for information or confirmation.", tone: "neutral" };
}

function summariseGuestExperience(thread: CommunicationThread) {
  const inbound = thread.messages.filter((message) => message.direction === "inbound" && message.body.trim()).slice(-3).map((message) => message.body.trim());
  if (!inbound.length) return thread.messages.some((message) => message.attachments.length) ? "The guest has shared media without a written description." : "No written guest experience has been recorded yet.";
  const summary = inbound.join(" · ").replace(/\s+/g, " ");
  return summary.length > 220 ? `${summary.slice(0, 217).trim()}…` : summary;
}

function detectTravelReason(thread: CommunicationThread) {
  const text = thread.messages.filter((message) => message.direction === "inbound").map((message) => message.body).join(" ").toLowerCase();
  if (/contractor|contracting|project|job|work trip|working nearby|working in|colleague|engineer|crew|business/.test(text)) return "Work or contractor stay";
  if (/wedding|funeral|graduation|concert|festival|event/.test(text)) return "Attending a local event";
  if (/hospital|appointment|treatment|medical|clinic/.test(text)) return "Medical appointment or treatment";
  if (/family|visit(?:ing)? (?:my|our) (?:family|parents|children)|seeing relatives/.test(text)) return "Visiting family or relatives";
  if (/university|college|student|course|study/.test(text)) return "Study or university";
  if (/holiday|vacation|break|tour|sightseeing|getaway/.test(text)) return "Holiday or leisure";
  if (/moving|relocat|between homes|insurance stay|temporary accommodation/.test(text)) return "Relocation or temporary accommodation";
  return "Not yet identified from the conversation";
}

function detectDirectBookingOpportunity(message: string) {
  return /book direct|direct booking|extend(?:ing)? (?:our|my|the) stay|stay longer|long[- ]term|monthly stay|weekly stay|better rate|company booking|contractor accommodation|repeat booking/.test(message.toLowerCase());
}

function detectMaintenanceCategory(message: string): MaintenanceCategory | null {
  const text = message.toLowerCase();
  if (/gas smell|sparks?|smoke|exposed wire|unsafe|fire|carbon monoxide|co alarm/.test(text)) return "Safety";
  if (/boiler|heating|radiator|hot water|thermostat|shower.*cold/.test(text)) return "Heating & hot water";
  if (/leak|toilet|tap|sink|drain|blocked|plumb|water.*floor/.test(text)) return "Plumbing";
  if (/power|electric|socket|fuse|breaker|light.*not work|no electricity/.test(text)) return "Electrical";
  if (/lock|key|door|cannot get in|can['’]?t get in|access/.test(text)) return "Access & locks";
  if (/washing machine|dishwasher|oven|fridge|microwave|hob|appliance|wifi|wi-fi|television|\btv\b/.test(text)) return "Appliances";
  if (/bed|chair|sofa|table|blind|curtain|furniture|fitting|loose/.test(text)) return "Furniture & fittings";
  if (/mould|damp|wall|ceiling|paint|plaster|stain/.test(text)) return "Decorating";
  if (/mouse|mice|rat|insect|bug|flies|pest/.test(text)) return "Pest control";
  if (/broken|not working|fault|damage|repair/.test(text)) return "General repair";
  return null;
}

function buildSuggestedResponse(
  thread: CommunicationThread,
  message: string,
  workflow: CommunicationWorkflow | undefined,
  maintenance: MaintenanceCategory | null,
) {
  const guest = thread.guestName?.split(" ")[0] || "there";
  if (workflow?.approvedResponse) {
    return workflow.approvedResponse
      .replaceAll("{{guest_name}}", guest)
      .replaceAll("{{property_name}}", thread.propertyName || "the property");
  }
  if (maintenance) {
    const steps = MAINTENANCE_CHECKLISTS[maintenance].slice(0, 2).map((item) => item.label.replace(/\.$/, "").toLowerCase());
    const urgent = maintenance === "Safety";
    return `Hi ${guest},\n\nThank you for letting us know, and I’m sorry you’re having this issue. ${urgent ? "Please stop using the affected area or item and let us know immediately if anyone is at risk. " : "We’ll help get this checked as quickly as possible. "}Could you please ${steps.join(", and then ")}?\n\nOnce we have that information, we’ll confirm the next step and keep you updated.`;
  }
  const text = message.toLowerCase();
  const hasQuestion = message.includes("?") || /\b(can|could|would|will|do|does|did|is|are|when|where|what|how|why)\b/i.test(message);
  const isThankYou = /\b(thank you|thanks|many thanks|cheers|much appreciated|appreciate it)\b/i.test(message);
  const isLookingForward = /\b(looking forward|can(?:not|'t|’t) wait|excited (?:for|about)|see you (?:soon|then))\b/i.test(message);
  const isShortConfirmation = /^\s*(ok(?:ay)?|got it|perfect|sounds good|great|all good|understood|that'?s fine|no problem)(?:[\s!.😊👍]*)$/i.test(message);

  if (isThankYou && isLookingForward && !hasQuestion) {
    return `Hi ${guest},\n\nYou’re very welcome! We’re looking forward to hosting you too. If you need anything before your stay, just let us know.`;
  }
  if (isLookingForward && !hasQuestion) {
    return `Hi ${guest},\n\nWe’re looking forward to hosting you too! If there’s anything you need before your stay, just let us know.`;
  }
  if (isThankYou && !hasQuestion) {
    return `Hi ${guest},\n\nYou’re very welcome! If there’s anything else you need, just let us know.`;
  }
  if (isShortConfirmation) {
    return `Hi ${guest},\n\nPerfect, thanks for confirming. If anything else comes up before your stay, we’re here to help.`;
  }
  if (/check.?in|arrival|access instructions/.test(text)) return `Hi ${guest},\n\nThanks for getting in touch. We’ll check your booking and make sure you have the correct arrival and access information. We’ll come back to you shortly with everything you need.`;
  if (/early check|late check.?out/.test(text)) return `Hi ${guest},\n\nThanks for asking. We’ll check the cleaning schedule and availability for you. We can’t promise this just yet, but we’ll let you know as soon as it has been confirmed.`;
  if (detectDirectBookingOpportunity(message)) return `Hi ${guest},\n\nThanks for getting in touch. We’d be happy to check the availability and the best direct rate for your stay. We’ll review the dates and booking details, then come back to you with the available option.`;
  if (/parking|park the car/.test(text)) return `Hi ${guest},\n\nThanks for getting in touch. We’ll check the parking information for the property and come back to you shortly with the best available option.`;
  if (hasQuestion) return `Hi ${guest},\n\nThanks for your message. Let me check this for you and I’ll come back to you shortly with a clear answer.`;
  return `Hi ${guest},\n\nThanks for letting us know. We’ve made a note of this, and if there’s anything else you need, just let us know.`;
}

function connectionTitle(source: CommunicationSource) {
  if (source === "guests") return "Hostaway live message feed";
  if (source === "email") return "Fasthosts two-way mail bridge";
  return "Meta WhatsApp coexistence";
}

function connectionCopy(source: CommunicationSource) {
  if (source === "guests") return "Add the Hostaway account credentials and secure message receiver to begin syncing guest conversations.";
  if (source === "email") return "Fasthosts uses IMAP and SMTP, so a secure bridge will receive, send and attribute mailbox activity.";
  return "Connect the existing WhatsApp Business number through Meta after confirming coexistence eligibility.";
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remaining = safe % 60;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp * 1000));
}

function formatListTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp * 1000));
}

function formatMoney(pence: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);
}

function formatBookingDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date) : value;
}

function latestThreadTime(thread: CommunicationThread) {
  return thread.messages.at(-1)?.sentAt ?? thread.lastInboundAt ?? thread.lastOutboundAt ?? 0;
}

function communicationPlatform(thread: CommunicationThread, source: CommunicationSource) {
  if (source === "email") return "Email";
  if (source === "whatsapp") return "WhatsApp";
  const value = thread.subject.split("·")[0]?.trim().toLowerCase() || "";
  if (value.includes("airbnb")) return "Airbnb";
  if (value.includes("booking")) return "Booking.com";
  return "Recharge Direct";
}

function bookingReference(thread: CommunicationThread) {
  const match = thread.subject.match(/booking\s+([^·]+)/i);
  return match?.[1]?.trim() || thread.hostawayReservationId;
}

function ChannelLogo({ thread, source, large = false }: { thread: CommunicationThread; source: CommunicationSource; large?: boolean }) {
  const platform = communicationPlatform(thread, source);
  const size = large ? "size-8" : "size-6";
  if (platform === "Recharge Direct") {
    return <span className={`grid ${size} shrink-0 place-items-center overflow-hidden rounded-lg bg-[#1c3934]`} title="Recharge Direct"><img src="/favicon.svg" alt="Recharge" className="size-full object-cover" /></span>;
  }
  if (platform === "Airbnb") return <span className={`grid ${size} shrink-0 place-items-center rounded-full bg-[#ff5a5f] text-[0.65rem] font-black text-white`} title="Airbnb">A</span>;
  if (platform === "Booking.com") return <span className={`grid ${size} shrink-0 place-items-center rounded-full bg-[#003580] text-[0.65rem] font-black text-white`} title="Booking.com">B.</span>;
  return <span className={`grid ${size} shrink-0 place-items-center rounded-full bg-[#315f50] text-[0.6rem] font-bold text-white`}>{platform.slice(0, 1)}</span>;
}

function BookingDetail({ label, value }: { label: string; value: string }) {
  return <div><span className="block text-[#81908d]">{label}</span><strong className="mt-0.5 block break-words text-[#29443e]">{value}</strong></div>;
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(timestamp * 1000));
}

function formatScheduleDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${value}T12:00:00Z`));
}

function unavailableData(): CommunicationCentreData {
  return {
    available: false,
    integrations: { hostaway: false, email: false, whatsapp: false, bonline: false },
    workflows: [],
    threads: [],
    calls: [],
    schedule: [],
  };
}
