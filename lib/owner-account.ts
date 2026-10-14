import { z } from 'zod';
import { emailSignature } from './email-brand';
import { ENQUIRY_REPLY_TO } from './integration-policy';

// Proceed makes the owner's app account (migration 20261020880000). The two emails: "welcome" for a new account (or one
// whose email was never confirmed), with a one-time link to choose a password, and "added" for an owner who already has
// an account, with a link to sign in. Nobody is ever sent a password.
export type OwnerAccountEmailKind = 'welcome' | 'added';
export type OwnerAccountEmailStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';
export type OwnerAccountSkip = '' | 'no_email' | 'team_account' | 'blocked' | 'owner_accounts_off';

export const ownerAccountEmailSchema = z.object({
  status: z.enum(['pending', 'sending', 'sent', 'failed', 'skipped']), kind: z.enum(['welcome', 'added']).nullable(),
  reason: z.enum(['', 'no_email', 'team_account', 'blocked', 'owner_accounts_off']), email: z.string(), createdAccount: z.boolean(),
  attempts: z.number().int(), sentAt: z.string().nullable(), lastAttemptAt: z.string().nullable(),
});
export type OwnerAccountEmail = z.infer<typeof ownerAccountEmailSchema>;
export const ownerAccountActionSchema = z.object({ action: z.literal('resend'), propertyId: z.string().uuid(), requestId: z.string().uuid() }).strict();

// What the team sees on the property (mobile/src/OwnerAccountCard.tsx).
export const OWNER_ACCOUNT_SKIPPED: Record<Exclude<OwnerAccountSkip, ''>, string> = {
  no_email: 'There is no email address on the enquiry, so no account was made. Add the owner’s email to the enquiry, then try again.',
  team_account: 'This email belongs to a team member’s account, so it can’t be an owner account. Check the owner’s email on the enquiry.',
  blocked: 'This email’s account is blocked. Unblock it in Access first if the owner should use the app.',
  owner_accounts_off: 'Owner accounts are switched off while the team beta runs, so no account was made yet.',
};
export type OwnerAccountState = { label: string; tone: 'good' | 'wait' | 'bad' | 'plain'; note: string; action: string | null };
export function ownerAccountState(e: OwnerAccountEmail | null | undefined, hasAccount: boolean, now = Date.now()): OwnerAccountState | null {
  if (!e) return hasAccount ? null : { label: 'No account yet', tone: 'plain', note: 'The owner has no app account yet. Make one and they are emailed a link to choose their password.', action: 'Make the owner’s account' };
  const what = e.kind === 'added' ? 'the email saying the property is in their account' : 'the email to choose their password';
  if (e.status === 'skipped') return { label: 'No account made', tone: 'bad', note: OWNER_ACCOUNT_SKIPPED[e.reason || 'no_email'], action: hasAccount ? null : 'Try again' };
  if (e.status === 'sent') return { label: 'Email sent', tone: 'good', note: `${e.email} was sent ${what}.`, action: 'Send it again' };
  if (e.status === 'failed') return { label: 'Email not sent', tone: 'bad', note: `${capital(what)} to ${e.email} could not be sent. Send it again, or ask the owner to use “Forgot password” on the sign-in page.`, action: 'Send it again' };
  const stuck = e.status === 'sending' && (!e.lastAttemptAt || now - Date.parse(e.lastAttemptAt) > 2 * 60_000);
  if (e.status === 'sending' && !stuck) return { label: 'Sending', tone: 'wait', note: `Sending ${what} to ${e.email}.`, action: null };
  return { label: 'Email not sent yet', tone: 'wait', note: `${capital(what)} to ${e.email} has not gone yet.`, action: 'Send it now' };
}
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function ownerAccountEmail(input: { kind: OwnerAccountEmailKind; name: string; propertyName: string; email: string; link: string; reset: string; minutes: number }) {
  const first = input.name.trim().split(/\s+/)[0] ?? '';
  const greeting = first ? `Hello ${first},` : 'Hello,';
  const hours = input.minutes % 60 === 0 ? `${input.minutes / 60} hour${input.minutes === 60 ? '' : 's'}` : `${input.minutes} minutes`;
  const welcome = input.kind === 'welcome';
  const subject = welcome ? `Your Recharge account for ${input.propertyName}` : `${input.propertyName} is now in your Recharge account`;
  const lines = welcome
    ? [`Thank you for choosing to go ahead with ${input.propertyName}. We have made you an account in the Recharge app, where you can read and sign your management agreement and follow each step of getting the property ready.`,
      `Your account uses this email address (${input.email}). Choose your password with the button below. The link works once, for ${hours}.`,
      `If the link has run out, go to ${input.reset} and enter this email address to get a new one.`]
    : [`Thank you for choosing to go ahead with ${input.propertyName}. It is now in your Recharge account, beside your other properties, where you can read and sign the management agreement and follow each step.`,
      `Sign in with this email address (${input.email}) and your usual password. If you have forgotten it, use “Forgot password” on the sign-in page.`];
  const button = welcome ? 'Choose your password' : 'Sign in to Recharge';
  const text = [greeting, '', ...lines.flatMap(l => [l, '']), `${button}: ${input.link}`, '', 'If you have any questions, just reply to this email.', '', 'Recharge Property Management'].join('\n');
  const p = (s: string) => `<p style="margin:0 0 14px">${s}</p>`;
  const html = `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.6;color:#152D28;max-width:560px">`
    + p(escape(greeting)) + lines.map(l => p(escape(l))).join('')
    + `<p style="margin:28px 0"><a href="${escape(input.link)}" style="background:#1F3D38;color:#FAF7F0;padding:14px 22px;border-radius:999px;text-decoration:none;font-weight:600;display:inline-block">${button}</a></p>`
    + p('If you have any questions, just reply to this email.')
    + `<p style="margin:0;color:#4E6259;font-size:13px;word-break:break-all">If the button doesn't work, copy this link into your browser: ${escape(input.link)}</p>`
    + emailSignature(ENQUIRY_REPLY_TO) + `</div>`;
  return { subject, text, html };
}
