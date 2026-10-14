import { londonClock } from './team-time';
import type { TodoHubItem } from './todo';
import type { TeamsAction } from './workspace-teams-policy';

// The Management centre's "Today's checklist": the to-dos the database made today from the Management
// daily tasks (Management → Daily tasks; each is a department to-do with a template, due that day). It is a
// view of the same to-dos the To-do list shows, so ticking one here is the same "moveHubItem" the To-do list
// sends, and the two always agree.
export const CHECKLIST_DEPARTMENT = 'management' as const;

// Admins and super admins, and anyone whose department (on the rota) is management.
export const seesManagementChecklist = (role: string, department: string | null | undefined) =>
  role === 'admin' || role === 'super_admin' || department === CHECKLIST_DEPARTMENT;
export const canSetUpChecklist = (role: string) => role === 'admin' || role === 'super_admin';

export type ChecklistRow = { id: string; title: string; details: string; done: boolean; tickedBy: string | null; tickedAt: string | null; item: TodoHubItem };

// Today's Management daily-task to-dos, in the order they were made. Hand-made to-dos, other departments'
// and other days' don't count, nor anything not open or done.
export function managementChecklist(items: readonly TodoHubItem[], today: string): ChecklistRow[] {
  return items
    .filter(i => i.kind === 'todo' && i.department === CHECKLIST_DEPARTMENT && !!i.templateId && i.dueOn === today && (i.status === 'open' || i.status === 'done'))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
    .map(i => ({ id: i.id, title: i.title, details: i.details, done: i.status === 'done', tickedBy: i.status === 'done' ? i.decidedBy : null, tickedAt: i.status === 'done' ? i.decidedAt : null, item: i }));
}

export function checklistProgress(rows: readonly ChecklistRow[]) {
  const done = rows.filter(r => r.done).length;
  return { done, total: rows.length, label: `${done} of ${rows.length} done` };
}

// One thin line under a ticked item: who ticked it and when (UK time).
export const tickedLine = (row: Pick<ChecklistRow, 'done' | 'tickedBy' | 'tickedAt'>) =>
  !row.done ? '' : [row.tickedBy ? `Ticked by ${row.tickedBy}` : 'Ticked', row.tickedAt ? `at ${londonClock(row.tickedAt)}` : ''].filter(Boolean).join(' ');

// Ticking or unticking: exactly the To-do list's action.
export const tickAction = (row: Pick<ChecklistRow, 'done' | 'item'>, requestId: string): Extract<TeamsAction, { action: 'moveHubItem' }> =>
  ({ action: 'moveHubItem', requestId, id: row.item.id, version: row.item.version, status: row.done ? 'open' : 'done' });
