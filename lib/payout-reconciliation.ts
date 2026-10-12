// Owner statements: read platform payout reports, reconcile them against reservations,
// then build a statement per property. Pure functions; no I/O.
import { formatCount, formatMoney } from "./format";
import { PAYOUT_CHANNEL_LABEL, PAYOUT_COLUMNS, PAYOUT_FIELDS, RECONCILED_CHANNELS, headerKey, isPayoutChannel, type PayoutChannel, type PayoutField } from "./payout-report-formats";

export { RECONCILED_CHANNELS, type PayoutChannel } from "./payout-report-formats";
export type PayoutRow = { code: string; amountMinor: number; source: "Airbnb" | "Booking.com" | "Vrbo" | "Unknown" };
export type ExpectedPayout = { code: string; amountMinor: number; propertyId: string; guest: string; channel: string };
export type MatchStatus = "matched" | "different" | "missing" | "unexpected";
export type MatchRow = { code: string; status: MatchStatus; expectedMinor: number | null; receivedMinor: number | null; propertyId: string | null; guest: string | null; channel: string };

// One line of a payout report, as sent to the database. `reference` is the platform's reservation
// code and `amountMinor` the signed net amount paid for the line (never the gross). Fees are positive.
// `key` tells a line already held from a new one when report periods overlap; null when the file has
// neither a date nor a payout reference column, so nothing can be told apart.
export type PayoutLine = {
  reference: string; amountMinor: number; grossMinor: number | null; commissionMinor: number | null; hostFeeMinor: number | null;
  paymentFeeMinor: number | null; cleaningFeeMinor: number | null; paidOn: string | null; lineType: string | null; key: string | null;
};
// The bank transfer check, for files that list each transfer (Airbnb's "Payout" rows, with the amount in "Paid out").
// Transfers and coded lines are grouped by their date: a date is matched when the transfers on it add up exactly to
// the net of the coded lines on it. `linesWithoutTransfer` counts coded lines on a date with no transfer in the file
// (for example lines not paid out yet). Null when the file has no transfer rows (Booking.com and Vrbo files today).
export type TransferMismatch = { date: string; paidOutMinor: number; linesMinor: number };
export type TransferCheck = { checked: number; matched: number; mismatches: TransferMismatch[]; linesWithoutTransfer: number };
export type PayoutLinesReport = { lines: PayoutLine[]; used: Record<string, string>; skipped: { noCode: number; noAmount: number }; transfers: TransferCheck | null; error?: string };

// The largest payout report accepted: characters in the file and coded lines in it (a year of a larger portfolio; a
// real Airbnb year for one portfolio was about 406,000 characters and 2,066 lines). The database takes the same number
// of lines (up to 4 MiB of them), and the finance route reads a request body of up to PAYOUT_UPLOAD_BODY_LIMIT bytes
// for the finance roles, which leaves room for the quotes and line breaks a CSV gains when sent as JSON.
export const MAX_PAYOUT_CSV_CHARS = 2_000_000;
export const MAX_PAYOUT_LINES = 8000;
export const PAYOUT_UPLOAD_BODY_LIMIT = 2_600_000;
// Whether a file fits one upload: its characters, and the bytes it takes as JSON (quotes and line breaks are escaped,
// letters such as "é" take two bytes or more), with room for the rest of the request.
export function fitsPayoutUpload(csv: string): boolean {
  if (csv.length > MAX_PAYOUT_CSV_CHARS) return false;
  const json = JSON.stringify(csv);
  let bytes = 1024;
  for (let i = 0; i < json.length; i++) {
    const unit = json.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes <= PAYOUT_UPLOAD_BODY_LIMIT;
}

// RFC 4180-style CSV: quoted fields (with commas, quotes and line breaks inside), CRLF or LF, a leading BOM.
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(field); field = ""; }
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

