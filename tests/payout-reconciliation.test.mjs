import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { parseCsv, parseMoneyMinor, readPayoutReport, readPayoutLines, detectPayoutChannel, percentOfMinor, reconcile, ownerStatement } = await vite.ssrLoadModule("/lib/payout-reconciliation.ts");
const { RECONCILED_CHANNELS, PAYOUT_COLUMNS, PAYOUT_FIELDS, headerKey } = await vite.ssrLoadModule("/lib/payout-report-formats.ts");

test("CSV parsing keeps quoted commas and escaped quotes", () => {
  assert.deepEqual(parseCsv('a,"b, c","d ""e"""\r\n1,2,3\n'), [["a", "b, c", 'd "e"'], ["1", "2", "3"]]);
});

test("money parsing handles symbols, thousands and negatives", () => {
  assert.equal(parseMoneyMinor("£1,234.5"), 123450);
  assert.equal(parseMoneyMinor("(12.00)"), -1200);
  assert.equal(parseMoneyMinor("-3"), -300);
  assert.equal(parseMoneyMinor("n/a"), null);
});

test("Airbnb reports ignore payout summary lines and sum per reservation", () => {
  const report = readPayoutReport([
    "Date,Type,Confirmation Code,Guest,Amount,Paid Out",
    "10/01/2026,Payout,,,,\"1,000.00\"",
    "10/01/2026,Reservation,HMQ4K2T8XW,Guest A,460.00,",
    "10/02/2026,Resolution Adjustment,HMQ4K2T8XW,Guest A,-10.00,",
  ].join("\n"));
  assert.equal(report.source, "Airbnb");
  assert.deepEqual(report.rows, [{ code: "HMQ4K2T8XW", amountMinor: 45000, source: "Airbnb" }]);
});

test("Booking.com reports are read by reservation number", () => {
  const report = readPayoutReport("Reservation number,Check-in,Payout amount\n4172839560,2026-10-01,£520.00\n");
  assert.equal(report.source, "Booking.com");
  assert.deepEqual(report.rows, [{ code: "4172839560", amountMinor: 52000, source: "Booking.com" }]);
  assert.match(readPayoutReport("Foo,Bar\n1,2").error, /reservation code/);
});

test("reconciliation flags matched, different, missing and unexpected payouts", () => {
  const rows = reconcile(
    [{ code: "A1", amountMinor: 1000, propertyId: "p", guest: "g", channel: "Airbnb" }, { code: "B2", amountMinor: 2000, propertyId: "p", guest: "g", channel: "Airbnb" }, { code: "C3", amountMinor: 500, propertyId: "p", guest: "g", channel: "Direct" }],
    [{ code: "a1", amountMinor: 1000, source: "Airbnb" }, { code: "B2", amountMinor: 1900, source: "Airbnb" }, { code: "Z9", amountMinor: 700, source: "Airbnb" }],
  );
  assert.deepEqual(rows.map(row => [row.code, row.status]), [["A1", "matched"], ["B2", "different"], ["C3", "missing"], ["Z9", "unexpected"]]);
});

test("owner statement charges the fee on gross revenue", () => {
  const statement = ownerStatement({ revenueMinor: 200000, cleaningMinor: 13000, expensesMinor: 4500, managementFeeBps: 1500 });
  assert.equal(statement.feeMinor, 30000);
  assert.equal(statement.payoutMinor, 152500);
});

// --- readPayoutLines: one line per coded row, per-channel headers, net only.
const csv = rows => rows.map(row => row.join(",")).join("\n");
const blankLine = { grossMinor: null, commissionMinor: null, hostFeeMinor: null, paymentFeeMinor: null, cleaningFeeMinor: null, paidOn: null, lineType: null, key: null };

