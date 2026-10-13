import { DUPLICATE_LABEL, duplicateNote, enquiryStep, STEP_LABEL, STEP_TONE, type ClientEnquiry } from './client-enquiry';
import { formatDay, formatMoney } from './format';
import { addressOf, lastUpdateOf, nextActionOf, progressOf, type TrackerItem, type TrackerStep, type TrackerTone, type TrackerUpdate } from './tracker';
import type { TrackerContext } from './tracker-sections';
import type { Detail } from './work-details';
import type { JourneyView, OperationView } from './workflow-forms';
import { ONBOARDING_PHASES, readableStage } from './workspace-view';

// Property onboarding as a staged tracker list (client ask C3): new enquiries first, then each stage,
// every property with a progress bar that runs to 100%. The stage list is today's seven phases
// (ONBOARDING_PHASES in lib/workspace-view.ts), kept in ONE constant here until the client sends his own.
// A journey's `stage` is the database's value (enquiry, estimate, reviewing, agreement, form, invoice,
// inspection_to_book, inspection_booked, inspection_complete, live, archived).

export type OnboardingStepDef = { key: string; label: string; stages: readonly string[] };
const STEP_KEYS = ['enquiry', 'estimate', 'agreement', 'setup', 'invoice', 'inspection', 'live'] as const;
const STEP_STAGES: readonly (readonly string[])[] = [
  ['enquiry'], ['estimate', 'reviewing'], ['agreement'], ['form'], ['invoice'], ['inspection_to_book', 'inspection_booked', 'inspection_complete'], ['live'],
];
export const ONBOARDING_STEPS: readonly OnboardingStepDef[] = ONBOARDING_PHASES.map((label, i) => ({ key: STEP_KEYS[i], label, stages: STEP_STAGES[i] }));

// What each stage needs next, who has to do it, and which forms (lib/workflow-forms.ts journeyForms) do it.
// `reached` is how many of the seven steps are finished once the property is at that stage: the inspection
// is finished when its report is in (inspection_complete), and a live property has finished all seven.
type StageDef = { reached: number; next: string; waitingOn: string; owner?: boolean; actions: readonly string[] };
export const ONBOARDING_STAGES: Readonly<Record<string, StageDef>> = {
  enquiry: { reached: 0, next: 'Send the estimate', waitingOn: 'Guest relations', actions: ['publishEstimate'] },
  estimate: { reached: 1, next: 'Owner decides on the estimate', waitingOn: 'Guest relations', owner: true, actions: ['decideEstimate'] },
  reviewing: { reached: 1, next: 'Owner decides on the estimate', waitingOn: 'Guest relations', owner: true, actions: ['decideEstimate'] },
  agreement: { reached: 2, next: 'Agreement to sign', waitingOn: 'Guest relations', owner: true, actions: ['publishAgreement', 'signAgreement'] },
  form: { reached: 3, next: 'Set-up form to complete', waitingOn: 'Guest relations', owner: true, actions: ['submitForm', 'recordInvoiceOutside', 'createOnboardingInvoice', 'linkInvoice'] },
  invoice: { reached: 4, next: 'Onboarding invoice', waitingOn: 'Accounts', actions: ['createOnboardingInvoice', 'linkInvoice', 'recordInvoiceOutside'] },
  inspection_to_book: { reached: 5, next: 'Book the inspection', waitingOn: 'Ready', actions: ['bookInspection'] },
  inspection_booked: { reached: 5, next: 'Inspection booked, then record the findings', waitingOn: 'Ready', actions: ['completeInspection'] },
  inspection_complete: { reached: 6, next: 'Record the live listing', waitingOn: 'Guest relations', actions: ['makeLive'] },
  live: { reached: 7, next: 'Live', waitingOn: '', actions: [] },
  archived: { reached: 1, next: 'Archived', waitingOn: '', actions: [] },
};
const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';
const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ', ').trim();

export const NEW_ENQUIRIES = 'New enquiries';

// "43%" for a row's progress. A finished property is 100.
export const percentOf = (progress: TrackerItem['progress']): number => progress && progress.total ? Math.round(100 * progress.done / progress.total) : 0;

// The step list shared by an enquiry and a journey: finished steps up to `reached`, then the current one.
function stepsFor(reached: number, closed: boolean, extra: (i: number) => Partial<TrackerStep>): TrackerStep[] {
  return ONBOARDING_STEPS.map((s, i) => ({ key: s.key, label: s.label, state: i < reached ? 'done' : i === reached && !closed ? 'current' : 'todo', ...extra(i) }));
}

