import { lastUpdateOf } from './tracker';
import { REPAIR_STAGES, repairStage, visitDone } from './repairs-live';
import { readableStage } from './workspace-view';
import type { OperationView } from './workflow-forms';

// What has been done at one property, for the detail sheet of the Properties table: reactive repairs
// and preventative (routine) visits as one timeline, newest first; and the property's owner statements.
// Pure. Owners never receive a staff name, and costs only reach the roles that already see repair costs.

export type HistoryKind = 'reactive' | 'preventative';
export type HistoryTone = 'good' | 'wait' | 'bad' | 'plain';
export type HistoryEntry = {
  workId: string; kind: HistoryKind; title: string;
  // The day the work was or is due (YYYY-MM-DD, or the day it was reported when nothing else is known).
  date: string;
  status: string; tone: HistoryTone; done: boolean;
  costMinor: number | null; costKind: 'actual' | 'estimate' | null;
  // Who last touched it. Always null for owners.
  by: string | null;
};
export const HISTORY_KIND_OF: Readonly<Record<string, HistoryKind>> = { maintenance: 'reactive', routine_visit: 'preventative' };

// The roles that see what a repair costs. Owners, cleaners and cleaning managers do not see it here.
const COST_ROLES = ['admin', 'super_admin', 'accounts', 'stays', 'ready'];
export const seesHistoryCost = (role: string) => COST_ROLES.includes(role);

const REPAIR_LABEL: Record<string, string> = Object.fromEntries(REPAIR_STAGES.map(s => [s.phase, s.label]));
const VISIT_LABEL: Record<string, string> = { waiting: 'To do', in_progress: 'In progress', in_review: 'Done, to sign off', approved: 'Signed off', completed: 'Completed', cancelled: 'Cancelled', declined: 'Declined' };
const day = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
const minor = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
// Sorting stamp for a day: noon UTC, so a date never slips across a day boundary.
const dayTime = (value: string) => Date.parse(value + 'T12:00:00Z');
const touched = (w: OperationView) => { const t = Date.parse(w.updatedAt ?? w.createdAt ?? ''); return Number.isNaN(t) ? 0 : t; };

function repairEntry(w: OperationView, viewer: { owner: boolean; costs: boolean }): HistoryEntry {
  const cancelled = w.status === 'cancelled' || w.status === 'declined';
  const phase = repairStage(w.data), closed = phase === 'closed';
  const done = phase === 'completed' || phase === 'paid' || phase === 'resolved';
  const actual = minor(w.data.actualCostMinor), estimate = minor(w.data.estimatedCostMinor);
  const cost = viewer.costs ? (done && actual !== null ? { costMinor: actual, costKind: 'actual' as const } : estimate !== null ? { costMinor: estimate, costKind: 'estimate' as const } : { costMinor: null, costKind: null }) : { costMinor: null, costKind: null };
  return {
    workId: w.workId, kind: 'reactive', title: w.title,
    date: day(w.data.repairOn) ?? day(w.dueOn) ?? day(w.createdAt) ?? day(w.updatedAt) ?? '',
    status: cancelled ? readableStage(w.status) : REPAIR_LABEL[phase] ?? readableStage(phase),
    tone: cancelled || closed || phase === 'owner_declined' || phase === 'management_declined' ? 'bad' : done ? 'good' : 'wait',
    done: done || closed || cancelled, ...cost,
    by: viewer.owner ? null : lastUpdateOf(w)?.by ?? null,
  };
}

function visitEntry(w: OperationView, viewer: { owner: boolean; costs: boolean }): HistoryEntry {
  const finished = visitDone(w.status), stopped = w.status === 'cancelled' || w.status === 'declined';
  return {
    workId: w.workId, kind: 'preventative', title: w.title,
    date: day(w.dueOn) ?? day(w.data.dueOn) ?? day(w.createdAt) ?? day(w.updatedAt) ?? '',
    status: VISIT_LABEL[w.status] ?? readableStage(w.status), tone: stopped ? 'bad' : finished ? 'good' : 'wait', done: finished || stopped,
    // Routine visits carry no cost of their own; the costs of what they find are repairs.
    costMinor: null, costKind: null,
    by: viewer.owner ? null : lastUpdateOf(w)?.by ?? null,
  };
}

// Reactive repairs and preventative visits at one property as one timeline, newest first (by the day
// of the work, then by the latest change, then by id so the order never wobbles).
export function propertyHistory(work: readonly OperationView[], propertyId: string, viewer: { owner?: boolean; costs?: boolean } = {}): HistoryEntry[] {
  const who = { owner: !!viewer.owner, costs: !viewer.owner && !!viewer.costs };
  const rows = work.filter(w => w.propertyId === propertyId && HISTORY_KIND_OF[w.kind]);
  return rows
    .map(w => ({ w, entry: HISTORY_KIND_OF[w.kind] === 'reactive' ? repairEntry(w, who) : visitEntry(w, who) }))
    .sort((a, b) => (b.entry.date ? dayTime(b.entry.date) : 0) - (a.entry.date ? dayTime(a.entry.date) : 0) || touched(b.w) - touched(a.w) || a.entry.workId.localeCompare(b.entry.workId))
    .map(r => r.entry);
}

export function historyGroups(entries: readonly HistoryEntry[]): Record<HistoryKind, HistoryEntry[]> {
  return { reactive: entries.filter(e => e.kind === 'reactive'), preventative: entries.filter(e => e.kind === 'preventative') };
}

// "12 Oct 2026", always with the year (history spans years), or a dash when there is no date.
export const historyDay = (iso: string) => /^\d{4}-\d{2}-\d{2}/.test(iso) ? new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '–';

// --- Statements and payout (finance roles only; the screen asks the database, which refuses everyone else).
export type StatementInput = { id: string; propertyId: string; period: string; status: string; payoutMinor: number; paidAt?: string | null; periodStart?: string | null; periodLastDay?: string | null };
export type StatementHistoryRow = { id: string; label: string; status: string; statusLabel: string; payoutMinor: number; paidAt: string | null };
const STATEMENT_STATUS: Record<string, string> = { draft: 'Draft', issued: 'Issued', paid: 'Paid' };
const monthLabel = (period: string) => /^\d{4}-\d{2}/.test(period) ? new Date(period.slice(0, 7) + '-01T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : period;
// One property's statements, newest period first, each listed once (the same statement can arrive in
// several monthly reads), voided ones left out.
export function statementHistory(statements: readonly StatementInput[], propertyId: string): StatementHistoryRow[] {
  const seen = new Map<string, StatementInput>();
  for (const s of statements) if (s.propertyId === propertyId && s.status !== 'void' && !seen.has(s.id)) seen.set(s.id, s);
  return [...seen.values()]
    .sort((a, b) => (b.periodStart ?? b.period).localeCompare(a.periodStart ?? a.period) || a.id.localeCompare(b.id))
    .map(s => ({
      id: s.id, status: s.status, statusLabel: STATEMENT_STATUS[s.status] ?? readableStage(s.status), payoutMinor: s.payoutMinor, paidAt: s.paidAt ?? null,
      label: s.periodStart && s.periodLastDay && !wholeMonth(s.periodStart, s.periodLastDay) ? `${historyDay(s.periodStart)} to ${historyDay(s.periodLastDay)}` : monthLabel(s.period),
    }));
}
// A period from the 1st to the last day of the same month reads as the month's name.
function wholeMonth(start: string, last: string) {
  const month = start.slice(0, 7), [y, m] = month.split('-').map(Number);
  return start.slice(0, 10) === month + '-01' && last.slice(0, 10) === month + '-' + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0');
}
