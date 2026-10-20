import { z } from 'zod';
import { brandCanvas, darkBrandCanvas, depthTokens, designTokens } from './design-tokens';
import { legalDetails } from './legal-details';
import { londonClock, minutesLabel } from './team-time';
import { NOT_CLOCKED_OUT, OPEN_SHIFT_LIMIT_HOURS, ukDayOf } from './shift-hours';
import type { TimesheetPerson } from './workspace-teams-policy';

// VA pay and the monthly Request for Invoice (migration 20261022200000). A VA (the admin and Stays team) is paid by the
// hour in US dollars, plus a bonus for the highest KPI tier they reach. On the 1st of each month Recharge makes one
// Request for Invoice per VA for the month just ended ("please invoice us for this amount"), numbered RC-VA-YYYY-NNNN.
// Management approves it, queries it, adjusts the hours or the bonus with a reason, rejects it, and marks it paid. The VA
// sees only their own, read only, and downloads the document. This file holds the shapes the database returns, the
// requests the screens send, the management groupings, and the document (one view model drawn by the app and by the
// HTML page). It copies the look of the cleaner invoice (lib/cleaner-invoices.ts) without depending on it.

const id = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const VA_REQUEST_STATUSES = ['to_approve', 'approved', 'paid', 'rejected'] as const;
export type VaRequestStatus = (typeof VA_REQUEST_STATUSES)[number];
export const VA_TIERS = ['target', 'tier2', 'tier3'] as const;
export type VaTier = (typeof VA_TIERS)[number];
// The tier reached, in words. The KPI tracker's target is the first tier; the two beyond it are tiers 2 and 3.
export const TIER_LABEL: Record<VaTier, string> = { target: 'Target', tier2: 'Tier 2', tier3: 'Tier 3' };

export const vaPayAccessSchema = z.object({ canManage: z.boolean(), isVa: z.boolean() });
export type VaPayAccess = z.infer<typeof vaPayAccessSchema>;

const changeSchema = z.object({ change: z.enum(['issued', 'queried', 'adjusted', 'approved', 'rejected', 'paid']), reason: z.string().nullable(), changedAt: z.string(), changedByName: z.string().nullable() });
export const vaRequestSchema = z.object({
  id, number: z.string(), vaId: id, vaName: z.string(), area: z.string().nullable(), periodStart: day, periodEnd: day,
  status: z.enum(VA_REQUEST_STATUSES), queried: z.boolean(), queryNote: z.string().nullable(), queriedAt: z.string().nullable(),
  issueOn: day, dueOn: day, approvedAt: z.string().nullable(), paidOn: day.nullable(), rejectNote: z.string().nullable(), currency: z.literal('USD'),
  hourlyRateMinor: z.number().int(), workedMinutes: z.number().int(), hoursAdjustMinutes: z.number().int(), hoursAdjustReason: z.string().nullable(),
  minutes: z.number().int(), hoursMinor: z.number().int(),
  kpiName: z.string().nullable(), kpiValue: z.number().int().nullable(), kpiTier: z.enum(VA_TIERS).nullable(),
  bonusAutoMinor: z.number().int(), bonusAdjusted: z.boolean(), bonusAdjustReason: z.string().nullable(), bonusMinor: z.number().int(), totalMinor: z.number().int(),
  version: z.number().int(), own: z.boolean(),
  days: z.array(z.object({ day, minutes: z.number().int() })).optional(),
  changes: z.array(changeSchema).optional(),
});
export type VaRequest = z.infer<typeof vaRequestSchema>;
export const vaRequestsSchema = z.array(vaRequestSchema);

