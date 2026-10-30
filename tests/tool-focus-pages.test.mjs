import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Lee (for Alex), 20 October 2026: "If it's receivable invoices it should be the receivable invoices page only." Every
// menu tool that points at one part of a department opens a tool page with only that part; the department's own link
// still opens the whole department. Each filtered calendar is a calendar of its own type, with no way to switch teams.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { rolePanel } = await vite.ssrLoadModule('/lib/role-panel.ts');
const { homeToolsFor, panelToolsFor, sectionAnchor } = await vite.ssrLoadModule('/lib/home-tools.ts');
const { DEFAULT_ROLE_MODULES, MODULE_IDS } = await vite.ssrLoadModule('/lib/modules.ts');
const { deepLinkFor } = await vite.ssrLoadModule('/lib/workspace-map.ts');
const { toolFocusFor, toolFocusKey, toolPageFor, FOCUS_VIEWS, FOCUS_TABS, DEPARTMENT_BACK } = await vite.ssrLoadModule('/lib/tool-focus.ts');
const cal = await vite.ssrLoadModule('/lib/calendar-live.ts');
const source = name => readFileSync(name, 'utf8');

const roles = Object.keys(DEFAULT_ROLE_MODULES);
const grants = role => [DEFAULT_ROLE_MODULES[role], MODULE_IDS];
const panelLinks = (role, modules) => rolePanel(role, modules).groups.flatMap(g => g.links);
// A target that names one part of a department (a sub or a section heading) or of a page (a tab with an anchor).
const pointsInside = t => (t.kind === 'work' && t.view !== 'calendar' && t.view !== 'all' && t.view !== 'hub' && !t.open && !t.workId && (!!t.sub || !!t.anchor))
  || (t.kind === 'tab' && !!t.anchor);

