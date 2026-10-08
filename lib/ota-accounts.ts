import { z } from 'zod';

// Platform logins for a property, one row per platform: which account is used, who holds it,
// where the password is kept and who receives the security code. The password itself is never
// stored in Recharge; it stays in a password manager.
export const OTA_PLATFORMS = ['Airbnb', 'Booking.com', 'Vrbo', 'Direct', 'Channel manager', 'Comfy Workers', 'Google', 'Other'] as const;
export const HOLDER_LABEL = { recharge: 'Recharge account', owner: 'Owner’s account' } as const;
// A typed password or PIN (for example "password: Summer2024!") is refused, so none ends up here.
export const looksLikePassword = (value: string) => /\b(pass(word)?|pwd|pw|pin)\s*[:=]\s*\S/i.test(value);
const text = (max: number) => z.string().trim().max(max).refine(v => !looksLikePassword(v), 'Don’t type passwords here. Say where the password is kept instead.');
export const otaAccountSchema = z.object({
  platform: z.string().trim().min(1, 'Choose the platform').max(40),
  login: text(200), holder: z.enum(['recharge', 'owner']),
  passwordWhere: text(200), twoFactor: text(200), notes: text(500),
}).strict();
export const otaAccountsSchema = z.array(otaAccountSchema).max(20);
export type OtaAccount = z.infer<typeof otaAccountSchema>;
export const blankOtaAccount = (platform: string = 'Airbnb'): OtaAccount => ({ platform, login: '', holder: 'recharge', passwordWhere: '', twoFactor: '', notes: '' });
// Stored rows read back loosely: older or partial rows still show.
export const storedOtaAccountsSchema = z.array(z.object({
  platform: z.string().default(''), login: z.string().default(''), holder: z.enum(['recharge', 'owner']).catch('recharge'),
  passwordWhere: z.string().default(''), twoFactor: z.string().default(''), notes: z.string().default(''),
})).catch([]);
