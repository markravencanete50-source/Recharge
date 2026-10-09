import type { WorkspaceRole } from "./model";

// Fictional schedule entries so every calendar has something to open.
export type ScheduleKind = "clean" | "check-in" | "check-out" | "inspection" | "repair" | "routine" | "payment" | "report";
export type ScheduleEvent = {
  id: string;
  date: string;
  start: string;
  end: string;
  kind: ScheduleKind;
  title: string;
  property: string;
  person: string;
  guests?: number;
  note?: string;
};

export const KIND_LABEL: Record<ScheduleKind, string> = {
  clean: "Clean",
  "check-in": "Check-in",
  "check-out": "Check-out",
  inspection: "Inspection",
  repair: "Repair",
  routine: "Preventative maintenance",
  payment: "Payment run",
  report: "Report",
};
export const KIND_COLOUR: Record<ScheduleKind, { light: string; dark: string }> = {
  clean: { light: "#1D6470", dark: "#8CCFD8" },
  "check-in": { light: "#3F6A2A", dark: "#B7DA92" },
  "check-out": { light: "#875A1C", dark: "#E8C27D" },
  inspection: { light: "#3B5866", dark: "#A9C6D2" },
  repair: { light: "#9A4426", dark: "#F2AE8C" },
  routine: { light: "#635D1C", dark: "#D9CF85" },
  payment: { light: "#6B4768", dark: "#D9B5D5" },
  report: { light: "#1F5F55", dark: "#8FD3C2" },
};

const EDINBURGH = "Example Edinburgh Apartment";
const GLASGOW = "Example Glasgow Apartment";
const STIRLING = "Example Stirling Cottage";
export const CLEANERS = ["Example cleaner", "Example cleaner 2", "Example cleaner 3"];

const iso = (date: Date) => date.toISOString().slice(0, 10);

// A repeating fortnight of activity, laid across the visible weeks.
export function scheduleFor(role: WorkspaceRole, now = new Date()): ScheduleEvent[] {
  const base = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = (offset: number) => iso(new Date(base.getTime() + offset * 86400000));
  const events: ScheduleEvent[] = [];
  let n = 0;
  const add = (offset: number, start: string, end: string, kind: ScheduleKind, title: string, property: string, person: string, extra: Partial<ScheduleEvent> = {}) =>
    events.push({ id: "sch-" + n++, date: day(offset), start, end, kind, title, property, person, ...extra });
  for (let week = -3; week <= 4; week++) {
    const w = week * 7;
    // Guest turnovers drive the cleaning schedule.
    add(w + 0, "11:00", "11:30", "check-out", "Guest check-out", EDINBURGH, "Stays team", { guests: 2 });
    add(w + 0, "11:30", "14:00", "clean", "Turnover clean", EDINBURGH, CLEANERS[0], { guests: 3, note: "Next guests arrive at 3pm. Fresh linen for 3." });
    add(w + 0, "15:00", "15:30", "check-in", "Guest check-in", EDINBURGH, "Stays team", { guests: 3 });
    add(w + 2, "10:00", "12:30", "clean", "Turnover clean", GLASGOW, CLEANERS[1], { guests: 2, note: "Check the Wi-Fi router after last guest's report." });
    add(w + 2, "15:00", "15:30", "check-in", "Guest check-in", GLASGOW, "Stays team", { guests: 2 });
    add(w + 4, "09:30", "12:00", "clean", "Deep clean", STIRLING, CLEANERS[2], { guests: 4, note: "Monthly deep clean including oven and windows." });
    add(w + 5, "12:00", "14:30", "clean", "Turnover clean", EDINBURGH, CLEANERS[0], { guests: 2 });
    add(w + 1, "10:00", "11:00", "repair", "Boiler service", GLASGOW, "Ready team", { note: "Quote approved by the landlord." });
    add(w + 3, "14:00", "15:00", "routine", "Routine maintenance visit", w % 2 ? EDINBURGH : STIRLING, "Ready team");
    add(w + 1, "09:00", "09:30", "report", "Daily pricing review", "Portfolio", "Stays team");
    if (week % 2 === 0) add(w + 4, "13:00", "14:30", "inspection", "New property inspection", "Example Leith Townhouse", "Ready team");
    add(w + 4, "16:00", "17:00", "payment", "Supplier payment run", "Portfolio", "Accounts team");
  }
  const mine: Record<WorkspaceRole, ScheduleKind[] | "all"> = {
    super_admin: "all", admin: "all", stays: "all",
    cleans: ["clean"], cleaning_manager: ["clean", "check-in", "check-out"],
    ready: ["repair", "routine", "inspection"], accounts: ["payment", "report"], client: ["check-in", "check-out"],
  };
  const kinds = mine[role];
  return events
    .filter(event => kinds === "all" || kinds.includes(event.kind))
    .filter(event => role !== "cleans" || event.person === CLEANERS[0])
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}