test("the channel lists are well formed: three channels, every field, no shared or generic code headers", () => {
  assert.deepEqual([...RECONCILED_CHANNELS], ["airbnb", "booking_com", "vrbo"]);
  const codeOwner = new Map();
  for (const channel of RECONCILED_CHANNELS) {
    assert.deepEqual(Object.keys(PAYOUT_COLUMNS[channel]).sort(), [...PAYOUT_FIELDS].sort(), channel);
    assert.ok(PAYOUT_COLUMNS[channel].code.length && PAYOUT_COLUMNS[channel].net.length, channel);
    const owner = new Map();
    for (const field of PAYOUT_FIELDS) for (const header of PAYOUT_COLUMNS[channel][field]) {
      const key = headerKey(header);
      assert.ok(!owner.has(key) || owner.get(key) === field, `${channel}: "${header}" is listed for ${owner.get(key)} and ${field}`);
      owner.set(key, field);
    }
    for (const header of PAYOUT_COLUMNS[channel].code) {
      assert.notEqual(headerKey(header), "reference", "a generic reference is never a reservation code");
      assert.ok(!codeOwner.has(headerKey(header)), `"${header}" is a code header for two channels`);
      codeOwner.set(headerKey(header), channel);
    }
    for (const header of PAYOUT_COLUMNS[channel].net) assert.ok(!/gross|room ?sales|booking amount|price/i.test(header), `${channel}: "${header}" looks like gross`);
  }
  assert.equal(headerKey(" Payout_Amount (GBP) "), "payoutamount");
  assert.equal(headerKey("Commission %"), "commissionpct");
});

test("Airbnb: every coded row is its own line with the net amount, positive fees, gross, date and type", () => {
  const file = csv([
    ["Date", "Arriving by date", "Type", "Confirmation code", "Start date", "Nights", "Guest", "Listing", "Details", "Reference code", "Currency", "Amount", "Paid out", "Service fee", "Fast pay fee", "Cleaning fee", "Gross earnings"],
    ["10/06/2026", "10/07/2026", "Payout", "", "", "", "", "", "Transfer to account ending 1234", "G-PAY001", "GBP", "", "525.40", "", "", "", ""],
    ["10/05/2026", "", "Reservation", "HMAAA11111", "10/02/2026", "3", "Guest A", "Flat", "", "", "GBP", "412.40", "", "-12.60", "", "45.00", "425.00"],
    ["10/12/2026", "", "Resolution Adjustment", "HMAAA11111", "", "", "Guest A", "Flat", "Damage claim", "", "GBP", "-20.00", "", "", "", "", ""],
    ["10/13/2026", "", "Reservation", "HMBBB22222", "10/10/2026", "2", "Guest B", "Cottage", "", "", "GBP", "133.00", "", "-4.00", "-1.50", "", "137.00"],
  ]);
  const report = readPayoutLines(file, "airbnb");
  assert.equal(report.error, undefined);
  assert.deepEqual(report.skipped, { noCode: 1, noAmount: 0 });
  assert.equal(report.used.code, "Confirmation code");
  assert.equal(report.used.net, "Amount, Paid out");
  assert.equal(report.used.hostFee, "Service fee");
  assert.deepEqual(report.lines.map(l => [l.reference, l.amountMinor, l.grossMinor, l.hostFeeMinor, l.paymentFeeMinor, l.cleaningFeeMinor, l.paidOn, l.lineType]), [
    ["HMAAA11111", 41240, 42500, 1260, null, 4500, "2026-10-05", "Reservation"],
    ["HMAAA11111", -2000, null, null, null, null, "2026-10-12", "Resolution Adjustment"],
    ["HMBBB22222", 13300, 13700, 400, 150, null, "2026-10-13", "Reservation"],
  ]);
  assert.equal(report.lines[0].commissionMinor, null);
  assert.equal(new Set(report.lines.map(l => l.key)).size, 3);
  assert.equal(report.lines[0].key, "HMAAA11111|10-5-2026|reservation|41240||1");
  assert.equal(detectPayoutChannel(file), "airbnb");
});

