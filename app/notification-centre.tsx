"use client";


import { useEffect, useMemo, useState } from "react";
import { Bell, CheckCheck, Clock3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { OnboardingData } from "@/lib/onboarding-types";
import type { WorkspaceRole } from "@/lib/modules";

type NotificationItem = {
  id: string;
  title: string;
  detail: string;
  property: string;
  createdAt: number;
  due: boolean;
};

export function NotificationCentre({
  initialData,
  role,
  onOpenOnboarding,
}: {
  initialData?: OnboardingData;
  role: WorkspaceRole;
  onOpenOnboarding: () => void;
}) {
  const [data, setData] = useState(initialData);
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState(0);

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(`recharge-notifications-seen:${role}`) || 0);
    setSeenAt(stored);
  }, [role]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const response = await fetch("/api/onboarding", { cache: "no-store" }).catch(() => null);
      if (!active || !response?.ok) return;
      const result = (await response.json().catch(() => null)) as { data?: OnboardingData } | null;
      if (result?.data) setData(result.data);
    };
    const timer = window.setInterval(refresh, 4_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const items = useMemo<NotificationItem[]>(() => {
    const now = Math.floor(Date.now() / 1000);
    return (data?.cases || []).flatMap((caseItem) => {
      const property = caseItem.propertyName || caseItem.propertyAddress;
      const actions = caseItem.updates.map((update) => ({
        id: update.id,
        title: update.eventType.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()),
        detail: update.note,
        property,
        createdAt: update.createdAt,
        due: false,
      }));
      const reminders = caseItem.notifications
        .filter((notification) => notification.status === "queued" && notification.dueAt <= now)
        .map((notification) => ({
          id: notification.id,
          title: notification.subject,
          detail: role === "client" ? "Open your property to complete the next action." : `Follow-up is now due for ${property}.`,
          property,
          createdAt: notification.dueAt,
          due: true,
        }));
      return [...actions, ...reminders];
    }).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
  }, [data?.cases, role]);

  const unread = items.filter((item) => item.createdAt > seenAt).length;

  function markRead() {
    const latest = items[0]?.createdAt || Math.floor(Date.now() / 1000);
    setSeenAt(latest);
    window.localStorage.setItem(`recharge-notifications-seen:${role}`, String(latest));
  }

  return (
    <Sheet open={open} onOpenChange={(value) => { setOpen(value); if (value) markRead(); }}>
      <SheetTrigger asChild>
        <button className="relative grid size-10 place-items-center rounded-xl border border-[var(--border)] bg-white text-[var(--foreground)] hover:bg-[var(--muted)]" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
          <Bell className="size-4" />
          {unread > 0 && <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-[#1c3934] px-1 text-[0.65rem] font-bold text-white">{Math.min(unread, 99)}</span>}
        </button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto border-[var(--border)] bg-[var(--card)] p-0 sm:max-w-md">
        <SheetHeader className="border-b border-[var(--border)] bg-white px-6 py-6 text-left">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div><SheetTitle className="text-2xl">Notification Centre</SheetTitle><SheetDescription className="mt-1">Every onboarding action and due follow-up in one place.</SheetDescription></div>
            <Badge className="border-0 bg-[var(--muted)] text-[var(--foreground)]">{unread} new</Badge>
          </div>
        </SheetHeader>
        <div className="space-y-3 p-4">
          {items.map((item) => (
            <button key={item.id} onClick={() => { setOpen(false); onOpenOnboarding(); }} className={`w-full rounded-2xl border p-4 text-left transition hover:border-[var(--border)] ${item.due ? "border-amber-300 bg-amber-50" : item.createdAt > seenAt ? "border-[var(--border)] bg-white" : "border-[var(--border)] bg-white/70"}`}>
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl ${item.due ? "bg-amber-100 text-amber-800" : "bg-[var(--muted)] text-[var(--muted-foreground)]"}`}>{item.due ? <Clock3 className="size-4" /> : <CheckCheck className="size-4" />}</span>
                <span className="min-w-0"><span className="block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">{item.property}</span><span className="mt-1 block font-semibold">{item.title}</span><span className="mt-1 block text-sm leading-5 text-[var(--muted-foreground)]">{item.detail}</span><span className="mt-2 block text-xs text-[var(--muted-foreground)]">{dateTime(item.createdAt)}</span></span>
              </div>
            </button>
          ))}
          {!items.length && <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-6 py-12 text-center"><Bell className="mx-auto size-6 text-[var(--muted-foreground)]" /><p className="mt-3 font-semibold">No notifications yet</p><p className="mt-1 text-sm text-[var(--muted-foreground)]">New actions will appear here automatically.</p></div>}
        </div>
        {items.length > 0 && <div className="sticky bottom-0 border-t border-[var(--border)] bg-white p-4"><Button variant="outline" className="w-full" onClick={markRead}><CheckCheck /> Mark all as read</Button></div>}
      </SheetContent>
    </Sheet>
  );
}

function dateTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp * 1000));
}