// --- Money. Amounts become whole pence by reading the digits, never through floating point.
type MoneyParts = { kind: "parts"; negative: boolean; body: string } | { kind: "blank" } | { kind: "bad" } | { kind: "foreign"; currency: string };
type Money = { kind: "ok"; minor: number } | { kind: "blank" } | { kind: "bad" } | { kind: "foreign"; currency: string };
const DASHES = /[\u2012\u2013\u2014\u2212]/g;
// Cells that mean "nothing here": a lone dash, n/a, none.
const PLACEHOLDER = /^(?:[-\u2012\u2013\u2014\u2212]|n\/?a|none|nil)$/i;
const MONEY = /^([+-]?)(£|gbp)?([+-]?)(\d[\d.,]*|[.,]\d+)(£|gbp)?(-?)$/i;
const FOREIGN_SYMBOL = /[€$¥₹₩₽]/;
const FOREIGN_CODE = /(?:^|[^a-z])(EUR|USD|AUD|CAD|CHF|NZD|SEK|NOK|DKK|PLN|CZK|HUF|JPY|CNY|HKD|SGD|ZAR|AED|INR|MXN|BRL|TRY|ILS)(?![a-z])/i;
const UK_BODY = /^(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d{1,2}))?$/;
const EU_BODY = /^(\d{1,3}(?:\.\d{3})+|\d+)?(?:,(\d{1,2}))?$/;

function moneyParts(raw: string): MoneyParts {
  // A leading apostrophe is a spreadsheet's guard against formulas ("'-12.60"), not part of the amount.
  let text = raw.normalize("NFKC").replace(/\s+/g, "").replace(/^'/, "");
  if (!text || PLACEHOLDER.test(text)) return { kind: "blank" };
  const foreign = FOREIGN_SYMBOL.exec(text)?.[0] ?? FOREIGN_CODE.exec(text)?.[1]?.toUpperCase();
  if (foreign) return { kind: "foreign", currency: foreign };
  text = text.replace(DASHES, "-");
  let parens = false;
  if (text.startsWith("(") && text.endsWith(")")) { parens = true; text = text.slice(1, -1); }
  const match = MONEY.exec(text);
  if (!match) return { kind: "bad" };
  const signs = match[1] + match[3] + match[6];
  if (signs.length > 1 || (parens && signs)) return { kind: "bad" };
  return { kind: "parts", negative: parens || signs === "-", body: match[4] };
}

function readMoney(raw: string, european: boolean): Money {
  const parts = moneyParts(raw);
  if (parts.kind !== "parts") return parts;
  const match = (european ? EU_BODY : UK_BODY).exec(parts.body);
  if (!match || (match[1] === undefined && match[2] === undefined)) return { kind: "bad" };
  const whole = (match[1] ?? "").replace(/[.,]/g, "");
  if (whole.length > 12) return { kind: "bad" };
  const minor = Number(whole || "0") * 100 + Number(((match[2] ?? "") + "00").slice(0, 2));
  return { kind: "ok", minor: parts.negative && minor ? -minor : minor };
}

// "1,234.50", "1,234" and "12.50" are written the UK way; "1.234,50", "1.234.567" and "12,50" the
// European way. Whole numbers ("460") say nothing, and nor does "1.234": it is refused as unreadable
// unless the rest of the file shows it is European.
function numberStyle(raw: string): "uk" | "eu" | null {
  const parts = moneyParts(raw);
  if (parts.kind !== "parts") return null;
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(parts.body) || /^\d*\.\d{1,2}$/.test(parts.body)) return "uk";
  if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(parts.body) || /^\d{1,3}(?:\.\d{3}){2,}$/.test(parts.body) || /^\d*,\d{1,2}$/.test(parts.body)) return "eu";
  return null;
}

// "£1,234.50", "-12.00", "(12.00)", "GBP 12" -> minor units. Null for a blank cell or anything unreadable.
// European files ("1.234,50") are read with `european` set.
export function parseMoneyMinor(value: string, european = false): number | null {
  const money = readMoney(value, european);
  return money.kind === "ok" ? money.minor : null;
}

// fee = round(minor x bps / 10000), halves rounded away from zero. Whole pence and basis points only.
export function percentOfMinor(minor: number, bps: number): number {
  if (!Number.isSafeInteger(minor) || !Number.isSafeInteger(bps)) throw new RangeError("Use whole pence and whole basis points");
  const product = minor * bps;
  if (!Number.isSafeInteger(product)) throw new RangeError("Amount too large");
  const size = Math.abs(product), whole = Math.floor(size / 10000);
  const rounded = whole + ((size - whole * 10000) * 2 >= 10000 ? 1 : 0);
  return product < 0 && rounded ? -rounded : rounded;
}