test("Booking.com: Net wins over Amount, a rate column is not an amount, a blank net is skipped and counted", () => {
  const file = csv([
    ["Type", "Reference number", "Check-in", "Checkout", "Guest name", "Reservation status", "Currency", "Amount", "Commission", "Commission %", "Payments Service Fee", "Payments Service Fee %", "Net", "Payout date", "Payout ID"],
    ["Reservation", "4172839560", "2026-10-01", "2026-10-04", "Guest C", "ok", "GBP", "520.00", "-78.00", "15%", "-7.28", "1.4%", "434.72", "2026-10-14", "PO-991"],
    ["Reservation", "4172839561", "2026-10-05", "2026-10-06", "Guest D", "ok", "GBP", "200.00", "-30.00", "15%", "-2.80", "1.4%", "", "2026-10-14", "PO-991"],
    ["Reservation", "4172839562", "2026-10-07", "2026-10-08", "Guest E", "ok", "GBP", "180.00", "-27.00", "15%", "-2.52", "1.4%", "-", "2026-10-14", "PO-991"],
  ]);
  const report = readPayoutLines(file, "booking_com");
  assert.equal(report.error, undefined);
  assert.equal(report.used.net, "Net");
  assert.equal(report.used.commission, "Commission");
  assert.equal(report.used.paymentFee, "Payments Service Fee");
  assert.equal(report.used.gross, undefined, "a plain Amount is never read as gross or as money received");
  assert.deepEqual(report.skipped, { noCode: 0, noAmount: 2 });
  assert.deepEqual(report.lines, [{ ...blankLine, reference: "4172839560", amountMinor: 43472, commissionMinor: 7800, paymentFeeMinor: 728, paidOn: "2026-10-14", lineType: "Reservation", key: "4172839560|2026-10-14|reservation|43472|PO-991|1" }]);
  // The first net column with a value is used on each row.
  const two = readPayoutLines(csv([["Reservation number", "Net", "Payout amount", "Room sales"], ["111", "", "90.00", "100.00"], ["222", "45.00", "50.00", "60.00"]]), "booking_com");
  assert.deepEqual(two.lines.map(l => [l.reference, l.amountMinor, l.grossMinor]), [["111", 9000, 10000], ["222", 4500, 6000]]);
  assert.equal(two.lines[0].key, null, "no date and no payout reference: no key");
});

test("Vrbo (made-up export): reservation ID, net payout, fees and a code required on every line", () => {
  const file = csv([
    ["Reservation ID", "Property", "Check-in", "Check-out", "Guest", "Gross booking amount", "Host service fee", "Payment processing fee", "Payout amount", "Payout date", "Currency", "Payout ID"],
    ["HA-7KX2P9", "Harbour flat", "12/11/2026", "15/11/2026", "Guest F", "424.00", "-21.20", "-12.72", "390.08", "16/11/2026", "GBP", "VR-2026-118"],
    ["", "Harbour flat", "", "", "Adjustment", "", "", "", "-5.00", "16/11/2026", "GBP", "VR-2026-118"],
    ["ha-7kx2p9", "Harbour flat", "", "", "Guest F", "", "", "", "(10.00)", "20/11/2026", "GBP", "VR-2026-119"],
  ]);
  const report = readPayoutLines(file, "vrbo");
  assert.equal(report.error, undefined);
  assert.deepEqual(report.skipped, { noCode: 1, noAmount: 0 });
  assert.deepEqual(report.lines.map(l => [l.reference, l.amountMinor, l.grossMinor, l.commissionMinor, l.paymentFeeMinor, l.paidOn]), [
    ["HA-7KX2P9", 39008, 42400, 2120, 1272, "2026-11-16"],
    ["ha-7kx2p9", -1000, null, null, null, "2026-11-20"],
  ]);
  assert.equal(report.lines[0].key, "HA-7KX2P9|16-11-2026||39008|VR-2026-118|1");
  assert.match(readPayoutLines(file, "airbnb").error, /looks like a report from Vrbo/);
});

