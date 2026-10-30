import { noticeCopy, type NoticeCopy } from './notice-copy';
import { MODULES } from './modules';
import { operationViewSchema } from './workspace-view';
import type { OperationView } from './workflow-forms';

// The Updates feed, round 6 (Lee: "instead of saying new task for your team it should be specific what type of task"). Each row
// says what it is: "<type of work>: <the work item's title>", then the property, who did it ("Automatic" for sweeps and feeds) and
// when. Chat and guest notices name who wrote, or where. A burst of the same automatic kind in one minute is one row that opens a
// list. Owners never see a staff name: the read gives them "Recharge" (migration 20261016300000).

// The kind of a work item (workspace_domain_details.kind) in plain words.
export const WORK_KIND_LABEL: Readonly<Record<string, string>> = {
  cleaning: 'Clean', cleaning_complaint: 'Clean complaint', cleaning_setup: 'Cleaning set-up', cleaning_invoice: 'Cleaner invoice',
  cleaner_management_review: 'Cleaner review', maintenance: 'Repair', repair: 'Repair', maintenance_invoice: 'Repair invoice',
  routine_visit: 'Preventative visit', aircover: 'AirCover', purchase: 'Purchase', purchase_delivery: 'Delivery',
  listing_health: 'Listing check', daily_pricing: 'Pricing', pricing_gap: 'Pricing', relisting: 'Re-listing', guest_review: 'Guest review',
  direct_booking: 'Direct booking follow-up', direct_booking_invoice: 'Direct booking invoice', licensing: 'Licensing',
  inspection: 'Inspection', garden_setup: 'Garden set-up', furnishing_quote: 'Furnishing quote', onboarding_invoice: 'Onboarding invoice',
  invoice: 'Invoice',
};

// The label for a work item: its kind, else its tool's short name, else the kind made readable. Null when there is no work item.
export function workKindLabel(kind: string | null | undefined, moduleId?: string | null): string | null {
  if (kind && WORK_KIND_LABEL[kind]) return WORK_KIND_LABEL[kind];
  const tool = moduleId ? MODULES.find(m => m.id === moduleId) : undefined;
  if (tool) return tool.shortName.replace(/^./, c => c.toUpperCase());
  if (kind) return kind.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
  return null;
}

// What the feed read returns for one notice (older databases send only the first four).
export type NoticeDetail = {
  id: number; event_type: string; created_at: string; read_at?: string | null;
  property_id?: string | null; work_id?: string | null; work_title?: string | null; work_kind?: string | null; work_module?: string | null;
  property_name?: string | null; property_address?: string | null; automatic?: boolean | null; actor_name?: string | null;
  // A guest message (migration 20261025500000): who wrote (null for a notice from before, or for someone who may not see guest
  // names), the channel the conversation came in on and the stay's dates.
  guest_name?: string | null; guest_channel?: string | null; guest_check_in?: string | null; guest_check_out?: string | null;
  guest_thread_id?: string | null;
};

export const noticeClock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
export const noticeTime = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const place = (n: NoticeDetail) => {
  const name = n.property_name?.trim(), address = n.property_address?.trim();
  // An address that already starts with the name ("40 Pitt Street" / "40 Pitt Street, Edinburgh") is shown once.
  if (name && address && address.toLowerCase().startsWith(name.toLowerCase())) return address;
  return [name, address && address !== name ? address : null].filter(Boolean).join(', ');
};
// Who did it, when the title does not already name them.
const who = (n: NoticeDetail, nameInTitle: boolean) => nameInTitle || n.event_type === 'guest.message' ? null : n.automatic ? 'Automatic' : n.actor_name?.trim() || null;

