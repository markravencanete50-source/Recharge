import { z } from 'zod';
import { csvCell } from './analytics-export';
import { PRIORITY_START } from './client-enquiry';
import { formatMoney } from './format';
import { DEPARTMENT_LABEL } from './hub';
import { REPAIR_STAGES } from './repairs-live';

// Business reports (Alex, client meeting): five reports for admins and super admins, each for a date range (the last 30
// days to start with, up to 366 days) with a CSV download. The database works every figure out
// (workspace_business_report, migration 20261020860000); this file reads the answers, names things in plain words
// and writes the CSV files. Nothing here holds a guest's or an enquirer's name, email or phone.

export const REPORT_KINDS = ['enquiries', 'repairs', 'todos', 'messages', 'time'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const REPORT_LABEL: Record<ReportKind, string> = { enquiries: 'Client enquiries', repairs: 'Repairs and spend', todos: 'To-dos', messages: 'Messages', time: 'Time worked' };
export const REPORT_INTRO: Record<ReportKind, string> = {
  enquiries: 'Enquiries received, how many reached an estimate, a signed agreement and going live, and how fast the team first replied.',
  repairs: 'Repairs raised by stage and by property, what was quoted, and the maintenance spend received in these dates.',
  todos: 'To-dos due in these dates: done, done late and overdue, by department and by person.',
  messages: 'Messages received and sent on each channel, by week and by month, and how fast the team replied.',
  time: 'Hours worked by each person and department. Unpaid pauses are taken off, as on the timesheet.',
};
// The teams read section for each report (lib/workspace-teams-policy.ts).
export const REPORT_SECTION = { enquiries: 'reportEnquiries', repairs: 'reportRepairs', todos: 'reportTodos', messages: 'reportMessages', time: 'reportTime' } as const satisfies Record<ReportKind, string>;
export const REPORT_MAX_DAYS = 366;
// A place on Reports that opens one report: Home's "Guest replies on time" opens Messages, for this month so far.
export const reportAnchor = (kind: ReportKind) => 'section-business-reports-' + kind;
export const reportFromAnchor = (anchor: string | null | undefined): ReportKind | null => REPORT_KINDS.find(k => reportAnchor(k) === anchor) ?? null;
export const monthSoFar = (today: string) => ({ from: today.slice(0, 8) + '01', to: today });
export const REPORT_DEFAULT_DAYS = 30;

const DAY = 86_400_000;
const shift = (day: string, days: number) => new Date(Date.parse(day + 'T12:00:00Z') + days * DAY).toISOString().slice(0, 10);
export const defaultReportRange = (today: string) => ({ from: shift(today, 1 - REPORT_DEFAULT_DAYS), to: today });
// '' when the dates can be reported on, or what to change.
export function reportRangeError(from: string, to: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return 'Choose the first and last day.';
  if (to < from) return 'The last day must be on or after the first day.';
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1 > REPORT_MAX_DAYS ? `Choose up to ${REPORT_MAX_DAYS} days.` : '';
}

// --- What the database answers ----------------------------------------------------------------------

const count = z.number().int().nonnegative();
const minutes = z.number().nullable();
const range = { from: z.string(), to: z.string() };
export const enquiriesReportSchema = z.object({
  ...range, received: count, priority: count, bySource: z.object({ form: count, app: count }),
  byStart: z.array(z.object({ startWhen: z.string(), count })),
  funnel: z.object({ received: count, estimate: count, agreement: count, live: count, declined: count }),
  reply: z.object({ replied: count, waiting: count, medianMinutes: minutes, slowestMinutes: minutes, estimateSent: count, estimateMedianMinutes: minutes, estimateSlowestMinutes: minutes }),
  rows: z.array(z.object({ receivedAt: z.string(), source: z.enum(['form', 'app']), propertyName: z.string().nullable(), startWhen: z.string(),
    reached: z.enum(['received', 'estimate', 'agreement', 'live']), declined: z.boolean(), replyMinutes: minutes, estimateMinutes: minutes })),
});
export const repairsReportSchema = z.object({
  ...range, raised: count, completed: count, quotedMinor: z.number(), quotedRepairs: count, finalMinor: z.number(), finalRepairs: count,
  byStage: z.array(z.object({ stage: z.string(), count })),
  spend: z.object({ approvedMinor: z.number(), waitingMinor: z.number(), rejectedMinor: z.number(), expenses: count }),
  byProperty: z.array(z.object({ propertyId: z.string().uuid(), propertyName: z.string(), raised: count, completed: count, quotedMinor: z.number(), finalMinor: z.number(), approvedMinor: z.number(), waitingMinor: z.number() })),
  // Day by day, for the analytics trend (20261023300000). Optional so an older server's report still reads.
  byDay: z.array(z.object({ day: z.string(), raised: count, completed: count })).optional(),
});
export const todosReportSchema = z.object({
  ...range, total: count, done: count, doneLate: count, overdue: count, open: count,
  byDepartment: z.array(z.object({ department: z.string(), total: count, done: count, doneLate: count, overdue: count })),
  byPerson: z.array(z.object({ userId: z.string().uuid(), fullName: z.string().nullable(), role: z.string(), assigned: count, done: count, doneLate: count, overdue: count })),
  byDay: z.array(z.object({ day: z.string(), total: count, done: count, doneLate: count, overdue: count })).optional(),
});
const volume = { channel: z.string(), received: count, sent: count };
export const messagesReportSchema = z.object({
  ...range, byChannel: z.array(z.object(volume)), byWeek: z.array(z.object({ week: z.string(), ...volume })), byMonth: z.array(z.object({ month: z.string(), ...volume })),
  replyTimes: z.array(z.object({ channel: z.string(), count, medianMinutes: minutes, slowestMinutes: minutes })), amberMinutes: z.number().nullable(),
});
const hours = { minutes: z.number().int(), unpaidMinutes: z.number().int(), overtimeMinutes: z.number().int(), shifts: count };
export const timeReportSchema = z.object({
  ...range, ...hours, running: count,
  byPerson: z.array(z.object({ userId: z.string().uuid(), fullName: z.string().nullable(), role: z.string(), department: z.string().nullable(), ...hours, days: count })),
  byDepartment: z.array(z.object({ department: z.string(), ...hours, people: count })),
  byDay: z.array(z.object({ day: z.string(), minutes: z.number().int(), people: count, shifts: count })).optional(),
});
export type EnquiriesReport = z.infer<typeof enquiriesReportSchema>;
export type RepairsReport = z.infer<typeof repairsReportSchema>;
export type TodosReport = z.infer<typeof todosReportSchema>;
export type MessagesReport = z.infer<typeof messagesReportSchema>;
export type TimeReport = z.infer<typeof timeReportSchema>;
export const REPORT_SCHEMA = { enquiries: enquiriesReportSchema, repairs: repairsReportSchema, todos: todosReportSchema, messages: messagesReportSchema, time: timeReportSchema } as const;
export type AnyReport = { enquiries: EnquiriesReport; repairs: RepairsReport; todos: TodosReport; messages: MessagesReport; time: TimeReport };

// --- Names --------------------------------------------------------------------------------------------

// Priority is the enquiry list's own (lib/client-enquiry.ts PRIORITY_START, the first "When would you like to get started?"
// answer). The database compares with the same words; tests/business-reports.test.mjs checks they match.
export { PRIORITY_START };
export const PRIORITY_LABEL = 'Priority (as soon as possible)';
export const startWhenName = (value: string) => value || 'Not answered';
export const SOURCE_LABEL = { form: 'Enquiry form', app: 'Added in the app' } as const;
export const REPAIR_STAGE_LABEL: Record<string, string> = { ...Object.fromEntries(REPAIR_STAGES.map(s => [s.phase, s.label])), cancelled: 'Cancelled' };
export const repairStageName = (stage: string) => REPAIR_STAGE_LABEL[stage] ?? stage.replaceAll('_', ' ');
export const departmentName = (department: string | null) => (!department ? 'Given to a person' : DEPARTMENT_LABEL[department] ?? department);
const CHANNEL_LABEL: Record<string, string> = {
  airbnb: 'Airbnb', booking_com: 'Booking.com', vrbo: 'Vrbo', direct: 'Direct booking', whatsapp: 'WhatsApp', email: 'Guest emails', other: 'Other guest messages',
  owner_chat: 'Owner app chat', client_email: 'Client emails',
};
export const channelName = (channel: string) => CHANNEL_LABEL[channel] ?? channel;
// Guest channels first, then the owners' (the order the Messages page uses).
const CHANNEL_ORDER = ['airbnb', 'booking_com', 'vrbo', 'direct', 'whatsapp', 'email', 'other', 'owner_chat', 'client_email'];
export const channelOrder = (a: string, b: string) => (CHANNEL_ORDER.indexOf(a) + 1 || 99) - (CHANNEL_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b);

// "45 min", "2h 05m", "3 days 4h": reply times can run to days.
export function waitLabel(value: number | null): string {
  if (value === null) return '–';
  if (value < 60) return `${Math.max(0, Math.round(value))} min`;
  if (value < 48 * 60) return `${Math.floor(value / 60)}h ${String(Math.round(value % 60)).padStart(2, '0')}m`;
  const days = Math.floor(value / 1440);
  return `${days} days ${Math.round((value % 1440) / 60)}h`;
}
// Hours to two decimals, for spreadsheets.
const hoursCell = (value: number) => (value / 60).toFixed(2);
export const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part * 100) / whole) : null);

