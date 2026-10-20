import { noticeCopyFor } from './notice-details';
import type { NoticeCopy } from './notice-copy';

// What a pop-up says, from the details the backend hands each pop-up (integration_push_details, migrations 20261020700000 and
// 20261021400000). Pop-ups are encrypted for the one device they go to, so names and the start of the message travel safely.
// Email notices keep the general wording (noticeCopyFor), as an email can be forwarded.
// Messages are laid out as WhatsApp lays them out (Lee): the title is the sender's name only ("Rebecca", "John Pagueran"); the
// body's first line is the conversation ("Guest · Bornisketaig" for a guest, the chat's name for a group, "Sarah Jones (owner)"
// for an owner's conversation; a one-to-one chat has none), then the message. A photo shows as the pop-up's picture when the
// backend could sign a short-lived link to it (web-push.ts), otherwise its line starts "Photo"; a video, voice note or file says
// so the same way. The pop-ups of one conversation replace each other (pushTarget's tag): the browser lists the latest
// messages in one pop-up under the conversation line, titled with the sender, or with the conversation and "(3 messages)"
// when several people wrote (mobile/web-static/sw.js, from pushThread).
// Everything else (repairs, approvals, to-dos, client emails) keeps Lee's wording (14 October): the pop-up names the person it is
// for, "Mark, new to-do for you", with who, what and where below.
export type PushDetails = {
  recipient?: string | null; who?: string | null; preview?: string | null; context?: string | null; replied?: boolean | null;
  actorName?: string | null; workTitle?: string | null; propertyName?: string | null;
  // Messages (20261021400000): the conversation, its kind, whether the message mentions this person or everyone, how many
  // messages they have not read there, and the sender's photo (a private path the backend signs; never sent to a device) and colour.
  conversationId?: string | null; conversationKind?: string | null; ownerName?: string | null; mention?: 'you' | 'everyone' | string | null; unreadCount?: number | null;
  senderPhotoPath?: string | null; senderColour?: string | null;
  // What the message carries besides words (20261025500000): 'image', 'video' or 'audio' (a team chat) or 'file', and the first
  // photo's private path, which the backend signs for an hour (never sent to a device). attachmentShown: that link was made, so
  // the pop-up shows the photo itself (set by web-push.ts, not by the backend).
  attachmentKind?: 'image' | 'video' | 'audio' | 'file' | string | null; attachmentPath?: string | null; attachmentShown?: boolean | null;
  // A guest message (20261025500000): the guest conversation it came in (private.workspace_guest_threads), so a tap opens it,
  // Mark as read marks it read and its pop-ups group together.
  guestThreadId?: string | null;
};

const TITLE_MAX = 80, MESSAGE_MAX = 180;
const clip = (text: string, size: number) => text.length > size ? text.slice(0, size - 1).trimEnd() + '…' : text;
const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] ?? '';
// "New to-do for you" reads "Mark, new to-do for you"; names and labels keep their capitals.
const afterName = (title: string) => /^(New|Your|A|An)\b/.test(title) ? title[0].toLowerCase() + title.slice(1) : title;
const plain = (message: string) => message.replace(/\s*Sign in to Recharge to see the details\.$/, '');
const text = (value: string | null | undefined) => value?.trim() || '';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Messages from a person: no name in front of the title, as in a phone messenger.
export const MESSAGE_EVENTS = ['chat.message', 'chat.owner_message', 'guest.message'] as const;
const isMessage = (eventType: string | null | undefined) => (MESSAGE_EVENTS as readonly (string | null | undefined)[]).includes(eventType);
const isGroup = (details: PushDetails) => details.conversationKind ? details.conversationKind === 'group' : !!text(details.context);

