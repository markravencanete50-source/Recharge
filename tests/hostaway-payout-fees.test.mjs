import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// The expected payout from Hostaway's itemised finance lines (financeField), with sample reservations shaped like
// Hostaway's public API reference (the reservation object with includeResources=1, and its finance field objects).
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const policy = await vite.ssrLoadModule('/lib/hostaway-sync-policy.ts');
const { expectedItems } = await vite.ssrLoadModule('/lib/payout-summary.ts');
const { payoutRowSchema } = await vite.ssrLoadModule('/lib/accounts-live.ts');

let nextId = 1;
const line = (type, name, title, total, extra = {}) => ({
  id: nextId++, listingFeeSettingId: null, type, name, title, alias: null, quantity: null, value: total, total,
  isIncludedInTotalPrice: 1, isOverriddenByUser: 0, isQuantitySelectable: 0, isMandatory: null, isDeleted: 0, ...extra,
});
const base = {
  id: 8001, listingMapId: 501, arrivalDate: '2026-11-02', departureDate: '2026-11-05', status: 'new', numberOfGuests: 2,
  currency: 'GBP', channelReservationId: '4455667788', airbnbExpectedPayoutAmount: null, hostChannelFee: null,
};
const bookingLines = () => [
  line('price', 'baseRate', 'Base rate', 500),
  line('fee', 'cleaningFee', 'Cleaning fee', 60),
  line('tax', 'cityTax', 'City tax', 40),
  line('commissions', 'hostChannelFee', 'Host channel fee', 90, { isIncludedInTotalPrice: 0 }),
  line('fee', 'otaPaymentProcessingFee', 'Payment processing fee', '8.40', { value: '8.40', total: '8.40', isIncludedInTotalPrice: 0 }),
  line('tax', 'vatOnCommission', 'VAT on commission', -18, { isIncludedInTotalPrice: 0 }),
  line('commissions', 'hostChannelFee', 'Host channel fee (old)', 999, { isDeleted: 1 }),
  line('totals', 'totalPrice', 'Total price', 600, { isIncludedInTotalPrice: 0 }),
];
const booking = { ...base, channelName: 'bookingcom', totalPrice: 600, channelCommissionAmount: 90, financeField: bookingLines() };

test('Booking.com: commission, payments charge and VAT on commission come off the total', () => {
  const r = policy.syncReservation(booking);
  assert.equal(r.channel, 'booking_com');
  assert.equal(r.payoutMinor, 60000 - 9000 - 840 - 1800, 'the deleted line and the cleaning fee and city tax are not deducted');
  assert.deepEqual(r.payoutBreakdown, { source: 'itemised', grossMinor: 60000, commissionMinor: 9000, guestFeeMinor: null, paymentChargeMinor: 840, commissionVatMinor: 1800, cleaningFeeMinor: 6000, cityTaxMinor: 4000 });
});

test('the itemised commission wins over channelCommissionAmount, so it is never taken twice', () => {
  const r = policy.syncReservation({ ...booking, channelCommissionAmount: 95, hostChannelFee: 90 });
  assert.equal(r.payoutBreakdown.commissionMinor, 9000);
  assert.equal(r.payoutMinor, 48360);
});

test('with only some lines, the commission falls back to channelCommissionAmount', () => {
  const lines = bookingLines().filter(l => l.name !== 'hostChannelFee');
  const r = policy.syncReservation({ ...booking, financeField: lines });
  assert.equal(r.payoutBreakdown.source, 'itemised');
  assert.equal(r.payoutBreakdown.commissionMinor, 9000);
  assert.equal(r.payoutMinor, 48360);
});

