// Owner statements: reconcile platform payout reports against reservations,
// then build a statement per property. Pure functions; no I/O.

export type PayoutRow = { code: string; amountMinor: number; source: "Airbnb" | "Booking.com" | "Unknown" };
export type ExpectedPayout = { code: string; amountMinor: number; propertyId: string; guest: string; channel: string };
export type MatchStatus = "matched" | "different" | "missing" | "unexpected";
export type MatchRow = { code: string; status: MatchStatus; expectedMinor: number | null; receivedMinor: number | null; propertyId: string | null; guest: string | null; channel: string };

// RFC 4180-style CSV: quoted fields, escaped quotes, CRLF or LF.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(cell => cell.trim() !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some(cell => cell.trim() !== "")) rows.push(row);
  return rows;
}

// "£1,234.50", "-12.00", "(12.00)" -> minor units. Returns null for anything else.
export function parseMoneyMinor(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const negative = /^\(.*\)$/.test(trimmed) || trimmed.startsWith("-");
  const digits = trimmed.replace(/[()£$€\s,-]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(digits)) return null;
  const [whole, fraction = ""] = digits.split(".");
  const minor = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return negative ? -minor : minor;
}

const CODE_HEADERS = ["confirmation code", "reservation code", "reservation number", "booking number", "reference number", "reference"];
const AMOUNT_HEADERS = ["payout amount", "net amount", "amount", "paid out", "payout", "net", "total payout"];

// Reads an Airbnb or Booking.com payout export. Rows without a reservation
// code (for example Airbnb's "Payout" summary lines) are ignored.
export function readPayoutReport(text: string): { rows: PayoutRow[]; source: PayoutRow["source"]; error?: string } {
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], source: "Unknown", error: "The file has no data rows." };
  const headers = table[0].map(header => header.trim().toLowerCase());
  const codeIndex = CODE_HEADERS.map(name => headers.indexOf(name)).find(index => index >= 0) ?? -1;
  const amountIndex = AMOUNT_HEADERS.map(name => headers.indexOf(name)).find(index => index >= 0) ?? -1;
  if (codeIndex < 0 || amountIndex < 0) return { rows: [], source: "Unknown", error: "Could not find the reservation code and amount columns." };
  const source: PayoutRow["source"] = headers.includes("confirmation code") ? "Airbnb" : headers.includes("reservation number") ? "Booking.com" : "Unknown";
  const totals = new Map<string, number>();
  for (const line of table.slice(1)) {
    const code = (line[codeIndex] ?? "").trim();
    const amount = parseMoneyMinor(line[amountIndex] ?? "");
    if (!code || amount === null) continue;
    totals.set(code, (totals.get(code) ?? 0) + amount);
  }
  return { rows: [...totals].map(([code, amountMinor]) => ({ code, amountMinor, source })), source };
}

export function reconcile(expected: ExpectedPayout[], received: PayoutRow[], tolerancePence = 0): MatchRow[] {
  const byCode = new Map(received.map(row => [row.code.toUpperCase(), row]));
  const seen = new Set<string>();
  const rows: MatchRow[] = expected.map(item => {
    const key = item.code.toUpperCase();
    const got = byCode.get(key);
    if (got) seen.add(key);
    const status: MatchStatus = !got ? "missing" : Math.abs(got.amountMinor - item.amountMinor) <= tolerancePence ? "matched" : "different";
    return { code: item.code, status, expectedMinor: item.amountMinor, receivedMinor: got?.amountMinor ?? null, propertyId: item.propertyId, guest: item.guest, channel: item.channel };
  });
  for (const row of received) {
    if (!seen.has(row.code.toUpperCase())) rows.push({ code: row.code, status: "unexpected", expectedMinor: null, receivedMinor: row.amountMinor, propertyId: null, guest: null, channel: row.source });
  }
  return rows;
}

export type StatementLine = { label: string; amountMinor: number };
// Revenue received, less cleaning, expenses and the management fee, equals
// the amount paid to the owner. The fee is charged on gross revenue.
export function ownerStatement(input: { revenueMinor: number; cleaningMinor: number; expensesMinor: number; managementFeeBps: number }) {
  const feeMinor = Math.round(input.revenueMinor * input.managementFeeBps / 10000);
  const payoutMinor = input.revenueMinor - input.cleaningMinor - input.expensesMinor - feeMinor;
  return {
    lines: [
      { label: "Revenue received", amountMinor: input.revenueMinor },
      { label: "Cleaning", amountMinor: -input.cleaningMinor },
      { label: "Repairs and expenses", amountMinor: -input.expensesMinor },
      { label: `Management fee (${input.managementFeeBps / 100}%)`, amountMinor: -feeMinor },
    ] as StatementLine[],
    feeMinor,
    payoutMinor,
  };
}
