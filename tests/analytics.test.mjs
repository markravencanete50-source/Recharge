import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const state = {}; globalThis.__analyticsRouteTest = state;
const mocks = {
  "@/app/chatgpt-auth": `export const getChatGPTUser=async()=>globalThis.__analyticsRouteTest.user;`,
  "@/lib/access": `export const getAccessProfile=async(email)=>{globalThis.__analyticsRouteTest.email=email;return globalThis.__analyticsRouteTest.profile;};`,
  "@/lib/workflows": `export const getWorkflowData=async()=>globalThis.__analyticsRouteTest.input.workflows;`,
  "@/lib/maintenance": `export const getMaintenanceData=async()=>globalThis.__analyticsRouteTest.input.maintenance;`,
  "@/lib/cleans": `export const getCleansData=async()=>globalThis.__analyticsRouteTest.input.cleans;`,
  "@/lib/property-database": `export const getPropertyDatabaseData=async()=>globalThis.__analyticsRouteTest.input.properties;`,
  "@/lib/onboarding": `export const getOnboardingData=async()=>globalThis.__analyticsRouteTest.input.onboarding;`,
};
const vite = await createServer({ configFile: false, appType: "custom", root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, plugins: [{
  name: "analytics-route-isolation", enforce: "pre",
  transform(code, id) { if (!/\/app\/api\/analytics\/(?:export\/)?route\.ts$/.test(id.replaceAll("\\", "/"))) return; for (const key of Object.keys(mocks)) code = code.replaceAll(`from "${key}"`, `from "analytics-test:${key}"`); return { code, map: null }; },
  resolveId(id) { return id.startsWith("analytics-test:") ? "\0" + id : null; },
  load(id) { return id.startsWith("\0analytics-test:") ? mocks[id.slice(16)] : null; },
}] });
after(async () => { delete globalThis.__analyticsRouteTest; await vite.close(); });
const { scopeAnalytics, buildAnalytics, buildWorkspaceAnalytics, periodError, presetPeriod, workspaceDateKey } = await vite.ssrLoadModule("/lib/analytics.ts");
const { defaultModulesForRole } = await vite.ssrLoadModule("/lib/modules.ts");
const route = await vite.ssrLoadModule("/app/api/analytics/route.ts");
const exportRoute = await vite.ssrLoadModule("/app/api/analytics/export/route.ts");
const { analyticsCsv } = await vite.ssrLoadModule("/lib/analytics-export.ts");
const { reportPresentation, weeklySparkline } = await vite.ssrLoadModule("/lib/report-presentation.ts");
const { comparison } = await vite.ssrLoadModule("/lib/report-presentation.ts");
const { scheduleWeek, moveScheduleDay, scheduleWeekLabel } = await vite.ssrLoadModule("/lib/schedule-presentation.ts");
const at = value => new Date(value).getTime() / 1000;
const date = at("2026-10-03T12:00:00Z");
const viewer = (role, email = "me@example.com", modules = defaultModulesForRole(role)) => ({ role, email, modules, status: "active" });
const input = {
  workflows: { available: true, tickets: [
    { board: "property_furnishing", sourceBusiness: "Stays", createdAt: date, status: "new", details: "private description" },
    { board: "aircover_reporting", sourceBusiness: "Stays", createdAt: date, status: "complete" },
    { board: "clean_issues", sourceBusiness: "Cleans", createdAt: date, status: "new" },
    { board: "onboarding_invoices", sourceBusiness: "Accounts", createdAt: date, status: "new" },
  ] },
  maintenance: { available: true, properties: [{ clientEmail: "me@example.com" }, { clientEmail: "other@example.com" }], tickets: [
    { clientEmail: "me@example.com", createdAt: date, status: "new", readyReference: null, accountsStatus: "not_created" },
    { clientEmail: "other@example.com", createdAt: date, status: "in_progress", readyReference: "READY-1", accountsStatus: "not_created" },
    { clientEmail: "me@example.com", createdAt: date, status: "closed", readyReference: "READY-2", accountsStatus: "paid" },
  ] },
  cleans: { available: true, cleaners: [{ id: "mine", email: "ME@example.com", status: "active" }, { id: "other", email: "other@example.com", status: "active" }],
    properties: [{ status: "active", cleanerId: "mine" }, { status: "active", cleanerId: "other" }],
    tickets: [{ cleanDate: "2026-10-03", assignedCleanerId: "mine", status: "approved" }, { cleanDate: "2026-10-03", assignedCleanerId: "other", status: "scheduled" }, { cleanDate: "2026-10-03", assignedCleanerId: null, status: "scheduled" }],
    mail: [{ clientEmail: "me@example.com", createdAt: date, status: "new" }, { clientEmail: "other@example.com", createdAt: date, status: "new" }],
  },
  properties: { available: true, properties: [{ ownerEmail: "ME@example.com" }, { ownerEmail: "other@example.com" }] },
  onboarding: { available: true, cases: [{ clientEmail: "me@example.com", createdAt: date, status: "live" }, { clientEmail: "other@example.com", createdAt: date, status: "live" }] },
};
const period = { from: "2026-10-03", to: "2026-10-03" };