export const vaPaySetupSchema = z.object({
  canEdit: z.boolean(), currency: z.literal('USD'),
  vas: z.array(z.object({
    userId: id, fullName: z.string().nullable(), role: z.string(), area: z.string().nullable(), active: z.boolean(), own: z.boolean(),
    hourlyRateMinor: z.number().int().nullable(), bonusTargetMinor: z.number().int(), bonusTier2Minor: z.number().int(), bonusTier3Minor: z.number().int(),
    version: z.number().int(), updatedAt: z.string().nullable(), updatedByName: z.string().nullable(),
  })),
  bonusKpis: z.array(z.object({ area: z.string(), kpiId: id, name: z.string(), direction: z.enum(['higher', 'lower']), targetPercent: z.number().int().nullable(), bonusTiers: z.array(z.number().int()), placeholder: z.boolean() })),
  history: z.array(z.object({ userId: id, fullName: z.string().nullable(), before: z.record(z.string(), z.unknown()).nullable(), after: z.record(z.string(), z.unknown()), changedAt: z.string(), changedByName: z.string().nullable() })),
});
export type VaPaySetup = z.infer<typeof vaPaySetupSchema>;
export type VaPayRow = VaPaySetup['vas'][number];

// The reads (through the Team route, lib/workspace-finance-server.ts) and the requests the screens send.
export const VA_PAY_READ_SECTIONS = { vaPayAccess: 'access', vaPayRequests: 'requests', vaPayRequest: 'request', vaPaySetup: 'setup' } as const;
export const vaPayAccessQuery = () => ({ section: 'vaPayAccess' });
export const vaRequestsQuery = (vaId?: string) => ({ section: 'vaPayRequests', ...(vaId ? { userId: vaId } : {}) });
export const vaRequestQuery = (requestId: string) => ({ section: 'vaPayRequest', invoiceId: requestId });
export const vaPaySetupQuery = () => ({ section: 'vaPaySetup' });
type Ref = Pick<VaRequest, 'id' | 'version'>;
export const saveVaPayAction = (i: { requestId: string; vaId: string; version: number; hourlyRateMinor: number | null; bonusTargetMinor: number; bonusTier2Minor: number; bonusTier3Minor: number }) =>
  ({ action: 'saveVaPay' as const, requestId: i.requestId, vaId: i.vaId, version: i.version, hourlyRateMinor: i.hourlyRateMinor, bonusTargetMinor: i.bonusTargetMinor, bonusTier2Minor: i.bonusTier2Minor, bonusTier3Minor: i.bonusTier3Minor });
export const issueVaAction = (i: { requestId: string; vaId: string; month: string; version: number }) =>
  ({ action: 'issueVaRequest' as const, requestId: i.requestId, vaId: i.vaId, month: i.month, version: i.version });
export const approveVaAction = (i: { requestId: string; request: Ref }) => ({ action: 'approveVaRequest' as const, requestId: i.requestId, id: i.request.id, version: i.request.version });
export const queryVaAction = (i: { requestId: string; request: Ref; note: string }) => ({ action: 'queryVaRequest' as const, requestId: i.requestId, id: i.request.id, version: i.request.version, note: i.note.trim() });
export const rejectVaAction = (i: { requestId: string; request: Ref; note: string }) => ({ action: 'rejectVaRequest' as const, requestId: i.requestId, id: i.request.id, version: i.request.version, note: i.note.trim() });
// Only the parts given change: an hours correction in minutes (0 clears it) and/or the bonus in cents (null puts back the KPI's).
export const adjustVaAction = (i: { requestId: string; request: Ref; reason: string; hoursAdjustMinutes?: number; bonusMinor?: number | null }) => ({
  action: 'adjustVaRequest' as const, requestId: i.requestId, id: i.request.id, version: i.request.version, reason: i.reason.trim(),
  ...(i.hoursAdjustMinutes !== undefined ? { hoursAdjustMinutes: i.hoursAdjustMinutes } : {}), ...(i.bonusMinor !== undefined ? { bonusMinor: i.bonusMinor } : {}),
});
export const markVaPaidAction = (i: { requestId: string; request: Ref; paidOn: string }) => ({ action: 'markVaRequestPaid' as const, requestId: i.requestId, id: i.request.id, version: i.request.version, paidOn: i.paidOn });
export const VA_PAY_ACTIONS = ['saveVaPay', 'issueVaRequest', 'approveVaRequest', 'queryVaRequest', 'rejectVaRequest', 'adjustVaRequest', 'markVaRequestPaid'] as const;

