import { z } from 'zod';
import { FLAG_BLOCKED_ROLES, FLAG_MIN_CHARS } from './feedback-defaults';
import { poundsToMinor } from './repairs-live';
import type { TrackerItem } from './tracker';
import type { TeamsAction } from './workspace-teams-policy';

// Management flags: anything on the team can be flagged for management (a work item, a hub item, or a
// free-standing question with an optional amount). Admins resolve or decline; the person who raised
// it can withdraw it. This file is the pure part: types, parsing the read, marking tracker rows and
// ordering the merged Approvals list. The screens are mobile/src/ManagementFlag.tsx and
// ManagementApprovals.tsx. Package U1 fills in the rest; the names below are the contract.
const id = z.string().uuid();

export type FlagSource = 'work' | 'hub' | 'request' | 'clean_form';
export type FlagStatus = 'open' | 'resolved' | 'declined' | 'withdrawn';
// What FlagButton is pointed at. A free-standing request has neither id.
export type FlagTarget = { workId?: string; hubItemId?: string; propertyId?: string | null; title: string };

// One flag as the `flags` read returns it. Optional fields keep older and newer answers parsing.
export const flagSchema = z.object({
  id, source: z.enum(['work', 'hub', 'request', 'clean_form']), workId: id.nullable().optional(), hubItemId: id.nullable().optional(), propertyId: id.nullable().optional(),
  propertyName: z.string().nullable().optional(), title: z.string(), reason: z.string(), amountMinor: z.number().nullable().optional(),
  status: z.enum(['open', 'resolved', 'declined', 'withdrawn']), outcomeNote: z.string().nullable().optional(),
  // Null when the flag was raised automatically (a clean with no form).
  raisedBy: id.nullable().optional(), raisedByName: z.string().nullable().optional(), decidedBy: id.nullable().optional(), decidedByName: z.string().nullable().optional(), decidedAt: z.string().nullable().optional(),
  createdAt: z.string(), updatedAt: z.string().optional(), version: z.number(),
});
export type Flag = z.infer<typeof flagSchema>;
export const flagsSchema = z.object({ canDecide: z.boolean().optional(), me: id.optional(), flags: z.array(flagSchema) });

// The flags read answers an object ({ flags: [...] }) or a bare list; anything unreadable is no flags.
export function parseFlags(raw: unknown): Flag[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { flags?: unknown }).flags) ? (raw as { flags: unknown[] }).flags : [];
  return list.flatMap(row => { const r = flagSchema.safeParse(row); return r.success ? [r.data] : []; });
}

export const isOpenFlag = (flag: Pick<Flag, 'status'>) => flag.status === 'open';

// Team roles can flag; owners cannot. (The database refuses the same people.)
export const canFlag = (role: string | null | undefined): boolean => !!role && !(FLAG_BLOCKED_ROLES as readonly string[]).includes(role);

// Marks each tracker row that has an OPEN flag against its work item or hub item. A row matches by its
// work id, its own id (hub rows use the hub item id) or its hub item id. Returns copies; rows with no
// open flag come back with flagged false.
export function withFlags<T extends TrackerItem>(items: T[], flags: Flag[]): T[] {
  const works = new Set<string>(), hubs = new Set<string>();
  for (const f of flags) {
    if (!isOpenFlag(f)) continue;
    if (f.workId) works.add(f.workId);
    if (f.hubItemId) hubs.add(f.hubItemId);
  }
  return items.map(item => ({ ...item, flagged: (!!item.workId && works.has(item.workId)) || hubs.has(item.id) || (!!item.workId && hubs.has(item.workId)) }));
}

// The open flag on a target, if any (to show "Flagged" and offer withdraw instead of a second flag).
export function openFlagFor(flags: readonly Flag[], target: Pick<FlagTarget, 'workId' | 'hubItemId'>): Flag | null {
  return flags.find(f => isOpenFlag(f) && ((!!target.workId && f.workId === target.workId) || (!!target.hubItemId && f.hubItemId === target.hubItemId))) ?? null;
}

// What goes into the one Approvals list: flags, pending hub approvals and the management read all
// become an entry. `since` is when it started waiting; `open` is whether it still needs a decision.
export type ApprovalEntry<S = unknown> = { key: string; kind: 'flag' | 'approval' | 'management'; open: boolean; since: string; title: string; amountMinor: number | null; source: S };
export const flagEntry = (flag: Flag): ApprovalEntry<Flag> => ({ key: 'flag:' + flag.id, kind: 'flag', open: isOpenFlag(flag), since: flag.createdAt, title: flag.title, amountMinor: flag.amountMinor ?? null, source: flag });

// Open entries first, the longest-waiting at the top; decided ones follow, newest first. Returns a new list.
export function orderApprovals<T extends ApprovalEntry>(entries: readonly T[]): T[] {
  const at = (e: T) => { const t = Date.parse(e.since); return Number.isNaN(t) ? 0 : t; };
  return [...entries].sort((a, b) => Number(b.open) - Number(a.open) || (a.open ? at(a) - at(b) : at(b) - at(a)) || a.key.localeCompare(b.key));
}
export const mergeApprovals = <T extends ApprovalEntry>(flags: Flag[], others: readonly T[]): (T | ApprovalEntry<Flag>)[] => orderApprovals<T | ApprovalEntry<Flag>>([...flags.map(flagEntry), ...others]);

// A row with no record yet (no work item, no hub item) cannot be flagged: flagForManagement is strict and takes no
// property, so the flag would reach management as "Not about a property" and the row would never show Flagged.
export const FLAG_NEEDS_RECORD_HINT = 'Log a check first, then you can flag it';
export const canFlagTarget = (target: Pick<FlagTarget, 'workId' | 'hubItemId'>): boolean => !!(target.workId || target.hubItemId);

// The action FlagButton sends: the source follows the target. Reason needs FLAG_MIN_CHARS or more;
// the amount is optional pounds, turned into pence.
export function flagAction(target: FlagTarget, reason: string, amount: string, requestId: string): { action: Extract<TeamsAction, { action: 'flagForManagement' }> } | { error: string } {
  const why = reason.trim();
  if (why.length < FLAG_MIN_CHARS) return { error: 'Say why, in a few words.' };
  const money = amount.trim() ? poundsToMinor(amount) : null;
  if (amount.trim() && money === null) return { error: 'Enter the amount in pounds, like 120 or 120.50.' };
  const title = target.title.trim().slice(0, 200) || 'Flagged for management';
  const source = target.workId ? 'work' : target.hubItemId ? 'hub' : 'request';
  return { action: { action: 'flagForManagement', requestId, title, reason: why.slice(0, 2000), source, ...(money !== null ? { amountMinor: money } : {}),
    ...(source === 'work' ? { workId: target.workId } : source === 'hub' ? { hubItemId: target.hubItemId } : {}) } };
}