test('schedule weeks contain Monday through Sunday across month, year and daylight-saving boundaries', () => {
  for (const date of ['2026-10-05','2026-10-11','2026-03-29','2026-10-25','2027-01-01']) {
    const week = scheduleWeek(date);
    assert.equal(week.length,7); assert.equal(new Set(week).size,7);
    assert.equal(new Date(week[0]+'T12:00:00Z').getUTCDay(),1);
    assert.equal(new Date(week[6]+'T12:00:00Z').getUTCDay(),0);
    assert.equal(moveScheduleDay(week[0],6),week[6]);
    assert.equal(moveScheduleDay(moveScheduleDay(date,7),-7),date);
  }
  assert.equal(scheduleWeekLabel('2026-10-05'),'5 to 11 Oct');
  assert.equal(scheduleWeekLabel('2026-09-30'),'28 Sept to 4 Oct');
});

test('comparisons describe the real previous count and actual inclusive period length', () => {
  assert.equal(comparison(38,1,30).text,'Up from 1 in the previous 30 days');
  assert.equal(comparison(12,20,7).text,'Down from 20 in the previous 7 days');
  assert.equal(comparison(0,0,30).text,'Same as before');
  assert.equal(comparison(3,0,30).text,'New this period');
  assert.equal(comparison(5,3,1).text,'Up from 3 in the previous 1 day');
});

test('daily status series, weekly chart buckets, summary and export share reconciled totals', () => {
  const records = Array.from({length:38},(_,i)=>({date:'2026-09-'+String(1+i%30).padStart(2,'0'),status:i<12?'complete':i<26?'waiting':'progress'}));
  const snapshot={title:'Example',description:'',propertyCount:2,propertyAvailable:true,propertyLabel:'Properties',sources:[{key:'workflows',name:'Workflows',available:true,records}]};
  const range={from:'2026-09-01',to:'2026-10-04'},report=reportPresentation(snapshot,range);
  assert.equal(report.headline,'12 of 38 tasks are done.');
  assert.equal(report.chartDays.length,5);
  for (const [field,total] of [['value',38],['completed',12],['waiting',14]]) {
    assert.equal(report.days.reduce((sum,day)=>sum+day[field],0),total);
    assert.equal(report.chartDays.reduce((sum,day)=>sum+day[field],0),total);
  }
  assert.equal(report.current.properties,2);
  assert.equal(report.current.status.reduce((sum,status)=>sum+status.value,0),38);
  assert.equal(report.summary,'Most work is in Workflows: 38 of 38 tasks.');
  assert.match(analyticsCsv(snapshot,range),/"Tasks","38"/);
  assert.match(analyticsCsv(snapshot,range),/"Completed","12"/);
  assert.match(analyticsCsv(snapshot,range),/"Waiting","14"/);
  assert.equal(report.queues[0].tone,'primary');
  assert.equal(report.sparkReady.total,true);
});

