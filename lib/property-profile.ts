import { z } from 'zod';
import { formatDay, formatMoney } from './format';
import type { WorkspaceAccount } from './workspace-account-policy';

// The property page: who can read which part, and how each part reads. The rules mirror the
// database's own checks, so nobody is offered a section the server will refuse.
const admin = (a: WorkspaceAccount) => a.role === 'admin' || a.role === 'super_admin';
const has = (a: WorkspaceAccount, module: WorkspaceAccount['modules'][number]) => a.modules.includes(module);
export function profileAccess(a: WorkspaceAccount) {
  return {
    owners: admin(a) || (a.role === 'stays' && has(a, 'property-database')) || (a.role === 'accounts' && has(a, 'owner-statements')),
    listings: ((admin(a) || a.role === 'stays') && has(a, 'property-database')) || (a.role === 'client' && has(a, 'client-dashboard')),
    stays: (admin(a) || a.role === 'stays') && has(a, 'daily-pricing'),
    payout: (admin(a) && has(a, 'owner-statements')) || (a.role === 'client' && has(a, 'client-dashboard')),
  };
}

// Only a name and an email per owner ever leave the server.
const ownerContactSchema = z.object({ name: z.string().max(200), email: z.string().max(320).nullable() });
export function ownerContacts(value: unknown) {
  return (Array.isArray(value) ? value : []).flatMap(owner => { const parsed = ownerContactSchema.safeParse(owner); return parsed.success ? [{ name: parsed.data.name, email: parsed.data.email ?? '' }] : []; }).slice(0, 20);
}
export const ownersSchema = z.object({ owners: z.array(z.object({ name: z.string(), email: z.string() })) });
export type Owner = z.infer<typeof ownersSchema>['owners'][number];

const linkSchema = z.object({ platform: z.string().max(80), url: z.string().optional(), listingId: z.string().max(100).optional() });
export type ListingLink = { platform: string; url: string; listingId: string };
// The property's listings from the portfolio read: a platform with an HTTPS link, its listing ID, or both.
export function listingLinks(portfolio: unknown, propertyId: string): ListingLink[] {
  const properties = z.object({ properties: z.array(z.object({ id: z.string(), listingLinks: z.unknown() }).passthrough()) }).safeParse(portfolio);
  const links = properties.success ? properties.data.properties.find(p => p.id === propertyId)?.listingLinks : undefined;
  return (Array.isArray(links) ? links : []).flatMap(link => {
    const parsed = linkSchema.safeParse(link);
    if (!parsed.success) return [];
    let url = '';
    try { url = parsed.data.url && new URL(parsed.data.url).protocol === 'https:' ? parsed.data.url : ''; } catch { url = ''; }
    const listingId = /^[A-Za-z0-9._:-]{1,100}$/.test(parsed.data.listingId ?? '') ? parsed.data.listingId! : '';
    return url || listingId ? [{ platform: parsed.data.platform, url, listingId }] : [];
  });
}

// What the owner told us in the property set-up form, in plain words. Bank details and access
// instructions never reach this: the database strips them from the onboarding view.
const MAIL: Record<string, string> = { photograph: 'Photograph the post', open_and_photograph: 'Open and photograph the post', leave_safely: 'Leave the post somewhere safe' };
const FURNISHING: Record<string, string> = { self: 'Owner furnishes', recharge: 'Recharge furnishes' };
const yes = (v: unknown) => v === true ? 'Yes' : v === false ? 'No' : '';
export type Answer = { label: string; value: string; group: 'owner' | 'ready' | 'repairs' | 'setup' };
export function setupAnswers(form: Record<string, unknown> | null | undefined): Answer[] {
  if (!form) return [];
  const text = (k: string) => typeof form[k] === 'string' ? String(form[k]).trim() : '';
  const day = (k: string) => text(k) ? formatDay(text(k)) : '';
  const rows: Answer[] = [
    { group: 'owner', label: 'Business or owner name', value: text('businessName') },
    { group: 'owner', label: 'First access date', value: day('accessDate') },
    { group: 'ready', label: 'Utilities connected', value: yes(form.utilitiesConnected) },
    { group: 'ready', label: 'Utilities connection planned', value: form.utilitiesConnected === true ? '' : day('utilityInstallDate') },
    { group: 'ready', label: 'Prepayment meters', value: yes(form.prepaymentMeters) },
    { group: 'ready', label: 'Switch to credit meter', value: form.prepaymentMeters === true ? day('creditSwitchDate') : '' },
    { group: 'ready', label: 'Broadband connected', value: yes(form.broadbandConnected) },
    { group: 'ready', label: 'Broadband installation planned', value: form.broadbandConnected === true ? '' : day('broadbandInstallDate') },
    { group: 'ready', label: 'Garden', value: yes(form.hasGarden) },
    { group: 'repairs', label: 'Repairs approved without asking, per job', value: form.fullRepairPermission === true ? 'Any amount' : typeof form.repairLimitMinor === 'number' ? formatMoney(form.repairLimitMinor) : '' },
    { group: 'repairs', label: 'Warranties', value: text('warrantyDetails') },
    { group: 'repairs', label: 'Contact first for repairs', value: text('preferredRepairContact') },
    { group: 'setup', label: 'Post', value: MAIL[text('mailPreference')] ?? '' },
    { group: 'setup', label: 'Furnishing', value: FURNISHING[text('furnishingChoice')] ?? '' },
    { group: 'setup', label: 'Licensing support', value: yes(form.licensingRequired) },
  ];
  return rows.filter(r => r.value);
}

export const reservationsSchema = z.array(z.object({ id: z.string(), reference: z.string(), check_in: z.string(), check_out: z.string(), status: z.string(), source: z.string() }).passthrough());
export type Reservation = z.infer<typeof reservationsSchema>[number];
const nightsBetween = (from: string, to: string) => Math.round((Date.parse(to.slice(0, 10) + 'T12:00:00Z') - Date.parse(from.slice(0, 10) + 'T12:00:00Z')) / 86_400_000);
export type StayLine = { id: string; reference: string; dates: string; nights: number; source: string; status: string; when: 'now' | 'upcoming' | 'past' };
// Stays at the property: in house and upcoming first (soonest first), then the most recent past ones.
export function stayLines(rows: readonly Reservation[], today: string, limit = 8): StayLine[] {
  const line = (r: Reservation): StayLine => ({
    id: r.id, reference: r.reference, nights: nightsBetween(r.check_in, r.check_out),
    dates: `${formatDay(r.check_in, new Date(today + 'T12:00:00Z'))} → ${formatDay(r.check_out, new Date(today + 'T12:00:00Z'))}`,
    source: r.source === 'hostaway' ? 'Channel manager' : 'Added in Recharge', status: r.status,
    when: r.check_in <= today && r.check_out > today ? 'now' : r.check_in > today ? 'upcoming' : 'past',
  });
  const active = rows.filter(r => r.status !== 'cancelled');
  const ahead = active.filter(r => r.check_out > today).sort((a, b) => a.check_in.localeCompare(b.check_in));
  const past = active.filter(r => r.check_out <= today).sort((a, b) => b.check_in.localeCompare(a.check_in));
  return [...ahead, ...past].slice(0, limit).map(line);
}

// Only the last four digits of an account number are shown until the person asks for the rest.
export const maskAccount = (number: string) => { const digits = number.replace(/\D/g, ''); return digits.length > 4 ? '•••• ' + digits.slice(-4) : digits; };
export const payoutSchema = z.object({ bankAccountName: z.string().nullable(), bankAccountNumber: z.string().nullable(), bankSortCode: z.string().nullable() }).partial();
