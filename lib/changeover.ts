import { z } from 'zod';

// Changeovers (Business Plan, updated 17/10/26, Property Operations Processes; migration 20261031200000): the housekeeper's
// replenishable stock, the time the clean form is late after, and adding to an open repair instead of reporting it twice.
// The database checks the same as here.
export const STOCK_KEY = /^[a-z0-9_]{1,40}$/;
const id = z.string().uuid();
const amounts = (max: number) => z.record(z.string().regex(STOCK_KEY), z.number().int().min(0).max(max)).refine(r => Object.keys(r).length <= 40, 'Up to 40 items');
export const stockItemSettingSchema = z.object({
  key: z.string().regex(STOCK_KEY, 'Invalid item'), label: z.string().trim().min(1, 'Name every stock item').max(80, 'Keep each name under 80 characters'),
  minimum: z.number().int().min(0, 'A minimum of 0 to 1,000').max(1000, 'A minimum of 0 to 1,000'),
}).strict();
export const changeoverSettingsSchema = z.object({
  lateAfter: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Give the late time as HH:MM'),
  stock: z.array(stockItemSettingSchema).min(1, 'Keep at least one stock item').max(40, 'Up to 40 stock items')
    .refine(items => new Set(items.map(i => i.key)).size === items.length, 'Each stock item once'),
}).strict();
export type ChangeoverSettings = z.infer<typeof changeoverSettingsSchema>;

export const changeoverActionSchemas = [
  z.object({ action: z.literal('saveChangeoverSettings'), requestId: id, settings: changeoverSettingsSchema }).strict(),
  // A count names the clean (the housekeeper on it) or the property (the team): changeoverIssue checks one of them.
  z.object({ action: z.literal('countStock'), requestId: id, workId: id.optional(), propertyId: id.optional(), counts: amounts(100000) }).strict(),
  z.object({ action: z.literal('recordStockUse'), requestId: id, workId: id, used: amounts(1000) }).strict(),
  z.object({ action: z.literal('addRepairNote'), requestId: id, workId: id, repairId: id, note: z.string().trim().min(3, 'Say what you found (at least 3 characters)').max(1000) }).strict(),
] as const;

// What stops a changeover action that the shapes above cannot say; null when it can go.
export function changeoverIssue(v: { action: string; workId?: string; propertyId?: string; counts?: Record<string, number> }): string | null {
  if (v.action !== 'countStock') return null;
  if (!v.workId === !v.propertyId) return 'Choose the clean or the property';
  return Object.keys(v.counts ?? {}).length ? null : 'Count at least one item';
}

export const stockLineSchema = z.object({
  key: z.string(), label: z.string(), minimum: z.number(), onHand: z.number().nullable(), countedAt: z.string().nullable(), countedByName: z.string().nullable(),
  low: z.boolean(), restockOpen: z.boolean(),
});
export type StockLine = z.infer<typeof stockLineSchema>;
export const openRepairSchema = z.object({ workId: id, issue: z.string(), urgent: z.boolean(), reportedAt: z.string(), notes: z.number() });
export type OpenRepair = z.infer<typeof openRepairSchema>;
export const changeoverReadSchema = z.object({
  lateAfter: z.string(), canEditSettings: z.boolean(), settings: changeoverSettingsSchema.nullable(), canCount: z.boolean(),
  stock: z.array(stockLineSchema), used: z.record(z.number()).nullable(), repairs: z.array(openRepairSchema),
});
export type ChangeoverRead = z.infer<typeof changeoverReadSchema>;
export const stockResultSchema = z.object({ stock: z.array(stockLineSchema), used: z.record(z.number()).nullable() });

// "Send the form by 14:45 on the day of the clean. After that it counts as late."
export const lateLine = (lateAfter: string) => `Send the form by ${lateAfter} on the day of the clean. After that it counts as late in your performance.`;
// Late: sent after the late time on the clean's day (London), the rule "cleaning forms on time" measures.
export function sentLate(submittedAt: string | null | undefined, cleanDay: string | null | undefined, lateAfter: string): boolean {
  if (!submittedAt || !cleanDay) return false;
  const at = Date.parse(submittedAt);
  if (!Number.isFinite(at)) return false;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(at)).map(p => [p.type, p.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`, time = `${parts.hour}:${parts.minute}`;
  return day > cleanDay || (day === cleanDay && time > lateAfter);
}
// What the count will be after this clean's use, for the form ("9 left").
export const afterUse = (line: StockLine, used: number) => line.onHand === null ? null : Math.max(0, line.onHand - used);
// The stock lines below their minimum, for the property's card.
export const lowLines = (stock: readonly StockLine[]) => stock.filter(s => s.low);
// What housekeepers added to a repair on their changeovers (data.housekeeperNotesBy), newest first.
const noteSchema = z.object({ at: z.string(), name: z.string(), note: z.string() });
export function housekeeperNotes(data: Record<string, unknown> | null | undefined): z.infer<typeof noteSchema>[] {
  const list = Array.isArray(data?.housekeeperNotesBy) ? data.housekeeperNotesBy : [];
  return list.flatMap(n => { const r = noteSchema.safeParse(n); return r.success ? [r.data] : []; }).reverse();
}
// "Toilet rolls: 9 of 12" or "Toilet rolls: not counted yet".
export const stockText = (s: StockLine) => s.onHand === null ? `${s.label}: not counted yet` : `${s.label}: ${s.onHand} (minimum ${s.minimum})`;