// Notices name people, not labels (Lee). Where the person who did it is known (a team member, or an owner to the team), the
// title says who did what: "Holly Holder commented on a lead". Not for the person themselves ("You") or an owner's view of the
// team ("Recharge"), which keep the plain wording. Email keeps the plain wording too (noticeCopyFor), as an email can be forwarded.
export const PERSON_TITLE: Readonly<Record<string, (name: string) => string>> = {
  'cleaning.cleaner_responded': name => `${name} responded to a complaint`,
  'enquiry.lead_comment': name => `${name} commented on a lead`,
  'enquiry.lead_approval': name => `${name} sent you an analysis to approve`,
  'enquiry.lead_approved': name => `${name} approved your analysis`,
  'enquiry.lead_returned': name => `${name} returned your analysis`,
  'feedback.received': name => `Feedback from ${name}`,
  'feedback.replied': name => `${name} replied to your feedback`,
  'hub.todo_added': name => `New to-do from ${name}`,
  'hub.todo_changed': name => `${name} changed a to-do`,
  'hub.todo_done': name => `${name} marked a to-do done`,
  'hub.todo_updated': name => `${name} commented on a to-do`,
  'hub.todo_mentioned': name => `${name} mentioned you on a to-do`,
  'hub.approval_added': name => `${name} asked for an approval`,
  'hub.approval_approved': name => `${name} approved your request`,
  'hub.approval_declined': name => `${name} declined your request`,
  'journey.askQuestion': name => `${name} asked a question`,
  'journey.answerQuestion': name => `${name} answered a question`,
  'journey.decideEstimate': name => `${name} decided on the estimate`,
  'journey.signAgreement': name => `${name} signed the management agreement`,
  'journey.submitForm': name => `${name} sent the set-up form`,
  'management.flag_raised': name => `${name} flagged something for management`,
  'management.flag_withdrawn': name => `${name} withdrew a flag`,
  'onboarding.contract_signed': name => `${name} signed their staff contract`,
  'reflection.saved': name => `Day reflection from ${name}`,
  'team.emergency': name => `${name} paused their shift for an emergency`,
  'team.event_set': name => `${name} changed your calendar`,
  'team.shift_change_requested': name => `${name} asked to change a timesheet`,
};
const personName = (n: NoticeDetail) => {
  const name = n.actor_name?.trim();
  return name && name !== 'You' && name !== 'Recharge' && !n.automatic ? name : null;
};

