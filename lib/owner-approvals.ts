import { journeyForms, type JourneyView, type OperationView, type WorkflowForm } from './workflow-forms';
import { onboardingProgress, type PropertyView } from './workspace-view';
import { formatMoney } from './format';
import { agreementReadable } from './agreement-copy';
import { journeyAgreement } from './agreement-template';
import type { WorkspaceAccount } from './workspace-account-policy';

// Everything waiting for an owner's decision, in one list: repair costs at owner approval and the
// onboarding steps that are theirs (the estimate, the agreement, the set-up form). Worked out from
// the work and onboardings the workspace has already loaded, so Home and Approvals always agree.
export type RepairApproval = {
  kind: 'repair'; key: string; work: OperationView; propertyId: string; propertyName: string;
  issue: string; repairType: string | null; urgent: boolean; hazard: boolean;
  estimateMinor: number | null; previousEstimateMinor: number | null; quoteReason: string | null;
  // The contractor doing the work, by name only (owners never get the contractor's id; migration 20261021700000).
  contractor: string | null;
  // The owner's own limit from their set-up form: repairs up to it go ahead without asking.
  limitMinor: number | null; anyAmount: boolean;
};
export type OnboardingApproval = {
  kind: 'onboarding'; key: string; journey: JourneyView; propertyId: string; propertyName: string;
  step: 'decideEstimate' | 'signAgreement' | 'submitForm'; title: string; detail: string; form: WorkflowForm;
};
export type OwnerApproval = RepairApproval | OnboardingApproval;

const STEP_TITLE: Record<OnboardingApproval['step'], [string, string]> = {
  decideEstimate: ['Review your estimate', 'Approve it to go ahead, ask for more time or say no.'],
  signAgreement: ['Sign your management agreement', 'Read the agreement and accept it to carry on.'],
  submitForm: ['Complete your property set-up', 'Bank details, access, utilities and how repairs are handled.'],
};
const numberOr = (value: unknown) => typeof value === 'number' ? value : null;
const textOr = (value: unknown) => typeof value === 'string' && value.trim() ? value : null;

export function ownerApprovals(account: WorkspaceAccount, work: readonly OperationView[], journeys: readonly JourneyView[], properties: readonly PropertyView[]): OwnerApproval[] {
  if (account.role !== 'client') return [];
  const names = new Map(properties.map(p => [p.id, p.name]));
  const repairs: RepairApproval[] = work
    .filter(w => w.kind === 'maintenance' && w.data.phase === 'owner_approval' && !['completed', 'cancelled'].includes(w.status))
    .map(w => {
      const form = journeys.find(j => j.propertyId === w.propertyId)?.form ?? null;
      return {
        kind: 'repair', key: 'repair:' + w.workId, work: w, propertyId: w.propertyId, propertyName: names.get(w.propertyId) ?? 'Your property',
        issue: textOr(w.data.issue) ?? w.title, repairType: textOr(w.data.repairType), urgent: w.data.urgent === true, hazard: w.data.hazard === true,
        estimateMinor: numberOr(w.data.estimatedCostMinor), previousEstimateMinor: numberOr(w.data.previousEstimateMinor), quoteReason: textOr(w.data.quoteReason),
        contractor: textOr(w.data.assignedReadyName),
        limitMinor: numberOr(form?.repairLimitMinor), anyAmount: form?.fullRepairPermission === true,
      };
    });
  const onboarding: OnboardingApproval[] = [];
  for (const j of journeys) {
    if (j.clientId !== account.userId) continue;
    // The same forms the property's onboarding offers; nothing is listed that the owner cannot open.
    for (const form of journeyForms(account, j)) {
      if (form.key !== 'decideEstimate' && form.key !== 'signAgreement' && form.key !== 'submitForm') continue;
      const step = form.key, [title, detail] = STEP_TITLE[step];
      onboarding.push({ kind: 'onboarding', key: step + ':' + j.propertyId, journey: j, propertyId: j.propertyId, propertyName: names.get(j.propertyId) ?? 'Your property', step, title, detail, form: withContext(form, j) });
    }
  }
  return [...repairs, ...onboarding];
}

// The decision forms carry what is being decided, so the owner reads it before choosing.
function withContext(form: WorkflowForm, j: JourneyView): WorkflowForm {
  if (form.key === 'signAgreement' && j.agreement) {
    // An agreement made from a contract is shown as readable text; a PDF contract is downloaded from the property's page.
    const a = journeyAgreement(j), pdf = a.agreementTemplate?.kind === 'pdf' ? `\n\nThe contract itself is ${a.agreementTemplate.fileName}. Download it from the property's onboarding page and read it before you sign.` : '';
    return { ...form, description: 'Management agreement, revision ' + j.agreementRevision + ':\n\n' + agreementReadable(j.agreement, a.agreementFormat) + pdf };
  }
  if (form.key === 'decideEstimate' && j.estimate) {
    const rate = (key: string) => typeof j.estimate?.[key] === 'number' ? formatMoney(j.estimate[key] as number) : null;
    const [low, mid, high] = [rate('lowRateMinor'), rate('mediumRateMinor'), rate('highRateMinor')];
    if (mid) return { ...form, description: `Expected nightly rate ${mid}${low && high ? ` (from ${low} to ${high})` : ''}. The full estimate, with comparable properties, is on the property in Properties.` };
  }
  return form;
}

