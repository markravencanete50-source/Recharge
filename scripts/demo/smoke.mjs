// Smoke test: for each role, GET what the web app reads on load and on its main screens, through
// the running devstack (node scripts/demo/server.mjs ...). Prints a status matrix.
//   node scripts/demo/smoke.mjs [--base http://localhost:4318] [--verbose]
const args = process.argv.slice(2);
const BASE = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:4318';
const VERBOSE = args.includes('--verbose');
const ROLES = ['super_admin', 'admin', 'stays', 'cleaning_manager', 'cleans', 'ready', 'accounts', 'client'];
const london = offset => { const d = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date()) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const month = london(0).slice(0, 7);
const STAFF = ['stays', 'cleans', 'cleaning_manager', 'ready', 'accounts'];
// [path, which roles the app calls it for on load ('all', a list, or null = a screen, not on load)]
const endpoints = p => [
  ['/api/workspace/account', 'all'],
  ['/api/workspace?entity=properties&limit=100', 'all'],
  ['/api/workspace?entity=invoices&limit=100', 'all'],
  ['/api/workspace/journeys', 'all'],
  ['/api/workspace/operations', 'all'],
  ['/api/workspace/portfolio?section=notifications', 'all'],
  [`/api/workspace/reports?from=${london(-89)}&to=${london(0)}`, 'all'],
  ['/api/workspace/chat?section=unread', 'all'],
  ['/api/workspace/notifications', 'all'],
  ['/api/workspace/teams?section=favorites', ROLES.filter(r => r !== 'client')],
  ['/api/workspace/teams?section=onboarding', STAFF],
  ['/api/workspace/teams?section=budgetChart', ['super_admin', 'admin', 'accounts']],
  ['/api/workspace/portfolio?section=bookingPolicy', ['super_admin', 'admin', 'stays']],
  ['/api/workspace/guest-inbox?section=list&status=waiting', ['super_admin', 'admin', 'stays']],
  ['/api/workspace/teams?section=readyHome', ['ready']],
  ['/api/workspace/teams?section=viewAsPeople', ['super_admin']],
  ['/api/workspace?entity=activity&limit=20', null],
  ['/api/workspace/portfolio?section=portfolio', null],
  ['/api/workspace/portfolio?section=insights', null],
  ['/api/workspace/chat?section=list', null],
  ['/api/workspace/chat?section=people', null],
  ['/api/workspace/chat?section=savedReplies', null],
  [`/api/workspace/chat?section=clientRelations&from=${london(-30)}&to=${london(0)}`, null],
  ['/api/workspace/guest-inbox?section=list&status=all', null],
  [`/api/workspace/teams?section=schedule&from=${london(-14)}&to=${london(28)}`, null],
  ['/api/workspace/teams?section=performance', null],
  [`/api/workspace/teams?section=teamPerformance&from=${london(-30)}&to=${london(0)}`, null],
  ['/api/workspace/teams?section=management', null],
  ['/api/workspace/teams?section=routines', null],
  ['/api/workspace/teams?section=training', null],
  ['/api/workspace/teams?section=contracts', null],
  ['/api/workspace/teams?section=myContracts', null],
  ['/api/workspace/teams?section=shift', null],
  ['/api/workspace/teams?section=mailbox', null],
  ['/api/workspace/teams?section=signoff', null],
  ['/api/workspace/teams?section=rota', null],
  [`/api/workspace/teams?section=rotaPlan&from=${london(0)}&to=${london(6)}`, null],
  [`/api/workspace/teams?section=timesheet&from=${london(-13)}&to=${london(0)}`, null],
  ['/api/workspace/teams?section=hub', null],
  ['/api/workspace/teams?section=responsibilities', null],
  ['/api/workspace/teams?section=cleanerRates', null],
  ['/api/workspace/teams?section=defaultCleaners', null],
  ['/api/workspace/finance?section=policy', null],
  [`/api/workspace/finance?section=overview&period=${month}`, null],
  [`/api/workspace/finance?section=reconciliation&period=${month}`, null],
  ['/api/workspace/finance?section=statements', ['client'], 'only'],
  [`/api/workspace/finance?section=statements&period=${month}`, null],
  ['/api/workspace/finance?section=expenses', null],
  ...(p ? [[`/api/workspace/finance?section=jobs&propertyId=${p}`, null]] : []),
  ['/api/workspace/oversight?section=overview', null],
  ['/api/workspace/oversight?section=decisions', null],
  ['/api/workspace/admin?section=people', null],
  ['/api/workspace/admin?section=properties', null],
  ['/api/workspace/admin?section=accessControl', null],
  ['/api/workspace/admin?section=accessHistory', null],
  ['/api/workspace/checklists?section=templates', null],
  ['/api/workspace/integrations', null],
  [`/api/workspace/owner?section=bookings&from=${london(-60)}&to=${london(60)}`, null],
  [`/api/workspace/owner?section=periods&from=${london(-365).slice(0, 8)}01&to=${london(0).slice(0, 8)}01`, null],
  ['/api/workspace/privacy?section=deletion', null],
  ...(p ? [
    [`/api/workspace/portfolio?section=reservations&propertyId=${p}`, null],
    [`/api/workspace/portfolio?section=vacancies&propertyId=${p}`, null],
    [`/api/workspace/portfolio?section=weekly&propertyId=${p}&from=${london(-6)}&to=${london(0)}`, null],
    [`/api/workspace/controls?section=events&propertyId=${p}`, null],
    [`/api/workspace/controls?section=reservations&propertyId=${p}`, null],
    [`/api/workspace/property-details?propertyId=${p}&section=access`, null],
    [`/api/workspace/journeys?propertyId=${p}`, null],
  ] : []),
];

