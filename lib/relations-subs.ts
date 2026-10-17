import type { ModuleId } from './modules';
import { CLIENT_RELATIONS_SUBS, GUEST_RELATIONS_SUBS } from './workspace-map';
import { canUseFurnishingStudio } from './furnishing-studio';

// The sub-pages inside the two relations areas of Work (mobile/src/GuestRelations.tsx and
// ClientRelations.tsx): which a person gets, what each is called, and which opens first. The names
// are the ones deep links carry (lib/workspace-map.ts), so a link to `sub: 'pricing'` selects that chip.
export type GuestSub = (typeof GUEST_RELATIONS_SUBS)[number];
export type ClientSub = (typeof CLIENT_RELATIONS_SUBS)[number];

export const GUEST_SUB_LABEL: Record<GuestSub, string> = {
  cleans: 'Cleans', bookings: 'Direct bookings', aircover: 'AirCover', reactive: 'Reactive maintenance', preventative: 'Preventative maintenance',
};
export const CLIENT_SUB_LABEL: Record<ClientSub, string> = {
  onboarding: 'Onboarding', enquiries: 'Enquiries', licensing: 'Licensing', listings: 'Listing health', pricing: 'Pricing',
  reviews: 'Reviews', relisting: 'Re-listing', purchases: 'Purchase orders', furnishing: 'Furnishing Studio',
};

// The tools that open each sub-page. Admins get every one; anyone else gets the ones whose tool they
// hold. A sub-page with no tool (onboarding, enquiries) is for every role that has the area.
const GUEST_TOOLS: Record<GuestSub, readonly ModuleId[]> = {
  cleans: ['cleaning-schedule', 'clean-reporting'],
  bookings: ['direct-bookings'],
  aircover: ['aircover-reporting'],
  reactive: ['stays-maintenance-reporting', 'maintenance-reporting'],
  preventative: ['safety-maintenance', 'routine-bin-garden-board', 'ready-schedule'],
};
const CLIENT_TOOLS: Partial<Record<ClientSub, readonly ModuleId[]>> = {
  licensing: ['licensing'],
  listings: ['listing-health'],
  pricing: ['daily-pricing'],
  reviews: ['listing-health'],
  relisting: ['listing-health'],
  purchases: ['purchase-order', 'purchase-order-requests', 'purchase-order-accounts'],
};

const isAdmin = (role: string) => role === 'admin' || role === 'super_admin';
const holds = (modules: readonly string[], tools: readonly ModuleId[] | undefined) => !tools || tools.some(m => modules.includes(m));

// The sub-pages this person sees, in the order of the area. Never empty: someone holding none of the
// tools still gets the whole area, because the database decides what each list shows them.
export function guestSubsFor(role: string, modules: readonly string[]): GuestSub[] {
  const subs = GUEST_RELATIONS_SUBS.filter(sub => isAdmin(role) || holds(modules, GUEST_TOOLS[sub]));
  return subs.length ? subs : [...GUEST_RELATIONS_SUBS];
}
// Furnishing Studio is not a module: it is for the Stays team and management only (the database checks
// the same roles), so it never appears for anyone else, not even in the whole-area fallback.
export function clientSubsFor(role: string, modules: readonly string[]): ClientSub[] {
  const area = CLIENT_RELATIONS_SUBS.filter(sub => sub !== 'furnishing');
  const subs = area.filter(sub => isAdmin(role) || holds(modules, CLIENT_TOOLS[sub]));
  return [...(subs.length ? subs : area), ...(canUseFurnishingStudio(role) ? ['furnishing' as const] : [])];
}

// Where each area opens by default. Guest relations staff start with the cleans; management starts with
// the direct bookings waiting for a decision. Client relations always starts with onboarding.
export function defaultGuestSub(role: string, subs: readonly GuestSub[]): GuestSub {
  const first = isAdmin(role) ? 'bookings' : 'cleans';
  return subs.includes(first) ? first : subs[0] ?? 'cleans';
}
export function defaultClientSub(subs: readonly ClientSub[]): ClientSub {
  return subs.includes('onboarding') ? 'onboarding' : subs[0] ?? 'onboarding';
}

// The sub-page a deep link asks for when this person has it, else the default.
export function pickSub<T extends string>(subs: readonly T[], wanted: string | undefined, fallback: T): T {
  return subs.find(sub => sub === wanted) ?? fallback;
}
