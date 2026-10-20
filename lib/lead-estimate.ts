import { z } from 'zod';
import { clientEnquirySchema, REFERRAL_LABEL, STAGE_LABEL, type ClientEnquiry } from './client-enquiry';
import { POSTCODE_DISTRICTS } from './postcode-districts';
import { postcodeDistrict } from './property-points';
import { MAX_COMPARABLES } from './journey-policy';
import { LEAD_RADIUS_MILES, LEAD_STEPS, internalRowSchema, localItemSchema, stepDataSchema, type LeadStep, type SavableStep, type StepData } from './lead-policy';
import { ONBOARDING_STAGES, ONBOARDING_STEPS } from './tracker-onboarding';

// Leads (Alex's property onboarding framework, the staff side; migration 20261025300000). "Client enquiries" is called Leads.
// A lead's ticket shows everything the landlord has told us (TBC beside anything not collected yet), the onboarding checklist
// and an activity thread the team writes in. Estimate Delivery is five tasks in order, each ticked on its own:
//   Internal Analysis    our properties within 30 miles, with their occupancy, nightly rate and performance (no AI)
//   External Analysis    the PriceLabs report (a link or a file), up to 3 comparables chosen by hand, the average nightly rate
//   Local Area Analysis  saved local events and repair work within 30 miles over the next 12 months
//   Estimated Revenue    the low, medium and high nightly rates, with occupancy, fees and the owner's own costs
//   Submit Estimate      the existing publish: the client is emailed and told in the app as before
// When all five are ticked, Estimate Delivery is ticked on the checklist; Sign Agreement comes next.

export * from './lead-policy';
export const LEADS_TITLE = 'Leads';
export const TBC = 'TBC';
export const LEAD_STEP_LABEL: Record<LeadStep, string> = {
  internal: 'Internal Analysis', external: 'External Analysis', local: 'Local Area Analysis', revenue: 'Estimated Revenue', submit: 'Submit Estimate',
};
export const LEAD_STEP_HELP: Record<LeadStep, string> = {
  internal: `Our properties within ${LEAD_RADIUS_MILES} miles, with their occupancy, nightly rate and performance. Remove any that do not compare, add notes, then approve.`,
  external: 'Create the PriceLabs revenue estimate report, then add it here as a link or a file. Choose up to 3 comparables and enter the average nightly rate.',
  local: `Saved local events and repair work within ${LEAD_RADIUS_MILES} miles over the next 12 months. Remove what does not matter, add notes, then approve.`,
  revenue: 'The low, medium and high nightly rates, with the expected occupancy, the fees and the owner’s own costs.',
  submit: 'Check everything, then submit. The client is emailed the estimate and told in the app.',
};
// The overarching checklist, in the words of Alex's framework (the keys are the onboarding steps in lib/tracker-onboarding.ts).
export const LEAD_CHECKLIST_LABEL: Record<string, string> = {
  enquiry: 'Enquiry received', estimate: 'Estimate Delivery', agreement: 'Sign Agreement', setup: 'Property setup', invoice: 'Onboarding invoice', inspection: 'Inspection', live: 'Live',
};

// ---------------------------------------------------------------- distance
export type Place = { lat: number; lon: number; precision: 'exact' | 'district' };
const EARTH_MILES = 3958.7613;
const radians = (d: number) => (d * Math.PI) / 180;
// The great-circle distance in miles between two points (the haversine formula).
export function haversineMiles(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = radians(b.lat - a.lat), dLon = radians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}
const coordinate = (v: unknown, limit: number) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit ? v : null;
// Where a property is: its saved latitude and longitude, else the middle of its postcode district (approximate), else unknown.
export function placeOf(p: { latitude?: number | null; longitude?: number | null; address?: string | null } | null | undefined): Place | null {
  if (!p) return null;
  const lat = coordinate(p.latitude, 90), lon = coordinate(p.longitude, 180);
  if (lat !== null && lon !== null) return { lat, lon, precision: 'exact' };
  const district = postcodeDistrict(p.address ?? ''), centre = district ? POSTCODE_DISTRICTS[district] : undefined;
  return centre ? { lat: centre[0], lon: centre[1], precision: 'district' } : null;
}
export const roundMiles = (miles: number) => Math.round(miles * 10) / 10;
export const milesText = (miles: number | null | undefined) => typeof miles === 'number' ? `${roundMiles(miles).toLocaleString('en-GB')} mi` : '';
// Things with a place, within the radius of the lead, nearest first, each with its distance.
export function withinRadius<T extends { latitude?: number | null; longitude?: number | null; address?: string | null }>(items: readonly T[], from: Place | null, radius = LEAD_RADIUS_MILES): (T & { miles: number })[] {
  if (!from) return [];
  return items.flatMap(item => {
    const at = placeOf(item);
    if (!at) return [];
    const miles = haversineMiles(from, at);
    return miles <= radius ? [{ ...item, miles: roundMiles(miles) }] : [];
  }).sort((a, b) => a.miles - b.miles);
}