// --- Money, hours and dates, written one way everywhere for VAs ----------------------------------------------------
const dollars = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Cents → "$1,234.50"; negatives "-$12.00". Always two decimals.
export const usd = (minor: number | null | undefined) => minor == null || !Number.isFinite(minor) ? '–' : (minor < 0 ? '-$' : '$') + dollars.format(Math.abs(minor) / 100);
export const rateLabel = (minor: number) => `${usd(minor)}/h`;
// "$12.50" typed by a person → 1250 cents; null when it is not a sum of money.
export function parseUsd(text: string): number | null {
  const t = text.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}
// The hours amount as the database works it out: minutes x rate / 60, to the nearest cent, half a cent up.
export const hoursAmount = (minutes: number, rateMinor: number) => Math.round(Math.max(minutes, 0) * rateMinor / 60);
// "13h 05m"; a correction is signed: "+0h 30m", "-1h 15m".
export const hoursLabel = (minutes: number) => minutesLabel(Math.max(minutes, 0));
export const signedHours = (minutes: number) => (minutes < 0 ? '-' : '+') + minutesLabel(Math.abs(minutes));

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const parts = (iso: string) => { const d = new Date(iso.slice(0, 10) + 'T12:00:00Z'); return { w: DAYS[d.getUTCDay()], d: d.getUTCDate(), m: MONTHS[d.getUTCMonth()], ml: MONTHS_LONG[d.getUTCMonth()], y: d.getUTCFullYear() }; };
// "Mon 6 Oct 2026", "Mon 6 Oct", "October 2026".
export const longDay = (iso: string) => { const p = parts(iso); return `${p.w} ${p.d} ${p.m} ${p.y}`; };
export const shortDay = (iso: string) => { const p = parts(iso); return `${p.w} ${p.d} ${p.m}`; };
export const monthLabel = (iso: string) => { const p = parts(iso); return `${p.ml} ${p.y}`; };
// The months management can issue a request for now: those that have ended, newest first, up to two years back (the
// database allows the same). `today` is London's date, YYYY-MM-DD; each month is YYYY-MM.
export function issueMonths(today: string, count = 24) {
  let y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < count; i++) { m -= 1; if (m === 0) { m = 12; y -= 1; } out.push(`${y}-${String(m).padStart(2, '0')}`); }
  return out;
}

// --- The lines -------------------------------------------------------------------------------------------------------
// "Hours worked September 2026: 13h 15m at $12.50/h", then "Bonus: Replies within 5 minutes, Tier 2 (95%)" when a tier
// was reached (or management set a bonus). No bonus line when the bonus is nothing.
export type VaLine = { key: 'hours' | 'bonus'; label: string; amountMinor: number };
export function bonusLabel(r: Pick<VaRequest, 'kpiName' | 'kpiValue' | 'kpiTier' | 'bonusAdjusted'>) {
  const name = r.kpiName?.trim() || 'KPI', value = r.kpiValue == null ? '' : ` (${r.kpiValue}%)`;
  const base = r.kpiTier ? `Bonus: ${name}, ${TIER_LABEL[r.kpiTier]}${value}` : `Bonus: ${name}${value}`;
  return r.bonusAdjusted ? `${base}, adjusted` : base;
}
export function vaLines(r: VaRequest): VaLine[] {
  const lines: VaLine[] = [{ key: 'hours', label: `Hours worked ${monthLabel(r.periodStart)}: ${hoursLabel(r.minutes)} at ${rateLabel(r.hourlyRateMinor)}`, amountMinor: r.hoursMinor }];
  if (r.bonusMinor > 0) lines.push({ key: 'bonus', label: bonusLabel(r), amountMinor: r.bonusMinor });
  return lines;
}

