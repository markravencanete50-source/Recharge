import { formatMoney } from './format';

// Repair approvals (migration 20261020810000): one company limit, £100 unless management change it.
// Under it a quote is approved automatically; at or over it management approve first, then the owner;
// a contractor's estimate always goes to management. These helpers give the app's wording for it.
export const DEFAULT_REPAIR_LIMIT_MINOR = 10000;
// The limit in force: the policy's amount, or £100 when none is set (the database reads it the same way).
export const repairLimit = (limitMinor: number | null | undefined) => typeof limitMinor === 'number' ? limitMinor : DEFAULT_REPAIR_LIMIT_MINOR;
// "£100" for whole pounds, "£99.50" otherwise.
export const limitPounds = (minor: number) => minor % 100 === 0 ? '£' + (minor / 100).toLocaleString('en-GB') : formatMoney(minor);

export type QuoteSource = 'team' | 'contractor';
export const QUOTE_SOURCE_LABEL: Record<QuoteSource, string> = { team: 'Ready team quote', contractor: 'Contractor estimate' };
export const quoteSourceOf = (data: Record<string, unknown>): QuoteSource => data.quoteSource === 'contractor' ? 'contractor' : 'team';

// "Approved automatically (under £100)" while the repair's current quote is the one approved that way.
export function autoApprovalLabel(data: Record<string, unknown>): string | null {
  const minor = data.autoApprovedMinor, limit = data.autoApprovalLimitMinor;
  if (typeof minor !== 'number' || typeof limit !== 'number' || minor !== data.estimatedCostMinor) return null;
  return `Approved automatically (under ${limitPounds(limit)})`;
}

// The Management setting, in plain words.
export function repairLimitSummary(limitMinor: number | null | undefined): string {
  const limit = limitPounds(repairLimit(limitMinor));
  return `Repairs under ${limit} are approved automatically. At ${limit} or more, management approve first and then the owner is asked. Contractor estimates always need management approval.`;
}

// Why a repair is waiting for management, for the person deciding.
export function managementReason(r: { estimatedCostMinor: number | null; limitMinor: number | null; quoteSource?: QuoteSource | null; ownerApprovedAt: string | null; ownerNext?: boolean | null }): string {
  const limit = limitPounds(repairLimit(r.limitMinor));
  const why = r.quoteSource === 'contractor' ? 'A contractor estimate, which management always approve.' : `At or over the ${limit} limit.`;
  const after = r.ownerNext === true ? 'Once you approve, the owner is asked to approve it.'
    : r.ownerApprovedAt ? 'The owner has already approved it, so it carries on once you approve.'
    : 'The owner does not need to approve it, so it carries on once you approve.';
  return why + ' ' + after;
}

// --- Send by WhatsApp -------------------------------------------------------------------------------
// A ready summary of the repair for the owner: the property, the issue, the quote and the next step. It
// never carries staff names or internal notes. With the owner's number it opens their chat; without it,
// WhatsApp opens so the person sending picks the contact.
export const APP_LINK = 'https://app.rechargegroup.co.uk';
export type RepairSummary = {
  propertyName: string; issue: string; phase: string; estimateMinor: number | null;
  quoteSource?: QuoteSource; autoApproval?: string | null; repairOn?: string | null;
};
const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
function nextStep(phase: string, repairOn: string | null | undefined): string {
  switch (phase) {
    case 'owner_approval': return `Please approve the quote in the Recharge app: ${APP_LINK}`;
    case 'management_approval': return 'We are checking the quote and will ask you if it needs your approval.';
    case 'owner_declined': return 'You declined this quote. We will get a new quote or close the repair.';
    case 'management_declined': return 'We are getting a new quote.';
    case 'referred': return 'Our maintenance team are booking the repair.';
    case 'booked': {
      const day = repairOn && !Number.isNaN(Date.parse(repairOn)) ? DATE.format(new Date(repairOn + (repairOn.length === 10 ? 'T12:00:00Z' : ''))) : null;
      return day ? `The repair is booked for ${day}.` : 'The repair is booked.';
    }
    case 'completed': return 'The repair is done.';
    case 'resolved': return 'This was fixed without a visit.';
    case 'closed': return 'This repair was closed without the work going ahead.';
    default: return 'We are arranging the repair.';
  }
}
export function repairWhatsAppText(r: RepairSummary): string {
  const quote = typeof r.estimateMinor === 'number' && r.estimateMinor > 0
    ? `${formatMoney(r.estimateMinor)}${r.quoteSource === 'contractor' ? ' (contractor estimate)' : ''}` : 'not known yet';
  return [
    `Repair at ${r.propertyName.trim()}`,
    `Issue: ${r.issue.trim()}`,
    `Quote: ${quote}`,
    ...(r.autoApproval ? [r.autoApproval] : []),
    `Next step: ${nextStep(r.phase, r.repairOn)}`,
  ].join('\n');
}
// A UK or international number as WhatsApp wants it (country code, digits only), or null when it cannot be read.
export function whatsAppNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.trim().replace(/[\s().-]/g, '');
  if (!/^\+?\d+$/.test(digits)) return null;
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = '44' + digits.slice(1);
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}
export function repairWhatsAppLink(r: RepairSummary, phone?: string | null): string {
  const number = whatsAppNumber(phone);
  return `https://wa.me/${number ?? ''}?text=${encodeURIComponent(repairWhatsAppText(r))}`;
}
