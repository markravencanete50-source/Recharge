// Lucide v1.31.0 vector geometry, ISC licensed. See docs/LUCIDE-ARTWORK-LICENSE.txt.
import type { ModuleId } from "./modules";
import type { DepartmentTone } from "./workspace-map";
export const featureGlyphs = {
  "clean-client-database": "users",
  "cleaner-database": "user-round-check",
  "client-dashboard": "chart-pie",
  "clean-reporting": "clipboard-list",
  "clean-property-onboarding": "list-checks",
  "cleaner-performance": "award",
  "cleaning-schedule": "calendar-days",
  "ready-schedule": "calendar-clock",
  "maintenance-reporting": "wrench",
  "stays-maintenance-reporting": "activity",
  "client-property-maintenance": "triangle-alert",
  "property-database": "building-2",
  "property-onboarding": "key-round",
  "direct-bookings": "calendar-check",
  "new-property-inspection-board": "scan-search",
  "safety-maintenance": "shield-check",
  "routine-bin-garden-board": "sprout",
  "guest-communication": "messages-square",
  "client-mailbox": "mail",
  "purchase-order": "shopping-bag",
  "purchase-order-requests": "send",
  "client-purchase-order-quotes": "file-check-corner",
  "replenishment-requests": "package-open",
  "property-furnishing-board": "sofa",
  "client-furnishing": "sliders-horizontal",
  "aircover-reporting": "umbrella",
  "ota-logins": "lock-keyhole",
  licensing: "file-badge",
  "daily-pricing": "trending-up",
  "weekly-performance": "chart-no-axes-combined",
  "listing-health": "badge-check",
  "cleans-invoices": "receipt-pound-sterling",
  "maintenance-reconciliation": "git-merge",
  "onboarding-invoices": "file-plus-corner",
  "purchase-order-invoices": "credit-card",
  "purchase-order-accounts": "briefcase-business",
  "owner-statements": "book-open-text",
} as const satisfies Record<ModuleId, string>;
export const departmentGlyphs = {
  stays: "hotel",
  ready: "hard-hat",
  cleans: "spray-can",
  clients: "handshake",
  accounts: "circle-pound-sterling",
} as const satisfies Record<DepartmentTone, string>;
// Each tool carries its own earthy hue, chosen by the kind of work it does
// (calendars teal, money ochre, repairs terracotta, people heather) so tiles
// stay distinct inside a department while the palette stays minimal.
export const toolHueSwatches = {
  forest: { light: { ink: "#1F5F55", wash: "#DCEAE4", glow: "#A7D9C1" }, dark: { ink: "#8FD3C2", wash: "#173A33", glow: "#2E6B5E" } },
  moss: { light: { ink: "#3F6A2A", wash: "#E4EDD8", glow: "#B7DA92" }, dark: { ink: "#B7DA92", wash: "#22341A", glow: "#47662F" } },
  ochre: { light: { ink: "#875A1C", wash: "#F3E7CF", glow: "#E8C27D" }, dark: { ink: "#E8C27D", wash: "#3A2C15", glow: "#6E5225" } },
  terracotta: { light: { ink: "#9A4426", wash: "#F5E0D3", glow: "#F2AE8C" }, dark: { ink: "#F2AE8C", wash: "#3D2217", glow: "#74402A" } },
  clay: { light: { ink: "#8E3F38", wash: "#F2E1DB", glow: "#EDAAA1" }, dark: { ink: "#EDAAA1", wash: "#3A201D", glow: "#6E3A33" } },
  slate: { light: { ink: "#3B5866", wash: "#DFE7E8", glow: "#A9C6D2" }, dark: { ink: "#A9C6D2", wash: "#1D2F36", glow: "#3B5A66" } },
  heather: { light: { ink: "#6B4768", wash: "#EDE1EA", glow: "#D9B5D5" }, dark: { ink: "#D9B5D5", wash: "#30212F", glow: "#5E405B" } },
  teal: { light: { ink: "#1D6470", wash: "#D8EBEC", glow: "#8CCFD8" }, dark: { ink: "#8CCFD8", wash: "#15343A", glow: "#2C6570" } },
  olive: { light: { ink: "#635D1C", wash: "#EEEBCF", glow: "#D9CF85" }, dark: { ink: "#D9CF85", wash: "#302D14", glow: "#5E5726" } },
} as const;
export type ToolHue = keyof typeof toolHueSwatches;
export const toolHues = {
  "clean-client-database": "heather",
  "cleaner-database": "forest",
  "client-dashboard": "moss",
  "clean-reporting": "slate",
  "clean-property-onboarding": "olive",
  "cleaner-performance": "ochre",
  "cleaning-schedule": "teal",
  "ready-schedule": "teal",
  "maintenance-reporting": "terracotta",
  "stays-maintenance-reporting": "terracotta",
  "client-property-maintenance": "clay",
  "property-database": "forest",
  "property-onboarding": "olive",
  "direct-bookings": "teal",
  "new-property-inspection-board": "slate",
  "safety-maintenance": "moss",
  "routine-bin-garden-board": "moss",
  "guest-communication": "slate",
  "client-mailbox": "heather",
  "purchase-order": "terracotta",
  "purchase-order-requests": "teal",
  "client-purchase-order-quotes": "forest",
  "replenishment-requests": "ochre",
  "property-furnishing-board": "heather",
  "client-furnishing": "slate",
  "aircover-reporting": "clay",
  "ota-logins": "forest",
  licensing: "olive",
  "daily-pricing": "moss",
  "weekly-performance": "teal",
  "listing-health": "forest",
  "cleans-invoices": "ochre",
  "maintenance-reconciliation": "slate",
  "onboarding-invoices": "olive",
  "purchase-order-invoices": "terracotta",
  "purchase-order-accounts": "heather",
  "owner-statements": "ochre",
} as const satisfies Record<ModuleId, ToolHue>;
export const iconNodes: Record<
  string,
  readonly (readonly [string, Record<string, string | number>])[]