// --- How the pay is worked out, shift by shift ------------------------------------------------------------------------
// The VA's timesheet for the request's month (each day holds its own part of each shift, counted by lib/shift-hours.ts:
// clipped to the month, unpaid pauses off, a shift left open counted up to 16 hours) gathered into one row per shift:
// the date it started, clock in, clock out (with its date when it ended on another day), the hours that count this
// month, the rate and the amount. The totals compare with the hours in the request, which was worked out when it was
// made: a shift corrected since then, or rounding by the day, shows as a difference rather than silently.
export type VaShiftRow = { id: string; date: string; clockIn: string; clockOut: string; stale: boolean; minutes: number; hours: string; rate: string; amountMinor: number; amount: string };
export type VaBreakdown = {
  rows: VaShiftRow[]; minutes: number; hours: string; amountMinor: number; amount: string;
  requestMinutes: number; difference: number; note: string | null;
  lines: { label: string; value: string; strong?: boolean }[];
};
export function vaShiftBreakdown(person: TimesheetPerson | null | undefined, r: Pick<VaRequest, 'hourlyRateMinor' | 'workedMinutes' | 'hoursAdjustMinutes' | 'minutes' | 'hoursMinor' | 'bonusMinor' | 'totalMinor'>): VaBreakdown {
  const byShift = new Map<string, { shift: TimesheetPerson['days'][number]['shifts'][number]; minutes: number }>();
  for (const d of person?.days ?? []) for (const s of d.shifts) {
    const seen = byShift.get(s.id);
    if (seen) seen.minutes += s.minutes; else byShift.set(s.id, { shift: s, minutes: s.minutes });
  }
  const rows = [...byShift.values()].sort((a, b) => Date.parse(a.shift.clockedInAt) - Date.parse(b.shift.clockedInAt)).map(({ shift: s, minutes }) => {
    const inDay = ukDayOf(s.clockedInAt), outDay = s.clockedOutAt ? ukDayOf(s.clockedOutAt) : null;
    const clockOut = s.clockedOutAt ? (outDay === inDay ? londonClock(s.clockedOutAt) : `${shortDay(outDay!)} ${londonClock(s.clockedOutAt)}`)
      : s.stale ? `${NOT_CLOCKED_OUT} (${OPEN_SHIFT_LIMIT_HOURS}h max)` : 'Still on shift';
    const amountMinor = hoursAmount(minutes, r.hourlyRateMinor);
    return { id: s.id, date: shortDay(inDay), clockIn: londonClock(s.clockedInAt), clockOut, stale: !!s.stale, minutes, hours: hoursLabel(minutes), rate: rateLabel(r.hourlyRateMinor), amountMinor, amount: usd(amountMinor) };
  });
  const minutes = rows.reduce((t, x) => t + x.minutes, 0), amountMinor = hoursAmount(minutes, r.hourlyRateMinor);
  const difference = r.workedMinutes - minutes;
  const note = difference === 0 ? null : Math.abs(difference) <= rows.length
    ? `The request counts ${hoursLabel(r.workedMinutes)}: it rounds each day to the minute, a difference of ${Math.abs(difference)} min.`
    : `The request was made with ${hoursLabel(r.workedMinutes)}; the shifts now add up to ${hoursLabel(minutes)} (${signedHours(-difference)}). A shift was corrected after it was made: adjust the request if it should change.`;
  const lines: VaBreakdown['lines'] = [
    { label: `Shifts: ${hoursLabel(minutes)} at ${rateLabel(r.hourlyRateMinor)}`, value: usd(amountMinor) },
    ...(difference !== 0 ? [{ label: `Hours in the request: ${hoursLabel(r.workedMinutes)}`, value: usd(hoursAmount(r.workedMinutes, r.hourlyRateMinor)) }] : []),
    ...(r.hoursAdjustMinutes ? [{ label: `Hours correction ${signedHours(r.hoursAdjustMinutes)}`, value: `${hoursLabel(r.minutes)} paid` }] : []),
    { label: `Hours paid: ${hoursLabel(r.minutes)} at ${rateLabel(r.hourlyRateMinor)}`, value: usd(r.hoursMinor) },
    ...(r.bonusMinor > 0 ? [{ label: 'Bonus', value: usd(r.bonusMinor) }] : []),
    { label: 'Total', value: usd(r.totalMinor), strong: true },
  ];
  return { rows, minutes, hours: hoursLabel(minutes), amountMinor, amount: usd(amountMinor), requestMinutes: r.workedMinutes, difference, note, lines };
}