test('sparse metric graphs, unknown statuses and missing property data are handled honestly', () => {
  const snapshot={title:'Example',description:'',propertyCount:0,propertyAvailable:false,propertyLabel:'Properties',sources:[{key:'cleans',name:'Cleans',available:true,records:[{date:'2026-10-01',status:'complete'},{date:'2026-10-02',status:'future-status'}]}]};
  const report=reportPresentation(snapshot,{from:'2026-10-01',to:'2026-10-03'});
  assert.equal(report.sparkReady.total,false); assert.equal(report.sparkReady.complete,false);
  assert.equal(report.current.status.find(status=>status.name==='Other').value,1);
  assert.equal(report.current.status.reduce((n,status)=>n+status.value,0),2);
  assert.equal(report.current.properties,null);
  assert.equal(report.queues[0].tone,'cleans');
  assert.match(analyticsCsv(snapshot,{from:'2026-10-01',to:'2026-10-03'}),/"Properties \(as of today, not date-filtered\)","'-"/);
});

test('presentation comparisons use equal calendar periods across daylight saving and preserve export totals', () => {
  const snapshot = scopeAnalytics(viewer('admin'), input);
  for (const range of [{from:'2026-03-28',to:'2026-03-30'}, {from:'2026-10-24',to:'2026-10-26'}, period]) {
    const report = reportPresentation(snapshot, range);
    assert.deepEqual(report.current, buildAnalytics(snapshot, range));
    assert.equal((Date.parse(report.previousPeriod.to)-Date.parse(report.previousPeriod.from))/86400000+1, report.days.length);
    assert.equal(Date.parse(range.from)-Date.parse(report.previousPeriod.to),86400000);
    assert.equal(report.days.reduce((sum,day)=>sum+day.value,0),report.current.total);
    assert.equal(report.queues.reduce((sum,queue)=>sum+queue.value,0),report.current.total);
    assert.ok(report.queues.every((queue,i,list)=>i===0 || list[i-1].value>=queue.value));
    assert.equal(new Set(report.labels.map(label=>label.index)).size,report.labels.length);
  }
});
test('presentation distinguishes unavailable sources from a connected empty period', () => {
  const unavailable = reportPresentation(scopeAnalytics(viewer('admin'),{}),period);
  assert.equal(unavailable.available,false);
  assert.equal(unavailable.deltas.total,'Data unavailable');
  assert.ok(unavailable.queues.every(queue=>!queue.available));
  const empty = reportPresentation({...scopeAnalytics(viewer('admin'),input),sources:[{key:'cleans',name:'Cleans',available:true,records:[]}]},period);
  assert.equal(empty.available,true);
  assert.equal(empty.headline,'0 of 0 tasks are done.');
});
test('weekly overview delta is calculated only from the permitted source snapshot',()=>{
  const snapshot=scopeAnalytics(viewer('client'),input), spark=weeklySparkline(snapshot,'2026-10-03');
  assert.equal(spark.days.length,7);
  assert.equal(spark.deltaLabel,`+${spark.current.total-spark.previous.total} vs last week`);
  assert.deepEqual(spark.current.sources.map(s=>s.key),['repairs','onboarding','mail']);
});

