import { z } from "zod";

// Cleaners report repairs themselves (Alex; database: migration 20261023100000). A cleaner reports what is broken from
// the clean they are on (reportCleanProblem), and it becomes the same repair the team would make, in the same flow.
// They follow the repairs they raised in "Repairs you reported", with a plain status and nothing about money, the owner
// or the contractor. The team see who raised each one (raisedBy, never sent to owners or contractors).

// GET /api/mobile/operations?section=cleanerRepairs reads rpc workspace_cleaner_repairs() (cleaners only).
export const CLEANER_REPAIRS_READ = { section: "cleanerRepairs", rpc: "workspace_cleaner_repairs" } as const;
export const cleanerRepairsQuery = () => "?" + new URLSearchParams({ section: CLEANER_REPAIRS_READ.section }).toString();

export const CLEANER_REPAIR_STATUSES = ["reported", "approval", "on_hold", "contractor", "booked", "fixed", "closed"] as const;
export type CleanerRepairStatus = (typeof CLEANER_REPAIR_STATUSES)[number];
export const cleanerRepairSchema = z.object({
  workId: z.string().uuid(), propertyId: z.string().uuid(), propertyName: z.string(), issue: z.string(), repairType: z.string(),
  urgent: z.boolean(), hazard: z.boolean(), status: z.enum(CLEANER_REPAIR_STATUSES), visitOn: z.string().nullable(), reportedAt: z.string(), cleanWorkId: z.string().nullable(),
});
export const cleanerRepairsSchema = z.array(cleanerRepairSchema);
export type CleanerRepair = z.infer<typeof cleanerRepairSchema>;
// Read leniently: an older server, or a list that does not parse, simply shows none.
export const readCleanerRepairList = (raw: unknown): CleanerRepair[] => { const parsed = cleanerRepairsSchema.safeParse(raw); return parsed.success ? parsed.data : []; };

// What each status says to the cleaner, and its tag tone.
export const CLEANER_REPAIR_STATUS: Record<CleanerRepairStatus, { label: string; detail: string; tone: "plain" | "wait" | "good" | "bad" }> = {
  reported: { label: "Reported", detail: "The team are looking at it.", tone: "wait" },
  approval: { label: "Waiting for approval", detail: "The repair is being approved before it goes ahead.", tone: "wait" },
  on_hold: { label: "On hold", detail: "The team are deciding what to do next.", tone: "plain" },
  contractor: { label: "With a contractor", detail: "A contractor has the job and will arrange a visit.", tone: "wait" },
  booked: { label: "Visit booked", detail: "A contractor is booked to come and fix it.", tone: "wait" },
  fixed: { label: "Fixed", detail: "The team have marked it as fixed.", tone: "good" },
  closed: { label: "Closed", detail: "Closed without a repair.", tone: "plain" },
};
export const cleanerRepairOpen = (status: CleanerRepairStatus) => status !== "fixed" && status !== "closed";

// For the team on a repair: "Cara Cleaner (cleaner), 17 Oct, from a clean"; null when a cleaner did not raise it.
// Repairs a cleaner reported before 20261023100000 only say they came from a clean.
export function raisedByLine(data: Record<string, unknown>, day: (iso: string) => string): string | null {
  const raised = data.raisedBy && typeof data.raisedBy === "object" ? data.raisedBy as Record<string, unknown> : null;
  if (raised && raised.role === "cleans") {
    const name = typeof raised.name === "string" && raised.name.trim() ? raised.name.trim() : "A cleaner";
    const at = typeof raised.at === "string" && !Number.isNaN(Date.parse(raised.at)) ? `, ${day(raised.at)}` : "";
    return `${name} (cleaner)${at}, from a clean`;
  }
  return typeof data.reportedFromClean === "string" ? "A cleaner, from a clean" : null;
}