// --- Status ----------------------------------------------------------------------------------------------------------
export type StatusTone = 'wait' | 'good' | 'paid' | 'bad';
export function vaStatus(r: Pick<VaRequest, 'status' | 'paidOn' | 'queried'>): { label: string; tone: StatusTone } {
  if (r.status === 'paid') return { label: r.paidOn ? `Paid on ${longDay(r.paidOn)}` : 'Paid', tone: 'paid' };
  if (r.status === 'approved') return { label: 'Approved', tone: 'good' };
  if (r.status === 'rejected') return { label: 'Rejected', tone: 'bad' };
  return { label: r.queried ? 'To approve · queried' : 'To approve', tone: 'wait' };
}
// The chip on the document while it is not paid.
export function vaChip(r: Pick<VaRequest, 'status' | 'queried' | 'dueOn'>): { label: string; tone: StatusTone } | null {
  if (r.status === 'paid') return null;
  if (r.status === 'approved') return { label: `Approved · due ${shortDay(r.dueOn)}`, tone: 'good' };
  if (r.status === 'rejected') return { label: 'Rejected', tone: 'bad' };
  return { label: r.queried ? 'Awaiting approval · queried' : 'Awaiting approval', tone: 'wait' };
}

// Management's three lists: To approve (oldest first), To pay (approved, by due date) and Paid (newest first). Rejected
// requests stay out of all three.
export function vaGroups(list: readonly VaRequest[]) {
  const byName = (a: VaRequest, b: VaRequest) => a.vaName.localeCompare(b.vaName) || a.number.localeCompare(b.number);
  const toApprove = list.filter(r => r.status === 'to_approve').sort((a, b) => a.issueOn.localeCompare(b.issueOn) || byName(a, b));
  const toPay = list.filter(r => r.status === 'approved').sort((a, b) => a.dueOn.localeCompare(b.dueOn) || byName(a, b));
  const paid = list.filter(r => r.status === 'paid').sort((a, b) => (b.paidOn ?? '').localeCompare(a.paidOn ?? '') || byName(a, b));
  const sum = (rs: VaRequest[]) => rs.reduce((t, r) => t + r.totalMinor, 0);
  return { toApprove, toPay, paid, toApproveMinor: sum(toApprove), toPayMinor: sum(toPay), paidMinor: sum(paid), rejected: list.filter(r => r.status === 'rejected') };
}

// --- The document ----------------------------------------------------------------------------------------------------
export const VA_DOC_TITLE = 'REQUEST FOR INVOICE';
export const FROM_NAME = 'Recharge Group';
// The terms on every request. One constant; <number> is the request's number.
export const VA_TERMS = 'Please send us your invoice for the amount above, quoting reference <number>. We pay valid invoices within 7 days.';
export const vaTerms = (number: string) => VA_TERMS.replace('<number>', number);
export const fromLines = () => [FROM_NAME, legalDetails.registeredAddress, `${legalDetails.legalName} · Company no. ${legalDetails.companyNumber}`];

