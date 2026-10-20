import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Leads and Estimate Delivery (lib/lead-estimate.ts, lib/lead-policy.ts): the distance helper, the ticket's facts with TBC,
// the checklist and its five steps, what each step needs, the estimate built from them, and the rename to Leads.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const L = await vite.ssrLoadModule('/lib/lead-estimate.ts');
const { teamsActionSchema, teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { MAX_COMPARABLES, MAX_SAVED_COMPARABLES } = await vite.ssrLoadModule('/lib/journey-policy.ts');
const { estimateComparables } = await vite.ssrLoadModule('/lib/workspace-view.ts');
const { estimateComparablesOf } = await vite.ssrLoadModule('/lib/estimate-link.ts');
const { rolePanel } = await vite.ssrLoadModule('/lib/role-panel.ts');
const { CLIENT_SUB_LABEL } = await vite.ssrLoadModule('/lib/relations-subs.ts');
const { homeToolsFor } = await vite.ssrLoadModule('/lib/home-tools.ts');
const { MODULE_IDS } = await vite.ssrLoadModule('/lib/modules.ts');
const { noticeCopy } = await vite.ssrLoadModule('/lib/notice-copy.ts');
const { pushTarget } = await vite.ssrLoadModule('/lib/push-copy.ts');
const { backendRouteAllowed } = await vite.ssrLoadModule('/worker/backend-route-policy.ts');

const EDINBURGH = { lat: 55.9533, lon: -3.1883 }, GLASGOW = { lat: 55.8642, lon: -4.2518 }, LONDON = { lat: 51.5072, lon: -0.1276 };
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('haversine distance in miles', () => {
  assert.equal(L.haversineMiles(EDINBURGH, EDINBURGH), 0);
  const eg = L.haversineMiles(EDINBURGH, GLASGOW);
  assert.ok(eg > 41 && eg < 43, String(eg));
  assert.equal(L.haversineMiles(GLASGOW, EDINBURGH), eg, 'the same both ways');
  const le = L.haversineMiles(LONDON, EDINBURGH);
  assert.ok(le > 325 && le < 335, String(le));
  assert.equal(L.roundMiles(12.345), 12.3);
  assert.equal(L.milesText(4.26), '4.3 mi');
});

test('where a lead or property is: its coordinates, else its postcode district, else unknown', () => {
  assert.deepEqual(L.placeOf({ latitude: 55.95, longitude: -3.19, address: 'x' }), { lat: 55.95, lon: -3.19, precision: 'exact' });
  const district = L.placeOf({ latitude: null, longitude: null, address: '12 Leith Walk, Edinburgh EH6 5AB' });
  assert.equal(district.precision, 'district');
  assert.ok(L.haversineMiles(district, EDINBURGH) < 5);
  assert.equal(L.placeOf({ latitude: null, longitude: null, address: 'A farm somewhere' }), null);
  assert.equal(L.placeOf({ latitude: 95, longitude: 0, address: '' }), null, 'a latitude that cannot be');
  assert.equal(L.placeOf(null), null);
});

test('within 30 miles, nearest first, with the distance', () => {
  const items = [
    { id: 'glasgow', latitude: GLASGOW.lat, longitude: GLASGOW.lon, address: '' },
    { id: 'leith', latitude: 55.9757, longitude: -3.1684, address: '' },
    { id: 'linlithgow', latitude: 55.9765, longitude: -3.6003, address: '' },
    { id: 'nowhere', latitude: null, longitude: null, address: 'No postcode' },
    { id: 'by-postcode', latitude: null, longitude: null, address: '1 High Street, Musselburgh EH21 7AA' },
  ];
  const near = L.withinRadius(items, { ...EDINBURGH, precision: 'exact' });
  assert.deepEqual(near.map(x => x.id), ['leith', 'by-postcode', 'linlithgow']);
  assert.ok(near.every(x => x.miles <= L.LEAD_RADIUS_MILES));
  assert.deepEqual(L.withinRadius(items, null), [], 'no position, nothing listed');
  assert.equal(L.LEAD_RADIUS_MILES, 30);
  assert.deepEqual(L.withinRadius(items, { ...EDINBURGH, precision: 'exact' }, 50).map(x => x.id).at(-1), 'glasgow');
});

test('occupancy trend: the latest three months against the three before', () => {
  const months = bps => bps.map((occupancyBps, i) => ({ month: '2026-0' + (i + 1), occupancyBps }));
  assert.equal(L.occupancyTrend(months([4000, 4000, 4000, 6000, 6000, 6000])), 'rising');
  assert.equal(L.occupancyTrend(months([7000, 7000, 7000, 5000, 5000, 5000])), 'falling');
  assert.equal(L.occupancyTrend(months([5000, 5200, 5100, 5300, 5000, 5100])), 'steady');
  assert.equal(L.occupancyTrend(months([0, 0, 0, 0, 0, 0])), 'unknown');
  assert.equal(L.occupancyTrend(months([5000])), 'unknown');
});

const answered = { fullName: 'Pat Lead', email: 'pat@example.com', phone: '07700 900111', propertyAddress: '12 Leith Walk, Edinburgh EH6 5AB', propertyType: 'Flat', bedrooms: 2, bathrooms: 1 };
test('the ticket lists everything the landlord told us, with TBC beside what is not collected yet', () => {
  const groups = L.leadFacts({ answers: answered, recipientName: 'Pat', recipientEmail: 'pat@example.com' });
  const fact = label => groups.flatMap(g => g.facts).find(f => f.label === label);
  assert.deepEqual(groups.map(g => g.title), ['Contact information', 'Property information', 'Services']);
  assert.equal(L.factText(fact('Bedrooms')), '2');
  assert.equal(L.factText(fact('WCs')), 'TBC');
  assert.equal(L.factText(fact('Parking')), 'TBC');
  assert.equal(L.factText(fact('Short-term let now')), 'TBC');
  assert.ok(!groups.flatMap(g => g.facts).some(f => f.label === 'Correspondence address'), 'older questions only when answered');
  // A form not answered yet: the name and email from the invite, everything else TBC.
  const sent = L.leadFacts({ answers: null, recipientName: 'Sam Sent', recipientEmail: 'sam@example.com' });
  assert.equal(sent.flatMap(g => g.facts).find(f => f.label === 'Full name').value, 'Sam Sent');
  assert.equal(L.missingFacts(sent), sent.flatMap(g => g.facts).length - 2);
});

const row = (step, ticked = true) => ({ step, data: {}, savedAt: '2026-10-20T10:00:00Z', savedByName: 'Fiona', tickedAt: ticked ? '2026-10-20T10:00:00Z' : null, tickedByName: ticked ? 'Fiona' : null });
const enquiry = { status: 'valuing', answers: answered };
test('the checklist: Estimate Delivery has five tasks in order, ticked when all five are, then Sign Agreement', () => {
  let c = L.leadChecklist({ enquiry, journey: { stage: 'enquiry' }, steps: [] });
  assert.deepEqual(c.map(x => x.label), ['Enquiry received', 'Estimate Delivery', 'Sign Agreement', 'Property setup', 'Onboarding invoice', 'Inspection', 'Live']);
  assert.deepEqual(c.map(x => x.state), ['done', 'current', 'todo', 'todo', 'todo', 'todo', 'todo']);
  assert.deepEqual(c[1].subSteps.map(s => [s.label, s.state]), [['Internal Analysis', 'current'], ['External Analysis', 'todo'], ['Local Area Analysis', 'todo'], ['Estimated Revenue', 'todo'], ['Submit Estimate', 'todo']]);
  const two = [row('internal'), row('external')];
  c = L.leadChecklist({ enquiry, journey: { stage: 'enquiry' }, steps: two });
  assert.deepEqual(c[1].subSteps.map(s => s.state), ['done', 'done', 'current', 'todo', 'todo']);
  assert.equal(L.nextLeadStep(two), 'local');
  assert.equal(L.canOpenStep(two, 'local'), true); assert.equal(L.canOpenStep(two, 'revenue'), false);
  const all = L.LEAD_STEPS.map(s => row(s));
  c = L.leadChecklist({ enquiry, journey: { stage: 'estimate' }, steps: all });
  assert.deepEqual(c.map(x => x.state).slice(0, 3), ['done', 'done', 'current']);
  assert.equal(c[2].label, 'Sign Agreement');
  // A lead from before the steps, already past the estimate, counts it as delivered.
  c = L.leadChecklist({ enquiry, journey: { stage: 'form' }, steps: [] });
  assert.deepEqual(c.map(x => x.state).slice(0, 5), ['done', 'done', 'done', 'current', 'todo']);
  // A form not back yet: nothing is done; a declined lead has no current step.
  c = L.leadChecklist({ enquiry: { status: 'sent', answers: null }, journey: null, steps: [] });
  assert.equal(c[0].state, 'current');
  c = L.leadChecklist({ enquiry, journey: { stage: 'archived' }, steps: [] });
  assert.ok(c.every(x => x.state !== 'current'));
});

test('what each step needs before it is ticked', () => {
  assert.match(L.leadStepIssue('internal', { rows: [], notes: '' }, true), /Add a note/);
  assert.equal(L.leadStepIssue('internal', { rows: [], notes: '' }, false), null, 'a draft saves');
  assert.equal(L.leadStepIssue('internal', { rows: [], notes: 'No position: based on the PriceLabs report' }, true), null);
  assert.match(L.leadStepIssue('internal', { rows: [{ propertyId: uuid(1), name: 'Far', miles: 31 }], notes: '' }, false), /within 30 miles/);
  const comp = i => ({ name: 'Flat ' + i, url: 'https://www.airbnb.co.uk/rooms/' + i, adrMinor: 10000 });
  assert.match(L.leadStepIssue('external', { reportUrl: 'https://app.pricelabs.co/r/1', comparables: [1, 2, 3, 4].map(comp), averageRateMinor: 11000 }, true), /Up to 3 comparables/);
  assert.match(L.leadStepIssue('external', { comparables: [comp(1)], averageRateMinor: 11000 }, true), /PriceLabs report/);
  assert.match(L.leadStepIssue('external', { reportUrl: 'https://app.pricelabs.co/r/1' }, true), /average nightly rate/);
  assert.match(L.leadStepIssue('external', { reportUrl: 'http://insecure.example' }, false), /https/);
  assert.equal(L.leadStepIssue('external', { reportFileId: uuid(9), comparables: [1, 2, 3].map(comp), averageRateMinor: 11000 }, true), null);
  assert.match(L.leadStepIssue('revenue', { lowRateMinor: 9000 }, true), /low, medium and high/);
  assert.match(L.leadStepIssue('revenue', { lowRateMinor: 12000, mediumRateMinor: 10000, highRateMinor: 15000 }, true), /at least the low/);
  assert.equal(L.leadStepIssue('revenue', { lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 15000, occupancyBps: 7500 }, true), null);
  assert.equal(L.leadStepIssue('local', { items: [], notes: '' }, true), null, 'nothing nearby can still be approved');
  // The team route checks the same before anything is sent.
  const save = (step, data, done) => teamsActionSchema.safeParse({ action: 'saveLeadStep', requestId: uuid(1), enquiryId: uuid(2), step, data, done });
  assert.equal(save('revenue', { lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 15000 }, true).success, true);
  assert.equal(save('revenue', { lowRateMinor: 9000 }, true).success, false);
  assert.equal(save('submit', {}, true).success, false, 'Submit Estimate is ticked by publishing');
  assert.equal(teamsActionSchema.safeParse({ action: 'reopenLeadStep', requestId: uuid(1), enquiryId: uuid(2), step: 'submit' }).success, true);
  assert.equal(teamsReadSchema.safeParse({ section: 'lead', enquiryId: uuid(2) }).success, true);
  assert.equal(teamsReadSchema.safeParse({ section: 'lead' }).success, false);
  assert.equal(teamsReadSchema.safeParse({ section: 'clientEnquiries', enquiryId: uuid(2) }).success, false);
});

test('the estimate is built from the steps, with up to 3 comparables; saved estimates with more still read', () => {
  const journey = { propertyId: uuid(5), version: 4, stage: 'enquiry' };
  assert.match(L.estimateFromSteps({ journey, steps: [row('internal')] }).error, /Finish External Analysis first/);
  assert.match(L.estimateFromSteps({ journey: null, steps: [] }).error, /Value the lead first/);
  const comp = i => ({ name: 'Flat ' + i, url: 'https://www.airbnb.co.uk/rooms/' + i, adrMinor: 10000 + i });
  const steps = [row('internal'), { ...row('external'), data: { reportUrl: 'https://app.pricelabs.co/r/1', comparables: [1, 2, 3].map(comp), averageRateMinor: 11000 } }, row('local'),
    { ...row('revenue'), data: { lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 15000, occupancyBps: 7500, otaFeeBps: 1500, ownCosts: [{ category: 'Mortgage', monthlyMinor: 50000 }], comments: 'Summer peaks' } }];
  assert.deepEqual(L.estimateFromSteps({ journey, steps }), {
    action: 'publishEstimate', propertyId: uuid(5), version: 4, lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 15000, comments: 'Summer peaks',
    occupancyBps: 7500, otaFeeBps: 1500, comparables: [1, 2, 3].map(comp), ownCosts: [{ category: 'Mortgage', monthlyMinor: 50000 }],
  });
  assert.equal(MAX_COMPARABLES, 3); assert.equal(MAX_SAVED_COMPARABLES, 20); assert.equal(L.MAX_LEAD_COMPARABLES, 3);
  assert.equal(estimateComparables({ comparables: Array.from({ length: 12 }, (_, i) => comp(i)) }).length, 12, 'an older estimate with 12 still reads');
  assert.equal(estimateComparablesOf({ comparables: Array.from({ length: 12 }, (_, i) => comp(i)) }).length, 12, 'the owner estimate page reads all 12 an older estimate was saved with');
  assert.equal(estimateComparablesOf({ comparables: Array.from({ length: 25 }, (_, i) => comp(i)) }).length, MAX_SAVED_COMPARABLES);
});

test('the thread: the lead history and the team, oldest first', () => {
  const e = { source: 'form', sentAt: '2026-10-01T09:00:00Z', sentByName: 'Morag', openedAt: '2026-10-02T09:00:00Z', submittedAt: '2026-10-03T09:00:00Z', valuedAt: null, valuedByName: null, closedAt: null, closeNote: '', closedByName: null,
    estimateDelivery: null, answers: answered, recipientName: 'Pat' };
  const activity = [{ id: 2, kind: 'comment', text: 'Called them', byId: uuid(1), byName: 'Fiona', at: '2026-10-04T09:00:00Z' }, { id: 1, kind: 'event', text: 'approved Internal Analysis', byId: uuid(1), byName: 'Fiona', at: '2026-10-03T12:00:00Z' }];
  assert.deepEqual(L.leadFeed({ enquiry: e, activity }).map(L.feedWords), ['Morag sent the enquiry form', 'Pat Lead opened the form', 'Pat Lead sent the form back', 'Fiona approved Internal Analysis', 'Fiona Called them']);
});

test('Client enquiries is Leads in the menu, the Client relations chip and the tools; links and keys are unchanged', () => {
  const link = rolePanel('admin', [...MODULE_IDS]).groups.flatMap(g => g.links).find(l => l.key === 'page:enquiries');
  assert.equal(link.label, 'Leads');
  assert.equal(CLIENT_SUB_LABEL.enquiries, 'Leads');
  assert.equal(homeToolsFor('admin', [...MODULE_IDS]).find(t => t.key === 'enquiries')?.label ?? 'Leads', 'Leads');
  assert.match(readFileSync('mobile/src/LiveEnquiries.tsx', 'utf8'), /<PageHeading palette=\{p\} title=\{LEADS_TITLE\}/);
  assert.equal(L.LEADS_TITLE, 'Leads');
  // A comment on a lead is an enquiry notice: it opens Leads.
  assert.equal(noticeCopy('enquiry.lead_comment').title, 'New comment on a lead');
  assert.equal(pushTarget('enquiry.lead_comment', {}).url, '/workspace/live?section=enquiries');
  for (const path of ['/api/workspace/lead-files', '/api/mobile/lead-files']) assert.equal(backendRouteAllowed(path), true, path);
});

test('the ticket is a wide two-pane page that stacks on a phone, with plain words', () => {
  const ticket = readFileSync('mobile/src/LeadTicket.tsx', 'utf8');
  assert.match(ticket, /width=\{TASK_PAGE_WIDTH\}/);
  assert.match(ticket, /const twoPanes = width >= TASK_TWO_PANES_FROM;/);
  for (const file of ['mobile/src/LeadTicket.tsx', 'lib/lead-estimate.ts', 'lib/lead-policy.ts', 'lib/lead-files-server.ts', 'supabase/migrations/20261025300000_lead_estimate_delivery.sql']) {
    const text = readFileSync(file, 'utf8');
    assert.equal(text.includes(String.fromCharCode(0x2014)), false, file + ': no em dash');
    assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, file + ': no emoji');
  }
});
