import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'vite';

// Lee, 16 October 2026: Client enquiries opened both from its own page and from the Enquiries chip in Client relations.
// One place now: the chip in Client relations is its home, and "Client enquiries" (the menu entry, its old page link, the
// Home lines and the enquiry notices) opens there. Nothing else goes: no department, tool or data. An enquiry the team
// adds by hand (migration 20261022400000) shows who added it, as an owner's shows "Existing owner".
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const map = await vite.ssrLoadModule('/lib/workspace-map.ts');
const { rolePanel } = await vite.ssrLoadModule('/lib/role-panel.ts');
const { homeToolsFor, panelToolsFor } = await vite.ssrLoadModule('/lib/home-tools.ts');
const { MODULE_IDS, DEFAULT_ROLE_MODULES } = await vite.ssrLoadModule('/lib/modules.ts');
const { clientSubsFor } = await vite.ssrLoadModule('/lib/relations-subs.ts');
const { noticeRow } = await vite.ssrLoadModule('/lib/notice-details.ts');
const { noticeViewSchema } = await vite.ssrLoadModule('/lib/workspace-view.ts');
const { pushTarget } = await vite.ssrLoadModule('/lib/push-copy.ts');
const enquiry = await vite.ssrLoadModule('/lib/client-enquiry.ts');
const { newEnquiryForm, workflowValues } = await vite.ssrLoadModule('/lib/workflow-forms.ts');
const { journeyActionSchema } = await vite.ssrLoadModule('/lib/journey-policy.ts');
const source = name => readFileSync('mobile/src/' + name, 'utf8');
const HOME = { section: 'work', view: 'clients', sub: 'enquiries' };
const modulesOf = role => role === 'admin' || role === 'super_admin' ? [...MODULE_IDS] : DEFAULT_ROLE_MODULES[role];
const where = link => link && { section: link.section, view: link.view, sub: link.sub };

test('every way in to Client enquiries opens Client relations on its Enquiries chip', () => {
  assert.deepEqual(where(map.CLIENT_ENQUIRIES_LINK), HOME);
  assert.deepEqual(where(map.pageLink('enquiries')), HOME, 'the old page link (?section=enquiries)');
  assert.deepEqual(where(map.deepLinkFor({ kind: 'tab', tab: 'enquiries' })), HOME, 'Home lines, the To value figure and the Properties shortcut');
  assert.ok(map.isWorkSub('clients', 'enquiries'));
  for (const role of ['super_admin', 'admin', 'stays']) {
    const modules = modulesOf(role);
    // The menu keeps its entry (and its place in a saved menu order); it is a shortcut now, called Leads in
    // Property Onboarding since Alex's menu (20 October 2026).
    const link = rolePanel(role, modules).groups.flatMap(g => g.links).find(l => l.label === 'Leads');
    assert.ok(link, role + ' keeps the menu entry');
    assert.equal(link.key, 'page:enquiries', role);
    assert.deepEqual(where(map.pageLink(link.section)), HOME, role);
    const tool = [...homeToolsFor(role, modules), ...panelToolsFor(role, modules)].find(t => t.key === 'enquiries');
    assert.deepEqual(where(map.deepLinkFor(tool.target)), HOME, role + ' tool');
    // The chip is there for each of them: the home of Client enquiries.
    assert.ok(clientSubsFor(role, modules).includes('enquiries'), role + ' has the Enquiries chip');
  }
});