export type VaDocFact = { label: string; value: string };
export type VaDoc = {
  title: typeof VA_DOC_TITLE; number: string; status: { label: string; tone: StatusTone }; chip: { label: string; tone: StatusTone } | null; paidStamp: string | null;
  from: string[]; to: string; facts: VaDocFact[]; lines: { key: string; label: string; amount: string }[];
  days: { key: string; date: string; hours: string }[]; correction: string | null; total: string; totalLabel: 'Amount to invoice'; terms: string; footer: string; legal: string;
};
export function vaDoc(r: VaRequest): VaDoc {
  const paid = r.status === 'paid';
  const facts: VaDocFact[] = [
    { label: 'Issue date', value: longDay(r.issueOn) },
    { label: 'Period', value: monthLabel(r.periodStart) },
    { label: 'Hours', value: hoursLabel(r.minutes) },
    paid ? { label: 'Paid on', value: r.paidOn ? longDay(r.paidOn) : '' } : { label: 'Due date', value: r.status === 'rejected' ? '' : longDay(r.dueOn) },
  ].filter(f => f.value);
  return {
    title: VA_DOC_TITLE, number: r.number, status: vaStatus(r), chip: vaChip(r), paidStamp: paid && r.paidOn ? longDay(r.paidOn) : null,
    from: fromLines(), to: r.vaName, facts,
    lines: vaLines(r).map(l => ({ key: l.key, label: l.label, amount: usd(l.amountMinor) })),
    days: (r.days ?? []).map(d => ({ key: d.day, date: shortDay(d.day), hours: hoursLabel(d.minutes) })),
    correction: r.hoursAdjustMinutes ? `Hours corrected by management: ${signedHours(r.hoursAdjustMinutes)}` : null,
    total: usd(r.totalMinor), totalLabel: 'Amount to invoice', terms: vaTerms(r.number), footer: `${FROM_NAME} · ${r.number}`,
    legal: `${legalDetails.legalName} · Company no. ${legalDetails.companyNumber} · ${legalDetails.registeredAddress}`,
  };
}
export const vaFileName = (r: Pick<VaRequest, 'number'>) => `${r.number.replace(/[^A-Za-z0-9-]+/g, '-')}.html`;

// The document's colours, all from the app's light theme (paper is always light, also in dark mode and in print).
const paper = designTokens.light;
export const VA_PAPER = {
  page: paper.surface, band: brandCanvas, ink: paper.text, muted: paper.muted, rule: paper.border, zebra: paper.background, forest: darkBrandCanvas,
  tone: {
    wait: { wash: paper.cautionWash, ink: paper.waiting },
    good: { wash: paper.wash, ink: paper.primary },
    paid: { wash: paper.successWash, ink: paper.success },
    bad: { wash: paper.dangerWash, ink: paper.danger },
  } satisfies Record<StatusTone, { wash: string; ink: string }>,
};
// The supplied logo (docs/BRAND.md) has generous margins around the line art; the page clips them in the layout.
export const VA_LOGO_FILE = 'recharge-company-logo.png';
export const vaLogoBox = (width: number) => { const s = width / 1900; return { width, height: Math.round(400 * s), imageWidth: Math.round(2171 * s), imageHeight: Math.round(724 * s), left: -Math.round(105 * s), top: -Math.round(110 * s) }; };