const results = {}, failures = [];
for (const role of ROLES) {
  const headers = { cookie: `devstack-user=${role}` };
  const props = await fetch(`${BASE}/api/workspace?entity=properties&limit=100`, { headers }).then(r => r.json()).catch(() => ({}));
  const propertyId = props.data?.[0]?.id;
  for (const [path, onLoad, only] of endpoints(propertyId)) {
    if (only && !onLoad.includes(role)) continue;
    const key = path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id').replace(/\d{4}-\d{2}-\d{2}/g, 'D').replace(/\d{4}-\d{2}(?!-)/g, 'M');
    const t = Date.now();
    let status, error = '';
    try {
      const response = await fetch(BASE + path, { headers });
      status = response.status;
      if (!response.ok) error = (await response.json().catch(() => ({}))).error ?? '';
    } catch (e) { status = 'ERR'; error = e.message; }
    const loads = onLoad === 'all' || (Array.isArray(onLoad) && onLoad.includes(role));
    (results[key] ??= { loads: new Set(), cells: {} }).cells[role] = { status, error, ms: Date.now() - t };
    if (loads) results[key].loads.add(role);
    if (loads && status !== 200) failures.push(`${role} ${path}: ${status} ${error}`);
    if (VERBOSE && status !== 200) console.log(`${role} ${path} -> ${status} ${error}`);
  }
}
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('endpoint (* = read on load for that role)', 62) + ROLES.map(r => pad(r.replace('cleaning_manager', 'clean_mgr').replace('super_admin', 'super'), 10)).join(''));
let ok = 0, total = 0;
for (const [key, { loads, cells }] of Object.entries(results)) {
  console.log(pad(key.slice(0, 61), 62) + ROLES.map(r => { const c = cells[r]; total++; if (c?.status === 200) ok++; return pad(`${c?.status ?? '-'}${loads.has(r) ? '*' : ''}`, 10); }).join(''));
}
const errors = Object.entries(results).flatMap(([key, { cells }]) => Object.entries(cells).filter(([, c]) => c.status !== 200 && c.status !== 403).map(([r, c]) => `${r} ${key}: ${c.status} ${c.error}`));
console.log(`\n${ok}/${total} reads answered 200 (403 = the role may not read it).`);
console.log(failures.length ? `Reads the app makes on load that failed:\n  ${failures.join('\n  ')}` : 'Every read the app makes on load answered 200 for every role.');
if (errors.length) console.log(`Other non-200/403 answers:\n  ${errors.join('\n  ')}`);
process.exitCode = failures.length ? 1 : 0;