> = {
  users: [
    [
      "path",
      {
        d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
      },
    ],
    [
      "path",
      {
        d: "M16 3.128a4 4 0 0 1 0 7.744",
      },
    ],
    [
      "path",
      {
        d: "M22 21v-2a4 4 0 0 0-3-3.87",
      },
    ],
    [
      "circle",
      {
        cx: "9",
        cy: "7",
        r: "4",
      },
    ],
  ],
  "user-round-check": [
    [
      "path",
      {
        d: "M2 21a8 8 0 0 1 13.292-6",
      },
    ],
    [
      "circle",
      {
        cx: "10",
        cy: "8",
        r: "5",
      },
    ],
    [
      "path",
      {
        d: "m16 19 2 2 4-4",
      },
    ],
  ],
  "chart-pie": [
    [
      "path",
      {
        d: "M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z",
      },
    ],
    [
      "path",
      {
        d: "M21.21 15.89A10 10 0 1 1 8 2.83",
      },
    ],
  ],
  "clipboard-list": [
    [
      "rect",
      {
        width: "8",
        height: "4",
        x: "8",
        y: "2",
        rx: "1",
        ry: "1",
      },
    ],
    [
      "path",
      {
        d: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2",
      },
    ],
    [
      "path",
      {
        d: "M12 11h4",
      },
    ],
    [
      "path",
      {
        d: "M12 16h4",
      },
    ],
    [
      "path",
      {
        d: "M8 11h.01",
      },
    ],
    [
      "path",
      {
        d: "M8 16h.01",
      },
    ],
  ],
  "list-checks": [
    [
      "path",
      {
        d: "M13 5h8",
      },
    ],
    [
      "path",
      {
        d: "M13 12h8",
      },
    ],
    [
      "path",
      {
        d: "M13 19h8",
      },
    ],
    [
      "path",
      {
        d: "m3 17 2 2 4-4",
      },
    ],
    [
      "path",
      {
        d: "m3 7 2 2 4-4",
      },
    ],
  ],
  award: [
    [
      "path",
      {
        d: "m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526",
      },
    ],
    [
      "circle",
      {
        cx: "12",
        cy: "8",
        r: "6",
      },
    ],
  ],
  "calendar-days": [
    [
      "path",
      {
        d: "M8 2v3",
      },
    ],
    [
      "path",
      {
        d: "M16 2v3",
      },
    ],
    [
      "rect",
      {
        x: "3",
        y: "3",
        width: "18",
        height: "18",
        rx: "2",
      },
    ],
    [
      "path",
      {
        d: "M3 9h18",
      },
    ],
    [
      "path",
      {
        d: "M8 13h.01",
      },
    ],
    [
      "path",
      {
        d: "M12 13h.01",
      },
    ],
    [
      "path",
      {
        d: "M16 13h.01",
      },
    ],
    [
      "path",
      {
        d: "M8 17h.01",
      },
    ],
    [
      "path",
      {
        d: "M12 17h.01",
      },
    ],
    [
      "path",
      {
        d: "M16 17h.01",
      },
    ],
  ],
  "calendar-clock": [
    [
      "path",
      {
        d: "M16 14v2.2l1.6 1",
      },
    ],
    [
      "path",
      {
        d: "M16 2v3",
      },
    ],
    [
      "path",
      {
        d: "M21 7.338V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h2.338",
      },
    ],
    [
      "path",
      {
        d: "M3 9h5.859",
      },
    ],
    [
      "path",
      {
        d: "M8 2v3",
      },
    ],
    [
      "circle",
      {
        cx: "16",
        cy: "16",
        r: "6",
      },
    ],
  ],
  wrench: [
    [
      "path",
      {
        d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z",
      },
    ],
  ],
  activity: [
    [
      "path",
      {
        d: "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
      },
    ],
  ],
  "triangle-alert": [
    [
      "path",
      {
        d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
      },
    ],
    [
      "path",
      {
        d: "M12 9v4",
      },
    ],
    [
      "path",
      {
        d: "M12 17h.01",
      },
    ],
  ],
  "building-2": [
    [
      "path",
      {
        d: "M10 12h4",
      },
    ],
    [
      "path",
      {
        d: "M10 8h4",
      },
    ],
    [
      "path",
      {
        d: "M14 21v-3a2 2 0 0 0-4 0v3",
      },
    ],
    [
      "path",
      {
        d: "M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2",
      },
    ],
    [
      "path",
      {
        d: "M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16",
      },
    ],
  ],
  "key-round": [
    [
      "path",
      {
        d: "M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z",
      },
    ],
    [
      "circle",
      {
        cx: "16.5",
        cy: "7.5",
        r: ".5",
        fill: "currentColor",
      },
    ],
  ],
  "calendar-check": [
    [
      "path",
      {
        d: "M8 2v3",
      },
    ],
    [
      "path",
      {
        d: "M16 2v3",
      },
    ],
    [
      "rect",
      {
        x: "3",
        y: "3",
        width: "18",
        height: "18",
        rx: "2",
      },
    ],
    [
      "path",
      {
        d: "M3 9h18",
      },
    ],
    [
      "path",
      {
        d: "m9 15 2 2 4-4",
      },
    ],
  ],
  "scan-search": [
    [
      "path",
      {
        d: "M3 7V5a2 2 0 0 1 2-2h2",
      },
    ],
    [
      "path",
      {
        d: "M17 3h2a2 2 0 0 1 2 2v2",
      },
    ],
    [
      "path",
      {
        d: "M21 17v2a2 2 0 0 1-2 2h-2",
      },
    ],
    [
      "path",
      {
        d: "M7 21H5a2 2 0 0 1-2-2v-2",
      },
    ],
    [
      "circle",
      {
        cx: "12",
        cy: "12",
        r: "3",
      },
    ],
    [
      "path",
      {
        d: "m16 16-1.9-1.9",
      },
    ],
  ],
  "shield-check": [
    [
      "path",
      {
        d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
      },
    ],
    [
      "path",
      {
        d: "m9 12 2 2 4-4",
      },
    ],
  ],
  sprout: [
    [
      "path",
      {
        d: "M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3",
      },
    ],
    [
      "path",
      {
        d: "M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4",
      },
    ],
    [
      "path",
      {
        d: "M5 21h14",
      },
    ],
  ],
  "messages-square": [
    [
      "path",
      {
        d: "M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z",
      },
    ],
    [
      "path",
      {
        d: "M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1",
      },
    ],
  ],
  mail: [
    [
      "path",
      {
        d: "m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7",
      },
    ],
    [
      "rect",
      {
        x: "2",
        y: "4",
        width: "20",
        height: "16",
        rx: "2",
      },
    ],
  ],
  "shopping-bag": [
    [
      "path",
      {
        d: "M16 10a4 4 0 0 1-8 0",
      },
    ],
    [
      "path",
      {
        d: "M3.103 6.034h17.794",
      },
    ],
    [
      "path",
      {
        d: "M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z",
      },
    ],
  ],
  send: [
    [
      "path",
      {
        d: "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z",
      },
    ],
    [
      "path",
      {
        d: "m21.854 2.147-10.94 10.939",
      },
    ],
  ],
  "file-check-corner": [
    [
      "path",
      {
        d: "M10.5 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v6",
      },
    ],
    [
      "path",
      {
        d: "M14 2v5a1 1 0 0 0 1 1h5",
      },
    ],
    [
      "path",
      {
        d: "m14 20 2 2 4-4",
      },
    ],
  ],
  "package-open": [
    [
      "path",
      {
        d: "M12 22v-9",
      },
    ],
    [
      "path",
      {
        d: "M15.17 2.21a1.67 1.67 0 0 1 1.63 0L21 4.57a1.93 1.93 0 0 1 0 3.36L8.82 14.79a1.655 1.655 0 0 1-1.64 0L3 12.43a1.93 1.93 0 0 1 0-3.36z",
      },
    ],
    [
      "path",
      {
        d: "M20 13v3.87a2.06 2.06 0 0 1-1.11 1.83l-6 3.08a1.93 1.93 0 0 1-1.78 0l-6-3.08A2.06 2.06 0 0 1 4 16.87V13",
      },
    ],
    [
      "path",
      {
        d: "M21 12.43a1.93 1.93 0 0 0 0-3.36L8.83 2.2a1.64 1.64 0 0 0-1.63 0L3 4.57a1.93 1.93 0 0 0 0 3.36l12.18 6.86a1.636 1.636 0 0 0 1.63 0z",
      },
    ],
  ],
  sofa: [
    [
      "path",
      {
        d: "M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3",
      },
    ],
    [
      "path",
      {
        d: "M2 16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z",
      },
    ],
    [
      "path",
      {
        d: "M4 18v2",
      },
    ],
    [
      "path",
      {
        d: "M20 18v2",
      },
    ],
    [
      "path",
      {
        d: "M12 4v9",
      },
    ],
  ],
  "sliders-horizontal": [
    [
      "path",
      {
        d: "M10 5H3",
      },
    ],
    [
      "path",
      {
        d: "M12 19H3",
      },
    ],
    [
      "path",
      {
        d: "M14 3v4",
      },
    ],
    [
      "path",
      {
        d: "M16 17v4",
      },
    ],
    [
      "path",
      {
        d: "M21 12h-9",
      },
    ],
    [
      "path",
      {
        d: "M21 19h-5",
      },
    ],
    [
      "path",
      {
        d: "M21 5h-7",
      },
    ],
    [
      "path",
      {
        d: "M8 10v4",
      },
    ],
    [
      "path",
      {
        d: "M8 12H3",
      },
    ],
  ],
  umbrella: [
    [
      "path",
      {
        d: "M12 13v7a2 2 0 0 0 4 0",
      },
    ],
    [
      "path",
      {
        d: "M12 2v2",
      },
    ],
    [
      "path",
      {
        d: "M20.992 13a1 1 0 0 0 .97-1.274 10.284 10.284 0 0 0-19.923 0A1 1 0 0 0 3 13z",
      },
    ],
  ],
  "lock-keyhole": [
    [
      "circle",
      {
        cx: "12",
        cy: "16",
        r: "1",
      },
    ],
    [
      "rect",
      {
        x: "3",
        y: "10",
        width: "18",
        height: "12",
        rx: "2",
      },
    ],
    [
      "path",
      {
        d: "M7 10V7a5 5 0 0 1 10 0v3",
      },
    ],
  ],
  "file-badge": [
    [
      "path",
      {
        d: "M13 22h5a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v3.3",
      },
    ],
    [
      "path",
      {
        d: "M14 2v5a1 1 0 0 0 1 1h5",
      },
    ],
    [
      "path",
      {
        d: "m7.69 16.479 1.29 4.88a.5.5 0 0 1-.698.591l-1.843-.849a1 1 0 0 0-.879.001l-1.846.85a.5.5 0 0 1-.692-.593l1.29-4.88",
      },
    ],
    [
      "circle",
      {
        cx: "6",
        cy: "14",
        r: "3",
      },
    ],
  ],
  "trending-up": [
    [
      "path",
      {
        d: "M16 7h6v6",
      },
    ],
    [
      "path",
      {
        d: "m22 7-8.5 8.5-5-5L2 17",
      },
    ],
  ],
  "chart-no-axes-combined": [
    [
      "path",
      {
        d: "M12 16v5",
      },
    ],
    [
      "path",
      {
        d: "M16 14.639V21",
      },
    ],
    [
      "path",
      {
        d: "M20 10.656V21",
      },
    ],
    [
      "path",
      {
        d: "m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15",
      },
    ],
    [
      "path",
      {
        d: "M4 18.463V21",
      },
    ],
    [
      "path",
      {
        d: "M8 14.656V21",
      },
    ],
  ],
  "badge-check": [
    [
      "path",
      {
        d: "M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z",
      },
    ],
    [
      "path",
      {
        d: "m9 12 2 2 4-4",
      },
    ],
  ],
  "receipt-pound-sterling": [
    [
      "path",
      {
        d: "M10 17V9.5a1 1 0 0 1 5 0",
      },
    ],
    [
      "path",
      {
        d: "M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z",
      },
    ],
    [
      "path",
      {
        d: "M8 13h5",
      },
    ],
    [
      "path",
      {
        d: "M8 17h7",
      },
    ],
  ],
  "git-merge": [
    [
      "circle",
      {
        cx: "18",
        cy: "18",
        r: "3",
      },
    ],
    [
      "circle",
      {
        cx: "6",
        cy: "6",
        r: "3",
      },
    ],
    [
      "path",
      {
        d: "M6 21V9a9 9 0 0 0 9 9",
      },
    ],
  ],
  "file-plus-corner": [
    [
      "path",
      {
        d: "M11.35 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5.35",
      },
    ],
    [
      "path",
      {
        d: "M14 2v5a1 1 0 0 0 1 1h5",
      },
    ],
    [
      "path",
      {
        d: "M14 19h6",
      },
    ],
    [
      "path",
      {
        d: "M17 16v6",
      },
    ],
  ],
  "credit-card": [
    [
      "rect",
      {
        width: "20",
        height: "14",
        x: "2",
        y: "5",
        rx: "2",
      },
    ],
    [
      "line",
      {
        x1: "2",
        x2: "22",
        y1: "10",
        y2: "10",
      },
    ],
  ],
  "briefcase-business": [
    [
      "path",
      {
        d: "M12 12h.01",
      },
    ],
    [
      "path",
      {
        d: "M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2",
      },
    ],
    [
      "path",
      {
        d: "M22 13a18.15 18.15 0 0 1-20 0",
      },
    ],
    [
      "rect",
      {
        width: "20",
        height: "14",
        x: "2",
        y: "6",
        rx: "2",
      },
    ],
  ],
  "book-open-text": [
    [
      "path",
      {
        d: "M12 5v16",
      },
    ],
    [
      "path",
      {
        d: "M16 13h2",
      },
    ],
    [
      "path",
      {
        d: "M16 9h2",
      },
    ],
    [
      "path",
      {
        d: "M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z",
      },
    ],
    [
      "path",
      {
        d: "M6 13h2",
      },
    ],
    [
      "path",
      {
        d: "M6 9h2",
      },
    ],
  ],
  hotel: [
    [
      "path",
      {
        d: "M10 22v-6.57",
      },
    ],
    [
      "path",
      {
        d: "M12 11h.01",
      },
    ],
    [
      "path",
      {
        d: "M12 7h.01",
      },
    ],
    [
      "path",
      {
        d: "M14 15.43V22",
      },
    ],
    [
      "path",
      {
        d: "M15 16a5 5 0 0 0-6 0",
      },
    ],
    [
      "path",
      {
        d: "M16 11h.01",
      },
    ],
    [
      "path",
      {
        d: "M16 7h.01",
      },
    ],
    [
      "path",
      {
        d: "M8 11h.01",
      },
    ],
    [
      "path",
      {
        d: "M8 7h.01",
      },
    ],
    [
      "rect",
      {
        x: "4",
        y: "2",
        width: "16",
        height: "20",
        rx: "2",
      },
    ],
  ],
  "hard-hat": [
    [
      "path",
      {
        d: "M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5",
      },
    ],
    [
      "path",
      {
        d: "M14 6a6 6 0 0 1 6 6v3",
      },
    ],
    [
      "path",
      {
        d: "M4 15v-3a6 6 0 0 1 6-6",
      },
    ],
    [
      "rect",
      {
        x: "2",
        y: "15",
        width: "20",
        height: "4",
        rx: "1",
      },
    ],
  ],
  "spray-can": [
    [
      "path",
      {
        d: "M3 3h.01",
      },
    ],
    [
      "path",
      {
        d: "M7 5h.01",
      },
    ],
    [
      "path",
      {
        d: "M11 7h.01",
      },
    ],
    [
      "path",
      {
        d: "M3 7h.01",
      },
    ],
    [
      "path",
      {
        d: "M7 9h.01",
      },
    ],
    [
      "path",
      {
        d: "M3 11h.01",
      },
    ],
    [
      "rect",
      {
        width: "4",
        height: "4",
        x: "15",
        y: "5",
      },
    ],
    [
      "path",
      {
        d: "m19 9 2 2v10c0 .6-.4 1-1 1h-6c-.6 0-1-.4-1-1V11l2-2",
      },
    ],
    [
      "path",
      {
        d: "m13 14 8-2",
      },
    ],
    [
      "path",
      {
        d: "m13 19 8-2",
      },
    ],
  ],
  handshake: [
    [
      "path",
      {
        d: "m11 17 2 2a1 1 0 1 0 3-3",
      },
    ],
    [
      "path",
      {
        d: "m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4",
      },
    ],
    [
      "path",
      {
        d: "m21 3 1 11h-2",
      },
    ],
    [
      "path",
      {
        d: "M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3",
      },
    ],
    [
      "path",
      {
        d: "M3 4h8",
      },
    ],
  ],
  "circle-pound-sterling": [
    [
      "circle",
      {
        cx: "12",
        cy: "12",
        r: "10",
      },
    ],
    [
      "path",
      {
        d: "M10 16V9.5a1 1 0 0 1 5 0",
      },
    ],
    [
      "path",
      {
        d: "M8 12h4",
      },
    ],
    [
      "path",
      {
        d: "M8 16h7",
      },
    ],
  ],
  bookmark: [
    [
      "path",
      {
        d: "M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z",
      },
    ],
  ],
};