// ---------------------------------------------------------------- the read
const num = z.number().nullable();
const placeFields = { latitude: num.default(null), longitude: num.default(null), address: z.string().default('') };
export const leadStatsSchema = z.object({
  stays: z.number(), nights: z.number(), occupancyBps: z.number(), adrMinor: num, revenueMinor: num,
  trend: z.array(z.object({ month: z.string(), occupancyBps: z.number() })).nullable().transform(t => t ?? []),
});
export type LeadStats = z.infer<typeof leadStatsSchema>;
export const leadOurPropertySchema = z.object({ id: z.string().uuid(), name: z.string(), bedrooms: z.number(), stats: leadStatsSchema, ...placeFields });
export const leadEventSchema = z.object({ id: z.string().uuid(), name: z.string(), on: z.string(), sourceUrl: z.string(), opportunity: z.string(), propertyId: z.string().uuid(), propertyName: z.string(), ...placeFields });
export const leadRepairSchema = z.object({ id: z.string().uuid(), title: z.string(), status: z.string(), dueOn: z.string().nullable(), visitFrom: z.string().nullable(), contractor: z.string().nullable(), propertyId: z.string().uuid(), propertyName: z.string(), ...placeFields });
export const leadStepRowSchema = z.object({ step: z.enum(LEAD_STEPS), data: z.record(z.unknown()), savedAt: z.string(), savedByName: z.string().nullable(), tickedAt: z.string().nullable(), tickedByName: z.string().nullable() });
export type LeadStepRow = z.infer<typeof leadStepRowSchema>;
export const leadActivitySchema = z.object({ id: z.number(), kind: z.enum(['comment', 'event']), text: z.string(), byId: z.string().uuid().nullable(), byName: z.string().nullable(), at: z.string() });
export type LeadActivity = z.infer<typeof leadActivitySchema>;
export const leadFileSchema = z.object({ id: z.string().uuid(), name: z.string(), mime: z.string(), bytes: z.number(), at: z.string() });
export type LeadFile = z.infer<typeof leadFileSchema>;
export const leadStateSchema = z.object({ enquiryId: z.string().uuid(), steps: z.array(leadStepRowSchema), files: z.array(leadFileSchema), activity: z.array(leadActivitySchema) });
export type LeadState = z.infer<typeof leadStateSchema>;
export const leadReadSchema = leadStateSchema.extend({
  enquiry: clientEnquirySchema,
  journey: z.object({ propertyId: z.string().uuid(), workId: z.string().uuid(), stage: z.string(), version: z.number(), estimate: z.record(z.unknown()).nullable(), clientId: z.string().uuid().nullable() }).passthrough().nullable(),
  property: z.object({ id: z.string().uuid(), name: z.string(), bedrooms: z.number(), ...placeFields }).nullable(),
  today: z.string(), ownCostCategories: z.array(z.string()).nullable().default(null),
  ours: z.array(leadOurPropertySchema), events: z.array(leadEventSchema), repairs: z.array(leadRepairSchema),
});
export type LeadRead = z.infer<typeof leadReadSchema>;
// After an action the database answers with the lead's state; the rest of the read stays as it was.
export const withState = (read: LeadRead, state: LeadState): LeadRead => ({ ...read, ...state });