test("headers are matched ignoring case, spacing, punctuation and a (GBP) note", () => {
  const file = '  confirmation_CODE ,AMOUNT (GBP),date:,TYPE\nhmx1,"1,000",2026-10-01,reservation\n';
  const report = readPayoutLines(file, "airbnb");
  assert.equal(report.error, undefined);
  assert.deepEqual(report.used, { code: "confirmation_CODE", net: "AMOUNT (GBP)", date: "date:", type: "TYPE" });
  assert.deepEqual(report.lines.map(l => [l.reference, l.amountMinor, l.paidOn, l.lineType]), [["hmx1", 100000, "2026-10-01", "reservation"]]);
  // A short title above the header row is allowed.
  const titled = readPayoutLines("Payouts for October 2026\nReservation number,Payout amount\n123,10.00\n", "booking_com");
  assert.deepEqual(titled.lines.map(l => [l.reference, l.amountMinor]), [["123", 1000]]);
});

test("a file without a code or net column, or under the wrong platform, is refused by name", () => {
  const noNet = readPayoutLines("Confirmation code,Gross earnings,Date\nHM1,100.00,10/01/2026\n", "airbnb");
  assert.match(noNet.error, /net payout column/);
  assert.match(noNet.error, /"Amount"/);
  assert.deepEqual(noNet.lines, []);
  assert.match(readPayoutLines("Guest,Amount\nA,10.00\n", "airbnb").error, /reservation code column.*"Confirmation code"/);
  assert.match(readPayoutLines("Booking ID,Gross\nV1,10.00\n", "vrbo").error, /net payout column.*"Payout amount"/);
  assert.match(readPayoutLines("Reservation number,Payout amount\n4172839560,520.00\n", "airbnb").error, /looks like a report from Booking\.com\. Upload it under Booking\.com/);
  assert.match(readPayoutLines("Confirmation code,Amount\nHM1,1.00\n", "vrbo").error, /looks like a report from Airbnb/);
  assert.match(readPayoutLines("Reservation number\n", "booking_com").error, /no data rows/);
  assert.match(readPayoutLines("Reservation number,Net\n1,2\n", "expedia").error, /Choose Airbnb, Booking\.com or Vrbo/);
});

test("a report in another currency is refused, by its currency column or by a symbol on an amount", () => {
  const eur = readPayoutLines("Reservation number,Currency,Net\n1,GBP,10.00\n2,EUR,12.00\n", "booking_com");
  assert.match(eur.error, /EUR.*pounds sterling \(GBP\)/);
  assert.deepEqual(eur.lines, []);
  assert.match(readPayoutLines("Reservation ID,Payout amount\nV1,€12.00\n", "vrbo").error, /€/);
  assert.match(readPayoutLines("Reservation ID,Payout amount\nV1,USD 12.00\n", "vrbo").error, /USD/);
  // Other currency columns count too; GBP written any way is accepted.
  assert.match(readPayoutLines("Reservation number,Transaction currency,Payout currency,Net\n1,USD,GBP,10.00\n", "booking_com").error, /USD/);
  const gbp = readPayoutLines("Reservation number,Currency,Net\n1,gbp,10.00\n2,£,£1.00\n3,,2.00\n", "booking_com");
  assert.deepEqual(gbp.lines.map(l => l.amountMinor), [1000, 100, 200]);
});

