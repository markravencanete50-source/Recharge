import { homeToolsFor, panelToolsFor, type HomeToolTarget } from './home-tools';
import type { WorkView } from './tool-directory';
import { SUBS_BY_VIEW, WORK_SUBS, type WorkspaceSection } from './workspace-map';

// Every tool on a page of its own (Lee, 20 October 2026: "If it's receivable invoices it should be the receivable
// invoices page only"). A menu link, a search result, a Home card or a notification that points at one part of a
// department (a sub such as Accounts' "receivable", or a section heading such as Cleans' "Waiting for your review")
// opens a tool page: a link back to the department, the tool's title and what it is for, then that one part alone,
// with no other sections and no picker. The department's own link still opens the whole department.
//
// `only` is the focus key the department screen honours: a sub name (Accounts, Guest relations, Client relations,
// the Management centre) or a section anchor ("section-waiting-for-your-review"), which mobile/src/LiveKit.tsx Section
// matches against its heading. A tab target (the owner's Statements, Training in Help) focuses a part of that page.
export type ToolPageInfo = { only: string; title: string; detail?: string };
export type ToolFocusPlace = { section: WorkspaceSection; view?: WorkView; only: string };

// The Work areas whose screens show one part alone (mobile/src/LiveWorkspace.tsx workPage).
export const FOCUS_VIEWS: readonly WorkView[] = ['management', 'stays', 'clients', 'cleans', 'repairs', 'accounts'];
// The pages a tab target can focus a part of: the owner's Portfolio (Statements, Booking calendar) and Help's Training.
export const FOCUS_TABS: Partial<Record<WorkspaceSection, readonly string[]>> = {
  analytics: ['section-statements', 'section-booking-calendar', 'section-guests-and-stays'],
  help: ['section-training'],
};
// Where each department's tool pages lead back to.
export const DEPARTMENT_BACK: Partial<Record<WorkView, string>> = {
  management: 'Management centre', stays: 'Guest relations', clients: 'Client relations', cleans: 'Cleans', repairs: 'Maintenance', accounts: 'Accounts desk',
};

// Where a target opens as a tool page, and the part it shows; null for a whole page or department (or a form, or one job).
export function toolFocusFor(target: HomeToolTarget): ToolFocusPlace | null {
  if (target.kind === 'tab') {
    const parts = FOCUS_TABS[target.tab];
    return target.anchor && parts?.includes(target.anchor) ? { section: target.tab, only: target.anchor } : null;
  }
  if (target.kind !== 'work' || target.open || target.workId || !FOCUS_VIEWS.includes(target.view)) return null;
  const subs = SUBS_BY_VIEW[target.view];
  // A sub names the tool where the department has named tools; elsewhere (Maintenance's "visits-garden", "action") it
  // only presets a filter inside the section the anchor names.
  if (target.sub && subs?.includes(target.sub)) return { section: 'work', view: target.view, only: target.sub };
  if (target.anchor?.startsWith('section-')) return { section: 'work', view: target.view, only: target.anchor };
  return null;
}
// The focus key alone, for a target (null when it opens a whole page).
export const toolFocusKey = (target: HomeToolTarget): string | null => toolFocusFor(target)?.only ?? null;

const sameTarget = (a: HomeToolTarget, b: HomeToolTarget) => JSON.stringify(a) === JSON.stringify(b);
const sentence = (key: string) => { const words = key.replace(/^section-/, '').replace(/-/g, ' '); return words.charAt(0).toUpperCase() + words.slice(1); };
// The tool page for a target: its focus key, and the title and line that head it. The title is the menu's name for
// the link when there is one (`label`), otherwise the tool's own, otherwise the part's name.
export function toolPageFor(role: string, modules: readonly string[], target: HomeToolTarget, label?: string): ToolPageInfo | null {
  const place = toolFocusFor(target);
  if (!place) return null;
  const tool = [...homeToolsFor(role, modules), ...panelToolsFor(role, modules)].find(t => sameTarget(t.target, target));
  const sub = target.kind === 'work' ? WORK_SUBS.find(s => s.view === target.view && s.sub === place.only) : undefined;
  const title = label ?? tool?.label ?? sub?.label ?? sentence(place.only);
  return { only: place.only, title, ...(tool?.detail ? { detail: tool.detail } : {}) };
}