// Each department screen, where its sections are printed (the Section headings and the anchors a tool can name).
const SCREENS = {
  cleans: ['mobile/src/LiveCleans.tsx'], repairs: ['mobile/src/LiveRepairs.tsx'], accounts: ['mobile/src/LiveAccountsWork.tsx', 'mobile/src/LiveWorkspace.tsx'],
  analytics: ['mobile/src/LiveClientReports.tsx', 'mobile/src/StayReports.tsx', 'mobile/src/Reports.tsx'], help: ['mobile/src/LiveTraining.tsx'],
};
const anchorsIn = files => {
  const found = new Set();
  for (const file of files) {
    const text = source(file);
    for (const m of text.matchAll(/<Section title="([^"]+)"/g)) found.add(sectionAnchor(m[1]));
    for (const m of text.matchAll(/<Anchor id="(section-[a-z0-9-]+)"/g)) found.add(m[1]);
    for (const m of text.matchAll(/<Anchor id=\{sectionAnchor\("([^"]+)"\)\}/g)) found.add(sectionAnchor(m[1]));
  }
  return found;
};

test('every menu tool (every role) that points inside a department or page resolves to a tool page with its own title', () => {
  let checked = 0;
  for (const role of roles) for (const modules of grants(role)) for (const link of panelLinks(role, modules)) {
    if (link.kind !== 'tool' || !pointsInside(link.target)) continue;
    const place = toolFocusFor(link.target);
    assert.ok(place, `${role}: ${link.label} (${JSON.stringify(link.target)}) opens a tool page`);
    const page = toolPageFor(role, modules, link.target, link.label);
    assert.equal(page.only, place.only, link.label);
    assert.equal(page.title, link.label, 'the page is headed with the menu\'s name for the tool');
    assert.ok(page.detail, `${link.label} has a line under its title`);
    // It lands where the link goes, and the screen there prints the part it names.
    const to = deepLinkFor(link.target);
    assert.equal(to.section, place.section, link.label);
    if (place.section === 'work') {
      assert.equal(to.view, place.view);
      assert.ok(FOCUS_VIEWS.includes(place.view));
      assert.ok(DEPARTMENT_BACK[place.view], `${place.view} has a link back to the department`);
    } else assert.ok(FOCUS_TABS[place.section].includes(place.only));
    if (place.only.startsWith('section-')) {
      const files = SCREENS[place.view ?? place.section];
      assert.ok(files, `${place.view ?? place.section} screens are known`);
      assert.ok(anchorsIn(files).has(place.only), `${link.label}: ${place.only} is a section of ${files.join(', ')}`);
    }
    checked++;
  }
  assert.ok(checked > 40, `checked ${checked} menu tool links`);
});

test('Home cards and search open the same tool pages (they use the same targets)', () => {
  for (const role of roles) for (const modules of grants(role)) {
    const tools = [...homeToolsFor(role, modules), ...panelToolsFor(role, modules)];
    for (const tool of tools) {
      if (!pointsInside(tool.target)) continue;
      const page = toolPageFor(role, modules, tool.target);
      assert.ok(page, `${role}: ${tool.label}`);
      // Two tools with one target (Licensing and Compliance certificates) open the same page under the first one's name.
      const same = tools.filter(t => JSON.stringify(t.target) === JSON.stringify(tool.target));
      assert.ok(same.some(t => t.label === page.title && t.detail === page.detail), `${role}: ${tool.label}`);
    }
  }
});

test('the inventory: each menu tool opens its own part only', () => {
  const key = (role, label) => {
    const link = panelLinks(role, MODULE_IDS).find(l => l.label === label && l.kind === 'tool');
    assert.ok(link, `${role} has ${label}`);
    return toolFocusKey(link.target);
  };
  const expected = [
    ['admin', 'Receivable Invoices', 'receivable'], ['admin', 'Payable Invoices', 'section-cleaner-invoices'], ['admin', 'Order Fulfilment', 'section-purchases'],
    ['admin', 'Client Funds & Expenses', 'expenses'], ['admin', 'Profit/Loss Reporting', 'performance'], ['accounts', 'Reconciliation', 'payouts'],
    ['accounts', 'Budget chart', 'section-budget-chart'], ['accounts', 'Invoices', 'section-invoices'], ['accounts', 'AirCover Claims', 'aircover'],
    ['admin', 'Form Submissions', 'section-waiting-for-your-review'], ['cleaning_manager', 'Disputes', 'section-disputes-to-decide'],
    ['cleaning_manager', 'Not assigned', 'section-not-yet-assigned'], ['cleaning_manager', 'Cleaners', 'section-cleaner-performance-this-month'],
    ['cleaning_manager', 'Schedule', 'section-schedule'], ['cleans', 'Needs a reply', 'section-needs-your-response'], ['cleans', 'Earnings', 'section-your-month'],
    ['ready', 'Reactive Jobs', 'section-reactive-maintenance'], ['ready', 'Preventative visits', 'section-preventative-maintenance'],
    ['ready', 'Garden Maintenance', 'section-preventative-maintenance'], ['ready', 'Waste Collection', 'section-preventative-maintenance'], ['ready', 'Place Order', 'section-purchase-orders'],
    ['admin', 'AirCover Claims', 'aircover'], ['admin', 'Direct Bookings', 'bookings'], ['admin', 'Pricing', 'pricing'], ['admin', 'Reviews', 'reviews'],
    ['admin', 'Listing Maintenance', 'listings'], ['admin', 'Property Status', 'onboarding'], ['admin', 'Item Catalogue', 'furnishing'], ['admin', 'Place Order', 'purchases'],
    // Licensing and Compliance Certs open the same tracker on purpose (its certificates are steps inside it).
    ['admin', 'Licensing', 'licensing'], ['admin', 'Compliance Certs', 'licensing'],
    ['admin', 'Limit Changer', 'limits'], ['admin', 'People', 'people'], ['admin', 'Access control', 'access'], ['admin', 'Daily Checklist', 'dailytasks'],
    ['client', 'My Statements', 'section-statements'], ['client', 'Calendar', 'section-booking-calendar'], ['stays', 'Training', 'section-training'],
    // Business Plan v2's sections (30 October 2026).
    ['stays', 'Earnings', 'section-earnings'], ['admin', 'Clients', 'clients'], ['admin', 'Contractors', 'contractors'], ['admin', 'Staff', 'staff'],
    ['admin', 'Applicants', 'recruitment-applicants'], ['admin', 'Contract Templates', 'recruitment-templates'],
    ['admin', 'Property Performance Manager', 'enquiries'], ['admin', 'Property Operations Manager', 'section-waiting-for-your-review'], ['admin', 'Accounts', 'expenses'],
  ];
  for (const [role, label, only] of expected) assert.equal(key(role, label), only, `${role}: ${label}`);
});

test('department links, page links, forms and calendars are not tool pages', () => {
  for (const role of roles) for (const link of panelLinks(role, MODULE_IDS)) {
    if (link.kind === 'area' || link.kind === 'page') assert.equal(toolFocusKey({ kind: 'work', view: link.view ?? 'all' }), null, link.label);
    if (link.kind === 'start') assert.equal(toolFocusKey(link.target), null, link.label);
    if (link.kind === 'tool' && link.target.kind === 'work' && link.target.view === 'calendar') assert.equal(toolFocusKey(link.target), null, link.label);
  }
  for (const view of FOCUS_VIEWS) assert.equal(toolFocusKey({ kind: 'work', view }), null, `${view} opens whole`);
  assert.equal(toolFocusKey({ kind: 'work', view: 'cleans', workId: 'x', anchor: 'section-schedule' }), null, 'one job opens the job');
  assert.equal(toolFocusKey({ kind: 'work', view: 'accounts', sub: 'expenses', open: 'new-expense' }), null, 'a form opens the form');
});

test('the workspace opens tool pages: back to the department, the title and line, only the one part, no picker', () => {
  const workspace = source('mobile/src/LiveWorkspace.tsx');
  assert.match(workspace, /else \{ const link = deepLinkFor\(target\); if \(link\) openLink\(link, toolPageFor\(account\.role, account\.modules, target, label\)\); \}/);
  assert.match(workspace, /openTool\(link\.target, link\.label\);/, 'menu links pass their own name');
  assert.match(workspace, /\.\.\.\(tool \? \{ tool \} : \{\}\), nonce: freshNonce\(\)/);
  assert.match(workspace, /const toolPage = focus\?\.tool \?\? null;/);
  assert.match(workspace, /\{toolPage && currentView && currentView !== "management" && <ToolHeader p=\{p\} back=\{DEPARTMENT_BACK\[currentView\] \?\? WORK_VIEW_LABEL\[currentView\]\} onBack=\{toolBack\} title=\{toolPage\.title\} detail=\{toolPage\.detail\} \/>\}/);
  assert.match(workspace, /<OnlySection\.Provider value=\{toolPage\?\.only\.startsWith\("section-"\) \? toolPage\.only : null\}>/);
  assert.match(workspace, /!\(desktop && !sidebarHidden\) && !toolPage && <FilterBar/, 'no Work area picker on a tool page');
  // Accounts: one tab, one work section or the invoices, never the whole desk under it.
  assert.match(workspace, /currentView === "accounts" && \(!toolPage \? <><LiveAccounts/);
  assert.match(workspace, /: toolPage\.only === "section-invoices" \?/);
  assert.match(workspace, /: toolPage\.only\.startsWith\("section-"\) \? <AccountsWork /);
  // Back opens the whole department afresh.
  assert.match(workspace, /setFocus\(tab === "work" \? \{ nonce: freshNonce\(\) \} : null\); setVisit\(v => v \+ 1\);/);
  // The owner's Portfolio parts and Help's Training.
  assert.match(workspace, /<LiveClientReports key=\{"portfolio:" \+ \(focus\?\.nonce \?\? ""\)\} palette=\{p\} tool=\{toolPage\} onBack=\{toolBack\} \/>/);
  assert.match(workspace, /toolPage\?\.only === "section-training" \? <><ToolHeader p=\{p\} back="Help"[^\n]*<ToolTitled\.Provider value=\{true\}><LiveTraining palette=\{p\} \/><\/ToolTitled\.Provider>/);
  // Training's own page has one heading: the tool header's.
  const training = source('mobile/src/LiveTraining.tsx');
  assert.match(training, /const titled = useToolTitled\(\) && !manage;/);
  assert.match(training, /const training = titled \? <View style=\{\{ gap: space\.row \}\}>\{content\}<\/View> : <Section title="Training"/);
});

test('department screens honour the focus key: only the named section, no heading, figures or other buttons', () => {
  const kit = source('mobile/src/LiveKit.tsx');
  assert.match(kit, /export const OnlySection = createContext<string \| null>\(null\);/);
  assert.match(kit, /const only = useContext\(OnlySection\);\r?\n  if \(only && only !== sectionAnchor\(title\)\) return null;/);
  assert.match(kit, /<OnlySection\.Provider value=\{null\}>\{Children\.toArray\(children\)/, 'the section shown keeps what it holds');
  const cleans = source('mobile/src/LiveCleans.tsx');
  assert.match(cleans, /const only = useOnlySection\(\);/);
  assert.match(cleans, /\{!only && <View style=\{\{ gap: 4 \}\}>\r?\n        <Text accessibilityRole="header" style=\{\[ui\.title, \{ color: p\.text \}\]\}>\{manager \? "Cleaning team"/);
  assert.match(cleans, /\{!only && <StatGrid>/);
  assert.match(cleans, /\{manager && !only && \(/);
  assert.match(cleans, /account\.role === "cleaning_manager" && !only && <CleanerRequestsForManager/);
  const repairs = source('mobile/src/LiveRepairs.tsx');
  assert.match(repairs, /const only = useOnlySection\(\);/);
  assert.match(repairs, /\{!only && <View style=\{\{ gap: 4 \}\}>\r?\n        <Text accessibilityRole="header" style=\{\[ui\.title, \{ color: p\.text \}\]\}>Maintenance<\/Text>/);
  assert.match(repairs, /\(!only \|\| only === "section-purchase-orders"\) && <Anchor id="section-purchase-orders">/);
  const accountsWork = source('mobile/src/LiveAccountsWork.tsx');
  assert.match(accountsWork, /const only = useOnlySection\(\);/);
  assert.match(accountsWork, /canPayCleaners && \(!only \|\| only === sectionAnchor\("Cleaner invoices"\)\) && <OnlySection\.Provider value=\{null\}><AccountsCleanerPay/);
  for (const file of ['GuestRelations.tsx', 'ClientRelations.tsx']) {
    const text = source('mobile/src/' + file);
    assert.match(text, /const \[alone, setAlone\] = useState\(\(\) => !!focus\?\.tool \|\| \(subs\.length > 1 && subs\.some\(s => s === focus\?\.sub\)\)\);/, file);
    assert.match(text, /\{alone \? !focus\?\.tool && <ToolHeader /, file);
  }
  const accounts = source('mobile/src/LiveAccounts.tsx');
  assert.match(accounts, /const \[alone, setAlone\] = useState\(\(\) => !!focus\?\.tool \|\| focus\?\.sub === view\);/);
  assert.match(accounts, /\{!alone && <Pills /, 'no picker on a tool page');
  const owner = source('mobile/src/LiveClientReports.tsx');
  assert.match(owner, /const solo = tool\?\.only \?\? null, all = !solo;/);
  assert.match(owner, /\{\(all \|\| solo === sectionAnchor\("Statements"\)\) && <Section title="Statements"/);
  assert.match(owner, /\{\(all \|\| solo === sectionAnchor\("Booking calendar"\)\) && <Anchor/);
});

// The filtered calendars: each holds only its own type.
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = id(90);
const work = (n, kind, moduleId, title, extra = {}) => ({ workId: id(n), propertyId: A, propertyName: 'Harbour Flat', moduleId, title, status: 'waiting', dueOn: '2026-10-12', dueTime: null, endTime: null, assigneeId: null, assigneeName: null, kind, version: 1, ...extra });
const schedule = cal.calendarScheduleSchema.parse({
  work: [
    work(1, 'cleaning', 'cleaning-schedule', 'Clean'), work(2, 'maintenance', 'maintenance-reporting', 'Boiler'),
    work(3, 'routine_visit', 'safety-maintenance', 'Gas safety check'), work(4, 'routine_visit', 'routine-bin-garden-board', 'Garden visit'),
    work(5, 'inspection', 'new-property-inspection-board', 'Inspection'), work(6, 'licensing', 'licensing', 'Licence renewal'),
    work(7, 'cleaning_setup', 'clean-property-onboarding', 'Cleaning set-up'), work(8, 'cleans_invoice', 'cleans-invoices', 'Invoice'),
    work(9, 'direct_booking', 'direct-bookings', 'Follow up'),
  ],
  stays: [{ reservationId: 'r1', propertyId: A, propertyName: 'Harbour Flat', checkIn: '2026-10-10', checkOut: '2026-10-12', guests: 2, channel: 'airbnb' }],
  payments: [{ statementId: id(20), propertyId: A, propertyName: 'Harbour Flat', period: '2026-09', status: 'paid', payoutMinor: 1, date: '2026-10-05', issuedAt: null, paidAt: null, reference: null }],
});

test('each filtered calendar holds only its own type', () => {
  const entries = cal.calendarEntries(schedule);
  const kinds = lock => [...new Set(cal.filterLock(entries, lock).map(e => e.kind))].sort();
  const ids = lock => cal.filterLock(entries, lock).map(e => e.id).sort();
  assert.deepEqual(kinds('stays'), ['check-in', 'check-out'], 'Booking calendar: bookings only');
  assert.deepEqual(kinds('cleans'), ['clean'], 'Housekeeping calendar: cleans only');
  assert.deepEqual(kinds('ready'), ['inspection', 'repair', 'routine'], 'Maintenance calendar: maintenance only');
  assert.deepEqual(ids('safety'), ['w:' + id(3), 'w:' + id(6)], 'Safety: safety visits and licensing, not garden visits');
  assert.deepEqual(ids('onboarding'), ['w:' + id(5), 'w:' + id(7)], 'Onboarding: inspections and set-ups');
  assert.ok(cal.filterLock(entries, 'accounts').every(e => e.team === 'accounts'));
  for (const lock of cal.CALENDAR_LOCKS) {
    assert.ok(cal.filterLock(entries, lock).length, `${lock} has entries here`);
    assert.ok(cal.filterLock(entries, lock).length < entries.length, `${lock} leaves other types out`);
    assert.ok(cal.CALENDAR_LOCK_PAGE[lock].title.endsWith('calendar'), lock);
  }
  assert.equal(cal.filterLock(entries, null).length, entries.length, 'the plain Calendar keeps every team');
});

test('every calendar link in every menu opens a locked calendar; the plain Calendar is unlocked', () => {
  let seen = 0;
  for (const role of roles) for (const modules of grants(role)) for (const link of panelLinks(role, modules)) {
    if (link.kind !== 'tool' || link.target.kind !== 'work' || link.target.view !== 'calendar') continue;
    const to = deepLinkFor(link.target);
    assert.equal(to.section, 'calendar');
    assert.ok(cal.isCalendarLock(to.team ?? to.preset), `${role}: ${link.label} is locked to its type`);
    seen++;
  }
  assert.ok(seen > 10);
  const plain = deepLinkFor({ kind: 'work', view: 'calendar' });
  assert.equal(plain.team ?? plain.preset, undefined);
});

test('a locked calendar has its own title and no team switcher, All teams, team events or filter to clear', () => {
  const calendar = source('mobile/src/LiveCalendar.tsx'), workspace = source('mobile/src/LiveWorkspace.tsx');
  assert.match(workspace, /<LiveCalendar key=\{"calendar:" \+ \(calendarTeam\?\.nonce \?\? ""\)\} [^\n]*locked=\{calendarTeam\?\.team \?\? calendarTeam\?\.preset \?\? null\}/);
  assert.match(calendar, /const entries = useMemo\(\(\) => schedule \? filterLock\(calendarEntries\(schedule\), locked\) : \[\], \[schedule, locked\]\);/);
  assert.match(calendar, /const teams = locked \? \[\] : calendarTeamsFor\(account\.role\);/);
  // The team switcher (with All teams) only renders with more than one team, which a locked calendar never has.
  assert.match(calendar, /\{\(mode === "month" \|\| mode === "week"\) && teams\.length > 1 && <Dropdown p=\{p\} label="Team"/);
  assert.match(calendar, /const evList = useMemo\(\(\) => locked \? \[\] : events\?\.events \?\? \[\], \[events, locked\]\);/);
  assert.match(calendar, /\{staff && !locked && \(\r?\n\s*<MotionPress accessibilityRole="button" accessibilityLabel="Add an absence, meeting or time away"/);
  assert.match(calendar, /items=\{\(locked \? LOCKED_MODES : MODES\)\.map/);
  assert.match(calendar, /const LOCKED_MODES: readonly Mode\[\] = \["month", "week"\];/);
  assert.match(calendar, /\{locked \? <PageHeading palette=\{p\} title=\{CALENDAR_LOCK_PAGE\[locked\]\.title\} subtitle=\{CALENDAR_LOCK_PAGE\[locked\]\.detail\} \/>/);
  assert.doesNotMatch(calendar, /Clear this filter|setPreset|focusTeam|focusPreset/);
});