// Where each of the owner's properties is up to, in their words, with what happens next.
const OWNER_NEXT: Record<string, string> = {
  enquiry: 'Recharge is preparing your estimate.',
  estimate: 'Review your estimate and choose how to go ahead.',
  reviewing: 'Your estimate stays open until you decide.',
  agreement: 'Your management agreement is being prepared.',
  form: 'Complete your property set-up form.',
  invoice: 'The onboarding invoice is next, then the inspection.',
  inspection_to_book: 'Recharge is booking your property inspection.',
  inspection_booked: 'Your property inspection is booked.',
  inspection_complete: 'Your listing is being prepared to go live.',
  live: 'Live and taking bookings.',
  archived: 'This enquiry is closed.',
};
// One status per property in the owner's words, the same on the property card and on Home: Enquiry sent (we are valuing
// it), Estimate ready (open it), Agreement, Going live, Live. `openEstimate` is set while the estimate waits to be opened.
export type OwnerPropertyStatus = { label: string; detail: string; tone: 'waiting' | 'action' | 'live' | 'closed'; openEstimate: boolean };
const GOING_LIVE = ['form', 'invoice', 'inspection_to_book', 'inspection_booked', 'inspection_complete'];
export function ownerPropertyStatus(j: Pick<JourneyView, 'stage' | 'agreementRevision' | 'signedName'> | null | undefined, propertyStatus: string): OwnerPropertyStatus {
  const status = (label: string, detail: string, tone: OwnerPropertyStatus['tone'] = 'waiting', openEstimate = false) => ({ label, detail, tone, openEstimate });
  if (!j) return propertyStatus === 'active' ? status('Live', OWNER_NEXT.live, 'live') : propertyStatus === 'archived' ? status('Closed', OWNER_NEXT.archived, 'closed') : status('Being set up', 'Recharge is setting up your property.');
  if (j.stage === 'enquiry') return status('Enquiry sent', 'We are valuing it and will let you know when your estimate is ready.');
  if (j.stage === 'estimate') return status('Estimate ready', 'Open your estimate and choose how to go ahead.', 'action', true);
  if (j.stage === 'reviewing') return status('Estimate ready', 'Your estimate stays open until you decide. Open it when you are ready.', 'action', true);
  if (j.stage === 'agreement') return j.agreementRevision > 0 && !j.signedName ? status('Agreement', 'Read and sign your management agreement.', 'action') : status('Agreement', OWNER_NEXT.agreement);
  if (GOING_LIVE.includes(j.stage)) return status('Going live', OWNER_NEXT[j.stage], j.stage === 'form' ? 'action' : 'waiting');
  if (j.stage === 'live') return status('Live', OWNER_NEXT.live, 'live');
  if (j.stage === 'archived') return status('Closed', OWNER_NEXT.archived, 'closed');
  return status('Being set up', 'Recharge will be in touch with the next step.');
}
export type PropertyProgress = { propertyId: string; name: string; live: boolean; phase: string; done: number; total: number; next: string; waitingForYou: boolean };
export function propertyProgress(properties: readonly PropertyView[], journeys: readonly JourneyView[], approvals: readonly OwnerApproval[]): PropertyProgress[] {
  return properties.map(p => {
    const j = journeys.find(x => x.propertyId === p.id);
    const waitingForYou = approvals.some(a => a.kind === 'onboarding' && a.propertyId === p.id);
    if (!j) return { propertyId: p.id, name: p.name, live: p.status === 'active', phase: ownerPropertyStatus(null, p.status).label, done: p.status === 'active' ? 1 : 0, total: 1, next: p.status === 'active' ? OWNER_NEXT.live : 'Recharge is setting up your property.', waitingForYou };
    const steps = onboardingProgress(j.stage).steps, done = steps.filter(s => s.state === 'complete').length;
    const live = j.stage === 'live';
    const next = j.stage === 'agreement' && j.agreementRevision > 0 && !j.signedName ? 'Read and sign your management agreement.' : OWNER_NEXT[j.stage] ?? 'Recharge will be in touch with the next step.';
    return { propertyId: p.id, name: p.name, live, phase: ownerPropertyStatus(j, p.status).label, done: live ? steps.length : done, total: steps.length, next, waitingForYou };
  });
}

// The owner's Mailbox, "From Recharge" (Lee: "the agreement should show in the mailbox of the owner saying recharge sent the
// agreement for your property"): each management agreement Recharge published to the owner, newest first, saying whether
// it waits for their signature or when they signed it.
export type OwnerMailboxDocument = { key: string; propertyId: string; propertyName: string; title: string; detail: string; sentAt: string | null; toSign: boolean };
const mailDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
export function ownerMailboxDocuments(account: Pick<WorkspaceAccount, 'userId'>, journeys: JourneyView[], properties: Pick<PropertyView, 'id' | 'name'>[]): OwnerMailboxDocument[] {
  const names = new Map(properties.map(p => [p.id, p.name]));
  return journeys.filter(j => j.clientId === account.userId && j.agreementRevision > 0 && !!j.agreement).map(j => {
    const sentAt = journeyAgreement(j).agreementSentAt ?? null, propertyName = names.get(j.propertyId) ?? 'your property';
    const toSign = j.stage === 'agreement' && !j.signedName;
    const status = j.signedName ? `Signed by ${j.signedName}${j.signedAt ? ' on ' + mailDay(j.signedAt) : ''}` : toSign ? 'Waiting for your signature' : 'Not signed';
    return { key: 'agreement:' + j.propertyId, propertyId: j.propertyId, propertyName, sentAt, toSign,
      title: `Recharge sent the management agreement for ${propertyName}`,
      detail: [sentAt ? 'Sent ' + mailDay(sentAt) : '', 'revision ' + j.agreementRevision, status].filter(Boolean).join(' · ') };
  }).sort((a, b) => Number(b.toSign) - Number(a.toSign) || (b.sentAt ?? '').localeCompare(a.sentAt ?? ''));
}

