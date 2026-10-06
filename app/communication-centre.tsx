"use client";

import {
  FormEvent,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  ExternalLink,
  Hash,
  Inbox,
  LoaderCircle,
  Mail,
  MessageCircle,
  MessagesSquare,
  Pause,
  Play,
  PlugZap,
  Plus,
  PoundSterling,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  SprayCan,
  Trash2,
  Users,
  Wrench,
  X,
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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

type CentreTabValue = CommunicationSource | "workflows" | "performance";
type SortMode = "waiting" | "unopened" | "newest" | "property";
type Tone = "green" | "amber" | "red";

const sourceDetails: Record<
  CommunicationSource,
  {
    title: string;
    label: string;
    description: string;
    icon: typeof Inbox;
    connection: keyof CommunicationCentreData["integrations"];
    amberSeconds: number;
    redSeconds: number;
  }
> = {
  guests: {
    title: "Guest inbox",
    label: "Hostaway",
    description: "All guest conversations received through Hostaway.",
    icon: MessagesSquare,
    connection: "hostaway",
    amberSeconds: 300,
    redSeconds: 600,
  },
  email: {
    title: "Email inbox",
    label: "Email",
    description: "Fasthosts mailboxes, subjects, ownership and response times.",
    icon: Mail,
    connection: "email",
    amberSeconds: 300,
    redSeconds: 600,
  },
  whatsapp: {
    title: "WhatsApp inbox",
    label: "WhatsApp",
    description: "Direct WhatsApp Business conversations kept separate from Hostaway.",
    icon: MessageCircle,
    connection: "whatsapp",
    amberSeconds: 300,
    redSeconds: 600,
  },
};

const toneStyles: Record<Tone, { pill: string; rail: string; dot: string; onDark: string }> = {
  green: {
    pill: "bg-[#e6f2dc] text-[#3f6327]",
    rail: "bg-[#7cb356]",
    dot: "bg-[#6aa441]",
    onDark: "text-[#c9e7a4]",
  },
  amber: {
    pill: "bg-[#fbefcf] text-[#86601a]",
    rail: "bg-[#dca23a]",
    dot: "bg-[#d39a2f]",
    onDark: "text-[#f3d08a]",
  },
  red: {
    pill: "bg-[#fbe4e2] text-[#9c3737]",
    rail: "bg-[#cf5b55]",
    dot: "bg-[#c24c4c]",
    onDark: "text-[#f4aaa4]",
  },
};

const avatarTones = [
  "bg-[#dfe9e4] text-[#24473f]",
  "bg-[#e7eedd] text-[#4a6230]",
  "bg-[#e3ece8] text-[#315f50]",
  "bg-[#efe9de] text-[#6b5531]",
  "bg-[#1c3934] text-[#c9e7a4]",
];

/* ───────────────────────── Shared hooks ───────────────────────── */

function useNow(enabled = true, interval = 1000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), interval);
    return () => window.clearInterval(timer);
  }, [enabled, interval]);
  return now;
}

