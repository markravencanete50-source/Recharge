import { formatDay, formatMoney } from './format';
import { repairTypeLabel } from './repair-guides';
import type { OperationView } from './workflow-forms';

// What a work item's sheet shows, in plain words, for each kind of work.
export type Detail = { label: string; value: string; tone?: 'bad' | 'good' };
const text = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : '';
const money = (v: unknown) => typeof v === 'number' ? formatMoney(v) : '';
const RELIST_REASON: Record<string, string> = { suspended: 'Listing suspended', hidden: 'Listing not visible', review: 'Bad review' };
const LICENCE_STAGE: Record<string, string> = { applied: 'Application submitted; safety checks next', checks_done: 'Safety checks done; waiting for the grant', granted: 'Licence granted' };
const SENTIMENT: Record<string, string> = { positive: 'Good', neutral: 'Mixed', negative: 'Bad' };

export function workDetails(w: OperationView): Detail[] {
  const d = w.data, out: Detail[] = [];
  const add = (label: string, value: string, tone?: Detail['tone']) => { if (value) out.push({ label, value, ...(tone ? { tone } : {}) }); };
  if (w.kind === 'maintenance') {
    add('Repair type', typeof d.repairType === 'string' ? repairTypeLabel(d.repairType) : '');
    if (d.urgent === true) add('Priority', 'Urgent', 'bad');
    add('Contact first', text(d.contactFirst));
    add('Warranties', text(d.warrantyDetails));
  }
  if (w.kind === 'direct_booking') {
    if (text(d.checkIn) && text(d.checkOut)) add('Stay', `${formatDay(text(d.checkIn))} → ${formatDay(text(d.checkOut))}`);
    add('Original price', money(d.baseAmountMinor));
    add('Direct-booking offer', money(d.quoteAmountMinor), 'good');
    if (d.phase === 'declined') add('Outcome', 'Guest said no');
  }
  if (w.kind === 'relisting') {
    add('Why', RELIST_REASON[text(d.reason)] ?? '');
    add('Platform', text(d.platform));
    add('Progress', d.phase === 'relisting' ? 'Re-listing under way' : d.phase === 'completed' ? 'Re-listed' : 'To re-list');
    add('What is being done', text(d.note));
  }
  if (w.kind === 'licensing') {
    add('Stage', LICENCE_STAGE[text(d.phase)] ?? 'Application to submit');
    add('Authority', text(d.authority));
    add('Application reference', text(d.applicationReference));
  }
  if (w.kind === 'guest_review') {
    add('Platform', text(d.platform));
    if (typeof d.rating === 'number' && typeof d.outOf === 'number') add('Rating', `${d.rating} out of ${d.outOf}`);
    add('Good or bad', SENTIMENT[text(d.sentiment)] ?? '', d.sentiment === 'negative' ? 'bad' : d.sentiment === 'positive' ? 'good' : undefined);
    add('What the guest said', text(d.summary));
    add('How it was handled', text(d.response));
  }
  for (const [key, label] of [['issue', 'Issue'], ['report', 'Report'], ['requirements', 'Requirements'], ['guestUpdate', 'Guest update'], ['reason', 'Reason']] as const) add(label, text(d[key]));
  return out;
}