test("custom ranges include both boundary dates and every chart reconciles, including cleans", () => {
  const result = buildWorkspaceAnalytics({ workflows: { available: true, tickets: [
    { createdAt: at("2026-10-02T23:00:00Z"), status: "new" }, // UK midnight October 3
    { createdAt: at("2026-10-03T22:59:59Z"), status: "complete" },
    { createdAt: at("2026-10-03T23:00:00Z"), status: "new" }, // October 4, excluded
  ] }, cleans: { available: true, tickets: [{ cleanDate: "2026-10-03", status: "approved" }] } }, period);
  assert.equal(result.total, 3); assert.equal(result.complete, 2);
  assert.equal(result.trend.length, 1); assert.equal(result.trend[0].cleans, 1);
  assert.equal(result.queues.reduce((sum, q) => sum + q.value, 0), result.total);
  assert.equal(result.status.reduce((sum, q) => sum + q.value, 0), result.total);
  assert.equal(result.trend.reduce((sum, q) => sum + (q.workflows || 0) + (q.repairs || 0) + (q.cleans || 0), 0), result.total);
});
test("date validation catches reversed, impossible and excessively long ranges while accepting leap years", () => {
  assert.match(periodError({ from: "2026-10-04", to: "2026-10-03" }), /end date/);
  assert.match(periodError({ from: "2026-02-30", to: "2026-03-01" }), /valid/);
  assert.match(periodError({ from: "2025-01-01", to: "2026-01-02" }), /366/);
  assert.equal(periodError({ from: "2024-01-01", to: "2024-12-31" }), "");
  assert.throws(() => buildAnalytics(scopeAnalytics(viewer("admin"), input), { from: "", to: "" }), /valid/);
  assert.throws(() => presetPeriod(0), /366/);
});
test("UK dates and daily buckets survive daylight-saving changes, year boundaries and single-day presets", () => {
  assert.equal(workspaceDateKey(at("2026-03-29T23:30:00Z") * 1000), "2026-03-30");
  assert.equal(workspaceDateKey(at("2026-10-25T23:30:00Z") * 1000), "2026-10-25");
  assert.deepEqual(presetPeriod(1, at("2026-10-03T23:30:00Z") * 1000), { from: "2026-10-04", to: "2026-10-04" });
  for (const range of [{ from: "2026-03-28", to: "2026-03-30" }, { from: "2026-10-24", to: "2026-10-26" }, { from: "2025-12-31", to: "2026-01-02" }]) {
    const result = buildAnalytics(scopeAnalytics(viewer("admin"), {}), range);
    assert.equal(result.trend.length, 3); assert.equal(new Set(result.trend.map(t => t.key)).size, 3);
    assert.equal(result.trend[0].key, range.from); assert.equal(result.trend[2].key, range.to);
  }
});
test("client analytics includes only their own property, maintenance, onboarding and mail", () => {
  const snapshot = scopeAnalytics(viewer("client"), input), metrics = buildAnalytics(snapshot, period);
  assert.equal(snapshot.propertyCount, 1); assert.equal(metrics.total, 4);
  assert.deepEqual(snapshot.sources.map(s => s.key), ["repairs", "onboarding", "mail"]);
  assert.ok(!JSON.stringify(snapshot).includes("other@example.com"));
  assert.ok(!JSON.stringify(snapshot).includes("private description"));
  assert.equal(snapshot.sources.find(s => s.key === "repairs").records.length, 2);
});
test("cleaner analytics excludes other cleaners and unassigned jobs even with default Cleans permissions", () => {
  const snapshot = scopeAnalytics(viewer("cleans"), input);
  assert.equal(snapshot.title, "My cleaning analytics"); assert.equal(snapshot.propertyCount, 1);
  assert.deepEqual(snapshot.sources.map(s => s.key), ["cleans"]);
  assert.equal(buildAnalytics(snapshot, period).total, 1);
  const unlinked = scopeAnalytics(viewer("cleans", "not-linked@example.com", ["cleaning-schedule"]), input);
  assert.equal(buildAnalytics(unlinked, period).total, 0); assert.equal(unlinked.propertyCount, 0);
  const unlinkedDefault = scopeAnalytics(viewer("cleans", "not-linked@example.com"), input);
  assert.equal(buildAnalytics(unlinkedDefault, period).total, 0);
  const manager = scopeAnalytics(viewer("cleaning_manager"), input);
  assert.equal(manager.title, "Cleaning team analytics");
  assert.equal(manager.sources.find(source => source.key === "cleans").records.length, 3);
});
test("department, custom accounts permissions and inactive accounts obey module grants", () => {
  assert.equal(buildAnalytics(scopeAnalytics(viewer("super_admin"), input), period).total, 10);
  assert.equal(buildAnalytics(scopeAnalytics(viewer("admin"), input), period).total, 10);
  const ready = scopeAnalytics(viewer("ready"), input);
  assert.deepEqual(ready.sources.map(s => s.key), ["workflows", "repairs"]);
  assert.equal(buildAnalytics(ready, period).total, 3);
  assert.equal(buildAnalytics(scopeAnalytics(viewer("stays"), input), period).total, 9);
  const accounts = scopeAnalytics(viewer("ready", "accounts@example.com", ["onboarding-invoices", "maintenance-reconciliation"]), input);
  assert.equal(buildAnalytics(accounts, period).total, 2);
  assert.deepEqual(scopeAnalytics(viewer("ready", "me@example.com", []), input).sources, []);
  assert.deepEqual(scopeAnalytics({ ...viewer("super_admin"), status: "revoked" }, input).sources, []);
  assert.equal(scopeAnalytics({ ...viewer("admin"), status: "pending" }, input).propertyCount, 0);
});
test("unavailable sources and empty date ranges cannot contribute misleading counts", () => {
  const snapshot = scopeAnalytics(viewer("admin"), { ...input, cleans: { ...input.cleans, available: false } });
  assert.equal(buildAnalytics(snapshot, period).total, 7);
  assert.equal(snapshot.sources.find(s => s.key === "cleans").available, false);
  assert.equal(buildAnalytics(snapshot, { from: "2020-01-01", to: "2020-01-02" }).total, 0);
});
test("analytics API requires verified identity and active access, ignoring caller-supplied roles", async () => {
  Object.assign(state, { user: null, profile: null, input });
  assert.equal((await route.GET()).status, 401);
  state.user = { email: "me@example.com", displayName: "Example" };
  assert.equal((await route.GET()).status, 403);
  state.profile = viewer("client");
  const response = await route.GET(new Request("https://recharge.example/api/analytics?role=super_admin&email=other@example.com"));
  assert.equal(response.status, 200); assert.equal(state.email, "me@example.com");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const data = (await response.json()).data;
  assert.equal(data.title, "My property analytics"); assert.equal(buildAnalytics(data, period).total, 4);
});