// --- Dates. `paidOn` is an ISO day when the cell can be read; "03/04/2026" is read the way the
// rest of the file shows (a day above 12), else Airbnb's month-first and the others' day-first.
type DayOrder = "dmy" | "mdy";
const ISO_DAY = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/;
const NUMERIC_DAY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const dayText = (text: string) => text.trim().toLowerCase().replace(/(?:t|\s+)\d{1,2}:\d{2}.*$/, "");
const monthOf = (word: string) => word.length >= 3 ? MONTHS.indexOf(word.slice(0, 3)) + 1 : 0;
function isoDay(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : null;
}
function dayOrder(cells: string[], channel: PayoutChannel): DayOrder | null {
  let dayFirst = false, monthFirst = false;
  for (const cell of cells) {
    const match = NUMERIC_DAY.exec(dayText(cell));
    if (!match) continue;
    if (Number(match[1]) > 12) dayFirst = true;
    if (Number(match[2]) > 12) monthFirst = true;
  }
  if (dayFirst && monthFirst) return null;
  return dayFirst ? "dmy" : monthFirst ? "mdy" : channel === "airbnb" ? "mdy" : "dmy";
}
function readDay(text: string, order: DayOrder | null): string | null {
  const t = dayText(text);
  let match = ISO_DAY.exec(t);
  if (match) return isoDay(Number(match[1]), Number(match[2]), Number(match[3]));
  match = NUMERIC_DAY.exec(t);
  if (match) {
    const a = Number(match[1]), b = Number(match[2]), year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    const use = a > 12 ? "dmy" : b > 12 ? "mdy" : order;
    return use === "dmy" ? isoDay(year, b, a) : use === "mdy" ? isoDay(year, a, b) : null;
  }
  match = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]*([a-z]+)\.?[\s,-]*(\d{4})$/.exec(t);
  if (match) return isoDay(Number(match[3]), monthOf(match[2]), Number(match[1]));
  match = /^([a-z]+)\.?[\s-]*(\d{1,2})(?:st|nd|rd|th)?,?[\s-]*(\d{4})$/.exec(t);
  if (match) return isoDay(Number(match[3]), monthOf(match[1]), Number(match[2]));
  return null;
}
// The date as written, for the line key: the same cell always gives the same key, whichever way
// the rest of the file makes it read. Times and leading zeros are left out.
const dayKey = (text: string) => dayText(text).split(/[^a-z0-9]+/).filter(Boolean).map(part => /^\d+$/.test(part) ? String(Number(part)) : part).join("-");

// --- Finding the columns. Exports are comma separated; European ones may use semicolons or tabs,
// or start with Excel's "sep=;" line. A short title above the header row is allowed.
const DELIMITERS = [",", ";", "\t"];
const HEADER_SEARCH_ROWS = 20;
type Columns = Record<PayoutField, number[]>;
type Located = { table: string[][]; headerIndex: number; columns: Columns };

