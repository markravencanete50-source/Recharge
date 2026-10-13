import { formatDay } from './format';
import { daysFromNow, londonDayOf, VISIT_KIND_LABEL, visitChecklist, visitDates, visitFormOf, visitMoves, visitType } from './repairs-live';
import { addressOf, lastUpdateOf, progressOf, type TrackerItem, type TrackerStep } from './tracker';
import type { TrackerContext } from './tracker-sections';
import type { Detail } from './work-details';
import type { OperationView } from './workflow-forms';

// Preventative maintenance as tracker rows (client ask C8). One row per routine plan at a property:
// the visit that is open now, or the last one done when nothing is open. A row says what kind of visit it
// is, when it was last done, when the next is due, and whether it is Due, Overdue or Done. The visit form
// is its own step ("Record visit"); the database refuses to send a visit for review without it.
// Pure: no reads. Staff only; an owner gets nothing.
export const RECORD_VISIT_KEY = 'recordVisit';
const CAN_ACT = ['ready', 'stays', 'admin', 'super_admin'];
const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';
const isOpen = (w: OperationView) => !['completed', 'cancelled', 'declined'].includes(w.status);
const REVIEWED = ['in_review', 'approved', 'completed'];

export type PreventativeState = 'overdue' | 'due' | 'done';
export type PreventativeInfo = { state: PreventativeState; lastDoneAt: string | null; nextDueOn: string | null; formRecorded: boolean };

// The visits of one plan: grouped by the plan they came from, else by property and title.
const groupKey = (w: OperationView) => text(w.data.planId) || `${w.propertyId}:${w.title.trim().toLowerCase()}`;