test("report downloads require active admin identity and reject forged roles, revoked users and invalid dates", async () => {
  const request = new Request("https://recharge.example/api/analytics/export?from=2026-10-03&to=2026-10-03&role=super_admin");
  Object.assign(state, { user: null, profile: null, input });
  assert.equal((await exportRoute.GET(request)).status, 401);
  state.user = { email: "me@example.com", displayName: "Example" };
  for (const role of ["client", "cleans", "cleaning_manager", "ready", "stays"]) {
    state.profile = viewer(role);
    assert.equal((await exportRoute.GET(request)).status, 403);
  }
  for (const status of ["revoked", "pending", "suspended"]) {
    state.profile = { ...viewer("super_admin"), status };
    assert.equal((await exportRoute.GET(request)).status, 403);
  }
  for (const role of ["admin", "super_admin"]) {
    state.profile = viewer(role);
    const response = await exportRoute.GET(request);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.match(response.headers.get("content-disposition"), /2026-10-03-2026-10-03.csv/);
    assert.match(await response.text(), /"Tasks","10"/);
    assert.equal((await exportRoute.GET(new Request("https://recharge.example/api/analytics/export?from=2026-02-30&to=2026-03-01"))).status, 400);
  }
});

test("CSV exports reconcile with selected charts, distinguish unavailable data and neutralize spreadsheet formulas", () => {
  const snapshot = scopeAnalytics(viewer("admin"), { ...input, cleans: { ...input.cleans, available: false } });
  snapshot.title = '=HYPERLINK("evil")';
  const csv = analyticsCsv(snapshot, period, true);
  assert.match(csv, /SAMPLE DATA ONLY/);
  assert.match(csv, /"Tasks","7"/);
  assert.match(csv, /Not connected, excluded/);
  assert.match(csv, /"Report","'=HYPERLINK\(""evil""\)"/);
  assert.match(csv, /as of today, not date-filtered/);
  const empty = analyticsCsv(snapshot, { from: "2020-01-01", to: "2020-01-02" });
  assert.match(empty, /"Tasks","0"/);
  assert(!empty.includes("private description"));
});