// ---------------------------------------------------------------- the ticket
export type LeadFact = { label: string; value: string | null };
export type LeadFactGroup = { key: 'contact' | 'property' | 'services'; title: string; facts: LeadFact[] };
const filled = (v: unknown): string | null => typeof v === 'number' ? String(v) : typeof v === 'string' && v.trim() ? v.trim() : null;
const yesNo = (v?: string) => v === 'yes' ? 'Yes' : v === 'no' ? 'No' : null;
// Everything the landlord has told us so far, in the groups of the form. A null value shows as TBC.
export function leadFacts(e: Pick<ClientEnquiry, 'answers' | 'recipientName' | 'recipientEmail'>): LeadFactGroup[] {
  const a = e.answers;
  return [
    { key: 'contact', title: 'Contact information', facts: [
      { label: 'Full name', value: filled(a?.fullName) ?? filled(e.recipientName) }, { label: 'Company', value: filled(a?.companyName) },
      { label: 'Email', value: filled(a?.email) ?? (e.recipientEmail.includes('@') ? e.recipientEmail : null) }, { label: 'Contact number', value: filled(a?.phone) },
      // Only on forms answered before these two questions were removed: never TBC.
      ...(a?.correspondenceAddress ? [{ label: 'Correspondence address', value: a.correspondenceAddress }] : []),
      ...(a?.existingClient ? [{ label: 'Existing client', value: yesNo(a.existingClient) }] : []),
    ] },
    { key: 'property', title: 'Property information', facts: [
      { label: 'Property address', value: filled(a?.propertyAddress) }, { label: 'Property type', value: filled(a?.propertyType) },
      { label: 'Bedrooms', value: filled(a?.bedrooms) }, { label: 'WCs', value: filled(a?.wcs) }, { label: 'Full bathrooms', value: filled(a?.bathrooms) },
      { label: 'Parking', value: filled(a?.parking) }, { label: 'Garden', value: filled(a?.garden) }, { label: 'Photos or videos link', value: filled(a?.mediaLink) },
    ] },
    { key: 'services', title: 'Services', facts: [
      { label: 'Short-term let now', value: yesNo(a?.shortLet) }, { label: 'Furnishing quote', value: yesNo(a?.furnishQuote) },
      { label: 'Compliance & licensing', value: yesNo(a?.compliance) }, { label: 'Start', value: filled(a?.startWhen) },
      { label: STAGE_LABEL, value: filled(a?.enquiryType) }, { label: 'Heard about us', value: filled(a?.heardFrom) },
      // Referral is optional, so it is never TBC.
      ...(a?.referral ? [{ label: REFERRAL_LABEL, value: a.referral }] : []), { label: 'Anything else', value: filled(a?.notes) },
    ] },
  ];
}
export const factText = (f: LeadFact) => f.value ?? TBC;
export const missingFacts = (groups: LeadFactGroup[]) => groups.reduce((n, g) => n + g.facts.filter(f => f.value === null).length, 0);

export type LeadStepState = 'done' | 'current' | 'todo';
export type LeadSubStep = { step: LeadStep; label: string; state: LeadStepState; by: string | null; at: string | null; saved: boolean };
export type LeadCheck = { key: string; label: string; state: LeadStepState; subSteps?: LeadSubStep[] };
const rowOf = (steps: readonly LeadStepRow[], step: LeadStep) => steps.find(s => s.step === step);
export const isTicked = (steps: readonly LeadStepRow[], step: LeadStep) => !!rowOf(steps, step)?.tickedAt;
// The first step not ticked yet (the one to do next), or null when all five are.
export const nextLeadStep = (steps: readonly LeadStepRow[]): LeadStep | null => LEAD_STEPS.find(s => !isTicked(steps, s)) ?? null;
export const estimateDelivered = (steps: readonly LeadStepRow[]) => LEAD_STEPS.every(s => isTicked(steps, s));
// A step can be opened once the ones before it are ticked (a ticked step can always be looked at, and reopened).
export const canOpenStep = (steps: readonly LeadStepRow[], step: LeadStep) => LEAD_STEPS.slice(0, LEAD_STEPS.indexOf(step)).every(s => isTicked(steps, s));
// The estimate steps can change while the property is at the enquiry or estimate stage, once its property is made.
export const stepsOpen = (read: Pick<LeadRead, 'journey' | 'enquiry'>) => !!read.journey && read.enquiry.status !== 'closed' && ['enquiry', 'estimate', 'reviewing'].includes(read.journey.stage);