test("European files: comma decimals, dot thousands, semicolons, day-first dates; mixed styles are refused", () => {
  const file = "Reservation ID;Payout amount;Commission;Payout date\nHA-1;1.234,56;-123,45;14.10.2026\nHA-2;12,5;0;03.10.2026\n";
  const report = readPayoutLines(file, "vrbo");
  assert.equal(report.error, undefined);
  assert.deepEqual(report.lines.map(l => [l.reference, l.amountMinor, l.commissionMinor, l.paidOn]), [["HA-1", 123456, 12345, "2026-10-14"], ["HA-2", 1250, 0, "2026-10-03"]]);
  const quoted = readPayoutLines('Reservation ID,Payout amount\nHA-3,"1.234,56"\nHA-4,"99,00"\n', "vrbo");
  assert.deepEqual(quoted.lines.map(l => l.amountMinor), [123456, 9900]);
  assert.match(readPayoutLines('Reservation ID,Payout amount\nHA-5,"1,234.50"\nHA-6,"12,50"\n', "vrbo").error, /two number styles/);
  // "1.234" alone could be either: it is not guessed.
  assert.match(readPayoutLines("Reservation ID,Payout amount\nHA-7,1.234\n", "vrbo").error, /Could not read the amount "1\.234" in "Payout amount" for HA-7/);
  assert.equal(parseMoneyMinor("1.234,56", true), 123456);
  assert.equal(parseMoneyMinor("1,234.56", true), null);
});

test("negative amounts: brackets, a leading or trailing minus, the minus sign, before or after the pound sign", () => {
  const file = csv([["Confirmation code", "Amount"], ["A", "(25.00)"], ["B", "-£3.50"], ["C", "£-3.50"], ["D", "\u22124.00"], ["E", "5.00-"], ["F", '"(£1,200.00)"'], ["G", "+7"], ["H", "0.00"], ["I", "'-1.00"]]);
  const report = readPayoutLines(file, "airbnb");
  assert.equal(report.error, undefined);
  // "'-1.00" is how a spreadsheet export (including Recharge's own example files) guards a leading minus.
  assert.deepEqual(report.lines.map(l => l.amountMinor), [-2500, -350, -350, -400, -500, -120000, 700, 0, -100]);
  assert.ok(!Object.is(report.lines[7].amountMinor, -0));
  assert.match(readPayoutLines(csv([["Confirmation code", "Amount"], ["A", "--5.00"]]), "airbnb").error, /Could not read the amount "--5\.00"/);
  assert.match(readPayoutLines(csv([["Confirmation code", "Amount"], ["A", "(-5.00)"]]), "airbnb").error, /Could not read/);
  assert.match(readPayoutLines(csv([["Confirmation code", "Amount", "Host fee"], ["A", "5.00", "lots"]]), "airbnb").error, /"lots" in "Host fee" for A/);
});

test("a BOM, CRLF endings and quoted fields with commas, quotes and line breaks are read", () => {
  const file = '\uFEFFConfirmation code,Guest,Details,Amount,Date\r\nHMQ1,"Smith, Jo","Two lines\r\nof ""notes""","1,000.00",10/01/2026\r\nHMQ2,"Lee, A","x",20.00,10/02/2026\r\n';
  const report = readPayoutLines(file, "airbnb");
  assert.equal(report.error, undefined);
  assert.equal(report.used.code, "Confirmation code");
  assert.deepEqual(report.lines.map(l => [l.reference, l.amountMinor, l.paidOn]), [["HMQ1", 100000, "2026-10-01"], ["HMQ2", 2000, "2026-10-02"]]);
  assert.deepEqual(parseCsv('a,"b\nc"\r\n1,2'), [["a", "b\nc"], ["1", "2"]]);
});