// A guest message: the guest's name and the property as the title ("Rebecca Hall · 64/2 Rannoch"), and what it is below it, with
// the channel and the stay's dates when known ("Guest message · Airbnb · 12 to 15 Nov"). Before 20261025500000 a notice kept no
// name: it says "Guest".
export const GUEST_CHANNEL_LABEL: Readonly<Record<string, string>> = {
  airbnb: 'Airbnb', booking_com: 'Booking.com', vrbo: 'Vrbo', direct: 'Direct booking', whatsapp: 'WhatsApp', email: 'Email', website: 'Website',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const day = (iso: string | null | undefined) => {
  const m = iso ? DAY.exec(iso) : null;
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
};
const dayText = (d: Date, month: boolean) => d.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', ...(month ? { month: 'short' } : {}) });
// "12 to 15 Nov", "30 Oct to 2 Nov", "28 Dec 2026 to 2 Jan 2027"; one date alone when only one is known.
export function stayDates(checkIn: string | null | undefined, checkOut: string | null | undefined): string | null {
  const from = day(checkIn), to = day(checkOut);
  if (from && to) {
    if (from.getUTCFullYear() !== to.getUTCFullYear()) return `${from.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })} to ${to.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })}`;
    return `${dayText(from, from.getUTCMonth() !== to.getUTCMonth())} to ${dayText(to, true)}`;
  }
  const one = from ?? to;
  return one ? dayText(one, true) : null;
}
export function guestNoticeTitle(n: Pick<NoticeDetail, 'guest_name' | 'property_name'>): string {
  const name = n.guest_name?.trim() || 'Guest', property = n.property_name?.trim();
  return property ? `${name} · ${property}` : name;
}
export function guestNoticeDetail(n: Pick<NoticeDetail, 'guest_channel' | 'guest_check_in' | 'guest_check_out'>): string {
  const channel = n.guest_channel ? GUEST_CHANNEL_LABEL[n.guest_channel] : undefined;
  return ['Guest message', channel, stayDates(n.guest_check_in, n.guest_check_out)].filter(Boolean).join(' · ');
}

// Where tapping a row goes: the work item, or Messages (chat and guest notices), or a property's onboarding, or Client
// enquiries (an enquiry notice: a form back, a possible duplicate; in Client relations since 20261022400000), or nowhere.
// A guest message opens its own conversation when the read names it (20261025500000).
export type NoticeTarget = { kind: 'work'; workId: string } | { kind: 'messages'; guestThreadId?: string } | { kind: 'property'; propertyId: string } | { kind: 'enquiries' } | null;
export const isEnquiryNotice = (n: Pick<NoticeDetail, 'event_type'>) => n.event_type.startsWith('enquiry.');
// A property onboarding notice (an estimate published, an agreement to sign) is about the onboarding itself, whose work item
// ("Property onboarding") has no task view: it opens the property, where the onboarding, the estimate and its decision are.
// Opening it as a work item said "That item is no longer available to you" (Lee, 16 October).
export const isOnboardingNotice = (n: NoticeDetail) => !!n.property_id && (n.event_type.startsWith('journey.') || (n.work_module === 'property-onboarding' && !n.work_kind));

// `line` is the whole second line as text (search, screen readers). On screen the time sits beside the title and `detail` (the place,
// then who) is the second line, so a narrow screen cuts the place short but never loses the time.
// `clock` is the time alone (14:47), for a list already grouped by day.
export type NoticeRow = { key: string; title: string; line: string; detail: string; when: string; clock: string; target: NoticeTarget; unread: boolean; notices: NoticeDetail[] };

// The cleaner's own clean notices (migration 20261021500000) say what happened ("Clean moved") rather than the clean's
// title ("Clean: Checkout clean"), which is the same for every clean; the property is on the second line.
export const CLEANER_NOTICES: ReadonlySet<string> = new Set(['cleaning.assigned', 'cleaning.unassigned', 'cleaning.moved', 'cleaning.cancelled', 'cleaning.redo', 'cleaning.morning',
  // Cleaner invoices (20261022000000).
  'cleaning.invoice_ready', 'cleaning.invoice_approved', 'cleaning.invoice_queried', 'cleaning.invoice_paid']);
// A VA's request for invoice notices (migration 20261022200000) say what happened, like the cleaner's own.
export const VA_PAY_NOTICES: ReadonlySet<string> = new Set(['vapay.request_approved', 'vapay.request_paid', 'vapay.request_queried', 'vapay.request_rejected']);

// One notice as a row: the title says what it is, the line where, who and when.
export function noticeRow(n: NoticeDetail): NoticeRow {
  const label = workKindLabel(n.work_kind, n.work_module), title = n.work_title?.trim();
  const fallback = noticeCopy(n.event_type).title;
  const onboarding = isOnboardingNotice(n);
  const person = personName(n), personal = person ? PERSON_TITLE[n.event_type]?.(person) : undefined;
  const chatFrom = (n.event_type === 'chat.message' || n.event_type === 'chat.owner_message') ? n.actor_name?.trim() : undefined;
  const plainTitle = CLEANER_NOTICES.has(n.event_type) || VA_PAY_NOTICES.has(n.event_type);
  const heading = plainTitle ? fallback
    : onboarding ? `${label ?? 'Onboarding'}: ${personal ?? fallback}`
    : n.work_id && title ? `${label ?? 'Task'}: ${title}`
    : chatFrom ? `Message from ${chatFrom}`
    : n.event_type === 'guest.message' ? guestNoticeTitle(n)
    : personal ?? fallback;
  // The title names the person already: the line does not repeat them.
  const nameInTitle = !plainTitle && (onboarding ? !!personal : !(n.work_id && title) && (!!chatFrom || !!personal));
  const detail = (n.event_type === 'guest.message' ? [guestNoticeDetail(n)] : [place(n), who(n, nameInTitle)]).filter(Boolean).join(' · '), when = noticeTime(n.created_at);
  const line = [detail, when].filter(Boolean).join(' · ');
  const guestThread = n.event_type === 'guest.message' && n.guest_thread_id && UUID.test(n.guest_thread_id) ? n.guest_thread_id.toLowerCase() : null;
  const target: NoticeTarget = onboarding ? { kind: 'property', propertyId: n.property_id as string } : n.work_id ? { kind: 'work', workId: n.work_id }
    : guestThread ? { kind: 'messages', guestThreadId: guestThread }
    : n.event_type.startsWith('chat.') || n.event_type === 'guest.message' ? { kind: 'messages' } : isEnquiryNotice(n) ? { kind: 'enquiries' } : null;
  return { key: String(n.id), title: heading, line, detail, when, clock: noticeClock(n.created_at), target, unread: !n.read_at, notices: [n] };
}

// Two notices belong to the same burst: the same automatic event for the same kind of work, within a minute of the burst's newest.
const BURST_MS = 60_000;
const burstKey = (n: NoticeDetail) => n.automatic && n.work_id ? `${n.event_type}|${workKindLabel(n.work_kind, n.work_module) ?? ''}` : null;

// The feed: notices newest first, with each burst (two or more) folded into one row, "Pricing: 12 new tasks · Automatic · 13 Oct,
// 13:39", whose notices open as a list.
export function noticeRows(notices: readonly NoticeDetail[]): NoticeRow[] {
  const sorted = [...notices].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
  const out: NoticeRow[] = [];
  for (let i = 0; i < sorted.length;) {
    const n = sorted[i];
    const groupKey = burstKey(n), newest = Date.parse(n.created_at);
    let j = i + 1;
    if (groupKey) while (j < sorted.length && burstKey(sorted[j]) === groupKey && newest - Date.parse(sorted[j].created_at) <= BURST_MS) j++;
    if (j - i < 2) { out.push(noticeRow(n)); i++; continue; }
    const burst = sorted.slice(i, j), label = workKindLabel(n.work_kind, n.work_module) ?? 'Task';
    const what = n.event_type === 'handover.created' ? 'new tasks' : 'updates';
    const when = noticeTime(n.created_at);
    out.push({ key: `group:${burst.map(x => x.id).join(',')}`, title: `${label}: ${burst.length} ${what}`, line: `Automatic · ${when}`, detail: 'Automatic', when, clock: noticeClock(n.created_at),
      target: null, unread: burst.some(x => !x.read_at), notices: burst });
    i = j;
  }
  return out;
}

// Email and push: the event's wording with the type of work in front ("Repair: New task for your team"). Still no property, title or
// names in a message that leaves the app.
export function noticeCopyFor(eventType: string | null | undefined, workKind?: string | null): NoticeCopy {
  const copy = noticeCopy(eventType), label = workKind ? workKindLabel(workKind) : null;
  return label ? { title: `${label}: ${copy.title}`, message: copy.message } : copy;
}

// --- Round 7: open any update, and older updates -----------------------------------------------------------------------
// The feed read gives the newest 50; "Show older" pages back 50 at a time from the oldest one shown (migration 20261017300000).
export const NOTICE_PAGE = 50;
// Two lists of updates as one, newest first, each update once.
export function mergeNotices<T extends Pick<NoticeDetail, 'id' | 'created_at'>>(...lists: readonly (readonly T[])[]): T[] {
  const byId = new Map<number, T>();
  for (const list of lists) for (const n of list) if (!byId.has(n.id)) byId.set(n.id, n);
  return [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
}
// The update to page back from: the oldest one shown. Null when nothing is shown.
export function oldestNoticeId(notices: readonly Pick<NoticeDetail, 'id' | 'created_at'>[]): number | null {
  const all = mergeNotices(notices);
  return all.length ? all[all.length - 1].id : null;
}
// Whether there may be older updates: the last page that came back was full.
export const mayHaveOlder = (lastPage: number) => lastPage >= NOTICE_PAGE;
// One work item from the single-item read. An answer that is a whole list has the item picked out of it. Null when
// it is not there.
export function workItemFrom(data: unknown, workId: string): OperationView | null {
  const raw = Array.isArray(data) ? data.find(x => x && typeof x === 'object' && (x as { workId?: unknown }).workId === workId) : data;
  const item = operationViewSchema.safeParse(raw);
  return item.success && item.data.workId === workId ? item.data : null;
}
