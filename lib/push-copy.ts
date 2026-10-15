import { noticeCopyFor } from './notice-details';
import type { NoticeCopy } from './notice-copy';
import { voicePreviewLength } from './workspace-chat-policy';

// Direct pop-ups (Lee, 14 October: "Mark, new guest message", "John, guest, replied"): the pop-up names the person it is for, who
// sent it and what it says, from the details the backend hands each pop-up (integration_push_details, migration 20261020700000).
// Pop-ups are encrypted for the one device they go to, so the names and the start of the message travel safely. Email notices keep
// the general wording (noticeCopyFor), as an email can be forwarded.
export type PushDetails = {
  recipient?: string | null; who?: string | null; preview?: string | null; context?: string | null; replied?: boolean | null;
  actorName?: string | null; workTitle?: string | null; propertyName?: string | null;
};

const TITLE_MAX = 80, MESSAGE_MAX = 180;
const clip = (text: string, size: number) => text.length > size ? text.slice(0, size - 1).trimEnd() + '…' : text;
const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] ?? '';
// "New to-do for you" reads "Mark, new to-do for you"; names and labels keep their capitals.
const afterName = (title: string) => /^(New|Your|A|An)\b/.test(title) ? title[0].toLowerCase() + title.slice(1) : title;
const plain = (message: string) => message.replace(/\s*Sign in to Recharge to see the details\.$/, '');
const text = (value: string | null | undefined) => value?.trim() || '';

export function pushCopy(eventType: string | null | undefined, workKind?: string | null, details: PushDetails = {}): NoticeCopy {
  const base = noticeCopyFor(eventType, workKind);
  const who = text(details.who), preview = text(details.preview), place = text(details.propertyName), context = text(details.context);
  // A voice note's preview is its label ("🎤 Voice note (0:42)", migration 20261021100000): "Alex sent a voice note (0:42)".
  const voice = voicePreviewLength(preview);
  let title: string, message: string;
  switch (eventType) {
    case 'guest.message':
      title = who && details.replied ? `${who} (guest) replied` : who ? `New guest message from ${who}` : base.title;
      message = [place, preview].filter(Boolean).join(': ');
      break;
    case 'chat.message':
      if (voice && who) { title = `${who} sent a voice note (${voice})`; message = context ? `In ${context}` : 'Tap to listen'; break; }
      title = who ? (context ? `${who} in ${context}` : `${who} sent you a message`) : base.title;
      message = preview;
      break;
    case 'chat.owner_message':
      if (voice && who) { title = `${who} (owner) sent a voice note (${voice})`; message = place || 'Tap to listen'; break; }
      title = who ? `${who} (owner) sent a message` : base.title;
      message = [place, preview].filter(Boolean).join(': ');
      break;
    case 'client.email':
      title = who ? (details.replied ? `${who} replied by email` : `New email from ${who}`) : base.title;
      message = preview;
      break;
    default:
      title = base.title;
      message = [text(details.actorName), text(details.workTitle), place].filter(Boolean).join(' · ');
  }
  const name = firstName(details.recipient);
  return {
    title: clip(name ? `${name}, ${afterName(title)}` : title, TITLE_MAX),
    message: clip(message || plain(base.message), MESSAGE_MAX),
  };
}