// A message in three parts: who wrote it (the title), the conversation (the body's first line, '' for a one-to-one chat) and
// the message itself.
const ATTACHMENT_LABEL: Record<string, string> = { image: 'Photo', video: 'Video', audio: 'Voice note', file: 'File' };
function messageLine(details: PushDetails) {
  const preview = text(details.preview), kind = text(details.attachmentKind), label = ATTACHMENT_LABEL[kind];
  if (!label) return preview;
  // The backend writes a label for a message with no words ("📷 Photo", "🎤 Voice note (0:42)"); the pop-up says it in words.
  const labelOnly = /^\p{Extended_Pictographic}/u.test(preview), words = labelOnly ? '' : preview;
  const length = labelOnly ? /\((\d{1,2}:\d{2})\)/.exec(preview)?.[1] : undefined, several = labelOnly ? /\d+ photos( and videos)?/.exec(preview)?.[0] : undefined;
  const plainLabel = length ? `${label} (${length})` : several ?? label;
  if (kind === 'image' && details.attachmentShown) return words || plainLabel;
  return words ? `${plainLabel}: ${words}` : plainLabel;
}
export function pushMessageParts(eventType: string | null | undefined, details: PushDetails = {}): { sender: string; conversation: string; line: string } | null {
  if (!isMessage(eventType)) return null;
  const who = text(details.who), place = text(details.propertyName), context = text(details.context), line = messageLine(details);
  switch (eventType) {
    case 'guest.message':
      return { sender: who || 'Guest', conversation: place ? `Guest · ${place}` : who ? 'Guest' : '', line };
    case 'chat.owner_message':
      return { sender: who || 'Owner', conversation: place ? `Owner · ${place}` : who ? 'Owner' : '', line };
    default: {
      const mention = details.mention === 'you' ? 'Mentioned you' : details.mention === 'everyone' ? 'Mentioned everyone' : '';
      const said = mention ? (line ? `${mention}: ${line}` : mention) : line;
      if (isGroup(details) && context) return { sender: who || 'Recharge', conversation: context, line: said };
      if (details.conversationKind === 'owner' && text(details.ownerName)) return { sender: who || 'Recharge', conversation: `${text(details.ownerName)} (owner)`, line: said };
      return { sender: who || noticeCopyFor(eventType).title, conversation: '', line: said };
    }
  }
}

export function pushCopy(eventType: string | null | undefined, workKind?: string | null, details: PushDetails = {}): NoticeCopy {
  const base = noticeCopyFor(eventType, workKind);
  const parts = pushMessageParts(eventType, details);
  if (parts) {
    const message = clip(parts.line || plain(base.message), MESSAGE_MAX);
    return { title: clip(parts.sender, TITLE_MAX), message: parts.conversation ? `${clip(parts.conversation, TITLE_MAX)}\n${message}` : message };
  }
  const who = text(details.who), preview = text(details.preview), place = text(details.propertyName);
  let title: string, message: string;
  switch (eventType) {
    case 'client.email':
      title = who ? (details.replied ? `${who} replied by email` : `New email from ${who}`) : base.title;
      message = preview;
      break;
    default:
      title = base.title;
      // The backend's own sentence when it wrote one (cleaner notices: "110 Hawk, Sat 18 Oct · checkout 10:00 · next guests 15:00").
      message = preview || [text(details.actorName), text(details.workTitle), place].filter(Boolean).join(' · ');
  }
  const name = firstName(details.recipient);
  return {
    title: clip(name ? `${name}, ${afterName(title)}` : title, TITLE_MAX),
    message: clip(message || plain(base.message), MESSAGE_MAX),
  };
}