// The visit a plan's row stands for: the open visit due first, else the latest finished one.
function currentVisit(visits: OperationView[]): OperationView | null {
  const byDue = (a: OperationView, b: OperationView) => (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999') || a.workId.localeCompare(b.workId);
  const open = visits.filter(isOpen).sort(byDue);
  if (open.length) return open[0];
  const done = visits.filter(w => w.status === 'completed').sort((a, b) => byDue(b, a));
  return done[0] ?? null;
}

// Last done, next due and the state of one plan's visits, against today (UK day, YYYY-MM-DD).
export function preventativeInfo(visits: OperationView[], today: string): PreventativeInfo | null {
  const current = currentVisit(visits);
  if (!current) return null;
  const formRecorded = visitFormOf(current.data) !== null;
  const stamps = visits.map(w => visitDates(w.data).lastDoneAt).filter((t): t is string => !!t && londonDayOf(t) !== null).sort();
  const lastDoneAt = stamps.length ? stamps[stamps.length - 1] : null;
  const laterOpen = visits.filter(w => isOpen(w) && w.workId !== current.workId).map(w => w.dueOn).filter((d): d is string => !!d).sort();
  const open = isOpen(current);
  const nextDueOn = open && !formRecorded ? current.dueOn ?? null : visitDates(current.data).nextDueOn ?? laterOpen[0] ?? null;
  const state: PreventativeState = formRecorded || !open ? 'done' : current.dueOn && current.dueOn < today ? 'overdue' : 'due';
  return { state, lastDoneAt, nextDueOn, formRecorded };
}

function stepsOf(work: OperationView, formRecorded: boolean): TrackerStep[] {
  const reviewed = REVIEWED.includes(work.status), signed = work.status === 'approved' || work.status === 'completed';
  const done = [work.status !== 'waiting', formRecorded, reviewed, signed];
  const base = [
    { key: 'start', label: 'Visit started' },
    { key: 'form', label: 'Visit form recorded', actionKey: RECORD_VISIT_KEY },
    { key: 'review', label: 'Sent for review' },
    { key: 'signoff', label: 'Signed off' },
  ];
  const firstTodo = done.findIndex(d => !d);
  const closed = work.status === 'completed' || work.status === 'cancelled';
  return base.map((s, i) => ({ ...s, state: done[i] ? 'done' as const : i === firstTodo && !closed ? 'current' as const : 'todo' as const }));
}

const STATE_LABEL: Record<PreventativeState, { label: string; tone: TrackerItem['status']['tone'] }> = {
  overdue: { label: 'Overdue', tone: 'bad' }, due: { label: 'Due', tone: 'wait' }, done: { label: 'Done', tone: 'good' },
};

// The row for one plan's visits (the current visit plus the plan's other visits for the history).
export function preventativeTrackerItem(visits: OperationView[], ctx: TrackerContext, role: string): TrackerItem<OperationView> | null {
  const work = currentVisit(visits);
  if (!work) return null;
  const today = londonDayOf(ctx.now.toISOString()) ?? ctx.now.toISOString().slice(0, 10);
  const info = preventativeInfo(visits, today);
  if (!info) return null;
  const property = ctx.property(work.propertyId), address = addressOf(property) || 'Unknown property', propertyName = property?.name?.trim() || address;
  const kind = visitType(work.title, work.data), kindLabel = VISIT_KIND_LABEL[kind], form = visitFormOf(work.data);
  const closed = work.status === 'completed' || work.status === 'cancelled';
  const steps = stepsOf(work, info.formRecorded);
  const lastDone = info.lastDoneAt ? londonDayOf(info.lastDoneAt) : null;
  const lastText = lastDone ? `last done ${daysFromNow(lastDone, today)}` : 'not done yet';
  const nextText = info.nextDueOn ? `next due ${formatDay(info.nextDueOn, ctx.now)}` : 'no next visit planned';
  const acts = CAN_ACT.includes(role);
  const move = acts ? visitMoves(role, work.status, info.formRecorded)[0] : undefined;
  const nextStep = closed ? `${kindLabel}: ${lastText}, ${nextText}`
    : !info.formRecorded ? `Record the visit: tick off the checklist (${lastText})`
      : work.status === 'in_review' ? 'Waiting for Guest relations to sign off'
        : move && !move.blocked ? move.label : `Visit done (${nextText})`;
  const nextAction: TrackerItem['nextAction'] = closed || !acts ? null
    : !info.formRecorded ? { label: 'Record visit', actionKey: RECORD_VISIT_KEY }
      : move && !move.blocked ? { label: move.label }
        : { label: work.status === 'in_review' ? 'Waiting for Guest relations' : 'Nothing more to do' };

  const details: Detail[] = [];
  const add = (label: string, value: string, tone?: Detail['tone']) => { if (value) details.push({ label, value, ...(tone ? { tone } : {}) }); };
  add('Visit type', kindLabel);
  add('Routine', work.title);
  add('Visit due', work.dueOn ? formatDay(work.dueOn, ctx.now) : '', info.state === 'overdue' ? 'bad' : undefined);
  add('Last done', lastDone ? `${formatDay(lastDone, ctx.now)} (${daysFromNow(lastDone, today)})` : 'Not done yet');
  add('Next due', info.nextDueOn ? formatDay(info.nextDueOn, ctx.now) : '');
  const items = visitChecklist(work);
  if (form) {
    add('Checklist', `${form.doneCount} of ${form.totalCount} done`, form.doneCount === form.totalCount ? 'good' : undefined);
    const missed = form.answers.filter(a => !a.done).map(a => a.note ? `${a.item}: ${a.note}` : a.item);
    add('Not done', missed.join('\n'), 'bad');
    add('Visit note', form.note);
    add('Photos', form.photoIds.length ? `${form.photoIds.length} saved with the form` : '');
  } else add('Checklist', `${items.length} item${items.length === 1 ? '' : 's'} to tick off`);

  return {
    id: work.workId, section: 'preventative', source: work, propertyId: work.propertyId, address, propertyName,
    title: work.title, status: STATE_LABEL[info.state], closed, nextStep, nextAction,
    lastUpdate: lastUpdateOf(work), progress: progressOf(steps), steps, details, workId: work.workId, version: work.version,
    search: [address, propertyName, work.title, kindLabel, STATE_LABEL[info.state].label, closed ? '' : nextStep].filter(Boolean).join(' '),
  };
}

// Every plan's row, overdue first (longest overdue first), then due soonest, then done and waiting for
// sign-off, then finished visits with the most recently done first. Routine visits only; owners get nothing.
export function preventativeTrackerItems(work: readonly OperationView[], ctx: TrackerContext, role: string): TrackerItem<OperationView>[] {
  if (ctx.owner) return [];
  const groups = new Map<string, OperationView[]>();
  for (const w of work) if (w.kind === 'routine_visit') groups.set(groupKey(w), [...(groups.get(groupKey(w)) ?? []), w]);
  const today = londonDayOf(ctx.now.toISOString()) ?? ctx.now.toISOString().slice(0, 10);
  const rows: { item: TrackerItem<OperationView>; rank: number; due: string; last: string }[] = [];
  for (const visits of groups.values()) {
    const item = preventativeTrackerItem(visits, ctx, role), info = preventativeInfo(visits, today);
    if (!item || !info) continue;
    const rank = item.closed ? 3 : info.state === 'overdue' ? 0 : info.state === 'due' ? 1 : 2;
    rows.push({ item, rank, due: info.nextDueOn ?? '9999-12-31', last: info.lastDoneAt ?? '' });
  }
  rows.sort((a, b) => a.rank - b.rank || (a.rank >= 2 ? b.last.localeCompare(a.last) : a.due.localeCompare(b.due)) || a.item.address.localeCompare(b.item.address) || a.item.id.localeCompare(b.item.id));
  return rows.map(r => r.item);
}