type OnboardingContext = TrackerContext & {
  // The root onboarding work item of a journey, which gives the last update and the forms this person may use.
  workOf?: (workId: string) => OperationView | undefined;
  // True when this person can start valuing an enquiry or send it a new link (admins and Guest relations).
  canAct?: boolean;
};

const scrub = (update: TrackerUpdate | null, owner: boolean): TrackerUpdate | null => update && owner ? { ...update, by: null } : update;

// One property's onboarding.
export function onboardingTrackerItem(j: JourneyView, ctx: OnboardingContext): TrackerItem<JourneyView> {
  const property = ctx.property(j.propertyId), root = ctx.workOf?.(j.workId);
  const address = addressOf(property) || 'Unknown property', propertyName = property?.name?.trim() || address;
  const def = ONBOARDING_STAGES[j.stage] ?? ONBOARDING_STAGES.enquiry;
  const live = j.stage === 'live', archived = j.stage === 'archived', closed = live || archived;
  const stepIndex = Math.max(0, ONBOARDING_STEPS.findIndex(s => s.stages.includes(j.stage)));
  const hasOwner = j.ownerAccount !== false && !!j.clientId;
  const forms = root ? ctx.forms(root) : [];
  const usable = forms.filter(f => def.actions.includes(f.key));
  const contact = text(j.enquiry?.contactName);
  const signed = j.signedAt ? (text(j.signedName) ? `Signed by ${text(j.signedName)}, ${formatDay(j.signedAt, ctx.now)}` : `Signed ${formatDay(j.signedAt, ctx.now)}`) : '';
  const mid = typeof j.estimate?.mediumRateMinor === 'number' ? j.estimate.mediumRateMinor : null;
  const invoiced = !!j.invoiceId || !!j.invoiceOutsideAt;
  const questions = (j.questions ?? []).filter(q => !q.answeredAt).length;

  const checks: Record<string, { key: string; label: string; done: boolean }[]> = {
    enquiry: [{ key: 'contact', label: 'Contact details recorded', done: !!(text(j.enquiry?.email) || text(j.enquiry?.phone) || j.clientId) }],
    estimate: [{ key: 'published', label: 'Estimate published', done: !!j.estimate }, { key: 'decision', label: 'Owner decision recorded', done: def.reached >= 2 && !archived }],
    agreement: [{ key: 'published', label: 'Agreement published', done: j.agreementRevision > 0 }, { key: 'signed', label: 'Agreement signed', done: !!j.signedAt }],
    setup: [{ key: 'form', label: 'Set-up form completed', done: !!j.form }],
    invoice: [{ key: 'invoice', label: 'Onboarding invoice recorded', done: invoiced }],
    inspection: [{ key: 'booked', label: 'Inspection booked', done: !!j.inspectionOn }, { key: 'report', label: 'Inspection report submitted', done: !!text(j.inspectionReport) }],
  };
  const detailOf = (i: number): string | undefined => {
    if (i >= def.reached) return undefined;
    if (i === 1) return mid !== null ? `Expected ${formatMoney(mid)} a night` : undefined;
    if (i === 2) return signed || undefined;
    if (i === 4) return text(j.invoiceOutsideNote) || undefined;
    if (i === 5) return j.inspectionOn ? 'Inspection on ' + formatDay(j.inspectionOn, ctx.now) : undefined;
    return undefined;
  };
  const steps = stepsFor(def.reached, closed, i => {
    const detail = detailOf(i), list = checks[ONBOARDING_STEPS[i].key];
    const action = i === stepIndex && !closed ? usable[0]?.key : undefined;
    return { ...(detail ? { detail } : {}), ...(list ? { checks: list } : {}), ...(action ? { actionKey: action } : {}) };
  });

  const label = archived ? 'Declined' : live ? 'Live' : j.stage === 'enquiry' ? 'New enquiry' : ONBOARDING_STEPS[stepIndex].label;
  const tone: TrackerTone = live ? 'good' : archived ? 'bad' : 'wait';
  const title = !ctx.owner && contact ? `Onboarding, ${contact}` : 'Property onboarding';
  const waitingOn = def.owner && hasOwner ? 'the owner' : def.waitingOn;
  const details: Detail[] = [];
  const add = (name: string, value: string) => { if (value) details.push({ label: name, value }); };
  add('Stage', readableStage(j.stage));
  if (!ctx.owner) {
    add('Contact', contact); add('Company', text(j.enquiry?.companyName)); add('Phone', text(j.enquiry?.phone)); add('Email', text(j.enquiry?.email));
  }
  add('Inspection', j.inspectionOn ? formatDay(j.inspectionOn, ctx.now) : '');
  add('Open questions', questions ? String(questions) : '');
  if (j.form?.licensingRequired === true) add('Licensing', 'Required: a licence application is raised for this property');
  const update = root ? lastUpdateOf(root) : null;
  return {
    id: j.workId, section: 'onboarding', source: j, propertyId: j.propertyId || null, address, propertyName, title,
    status: { label, tone }, closed,
    nextStep: archived ? 'Archived: the owner declined the estimate' : live ? 'Nothing more to do' : def.next,
    nextAction: closed ? null : nextActionOf(usable, waitingOn),
    lastUpdate: scrub(update, ctx.owner),
    progress: progressOf(steps), steps, details, workId: j.workId, version: root?.version ?? j.version,
    search: [address, propertyName, title, label, closed ? '' : def.next, ctx.owner ? '' : contact, ctx.owner ? '' : text(j.enquiry?.companyName), ctx.owner ? '' : text(j.enquiry?.email)].filter(Boolean).join(' '),
  };
}