function readTables(csv: string): string[][][] {
  const text = csv.replace(/^\uFEFF/, "");
  const sep = /^sep=(.)\r?\n/i.exec(text);
  return sep ? [parseCsv(text.slice(sep[0].length), sep[1])] : DELIMITERS.map(delimiter => parseCsv(text, delimiter));
}
function columnsFor(header: string[], channel: PayoutChannel): Columns {
  const keys = header.map(headerKey);
  const columns = {} as Columns;
  for (const field of PAYOUT_FIELDS) {
    const found: number[] = [];
    for (const alias of PAYOUT_COLUMNS[channel][field]) {
      const wanted = headerKey(alias);
      keys.forEach((key, index) => { if (key === wanted && !found.includes(index)) found.push(index); });
    }
    columns[field] = found;
  }
  return columns;
}
function findHeader(tables: string[][][], channel: PayoutChannel, need: PayoutField[]): Located | null {
  for (const table of tables) {
    for (let index = 0; index < Math.min(table.length, HEADER_SEARCH_ROWS); index++) {
      const columns = columnsFor(table[index], channel);
      if (need.every(field => columns[field].length)) return { table, headerIndex: index, columns };
    }
  }
  return null;
}
const named = (headers: readonly string[]) => {
  const list = headers.slice(0, 3).map(header => `"${header}"`);
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} or ${list[list.length - 1]}` : list[0] ?? "";
};
const MONEY_FIELDS = ["net", "gross", "commission", "hostFee", "paymentFee", "cleaningFee"] as const;
// Rows that record a bank transfer, not a line: no reservation code, this type, and the amount sent to the bank in
// one of these columns. Only Airbnb files list transfers; add a platform here when its export does.
const TRANSFER_ROWS: Partial<Record<PayoutChannel, { types: readonly string[]; paidOut: readonly string[] }>> = {
  airbnb: { types: ["Payout"], paidOut: ["Paid out"] },
};
const isPounds = (value: string) => /^(?:gbp|£|gbp£|£gbp|sterling|poundsterling|poundssterling|britishpounds?)$/.test(value.toLowerCase().replace(/[\s.]+/g, ""));
class ReportError extends Error {}

// Which platform a file comes from, by its headers. Null when it matches none.
export function detectPayoutChannel(csv: string): PayoutChannel | null {
  const tables = readTables(csv);
  return RECONCILED_CHANNELS.find(channel => findHeader(tables, channel, ["code", "net"])) ?? null;
}

// Reads one platform's payout export into lines. Every row with a reservation code and a net amount
// becomes a line, in file order: adjustments and reversals of a stay are separate lines with their own
// signed amount. Rows without a code (Airbnb's bank transfer lines, totals) and coded rows without a
// net amount are counted in `skipped`. The whole file is refused, with a reason, when it has no code
// or net column, an amount in another currency, a mix of UK and European number styles, or an amount
// that cannot be read.
export function readPayoutLines(csv: string, channel: PayoutChannel): PayoutLinesReport {
  const used: Record<string, string> = {}, skipped = { noCode: 0, noAmount: 0 };
  const fail = (error: string): PayoutLinesReport => ({ lines: [], used: {}, skipped: { noCode: 0, noAmount: 0 }, transfers: null, error });
  if (!isPayoutChannel(channel)) return fail("Choose Airbnb, Booking.com or Vrbo.");
  const label = PAYOUT_CHANNEL_LABEL[channel];
  const tables = readTables(csv);
  if (!tables.some(table => table.length >= 2)) return fail("The file has no data rows.");
  const found = findHeader(tables, channel, ["code", "net"]);
  if (!found) {
    const other = RECONCILED_CHANNELS.find(c => c !== channel && findHeader(tables, c, ["code", "net"]));
    if (other) return fail(`This looks like a report from ${PAYOUT_CHANNEL_LABEL[other]}. Upload it under ${PAYOUT_CHANNEL_LABEL[other]}.`);
    if (!findHeader(tables, channel, ["code"])) return fail(`Could not find the reservation code column. ${label} reports call it ${named(PAYOUT_COLUMNS[channel].code)}.`);
    return fail(`Could not find the net payout column, the amount paid out for each line. ${label} reports call it ${named(PAYOUT_COLUMNS[channel].net)}.`);
  }
  const { table, headerIndex, columns } = found;
  const header = table[headerIndex].map(cell => cell.trim());
  const rows = table.slice(headerIndex + 1);
  if (!rows.length) return fail("The file has no data rows.");
  for (const field of PAYOUT_FIELDS) if (columns[field].length) used[field] = columns[field].map(index => header[index]).join(", ");
  const cell = (row: string[], index: number) => (row[index] ?? "").trim();
  const first = (row: string[], field: PayoutField) => {
    for (const index of columns[field]) {
      const value = cell(row, index);
      if (value && !PLACEHOLDER.test(value)) return { value, header: header[index] };
    }
    return null;
  };

  // The whole file first: its currency and the way its numbers are written.
  for (const row of rows) for (const index of columns.currency) {
    const value = cell(row, index);
    if (value && !PLACEHOLDER.test(value) && !isPounds(value)) return fail(`This report has amounts in ${value.slice(0, 12)}. Only reports in pounds sterling (GBP) can be reconciled.`);
  }
  let uk = false, eu = false;
  for (const row of rows) for (const field of MONEY_FIELDS) for (const index of columns[field]) {
    const value = cell(row, index), parts = moneyParts(value);
    if (parts.kind === "foreign") return fail(`This report has amounts in ${parts.currency}. Only reports in pounds sterling (GBP) can be reconciled.`);
    const style = numberStyle(value);
    if (style === "uk") uk = true;
    if (style === "eu") eu = true;
  }
  if (uk && eu) return fail("The amounts are written in two number styles (1,234.50 and 1.234,50). Download the report again and upload it unchanged.");
  const european = eu;
  const order = dayOrder(rows.flatMap(row => columns.date.map(index => cell(row, index))), channel);
  const keyed = columns.date.length > 0 || columns.payoutRef.length > 0;

  const amount = (source: { value: string; header: string }, code: string) => {
    const money = readMoney(source.value, european);
    if (money.kind === "ok") return money.minor;
    throw new ReportError(`Could not read the amount "${source.value.slice(0, 30)}" in "${source.header}" for ${code}.`);
  };
  const lines: PayoutLine[] = [];
  const occurrences = new Map<string, number>();
  // The bank transfer check: transfers and coded lines added up by date (an unreadable date keeps its own text).
  const transferRows = TRANSFER_ROWS[channel];
  const transferTypes = new Set(transferRows?.types.map(headerKey) ?? []);
  const paidOutColumns = transferRows ? header.flatMap((text, index) => transferRows.paidOut.some(alias => headerKey(alias) === headerKey(text)) ? [index] : []) : [];
  const transferDay = (text: string) => readDay(text, order) ?? dayText(text);
  const paidOutByDay = new Map<string, number>(), linesByDay = new Map<string, { minor: number; count: number }>();
  const transferOf = (row: string[]) => {
    const type = first(row, "type")?.value;
    if (!type || !transferTypes.has(headerKey(type))) return null;
    for (const index of paidOutColumns) {
      const value = cell(row, index);
      if (!value || PLACEHOLDER.test(value)) continue;
      const money = readMoney(value, european);
      return money.kind === "ok" ? money.minor : null;
    }
    return null;
  };
  try {
    for (const row of rows) {
      const code = first(row, "code")?.value ?? "";
      if (!code) {
        skipped.noCode++;
        const paidOut = transferRows ? transferOf(row) : null;
        if (paidOut !== null) { const day = transferDay(first(row, "date")?.value ?? ""); paidOutByDay.set(day, (paidOutByDay.get(day) ?? 0) + paidOut); }
        continue;
      }
      if (code.length > 120) return fail("A reservation code is longer than 120 characters. Check the file is a payout report.");
      const net = first(row, "net");
      if (!net) { skipped.noAmount++; continue; }
      const amountMinor = amount(net, code);
      const optional = (field: PayoutField, fee: boolean) => {
        const value = first(row, field);
        if (!value) return null;
        const minor = amount(value, code);
        return fee ? Math.abs(minor) : minor;
      };
      const date = first(row, "date")?.value ?? "";
      const lineType = first(row, "type")?.value.replace(/\s+/g, " ").slice(0, 60) ?? null;
      const payoutRef = first(row, "payoutRef")?.value ?? "";
      let key: string | null = null;
      if (keyed) {
        // At most 300 characters in all (the database's limit): code 120, date 30, type 40, reference 60.
        const part = (text: string, size: number) => text.replace(/\|/g, "/").slice(0, size);
        const base = [part(code.toUpperCase(), 120), part(dayKey(date), 30), part((lineType ?? "").toLowerCase(), 40), String(amountMinor), part(payoutRef.toUpperCase().replace(/\s+/g, ""), 60)].join("|");
        const occurrence = (occurrences.get(base) ?? 0) + 1;
        occurrences.set(base, occurrence);
        key = `${base}|${occurrence}`;
      }
      lines.push({
        reference: code, amountMinor, grossMinor: optional("gross", false), commissionMinor: optional("commission", true), hostFeeMinor: optional("hostFee", true),
        paymentFeeMinor: optional("paymentFee", true), cleaningFeeMinor: optional("cleaningFee", true), paidOn: date ? readDay(date, order) : null, lineType, key,
      });
      if (transferRows) {
        const day = transferDay(date), sum = linesByDay.get(day) ?? { minor: 0, count: 0 };
        linesByDay.set(day, { minor: sum.minor + amountMinor, count: sum.count + 1 });
      }
    }
  } catch (error) {
    if (error instanceof ReportError) return fail(error.message);
    throw error;
  }
  let transfers: TransferCheck | null = null;
  if (paidOutByDay.size) {
    const days = [...paidOutByDay.keys()].sort();
    const mismatches = days.flatMap(date => {
      const paidOutMinor = paidOutByDay.get(date) ?? 0, linesMinor = linesByDay.get(date)?.minor ?? 0;
      return paidOutMinor === linesMinor ? [] : [{ date, paidOutMinor, linesMinor }];
    });
    let linesWithoutTransfer = 0;
    for (const [day, sum] of linesByDay) if (!paidOutByDay.has(day)) linesWithoutTransfer += sum.count;
    transfers = { checked: days.length, matched: days.length - mismatches.length, mismatches, linesWithoutTransfer };
  }
  return { lines, used, skipped, transfers };
}

// Words for the bank transfer check, for the upload summary: one sentence, then up to `shown` dates that do not add up
// (the difference is the transfer less the lines). A difference never stops an upload; it only tells staff to look.
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDay = (date: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${Number(match[3])} ${SHORT_MONTHS[Number(match[2]) - 1]} ${match[1]}` : date || "No date";
};
export function transferSummary(transfers: TransferCheck | null, shown = 3): { text: string; details: string[]; allMatched: boolean } | null {
  if (!transfers || !transfers.checked) return null;
  const { checked, mismatches, linesWithoutTransfer } = transfers, off = mismatches.length;
  const dates = (n: number) => `${formatCount(n)} payout date${n === 1 ? "" : "s"}`;
  const text = !off
    ? (checked === 1 ? "The 1 payout date adds up to the bank transfer." : `All ${dates(checked)} add up to the bank transfers.`)
    : `${formatCount(off)} of ${dates(checked)} ${off === 1 ? "does" : "do"} not add up to the bank transfer.`;
  const details = mismatches.slice(0, shown).map(m => `${shortDay(m.date)}: transfer ${formatMoney(m.paidOutMinor)}, lines ${formatMoney(m.linesMinor)}, difference ${formatMoney(m.paidOutMinor - m.linesMinor)}`);
  if (off > shown) details.push(`And ${dates(off - shown)} more.`);
  if (linesWithoutTransfer) details.push(`${formatCount(linesWithoutTransfer)} line${linesWithoutTransfer === 1 ? " has" : "s have"} no bank transfer in this file yet.`);
  return { text, details, allMatched: !off };
}

