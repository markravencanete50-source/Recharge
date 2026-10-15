// @mentions in team group chats (Lee: "like WhatsApp"; migration 20261021400000). Typing "@" in a group conversation (a team
// channel or a group chat) opens a list of the people in it, plus @everyone, narrowed as you type. Picking one writes "@Erika Smith "
// into the message. When the message is sent the app works out who it mentions from the people in the conversation and sends their
// ids (and whether it mentions everyone) with it; the database checks them and keeps them with the message, so a name is only
// highlighted where the message really mentions that person. "@all" works as well as "@everyone".
export type MentionPerson = { userId: string; fullName: string; you?: boolean };
export type MentionOption = { kind: 'person'; userId: string; label: string } | { kind: 'everyone'; label: 'everyone' };
export const EVERYONE_WORDS = ['everyone', 'all'] as const;
const MAX_QUERY = 40;

// The "@…" being typed just before the caret, if any: where its "@" is and what follows it. The "@" starts the text or follows a
// space or a new line (so an email address never opens the list); what follows stays on one line and short.
export function mentionQuery(text: string, caret = text.length): { start: number; query: string } | null {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const at = before.lastIndexOf('@');
  if (at < 0 || (at > 0 && !/\s/.test(before[at - 1]))) return null;
  const query = before.slice(at + 1);
  if (query.length > MAX_QUERY || /[\n\r@]/.test(query) || /^\s/.test(query) || (query.match(/ /g) ?? []).length > 2) return null;
  return { start: at, query };
}

const words = (value: string) => value.toLowerCase().split(/\s+/).filter(Boolean);
// Who the list shows for what has been typed: people whose name (or a word of it) starts with it, then @everyone. You are never listed.
export function mentionOptions(query: string, people: readonly MentionPerson[], limit = 6): MentionOption[] {
  const q = query.trim().toLowerCase();
  const matches = people.filter(x => !x.you && x.fullName.trim())
    .map(x => ({ x, rank: !q ? 1 : x.fullName.toLowerCase().startsWith(q) ? 0 : words(x.fullName).some(w => w.startsWith(q)) ? 1 : x.fullName.toLowerCase().includes(q) ? 2 : 3 }))
    .filter(m => m.rank < 3).sort((a, b) => a.rank - b.rank || a.x.fullName.localeCompare(b.x.fullName)).slice(0, limit)
    .map(({ x }): MentionOption => ({ kind: 'person', userId: x.userId, label: x.fullName.trim() }));
  const everyone = !q || EVERYONE_WORDS.some(w => w.startsWith(q));
  return everyone ? [...matches, { kind: 'everyone', label: 'everyone' }] : matches;
}

// Puts the picked mention in place of the "@…" being typed, with a space after it; the caret goes after the space.
export function insertMention(text: string, start: number, caret: number, option: MentionOption) {
  const token = '@' + option.label + ' ';
  const rest = text.slice(caret).replace(/^\s+/, '');
  return { text: text.slice(0, start) + token + rest, caret: start + token.length };
}

// A letter or digit (accented letters included) straight after a name means it is a longer word, not a mention.
const LETTER = '[A-Za-z0-9\\u00C0-\\u024F]';
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// "@Name" stands on its own: after the start, a space or a bracket, and not followed by another letter or digit.
const tokenPattern = (name: string) => new RegExp(`(^|[\\s(\\[])@${escape(name)}(?!${LETTER})`, 'i');
const EVERYONE_PATTERN = new RegExp(`(^|[\\s(\\[])@(everyone|all)(?!${LETTER})`, 'i');

// Who a message mentions, from its words and the people in the conversation: their ids, and whether it mentions everyone.
// A longer name wins over a shorter one it contains ("@Erika Smith" is not also "@Erika").
export function mentionsIn(text: string, people: readonly MentionPerson[]): { userIds: string[]; everyone: boolean } {
  let rest = text;
  const ids: string[] = [];
  for (const x of [...people].filter(p => !p.you && p.fullName.trim()).sort((a, b) => b.fullName.trim().length - a.fullName.trim().length)) {
    const pattern = tokenPattern(x.fullName.trim());
    if (pattern.test(rest)) { if (!ids.includes(x.userId)) ids.push(x.userId); rest = rest.replace(new RegExp(pattern.source, 'gi'), '$1'); }
  }
  return { userIds: ids, everyone: EVERYONE_PATTERN.test(rest) };
}

// A message's words in pieces for the bubble: plain text, and the mentions it really makes (highlighted; yours most of all).
export type MentionPart = { text: string; mention?: 'you' | 'other' | 'everyone' };
export function mentionParts(body: string, mentions: readonly { name: string; you: boolean }[], everyone: boolean): MentionPart[] {
  const names = [...mentions].filter(m => m.name.trim()).sort((a, b) => b.name.length - a.name.length);
  const alternatives = [...names.map(m => escape('@' + m.name.trim())), ...(everyone ? ['@everyone', '@all'] : [])];
  if (!alternatives.length || !body) return body ? [{ text: body }] : [];
  const pattern = new RegExp(`(^|[\\s(\\[])(${alternatives.join('|')})(?!${LETTER})`, 'gi');
  const parts: MentionPart[] = [];
  let last = 0;
  for (const match of body.matchAll(pattern)) {
    const at = (match.index ?? 0) + match[1].length, token = match[2];
    if (at > last) parts.push({ text: body.slice(last, at) });
    const lower = token.slice(1).toLowerCase();
    const who = names.find(m => m.name.trim().toLowerCase() === lower);
    parts.push({ text: token, mention: who ? (who.you ? 'you' : 'other') : 'everyone' });
    last = at + token.length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return parts;
}
