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

// Optical bounds in the original assets. Isolating the object rather than a
// uniform grid cell prevents neighbouring artwork leaking into a card.
const bounds = [
  [[22,25,256,273],[338,28,231,271],[595,48,205,252],[848,33,255,267],[1107,36,286,269],
   [44,310,265,251],[300,301,268,264],[590,313,237,251],[841,326,263,237],[1122,292,262,280],
   [25,587,268,237],[295,566,279,247],[581,573,249,245],[849,580,269,236],[1111,570,284,252],
   [8,860,280,220],[289,829,281,272],[584,868,250,213],[876,830,236,260],[1114,829,282,268]],
  [[33,65,270,245],[298,76,255,235],[579,86,259,230],[854,71,249,243],[1110,94,276,218],
   [80,329,211,228],[308,331,255,233],[573,327,247,234],[841,339,268,219],[1134,335,230,230],
   [53,566,240,249],[300,569,273,247],[576,583,242,239],[830,584,259,224],[1118,567,263,242],
   [41,834,264,222],[327,839,228,228]],
];

/** Each tool has a unique cell; two cached atlases keep asset requests small. */
export function ToolIllustration({ id, className = "", fallback: Fallback = Boxes }: { id: ModuleId; className?: string; fallback?: typeof Boxes }) {
  const [failed, setFailed] = useState(false);
  const [atlas, cell] = illustrations[id];
  const [x, y, width, height] = bounds[atlas][cell];
  const scale = 90 / Math.max(width, height);
  const style = {
    width: `${1402 * scale}%`, height: `${1122 * scale}%`,
    left: `${(100 - width * scale) / 2 - x * scale}%`,
    top: `${(100 - height * scale) / 2 - y * scale}%`,
    clipPath: `inset(${y / 1122 * 100}% ${(1402 - x - width) / 1402 * 100}% ${(1122 - y - height) / 1122 * 100}% ${x / 1402 * 100}%)`,
  } as CSSProperties;
  return <span className={`tool-illustration ${className}`} aria-hidden="true">
    {failed ? <Fallback className="size-10 text-[var(--muted-foreground)]" /> : <img
      src={`/recharge-tools-${atlas + 1}.png`} alt="" width="1402" height="1122"
      className="tool-illustration-atlas" style={style} decoding="async"
      onError={() => setFailed(true)} draggable={false} />}
  </span>;
}