test("repeated codes stay separate lines with stable, distinct keys", () => {
  const rows = [
    ["Date", "Type", "Confirmation code", "Amount"],
    ["10/01/2026", "Reservation", "HMR1", "100.00"],
    ["10/03/2026", "Reversal", "HMR1", "-100.00"],
    ["10/04/2026", "Resolution Payout", "HMR1", "10.00"],
    ["10/04/2026", "Resolution Payout", "HMR1", "10.00"],
  ];
  const report = readPayoutLines(csv(rows), "airbnb");
  assert.deepEqual(report.lines.map(l => l.amountMinor), [10000, -10000, 1000, 1000]);
  assert.deepEqual(report.lines.map(l => l.key), [
    "HMR1|10-1-2026|reservation|10000||1", "HMR1|10-3-2026|reversal|-10000||1",
    "HMR1|10-4-2026|resolution payout|1000||1", "HMR1|10-4-2026|resolution payout|1000||2",
  ]);
  assert.deepEqual(readPayoutLines(csv(rows), "airbnb").lines.map(l => l.key), report.lines.map(l => l.key), "the same file gives the same keys");
  // A shorter report covering part of the same period gives the same keys for the lines it shares.
  const part = readPayoutLines(csv(rows.slice(0, 3)), "airbnb");
  assert.deepEqual(part.lines.map(l => l.key), report.lines.slice(0, 2).map(l => l.key));
  // The old reader still sums them per code.
  assert.deepEqual(readPayoutReport(csv(rows)).rows, [{ code: "HMR1", amountMinor: 2000, source: "Airbnb" }]);
});

test("keys do not change with harmless differences in how numbers, dates, case and quotes are written", () => {
  const a = readPayoutLines('Payout date,Type,Reservation number,Net,Payout ID\n2026-10-14,Reservation,4172839560,"1,000.00",po-991\n', "booking_com");
  const b = readPayoutLines("\uFEFFpayout date,type,reservation number,net,payout id\r\n2026-10-14 09:30:00,RESERVATION,4172839560,£1000,PO-991\r\n", "booking_com");
  const c = readPayoutLines("Reservation number;Net;Payout date;Type;Payout ID\n4172839560;1.000,00;2026-10-14;Reservation;PO-991\n", "booking_com");
  assert.equal(a.lines[0].key, "4172839560|2026-10-14|reservation|100000|PO-991|1");
  assert.equal(b.lines[0].key, a.lines[0].key);
  assert.equal(c.lines[0].key, a.lines[0].key);
  const d1 = readPayoutLines("Date,Confirmation code,Amount\n01/10/2026,HM1,5\n", "airbnb");
  const d2 = readPayoutLines("Date,Confirmation code,Amount\n1/10/2026,HM1,5.00\n", "airbnb");
  assert.equal(d1.lines[0].key, d2.lines[0].key);
});

test("day and month order follows the file, else the platform's usual order", () => {
  const read = (channel, header, dates) => readPayoutLines([header, ...dates.map((d, i) => `C${i},1.00,"${d}"`)].join("\n"), channel).lines.map(l => l.paidOn);
  assert.deepEqual(read("airbnb", "Confirmation code,Amount,Date", ["03/04/2026"]), ["2026-03-04"]);
  assert.deepEqual(read("airbnb", "Confirmation code,Amount,Date", ["03/04/2026", "25/04/2026"]), ["2026-04-03", "2026-04-25"]);
  assert.deepEqual(read("booking_com", "Reservation number,Net,Payout date", ["03/04/2026", "1 Oct 2026", "Oct 2, 2026", "2026-10-03T08:00:00Z"]), ["2026-04-03", "2026-10-01", "2026-10-02", "2026-10-03"]);
  assert.deepEqual(read("vrbo", "Reservation ID,Payout amount,Payout date", ["31/02/2026", "soon"]), [null, null]);
});

test("percentOfMinor rounds halves away from zero on whole pence", () => {
  assert.equal(percentOfMinor(100000, 1500), 15000);
  assert.equal(percentOfMinor(333, 1500), 50);
  assert.equal(percentOfMinor(-333, 1500), -50);
  assert.equal(percentOfMinor(10, 1250), 1);
  assert.equal(percentOfMinor(2, 2500), 1);
  assert.equal(percentOfMinor(-2, 2500), -1);
  assert.equal(percentOfMinor(24300, 2000), 4860);
  assert.ok(Object.is(percentOfMinor(-1, 1), 0));
  assert.throws(() => percentOfMinor(1.5, 1500), RangeError);
  assert.throws(() => percentOfMinor(100, 12.5), RangeError);
});
