import { z } from 'zod';
import { CHANNEL_LABEL, monthLabel, payoutDifference, pounds, type PayoutRow } from './accounts-live';

// The summary at the top of the "Approve the payout" sheet (mobile/src/PayoutApproveSheet.tsx), so the person checks what
// they are approving: the property, the guest, the platform and booking, the stay, the money, any warning and what approving
// will do. The row comes from the reconciliation read; the rest from the 'payoutStay' finance report (20261015110000).
// Staff only: this sheet is never shown to owners, so the guest's name may appear.
const minor = z.number().int().nullable();
export const payoutStaySchema = z.object({
  reservationId: z.string(), propertyName: z.string().nullable(), propertyAddress: z.string().nullable(), status: z.string(),
  guestName: z.string().nullable(), guests: z.number().nullable(), checkIn: z.string(), checkOut: z.string(), nights: z.number(),
  lines: z.array(z.object({ lineId: z.string(), paidOn: z.string().nullable(), uploadedAt: z.string(), fileName: z.string(), reference: z.string(), amountMinor: z.number().int(), grossMinor: minor, active: z.boolean() })),
  locked: z.boolean(),
  statement: z.object({ id: z.string(), periodStart: z.string(), periodEnd: z.string().nullable(), status: z.string() }).nullable(),
  changedSinceStatement: z.boolean(), differentAfterStatement: z.boolean(),
}).passthrough();
export type PayoutStay = z.infer<typeof payoutStaySchema>;

export type SummaryItem = { label: string; value: string; tone?: 'bad' | 'muted' };
export type SummaryGroup = { title: string; items: SummaryItem[] };
export type PayoutSummary = { groups: SummaryGroup[]; lines: { when: string; reference: string; amount: string; setAside: boolean }[]; warnings: string[] };

const day = (iso: string) => new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(',', '');
const nightsBetween = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000));
const signed = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + pounds(Math.abs(v));
// What Hostaway's expected payout was worked out from, line by line (only what Hostaway gave).
const BREAKDOWN_SOURCE = { airbnb: 'Airbnb’s expected payout', itemised: 'Hostaway’s itemised fees', totals: 'Hostaway’s total less commission' } as const;
const BREAKDOWN_LINES = [
  ['commissionMinor', 'Commission (expected)'], ['guestFeeMinor', 'Guest fee kept by the platform'], ['paymentChargeMinor', 'Payments charge (expected)'],
  ['commissionVatMinor', 'VAT on commission (expected)'], ['cleaningFeeMinor', 'Cleaning fee in the total'], ['cityTaxMinor', 'City tax in the total'],
] as const;
export function expectedItems(row: Pick<PayoutRow, 'expectedBreakdown'>): SummaryItem[] {
  const b = row.expectedBreakdown;
  if (!b) return [];
  return [
    { label: 'Expected from', value: BREAKDOWN_SOURCE[b.source], tone: 'muted' },
    ...BREAKDOWN_LINES.flatMap(([key, label]) => typeof b[key] === 'number' ? [{ label, value: pounds(b[key] as number) }] : []),
  ];
}

