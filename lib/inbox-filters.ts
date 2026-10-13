// Quick filter chips for Messages and the guest inbox: Unread, Needs a reply, Mine and, when there
// is more than one, a property. Chips work inside the tab that is open (Guests, Clients or Team)
// and on what has already been read, so filtering never asks the server again.
export const CHAT_CHIPS = ['all', 'unread', 'reply', 'mine'] as const;
export const GUEST_CHIPS = ['reply', 'unread', 'mine', 'open', 'done', 'all'] as const;
export type InboxChip = (typeof GUEST_CHIPS)[number];
export const INBOX_CHIP_LABEL: Record<InboxChip, string> = { all: 'All', unread: 'Unread', reply: 'Needs a reply', mine: 'Mine', open: 'Open', done: 'Done' };
export const ALL_PROPERTIES = 'all';

// What a conversation is, for the chips.
export type InboxFacts = { unread: boolean; needsReply: boolean; mine: boolean; open: boolean; propertyIds: readonly string[] };

export const matchesChip = (f: InboxFacts, chip: InboxChip) =>
  chip === 'all' || (chip === 'unread' ? f.unread : chip === 'reply' ? f.needsReply : chip === 'mine' ? f.mine : chip === 'open' ? f.open : !f.open);
export const matchesProperty = (f: InboxFacts, property: string) => property === ALL_PROPERTIES || f.propertyIds.includes(property);

export function filterInbox<T>(items: readonly T[], facts: (item: T) => InboxFacts, chip: InboxChip, property = ALL_PROPERTIES): T[] {
  return items.filter(item => { const f = facts(item); return matchesChip(f, chip) && matchesProperty(f, property); });
}
// How many each chip would show, inside the chosen property.
export function chipCounts<T>(items: readonly T[], facts: (item: T) => InboxFacts, chips: readonly InboxChip[], property = ALL_PROPERTIES) {
  const inside = items.map(facts).filter(f => matchesProperty(f, property));
  return Object.fromEntries(chips.map(chip => [chip, inside.filter(f => matchesChip(f, chip)).length])) as Record<InboxChip, number>;
}
// The properties to offer as chips, with counts: only properties the person knows by name, and
// only when the conversations cover more than one.
export function propertyChips<T>(items: readonly T[], facts: (item: T) => InboxFacts, names: ReadonlyMap<string, string>, chip: InboxChip = 'all') {
  const counts = new Map<string, number>();
  for (const f of items.map(facts)) for (const id of new Set(f.propertyIds)) if (names.has(id)) counts.set(id, (counts.get(id) ?? 0) + (matchesChip(f, chip) ? 1 : 0));
  if (counts.size < 2) return [];
  return [...counts.entries()].map(([id, count]) => ({ id, name: names.get(id)!, count })).sort((a, b) => a.name.localeCompare(b.name));
}

// A team conversation needs a reply when the last word was someone else's; for an owner
// conversation, when the owner wrote last (the team's colleagues answering counts as replied).
export function conversationFacts(c: {
  kind: 'direct' | 'group' | 'owner'; unread: number; propertyId: string | null; propertyIds?: readonly string[]; mine?: boolean;
  last: { authorName: string; fromOwner?: boolean } | null;
}, viewerIsOwner = false): InboxFacts {
  const lastMine = c.last?.authorName === 'You';
  const needsReply = !!c.last && !lastMine && (c.kind !== 'owner' || viewerIsOwner || c.last.fromOwner === true);
  return { unread: c.unread > 0, needsReply, mine: c.mine ?? c.kind !== 'owner', open: true, propertyIds: c.propertyIds?.length ? c.propertyIds : c.propertyId ? [c.propertyId] : [] };
}
// A guest conversation: waiting for a reply, unread since this person last opened it (on this
// device), theirs (they replied, or look after the property).
export function guestFacts(t: { status: 'open' | 'done'; waitingSince: string | null; lastFrom: 'guest' | 'team' | null; lastMessageAt: string | null; propertyId: string | null; mine?: boolean }, seenAt?: string): InboxFacts {
  const unread = t.status === 'open' && t.lastFrom === 'guest' && !!t.lastMessageAt && (!seenAt || Date.parse(seenAt) < Date.parse(t.lastMessageAt));
  return { unread, needsReply: t.status === 'open' && !!t.waitingSince, mine: t.mine ?? false, open: t.status === 'open', propertyIds: t.propertyId ? [t.propertyId] : [] };
}