// The onboarding checklist for a lead: the seven steps, with Estimate Delivery's five tasks under it. The form back and the
// property made ticks the enquiry; Estimate Delivery is ticked when its five tasks are (or the owner has already gone past
// it, for a lead from before); the rest follow the property's onboarding stage.
export function leadChecklist(read: Pick<LeadRead, 'journey' | 'enquiry' | 'steps'>): LeadCheck[] {
  const stage = read.journey?.stage ?? null;
  const reached = stage ? ONBOARDING_STAGES[stage]?.reached ?? 0 : 0;
  const closed = read.enquiry.status === 'closed' || stage === 'archived';
  const delivered = estimateDelivered(read.steps) || (!!stage && stage !== 'archived' && reached >= 2);
  const next = nextLeadStep(read.steps);
  const done = ONBOARDING_STEPS.map((s, i) => s.key === 'enquiry' ? !!read.enquiry.answers && !!read.journey : s.key === 'estimate' ? delivered : !!stage && stage !== 'archived' && reached > i);
  const current = closed ? -1 : done.findIndex(d => !d);
  return ONBOARDING_STEPS.map((s, i) => {
    const check: LeadCheck = { key: s.key, label: LEAD_CHECKLIST_LABEL[s.key] ?? s.label, state: done[i] ? 'done' : i === current ? 'current' : 'todo' };
    if (s.key !== 'estimate') return check;
    return { ...check, subSteps: LEAD_STEPS.map(step => {
      const row = rowOf(read.steps, step);
      const state: LeadStepState = row?.tickedAt ? 'done' : step === next && check.state === 'current' ? 'current' : 'todo';
      return { step, label: LEAD_STEP_LABEL[step], state, by: row?.tickedByName ?? null, at: row?.tickedAt ?? null, saved: !!row };
    }) };
  });
}

// ---------------------------------------------------------------- analysis rows
export type Trend = 'rising' | 'falling' | 'steady' | 'unknown';
export const TREND_LABEL: Record<Trend, string> = { rising: 'Rising', falling: 'Falling', steady: 'Steady', unknown: 'Not enough data' };
// The occupancy trend over the last six months: the latest three against the three before, 5 points either way.
export function occupancyTrend(trend: readonly { occupancyBps: number }[]): Trend {
  if (trend.length < 6) return 'unknown';
  const avg = (xs: readonly { occupancyBps: number }[]) => xs.reduce((n, x) => n + x.occupancyBps, 0) / xs.length;
  const before = avg(trend.slice(0, 3)), after = avg(trend.slice(3, 6));
  if (before === 0 && after === 0) return 'unknown';
  return after - before >= 500 ? 'rising' : before - after >= 500 ? 'falling' : 'steady';
}
// The internal analysis as the app first lists it: our properties within 30 miles of the lead, with their figures.
export function internalRows(read: Pick<LeadRead, 'ours'>, from: Place | null): z.infer<typeof internalRowSchema>[] {
  return withinRadius(read.ours, from).slice(0, 60).map(o => ({
    propertyId: o.id, name: o.name.slice(0, 200), miles: o.miles, occupancyBps: Math.min(10000, o.stats.occupancyBps), adrMinor: o.stats.adrMinor, revenueMinor: o.stats.revenueMinor,
    trend: TREND_LABEL[occupancyTrend(o.stats.trend)],
  }));
}
// The local area analysis as first listed: events and repair work within 30 miles over the next 12 months, soonest first.
export function localItems(read: Pick<LeadRead, 'events' | 'repairs'>, from: Place | null): z.infer<typeof localItemSchema>[] {
  const events = withinRadius(read.events, from).map(e => ({ kind: 'event' as const, id: e.id, name: e.name.slice(0, 300), on: e.on, miles: e.miles, place: e.propertyName.slice(0, 300), note: e.opportunity.slice(0, 500) }));
  const repairs = withinRadius(read.repairs, from).map(r => ({ kind: 'repair' as const, id: r.id, name: r.title.slice(0, 300), on: (r.visitFrom ?? r.dueOn ?? '').slice(0, 10), miles: r.miles, place: r.propertyName.slice(0, 300),
    note: [r.contractor ? `Contractor: ${r.contractor}` : 'No contractor yet', r.status.replace(/_/g, ' ')].join(' · ').slice(0, 500) }));
  return [...events, ...repairs].sort((a, b) => (a.on || '9999').localeCompare(b.on || '9999')).slice(0, 150);
}
// What the consultant saved for a step, read leniently (a step never saved reads as empty).
export function stepData<S extends SavableStep>(steps: readonly LeadStepRow[], step: S): StepData<S> | null {
  const parsed = stepDataSchema[step].safeParse(rowOf(steps, step)?.data);
  return parsed.success ? parsed.data as StepData<S> : null;
}

