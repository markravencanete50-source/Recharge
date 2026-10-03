"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, MessageSquare, X } from "lucide-react";
import type { CommunicationCentreData, CommunicationMessage } from "@/lib/communications";

type GuestNotification = {
  id: string;
  guestName: string;
  propertyName: string;
  body: string;
  sentAt: number;
};

export function GuestMessageNotifier({
  enabled,
  paused,
  initialData,
  onOpen,
}: {
  enabled: boolean;
  paused: boolean;
  initialData?: CommunicationCentreData;
  onOpen: () => void;
}) {
  const knownIds = useRef(
    new Set(
      (initialData?.threads || []).flatMap((thread) =>
        thread.messages.filter((message) => message.direction === "inbound").map((message) => message.id),
      ),
    ),
  );
  const [notification, setNotification] = useState<GuestNotification | null>(null);

  useEffect(() => {
    if (!enabled || paused) return;
    let stopped = false;

    const sync = async () => {
      try {
        const response = await fetch("/api/communications/hostaway/sync", {
          method: "POST",
          cache: "no-store",
        });
        const result = (await response.json().catch(() => null)) as
          | { data?: CommunicationCentreData }
          | null;
        if (!response.ok || stopped || !result?.data) return;

        const arrivals: Array<{ message: CommunicationMessage; guestName: string; propertyName: string }> = [];
        for (const thread of result.data.threads) {
          for (const message of thread.messages) {
            if (message.direction !== "inbound" || knownIds.current.has(message.id)) continue;
            knownIds.current.add(message.id);
            arrivals.push({ message, guestName: thread.guestName || "Guest", propertyName: thread.propertyName });
          }
        }
        const newest = arrivals.sort((a, b) => b.message.sentAt - a.message.sentAt)[0];
        if (newest) {
          setNotification({
            id: newest.message.id,
            guestName: newest.guestName,
            propertyName: newest.propertyName,
            body: newest.message.body,
            sentAt: newest.message.sentAt,
          });
        }
      } catch {
        // The next poll retries automatically; notifications should never interrupt the workspace.
      }
    };

    void sync();
    const interval = window.setInterval(() => void sync(), 4000);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [enabled, paused]);

  useEffect(() => {
    if (!notification) return;
    const timeout = window.setTimeout(() => setNotification(null), 10000);
    return () => window.clearTimeout(timeout);
  }, [notification]);

  if (!notification) return null;

  return (
    <div className="fixed right-4 top-4 z-[100] w-[min(24rem,calc(100vw-2rem))] animate-in slide-in-from-top-3">
      <button
        type="button"
        onClick={() => {
          setNotification(null);
          onOpen();
        }}
        className="w-full rounded-[1.5rem] border border-white/10 bg-[#173a31]/95 p-4 text-left text-white shadow-2xl backdrop-blur-xl"
      >
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#315f50]">
            <MessageSquare className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-white/65">
              <Bell className="size-3.5" /> New guest message
            </span>
            <strong className="mt-1 block truncate text-sm">{notification.guestName} · {notification.propertyName}</strong>
            <span className="mt-1 block line-clamp-2 text-sm leading-5 text-white/75">{notification.body}</span>
            <span className="mt-2 block text-xs text-white/50">
              {new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(notification.sentAt * 1000))} · Tap to open
            </span>
          </span>
          <span
            role="button"
            aria-label="Dismiss notification"
            onClick={(event) => {
              event.stopPropagation();
              setNotification(null);
            }}
            className="grid size-7 shrink-0 place-items-center rounded-full bg-white/10 text-white/70"
          >
            <X className="size-4" />
          </span>
        </div>
      </button>
    </div>
  );
}
