import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { parseCsv, parseMoneyMinor, readPayoutReport, reconcile, ownerStatement } = await vite.ssrLoadModule("/lib/payout-reconciliation.ts");

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