function useMediaQuery(query: string, serverValue = true) {
  const subscribe = useCallback(
    (callback: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", callback);
      return () => media.removeEventListener("change", callback);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

function waitTone(elapsed: number, source: CommunicationSource): Tone {
  const { amberSeconds, redSeconds } = sourceDetails[source];
  return elapsed >= redSeconds ? "red" : elapsed >= amberSeconds ? "amber" : "green";
}


/* ───────────────────────── Centre ───────────────────────── */

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
  const [tab, setTab] = useState<CentreTabValue>("guests");

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
  const waitingBySource = (source: CommunicationSource) =>
    safeData.threads.filter(
      (thread) => thread.source === source && Boolean(waitingMessage(thread)),
    ).length;
  const guestThreads = safeData.threads.filter((thread) => thread.source === "guests");
  const waitingSentAt = guestThreads
    .map((thread) => waitingMessage(thread)?.sentAt)
    .filter((value): value is number => typeof value === "number");
  const oldestWaiting = waitingSentAt.length ? Math.min(...waitingSentAt) : null;
  const now = useNow(oldestWaiting !== null);
  const longestWait = oldestWaiting !== null ? Math.max(0, now - oldestWaiting) : 0;
  const averageResponse = averageResponseSeconds(guestThreads);
  const activeWorkflows = safeData.workflows.filter(
    (workflow) =>
      workflow.status === "active" &&
      (workflow.channel === "all" || workflow.channel === "guests"),
  ).length;

  return (
    <div>
      <button
        className="press group mb-4 inline-flex items-center gap-2 rounded-full py-1 pr-3 text-sm font-semibold text-[#4f6966] transition-colors hover:text-[#1c3934]"
        onClick={onBack}
      >
        <ArrowLeft className="size-4 transition-transform duration-300 group-hover:-translate-x-0.5" /> Stays
      </button>

      <section className="forest-panel overflow-hidden rounded-[1.75rem] px-5 py-6 shadow-[0_30px_70px_-34px_rgba(16,39,31,0.6)] sm:rounded-[2rem] sm:px-8 sm:py-8">
        <span className="orb -right-16 -top-24 size-72 bg-[#8fb3a2]/30" aria-hidden="true" />
        <span
          className="orb -bottom-28 left-1/4 size-64 bg-[#c9e7a4]/12"
          style={{ animationDelay: "-9s", animationDuration: "26s" }}
          aria-hidden="true"
        />
        <div className="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#8fb3a2]">
                Recharge Stays
              </p>
              <SyncPill state={syncState} connected={safeData.integrations.hostaway} />
            </div>
            <h1 className="mt-4 text-[2.4rem] font-semibold leading-[0.98] tracking-[-0.05em] sm:text-[3.4rem]">
              Communication{" "}
              <span className="font-display text-[#c9e7a4]">Centre</span>
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/60 sm:text-[0.95rem] sm:leading-7">
              Live guest messages, assisted replies and clear response accountability.
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-2 sm:gap-3 lg:min-w-[27rem]">
            <PulseStat
              label="Waiting"
              value={String(waitingSentAt.length)}
              live={waitingSentAt.length > 0}
            />
            <PulseStat
              label="Longest wait"
              value={oldestWaiting !== null ? formatDuration(longestWait) : "—"}
              tone={oldestWaiting !== null ? waitTone(longestWait, "guests") : undefined}
            />
            <PulseStat
              label="Avg reply"
              value={averageResponse === null ? "—" : formatDuration(averageResponse)}
              tone={averageResponse === null ? undefined : waitTone(averageResponse, "guests")}
            />
          </dl>
        </div>
      </section>

      {syncMessage && (
        <Notice tone="amber" icon={AlertTriangle}>
          {syncMessage}
        </Notice>
      )}

      {!safeData.available && (
        <Notice tone="amber" icon={PlugZap}>
          The Communication Centre is ready, but its live connections still need to be authorised. Typed workflows are available after the new workspace database finishes activating.
        </Notice>
      )}

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as CentreTabValue)}
        className="mt-6"
      >
        <TabsList className="scrollbar-none h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl border-[#dbe4e0] bg-white/75 p-1.5 shadow-[var(--shadow-soft)] backdrop-blur sm:w-fit">
          <CentreTab value="guests" icon={MessagesSquare} label="Guests" count={waitingBySource("guests")} />
          <CentreTab value="whatsapp" icon={MessageCircle} label="WhatsApp" count={waitingBySource("whatsapp")} />
          <CentreTab value="email" icon={Mail} label="Email" count={waitingBySource("email")} />
          <CentreTab value="workflows" icon={Sparkles} label="Workflows" count={activeWorkflows} muted />
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

function SyncPill({
  state,
  connected,
}: {
  state: "idle" | "syncing" | "live" | "error";
  connected: boolean;
}) {
  const content = !connected
    ? { label: "Hostaway offline", className: "border-white/10 bg-white/5 text-white/55", icon: <span className="size-1.5 rounded-full bg-white/35" /> }
    : state === "error"
      ? { label: "Needs attention", className: "border-[#f3d08a]/30 bg-[#f3d08a]/10 text-[#f3d08a]", icon: <AlertTriangle className="size-3" /> }
      : state === "live"
        ? { label: "Hostaway live", className: "border-[#c9e7a4]/25 bg-[#c9e7a4]/10 text-[#c9e7a4]", icon: <span className="live-dot" /> }
        : { label: "Syncing", className: "border-white/15 bg-white/5 text-white/70", icon: <LoaderCircle className="size-3 animate-spin" /> };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold backdrop-blur ${content.className}`}
      role="status"
    >
      {content.icon}
      {content.label}
    </span>
  );
}

function PulseStat({
  label,
  value,
  tone,
  live = false,
}: {
  label: string;
  value: string;
  tone?: Tone;
  live?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-3 backdrop-blur sm:px-4 sm:py-4">
      <dt className="flex items-center gap-1.5 truncate text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-white/45">
        {live && <span className="live-dot" aria-hidden="true" />}
        {label}
      </dt>
      <dd
        className={`mt-2 truncate text-xl font-semibold tabular-nums tracking-[-0.04em] sm:text-[1.75rem] ${tone ? toneStyles[tone].onDark : "text-white"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function Notice({
  tone,
  icon: Icon,
  children,
}: {
  tone: "amber";
  icon: typeof Inbox;
  children: ReactNode;
}) {
  return (
    <div
      className={`animate-rise mt-5 flex items-start gap-3 rounded-2xl border px-4 py-3.5 text-sm leading-6 ${tone === "amber" ? "border-[#ead8a5] bg-[#fffaec] text-[#765e22]" : ""}`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <p>{children}</p>
    </div>
  );
}

function CentreTab({
  value,
  icon: Icon,
  label,
  count,
  muted = false,
}: {
  value: string;
  icon: typeof Inbox;
  label: string;
  count?: number;
  muted?: boolean;
}) {
  return (
    <TabsTrigger
      value={value}
      className="min-h-10 shrink-0 gap-2 rounded-xl px-4 data-[state=active]:bg-[#1c3934] data-[state=active]:text-white"
    >
      <Icon className="size-4" /> {label}
      {count !== undefined && count > 0 && (
        <span
          className={`grid min-w-5 place-items-center rounded-full px-1.5 py-px text-[0.65rem] font-bold tabular-nums transition-colors ${muted ? "bg-[#1c3934]/8 text-[#526b67] in-data-[state=active]:bg-white/15 in-data-[state=active]:text-white" : "bg-[#c24c4c] text-white in-data-[state=active]:bg-[#c9e7a4] in-data-[state=active]:text-[#1c3934]"}`}
        >
          {count}
        </span>
      )}
    </TabsTrigger>
  );
}


/* ───────────────────────── Inbox ───────────────────────── */

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
  const [sortBy, setSortBy] = useState<SortMode>("waiting");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const properties = useMemo(() => Array.from(new Set(threads.map((thread) => thread.propertyName).filter(Boolean))).sort((a, b) => a.localeCompare(b, "en-GB", { sensitivity: "base" })), [threads]);
  const newCount = threads.filter((thread) => Boolean(waitingMessage(thread))).length;
  const respondedCount = threads.length - newCount;
  const unopenedCount = threads.filter((thread) => thread.unread).length;
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
      if (sortBy === "waiting") {
        const waitingA = waitingMessage(a)?.sentAt ?? Infinity;
        const waitingB = waitingMessage(b)?.sentAt ?? Infinity;
        if (waitingA !== waitingB) return waitingA - waitingB;
      }
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
  const [reservationState, setReservationState] = useState<{ key: string; reservation: HostawayReservation | null }>({ key: "", reservation: null });
  const markingRead = useRef(new Set<string>());
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const isWide = useMediaQuery("(min-width: 1536px)");
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const overlayOpen = mobileThreadOpen && !isDesktop;
  // Only mark a conversation read once someone can actually see it.
  const conversationVisible = isDesktop || mobileThreadOpen;

  const listingId = source === "guests" ? selected?.hostawayListingId || "" : "";
  const reservationId = selected?.hostawayReservationId || "";
  const reference = selected ? bookingReference(selected) : "";
  const reservationKey = listingId ? `${selected?.id}:${listingId}` : "";

  useEffect(() => {
    if (!reservationKey) return;
    let cancelled = false;
    void fetch(`/api/hostaway/reservations?listingId=${encodeURIComponent(listingId)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((result: { reservations?: HostawayReservation[] }) => {
        if (cancelled) return;
        const match = result.reservations?.find((item) => item.id === reservationId || item.bookingReference === reference);
        setReservationState({ key: reservationKey, reservation: match || null });
      })
      .catch(() => { if (!cancelled) setReservationState({ key: reservationKey, reservation: null }); });
    return () => { cancelled = true; };
  }, [listingId, reference, reservationId, reservationKey]);

  // Reservation details belong to one thread; anything else is still loading.
  const reservation = reservationKey && reservationState.key === reservationKey ? reservationState.reservation : null;
  const reservationLoading = Boolean(reservationKey) && reservationState.key !== reservationKey;

  useEffect(() => {
    if (!conversationVisible || !selected?.unread || document.visibilityState !== "visible" || !document.hasFocus() || markingRead.current.has(selected.id)) return;
    markingRead.current.add(selected.id);
    void fetch("/api/communications/threads", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: selected.id, action: "read" }),
    }).then(async (response) => {
      const result = await response.json().catch(() => null) as { data?: CommunicationCentreData } | null;
      if (response.ok && result?.data) onData(result.data);
    }).finally(() => markingRead.current.delete(selected.id));
  }, [conversationVisible, onData, selected]);

  // The full-screen mobile conversation behaves like a page: the device back
  // gesture returns to the inbox, and the page behind it stops scrolling.
  useEffect(() => {
    if (!overlayOpen) return;
    const onPop = () => setMobileThreadOpen(false);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("popstate", onPop);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("popstate", onPop);
    };
  }, [overlayOpen]);

  function openThread(id: string) {
    setSelectedId(id);
    setDraft("");
    if (!isDesktop) {
      setMobileThreadOpen(true);
      window.history.pushState({ rechargeThread: id }, "");
    }
  }

  function closeThread() {
    if ((window.history.state as { rechargeThread?: string } | null)?.rechargeThread) {
      window.history.back();
    } else {
      setMobileThreadOpen(false);
    }
  }

  if (threads.length === 0) {
    return (
      <ChannelEmptyState
        source={source}
        connected={connected}
        details={details}
      />
    );
  }

  const guidance = selected ? (
    <GuidancePanel
      thread={selected}
      source={source}
      workflows={data.workflows}
      reservation={reservation}
      reservationLoading={reservationLoading}
    />
  ) : null;

  const conversation = selected ? (
    <ConversationPanel
      key={selected.id}
      thread={selected}
      source={source}
      connected={connected}
      currentUser={currentUser}
      draft={draft}
      onDraftChange={setDraft}
      onData={onData}
      reservation={reservation}
      reservationLoading={reservationLoading}
      workflows={data.workflows}
      onBack={isDesktop ? undefined : closeThread}
      onOpenInsights={isWide ? undefined : () => setInsightsOpen(true)}
    />
  ) : null;

  const Icon = details.icon;

  return (
    <>
      <div className="surface overflow-hidden rounded-[1.75rem] border border-[#d5dfdc] bg-white lg:grid lg:h-[min(54rem,calc(100dvh-7rem))] lg:min-h-[36rem] lg:grid-cols-[20.5rem_minmax(0,1fr)] 2xl:grid-cols-[21rem_minmax(0,1fr)_21rem]">
        <aside className="flex min-h-0 flex-col bg-[#f7f9f8] lg:border-r lg:border-[#e3eae7]">
          <div className="space-y-3 border-b border-[#e3eae7] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[0.95rem] font-semibold tracking-[-0.01em]">{details.title}</p>
                <p className="mt-0.5 text-xs text-[#718184]">
                  {unopenedCount} unopened · {threads.length} conversations
                </p>
              </div>
              <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-[#dde6e2] bg-white text-[#315f50]">
                <Icon className="size-4" />
              </span>
            </div>
            <QueueToggle
              value={queue}
              newCount={newCount}
              respondedCount={respondedCount}
              onChange={(next) => {
                setQueue(next);
                setSelectedId("");
              }}
            />
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#7d8f89]" />
              <Input
                aria-label={`Search ${details.title.toLowerCase()}`}
                className="h-10 rounded-xl bg-white pl-9 text-sm"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search guests, properties, messages"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Select value={propertyFilter} onValueChange={setPropertyFilter}>
                <SelectTrigger aria-label="Filter messages by property" size="sm" className="h-9 w-full rounded-full bg-white text-xs font-medium"><SelectValue placeholder="All properties" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All properties</SelectItem>{properties.map((property) => <SelectItem key={property} value={property}>{property}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortMode)}>
                <SelectTrigger aria-label="Sort messages" size="sm" className="h-9 w-full rounded-full bg-white text-xs font-medium">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="waiting">Longest waiting</SelectItem>
                  <SelectItem value="unopened">Unopened first</SelectItem>
                  <SelectItem value="newest">Newest first</SelectItem>
                  <SelectItem value="property">Property A–Z</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
            <div key={`${queue}-${sortBy}-${propertyFilter}`} className="stagger space-y-1">
              {visibleThreads.map((thread, index) => (
                <ThreadListItem
                  key={thread.id}
                  order={index}
                  thread={thread}
                  source={source}
                  active={isDesktop && selected?.id === thread.id}
                  onClick={() => openThread(thread.id)}
                />
              ))}
            </div>
            {visibleThreads.length === 0 && (
              <div className="animate-rise px-6 py-12 text-center">
                <span className="mx-auto grid size-11 place-items-center rounded-2xl bg-white text-[#527261] shadow-[var(--shadow-soft)]">
                  {queue === "new" ? <CheckCheck className="size-5" /> : <Search className="size-5" />}
                </span>
                <p className="mt-4 text-sm font-semibold">
                  {queue === "new" ? "All caught up" : "Nothing found"}
                </p>
                <p className="mt-1 text-xs leading-5 text-[#718184]">
                  {queue === "new" ? "No new messages need a response." : "No responded conversations match these filters."}
                </p>
              </div>
            )}
          </div>
        </aside>

        {isDesktop && (conversation ?? <NoConversation />)}
        {isWide && guidance && (
          <aside className="min-h-0 overflow-y-auto overscroll-contain border-l border-[#e3eae7] bg-[#f7f9f8]">
            {guidance}
          </aside>
        )}
      </div>

      {overlayOpen && conversation && createPortal(
        <div className="fixed inset-0 z-50 flex flex-col bg-white animate-in fade-in slide-in-from-right-10 duration-300 lg:hidden">
          {conversation}
        </div>,
        document.body,
      )}

      {!isWide && guidance && (
        <Sheet open={insightsOpen} onOpenChange={setInsightsOpen}>
          <SheetContent className="w-full gap-0 overflow-y-auto border-[#d9e2df] bg-[#f7f9f8] p-0 sm:max-w-md">
            <SheetHeader className="sr-only">
              <SheetTitle>Guest insights</SheetTitle>
              <SheetDescription>Guest read, matched workflow, suggested actions and booking details.</SheetDescription>
            </SheetHeader>
            {guidance}
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}

function QueueToggle({
  value,
  newCount,
  respondedCount,
  onChange,
}: {
  value: "new" | "responded";
  newCount: number;
  respondedCount: number;
  onChange: (value: "new" | "responded") => void;
}) {
  return (
    <div className="relative grid grid-cols-2 rounded-xl border border-[#dde6e2] bg-[#e9efec] p-1" role="tablist" aria-label="Message queue">
      <span
        aria-hidden="true"
        className="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-lg bg-[#1c3934] shadow-[0_6px_16px_-8px_rgba(16,39,31,0.6)] transition-transform duration-500"
        style={{
          transform: value === "new" ? "translateX(0)" : "translateX(100%)",
          transitionTimingFunction: "var(--ease-spring)",
        }}
      />
      {(["new", "responded"] as const).map((option) => (
        <button
          key={option}
          role="tab"
          aria-selected={value === option}
          className={`relative z-10 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors duration-300 ${value === option ? "text-white" : "text-[#526b67] hover:text-[#1c3934]"}`}
          onClick={() => onChange(option)}
        >
          {option === "new" ? "Needs reply" : "Responded"}
          <span className={`rounded-full px-1.5 text-[0.65rem] tabular-nums transition-colors duration-300 ${value === option ? "bg-white/15" : "bg-[#1c3934]/8"}`}>
            {option === "new" ? newCount : respondedCount}
          </span>
        </button>
      ))}
    </div>
  );
}

function ThreadListItem({
  thread,
  source,
  active,
  order,
  onClick,
}: {
  thread: CommunicationThread;
  source: CommunicationSource;
  active: boolean;
  order: number;
  onClick: () => void;
}) {
  const waiting = waitingMessage(thread);
  const now = useNow(Boolean(waiting));
  const elapsed = waiting ? Math.max(0, now - waiting.sentAt) : 0;
  const tone = waiting ? waitTone(elapsed, source) : null;
  const last = thread.messages.at(-1);
  const name = source === "email" ? thread.senderAddress : thread.guestName || "Guest";
  return (
    <button
      data-thread-item
      style={{ "--i": order } as CSSProperties}
      aria-current={active ? "true" : undefined}
      className={`group relative w-full overflow-hidden rounded-2xl px-3.5 py-3 text-left transition-[background-color,box-shadow] duration-300 ${active ? "bg-white shadow-[var(--shadow-lift)] ring-1 ring-[#cbd9d3]" : "hover:bg-white/80"}`}
      onClick={onClick}
    >
      {tone && (
        <span
          aria-hidden="true"
          className={`absolute inset-y-3 left-0 w-[3px] rounded-r-full ${toneStyles[tone].rail} ${tone === "red" ? "animate-pulse" : ""}`}
        />
      )}
      <div className="flex gap-3">
        <GuestAvatar name={name} thread={thread} source={source} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className={`truncate text-sm ${thread.unread ? "font-bold text-[#10271f]" : "font-semibold"}`}>
              {name}
            </p>
            <span className="shrink-0 text-[0.68rem] font-medium tabular-nums text-[#81908d]">
              {last ? relativeTime(last.sentAt, now) : ""}
            </span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <p className="truncate text-xs text-[#5e7470]">{thread.propertyName || "Property not identified"}</p>
            {thread.unread && (
              <span className="shrink-0 rounded-full bg-[#1c3934] px-1.5 py-px text-[0.6rem] font-bold uppercase tracking-[0.04em] text-white">
                {thread.unreadCount > 1 ? `${thread.unreadCount} new` : "New"}
              </span>
            )}
          </div>
          <p className={`mt-1.5 line-clamp-2 text-xs leading-5 ${thread.unread ? "text-[#33504a]" : "text-[#6b7b7d]"}`}>
            {last?.direction === "outbound" && <span className="font-semibold text-[#527261]">You: </span>}
            {messagePreview(last)}
          </p>
          {tone && (
            <div className="mt-2">
              <TimerPill elapsed={elapsed} tone={tone} label="waiting" />
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function TimerPill({ elapsed, tone, label }: { elapsed: number; tone: Tone; label?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.66rem] font-semibold tabular-nums ${toneStyles[tone].pill}`}>
      <Clock3 className="size-3" /> {formatDuration(elapsed)}
      {label && <span className="font-medium opacity-75">{label}</span>}
    </span>
  );
}

function NoConversation() {
  return (
    <div className="chat-canvas grid place-items-center p-10 text-center">
      <div className="animate-rise">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-white text-[#527261] shadow-[var(--shadow-soft)]">
          <MessagesSquare className="size-6" />
        </span>
        <p className="mt-4 font-semibold">Select a conversation</p>
        <p className="mt-1 text-sm text-[#718184]">Pick a guest from the inbox to read and reply.</p>
      </div>
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
  const steps = [
    "Authorise the connection securely",
    "Conversations sync in automatically",
    "Reply with live timers and assisted guidance",
  ];
  return (
    <section className="surface overflow-hidden rounded-[1.75rem] border border-[#d5dfdc] bg-white lg:grid lg:grid-cols-[1.2fr_0.8fr]">
      <div className="p-7 sm:p-10">
        <div className="relative grid size-16 place-items-center">
          <span className="ring-spin absolute inset-0 rounded-full border border-dashed border-[#bfd0c9]" aria-hidden="true" />
          <span className="absolute inset-2 rounded-full bg-[#eaf2ee]" aria-hidden="true" />
          <Icon className="relative size-6 text-[#315f50]" />
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">{details.title}</h2>
          <ConnectionBadge label={connected ? "Connected" : "Awaiting connection"} connected={connected} />
        </div>
        <p className="mt-3 max-w-xl text-[0.95rem] leading-7 text-[#647577]">{details.description}</p>
        {connected && source === "guests" && (
          <p className="mt-3 flex items-center gap-2 text-sm leading-6 text-[#527261]">
            <span className="live-dot" /> Hostaway is connected. New conversations appear here automatically.
          </p>
        )}
        <ResponseStandard source={source} />
      </div>
      <div className="forest-panel overflow-hidden p-7 sm:p-10">
        <span className="orb -right-20 -top-20 size-56 bg-[#8fb3a2]/25" aria-hidden="true" />
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-[#8fb3a2]">Connection route</p>
        <h3 className="mt-4 text-xl font-semibold tracking-[-0.02em]">{connectionTitle(source)}</h3>
        <p className="mt-3 text-sm leading-6 text-white/60">{connectionCopy(source)}</p>
        <ol className="mt-7 space-y-3">
          {steps.map((step, index) => (
            <li key={step} className="flex items-center gap-3 text-sm text-white/80">
              <span className="grid size-7 shrink-0 place-items-center rounded-full border border-white/15 bg-white/5 text-xs font-semibold text-[#c9e7a4]">
                {index + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
        <div className="mt-8 flex items-center gap-2 text-xs font-semibold text-white/60">
          <ShieldCheck className="size-4 text-[#8fb3a2]" /> Secure, private workspace
        </div>
      </div>
    </section>
  );
}

function ResponseStandard({ source }: { source: CommunicationSource }) {
  const { amberSeconds, redSeconds } = sourceDetails[source];
  return (
    <div className="mt-8 rounded-2xl border border-[#e3eae7] bg-[#f7f9f8] p-5">
      <p className="eyebrow">Response standard</p>
      <div className="mt-4 flex h-2 gap-1 overflow-hidden rounded-full">
        <span className="grow-x flex-1 rounded-full bg-[#7cb356]" />
        <span className="grow-x flex-1 rounded-full bg-[#dca23a]" style={{ animationDelay: "120ms" }} />
        <span className="grow-x flex-1 rounded-full bg-[#cf5b55]" style={{ animationDelay: "240ms" }} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-[#5e7470]">
        <span><strong className="block text-[#3f6327]">On time</strong>Under {amberSeconds / 60} min</span>
        <span><strong className="block text-[#86601a]">Slipping</strong>{amberSeconds / 60}–{redSeconds / 60} min</span>
        <span><strong className="block text-[#9c3737]">Overdue</strong>{redSeconds / 60}+ min</span>
      </div>
    </div>
  );
}


/* ───────────────────────── Conversation ───────────────────────── */

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
  workflows,
  onBack,
  onOpenInsights,
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
  workflows: CommunicationWorkflow[];
  onBack?: () => void;
  onOpenInsights?: () => void;
}) {
  const router = useRouter();
  const messageWindowRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [replyError, setReplyError] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [tidiedDraft, setTidiedDraft] = useState("");
  const guidance = useMemo(() => threadGuidance(thread, workflows), [thread, workflows]);
  const name = thread.guestName || thread.senderAddress || "Conversation";

  const hasScrolled = useRef(false);

  useEffect(() => {
    const messageWindow = messageWindowRef.current;
    if (!messageWindow) return;
    // Jump straight to the latest message on open; glide for new arrivals.
    messageWindow.scrollTo({ top: messageWindow.scrollHeight, behavior: hasScrolled.current ? "smooth" : "auto" });
    hasScrolled.current = true;
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
    if (!draft.trim()) return;
    setTidiedDraft(tidyGuestReply(draft, thread.guestName));
    setReviewOpen(true);
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-white">
      <header className="flex items-center gap-3 border-b border-[#e3eae7] px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5">
        {onBack && (
          <button
            className="press grid size-10 shrink-0 place-items-center rounded-xl text-[#1c3934] transition-colors hover:bg-[#f1f5f3]"
            aria-label="Back to inbox"
            onClick={onBack}
          >
            <ArrowLeft className="size-5" />
          </button>
        )}
        <GuestAvatar name={name} thread={thread} source={source} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold tracking-[-0.01em]">{name}</p>
          <p className="truncate text-xs text-[#5e7470]">
            {communicationPlatform(thread, source)} · {thread.propertyName || "Property not identified"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {source === "email" && (
            <Button size="sm" variant="outline" aria-label="Mark as junk" disabled={saving} onClick={() => act("junk")}>
              <Trash2 /> <span className="hidden sm:inline">Junk</span>
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            aria-label={thread.status === "closed" ? "Reopen conversation" : "Close conversation"}
            disabled={saving}
            onClick={() => act(thread.status === "closed" ? "reopen" : "close")}
          >
            <Check /> <span className="hidden sm:inline">{thread.status === "closed" ? "Reopen" : "Close"}</span>
          </Button>
          {onOpenInsights && (
            <Button size="sm" variant="outline" className="relative" aria-label="Open guest insights" onClick={onOpenInsights}>
              <Sparkles /> <span className="hidden sm:inline">Insights</span>
              {guidance.suggestedTargets.length > 0 && guidance.replyNeeded && (
                <span className="absolute -right-1 -top-1 size-2.5 rounded-full bg-[#dca23a] ring-2 ring-white" aria-hidden="true" />
              )}
            </Button>
          )}
        </div>
      </header>

      <StayStrip thread={thread} source={source} reservation={reservation} loading={reservationLoading} />

      {guidance.replyNeeded && guidance.suggestedTargets.length > 0 && onOpenInsights && (
        <button
          className="flex items-center gap-2 border-b border-[#f0e2bd] bg-[#fffaec] px-4 py-2 text-left text-xs font-semibold text-[#765e22] transition-colors hover:bg-[#fff5dc] sm:px-5"
          onClick={onOpenInsights}
        >
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="flex-1">Possible issue detected — review the suggested ticket</span>
          <ChevronRight className="size-3.5" />
        </button>
      )}

      <div
        ref={messageWindowRef}
        className="chat-canvas min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6"
      >
        <MessageTimeline thread={thread} source={source} name={name} />
      </div>

      <Composer
        key={thread.id}
        connected={connected}
        source={source}
        draft={draft}
        onDraftChange={onDraftChange}
        onReview={reviewReply}
        saving={saving}
        replyError={replyError}
        currentUser={currentUser}
        suggestion={guidance.replyNeeded ? guidance.suggestedResponse : ""}
        workflowName={guidance.workflow?.name}
      />

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="gap-0 rounded-3xl border-[#d8e2de] p-0 sm:max-w-xl">
          <DialogHeader className="border-b border-[#e3eae7] px-6 py-5 text-left">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-[#1c3934] text-[#c9e7a4]">
                <Sparkles className="size-4" />
              </span>
              <div>
                <DialogTitle className="text-lg tracking-[-0.02em]">Review before sending</DialogTitle>
                <DialogDescription className="text-xs">
                  Spelling, grammar and tone tidied without changing the meaning.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-3 px-6 py-5">
            <Textarea
              rows={9}
              className="rounded-2xl text-sm leading-6"
              value={tidiedDraft}
              onChange={(event) => setTidiedDraft(event.target.value)}
              aria-label="Reply to send"
            />
            <details className="group rounded-xl bg-[#f5f8f6] px-4 py-3 text-xs text-[#5e7470]">
              <summary className="cursor-pointer list-none font-semibold text-[#315f50]">
                <ChevronRight className="mr-1 inline size-3.5 transition-transform group-open:rotate-90" />
                Your original draft
              </summary>
              <p className="mt-2 whitespace-pre-wrap leading-5">{draft}</p>
            </details>
            <p className="text-xs text-[#81908d]">Sending to {name} as {currentUser.name}.</p>
            {replyError && <p className="text-sm font-medium text-red-700">{replyError}</p>}
          </div>
          <DialogFooter className="border-t border-[#e3eae7] px-6 py-4">
            <Button variant="outline" onClick={() => setReviewOpen(false)}>Keep editing</Button>
            <Button disabled={saving || !tidiedDraft.trim()} onClick={() => void sendReply(tidiedDraft)}>
              {saving ? <LoaderCircle className="animate-spin" /> : <Send />}
              {saving ? "Sending…" : "Send reply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function StayStrip({
  thread,
  source,
  reservation,
  loading,
}: {
  thread: CommunicationThread;
  source: CommunicationSource;
  reservation: HostawayReservation | null;
  loading: boolean;
}) {
  if (source !== "guests") return null;
  const reference = bookingReference(thread);
  const chip = "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#e1e9e5] bg-white px-2.5 py-1 text-[0.7rem] font-medium text-[#40585b]";
  return (
    <div className="scrollbar-none flex items-center gap-2 overflow-x-auto border-b border-[#eef2f0] bg-[#fbfcfb] px-3 py-2.5 sm:px-5">
      {loading ? (
        [0, 1, 2].map((item) => (
          <span key={item} className="h-6 w-24 shrink-0 animate-pulse rounded-full bg-[#e9efec]" />
        ))
      ) : reservation ? (
        <>
          <span className={chip}>
            <CalendarDays className="size-3.5 text-[#6f8f80]" />
            {formatBookingDate(reservation.arrivalDate)} – {formatBookingDate(reservation.departureDate)}
          </span>
          {reservation.guestCount ? (
            <span className={chip}><Users className="size-3.5 text-[#6f8f80]" />{reservation.guestCount} guests</span>
          ) : null}
          <span className={chip}><PoundSterling className="size-3.5 text-[#6f8f80]" />{formatMoney(reservation.grossRevenuePence)}</span>
        </>
      ) : (
        <span className="shrink-0 text-[0.7rem] text-[#81908d]">No reservation details found</span>
      )}
      {reference && <span className={chip}><Hash className="size-3.5 text-[#6f8f80]" />{reference}</span>}
      {thread.hostawayReservationId && (
        <a
          href={`https://dashboard.hostaway.com/reservations/${encodeURIComponent(thread.hostawayReservationId)}`}
          target="_blank"
          rel="noreferrer"
          className={chip + " text-[#315f50] transition-colors hover:border-[#b9c9c3]"}
        >
          Booking <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  );
}

function MessageTimeline({
  thread,
  source,
  name,
}: {
  thread: CommunicationThread;
  source: CommunicationSource;
  name: string;
}) {
  const now = useNow(false);
  const messages = thread.messages;
  return (
    <div className="mx-auto max-w-3xl">
      {messages.map((message, index) => {
        const previous = messages[index - 1];
        const next = messages[index + 1];
        const newDay = !previous || dayKey(previous.sentAt) !== dayKey(message.sentAt);
        const groupedWithPrevious =
          !newDay && previous?.direction === message.direction && message.sentAt - previous.sentAt < 300;
        const groupedWithNext =
          next !== undefined &&
          dayKey(next.sentAt) === dayKey(message.sentAt) &&
          next.direction === message.direction &&
          next.sentAt - message.sentAt < 300;
        return (
          <div key={message.id}>
            {newDay && (
              <div className="my-4 flex items-center gap-3 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-[#8a9a95]">
                <span className="h-px flex-1 bg-[#e3eae7]" />
                {dayLabel(message.sentAt, now)}
                <span className="h-px flex-1 bg-[#e3eae7]" />
              </div>
            )}
            <MessageBubble
              message={message}
              source={source}
              name={name}
              grouped={groupedWithPrevious}
              showMeta={!groupedWithNext}
              delay={Math.max(0, index - (messages.length - 6)) * 45}
            />
          </div>
        );
      })}
    </div>
  );
}

function MessageBubble({
  message,
  source,
  name,
  grouped,
  showMeta,
  delay,
}: {
  message: CommunicationMessage;
  source: CommunicationSource;
  name: string;
  grouped: boolean;
  showMeta: boolean;
  delay: number;
}) {
  const inbound = message.direction === "inbound";
  return (
    <div
      className={`msg-in flex items-end gap-2 ${inbound ? "" : "flex-row-reverse"} ${grouped ? "mt-1" : "mt-3"}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {inbound && (
        <div className="w-7 shrink-0">
          {showMeta && (
            <span className="grid size-7 place-items-center rounded-full bg-[#dfe9e4] text-[0.6rem] font-bold text-[#24473f]">
              {initialsOf(name)}
            </span>
          )}
        </div>
      )}
      <div className={`flex max-w-[85%] flex-col sm:max-w-[72%] ${inbound ? "items-start" : "items-end"}`}>
        <div
          className={`rounded-[1.3rem] px-4 py-2.5 ${inbound ? "border border-[#e3eae7] bg-white text-[#1c3934] shadow-[0_1px_2px_rgba(16,39,31,0.04)]" : "bg-gradient-to-br from-[#2a5047] to-[#1c3934] text-white shadow-[0_6px_18px_-10px_rgba(16,39,31,0.7)]"} ${showMeta ? (inbound ? "rounded-bl-md" : "rounded-br-md") : ""}`}
        >
          {message.body && <p className="break-words whitespace-pre-wrap text-sm leading-6">{message.body}</p>}
          {message.attachments.length > 0 && (
            <div className={`${message.body ? "mt-3" : ""} grid gap-2`}>
              {message.attachments.map((attachment, index) => <AttachmentPreview key={`${attachment.url}-${index}`} attachment={attachment} />)}
            </div>
          )}
        </div>
        {showMeta && (
          <div className={`mt-1 flex flex-wrap items-center gap-1.5 px-1 text-[0.68rem] text-[#81908d] ${inbound ? "" : "justify-end"}`}>
            <span className="tabular-nums">{formatTime(message.sentAt)}</span>
            {inbound && <ResponseTimer message={message} source={source} />}
            {!inbound && message.respondedByName && <span>· {message.respondedByName}</span>}
            {!inbound && message.isAutomated && <span>· Automated</span>}
            {!inbound && <CheckCheck className="size-3.5 text-[#6f8f80]" aria-label="Sent" />}
          </div>
        )}
      </div>
    </div>
  );
}

function AttachmentPreview({ attachment }: { attachment: CommunicationMessage["attachments"][number] }) {
  const type = attachment.contentType.toLowerCase();
  if (type.startsWith("image") || /\.(jpg|jpeg|png|gif|webp|heic)(\?|$)/i.test(attachment.url)) {
    return <a href={attachment.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-black/10 bg-black/5 transition-opacity hover:opacity-90"><img src={attachment.url} alt={attachment.name || "Guest photo"} className="max-h-72 w-full object-contain" /></a>;
  }
  if (type.startsWith("video") || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(attachment.url)) {
    return <video controls preload="metadata" className="max-h-72 w-full rounded-xl border border-black/10 bg-black" src={attachment.url}>Your browser cannot play this guest video.</video>;
  }
  return <a href={attachment.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-[#cfdbd7] bg-white px-3 py-2 text-sm font-semibold text-[#315f50]">Open {attachment.name || "attachment"} <ExternalLink className="size-4" /></a>;
}

function ResponseTimer({
  message,
  source,
}: {
  message: CommunicationMessage;
  source: CommunicationSource;
}) {
  const now = useNow(!message.respondedAt);
  const elapsed = Math.max(0, (message.respondedAt ?? now) - message.sentAt);
  const tone = waitTone(elapsed, source);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px font-semibold tabular-nums ${toneStyles[tone].pill}`}
      title={message.respondedAt ? "Time taken to reply" : "Waiting for a reply"}
    >
      <Clock3 className="size-3" /> {formatDuration(elapsed)}
      <span className="font-medium opacity-75">{message.respondedAt ? "to reply" : "waiting"}</span>
    </span>
  );
}

function Composer({
  connected,
  source,
  draft,
  onDraftChange,
  onReview,
  saving,
  replyError,
  currentUser,
  suggestion,
  workflowName,
}: {
  connected: boolean;
  source: CommunicationSource;
  draft: string;
  onDraftChange: (value: string) => void;
  onReview: () => void;
  saving: boolean;
  replyError: string;
  currentUser: CentreUser;
  suggestion: string;
  workflowName?: string;
}) {
  const [dismissed, setDismissed] = useState(false);
  const footer = "border-t border-[#e3eae7] bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4";

  if (!connected) {
    return (
      <footer className={footer}>
        <div className="flex items-start gap-3 rounded-2xl border border-dashed border-[#cbd8d3] bg-[#f7f9f8] p-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white text-[#527261] shadow-[var(--shadow-soft)]">
            <PlugZap className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">Read-only until {sourceDetails[source].label} is connected</p>
            <p className="mt-0.5 text-xs leading-5 text-[#718184]">
              You can still read the conversation and insights. Replies unlock automatically once the connection is live.
            </p>
          </div>
        </div>
      </footer>
    );
  }

  return (
    <footer className={footer}>
      {suggestion && !draft.trim() && !dismissed && (
        <div className="animate-rise mb-3 rounded-2xl border border-[#d6e5cf] bg-gradient-to-br from-[#f3f9ee] to-[#eef5f1] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="flex min-w-0 items-center gap-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[#4a6a3a]">
              <Sparkles className="size-3.5 shrink-0" /> Suggested reply
              {workflowName && <span className="truncate font-medium normal-case tracking-normal text-[#6b7f73]">· {workflowName}</span>}
            </p>
            <button
              aria-label="Dismiss suggestion"
              className="press grid size-6 shrink-0 place-items-center rounded-full text-[#7c8f88] transition-colors hover:bg-white"
              onClick={() => setDismissed(true)}
            >
              <X className="size-3.5" />
            </button>
          </div>
          <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-[#2c4a42]">{suggestion}</p>
          <Button size="sm" className="mt-3" onClick={() => onDraftChange(suggestion)}>
            <Check /> Use this reply
          </Button>
        </div>
      )}
      <div className="rounded-2xl border border-[#cfdbd6] bg-white transition-[border-color,box-shadow] duration-200 focus-within:border-[#315f50] focus-within:shadow-[0_0_0_4px_rgba(49,95,80,0.1)]">
        <textarea
          aria-label="Write a reply"
          className="field-sizing-content block max-h-48 min-h-[3.25rem] w-full resize-none bg-transparent px-4 pt-3 text-sm leading-6 outline-none placeholder:text-[#8a9a95] focus-visible:outline-none"
          placeholder="Write a reply…"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onReview();
            }
          }}
        />
        <div className="flex items-center justify-between gap-3 px-3 pb-2.5 pt-1">
          <p className="truncate text-[0.7rem] text-[#81908d]">
            Replying as {currentUser.name}
            <span className="hidden sm:inline"> · Ctrl/⌘ + Enter to review</span>
          </p>
          <Button size="sm" disabled={!draft.trim() || saving} onClick={onReview}>
            Review <Send />
          </Button>
        </div>
      </div>
      {replyError && <p className="mt-2 text-sm font-medium text-red-700">{replyError}</p>}
    </footer>
  );
}

function GuestAvatar({
  name,
  thread,
  source,
  size = "md",
}: {
  name: string;
  thread: CommunicationThread;
  source: CommunicationSource;
  size?: "md" | "lg";
}) {
  const tone = avatarTones[hashString(name) % avatarTones.length];
  return (
    <span className={`relative grid shrink-0 place-items-center rounded-full font-bold ${tone} ${size === "lg" ? "size-11 text-sm" : "size-10 text-xs"}`}>
      {initialsOf(name)}
      <span className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-white">
        <ChannelLogo thread={thread} source={source} />
      </span>
    </span>
  );
}


/* ───────────────────────── Guest insights ───────────────────────── */

type ReportTarget = "ready" | "cleans" | "direct";

function threadGuidance(thread: CommunicationThread, workflows: CommunicationWorkflow[]) {
  const workflow = matchWorkflow(thread, workflows);
  const latestInbound = [...thread.messages]
    .reverse()
    .find((message) => message.direction === "inbound");
  const replyNeeded = waitingMessage(thread);
  const responseContext = latestInbound?.body || thread.subject || `Message from ${thread.guestName || "guest"}`;
  const maintenance = detectMaintenanceCategory(responseContext);
  const directBooking = detectDirectBookingOpportunity(responseContext);
  const suggestedResponse = replyNeeded ? buildSuggestedResponse(thread, responseContext, workflow, maintenance) : "";
  const suggestedTargets: ReportTarget[] = [
    ...(maintenance ? ["ready" as const] : []),
    ...(workflow?.escalationTarget === "cleans" ? ["cleans" as const] : []),
    ...(directBooking ? ["direct" as const] : []),
  ];
  return { workflow, replyNeeded, suggestedResponse, suggestedTargets, maintenance };
}

function GuidancePanel({
  thread,
  source,
  workflows,
  reservation,
  reservationLoading,
}: {
  thread: CommunicationThread;
  source: CommunicationSource;
  workflows: CommunicationWorkflow[];
  reservation: HostawayReservation | null;
  reservationLoading: boolean;
}) {
  const { workflow, replyNeeded, suggestedTargets, maintenance } = useMemo(
    () => threadGuidance(thread, workflows),
    [thread, workflows],
  );
  const sentiment = guestSentiment(thread);
  const experienceSummary = summariseGuestExperience(thread);
  const travelReason = detectTravelReason(thread);
  const steps = workflow
    ? workflow.instructions
        .split("\n")
        .map((line) => line.replace(/^\s*(\d+[.)]|[-•*])\s*/, "").trim())
        .filter(Boolean)
    : [];
  const sentimentDot = {
    positive: "bg-[#6aa441]",
    neutral: "bg-[#8fb3a2]",
    warning: "bg-[#d39a2f]",
    negative: "bg-[#c24c4c]",
  }[sentiment.tone];
  const loadingValue = (value: string) => (reservationLoading ? "Loading…" : value);

  return (
    <div key={thread.id} className="view-enter space-y-6 p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-[#1c3934] text-[#c9e7a4] shadow-[0_6px_16px_-8px_rgba(16,39,31,0.6)]">
          <Sparkles className="size-4" />
        </span>
        <div>
          <p className="text-sm font-semibold">Guest insights</p>
          <p className="text-xs text-[#718184]">Read from this conversation</p>
        </div>
      </div>

      {replyNeeded && suggestedTargets.length > 0 && (
        <ReportActions
          key={thread.id}
          thread={thread}
          message={replyNeeded}
          suggestedTargets={suggestedTargets}
          maintenance={maintenance}
        />
      )}

      <PanelSection title="Guest read">
        <div className="divide-y divide-[#edf1ef] overflow-hidden rounded-2xl border border-[#e1e9e5] bg-white">
          <div className="p-3.5">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[#81908d]">Sentiment</p>
            <p className="mt-1.5 flex items-center gap-2 text-sm font-semibold text-[#29443e]">
              <span className={`size-2 rounded-full ${sentimentDot}`} />
              {sentiment.label}
            </p>
            <p className="mt-1 text-xs leading-5 text-[#718184]">{sentiment.note}</p>
          </div>
          <div className="p-3.5">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[#81908d]">Reason for travel</p>
            <p className="mt-1.5 text-sm font-semibold text-[#29443e]">{travelReason}</p>
          </div>
        </div>
        <blockquote className="mt-2 rounded-2xl border-l-2 border-[#8fb3a2] bg-white/70 px-4 py-3 text-xs leading-5 text-[#40585b]">
          {experienceSummary}
        </blockquote>
      </PanelSection>

      <PanelSection title="Matched workflow">
        {workflow ? (
          <div className="rounded-2xl border border-[#e1e9e5] bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold">{workflow.name}</p>
              {workflow.priority === "urgent" && (
                <Badge className="shrink-0 border-0 bg-[#fbe4e2] text-[#9c3737]">Urgent</Badge>
              )}
            </div>
            <ol className="mt-3 space-y-2">
              {steps.map((step, index) => (
                <li key={`${index}-${step}`} className="flex gap-2.5 text-xs leading-5 text-[#526568]">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#eef3f0] text-[0.6rem] font-bold text-[#315f50]">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-[#cbd8d3] bg-white/60 p-4">
            <p className="text-sm font-semibold">No exact workflow matched</p>
            <p className="mt-1 text-xs leading-5 text-[#718184]">
              The suggestion uses the guest&apos;s message, context and Recharge&apos;s warm service tone.
            </p>
          </div>
        )}
      </PanelSection>

      {source === "guests" && (
        <PanelSection title="Booking">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border border-[#e1e9e5] bg-white p-4 text-xs">
            <BookingDetail label="Channel" value={communicationPlatform(thread, source)} />
            <BookingDetail label="Reference" value={bookingReference(thread) || "Not supplied"} />
            <BookingDetail label="Guest email" value={thread.senderAddress || "Not supplied"} />
            <BookingDetail label="Phone" value={loadingValue(reservation?.guestPhone || "Not supplied")} />
            <BookingDetail label="Guests" value={loadingValue(reservation?.guestCount ? String(reservation.guestCount) : "Not supplied")} />
            <BookingDetail label="Booking value" value={loadingValue(reservation ? formatMoney(reservation.grossRevenuePence) : "Not supplied")} />
            <BookingDetail label="Stay dates" value={loadingValue(reservation ? `${formatBookingDate(reservation.arrivalDate)} – ${formatBookingDate(reservation.departureDate)}` : "Not supplied")} />
            <BookingDetail label="Conversation" value={thread.status === "closed" ? "Closed" : "Open"} />
          </div>
          {(thread.hostawayReservationId || thread.hostawayListingId) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {thread.hostawayReservationId && <a href={`https://dashboard.hostaway.com/reservations/${encodeURIComponent(thread.hostawayReservationId)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-[#cfdbd7] bg-white px-3 py-1.5 text-xs font-semibold text-[#315f50] transition-colors hover:border-[#b9c9c3]">Full booking <ExternalLink className="size-3" /></a>}
              {thread.hostawayListingId && <a href={`https://dashboard.hostaway.com/listings/${encodeURIComponent(thread.hostawayListingId)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-[#cfdbd7] bg-white px-3 py-1.5 text-xs font-semibold text-[#315f50] transition-colors hover:border-[#b9c9c3]">Property <ExternalLink className="size-3" /></a>}
            </div>
          )}
        </PanelSection>
      )}

      {!replyNeeded && (
        <div className="flex items-start gap-3 rounded-2xl border border-[#cfe0d6] bg-[#eef5f1] p-4">
          <CheckCheck className="mt-0.5 size-4 shrink-0 text-[#315f50]" />
          <div>
            <p className="text-sm font-semibold text-[#315f50]">Response sent</p>
            <p className="mt-1 text-xs leading-5 text-[#5e7470]">
              This conversation returns to Needs reply if the guest writes again.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <p className="mb-2 px-1 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-[#6f8f80]">{title}</p>
      {children}
    </section>
  );
}

const reportActions: Array<{
  target: ReportTarget;
  label: string;
  done: string;
  destination: string;
  icon: typeof Wrench;
}> = [
  { target: "ready", label: "Approve maintenance ticket", done: "Maintenance ticket created", destination: "Adds to the maintenance board", icon: Wrench },
  { target: "cleans", label: "Raise clean issue", done: "Clean issue created", destination: "Sends to Recharge Cleans", icon: SprayCan },
  { target: "direct", label: "Create direct booking ticket", done: "Direct booking ticket created", destination: "Adds to direct bookings", icon: Plus },
];

function ReportActions({
  thread,
  message,
  suggestedTargets,
  maintenance,
}: {
  thread: CommunicationThread;
  message: CommunicationMessage;
  suggestedTargets: ReportTarget[];
  maintenance: MaintenanceCategory | null;
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
    <div className="rounded-2xl border border-[#ecd9a8] bg-gradient-to-br from-[#fffaec] to-[#fff6e0] p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-[#6b5520]">
        <AlertTriangle className="size-4" /> Action suggested
      </p>
      <p className="mt-1 text-xs leading-5 text-[#86703a]">
        {maintenance ? `Possible ${maintenance.toLowerCase()} issue detected.` : "A possible follow-up was detected."} Approve before it is added to a board.
      </p>
      <div className="mt-3 space-y-2">
        {reportActions.filter((action) => suggestedTargets.includes(action.target)).map((action) => {
          const Icon = action.icon;
          const complete = done.includes(action.target);
          return (
            <button
              key={action.target}
              className={`press flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-colors disabled:cursor-not-allowed ${complete ? "border-[#cfe0d6] bg-[#eef5f1]" : "border-[#ecdcb0] bg-white hover:border-[#d9bf7a]"}`}
              disabled={saving !== null || complete}
              onClick={() => report(action.target)}
            >
              <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${complete ? "bg-[#315f50] text-white" : "bg-[#fbefcf] text-[#86601a]"}`}>
                {saving === action.target ? <LoaderCircle className="size-4 animate-spin" /> : complete ? <Check className="size-4" /> : <Icon className="size-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-[#29443e]">{complete ? action.done : action.label}</span>
                <span className="block text-[0.7rem] text-[#81908d]">{action.destination}</span>
              </span>
              {!complete && <ChevronRight className="size-4 shrink-0 text-[#b19650]" />}
            </button>
          );
        })}
      </div>
      {error && <p className="mt-3 text-xs font-medium text-red-700">{error}</p>}
    </div>
  );
}


/* ───────────────────────── Workflows ───────────────────────── */

function WorkflowWorkspace({
  data,
  currentUser,
}: {
  data: CommunicationCentreData;
  currentUser: CentreUser;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");
  const hostawayWorkflows = data.workflows.filter(
    (workflow) => workflow.channel === "all" || workflow.channel === "guests",
  );
  const activeCount = hostawayWorkflows.filter((workflow) => workflow.status === "active").length;
  const visible = hostawayWorkflows.filter((workflow) => {
    if (filter !== "all" && workflow.status !== filter) return false;
    const text = `${workflow.name} ${workflow.triggerText} ${workflow.instructions}`.toLowerCase();
    return text.includes(query.trim().toLowerCase());
  });

  return (
    <div>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Response standards</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">Typed workflows</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#647577]">
            Matched to incoming messages and shown beside the conversation, with an approved reply ready to use.
          </p>
        </div>
        {currentUser.role === "admin" && <WorkflowDialog />}
      </div>

      {hostawayWorkflows.length > 0 && (
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative sm:max-w-sm sm:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#7d8f89]" />
            <Input
              className="h-10 rounded-xl bg-white pl-9"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search workflows or triggers"
              aria-label="Search workflows"
            />
          </div>
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: `All · ${hostawayWorkflows.length}` },
              { value: "active", label: `Active · ${activeCount}` },
              { value: "inactive", label: `Paused · ${hostawayWorkflows.length - activeCount}` },
            ]}
          />
        </div>
      )}

      <div key={filter} className="stagger mt-5 grid gap-4 lg:grid-cols-2">
        {visible.map((workflow, index) => (
          <WorkflowCard key={workflow.id} order={index} workflow={workflow} admin={currentUser.role === "admin"} />
        ))}
      </div>
      {hostawayWorkflows.length > 0 && visible.length === 0 && (
        <p className="mt-6 rounded-2xl border border-dashed border-[#cbd8d3] bg-white/60 px-6 py-10 text-center text-sm text-[#718184]">
          No workflows match these filters.
        </p>
      )}
      {hostawayWorkflows.length === 0 && (
        <div className="mt-6 rounded-[1.75rem] border border-dashed border-[#bdcbc7] bg-white/70 px-6 py-14 text-center">
          <span className="relative mx-auto grid size-16 place-items-center">
            <span className="ring-spin absolute inset-0 rounded-full border border-dashed border-[#bfd0c9]" aria-hidden="true" />
            <span className="absolute inset-2 rounded-full bg-[#eaf2ee]" aria-hidden="true" />
            <Sparkles className="relative size-6 text-[#315f50]" />
          </span>
          <h3 className="mt-5 text-lg font-semibold">No workflows yet</h3>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#718184]">
            Workflows teach the inbox how Recharge responds — triggers, steps and approved wording.
            {currentUser.role === "admin" ? " Add the first one above." : " An admin can add the first one."}
          </p>
        </div>
      )}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; icon?: typeof Inbox }>;
}) {
  return (
    <div className="inline-flex w-full flex-wrap gap-1 rounded-xl border border-[#dde6e2] bg-[#e9efec] p-1 sm:w-auto" role="radiogroup">
      {options.map((option) => {
        const Icon = option.icon;
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`press inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-300 sm:flex-none ${selected ? "bg-white text-[#1c3934] shadow-[0_1px_2px_rgba(16,39,31,0.06),0_4px_12px_-4px_rgba(16,39,31,0.14)]" : "text-[#5e7470] hover:text-[#1c3934]"}`}
            onClick={() => onChange(option.value)}
          >
            {Icon && <Icon className="size-3.5" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function WorkflowDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [priority, setPriority] = useState<"standard" | "urgent">("standard");
  const [escalationTarget, setEscalationTarget] = useState<"none" | "ready" | "cleans">("none");
  const [triggerText, setTriggerText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const triggerChips = splitTriggers(triggerText);

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
    setTriggerText("");
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="h-11 px-5">
          <Plus /> Add workflow
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto rounded-3xl border-[#d9e2df] p-0 sm:max-w-2xl">
        <form onSubmit={submit}>
          <DialogHeader className="border-b border-[#e2e9e7] px-6 py-5 text-left">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-[#1c3934] text-[#c9e7a4]">
                <Sparkles className="size-4" />
              </span>
              <div>
                <DialogTitle className="text-xl tracking-[-0.03em]">New response workflow</DialogTitle>
                <DialogDescription className="text-xs">Triggers, required steps and the approved wording.</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-5 px-6 py-6">
            <Field label="Workflow name"><Input name="name" required placeholder="No heating or hot water" className="h-11" /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Priority">
                <Segmented
                  value={priority}
                  onChange={setPriority}
                  options={[
                    { value: "standard", label: "Standard" },
                    { value: "urgent", label: "Urgent", icon: AlertTriangle },
                  ]}
                />
              </Field>
              <Field label="Escalate to">
                <Segmented
                  value={escalationTarget}
                  onChange={setEscalationTarget}
                  options={[
                    { value: "none", label: "None" },
                    { value: "ready", label: "Ready", icon: Wrench },
                    { value: "cleans", label: "Cleans", icon: SprayCan },
                  ]}
                />
              </Field>
            </div>
            <Field label="Trigger words or situations">
              <Textarea
                name="triggerText"
                required
                rows={2}
                value={triggerText}
                onChange={(event) => setTriggerText(event.target.value)}
                placeholder="heating, boiler, no hot water, radiator"
              />
              {triggerChips.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {triggerChips.map((trigger) => <TriggerChip key={trigger}>{trigger}</TriggerChip>)}
                </div>
              )}
            </Field>
            <Field label="Steps (one per line)">
              <Textarea name="instructions" required rows={5} placeholder={"Acknowledge the guest\nCheck the property notes\nProvide the approved troubleshooting\nEscalate if unresolved"} />
            </Field>
            <Field label="Approved response (optional)">
              <Textarea name="approvedResponse" rows={4} placeholder="Hello {{guest_name}}, thank you for letting us know…" />
              <p className="text-xs text-[#81908d]">Use {"{{guest_name}}"} and {"{{property_name}}"} to personalise.</p>
            </Field>
            {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}
          </div>
          <DialogFooter className="border-t border-[#e2e9e7] px-6 py-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={saving}>{saving ? "Saving…" : "Save workflow"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WorkflowCard({ workflow, admin, order }: { workflow: CommunicationWorkflow; admin: boolean; order: number }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const active = workflow.status === "active";
  const triggers = splitTriggers(workflow.triggerText);
  const steps = workflow.instructions
    .split("\n")
    .map((line) => line.replace(/^\s*(\d+[.)]|[-•*])\s*/, "").trim())
    .filter(Boolean);

  async function toggle() {
    setSaving(true);
    const response = await fetch("/api/communications/workflows", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: workflow.id, status: active ? "inactive" : "active" }),
    });
    setSaving(false);
    if (response.ok) router.refresh();
  }

  return (
    <article
      style={{ "--i": order } as CSSProperties}
      className={`surface group flex flex-col rounded-[1.5rem] border border-[#d9e2df] bg-white p-5 transition-[transform,box-shadow,border-color] duration-500 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] ${active ? "" : "opacity-75"}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`grid size-10 shrink-0 place-items-center rounded-xl transition-transform duration-500 group-hover:-rotate-6 ${workflow.priority === "urgent" ? "bg-[#fbe4e2] text-[#9c3737]" : "bg-[#eef3f0] text-[#315f50]"}`}>
            {workflow.priority === "urgent" ? <AlertTriangle className="size-4" /> : <Sparkles className="size-4" />}
          </span>
          <div className="min-w-0">
            <h3 className="font-semibold tracking-[-0.01em]">{workflow.name}</h3>
            <p className="mt-0.5 text-xs text-[#81908d]">
              Guest messages
              {workflow.escalationTarget !== "none" && ` · escalates to ${workflow.escalationTarget === "ready" ? "Ready" : "Cleans"}`}
            </p>
          </div>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.08em] ${active ? "bg-[#e6f2dc] text-[#3f6327]" : "bg-[#eef1f0] text-[#667977]"}`}>
          {active ? <span className="live-dot" /> : <Pause className="size-3" />}
          {active ? "Active" : "Paused"}
        </span>
      </div>

      {triggers.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {triggers.slice(0, 6).map((trigger) => <TriggerChip key={trigger}>{trigger}</TriggerChip>)}
          {triggers.length > 6 && <TriggerChip muted>+{triggers.length - 6}</TriggerChip>}
        </div>
      )}

      <ol className="mt-4 space-y-1.5">
        {steps.slice(0, 3).map((step, index) => (
          <li key={`${index}-${step}`} className="flex gap-2.5 text-sm leading-6 text-[#526568]">
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[#eef3f0] text-[0.6rem] font-bold text-[#315f50]">{index + 1}</span>
            <span className="line-clamp-2">{step}</span>
          </li>
        ))}
        {steps.length > 3 && <li className="pl-7 text-xs font-medium text-[#81908d]">+{steps.length - 3} more steps</li>}
      </ol>

      {workflow.approvedResponse && (
        <blockquote className="mt-4 line-clamp-2 rounded-xl border-l-2 border-[#8fb3a2] bg-[#f6f8f7] px-3 py-2 text-xs leading-5 text-[#5e7470]">
          “{workflow.approvedResponse}”
        </blockquote>
      )}

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-[#e8eeeb] pt-4 [margin-top:max(1.25rem,auto)]">
        <span className="truncate text-xs text-[#81908d]">
          Updated {formatDate(workflow.updatedAt)}{workflow.createdByName ? ` · ${workflow.createdByName}` : ""}
        </span>
        {admin && (
          <Button size="sm" variant="outline" disabled={saving} onClick={toggle}>
            {saving ? <LoaderCircle className="animate-spin" /> : active ? <Pause /> : <Play />}
            {active ? "Pause" : "Activate"}
          </Button>
        )}
      </div>
    </article>
  );
}

function TriggerChip({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-[0.7rem] font-medium ${muted ? "border-[#e3eae7] bg-white text-[#81908d]" : "border-[#d9e6df] bg-[#f1f6f3] text-[#315f50]"}`}>
      {children}
    </span>
  );
}

/* ───────────────────────── Response report ───────────────────────── */

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
  const teamRows = [...team.entries()].sort((a, b) => b[1].responses - a[1].responses);
  const total = responseSeconds.length;
  const share = (count: number) => (total ? Math.round((count / total) * 100) : 0);
  const averageTone = total ? waitTone(average, "guests") : null;
  const scheduleByDay = data.schedule.reduce<Map<string, CommunicationCentreData["schedule"]>>((days, shift) => {
    days.set(shift.shiftDate, [...(days.get(shift.shiftDate) || []), shift]);
    return days;
  }, new Map());

  return (
    <div className="space-y-5">
      <section className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        <article className="forest-panel overflow-hidden rounded-[1.75rem] p-6 sm:p-8">
          <span className="orb -right-16 -top-16 size-60 bg-[#8fb3a2]/25" aria-hidden="true" />
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[#8fb3a2]">Average response</p>
          <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
            <p className={`text-6xl font-semibold tabular-nums tracking-[-0.06em] sm:text-7xl ${averageTone ? toneStyles[averageTone].onDark : "text-white"}`}>
              {total ? formatDuration(Math.round(average)) : "—"}
            </p>
            <p className="pb-2 text-sm text-white/60">
              {averageTone === "green" ? "Inside the 5-minute standard" : averageTone === "amber" ? "Slipping past 5 minutes" : averageTone === "red" ? "Outside the 10-minute standard" : "No replies recorded yet"}
            </p>
          </div>
          <div className="mt-7 flex h-3 gap-1 overflow-hidden rounded-full bg-white/10">
            {total > 0 && (
              <>
                {green > 0 && <span className="grow-x rounded-full bg-[#9fd174]" style={{ flexGrow: green }} />}
                {amber > 0 && <span className="grow-x rounded-full bg-[#e9b85a]" style={{ flexGrow: amber, animationDelay: "150ms" }} />}
                {red > 0 && <span className="grow-x rounded-full bg-[#e07a73]" style={{ flexGrow: red, animationDelay: "300ms" }} />}
              </>
            )}
          </div>
          <dl className="mt-5 grid grid-cols-3 gap-3">
            {([
              ["On time", "Under 5 min", green, "bg-[#9fd174]"],
              ["Slipping", "5–10 min", amber, "bg-[#e9b85a]"],
              ["Overdue", "10+ min", red, "bg-[#e07a73]"],
            ] as const).map(([label, note, count, dot]) => (
              <div key={label}>
                <dt className="flex items-center gap-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-white/50">
                  <span className={`size-1.5 rounded-full ${dot}`} /> {label}
                </dt>
                <dd className="mt-1.5 text-2xl font-semibold tabular-nums tracking-[-0.04em]">
                  {count}
                  <span className="ml-1.5 text-xs font-medium text-white/45">{share(count)}%</span>
                </dd>
                <p className="text-[0.7rem] text-white/45">{note}</p>
              </div>
            ))}
          </dl>
        </article>
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <CentreStat label="Messages answered" value={String(answered.length)} note="Hostaway replies recorded" />
          <CentreStat label="Open conversations" value={String(guestThreads.filter((thread) => thread.status === "open").length)} note="Hostaway guest threads" />
          <CentreStat label="Over 30 minutes" value={String(overThirtyMinutes)} note="Replies after 30 min" tone="amber" alert={overThirtyMinutes > 0} />
          <CentreStat label="Over 1 hour" value={String(overOneHour)} note="Replies after 60 min" tone="red" alert={overOneHour > 0} />
        </div>
      </section>

      <section className="surface overflow-hidden rounded-[1.5rem] border border-[#d9e2df] bg-white">
        <div className="flex items-end justify-between gap-4 border-b border-[#e8eeeb] px-5 py-4 sm:px-6">
          <div>
            <p className="text-sm font-semibold">Team response times</p>
            <p className="mt-0.5 text-xs text-[#718184]">Ranked by replies sent through Recharge</p>
          </div>
          <span className="text-xs font-medium text-[#81908d]">{teamRows.length} people</span>
        </div>
        <div className="stagger divide-y divide-[#eef2f0]">
          {teamRows.map(([name, result], index) => {
            const averageSeconds = Math.round(result.seconds / result.responses);
            const tone = waitTone(averageSeconds, "guests");
            return (
              <div key={name} style={{ "--i": index } as CSSProperties} className="flex items-center gap-3 px-5 py-3.5 sm:gap-4 sm:px-6">
                <span className="w-5 text-xs font-semibold tabular-nums text-[#9aa8a4]">{index + 1}</span>
                <span className={`grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold ${avatarTones[hashString(name) % avatarTones.length]}`}>
                  {initialsOf(name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{name}</p>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#eef2f0]">
                    <span
                      className="grow-x block h-full rounded-full bg-[#315f50]"
                      style={{ width: `${Math.max(4, (result.responses / Math.max(1, answered.length)) * 100)}%`, animationDelay: `${index * 80}ms` }}
                    />
                  </div>
                </div>
                <span className="w-16 text-right text-xs text-[#647577] tabular-nums sm:w-20">
                  {result.responses} {result.responses === 1 ? "reply" : "replies"}
                </span>
                <TimerPill elapsed={averageSeconds} tone={tone} />
              </div>
            );
          })}
        </div>
        {team.size === 0 && <p className="px-5 py-12 text-center text-sm text-[#718184]">Performance will populate as team members respond through Recharge.</p>}
      </section>

      <section className="surface overflow-hidden rounded-[1.5rem] border border-[#d9e2df] bg-white">
        <div className="border-b border-[#e8eeeb] px-5 py-4 sm:px-6">
          <p className="text-sm font-semibold">Communication cover</p>
          <p className="mt-0.5 text-xs text-[#718184]">The next seven days from My Recharge. Response ownership is measured against this rota.</p>
        </div>
        <div className="divide-y divide-[#eef2f0]">
          {[...scheduleByDay.entries()].map(([date, shifts]) => (
            <div key={date} className="flex gap-4 px-5 py-4 sm:px-6">
              <ShiftDate value={date} />
              <div className="flex flex-1 flex-wrap gap-2">
                {shifts.map((shift) => (
                  <span key={shift.id} className="inline-flex items-center gap-2 rounded-full border border-[#e1e9e5] bg-[#f8faf9] py-1 pl-1 pr-3 text-xs">
                    <span className={`grid size-6 place-items-center rounded-full text-[0.6rem] font-bold ${avatarTones[hashString(shift.name) % avatarTones.length]}`}>
                      {initialsOf(shift.name)}
                    </span>
                    <span className="font-semibold">{shift.name}</span>
                    <span className="tabular-nums text-[#718184]">{shift.startTime}–{shift.endTime}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        {data.schedule.length === 0 && (
          <p className="px-5 py-10 text-center text-sm text-[#718184]">No communication shifts are scheduled in the next seven days.</p>
        )}
      </section>
    </div>
  );
}

function ShiftDate({ value }: { value: string }) {
  const date = new Date(`${value}T12:00:00Z`);
  return (
    <div className="grid w-12 shrink-0 place-items-center rounded-xl border border-[#e1e9e5] bg-white py-1.5 text-center">
      <span className="text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-[#81908d]">
        {new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(date)}
      </span>
      <span className="text-lg font-semibold leading-tight tabular-nums">{date.getUTCDate()}</span>
    </div>
  );
}

function CentreStat({ label, value, note, alert = false, tone = "neutral" }: { label: string; value: string; note: string; alert?: boolean; tone?: "neutral" | "amber" | "red" }) {
  const accent = alert ? (tone === "red" ? "text-[#9c3737]" : "text-[#86601a]") : "text-[#1c3934]";
  return (
    <article className={`surface flex flex-col rounded-[1.4rem] border bg-white p-4 sm:p-5 ${alert ? (tone === "red" ? "border-[#efc6c3]" : "border-[#ecd9a8]") : "border-[#d9e2df]"}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[#718184]">{label}</p>
        {alert && <AlertTriangle className={`size-4 shrink-0 ${accent}`} />}
      </div>
      <p className={`mt-auto pt-5 text-3xl font-semibold tabular-nums tracking-[-0.05em] sm:text-4xl ${accent}`}>{value}</p>
      <p className="mt-1 text-xs text-[#819093]">{note}</p>
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

/* ───────────────────────── Helpers ───────────────────────── */

function averageResponseSeconds(threads: CommunicationThread[]) {
  const seconds = threads.flatMap((thread) =>
    thread.messages
      .filter((message) => message.direction === "inbound" && message.respondedAt)
      .map((message) => Math.max(0, (message.respondedAt || message.sentAt) - message.sentAt)),
  );
  return seconds.length ? Math.round(seconds.reduce((sum, value) => sum + value, 0) / seconds.length) : null;
}

function splitTriggers(value: string) {
  return Array.from(new Set(value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean)));
}

function initialsOf(value: string) {
  const clean = value.includes("@") ? value.split("@")[0] : value;
  return (
    clean
      .split(/[ ._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase())
      .join("") || "G"
  );
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function relativeTime(timestamp: number, now: number) {
  const diff = Math.max(0, now - timestamp);
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 7 * 86400) return new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(new Date(timestamp * 1000));
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(timestamp * 1000));
}

function dayKey(timestamp: number) {
  const date = new Date(timestamp * 1000);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(timestamp: number, now: number) {
  if (dayKey(timestamp) === dayKey(now)) return "Today";
  if (dayKey(timestamp) === dayKey(now - 86400)) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date(timestamp * 1000));
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp * 1000));
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



function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(timestamp * 1000));
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

function ChannelLogo({ thread, source }: { thread: CommunicationThread; source: CommunicationSource }) {
  const platform = communicationPlatform(thread, source);
  const base = "grid size-4 shrink-0 place-items-center overflow-hidden rounded-full text-[0.45rem] font-black text-white";
  if (platform === "Recharge Direct") {
    return <span className={`${base} bg-[#1c3934]`} title="Recharge Direct"><img src="/favicon.svg" alt="" className="size-full object-cover" /></span>;
  }
  if (platform === "Airbnb") return <span className={`${base} bg-[#ff5a5f]`} title="Airbnb">A</span>;
  if (platform === "Booking.com") return <span className={`${base} bg-[#003580]`} title="Booking.com">B.</span>;
  if (platform === "WhatsApp") return <span className={`${base} bg-[#25d366]`} title="WhatsApp"><MessageCircle className="size-2.5" /></span>;
  return <span className={`${base} bg-[#315f50]`} title={platform}><Mail className="size-2.5" /></span>;
}

function BookingDetail({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><span className="block text-[#81908d]">{label}</span><strong className="mt-0.5 block break-words font-semibold text-[#29443e]">{value}</strong></div>;
}
