import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Lee, 16 October 2026: "the search bar there should be a title on top of it", "tools should have a different page: if I
// click Limit Changer all I can see is Limit Changer, no search bar where we can jump to a different tool", and "in the
// reports there should be something like a folder or button for each report; each report should have a different page".
const source = name => readFileSync('mobile/src/' + name, 'utf8');
const page = source('ToolPage.tsx'), management = source('LiveManagement.tsx'), workspace = source('LiveWorkspace.tsx'), hub = source('ReportsHub.tsx');

test('a tool page has a back link, its own heading and no picker; the cards name each tool with one line', () => {
  assert.match(page, /export function ToolHeader\(\{ p, back, onBack, title, detail \}/);
  assert.match(page, /accessibilityRole="link" accessibilityLabel=\{`Back to \$\{back\}`\} onPress=\{onBack\}/);
  assert.match(page, /<Feather name="chevron-left"/);
  assert.match(page, /<Text accessibilityRole="header" style=\{\[ui\.title, \{ color: p\.text \}\]\}>\{title\}<\/Text>/);
  assert.match(page, /export function ToolCards<K extends string>\(\{ p, title, cards, onOpen \}/);
  assert.match(page, /accessibilityLabel=\{`\$\{card\.label\}\. \$\{card\.detail\}`\} onPress=\{\(\) => onOpen\(card\.key\)\}/);
  assert.match(page, /<Text accessibilityRole="header" style=\{\[ui\.sectionTitle, \{ color: p\.text \}\]\}>\{title\}<\/Text>/, 'a visible heading over the cards');
  assert.doesNotMatch(page, /<Pills |<Dropdown /);
  assert.doesNotMatch(page, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, 'theme tokens only');
});

test('the Management centre opens on its cards; a link to one tool opens that tool alone with "Management centre" to go back', () => {
  assert.match(management, /const \[view, setView\] = useState<ManagementView \| null>\(\(\) => views\.find\(v => v === focus\?\.sub\) \?\? null\);/);
  assert.match(management, /if \(!view\) return \(/);
  assert.match(management, /Management centre<\/Text>/);
  assert.match(management, /<ToolHeader p=\{p\} back="Management centre" onBack=\{\(\) => \{ setView\(null\); setDailyOnly\(null\); \}\} title=\{TOOL\[view\]\.label\}/);
  // Who sees which tool is unchanged: Access control for super admins, Onboarding settings and Limit Changer for workspace admins.
  assert.match(management, /const views = MANAGEMENT_VIEWS\.filter\(v => \(v !== "access" \|\| account\.role === "super_admin"\) && \(v !== "onboarding" \|\| isWorkspaceAdmin\(account\.role\)\) && \(v !== "limits" \|\| isWorkspaceAdmin\(account\.role\)\)\);/);
  assert.match(management, /view === "limits" && isWorkspaceAdmin\(account\.role\) && <LimitChanger /);
  // Every tool has a card with a name and a line.
  const list = management.match(/const MANAGEMENT_VIEWS = \[([^\]]*)\]/)[1].split(',').map(s => s.trim().replace(/"/g, ''));
  for (const v of list) assert.match(management, new RegExp(`  ${v}: \\{ key: "${v}", label: "[^"]+", detail: "[^"]+", icon: "[a-z-]+" \\},`), v);
});

test('Guest relations, Client relations and Accounts: a link to one tool shows it alone; opened whole, a labelled picker', () => {
  for (const [file, back, label] of [['GuestRelations.tsx', 'Guest relations', 'GUEST_SUB_LABEL'], ['ClientRelations.tsx', 'Client relations', 'CLIENT_SUB_LABEL']]) {
    const text = source(file);
    assert.match(text, /const \[alone, setAlone\] = useState\(\(\) => subs\.length > 1 && subs\.some\(s => s === focus\?\.sub\)\);/, file);
    assert.match(text, new RegExp(`\\{alone \\? <ToolHeader p=\\{p\\} back="${back}" onBack=\\{\\(\\) => setAlone\\(false\\)\\} title=\\{${label}\\[sub\\]\\} \\/> : <>`), file);
  }
  const accounts = source('LiveAccounts.tsx');
  assert.match(accounts, /const \[alone, setAlone\] = useState\(\(\) => focus\?\.sub === view\);/);
  assert.match(accounts, /\{alone \? <ToolHeader p=\{p\} back="Accounts" onBack=\{\(\) => setAlone\(false\)\} title=\{TAB_LABEL\[view\]\} \/>/);
  assert.match(accounts, /\{!alone && <StatGrid>/);
  // The finance-only tabs stay finance-only.
  assert.match(accounts, /\.filter\(v => \(v !== "receivable" && v !== "maker" && v !== "performance" && v !== "aircover"\) \|\| \(isFinanceRole\(role\) && \(v !== "aircover" \|\| !!sectionProps\)\)\)\} \/>\}/);
  // Accounts' own Work button opens the desk whole, not Expenses alone.
  assert.match(workspace, /if \(account\.role === "accounts" && value === "work"\) \{ setWorkView\("accounts"\); setFocus\(f => \(\{ nonce: \(f\?\.nonce \?\? 0\) \+ 1 \}\)\); \}/);
});

test('opening a page again from the menu starts it afresh (the centre on its cards, Reports on its hub)', () => {
  assert.match(workspace, /const \[visit, setVisit\] = useState\(0\);/);
  assert.match(workspace, /setFocus\(null\); setVisit\(v => v \+ 1\); setWorkView\(link\.view\);/);
  assert.match(workspace, /<LiveManagement key=\{"management:" \+ \(focus\?\.sub \?\? ""\) \+ \(focus\?\.nonce \?\? ""\) \+ ":" \+ visit\}/);
  assert.match(workspace, /<LiveAccounts key=\{"accounts:" \+ \(focus\?\.sub \?\? ""\) \+ \(focus\?\.nonce \?\? ""\) \+ ":" \+ visit\}/);
  assert.match(workspace, /<ReportsHub key=\{"reports:" \+ \(focus\?\.nonce \?\? ""\) \+ ":" \+ visit\} p=\{p\} reports=\{adminReports\} \/>/);
});

test('admins\' Reports is a hub of cards, Business overview first, each report on its own page with "Reports" to go back', () => {
  assert.match(hub, /<ToolHeader p=\{p\} back="Reports" onBack=\{\(\) => setOpen\(null\)\} title=\{shown\.label\}/);
  assert.match(hub, /<ToolCards p=\{p\} title="Choose a report" cards=\{reports\} onOpen=\{setOpen\} \/>/);
  // A link to a report (Home's "Guest replies on time", search's Invoices) opens that report's page.
  assert.match(hub, /reports\.find\(r => !!focus\?\.anchor && !!r\.anchors\?\.includes\(focus\.anchor\)\)\?\.key \?\? null/);
  const start = workspace.indexOf('const adminReports'), end = workspace.indexOf('const reportsPage');
  const keys = [...workspace.slice(start, end).matchAll(/\{ key: "([a-z]+)", label: "([^"]+)", detail: "([^"]+)"/g)].map(m => [m[1], m[2], m[3]]);
  assert.deepEqual(keys.map(k => k[0]), ['overview', 'enquiries', 'stays', 'ratings', 'messages', 'todos', 'time', 'productivity', 'performance', 'repairs', 'decisions', 'invoices', 'mine']);
  assert.equal(keys[0][1], 'Business overview');
  for (const [, label, detail] of keys) { assert.ok(label.length <= 20, label); assert.ok(detail.length <= 100 && /\.$/.test(detail), detail); }
  assert.match(workspace, /\{ key: "invoices", [^}]*anchors: \["section-invoices"\]/);
  assert.match(workspace, /\{ key: "overview", [^}]*page: trendsReport\("trends", false\) \}/);
  assert.match(workspace, /\{ key: "mine", [^}]*page: trendsReport\("mine", false\) \}/);
  // The team keeps their My performance page as it was.
  assert.match(workspace, /: <>\s*\{trendsReport\(\)\}\s*\{account\.role === "accounts" && !!invoices\.length && invoiceList\}/);
  const reports = source('Reports.tsx');
  assert.match(reports, /account=part==='trends'\?undefined:person,trends=part!=='mine'/);
  assert.match(reports, /\{!titled&&<Entrance /);
});

test('the new files keep CRLF and have no em dashes', () => {
  for (const name of ['ToolPage.tsx', 'ReportsHub.tsx']) {
    const text = source(name);
    assert.doesNotMatch(text.replace(/\r\n/g, ''), /\n/, name + ' keeps CRLF line endings');
    assert.doesNotMatch(text, /—/, name);
  }
});