// Everything the sheet lists, in order. `stay` may still be loading (or the database not updated yet): the row alone fills
// what it can and the rest reads "Loading…" or "Not known".
export function payoutSummary(row: PayoutRow, stay: PayoutStay | null, fallback: { propertyName?: string; propertyAddress?: string; loading?: boolean } = {}): PayoutSummary {
  const unknown = fallback.loading ? 'Loading…' : 'Not known';
  const nights = stay?.nights ?? nightsBetween(row.checkIn, row.checkOut);
  const guests = stay?.guests ?? row.guests;
  const diff = payoutDifference(row);
  const net = row.settledMinor ?? row.receivedMinor;
  const property: SummaryItem[] = [
    { label: 'Property', value: stay?.propertyName ?? fallback.propertyName ?? unknown },
    { label: 'Address', value: stay?.propertyAddress || fallback.propertyAddress || unknown, tone: stay?.propertyAddress || fallback.propertyAddress ? undefined : 'muted' },
  ];
  const guest: SummaryItem[] = [
    { label: 'Guest', value: stay?.guestName || (stay ? 'Name not known' : unknown), tone: stay?.guestName ? undefined : 'muted' },
    ...(guests != null ? [{ label: 'Guests', value: String(guests) }] : []),
  ];
  const booking: SummaryItem[] = [
    { label: 'Platform', value: CHANNEL_LABEL[row.channel] ?? row.channel },
    { label: 'Reservation code', value: row.channelReference ?? 'Not set', tone: row.channelReference ? undefined : 'bad' },
    { label: 'Hostaway reference', value: row.reference },
  ];
  const dates: SummaryItem[] = [
    { label: 'Check-in', value: day(row.checkIn) },
    { label: 'Check-out', value: day(row.checkOut) },
    { label: 'Nights', value: String(nights) },
  ];
  const money: SummaryItem[] = [
    { label: 'Expected', value: row.expectedMinor === null ? 'Not known' : pounds(row.expectedMinor), tone: row.expectedMinor === null ? 'muted' : undefined },
    ...expectedItems(row),
    { label: 'Received', value: row.receivedMinor === null ? 'Not received yet' : pounds(row.receivedMinor), tone: row.receivedMinor === null ? 'muted' : undefined },
    ...(diff !== null ? [{ label: 'Difference', value: diff === 0 ? 'None' : signed(diff), tone: diff === 0 ? undefined : 'bad' as const }] : []),
    ...(row.grossMinor != null ? [{ label: 'Gross', value: pounds(row.grossMinor) }] : []),
    ...(row.otaFeesMinor != null ? [{ label: 'Platform fee', value: pounds(row.otaFeesMinor) }] : []),
    ...(row.grossMinor != null && net != null ? [{ label: 'Net', value: pounds(net) }] : []),
  ];
  const warnings: string[] = [];
  if (stay?.status === 'cancelled') warnings.push('This stay is cancelled.');
  else if (stay && stay.status !== 'confirmed') warnings.push(`This stay is not confirmed (${stay.status}).`);
  if (row.repeatedAmount != null) warnings.push(`${pounds(row.repeatedAmount)} appears on more than one payout line. It is often an overlapping report; check before approving.`);
  if (stay?.differentAfterStatement) warnings.push('The money for this stay changed after its owner statement was issued.');
  else if (stay?.changedSinceStatement) warnings.push('This stay changed since its owner statement was issued.');
  if (stay?.locked && !stay.statement) warnings.push('An owner statement already issued covers these dates.');
  return {
    groups: [{ title: 'Property', items: property }, { title: 'Guest', items: guest }, { title: 'Platform and booking', items: booking }, { title: 'Stay', items: dates }, { title: 'Money', items: money }],
    lines: (stay?.lines ?? []).map(l => ({ when: day(l.paidOn ?? l.uploadedAt), reference: `${l.reference} · ${l.fileName}`, amount: pounds(l.amountMinor), setAside: !l.active })),
    warnings,
  };
}

// What approving will do, in one line.
export function approvalLine(row: Pick<PayoutRow, 'checkIn' | 'receivedMinor'>, amountMinor: number | null, stay: Pick<PayoutStay, 'statement'> | null): string {
  if (amountMinor === null) return 'Enter the amount to approve.';
  const statement = stay?.statement ? `the ${monthLabel(stay.statement.periodStart.slice(0, 7))} statement, which is already ${stay.statement.status}` : `the ${monthLabel(row.checkIn.slice(0, 7))} statement`;
  return row.receivedMinor === null
    ? `Approving marks this stay's money as agreed at ${pounds(amountMinor)} before it arrives, for ${statement}.`
    : `Approving marks this stay's money as received at ${pounds(amountMinor)} for ${statement}.`;
}
