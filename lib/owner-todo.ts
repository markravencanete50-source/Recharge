import type { TrackerItem } from './tracker';
import { TODO_TARGETS, type TodoRow } from './todo';

// The super admins' To-do (Lee: "the super admin are the owners of the company"). It opens on what the company
// needs from them: the approvals and decisions waiting in Management approvals, and the to-dos given to them, the most
// important first. Buttons switch to their employees' to-dos, person by person, and to the whole company's list (every
// heading, with the Automatic tasks), which is what everyone else sees.
export type OwnerTodoView = 'mine' | 'team' | 'company';
export const OWNER_TODO_VIEWS: readonly OwnerTodoView[] = ['mine', 'team', 'company'];
export const OWNER_TODO_LABEL: Record<OwnerTodoView, string> = { mine: 'Needs you', team: "Employees' to-dos", company: 'Company to-do list' };
export const hasOwnerTodo = (role: string) => role === 'super_admin';

// An approval waiting in Management approvals, as a row that opens there.
export function approvalTodoRows(items: readonly TrackerItem[]): TodoRow[] {
  return items.filter(i => !i.closed).map(i => ({
    id: 'approval:' + i.id, source: 'derived' as const, heading: 'team' as const, title: 'Approve: ' + i.title, details: i.nextStep,
    propertyId: i.propertyId, address: i.address && i.address !== 'No property' ? i.address : null, dueOn: null, who: null,
    done: false, automatic: false, since: i.lastUpdate?.at ?? '', touched: i.lastUpdate?.at ?? '', derived: 'approval' as const,
    open: { target: TODO_TARGETS.approvals }, latest: null, updateCount: 0,
  }));
}

// A to-do is the owner's own when it is given to them, or when they wrote it for nobody else.
export const isOwnersOwn = (row: TodoRow, me: string) =>
  row.source === 'hub' && !!row.item && (row.item.assigneeId === me || (!row.item.assigneeId && !row.item.department && row.item.createdBy === me));

// Most important first: overdue, due today, approvals (the longest waiting first), due later, then no date.
const rank = (r: TodoRow, today: string) =>
  r.dueOn && r.dueOn < today ? 0 : r.dueOn === today ? 1 : r.derived === 'approval' ? 2 : r.dueOn ? 3 : 4;
export function byImportance(rows: readonly TodoRow[], today: string): TodoRow[] {
  return [...rows].sort((a, b) => rank(a, today) - rank(b, today) || (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999')
    || (a.since || '9999').localeCompare(b.since || '9999') || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

// What needs the owner: approvals and their own open to-dos, most important first.
export function ownerNeeds(rows: readonly TodoRow[], approvals: readonly TodoRow[], me: string, today: string): TodoRow[] {
  return byImportance([...approvals, ...rows.filter(r => !r.done && isOwnersOwn(r, me))], today);
}

// Everyone else's open to-dos, one group per person (or department when nobody is named), the group with the most
// overdue first, each group most important first.
export type TeamTodoGroup = { who: string; rows: TodoRow[]; overdue: number; dueToday: number };
export function teamTodoGroups(rows: readonly TodoRow[], me: string, today: string): TeamTodoGroup[] {
  const groups = new Map<string, TodoRow[]>();
  for (const r of rows) {
    if (r.done || r.source !== 'hub' || isOwnersOwn(r, me)) continue;
    const who = r.who && r.who !== 'Me' ? r.who : 'Not assigned';
    groups.set(who, [...(groups.get(who) ?? []), r]);
  }
  return [...groups].map(([who, list]) => ({
    who, rows: byImportance(list, today),
    overdue: list.filter(r => r.dueOn && r.dueOn < today).length, dueToday: list.filter(r => r.dueOn === today).length,
  })).sort((a, b) => b.overdue - a.overdue || b.dueToday - a.dueToday || b.rows.length - a.rows.length || a.who.localeCompare(b.who));
}
