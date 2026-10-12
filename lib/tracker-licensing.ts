import { formatDay } from './format';
import { addressOf, lastUpdateOf, nextActionOf, progressOf, type TrackerItem, type TrackerStep, type TrackerTone } from './tracker';
import type { TrackerContext } from './tracker-sections';
import type { Detail } from './work-details';
import type { OperationView } from './workflow-forms';

// A licence application as three tracker steps. `data.phase` is empty (or to_apply), applied,
// checks_done, granted (supabase/migrations/20261010180000_team_beta_owner_steps.sql). The safety
// checks are the six keys of `data.checks`, all true or absent. A grant can be recorded without
// them, and then the step reads "skipped".
const PHASES = ['applied', 'checks_done', 'granted'];
const CHECKS = [
  { key: 'gasSafety', label: 'Gas safety certificate' },
  { key: 'electrical', label: 'Electrical safety (EICR and PAT)' },
  { key: 'alarms', label: 'Smoke, heat and carbon monoxide alarms' },
  { key: 'legionella', label: 'Legionella risk assessment' },
  { key: 'epc', label: 'Energy performance certificate' },
  { key: 'insurance', label: 'Buildings and public liability insurance' },
];
const STATUS = ['To apply', 'Applied', 'Checks done', 'Granted'];
// What is needed after each phase. Only Stays (or an admin) record licensing steps.
const NEXT = ['Submit the application', 'Record the safety checks', 'Record the licence grant'];
const WAITING_ON = 'Stays';
const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';

export function licensingTrackerItem(work: OperationView, ctx: TrackerContext): TrackerItem<OperationView> {
  const d = work.data, property = ctx.property(work.propertyId);
  const address = addressOf(property) || 'Unknown property', propertyName = property?.name?.trim() || address;
  const cancelled = work.status === 'cancelled', granted = work.status === 'completed' || d.phase === 'granted', closed = cancelled || granted;
  // How many steps are finished: none, the application, the checks, or the grant.
  const reached = granted ? 3 : PHASES.indexOf(text(d.phase)) + 1;
  const checks = d.checks && typeof d.checks === 'object' ? d.checks as Record<string, unknown> : {};
  const checked = CHECKS.map(c => ({ key: c.key, label: c.label, done: checks[c.key] === true }));
  const available = ctx.forms(work), authority = text(d.authority), reference = text(d.applicationReference);
  const submitted = text(d.submittedOn), grantedOn = text(d.grantedOn), licence = text(d.reference);
  const stateOf = (i: number): TrackerStep['state'] => i < reached ? 'done' : i === reached && !closed ? 'current' : 'todo';
  const submitDetail = [authority, reference && 'ref ' + reference, submitted && 'on ' + formatDay(submitted, ctx.now)].filter(Boolean).join(', ');
  const grantDetail = [licence && 'Ref ' + licence, grantedOn && 'granted ' + formatDay(grantedOn, ctx.now)].filter(Boolean).join(', ');
  const skipped = granted && !checked.some(c => c.done);
  // A grant can also be recorded before any application was (submitApplication writes submittedOn).
  const unsubmitted = granted && !submitted;
  const steps: TrackerStep[] = [
    { key: 'applied', label: 'Application submitted', state: unsubmitted ? 'skipped' : stateOf(0), ...(unsubmitted ? { detail: 'Not recorded before the grant' } : reached > 0 && submitDetail ? { detail: submitDetail } : {}), actionKey: 'submitApplication' },
    { key: 'checks', label: 'Safety checks', state: skipped ? 'skipped' : stateOf(1), ...(skipped ? { detail: 'Not recorded before the grant' } : {}), actionKey: 'recordSafetyChecks', checks: checked },
    { key: 'granted', label: 'Licence granted', state: stateOf(2), ...(granted && grantDetail ? { detail: grantDetail } : {}), actionKey: 'recordGranted' },
  ];
  const tone: TrackerTone = cancelled ? 'bad' : granted ? 'good' : 'wait';
  const label = cancelled ? 'Cancelled' : STATUS[reached];
  const title = authority ? 'Licence application, ' + authority : 'Licence application';
  const details: Detail[] = [];
  const add = (name: string, value: string) => { if (value) details.push({ label: name, value }); };
  add('Authority', authority);
  add('Application reference', reference);
  add('Submitted on', submitted ? formatDay(submitted, ctx.now) : '');
  add('Licence reference', licence);
  add('Granted on', grantedOn ? formatDay(grantedOn, ctx.now) : '');
  const next = NEXT[Math.min(reached, NEXT.length - 1)];
  const update = lastUpdateOf(work);
  return {
    id: work.workId, section: 'licensing', source: work, propertyId: work.propertyId || null, address, propertyName, title,
    status: { label, tone }, closed,
    nextStep: cancelled ? 'Cancelled' : granted ? 'Nothing more to do' : next,
    nextAction: closed ? null : nextActionOf(available, WAITING_ON),
    // Owners never see who made the change, even if the data carried a name.
    lastUpdate: update && ctx.owner ? { ...update, by: null } : update,
    progress: progressOf(steps), steps, details, workId: work.workId, version: work.version,
    search: [address, propertyName, title, label, closed ? '' : next, authority, reference, licence].filter(Boolean).join(' '),
  };
}
