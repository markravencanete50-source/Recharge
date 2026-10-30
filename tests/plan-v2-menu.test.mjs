import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Business Plan v2's menu sections (Lee, 30 October 2026): the screens behind Databases, Approvals and Tasks.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { TASK_PARTS, TASK_SUB_PREFIX } = await vite.ssrLoadModule('/lib/home-tools.ts');
const { LAUNCH_SECTIONS, DEFAULT_LAUNCH_SETTINGS } = await vite.ssrLoadModule('/lib/launch-preparation.ts');
const source = name => readFileSync(name, 'utf8');

test('Tasks: each part is a Launch Preparation section that gets tickets, and All work narrows to them', () => {
  for (const part of Object.keys(TASK_PARTS)) assert.ok(LAUNCH_SECTIONS.includes(part), part);
  for (const part of Object.keys(TASK_PARTS)) assert.ok(DEFAULT_LAUNCH_SETTINGS.boards[part], part + ' has a board by default');
  // The ticket sync (latest in 20261029700000) makes no tickets for these sections, so none of them can be a Tasks part.
  const sync = source('supabase/migrations/20261029700000_launch_compliance_jobs.sql');
  const skipped = sync.match(/and \(s->>'section' not in \(([^)]*)\) or s->>'key' in/)[1];
  for (const part of Object.keys(TASK_PARTS)) assert.ok(!skipped.includes(`'${part}'`), part);
  assert.equal(TASK_SUB_PREFIX, 'task-');
  const workspace = source('mobile/src/LiveWorkspace.tsx');
  assert.match(workspace, /const filtered = work\.filter\(item => !taskPart \|\| \(item\.kind === "launch_step" && item\.data\.section === taskPart\)\)/);
  assert.match(workspace, /<SoftButton label="Show all work"[^\n]*onPress=\{\(\) => setTaskCleared\(focus\?\.nonce \?\? null\)\} \/>/);
});

test('Databases: Clients, Contractors and Staff are People narrowed to one group, opening on everyone in it', () => {
  const management = source('mobile/src/LiveManagement.tsx'), people = source('mobile/src/LivePeople.tsx');
  assert.match(management, /\(view === "clients" \|\| view === "contractors" \|\| view === "staff"\) && <LivePeople palette=\{p\} account=\{account\} view="people" group=\{view\} \/>/);
  assert.match(people, /group === "clients" \? role === "client" : group === "contractors" \? role === "ready" : role !== "client" && role !== "ready"/);
  assert.match(people, /useState<PersonState \| "all">\(group \? "all" : "pending"\)/);
  assert.match(people, /const members = useMemo\(\(\) => people\.filter\(x => inGroup\(x\.role, group\)\), \[people, group\]\);/);
});

test('Databases: Applicants and Contract Templates are Recruitment tool pages', () => {
  const recruitment = source('mobile/src/LiveRecruitment.tsx'), workspace = source('mobile/src/LiveWorkspace.tsx'), hiring = source('mobile/src/Hiring.tsx');
  assert.match(workspace, /tab === "recruitment" \? <LiveRecruitment key=\{"recruitment:" \+ \(focus\?\.nonce \?\? ""\)\} palette=\{p\} account=\{account\} tool=\{toolPage\} \/>/);
  assert.match(recruitment, /if \(tool && alone\) return/);
  assert.match(recruitment, /<ToolHeader p=\{p\} back="Recruitment" onBack=\{\(\) => setAlone\(false\)\}/);
  // Only recruitment see applicants; templates are recruitment's and the directors'.
  assert.match(recruitment, /read\.canRecruit \? <Applicants p=\{p\} read=\{read\} onOpen=\{openVacancy\} \/>/);
  assert.match(recruitment, /keepsTemplates \? <TemplatesSheet [^\n]* inline \/>/);
  assert.match(hiring, /return inline \? <View style=\{\{ gap: 12 \}\}>\{list\}<\/View>/);
});

test('Approvals and Earnings land on their own parts', () => {
  const enquiries = source('mobile/src/LiveEnquiries.tsx'), workspace = source('mobile/src/LiveWorkspace.tsx');
  assert.match(enquiries, /\(!!approvals\?\.items\.length \|\| askedApprovals\) && <Anchor id="section-ppm-approvals">/);
  assert.match(workspace, /toolPage\?\.only === "section-earnings" \? <><ToolHeader p=\{p\} back="My performance"[^\n]*<MyEarnings p=\{p\} account=\{account\} \/><\/>/);
});
