"use client";

import { useState, type CSSProperties } from "react";
import { Boxes } from "lucide-react";
import type { ModuleId } from "@/lib/modules";

const illustrations = {
  "clean-client-database": [0, 0], "cleaner-database": [0, 1], "client-dashboard": [0, 2],
  "clean-reporting": [0, 3], "clean-property-onboarding": [0, 4], "cleaner-performance": [0, 5],
  "cleaning-schedule": [0, 6], "ready-schedule": [0, 7],
  "maintenance-reporting": [0, 8], "stays-maintenance-reporting": [0, 9], "client-property-maintenance": [0, 10],
  "property-database": [0, 11], "property-onboarding": [0, 12], "direct-bookings": [0, 13],
  "new-property-inspection-board": [0, 14], "safety-maintenance": [0, 15], "routine-bin-garden-board": [0, 16],
  "guest-communication": [0, 17], "client-mailbox": [0, 18], "purchase-order": [0, 19],
  "purchase-order-requests": [1, 0], "client-purchase-order-quotes": [1, 1], "replenishment-requests": [1, 2],
  "property-furnishing-board": [1, 3], "client-furnishing": [1, 4],
  "aircover-reporting": [1, 5], "ota-logins": [1, 6], licensing: [1, 7],
  "daily-pricing": [1, 8], "weekly-performance": [1, 9], "listing-health": [1, 10],
  "cleans-invoices": [1, 11], "maintenance-reconciliation": [1, 12], "onboarding-invoices": [1, 13],
  "purchase-order-invoices": [1, 14], "purchase-order-accounts": [1, 15], "owner-statements": [1, 16],
} satisfies Record<ModuleId, [number, number]>;

/** Each tool has a unique cell; two cached atlases keep asset requests small. */
export function ToolIllustration({ id, className = "", fallback: Fallback = Boxes }: { id: ModuleId; className?: string; fallback?: typeof Boxes }) {
  const [failed, setFailed] = useState(false);
  const [atlas, cell] = illustrations[id];
  const row = Math.floor(cell / 5);
  // Optical alignment for the generated atlas; keep neighbouring artwork outside the crop.
  const rowOffset = atlas === 1 ? [-10, -12, 0, 8][row] : 0;
  const crop = id === "onboarding-invoices" ? "inset(50% 20% 28% 60%)"
    : id === "owner-statements" ? "inset(75% 60% 0 23%)"
    : id === "direct-bookings" ? "inset(50% 20% 28% 60%)" : undefined;
  const style = {
    width: "500%", height: "400%", left: `${-(cell % 5) * 100}%`, top: `${-row * 100 + rowOffset}%`,
    ...(crop ? {clipPath: crop} : {}),
  } as CSSProperties;
  return <span className={`tool-illustration ${className}`} aria-hidden="true">
    {failed ? <Fallback className="size-10 text-[#315f50]" /> : <img
      src={`/recharge-tools-${atlas + 1}.png`} alt="" width="1402" height="1122"
      className="tool-illustration-atlas" style={style} decoding="async"
      onError={() => setFailed(true)} draggable={false} />}
  </span>;
}
