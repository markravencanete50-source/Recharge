// The payout reports Recharge reconciles, and the column headers each platform's export uses.
//
// No real Vrbo file, and no recent Airbnb or Booking.com file, was available when these lists were
// written, so they are deliberately generous. When a real export arrives, add its exact header text
// to the right list below (and a test with a few of its rows to tests/payout-reconciliation.test.mjs).
//
// How the reader (readPayoutLines in lib/payout-reconciliation.ts) uses these lists:
// - Headers are compared ignoring case, spaces and punctuation, so "Confirmation Code",
//   "confirmation_code" and "Confirmation code:" are the same header. A "%" is kept ("Commission %"
//   is a rate, not an amount) and a "(GBP)" or "£" note is ignored ("Payout amount (GBP)").
// - Order matters. On each row the reader takes the first listed column that has a value, so put
//   the most specific header first. The first header of a list is the one named in error messages.
// - "net" lists only columns holding the money actually paid out to Recharge for that line. Never add
//   a gross, booking value or guest-paid column to it: the reader records "net" as money received.
//   A file with no "net" column is refused.
// - "code" lists only the platform's own reservation code. A generic "Reference" is not one on any of
//   these exports (Airbnb uses it for the bank transfer), so it is never a code here.
// - A header belongs to at most one field of a channel, and a code header to one channel only, so a
//   file uploaded under the wrong platform is recognised. tests/payout-reconciliation.test.mjs checks both.
// - Fee columns may be written as negative numbers; the reader stores fees as positive amounts.

export const RECONCILED_CHANNELS = ['airbnb', 'booking_com', 'vrbo'] as const;
export type PayoutChannel = typeof RECONCILED_CHANNELS[number];
export const isPayoutChannel = (value: unknown): value is PayoutChannel => (RECONCILED_CHANNELS as readonly unknown[]).includes(value);
export const PAYOUT_CHANNEL_LABEL: Record<PayoutChannel, string> = { airbnb: 'Airbnb', booking_com: 'Booking.com', vrbo: 'Vrbo' };

export const PAYOUT_FIELDS = ['code', 'net', 'gross', 'commission', 'hostFee', 'paymentFee', 'cleaningFee', 'date', 'type', 'currency', 'payoutRef'] as const;
export type PayoutField = typeof PAYOUT_FIELDS[number];

export const PAYOUT_COLUMNS: Record<PayoutChannel, Record<PayoutField, readonly string[]>> = {
  // Airbnb "Transaction history" / "Completed payouts" CSV. One row per reservation, adjustment or
  // payout; "Payout" rows (the bank transfer) have no confirmation code and are skipped. "Amount" is
  // what the host receives for the line after Airbnb's fee; "Paid out" is filled on transfer rows.
  airbnb: {
    code: ['Confirmation code', 'Confirmation number', 'Confirmation'],
    net: ['Amount', 'Paid out', 'Net amount', 'Net earnings', 'Host payout', 'Payout amount'],
    gross: ['Gross earnings', 'Gross amount', 'Gross'],
    // Airbnb shows its charge as a host or service fee, not a commission.
    commission: [],
    hostFee: ['Host fee', 'Service fee', 'Host service fee'],
    paymentFee: ['Fast pay fee', 'Payment fee'],
    cleaningFee: ['Cleaning fee', 'Cleaning fees'],
    date: ['Date', 'Transaction date', 'Payout date'],
    type: ['Type', 'Transaction type'],
    currency: ['Currency'],
    payoutRef: ['Reference code', 'Reference', 'Payout reference', 'Payout ID'],
  },
  // Booking.com extranet "Payouts" / "Reservations statement" CSV. "Net" (or "Payout amount") is
  // after commission and the payments fee. A plain "Amount" is not read: on some Booking.com exports
  // it is the reservation value, so it could be mistaken for money received.
  booking_com: {
    code: ['Reservation number', 'Reference number', 'Booking number', 'Book number', 'Booking reference'],
    net: ['Net', 'Net amount', 'Net payout', 'Payable amount', 'Amount payable', 'Payout amount', 'Total payout'],
    gross: ['Gross amount', 'Gross', 'Room sales', 'Original amount', 'Reservation amount', 'Total price'],
    commission: ['Commission', 'Commission amount'],
    hostFee: [],
    paymentFee: ['Payments service fee', 'Payment service fee', 'Payments fee', 'Payment fee', 'Payment charge', 'Payment charges', 'Payments charge', 'Payment processing fee'],
    cleaningFee: ['Cleaning fee'],
    date: ['Payout date', 'Date', 'Transaction date', 'Issue date', 'Payment date'],
    type: ['Type', 'Transaction type', 'Line type'],
    currency: ['Currency', 'Transaction currency', 'Payout currency'],
    payoutRef: ['Payout ID', 'Payout reference', 'Payout number', 'Payment reference', 'Statement descriptor'],
  },
  // Vrbo (formerly HomeAway) payout or "Payments" report. Unseen so far: every header here is a guess
  // from the platform's help pages and common exports. Replace it with the real headers once a file arrives.
  vrbo: {
    code: ['Reservation ID', 'Reservation code', 'Booking ID', 'Vrbo reservation ID', 'HomeAway reservation ID'],
    net: ['Payout amount', 'Net payout', 'Net amount', 'Net', 'Payout', 'Amount paid', 'Paid out', 'Total payout', 'Owner payout'],
    gross: ['Gross amount', 'Gross', 'Gross booking amount', 'Booking amount', 'Total booking amount', 'Rental amount', 'Reservation amount'],
    commission: ['Commission', 'Commission amount', 'Host service fee', 'Service fee', 'Vrbo service fee'],
    hostFee: [],
    paymentFee: ['Payment processing fee', 'Processing fee', 'Payment fee', 'Payments fee', 'Card processing fee'],
    cleaningFee: ['Cleaning fee'],
    date: ['Payout date', 'Date', 'Transaction date', 'Disbursement date', 'Payment date'],
    type: ['Type', 'Transaction type', 'Line type'],
    currency: ['Currency', 'Payout currency'],
    payoutRef: ['Payout ID', 'Payout reference', 'Disbursement ID', 'Payment ID', 'Payment reference'],
  },
};

// The form a header is compared in: "Payout amount (GBP)" and "payout_amount" both become "payoutamount".
export function headerKey(header: string): string {
  return header.normalize('NFKC').toLowerCase()
    .replace(/[([]\s*(?:gbp|£)\s*[)\]]/g, '')
    .replace(/%/g, 'pct')
    .replace(/[^a-z0-9]+/g, '');
}