const SOURCE: Record<PayoutChannel, PayoutRow["source"]> = { airbnb: "Airbnb", booking_com: "Booking.com", vrbo: "Vrbo" };
// The older reader: works out the platform from the headers and gives one total per reservation code
// (an adjustment adds to its stay). Kept for the example files and the sample screens; uploads use
// readPayoutLines, which keeps every line.
export function readPayoutReport(text: string): { rows: PayoutRow[]; source: PayoutRow["source"]; error?: string } {
  const channel = detectPayoutChannel(text);
  if (!channel) {
    const tables = readTables(text);
    return { rows: [], source: "Unknown", error: tables.some(table => table.length >= 2) ? "Could not find the reservation code and amount columns." : "The file has no data rows." };
  }
  const report = readPayoutLines(text, channel);
  if (report.error) return { rows: [], source: SOURCE[channel], error: report.error };
  // Codes are case-insensitive; the first spelling seen is kept for display.
  const totals = new Map<string, { code: string; amountMinor: number }>();
  for (const line of report.lines) {
    const entry = totals.get(line.reference.toUpperCase()) ?? { code: line.reference, amountMinor: 0 };
    entry.amountMinor += line.amountMinor;
    totals.set(line.reference.toUpperCase(), entry);
  }
  return { rows: [...totals.values()].map(({ code, amountMinor }) => ({ code, amountMinor, source: SOURCE[channel] })), source: SOURCE[channel] };
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