// A landlord's enquiry form that has not been valued yet: sent, opened, answered, or expired. Staff only.
export const OPEN_ENQUIRY_STEPS = ['received', 'opened', 'sent', 'expired'] as const;
const NEXT_FOR_ENQUIRY: Record<string, string> = {
  received: 'Value the property', opened: 'The landlord is filling in the form', sent: 'Waiting for the landlord to open the form', expired: 'Send a new link',
};
export function enquiryTrackerItem(e: ClientEnquiry, ctx: OnboardingContext): TrackerItem<ClientEnquiry> {
  const step = enquiryStep(e, ctx.now.getTime()), a = e.answers;
  const address = a ? oneLine(a.propertyAddress) : `${e.recipientName} (${e.recipientEmail})`;
  const who = a?.fullName || e.recipientName;
  const next = NEXT_FOR_ENQUIRY[step] ?? STEP_LABEL[step];
  const nextAction: TrackerItem['nextAction'] = step === 'received' ? (ctx.canAct ? { label: 'Start valuing', actionKey: 'startValuing' } : { label: 'Waiting for Guest relations' })
    : step === 'expired' ? (ctx.canAct ? { label: 'Send a new link', actionKey: 'resendEnquiry' } : { label: 'Waiting for Guest relations' }) : { label: 'Waiting for the landlord' };
  // Who last moved it: the landlord when they opened or answered the form, the sender when it was sent.
  const when = e.submittedAt ?? e.openedAt ?? e.sentAt;
  const update: TrackerUpdate = { at: when, by: e.submittedAt || e.openedAt ? who : e.sentByName, what: e.submittedAt ? 'Form answered' : e.openedAt ? 'Form opened' : 'Form sent' };
  const steps = stepsFor(0, false, i => i === 0 ? { checks: [
    { key: 'sent', label: 'Form sent', done: true }, { key: 'opened', label: 'Form opened', done: !!e.openedAt || !!e.submittedAt }, { key: 'answered', label: 'Form answered', done: !!e.submittedAt },
  ] } : {});
  const details: Detail[] = [];
  const add = (name: string, value: string) => { if (value) details.push({ label: name, value }); };
  add('Landlord', who); add('Company', text(a?.companyName)); add('Email', a?.email ?? e.recipientEmail); add('Phone', a?.phone ?? '');
  if (a) { add('Property', `${a.propertyType}, ${a.bedrooms} bed, ${a.bathrooms} bath`); add('Wants to start', text(a.startWhen)); add('Their enquiry', a.enquiryType); }
  return {
    id: 'enquiry:' + e.id, section: 'onboarding', source: e, propertyId: null, address, propertyName: address, title: 'Enquiry from ' + who,
    status: { label: STEP_LABEL[step], tone: STEP_TONE[step] }, closed: false, nextStep: next, nextAction,
    lastUpdate: ctx.owner ? null : update, progress: progressOf(steps), steps, details,
    search: [address, who, e.recipientEmail, text(a?.companyName), STEP_LABEL[step], next].filter(Boolean).join(' '),
  };
}

