import { z } from 'zod';

// The owner's estimate, explored: pick a nightly rate scenario, an occupancy and a booking mix, and
// see what the property could earn. The sums match the team's estimate model in the database
// (management fee on gross; platform fees on the share not booked direct), so the owner and the
// team always see the same figures for the same choices.
const bps = z.number().int().min(0).max(10000);
export const publishedEstimateSchema = z.object({
  lowRateMinor: z.number().int().min(0), mediumRateMinor: z.number().int().min(0), highRateMinor: z.number().int().min(0),
  occupancyBps: bps.optional(), directBookingBps: bps.optional(), otaFeeBps: bps.optional(), managementFeeBps: bps.optional(),
}).passthrough();
export type PublishedEstimate = z.infer<typeof publishedEstimateSchema>;
export type Scenario = 'low' | 'medium' | 'high';
export const SCENARIOS: { id: Scenario; label: string }[] = [{ id: 'low', label: 'Quieter' }, { id: 'medium', label: 'Expected' }, { id: 'high', label: 'Strong' }];
export type Choices = { scenario: Scenario; occupancyBps: number; directBookingBps: number };
export type Projection = {
  rateMinor: number; occupiedNights: number;
  grossMinor: number; platformFeesMinor: number | null; managementFeesMinor: number | null; ownerMinor: number | null;
  monthlyOwnerMinor: number | null; monthlyGrossMinor: number;
};

export const AVAILABLE_NIGHTS = 365;
export const OCCUPANCY_RANGE = { min: 3000, max: 9500, step: 500 };
export const DIRECT_RANGE = { min: 0, max: 5000, step: 500 };

// What the team published, read safely. Fees are only used when the team published them.
export function readEstimate(estimate: Record<string, unknown> | null | undefined): PublishedEstimate | null {
  const parsed = publishedEstimateSchema.safeParse(estimate ?? null);
  return parsed.success && parsed.data.mediumRateMinor > 0 ? parsed.data : null;
}
export const hasFees = (e: PublishedEstimate) => e.managementFeeBps !== undefined && e.otaFeeBps !== undefined;
export function startingChoices(e: PublishedEstimate): Choices {
  return { scenario: 'medium', occupancyBps: snap(e.occupancyBps ?? 7000, OCCUPANCY_RANGE), directBookingBps: snap(e.directBookingBps ?? 1000, DIRECT_RANGE) };
}
export function snap(value: number, range: { min: number; max: number; step: number }) {
  return Math.min(range.max, Math.max(range.min, Math.round(value / range.step) * range.step));
}

export function project(e: PublishedEstimate, c: Choices): Projection {
  const rateMinor = c.scenario === 'low' ? e.lowRateMinor : c.scenario === 'high' ? e.highRateMinor : e.mediumRateMinor;
  const occupancy = snap(c.occupancyBps, { min: 0, max: 10000, step: 1 }), direct = snap(c.directBookingBps, { min: 0, max: 10000, step: 1 });
  const grossMinor = Math.round(rateMinor * AVAILABLE_NIGHTS * occupancy / 10000);
  const fees = hasFees(e);
  const platformFeesMinor = fees ? Math.round(grossMinor * (10000 - direct) * e.otaFeeBps! / 100000000) : null;
  const managementFeesMinor = fees ? Math.round(grossMinor * e.managementFeeBps! / 10000) : null;
  const ownerMinor = fees ? grossMinor - platformFeesMinor! - managementFeesMinor! : null;
  return {
    rateMinor, occupiedNights: Math.round(AVAILABLE_NIGHTS * occupancy / 10000),
    grossMinor, platformFeesMinor, managementFeesMinor, ownerMinor,
    monthlyOwnerMinor: ownerMinor === null ? null : Math.round(ownerMinor / 12), monthlyGrossMinor: Math.round(grossMinor / 12),
  };
}

// How much more the owner keeps when more guests book direct, all else equal.
export function directBookingGain(e: PublishedEstimate, c: Choices): number | null {
  if (!hasFees(e)) return null;
  const now = project(e, c).ownerMinor!, none = project(e, { ...c, directBookingBps: 0 }).ownerMinor!;
  return now - none;
}
