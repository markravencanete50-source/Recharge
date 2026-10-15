import { z } from 'zod';
import { emailSignature } from './email-brand';
import { GUEST_ADDRESS } from './integration-policy';

// Why guests stay (Alex; Lee approved stay analytics parts 2 and 3; migration 20261021800000). Pure: the pre-arrival
// question sent through Hostaway, reading the guest's answer (the same rules as private.workspace_stay_reason_parse), the
// survey email after a direct stay and its page's answer, and the words the team sees.

export const STAY_REASONS = ['holiday', 'work', 'family_friends', 'event', 'other'] as const;
export type StayReason = (typeof STAY_REASONS)[number];
// In the question's order: the guest replies with the number.
export const STAY_REASON_LABEL: Record<StayReason, string> = { holiday: 'Holiday', work: 'Work', family_friends: 'Visiting family or friends', event: 'An event', other: 'Something else' };
export const stayReasonName = (reason: string) => STAY_REASON_LABEL[reason as StayReason] ?? 'Something else';

// --- The question -------------------------------------------------------------------------------------------------
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-10-18" as "Sun 18 Oct". */
export function arrivalLabel(day: string): string {
  const at = new Date(day + 'T12:00:00Z');
  return Number.isNaN(at.getTime()) ? day : `${DAYS[at.getUTCDay()]} ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
}
/** The first word of a name, when it is a name (letters, an apostrophe, a hyphen or a full stop), else ''. */
export function firstNameOf(name: string | null | undefined): string {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? '';
  return first.length <= 60 && /^\p{L}[\p{L}'.-]*$/u.test(first) ? first : '';
}
// Channel messages are long enough for this (it is about 330 characters); a very long property name is shortened.
export const QUESTION_LIMIT = 1000;
/** The message sent 3 days before check-in, worded as Alex approved it. */
export function stayReasonQuestion(input: { firstName?: string | null; propertyName: string; checkIn: string }): string {
  const name = firstNameOf(input.firstName) || 'there';
  const home = input.propertyName.trim().replace(/\s+/g, ' ').slice(0, 200) || 'your stay';
  return [
    `Hi ${name}, we're looking forward to welcoming you to ${home} on ${arrivalLabel(input.checkIn)}! A quick question to help us prepare: what brings you here? Just reply with a number:`,
    ...STAY_REASONS.map((reason, i) => `${i + 1} ${STAY_REASON_LABEL[reason]}`),
    'Thank you! The Recharge team',
  ].join('\n');
}

// --- The reply ----------------------------------------------------------------------------------------------------
const WORDS: Record<StayReason, string[]> = {
  holiday: ['holiday', 'holidays', 'a holiday', 'on holiday', 'vacation', 'leisure'],
  work: ['work', 'for work', 'working', 'business', 'work trip', 'business trip'],
  family_friends: ['visiting family or friends', 'visiting friends or family', 'visiting family and friends', 'visiting friends and family', 'visiting family', 'visiting friends',
    'family', 'friends', 'family or friends', 'friends or family', 'family and friends', 'friends and family', 'visiting'],
  event: ['an event', 'event', 'for an event', 'a wedding', 'wedding'],
  other: ['something else', 'other', 'else'],
};
const wordReason = (text: string): StayReason | null => STAY_REASONS.find(reason => WORDS[reason].includes(text)) ?? null;
/**
 * The guest's answer, or null when the reply is anything else (left for the team). The whole message must be the answer:
 * a number 1 to 5, optionally with its own words ("1", "1.", "2 - work"), or the words alone ("Holiday", "work"), in any
 * case; trailing punctuation and a "thanks" are allowed. Mirrors private.workspace_stay_reason_parse.
 */
export function parseStayReason(body: string | null | undefined): StayReason | null {
  let t = (body ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  t = t.replace(/[\s.!?,;:)-]+$/, '');
  t = t.replace(/(^|[\s.!?,;:-]+)(many thanks|thanks|thank you|thankyou|cheers)$/, '');
  t = t.replace(/[\s.!?,;:)-]+$/, '');
  if (!t || t.length > 60) return null;
  const m = /^([1-5])(?:\s*[.):-]?\s*(.*))?$/.exec(t);
  if (m) {
    const byNumber = STAY_REASONS[Number(m[1]) - 1];
    if (!m[2]) return byNumber;
    return wordReason(m[2]) === byNumber ? byNumber : null;
  }
  return wordReason(t);
}

// --- On the guest thread ------------------------------------------------------------------------------------------
export const threadStayReasonSchema = z.object({ askedAt: z.string(), reason: z.enum(STAY_REASONS).nullable(), from: z.enum(['message', 'survey']).nullable() });
export type ThreadStayReason = z.infer<typeof threadStayReasonSchema>;
const shortDay = (iso: string) => {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short' }).format(at);
};
/** "Asked reason for stay on 15 Oct", then the answer once known. */
export function threadStayReasonLines(s: ThreadStayReason | null | undefined): string[] {
  if (!s) return [];
  return [`Asked reason for stay on ${shortDay(s.askedAt)}`, s.reason ? `Reason for stay: ${STAY_REASON_LABEL[s.reason]}${s.from === 'survey' ? ' (from the survey)' : ''}` : 'No answer yet'];
}