test('Vrbo: a guest fee kept by the channel comes off only when it is in the total', () => {
  const lines = [line('price', 'baseRate', 'Base rate', 700), line('fee', 'guestChannelFee', 'Service fee', 63), line('fee', 'cleaningFee', 'Cleaning fee', 50),
    line('commissions', 'hostChannelFee', 'Host channel fee', 40.5, { isIncludedInTotalPrice: 0 }), line('fee', 'paymentServiceProcessingFee', 'Payment processing', 24.39, { isIncludedInTotalPrice: 0 })];
  const vrbo = { ...base, channelName: 'homeaway', totalPrice: 813, channelCommissionAmount: null, financeField: lines };
  const r = policy.syncReservation(vrbo);
  assert.equal(r.channel, 'vrbo');
  assert.equal(r.payoutMinor, 81300 - 6300 - 4050 - 2439);
  assert.deepEqual(r.payoutBreakdown, { source: 'itemised', grossMinor: 81300, commissionMinor: 4050, guestFeeMinor: 6300, paymentChargeMinor: 2439, commissionVatMinor: null, cleaningFeeMinor: 5000, cityTaxMinor: null });
  const outside = lines.map(l => l.name === 'guestChannelFee' ? { ...l, isIncludedInTotalPrice: 0 } : l);
  const r2 = policy.syncReservation({ ...vrbo, totalPrice: 750, financeField: outside });
  assert.equal(r2.payoutBreakdown.guestFeeMinor, null, 'a guest fee outside the total was never ours');
  assert.equal(r2.payoutMinor, 75000 - 4050 - 2439);
});

test('direct: the payment service charge comes off', () => {
  const lines = [line('price', 'baseRate', 'Base rate', 400), line('fee', 'paymentServiceProcessingFees', 'Payment processing fees', 9.8, { isIncludedInTotalPrice: 0 })];
  const r = policy.syncReservation({ ...base, channelName: 'bookingengine', totalPrice: 400, financeField: lines });
  assert.equal(r.channel, 'direct');
  assert.equal(r.payoutMinor, 39020);
  assert.equal(r.payoutBreakdown.source, 'itemised');
  assert.equal(r.payoutBreakdown.paymentChargeMinor, 980);
});

test('Airbnb keeps Airbnb’s expected payout, with the lines shown alongside', () => {
  const lines = [line('price', 'baseRate', 'Base rate', 420), line('fee', 'cleaningFee', 'Cleaning fee', 60), line('commissions', 'hostChannelFee', 'Host channel fee', 72, { isIncludedInTotalPrice: 0 })];
  const r = policy.syncReservation({ ...base, channelName: 'airbnbOfficial', totalPrice: 480, airbnbExpectedPayoutAmount: 412.5, channelCommissionAmount: 67.5, financeField: lines });
  assert.equal(r.payoutMinor, 41250);
  assert.deepEqual(r.payoutBreakdown, { source: 'airbnb', grossMinor: 48000, commissionMinor: 7200, guestFeeMinor: null, paymentChargeMinor: null, commissionVatMinor: null, cleaningFeeMinor: 6000, cityTaxMinor: null });
  const none = policy.syncReservation({ ...base, channelName: 'airbnbOfficial', totalPrice: 480, channelCommissionAmount: 67.5, financeField: lines });
  assert.equal(none.payoutMinor, 48000 - 7200, 'no Airbnb payout yet: worked out from the lines like the others');
});

test('nothing gets worse when the lines are missing or broken: the sum is today’s', () => {
  const today = r => { // The calculation before the itemised lines, kept here to compare against.
    const fees = (r.channelCommissionAmount ?? 0) + (r.hostChannelFee ?? 0);
    const payout = r.totalPrice - Math.max(0, fees);
    return payout >= 0 ? Math.round(payout * 100) : null;
  };
  const cases = [
    { ...base, channelName: 'bookingcom', totalPrice: 300, channelCommissionAmount: 45, hostChannelFee: 0 },
    { ...base, channelName: 'bookingcom', totalPrice: 300, channelCommissionAmount: 45, financeField: [] },
    { ...base, channelName: 'bookingcom', totalPrice: 300, channelCommissionAmount: 45, financeField: 'not a list' },
    { ...base, channelName: 'bookingcom', totalPrice: 300, channelCommissionAmount: 45, financeField: [null, 7, { name: 'hostChannelFee' }, { total: 12 }] },
    { ...base, channelName: 'homeaway', totalPrice: 250.55, channelCommissionAmount: 20.05, financeField: [line('price', 'baseRate', 'Base rate', 250.55)] },
    { ...base, channelName: 'homeaway', totalPrice: 250, channelCommissionAmount: null },
  ];
  for (const c of cases) {
    const r = policy.syncReservation(c);
    assert.equal(r.payoutMinor, today(c), JSON.stringify(c.financeField));
    assert.equal(r.payoutBreakdown.source, 'totals');
  }
  assert.equal(policy.syncReservation(cases[5]).payoutBreakdown.commissionMinor, null, 'no commission given: not known, not nothing');
  assert.equal(policy.syncReservation({ ...booking, totalPrice: null }).payoutMinor, null, 'no total: not known');
  assert.equal(policy.syncReservation({ ...booking, totalPrice: 20 }).payoutMinor, null, 'never a negative payout');
});