const isEnquiryRow = (i: TrackerItem) => i.id.startsWith('enquiry:');
// Answered forms first, then opened, sent and expired ones, read off the row's status label.
const ENQUIRY_ORDER = [STEP_LABEL.received, STEP_LABEL.opened, STEP_LABEL.sent, STEP_LABEL.expired];
const touched = (i: TrackerItem) => { const t = i.lastUpdate ? Date.parse(i.lastUpdate.at) : NaN; return Number.isNaN(t) ? 0 : t; };
const stageOf = (i: TrackerItem) => { const j = i.source as Partial<JourneyView>; return ONBOARDING_STAGES[j.stage ?? 'enquiry']?.reached ?? 0; };

// New enquiries first (answered forms ready to value, then the ones still out), then properties at the
// enquiry stage, then each stage in order. Within a stage the longest without an update comes first.
// Finished and declined properties go last. Returns a new list.
export function sortOnboarding<T extends TrackerItem>(items: readonly T[]): T[] {
  const rank = (i: T) => isEnquiryRow(i) ? ENQUIRY_ORDER.indexOf(i.status.label) : 0;
  return [...items].sort((a, b) => Number(a.closed) - Number(b.closed) || Number(!isEnquiryRow(a)) - Number(!isEnquiryRow(b)) || rank(a) - rank(b) || stageOf(a) - stageOf(b) || touched(a) - touched(b) || a.address.localeCompare(b.address) || a.id.localeCompare(b.id));
}

// A property made from an answered enquiry form (migration 20261015200000) is one row: its journey. For staff
// it carries where it came from and any possible-duplicate flag; the landlord's contact details stay on the
// enquiry. Owners never get these (they never see an unvalued property anyway).
export function withEnquiry(item: TrackerItem, e: ClientEnquiry | undefined, ctx: Pick<OnboardingContext, 'owner' | 'now'>): TrackerItem {
  if (!e || ctx.owner || e.status === 'closed') return item;
  const details: Detail[] = [...item.details, { label: 'From', value: 'The enquiry form' + (e.submittedAt ? ', answered ' + formatDay(e.submittedAt.slice(0, 10), ctx.now) : '') }];
  if (e.duplicateReason) details.push({ label: DUPLICATE_LABEL, value: duplicateNote(e), tone: 'bad' });
  return { ...item, details, search: [item.search, e.duplicateReason ? DUPLICATE_LABEL : ''].filter(Boolean).join(' ') };
}

// Every row for the screen. Journeys are staff and owner alike; client enquiries are staff only, and only
// the ones without a property yet (once a property exists, from the form or from valuing, its journey is the row).
export function onboardingTrackerItems(journeys: readonly JourneyView[], enquiries: readonly ClientEnquiry[], ctx: OnboardingContext): TrackerItem[] {
  const byProperty = new Map(enquiries.filter(e => e.propertyId).map(e => [e.propertyId!, e] as const));
  const rows: TrackerItem[] = journeys.map(j => withEnquiry(onboardingTrackerItem(j, ctx), byProperty.get(j.propertyId), ctx));
  if (!ctx.owner) for (const e of enquiries) {
    if (e.propertyId || e.status === 'closed' || !(OPEN_ENQUIRY_STEPS as readonly string[]).includes(enquiryStep(e, ctx.now.getTime()))) continue;
    rows.push(enquiryTrackerItem(e, ctx));
  }
  return sortOnboarding(rows);
}

// The heading an open row is listed under: New enquiries for an enquiry form or a property still at the
// enquiry stage, otherwise the name of its step.
export function onboardingSection(item: TrackerItem): string {
  if (isEnquiryRow(item)) return NEW_ENQUIRIES;
  const stage = (item.source as Partial<JourneyView>).stage ?? 'enquiry';
  if (stage === 'enquiry') return NEW_ENQUIRIES;
  return ONBOARDING_STEPS.find(s => s.stages.includes(stage))?.label ?? readableStage(stage);
}

// Rows under their headings, in the order the headings first appear and the rows within each keep their
// order. A list with no `sectionOf` is one group with no heading.
export type TrackerGroup<T> = { heading: string; items: T[] };
export function groupBySection<T>(items: readonly T[], sectionOf?: (item: T) => string): TrackerGroup<T>[] {
  if (!sectionOf) return items.length ? [{ heading: '', items: [...items] }] : [];
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const heading = sectionOf(item);
    const list = groups.get(heading);
    if (list) list.push(item); else groups.set(heading, [item]);
  }
  return [...groups].map(([heading, list]) => ({ heading, items: list }));
}
