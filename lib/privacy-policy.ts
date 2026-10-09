import { z } from 'zod';

// Your own data: what deleting your account would mean, a copy of everything about you, and
// deleting the account. Shared by the app, the /delete-account page and the server.
export const DELETE_PHRASE = 'DELETE';
export const privacyReadSchema = z.object({ section: z.enum(['deletion', 'export']) }).strict();
export const deleteAccountSchema = z.object({
  confirm: z.literal(DELETE_PHRASE, { errorMap: () => ({ message: `Type ${DELETE_PHRASE} to confirm.` }) }),
  password: z.string().min(1, 'Enter your password.').max(1024),
}).strict();
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;

export const deletionSummarySchema = z.object({
  role: z.string(), status: z.string(), lastSuperAdmin: z.boolean(),
  properties: z.number().int().min(0), liveProperties: z.number().int().min(0),
});
export type DeletionSummary = z.infer<typeof deletionSummarySchema>;

// How long business records are kept after an account is deleted (UK record-keeping rules).
export const BUSINESS_RECORD_YEARS = 6;
export const LAST_SUPER_ADMIN = 'You are the only super admin. Make someone else a super admin first, then delete your account.';
export const ACCOUNT_DELETED = 'Your account has been deleted and you have been signed out. Thank you for using Recharge.';

// The plain-English summary shown before anyone deletes their account.
export function deletionCopy(summary: Pick<DeletionSummary, 'role' | 'properties' | 'lastSuperAdmin'>) {
  const owner = summary.role === 'client';
  const deleted = [
    'Your name, email address, phone number and password.',
    'Your sign-in on every device, and the browsers and phones that get your notifications.',
    owner ? 'Your access to your properties, reports and statements in Recharge.' : 'Your access to properties, tools and messages.',
    'Your notifications and your saved requests.',
  ];
  const kept = [
    `Work, bookings, money and statements you were part of stay on record for ${BUSINESS_RECORD_YEARS} years, because UK law requires businesses to keep financial records. They show “Deleted user” instead of your name.`,
    'Messages you wrote in business conversations stay with those conversations, also under “Deleted user”.',
  ];
  const properties = owner && summary.properties > 0
    ? `Your ${summary.properties === 1 ? 'property stays' : summary.properties + ' properties stay'} with Recharge, no longer linked to this login, and so do the payout bank details for money already owed. Deleting your account does not end your management agreement: contact Recharge to end it.`
    : '';
  return { deleted, kept, properties, blocked: summary.lastSuperAdmin ? LAST_SUPER_ADMIN : '' };
}

// Saved file name for "Download my data", e.g. Recharge-my-data-2026-10-10.json.
export const exportFileName = (today = new Date()) => `Recharge-my-data-${today.toISOString().slice(0, 10)}.json`;