test('the workspace no longer shows Client enquiries as a page of its own: it sends the old page on, and nothing else goes', () => {
  const workspace = source('LiveWorkspace.tsx');
  assert.doesNotMatch(workspace, /<LiveEnquiries /, 'not rendered as its own page');
  assert.doesNotMatch(workspace, /import \{ LiveEnquiries \}/);
  assert.match(workspace, /useEffect\(\(\) => \{\r?\n    if \(tab !== "enquiries"\) return;\r?\n    let active = true;\r?\n    queueMicrotask\(\(\) => \{ if \(active\) openLink\(CLIENT_ENQUIRIES_LINK\); \}\);/);
  assert.match(workspace, /: tab === "enquiries" \? null\r?\n/, 'nothing drawn for the moment before it moves on');
  // The menu entry stays highlighted once it has opened Client relations.
  assert.match(workspace, /const to = pageLink\(link\.section\); navigate\(link\.section\); setPanelPick\(\{ key: link\.key, tab: to\?\.section \?\? link\.section, view: to\?\.view \?\? "" \}\);/);
  // The list itself is drawn in one place only: Client relations, on its Enquiries chip.
  const drawn = readdirSync('mobile/src').filter(f => f.endsWith('.tsx') && /<LiveEnquiries /.test(source(f)));
  assert.deepEqual(drawn, ['ClientRelations.tsx']);
  assert.match(source('ClientRelations.tsx'), /\{sub === "enquiries" && <LiveEnquiries palette=\{p\} account=\{account\} onOpenProperty=\{onOpenProperty\} onRefresh=\{onRefresh\} \/>\}/);
  // The page name still resolves for old links, and the role gate is unchanged.
  assert.ok(map.PAGE_SECTIONS.includes('enquiries'));
  assert.match(workspace, /enquiries: \["admin", "super_admin", "stays"\]/);
});

test('enquiry notices open Client enquiries, in the Updates feed and from a pop-up', () => {
  const notice = event_type => noticeViewSchema.parse({ id: 1, event_type, created_at: '2026-10-16T09:00:00Z', read_at: null });
  for (const event of ['enquiry.duplicate', 'enquiry.received']) {
    assert.deepEqual(noticeRow(notice(event)).target, { kind: 'enquiries' }, event);
    const { url } = pushTarget(event, {});
    assert.equal(url, '/workspace/live?section=enquiries', event);
    assert.deepEqual(where(map.pageLink(new URL(url, 'https://x').searchParams.get('section'))), HOME, event + ' lands on the chip');
  }
  assert.equal(noticeRow(notice('handover.created')).target, null, 'other notices are unchanged');
  assert.equal(pushTarget('handover.created', {}).url, '/workspace/live');
  const pages = source('LivePages.tsx'), workspace = source('LiveWorkspace.tsx');
  assert.match(pages, /if \(t\?\.kind === "enquiries" && onOpenEnquiries\) return onOpenEnquiries;/);
  assert.equal(workspace.match(/onOpenEnquiries=\{\(\) => openLink\(CLIENT_ENQUIRIES_LINK\)\}/g).length, 2, 'the Activity page and Updates in Messages');
});

test('an enquiry the team added shows "Added by the team" and who, in the list, on the enquiry and in onboarding', () => {
  const base = { source: 'team', sentByName: 'Morag' };
  assert.equal(enquiry.isTeamEnquiry(base), true);
  assert.equal(enquiry.isOwnerEnquiry(base), false);
  assert.equal(enquiry.teamEnquiryTag(base), 'Added by the team · Morag');
  assert.equal(enquiry.teamEnquiryTag({ sentByName: null }), 'Added by the team');
  assert.deepEqual([...enquiry.ENQUIRY_SOURCES], ['form', 'owner_app', 'team']);
  const list = source('LiveEnquiries.tsx');
  assert.match(list, /\{isTeamEnquiry\(e\) && <Tag label=\{teamEnquiryTag\(e\)\} tone="plain" p=\{p\} \/>\}/);
  assert.match(list, /\{isTeamEnquiry\(e\) && <Notice text=\{`\$\{teamEnquiryTag\(e\)\}\. \$\{TEAM_ENQUIRY_NOTE\}`\} p=\{p\} \/>\}/);
  assert.match(readFileSync('lib/tracker-onboarding.ts', 'utf8'), /if \(isTeamEnquiry\(e\)\) add\('From', teamEnquiryTag\(e\)\);/);
  for (const text of [enquiry.TEAM_ENQUIRY_LABEL, enquiry.TEAM_ENQUIRY_NOTE]) assert.ok(!text.includes('\u2014'), 'no em dash');
});

test("the team's enquiry form asks when they would like to start, and sends it only when chosen", () => {
  const form = newEnquiryForm(true);
  const names = form.fields.map(f => f.name);
  const when = form.fields.find(f => f.name === 'startWhen');
  assert.equal(when.label, 'When would they like to get started?');
  assert.equal(when.required, false);
  assert.deepEqual(when.options.map(o => o.value), ['', ...enquiry.START_WHEN]);
  assert.ok(names.indexOf('startWhen') < names.indexOf('photoLink') && !names.includes('uploads'), 'before the link and notes; no uploads');
  const raw = { contactName: 'Pat Caller', companyName: '', email: '', phone: '07700 900111', address: '2 Harbour Road, Oban PA34 4LW', name: 'Harbour cottage', region: '', propertyType: 'Cottage', bedrooms: '2', wcs: '', bathrooms: '1', parking: '', garden: '', photoLink: '', notes: '', startWhen: '' };
  const none = form.build(workflowValues(form.fields, raw));
  assert.ok(!('startWhen' in none));
  const chosen = form.build(workflowValues(form.fields, { ...raw, startWhen: 'As soon as possible' }));
  assert.equal(chosen.startWhen, 'As soon as possible');
  assert.deepEqual(chosen.enquiry, { contactName: 'Pat Caller', phone: '07700 900111' });
  assert.ok(journeyActionSchema.safeParse({ requestId: crypto.randomUUID(), ...chosen }).success);
});