// What an empty filter says, so an empty list is never a puzzle.
export function emptyMessage(chip: InboxChip, where: 'guests' | 'clients' | 'team', propertyName?: string) {
  const at = propertyName ? ` at ${propertyName}` : '';
  if (chip === 'unread') return `Nothing unread${at}. You are all caught up.`;
  if (chip === 'reply') return where === 'guests' ? `Nobody is waiting for a reply${at}.` : `Nothing needs a reply${at}.`;
  if (chip === 'mine') return where === 'guests' ? `No conversations of yours${at}. They show here once you log or reply to one, and for the properties you look after.` : `No conversations of yours${at} yet.`;
  if (chip === 'open') return `No open conversations${at}.`;
  if (chip === 'done') return `No finished conversations${at}.`;
  if (propertyName) return `No conversations${at}.`;
  return where === 'guests' ? 'No conversations here.' : where === 'clients' ? 'No owner conversations yet. Tap New to message an owner you look after.' : 'No conversations yet. Tap New to message someone on the team.';
}

// ---- Messages, round 5 (Lee: "keep it simple, clean, and professional"): three statuses for Guests and Clients
// instead of the chips above, and one search box instead of the property chips. The Team tab has no status filter.
// Needs a reply: the other side spoke last and nobody has answered. Engaged: we answered last and it is still open
// (Lee renamed it from "Waiting for reply": nobody waits on us). The key stays `waiting`. Closed: marked done (guests) or closed (owners); a new message reopens either.
export const MESSAGE_STATUSES = ['reply', 'waiting', 'closed'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];
export const MESSAGE_STATUS_LABEL: Record<MessageStatus, string> = { reply: 'Needs a reply', waiting: 'Engaged', closed: 'Closed' };

export const guestStatus = (t: { status: 'open' | 'done'; waitingSince: string | null }): MessageStatus =>
  t.status === 'done' ? 'closed' : t.waitingSince ? 'reply' : 'waiting';
export const clientStatus = (c: { closed?: boolean; last: { fromOwner?: boolean; kind?: 'text' | 'event' } | null }): MessageStatus =>
  c.closed ? 'closed' : c.last?.fromOwner ? 'reply' : 'waiting';

export function statusCounts<T>(items: readonly T[], statusOf: (item: T) => MessageStatus): Record<MessageStatus, number> {
  const out: Record<MessageStatus, number> = { reply: 0, waiting: 0, closed: 0 };
  for (const item of items) out[statusOf(item)]++;
  return out;
}

// Search as you type: every word typed must appear somewhere in the fields (any order, any case, accents ignored).
const fold = (text: string) => text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
export function matchesSearch(query: string, fields: readonly (string | null | undefined)[]): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = fold(fields.filter(Boolean).join(' '));
  return words.every(word => text.includes(word));
}

// What an empty list says, for a status, a search, or a tab with nothing in it yet.
export function emptyStatusMessage(where: 'guests' | 'clients' | 'team', status: MessageStatus | null, searching: boolean): string {
  if (searching) return 'Nothing matches your search.';
  if (status === 'reply') return where === 'guests' ? 'Nobody is waiting for a reply.' : 'No owner is waiting for a reply.';
  if (status === 'waiting') return where === 'guests' ? 'No open conversations waiting on a guest.' : 'No open conversations waiting on an owner.';
  if (status === 'closed') return 'No closed conversations.';
  return where === 'clients' ? 'No owner conversations yet. Tap the pencil to message an owner you look after.' : 'No conversations yet. Tap the pencil to message someone on the team.';
}
