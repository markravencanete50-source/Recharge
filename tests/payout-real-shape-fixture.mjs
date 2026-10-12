// A made-up Airbnb "Transaction history" export with the size and shape of a real one (a year of one portfolio:
// about 2,100 coded lines over about 150 payout dates, two bank transfers a day). Everything is generated from a
// seed: codes like HM + 8 random characters, guests "Guest 123", made-up listings. No real data.
// Shared by tests/payout-real-shape.test.mjs and tests/payout-real-shape-database.test.mjs.

export const HEADER = ['Date', 'Arriving by date', 'Type', 'Confirmation Code', 'Booking date', 'Start date', 'End date', 'Nights', 'Guest', 'Listing', 'Details',
  'Reference code', 'Currency', 'Amount', 'Paid out', 'Service fee', 'Fast Pay Fee', 'Cleaning fee', 'Gross earnings', 'Airbnb remitted tax', 'Earnings year'];
const LISTINGS = ['Flat 1, Example Street', 'The Old Bothy, Sample Lane', 'Harbour View Apartment', 'Garden Flat, Test Road', 'Mill Cottage', 'Loft 4, Demo Quay', 'Kirk Wynd House'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
// Coded rows other than reservations: [type, share of rows, sign].
const OTHER_TYPES = [['Resolution Payout', 0.027, 1], ['Cancellation Fee', 0.02, -1], ['Cancellation Fee Refund', 0.011, 1], ['Adjustment', 0.025, -1], ['Resolution Adjustment', 0.059, -1]];

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pad = n => String(n).padStart(2, '0');
const usDay = date => `${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}/${date.getUTCFullYear()}`;
const isoDay = date => date.toISOString().slice(0, 10);
const addDays = (date, days) => new Date(date.getTime() + days * 86400000);
// Amounts as an export writes them: "460.00", "-12.50", and "1,234.56" above a thousand (quoted when written out).
export const money = minor => (minor < 0 ? '-' : '') + (Math.abs(minor) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: Math.abs(minor) >= 100000 });
const quote = cell => /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
export const render = rows => '﻿' + [HEADER, ...rows].map(row => row.map(quote).join(',')).join('\n') + '\n';

// rows: the data rows in file order (newest date first, each date's transfers then its lines, as Airbnb lists them).
// coded: the coded rows; transfers: one entry per Payout row; days: per ISO date, the net of its lines and its transfers.
export function airbnbYear({ seed = 20261012, days = 150, linesPerDay = 14.3, start = '2026-02-20', codePrefix = 'HM' } = {}) {
  const random = mulberry32(seed);
  const pick = list => list[Math.floor(random() * list.length)];
  const int = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
  const used = new Set();
  const code = () => { for (;;) { let c = codePrefix; while (c.length < codePrefix.length + 8) c += pick(CODE_CHARS); if (!used.has(c)) { used.add(c); return c; } } };
  const reference = () => { let r = 'M-'; while (r.length < 10) r += pick(CODE_CHARS); return r; };
  const stays = [];
  const byDay = [];
  let date = new Date(start + 'T00:00:00Z');
  for (let d = 0; d < days; d++) {
    date = addDays(date, d === 0 ? 0 : int(1, 2));
    const day = { date: isoDay(date), us: usDay(date), lines: [], transfers: [] };
    const count = Math.max(4, Math.round(linesPerDay + (random() - 0.5) * 10));
    for (let i = 0; i < count; i++) {
      const roll = random();
      let acc = 0, other = null;
      for (const entry of OTHER_TYPES) { acc += entry[1]; if (roll < acc) { other = entry; break; } }
      const listing = pick(LISTINGS), guest = `Guest ${int(100, 999)}`;
      if (!other || !stays.length) {
        const nights = int(1, 9), startOn = addDays(date, -int(0, 3)), gross = int(60, 240) * 100 * nights + int(0, 99), cleaning = pick([4500, 6000, 7500]);
        const fee = Math.round(gross * 0.03), net = gross - fee, stay = { code: code(), listing, guest, startOn, nights };
        stays.push(stay);
        day.lines.push({ type: 'Reservation', code: stay.code, minor: net, row: [day.us, usDay(addDays(date, 1)), 'Reservation', stay.code, usDay(addDays(startOn, -int(5, 90))), usDay(startOn), usDay(addDays(startOn, nights)), String(nights),
          guest, listing, '', '', 'GBP', money(net), '', money(fee), '', money(cleaning), money(gross), '', String(date.getUTCFullYear())] });
      } else {
        const [type, , sign] = other, stay = pick(stays), minor = sign * int(500, 25000);
        day.lines.push({ type, code: stay.code, minor, row: [day.us, usDay(addDays(date, 1)), type, stay.code, '', usDay(stay.startOn), usDay(addDays(stay.startOn, stay.nights)), String(stay.nights),
          stay.guest, stay.listing, type === 'Adjustment' ? 'Adjusted for a refund, partial' : '', '', 'GBP', money(minor), '', '', '', '', '', '', String(date.getUTCFullYear())] });
      }
    }
    // The day's net goes to the bank in one to three transfers; a day can never pay out a negative amount.
    let net = day.lines.reduce((sum, line) => sum + line.minor, 0);
    if (net <= 0) {
      const top = 100 - net + int(1000, 5000), stay = stays[stays.length - 1];
      day.lines.push({ type: 'Resolution Payout', code: stay.code, minor: top, row: [day.us, usDay(addDays(date, 1)), 'Resolution Payout', stay.code, '', usDay(stay.startOn), usDay(addDays(stay.startOn, stay.nights)), String(stay.nights),
        stay.guest, stay.listing, '', '', 'GBP', money(top), '', '', '', '', '', '', String(date.getUTCFullYear())] });
      net += top;
    }
    const parts = net >= 300 ? int(1, 3) : 1;
    let left = net;
    for (let p = 0; p < parts; p++) {
      const amount = p === parts - 1 ? left : Math.floor(left * (0.3 + random() * 0.4));
      left -= amount;
      day.transfers.push({ minor: amount, row: [day.us, usDay(addDays(date, 2)), 'Payout', '', '', '', '', '', '', '', 'Transfer to Account ****4321, GBP', reference(), 'GBP', '', money(amount), '', '', '', '', '', ''] });
    }
    byDay.push(day);
  }
  byDay.reverse();
  const rows = byDay.flatMap(day => [...day.transfers.map(t => t.row), ...day.lines.map(l => l.row)]);
  const coded = byDay.flatMap(day => day.lines.map(line => ({ ...line, date: day.date })));
  const transfers = byDay.flatMap(day => day.transfers.map(t => ({ date: day.date, minor: t.minor, row: t.row })));
  return { rows, coded, transfers, days: byDay.map(day => ({ date: day.date, linesMinor: day.lines.reduce((s, l) => s + l.minor, 0), paidOutMinor: day.transfers.reduce((s, t) => s + t.minor, 0) })) };
}
