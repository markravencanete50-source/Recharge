import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// The Worker has one trigger, every minute. scheduled() runs the 15-minute jobs on the :00, :15, :30 and :45 ticks
// (by the tick's scheduled time), the hourly ones on :00 only, the guest reviews on their own :05 tick, and a leftover
// "*/15 * * * *" trigger does nothing.
// worker/index.ts is loaded for real; every module it imports is replaced by a stub that records what was called.
const STUB = '/@worker-stub/';
const names = ['runWebPush', 'runEmailOutbox', 'runHostawayMessages', 'runHostawaySync', 'runHostawayReviews', 'securityRpc',
  'runStayReasonQuestions', 'runStaySurveys', 'dispatchNotifications', 'handleImageOptimization', 'securityHeaders',
  'backendRouteAllowed', 'hashedWorkspaceFile', 'isWorkspaceApp'];
const stubs = {
  name: 'worker-stubs', enforce: 'pre',
  resolveId(id, importer) { return importer?.replace(/\\/g, '/').endsWith('/worker/index.ts') ? STUB + encodeURIComponent(id) + '.js' : null; },
  load(id) {
    if (!id.startsWith(STUB)) return null;
    const from = JSON.stringify(decodeURIComponent(id.slice(STUB.length, -3)));
    return names.map(name => `export function ${name}(...args) { globalThis.__workerCalls.push(${JSON.stringify(name)} + (args.length ? ' ' + JSON.stringify(args[0]) : '')); return globalThis.__workerGate ?? Promise.resolve(); }`).join('\n')
      + `\nexport const DEFAULT_DEVICE_SIZES = [], DEFAULT_IMAGE_SIZES = [];\nexport default { fetch() { throw Error(${from}); } };\n`;
  },
};
const vite = await createServer({ configFile: false, logLevel: 'silent', plugins: [stubs], ssr: { noExternal: true }, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const worker = (await vite.ssrLoadModule('/worker/index.ts')).default;

const env = { BACKEND_ONLY: 'true', HOSTAWAY_ACCOUNT_ID: '1', HOSTAWAY_API_KEY: 'k', HOSTAWAY_SYNC_ENABLED: 'true',
  RESEND_API_KEY: 'r', EMAIL_REPLIES_ENABLED: 'true', INTEGRATION_SCHEDULE_ENABLED: 'true' };
async function run(controller, environment = env) {
  globalThis.__workerCalls = [];
  const pending = [];
  await worker.scheduled(controller, environment, { waitUntil: promise => pending.push(promise), passThroughOnException() {} });
  await Promise.all(pending);
  return globalThis.__workerCalls;
}
const at = (iso, cron = '* * * * *', environment = env) => run({ cron, scheduledTime: Date.parse(iso) }, environment);
const EVERY_MINUTE = ['runWebPush', 'runEmailOutbox', 'runHostawayMessages "schedule"'];
const QUARTER = ['runHostawaySync "schedule"', 'securityRpc "workspace_open_pricing_gaps"', 'securityRpc "workspace_routine_auto"',
  'securityRpc "workspace_mid_stay_cleans"', 'securityRpc "workspace_clean_morning_notices"', 'runStayReasonQuestions',
  'runStaySurveys', 'securityRpc "workspace_agreement_followup_sweep"', 'securityRpc "workspace_chase_owner_approvals"', 'securityRpc "workspace_roll_over_signoffs"',
  'securityRpc "workspace_weekly_report_notices"', 'securityRpc "workspace_privacy_retention"', 'dispatchNotifications'];
const REVIEWS = 'runHostawayReviews "schedule"';
const HOURLY = ['securityRpc "workspace_ensure_daily_todos"', 'securityRpc "workspace_clean_form_sweep"',
  'securityRpc "workspace_cleaner_invoice_run"', 'securityRpc "workspace_va_pay_run"'];
const SIX_HOURLY = ['securityRpc "workspace_direct_booking_sweep"'];
const sorted = list => [...list].sort();

test('the minute ticks at :00, :15, :30 and :45 run the 15-minute jobs, each once', async () => {
  for (const minute of ['15', '30', '45']) {
    assert.deepEqual(sorted(await at(`2026-10-16T09:${minute}:00Z`)), sorted([...EVERY_MINUTE, ...QUARTER]), ':' + minute);
  }
  assert.deepEqual(sorted(await at('2026-10-16T09:00:00Z')), sorted([...EVERY_MINUTE, ...QUARTER, ...HOURLY]), ':00');
});

test('every other minute runs only the every-minute jobs', async () => {
  for (const minute of ['01', '04', '06', '07', '14', '16', '29', '31', '44', '46', '59']) {
    assert.deepEqual(sorted(await at(`2026-10-16T09:${minute}:00Z`)), sorted(EVERY_MINUTE), ':' + minute);
  }
});

test('a leftover */15 trigger does nothing at all, so no job runs twice', async () => {
  for (const minute of ['00', '15', '30', '45']) assert.deepEqual(await at(`2026-12-01T00:${minute}:00Z`, '*/15 * * * *'), [], ':' + minute);
});

test('the hourly jobs run only at :00, and the six-hourly sweep only at :00 of every sixth hour', async () => {
  for (const hour of ['00', '06', '12', '18']) {
    assert.deepEqual(sorted(await at(`2026-10-16T${hour}:00:00Z`)), sorted([...EVERY_MINUTE, ...QUARTER, ...HOURLY, ...SIX_HOURLY]), hour);
    for (const minute of ['15', '30', '45']) {
      const calls = await at(`2026-10-16T${hour}:${minute}:00Z`);
      for (const job of [...HOURLY, ...SIX_HOURLY]) assert.ok(!calls.includes(job), `${job} at ${hour}:${minute}`);
    }
  }
  const nine = await at('2026-10-16T09:00:00Z');
  assert.ok(HOURLY.every(job => nine.includes(job)) && !nine.includes(SIX_HOURLY[0]), 'hourly but not six-hourly at 09:00');
});

test('the guest reviews run hourly on their own :05 tick, after its messages, and never with the sync', async () => {
  for (const hour of ['00', '09', '20', '23']) {
    const calls = await at(`2026-10-16T${hour}:05:00Z`);
    assert.deepEqual(sorted(calls), sorted([...EVERY_MINUTE, REVIEWS]), hour + ':05');
    assert.ok(calls.indexOf(REVIEWS) > calls.indexOf('runHostawayMessages "schedule"'), 'once the messages are in, never at once');
    assert.ok(!calls.includes('runHostawaySync "schedule"'));
  }
  for (const minute of ['00', '01', '04', '06', '15', '30', '35', '45', '55']) {
    assert.ok(!(await at(`2026-10-16T20:${minute}:00Z`)).includes(REVIEWS), ':' + minute);
  }
});

test('with Hostaway off, neither the reviews nor any other Hostaway job runs', async () => {
  for (const off of [{ HOSTAWAY_SYNC_ENABLED: 'false' }, { HOSTAWAY_API_KEY: '' }, { HOSTAWAY_ACCOUNT_ID: undefined }]) {
    for (const minute of ['00', '05']) {
      const calls = await at(`2026-10-16T20:${minute}:00Z`, '* * * * *', { ...env, ...off });
      assert.ok(!calls.some(call => /^runHostaway/.test(call)), JSON.stringify(off) + ' :' + minute);
    }
  }
});

test('scheduled() resolves only once every job it started has settled', async () => {
  let open;
  globalThis.__workerGate = new Promise(resolve => { open = resolve; });
  globalThis.__workerCalls = [];
  let settled = false;
  const tick = worker.scheduled({ cron: '* * * * *', scheduledTime: Date.parse('2026-10-16T20:00:00Z') }, env,
    { waitUntil() {}, passThroughOnException() {} }).then(() => { settled = true; });
  try {
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(globalThis.__workerCalls.length > 0, 'the jobs started');
    assert.equal(settled, false, 'still waiting for the jobs, so the cron time limit applies rather than the waitUntil one');
  } finally {
    open(); delete globalThis.__workerGate;
  }
  await tick;
  assert.equal(settled, true);
  const source = readFileSync('worker/index.ts', 'utf8');
  assert.match(source, /waitUntil\(job\) \{ jobs\.push\(job\); ctx\.waitUntil\(job\); \}/);
  assert.match(source, /await Promise\.allSettled\(jobs\);/);
});

test('the tick is placed by its scheduled time, not the moment it starts, and falls back to the clock', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-16T10:00:07Z') });
  // Scheduled for 09:59 but started at 10:00:07: still the 09:59 tick.
  assert.deepEqual(sorted(await at('2026-10-16T09:59:00Z')), sorted(EVERY_MINUTE));
  // No scheduledTime (an older runtime or a manual call): the clock says 10:00, so it is the hourly tick.
  assert.deepEqual(sorted(await run({ cron: '* * * * *' })), sorted([...EVERY_MINUTE, ...QUARTER, ...HOURLY]));
});

test('the backend asks for the every-minute trigger only', () => {
  assert.match(readFileSync('scripts/build-backend-config.mjs', 'utf8'), /triggers:\{crons:\['\* \* \* \* \*'\]\}/);
  const source = readFileSync('worker/index.ts', 'utf8');
  assert.match(source, /async scheduled\(controller: \{ cron\?: string; scheduledTime\?: number \}/);
  assert.equal(source.match(/\*\/15 \* \* \* \*/g).length, 2, 'only the leftover-trigger guard and its comment');
});