// Where a tap goes, and which pop-ups replace each other: one per conversation (so a busy chat shows its latest message once, and
// alerts again), one per guest, and one for everything else, as before.
export function pushTarget(eventType: string | null | undefined, details: PushDetails = {}): { tag: string; url: string } {
  const conversation = text(details.conversationId);
  if ((eventType === 'chat.message' || eventType === 'chat.owner_message') && UUID.test(conversation))
    return { tag: 'chat-' + conversation.toLowerCase(), url: `/workspace/live?section=inbox&chat=${conversation.toLowerCase()}` };
  if (eventType === 'chat.message' || eventType === 'chat.owner_message') return { tag: 'recharge-chat', url: '/workspace/live?section=inbox' };
  if (eventType === 'guest.message') {
    const guest = text(details.guestThreadId).toLowerCase();
    if (UUID.test(guest)) return { tag: 'guest-' + guest, url: `/workspace/live?section=inbox&guest=${guest}` };
    // A notice from before the conversation was sent: one pop-up per guest and property, opening Messages.
    const key = [text(details.who), text(details.propertyName)].join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    return { tag: key ? 'guest-' + key : 'recharge-guest', url: '/workspace/live?section=inbox' };
  }
  // An enquiry notice (a form back, a possible duplicate) opens Client enquiries, which the workspace opens in Client relations.
  if (eventType?.startsWith('enquiry.')) return { tag: 'recharge', url: '/workspace/live?section=enquiries' };
  return { tag: 'recharge', url: '/workspace/live' };
}

// A message pop-up's conversation, for the browser to gather its messages into one pop-up as WhatsApp does: `thread` names the
// conversation when several people wrote (the conversation line, or the sender for a one-to-one chat), `who` and `line` are this
// message's sender and words, `context` the conversation line, `count` how many are unread there (team chats; a guest
// conversation counts the messages it was sent), and the conversation to mark read from the pop-up: a team conversation, or a
// guest conversation (read on the device: the app marks it when it next opens, mobile/src/LiveGuestInbox.tsx).
export function pushThread(eventType: string | null | undefined, details: PushDetails = {}): { thread?: string; who?: string; context?: string; line?: string; count?: number; conversation?: string; guest?: string } {
  const parts = pushMessageParts(eventType, details);
  if (!parts) return {};
  const unread = Number(details.unreadCount ?? 0), conversation = text(details.conversationId).toLowerCase(), guest = text(details.guestThreadId).toLowerCase();
  return {
    thread: clip(parts.conversation || parts.sender, TITLE_MAX), who: clip(parts.sender, TITLE_MAX),
    ...(parts.conversation ? { context: clip(parts.conversation, TITLE_MAX) } : {}),
    line: clip(parts.line || plain(noticeCopyFor(eventType).message), MESSAGE_MAX),
    ...(eventType !== 'guest.message' && Number.isInteger(unread) && unread > 0 ? { count: unread } : {}),
    ...(eventType !== 'guest.message' && UUID.test(conversation) ? { conversation } : {}),
    ...(eventType === 'guest.message' && UUID.test(guest) ? { guest } : {}),
  };
}

// The profile colours (mobile/src/AccountSetup.tsx avatarColors), for a pop-up's initials when the sender has no photo.
export const AVATAR_HEX: Record<string, string> = { forest: '#1C3934', sage: '#1F5F55', ocean: '#3B5866', plum: '#5B4A5E', clay: '#8E3F38', slate: '#4E6259' };
const AVATAR_ORDER = Object.values(AVATAR_HEX);
// Someone without a profile colour (a guest) gets one picked from their name, so the same person always has the same circle.
const colourFor = (name: string) => AVATAR_ORDER[Array.from(name.toLowerCase()).reduce((h, c) => (h * 31 + c.codePointAt(0)!) >>> 0, 7) % AVATAR_ORDER.length];
// The sender's initials and colour for the pop-up's picture, when there is a sender to draw (never "Recharge" itself).
export function pushInitials(eventType: string | null | undefined, details: PushDetails = {}): { initials: string; colour: string } | null {
  const who = text(details.who);
  if (!isMessage(eventType) || !who || who === 'Recharge') return null;
  const initials = who.split(/\s+/).slice(0, 2).map(w => Array.from(w)[0] ?? '').join('').toUpperCase();
  if (!initials || !/^[\p{L}\p{N}]+$/u.test(initials)) return null;
  return { initials, colour: AVATAR_HEX[text(details.senderColour)] ?? colourFor(who) };
}
