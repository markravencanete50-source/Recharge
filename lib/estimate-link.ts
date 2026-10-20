import { z } from 'zod';
import { emailSignature } from './email-brand';
import { DECLINE_REASON_MESSAGE, MAX_SAVED_COMPARABLES, declineReasonMissing, repairLimitMinorSchema } from './journey-policy';
import { ENQUIRY_REPLY_TO } from './integration-policy';

// The estimate, emailed with a private link (Lee, 14 October). Pure: the email, the client's decision and the team's
// wording. The server makes the link from the request (a retry is the same link) and keeps only its hash.

export const ESTIMATE_LINK_PATH = '/estimate';
export const estimateTokenPattern = /^[0-9a-f]{64}$/;

// What the team sees on the journey and the enquiry (workspace_estimate_delivery, migration 20261019520000).
export const estimateDeliverySchema = z.object({
  status: z.enum(['sent', 'sending', 'ready']), emailFailed: z.boolean(), sentAt: z.string().nullable(), openedAt: z.string().nullable(),
  decidedAt: z.string().nullable(), to: z.string().nullable(),
}).passthrough();
export type EstimateDelivery = z.infer<typeof estimateDeliverySchema>;
export const ESTIMATE_DELIVERY_LABEL: Record<EstimateDelivery['status'], string> = { sent: 'Estimate sent', sending: 'Sending the estimate', ready: 'Estimate ready' };
export function estimateDeliveryNote(d: EstimateDelivery) {
  if (d.status === 'sent') return `Emailed to ${d.to ?? 'the client'}${d.openedAt ? '. They have opened it.' : '.'}`;
  if (d.status === 'sending') return `Emailing it to ${d.to ?? 'the client'}.`;
  if (d.emailFailed) return 'The email did not go. Resend it, or copy the link and send it yourself.';
  return d.to ? 'Published but not emailed yet. Email it, or copy the link and send it yourself.' : 'There is no email address for this enquiry. Copy the link and send it yourself.';
}

// The team's buttons: email it (again) or copy a link to send by hand.
export const estimateLinkActionSchema = z.object({ action: z.enum(['email', 'link']), requestId: z.string().uuid(), propertyId: z.string().uuid() }).strict();
export type EstimateLinkAction = z.infer<typeof estimateLinkActionSchema>;

// The client's answer on the page.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a follow-up date');
export const estimateDecisionSchema = z.object({
  token: z.string().regex(estimateTokenPattern), decision: z.enum(['proceed', 'review', 'decline'], { message: 'Choose how you would like to go ahead' }),
  feedback: z.string().max(5000, 'Feedback can be up to 5,000 characters').default(''), followUpOn: isoDate.nullable().optional(),
  // Item 7: with Proceed, the repairs Recharge may approve without asking (lib/journey-policy.ts).
  repairLimitMinor: repairLimitMinorSchema.optional(),
}).strict().refine(v => v.decision !== 'review' || !!v.followUpOn, { message: 'Choose a follow-up date', path: ['followUpOn'] })
  .refine(v => !declineReasonMissing(v), { message: DECLINE_REASON_MESSAGE, path: ['feedback'] });
// The three answers on the page, in this order (Alex, client meeting): go ahead, say no, or take time and come back to us.
export const DECISION_LABEL = { proceed: 'Proceed', decline: 'No, thank you', review: 'Thank you, I’ll be in touch' } as const;

// Reading: an estimate published before the limit for new ones dropped to MAX_COMPARABLES (3) keeps all it was saved with
// (up to MAX_SAVED_COMPARABLES); new submissions are still held to 3 by journeyActionSchema.
const comparablesOf = (estimate: Record<string, unknown>) => (Array.isArray(estimate.comparables) ? estimate.comparables : [])
  .filter((c): c is { name: string; url: string; adrMinor: number } => !!c && typeof c === 'object' && typeof (c as { name?: unknown }).name === 'string' && typeof (c as { url?: unknown }).url === 'string' && /^https:\/\//.test((c as { url: string }).url))
  .slice(0, MAX_SAVED_COMPARABLES);
export const estimateComparablesOf = comparablesOf;

// The email (Alex's onboarding framework, 20261025200000): the estimate is ready, and one button into the app, where they
// create an account (or sign in) with this email and see it. The account is linked to the enquiry by that verified email.
// The figures stay in the app. Plain text and HTML; no em dashes. Estimates emailed before keep their private link.
export function estimateEmail(input: { name: string; propertyName: string; link: string }) {
  const first = input.name.trim().split(/\s+/)[0] ?? '';
  const greeting = first ? `Hello ${first},` : 'Hello,';
  const subject = `Your free performance estimate for ${input.propertyName} is ready`;
  const text = [
    greeting, '',
    `Thank you for your enquiry. Your free performance estimate for ${input.propertyName} is ready.`, '',
    'To view it, create your Recharge account with this email address, or sign in if you already have one. Your estimate is waiting in the app, where you can explore what the property could earn and tell us how you would like to go ahead.', '',
    `Open the Recharge app: ${input.link}`, '',
    'If you have any questions, just reply to this email.', '', 'Recharge Property Management',
  ].join('\n');
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const p = (s: string, style = '') => `<p style="margin:0 0 14px${style}">${s}</p>`;
  const html = `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.6;color:#152D28;max-width:560px">`
    + p(escape(greeting))
    + p(`Thank you for your enquiry. Your free performance estimate for <strong>${escape(input.propertyName)}</strong> is ready.`)
    + p('To view it, create your Recharge account with this email address, or sign in if you already have one. Your estimate is waiting in the app, where you can explore what the property could earn and tell us how you would like to go ahead.')
    + `<p style="margin:28px 0"><a href="${escape(input.link)}" style="background:#1F3D38;color:#FAF7F0;padding:14px 22px;border-radius:999px;text-decoration:none;font-weight:600;display:inline-block">View your estimate in the app</a></p>`
    + p('If you have any questions, just reply to this email.')
    + `<p style="margin:0;color:#4E6259;font-size:13px;word-break:break-all">If the button doesn't work, copy this link into your browser: ${escape(input.link)}</p>`
    + emailSignature(ENQUIRY_REPLY_TO) + `</div>`;
  return { subject, text, html };
}

// A fixed request id for the email sent automatically after a publish, from the publish's own request id, so a
// retried publish never sends a second email.
export async function autoRequestId(publishRequestId: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('recharge-estimate-auto:' + publishRequestId)));
  const hex = Array.from(digest.slice(0, 16), b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${(8 + (parseInt(hex[16], 16) & 3)).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