// The funnel: each step with its count, the share of the step before and of all enquiries.
export function funnelSteps(f: EnquiriesReport['funnel']) {
  const steps = [['received', 'Enquiries received', f.received], ['estimate', 'Estimate sent', f.estimate], ['agreement', 'Agreement signed', f.agreement], ['live', 'Gone live', f.live]] as const;
  return steps.map(([key, label, n], i) => ({ key, label, count: n, fromPrevious: i ? percent(n, steps[i - 1][2]) : null, ofReceived: percent(n, f.received) }));
}

// Messages received per month, every channel together and each on its own: what an AI reply helper would be priced on.
export function receivedByMonth(r: MessagesReport) {
  const months = [...new Set(r.byMonth.map(m => m.month))].sort();
  return months.map(month => {
    const rows = r.byMonth.filter(m => m.month === month).sort((a, b) => channelOrder(a.channel, b.channel));
    return { month, received: rows.reduce((n, m) => n + m.received, 0), sent: rows.reduce((n, m) => n + m.sent, 0), channels: rows };
  });
}
// Each week's totals, every channel together, for the chart.
export function weekTotals(r: MessagesReport) {
  const weeks = [...new Set(r.byWeek.map(w => w.week))].sort();
  return weeks.map(week => {
    const rows = r.byWeek.filter(w => w.week === week);
    return { week, received: rows.reduce((n, w) => n + w.received, 0), sent: rows.reduce((n, w) => n + w.sent, 0) };
  });
}
export const monthName = (month: string) => new Date(month + '-15T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const weekName = (monday: string) => 'w/c ' + new Date(monday + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// What each report cannot show, in plain words (shown under the report and written into its CSV).
export const REPORT_NOTES: Record<ReportKind, string[]> = {
  enquiries: [
    'An enquiry is a form sent back by a landlord, or an onboarding added in the app. Each is counted once, on the day it came in.',
    'First reply is the earlier of the estimate being sent and the first email from Client emails to the enquirer. Phone calls and other emails are not recorded, so a reply by phone shows as no reply.',
    'Priority counts enquiries that answered "As soon as possible" when they came in, even if they were closed later.',
    'A deleted enquiry is not counted.',
  ],
  repairs: [
    'Repairs are counted on the day they were reported, at the stage they are at now. Quoted is the estimate on the repair; final cost is what was recorded when it was finished.',
    'Spend is maintenance expenses received in these dates: approved, waiting for approval (including queried) and rejected.',
  ],
  todos: [
    'A to-do counts when it is due in these dates, or was added in them when it has no due date. Late means done after its due day, or still open after it.',
    'A to-do ticked, reopened and ticked again keeps only its latest completion. An overdue department to-do has nobody to count it against, so it shows under the department only.',
  ],
  messages: [
    'Guest messages are counted by platform; owner app chat and Client emails are the owners\' side. Failed sends are left out.',
    'Reply times are measured the same way as on the team performance page: a message still waiting counts up to now once it is past the amber target.',
  ],
  time: [
    'Shifts count on the day they started. Unpaid pauses are taken off by the current pay rules, as on the timesheet and in the Productivity Tool. A shift still running counts up to now.',
  ],
};

// --- CSV ----------------------------------------------------------------------------------------------

const csv = (rows: (string | number | null)[][]) => '﻿' + rows.map(row => row.map(v => csvCell(v ?? '')).join(',')).join('\r\n') + '\r\n';
const head = (kind: ReportKind, r: { from: string; to: string }) => [['Recharge business report'], ['Report', REPORT_LABEL[kind]], ['Start date', r.from], ['End date', r.to], ['Date basis', 'Europe/London, both dates included'], []];
const notes = (kind: ReportKind) => [[], ['Notes'], ...REPORT_NOTES[kind].map(n => [n])];
const minutesCell = (value: number | null) => (value === null ? '' : value);
export const reportFilename = (kind: ReportKind, r: { from: string; to: string }) => `recharge-${kind}-${r.from}-${r.to}.csv`;

export function enquiriesCsv(r: EnquiriesReport) {
  return csv([
    ...head('enquiries', r),
    ['Summary', 'Count'], ['Enquiries received', r.received], [PRIORITY_LABEL, r.priority], [SOURCE_LABEL.form, r.bySource.form], [SOURCE_LABEL.app, r.bySource.app], [],
    ['Wants to start', 'Enquiry forms'], ...r.byStart.map(s => [startWhenName(s.startWhen), s.count]), [],
    ['Stage', 'Reached', '% of the stage before', '% of enquiries'], ...funnelSteps(r.funnel).map(s => [s.label, s.count, s.fromPrevious ?? '', s.ofReceived ?? '']),
    ['Closed or declined', r.funnel.declined], [],
    ['First reply', 'Value'], ['Replied', r.reply.replied], ['No reply yet', r.reply.waiting], ['Median minutes', minutesCell(r.reply.medianMinutes)], ['Slowest minutes', minutesCell(r.reply.slowestMinutes)],
    ['Estimates sent', r.reply.estimateSent], ['Median minutes to send the estimate', minutesCell(r.reply.estimateMedianMinutes)], ['Slowest minutes to send the estimate', minutesCell(r.reply.estimateSlowestMinutes)], [],
    ['Received', 'Came from', 'Property', 'Wants to start', 'Reached', 'Closed or declined', 'Minutes to first reply', 'Minutes to the estimate'],
    ...r.rows.map(x => [x.receivedAt.slice(0, 10), SOURCE_LABEL[x.source], x.propertyName ?? '', x.source === 'form' ? startWhenName(x.startWhen) : '', funnelSteps(r.funnel).find(s => s.key === x.reached)!.label,
      x.declined ? 'Yes' : 'No', minutesCell(x.replyMinutes), minutesCell(x.estimateMinutes)]),
    ...notes('enquiries'),
  ]);
}
export function repairsCsv(r: RepairsReport) {
  return csv([
    ...head('repairs', r),
    ['Summary', 'Value'], ['Repairs raised', r.raised], ['Repairs finished in these dates', r.completed], ['Quoted', formatMoney(r.quotedMinor)], ['Final cost recorded', formatMoney(r.finalMinor)],
    ['Spend approved', formatMoney(r.spend.approvedMinor)], ['Spend waiting for approval', formatMoney(r.spend.waitingMinor)], ['Spend rejected', formatMoney(r.spend.rejectedMinor)], [],
    ['Stage now', 'Repairs'], ...r.byStage.map(s => [repairStageName(s.stage), s.count]), [],
    ['Property', 'Raised', 'Finished', 'Quoted', 'Final cost', 'Spend approved', 'Spend waiting'],
    ...r.byProperty.map(p => [p.propertyName, p.raised, p.completed, formatMoney(p.quotedMinor), formatMoney(p.finalMinor), formatMoney(p.approvedMinor), formatMoney(p.waitingMinor)]),
    ...notes('repairs'),
  ]);
}
export function todosCsv(r: TodosReport) {
  return csv([
    ...head('todos', r),
    ['Summary', 'Count'], ['To-dos', r.total], ['Done', r.done], ['Done late', r.doneLate], ['Overdue (still open)', r.overdue], ['Open', r.open], [],
    ['Department', 'To-dos', 'Done', 'Done late', 'Overdue'], ...r.byDepartment.map(d => [departmentName(d.department), d.total, d.done, d.doneLate, d.overdue]), [],
    ['Person', 'Given to them', 'Done by them', 'Done late', 'Overdue'], ...r.byPerson.map(p => [p.fullName ?? 'Team member', p.assigned, p.done, p.doneLate, p.overdue]),
    ...notes('todos'),
  ]);
}
export function messagesCsv(r: MessagesReport) {
  const channels = [...r.byChannel].sort((a, b) => channelOrder(a.channel, b.channel));
  return csv([
    ...head('messages', r),
    ['Channel', 'Received', 'Sent'], ...channels.map(c => [channelName(c.channel), c.received, c.sent]), [],
    ['Messages received per month'], ['Month', 'Channel', 'Received', 'Sent'],
    ...receivedByMonth(r).flatMap(m => [...m.channels.map(c => [m.month, channelName(c.channel), c.received, c.sent]), [m.month, 'All channels', m.received, m.sent]]), [],
    ['Week starting', 'Channel', 'Received', 'Sent'], ...[...r.byWeek].sort((a, b) => a.week.localeCompare(b.week) || channelOrder(a.channel, b.channel)).map(w => [w.week, channelName(w.channel), w.received, w.sent]), [],
    ['Reply times', 'Replies timed', 'Median minutes', 'Slowest minutes'], ...[...r.replyTimes].sort((a, b) => channelOrder(a.channel, b.channel)).map(t => [channelName(t.channel), t.count, minutesCell(t.medianMinutes), minutesCell(t.slowestMinutes)]),
    ...notes('messages'),
  ]);
}
export function timeCsv(r: TimeReport) {
  return csv([
    ...head('time', r),
    ['Summary', 'Value'], ['Hours worked', hoursCell(r.minutes)], ['Unpaid pauses, hours', hoursCell(r.unpaidMinutes)], ['Overtime, hours', hoursCell(r.overtimeMinutes)], ['Shifts', r.shifts], ['Shifts still running', r.running], [],
    ['Person', 'Department', 'Hours worked', 'Unpaid pauses, hours', 'Overtime, hours', 'Shifts', 'Days worked'],
    ...r.byPerson.map(p => [p.fullName ?? 'Team member', p.department ? departmentName(p.department) : '', hoursCell(p.minutes), hoursCell(p.unpaidMinutes), hoursCell(p.overtimeMinutes), p.shifts, p.days]), [],
    ['Department', 'Hours worked', 'Unpaid pauses, hours', 'Overtime, hours', 'Shifts', 'People'],
    ...r.byDepartment.map(d => [departmentName(d.department), hoursCell(d.minutes), hoursCell(d.unpaidMinutes), hoursCell(d.overtimeMinutes), d.shifts, d.people]),
    ...notes('time'),
  ]);
}
export const REPORT_CSV: { [K in ReportKind]: (r: AnyReport[K]) => string } = { enquiries: enquiriesCsv, repairs: repairsCsv, todos: todosCsv, messages: messagesCsv, time: timeCsv };