const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
// The request as a page: A4 portrait, vector text, so "Print or save as PDF" gives a crisp PDF. `origin` is where the
// logo and the Montserrat files are served (the app's own site; a file:// folder for the sample).
export function vaRequestHtml(r: VaRequest, options: { origin?: string } = {}) {
  const doc = vaDoc(r), origin = (options.origin ?? 'https://app.rechargegroup.co.uk').replace(/\/$/, ''), c = VA_PAPER, tone = c.tone[doc.chip?.tone ?? doc.status.tone], logo = vaLogoBox(188);
  const font = (weight: number) => `@font-face{font-family:"Montserrat";font-weight:${weight};font-style:normal;src:url("${origin}/fonts/montserrat-${weight}.ttf") format("truetype")}`;
  const facts = doc.facts.map(f => `<div class="fact"><dt>${escape(f.label)}</dt><dd>${escape(f.value)}</dd></div>`).join('');
  const rows = doc.lines.map(l => `<tr><td>${escape(l.label)}</td><td class="num">${escape(l.amount)}</td></tr>`).join('');
  const days = doc.days.length ? `<section class="days" aria-label="Hours by day"><h2>Hours by day</h2><ul>${doc.days.map(d => `<li><span>${escape(d.date)}</span><span class="num">${escape(d.hours)}</span></li>`).join('')}</ul>${doc.correction ? `<p class="correction">${escape(doc.correction)}</p>` : ''}</section>` : '';
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Request for Invoice ${escape(doc.number)} · ${escape(doc.to)}</title>
<style>${font(400)}${font(600)}
@page{size:A4 portrait;margin:16mm 16mm 20mm;@bottom-left{content:"${escape(doc.footer)}";font:400 8pt "Montserrat",Helvetica,Arial,sans-serif;color:${c.muted}}@bottom-right{content:"Page " counter(page) " of " counter(pages);font:400 8pt "Montserrat",Helvetica,Arial,sans-serif;color:${c.muted}}}
*{box-sizing:border-box}html{-webkit-print-color-adjust:exact;print-color-adjust:exact;color-scheme:light}
body{margin:0;background:${c.band};color:${c.ink};font:400 10pt/1.5 "Montserrat",Helvetica,Arial,sans-serif;font-variant-numeric:tabular-nums}
.sheet{max-width:794px;margin:24px auto;background:${c.page};border-radius:14px;overflow:hidden;box-shadow:${depthTokens.light['elev-2']}}
.band{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:28px 40px;background:${c.band};border-bottom:1px solid ${c.rule}}
.logo{position:relative;width:${logo.width}px;height:${logo.height}px;overflow:hidden;flex:none}.logo img{position:absolute;width:${logo.imageWidth}px;height:${logo.imageHeight}px;left:${logo.left}px;top:${logo.top}px}
.title{text-align:right}.word{font-weight:600;font-size:17pt;letter-spacing:.28em;margin-right:-.28em;color:${c.forest};line-height:1.15}.number{margin-top:6px;font-size:10.5pt;letter-spacing:.06em;color:${c.muted}}
.body{padding:28px 40px 36px;position:relative}
.status{display:flex;align-items:center;gap:12px;margin:0 0 26px}.pill{display:inline-block;padding:5px 14px;border-radius:999px;background:${tone.wash};color:${tone.ink};font-weight:600;font-size:9pt;letter-spacing:.02em}
.stamp{position:absolute;right:46px;top:${doc.chip ? 96 : 20}px;transform:rotate(-8deg);border:2px solid ${c.forest};color:${c.forest};border-radius:10px;padding:8px 16px;text-align:center;opacity:.78;font-weight:600;letter-spacing:.24em;font-size:15pt;line-height:1.1}
.stamp small{display:block;letter-spacing:.06em;font-size:8pt;font-weight:400;margin-top:4px}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:22px}
h2{margin:0 0 4px;font-size:8pt;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:${c.muted}}.party p{margin:0;font-size:12pt;font-weight:600}.party .line{font-size:9pt;font-weight:400;color:${c.muted}}
.facts{display:grid;grid-template-columns:repeat(${Math.max(doc.facts.length, 1)},1fr);gap:0;margin:0 0 28px;border-top:1px solid ${c.rule};border-bottom:1px solid ${c.rule}}
.fact{padding:12px 14px 12px 0}.fact+.fact{padding-left:14px;border-left:1px solid ${c.rule}}.fact dt{font-size:7.5pt;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:${c.muted};margin-bottom:3px}.fact dd{margin:0;font-size:10pt}
table{width:100%;border-collapse:collapse}thead{display:table-header-group}th{font-size:7.5pt;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:${c.muted};text-align:left;padding:0 10px 8px;border-bottom:1px solid ${c.ink}}
td{padding:10px;border-bottom:1px solid ${c.rule};vertical-align:top}tbody tr:nth-child(even) td{background:${c.zebra}}tr{break-inside:avoid}
.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}th.num{text-align:right}
.days{margin:22px 0 0;break-inside:avoid}.days ul{list-style:none;margin:6px 0 0;padding:0;display:grid;grid-template-columns:repeat(3,1fr);column-gap:24px}
.days li{display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px solid ${c.rule};font-size:9pt}.days li span:first-child{color:${c.muted}}.correction{margin:8px 0 0;font-size:9pt;color:${c.muted}}
.totals{margin:22px 0 0 auto;width:min(320px,100%);break-inside:avoid}.totals .row{display:flex;justify-content:space-between;gap:16px;padding:6px 10px}
.totals .grand{align-items:baseline;padding-top:12px;border-top:1px solid ${c.ink}}.totals .grand span:first-child{font-weight:600;letter-spacing:.04em}.totals .grand span:last-child{font-size:18pt;font-weight:600;color:${c.forest}}
.terms{margin:30px 0 0;padding:14px 16px;border-radius:10px;background:${c.zebra};break-inside:avoid}.terms p{margin:0;font-size:9.5pt}
.foot{margin:34px 0 0;padding-top:14px;border-top:1px solid ${c.rule};color:${c.muted};font-size:8.5pt;break-inside:avoid}.foot p{margin:0}
.print{display:block;margin:0 auto 24px;font:600 10pt "Montserrat",Helvetica,Arial,sans-serif;padding:10px 20px;border-radius:999px;border:1px solid ${c.forest};background:${c.page};color:${c.forest};cursor:pointer}
@media (max-width:560px){.band,.body{padding-left:20px;padding-right:20px}.parties{grid-template-columns:1fr}.facts{grid-template-columns:1fr 1fr}.fact+.fact{border-left:0;padding-left:0}.days ul{grid-template-columns:1fr 1fr}}
@media print{html,body{background:${c.page}}.sheet{margin:0;max-width:none;border-radius:0;box-shadow:none;overflow:visible}.print{display:none}.band{padding:20px 22px;border-radius:10px;border-bottom:0}.body{padding:22px 0 0}.stamp{right:6px}.foot .who{display:none}}
</style></head>
<body>
<main class="sheet" aria-label="Request for Invoice ${escape(doc.number)}">
<header class="band"><div class="logo"><img src="${escape(origin)}/${VA_LOGO_FILE}" alt="Recharge"></div><div class="title"><div class="word">${VA_DOC_TITLE}</div><div class="number">${escape(doc.number)}</div></div></header>
<div class="body">
${doc.chip ? `<div class="status"><span class="pill">${escape(doc.chip.label)}</span></div>` : ''}
${doc.paidStamp ? `<div class="stamp" aria-hidden="true">PAID<small>${escape(doc.paidStamp)}</small></div>` : ''}
<section class="parties"><div class="party"><h2>From</h2><p>${escape(doc.from[0])}</p>${doc.from.slice(1).map(l => `<p class="line">${escape(l)}</p>`).join('')}</div><div class="party"><h2>To</h2><p>${escape(doc.to)}</p></div></section>
<dl class="facts">${facts}</dl>
<table><thead><tr><th>Description</th><th class="num">Amount</th></tr></thead><tbody>${rows}</tbody></table>
${days}
<section class="totals"><div class="row grand"><span>${doc.totalLabel}</span><span class="num">${escape(doc.total)}</span></div></section>
<section class="terms"><h2>Terms</h2><p>${escape(doc.terms)}</p></section>
<footer class="foot"><p>${escape(doc.footer)}</p><p class="who">${escape(doc.legal)}</p></footer>
</div>
</main>
<button class="print" type="button" onclick="window.print()">Print or save as PDF</button>
</body></html>
`;
}
