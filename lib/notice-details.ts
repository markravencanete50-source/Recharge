import { noticeCopy, type NoticeCopy } from './notice-copy';
import { MODULES } from './modules';

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
};

export const noticeClock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
export const noticeTime = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const place = (n: NoticeDetail) => {
  const name = n.property_name?.trim(), address = n.property_address?.trim();
  // An address that already starts with the name ("40 Pitt Street" / "40 Pitt Street, Edinburgh") is shown once.
  if (name && address && address.toLowerCase().startsWith(name.toLowerCase())) return address;
  return [name, address && address !== name ? address : null].filter(Boolean).join(', ');
};
// Who did it. A chat notice already names the writer in its title, so its line does not repeat it.
const named = (n: NoticeDetail) => (n.event_type === 'chat.message' || n.event_type === 'chat.owner_message') && !!n.actor_name?.trim();
const who = (n: NoticeDetail) => n.event_type === 'guest.message' ? 'Guest' : named(n) ? null : n.automatic ? 'Automatic' : n.actor_name?.trim() || null;

// Where tapping a row goes: the work item, or Messages (chat and guest notices), or nowhere.
export type NoticeTarget = { kind: 'work'; workId: string } | { kind: 'messages' } | null;

// `line` is the whole second line as text (search, screen readers). On screen the time sits beside the title and `detail` (the place,
// then who) is the second line, so a narrow screen cuts the place short but never loses the time.
// `clock` is the time alone (14:47), for a list already grouped by day.
export type NoticeRow = { key: string; title: string; line: string; detail: string; when: string; clock: string; target: NoticeTarget; unread: boolean; notices: NoticeDetail[] };

// One notice as a row: the title says what it is, the line where, who and when.
export function noticeRow(n: NoticeDetail): NoticeRow {
  const label = workKindLabel(n.work_kind, n.work_module), title = n.work_title?.trim();
  const fallback = noticeCopy(n.event_type).title;
  const heading = n.work_id && title ? `${label ?? 'Task'}: ${title}`
    : (n.event_type === 'chat.message' || n.event_type === 'chat.owner_message') && n.actor_name?.trim() ? `Message from ${n.actor_name.trim()}`
    : n.event_type === 'guest.message' ? (n.property_name?.trim() ? `Guest message · ${n.property_name.trim()}` : 'Guest message')
    : fallback;
  const detail = [n.event_type === 'guest.message' ? null : place(n), who(n)].filter(Boolean).join(' · '), when = noticeTime(n.created_at);
  const line = [detail, when].filter(Boolean).join(' · ');
  const target: NoticeTarget = n.work_id ? { kind: 'work', workId: n.work_id } : n.event_type.startsWith('chat.') || n.event_type === 'guest.message' ? { kind: 'messages' } : null;
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