test('not in pounds, or an owner stay: no payout worked out and no breakdown', () => {
  assert.deepEqual([policy.syncReservation({ ...booking, currency: 'EUR' }).payoutMinor, policy.syncReservation({ ...booking, currency: 'EUR' }).payoutBreakdown], [null, null]);
  const owner = policy.syncReservation({ ...booking, status: 'ownerStay' });
  assert.deepEqual([owner.payoutMinor, owner.payoutBreakdown], [0, null]);
});

test('VAT on commission is read only from a line that says both', () => {
  const vat = (name, title) => policy.syncPayout({ currency: 'GBP', totalPrice: 100, financeField: [line('tax', name, title, 3)] }, 'booking_com').breakdown.commissionVatMinor;
  assert.equal(vat('vatOnCommission', ''), 300);
  assert.equal(vat('commissionVat', 'Commission VAT'), 300);
  assert.equal(vat('otherTax', 'VAT on commission'), 300);
  assert.equal(vat('vat', 'VAT / GST'), null, 'the guest’s VAT on the stay is not ours to deduct');
  assert.equal(vat('hostChannelFee', 'Commission'), null);
  assert.equal(vat('privateCommissionNote', 'Commission (no tax)'), null);
});

test('every Hostaway field name is in the policy', () => {
  assert.deepEqual(policy.HOSTAWAY_PAYOUT_FIELDS, { currency: 'currency', total: 'totalPrice', airbnbPayout: 'airbnbExpectedPayoutAmount', commission: 'channelCommissionAmount', hostFee: 'hostChannelFee', lines: 'financeField' });
  assert.deepEqual(policy.HOSTAWAY_LINE_FIELDS, { name: 'name', title: 'title', total: 'total', value: 'value', included: 'isIncludedInTotalPrice', deleted: 'isDeleted' });
  assert.deepEqual(Object.keys(policy.HOSTAWAY_LINE_NAMES), ['commission', 'guestFee', 'paymentCharge', 'cleaningFee', 'cityTax']);
});

test('the Approve the payout sheet lists what the expected payout came from', () => {
  const breakdown = policy.syncReservation(booking).payoutBreakdown;
  assert.deepEqual(expectedItems({ expectedBreakdown: breakdown }), [
    { label: 'Expected from', value: 'Hostaway’s itemised fees', tone: 'muted' },
    { label: 'Commission (expected)', value: '£90.00' },
    { label: 'Payments charge (expected)', value: '£8.40' },
    { label: 'VAT on commission (expected)', value: '£18.00' },
    { label: 'Cleaning fee in the total', value: '£60.00' },
    { label: 'City tax in the total', value: '£40.00' },
  ]);
  assert.deepEqual(expectedItems({ expectedBreakdown: null }), []);
  assert.deepEqual(expectedItems({}), [], 'an older database sends no breakdown');
  assert.ok(payoutRowSchema.shape.expectedBreakdown.safeParse(undefined).success);
  assert.ok(payoutRowSchema.shape.expectedBreakdown.safeParse({ source: 'totals', commissionMinor: 4500 }).success);
  assert.ok(!payoutRowSchema.shape.expectedBreakdown.safeParse({ source: 'guess' }).success);
});