// The estimate to publish from the steps: the rates and the other fields from Estimated Revenue, and the comparables chosen in
// External Analysis. Sent through the existing publishEstimate, which emails the client and tells them in the app.
export function estimateFromSteps(read: Pick<LeadRead, 'journey' | 'steps'>): Record<string, unknown> | { error: string } {
  if (!read.journey) return { error: 'Value the lead first: the estimate needs its property.' };
  const missing = LEAD_STEPS.slice(0, 4).find(s => !isTicked(read.steps, s));
  if (missing) return { error: `Finish ${LEAD_STEP_LABEL[missing]} first.` };
  const revenue = stepData(read.steps, 'revenue'), external = stepData(read.steps, 'external');
  if (!revenue || typeof revenue.lowRateMinor !== 'number' || typeof revenue.mediumRateMinor !== 'number' || typeof revenue.highRateMinor !== 'number') return { error: 'Enter the nightly rates in Estimated Revenue.' };
  const extras = Object.fromEntries((['occupancyBps', 'directBookingBps', 'otaFeeBps', 'managementFeeBps'] as const).filter(k => typeof revenue[k] === 'number').map(k => [k, revenue[k]]));
  return {
    action: 'publishEstimate', propertyId: read.journey.propertyId, version: read.journey.version,
    lowRateMinor: revenue.lowRateMinor, mediumRateMinor: revenue.mediumRateMinor, highRateMinor: revenue.highRateMinor,
    comments: revenue.comments, ...extras, comparables: (external?.comparables ?? []).slice(0, MAX_COMPARABLES),
    ...(revenue.ownCosts?.length ? { ownCosts: revenue.ownCosts } : {}),
  };
}

// The thread on the ticket, oldest first: what happened to the enquiry (from its own dates) with the team's comments and
// the steps done, so the history and the conversation read as one.
export type LeadFeedEntry = { key: string; kind: 'comment' | 'event'; text: string; byName: string | null; byId: string | null; at: string };
export function leadFeed(read: Pick<LeadRead, 'activity' | 'enquiry'>): LeadFeedEntry[] {
  const e = read.enquiry, who = e.answers?.fullName?.trim() || e.recipientName;
  const history: LeadFeedEntry[] = [];
  const add = (key: string, at: string | null | undefined, words: string, byName: string | null) => { if (at) history.push({ key, kind: 'event', text: words, byName, byId: null, at }); };
  if (e.source === 'form') add('sent', e.sentAt, 'sent the enquiry form', e.sentByName);
  else if (e.source === 'team') add('sent', e.sentAt, 'added the lead by hand', e.sentByName);
  if (e.source === 'form') add('opened', e.openedAt, 'opened the form', who);
  if (e.source !== 'team') add('answered', e.submittedAt, e.source === 'owner_app' ? 'sent the enquiry from the app' : 'sent the form back', who);
  add('valued', e.valuedAt, 'started valuing', e.valuedByName);
  add('closed', e.closedAt, `closed the lead: ${e.closeNote}`, e.closedByName);
  add('emailed', e.estimateDelivery?.sentAt, 'the estimate was emailed to the client', null);
  const said = read.activity.map(x => ({ key: 'a' + x.id, kind: x.kind, text: x.text, byName: x.byName, byId: x.byId, at: x.at }));
  return [...history, ...said].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.key.localeCompare(b.key));
}
// "Erika Smith approved Internal Analysis", or the line alone when nobody did it.
export const feedWords = (x: Pick<LeadFeedEntry, 'byName' | 'text'>) => x.byName ? `${x.byName} ${x.text}` : x.text.charAt(0).toUpperCase() + x.text.slice(1);