// --- The switches -------------------------------------------------------------------------------------------------
export const STAY_SWITCHES = { ask: 'Ask guests the reason for their stay', survey: 'Send a survey after direct stays' } as const;
export const STAY_SWITCH_HELP = {
  ask: 'Three days before check-in, around 10:00, every guest gets one message through Hostaway asking what brings them here. Owner stays and cancelled stays are never asked.',
  survey: 'The day after checkout, around 10:00, a guest who booked direct and whose email we have gets a short survey from guestrelations@rechargegroup.co.uk.',
} as const;
const switchState = z.object({ on: z.boolean(), changedAt: z.string().nullable(), changedBy: z.string().nullable() });
export const staySwitchesSchema = z.object({ ask: switchState, survey: switchState });
export type StaySwitches = z.infer<typeof staySwitchesSchema>;
export const STAY_SWITCHES_SECTION = 'stayReasonSettings';

// --- The survey ---------------------------------------------------------------------------------------------------
export const STAY_SURVEY_PATH = '/stay-survey';
export const surveyTokenPattern = /^[0-9a-f]{64}$/;
export const STAY_RATINGS = [1, 2, 3, 4, 5] as const;
export const RATING_LABEL: Record<number, string> = { 1: 'Poor', 2: 'Fair', 3: 'Good', 4: 'Very good', 5: 'Excellent' };
export const surveyAnswerSchema = z.object({
  token: z.string().regex(surveyTokenPattern),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  reason: z.enum(STAY_REASONS).nullable().optional(),
  comment: z.string().max(2000, 'Comments can be up to 2,000 characters').nullable().optional(),
}).strict().refine(v => v.rating != null || v.reason != null || !!v.comment?.trim(), { message: 'Choose an answer' });
export type SurveyAnswer = z.infer<typeof surveyAnswerSchema>;
// A tap in the email: the page opens with the answer chosen and records it.
export function surveyTap(query: { rating?: string; reason?: string }): { rating?: number; reason?: StayReason } {
  const rating = /^[1-5]$/.test(query.rating ?? '') ? Number(query.rating) : undefined;
  const reason = (STAY_REASONS as readonly string[]).includes(query.reason ?? '') ? query.reason as StayReason : undefined;
  return { ...(rating ? { rating } : {}), ...(reason ? { reason } : {}) };
}
const longDay = (day: string) => {
  const at = new Date(day + 'T12:00:00Z');
  return Number.isNaN(at.getTime()) ? day : new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(at);
};
/** "18 to 21 October 2026" style dates for the page. */
export const stayDates = (checkIn: string, checkOut: string) => `${longDay(checkIn)} to ${longDay(checkOut)}`;

/** The email the day after a direct stay: a thank you, a one-tap rating, the reason, and a link to add a comment. */
export function staySurveyEmail(input: { firstName?: string | null; propertyName: string; link: string }) {
  const name = firstNameOf(input.firstName);
  const tap = (extra: string) => `${input.link}&${extra}`;
  const subject = `How was your stay at ${input.propertyName}?`;
  const text = [
    name ? `Hi ${name},` : 'Hello,', '',
    'Thank you for staying with us.', '',
    'How was your stay? Tap a number, from 1 (poor) to 5 (excellent):',
    ...STAY_RATINGS.map(n => `${n} ${RATING_LABEL[n]}: ${tap(`rating=${n}`)}`), '',
    'What brought you here?',
    ...STAY_REASONS.map((reason, i) => `${i + 1} ${STAY_REASON_LABEL[reason]}: ${tap(`reason=${reason}`)}`), '',
    `You can also leave a comment on the page: ${input.link}`, '',
    'Thank you! The Recharge team',
  ].join('\n');
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const p = (s: string) => `<p style="margin:0 0 14px">${s}</p>`;
  const chip = (href: string, label: string) => `<a href="${escape(href)}" style="display:inline-block;margin:0 6px 8px 0;padding:10px 14px;border-radius:999px;border:1px solid #1F3D38;color:#1F3D38;text-decoration:none;font-weight:600">${escape(label)}</a>`;
  const html = `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.6;color:#152D28;max-width:560px">`
    + p(escape(name ? `Hi ${name},` : 'Hello,'))
    + p(`Thank you for staying with us at <strong>${escape(input.propertyName)}</strong>.`)
    + p('<strong>How was your stay?</strong> Tap a number, from 1 (poor) to 5 (excellent).')
    + `<div style="margin:0 0 18px">${STAY_RATINGS.map(n => chip(tap(`rating=${n}`), String(n))).join('')}</div>`
    + p('<strong>What brought you here?</strong>')
    + `<div style="margin:0 0 18px">${STAY_REASONS.map(reason => chip(tap(`reason=${reason}`), STAY_REASON_LABEL[reason])).join('')}</div>`
    + p(`You can also <a href="${escape(input.link)}" style="color:#1F3D38">leave a comment on the page</a>.`)
    + p('Thank you! The Recharge team')
    + emailSignature(GUEST_ADDRESS) + `</div>`;
  return { subject, text, html };
}
