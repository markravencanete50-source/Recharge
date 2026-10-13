import { poundsToMinor } from './repairs-live';
import type { Claim } from './tracker-aircover';
import type { TeamsAction } from './workspace-teams-policy';

// Flagging a maintenance ticket as an AirCover claim (client ask B4). The database (migration
// 20261012190000_aircover_links) lets any team role that can work the ticket, or that keeps AirCover
// claims, do it; the repair sheet offers it to Stays, Ready, Accounts and admins. One ticket has at most
// one claim in progress, and the server refuses a second with its own message.
export const AIRCOVER_FLAG_ROLES = ['stays', 'ready', 'accounts', 'admin', 'super_admin'] as const;
export const canFlagAirCover = (role: string | null | undefined): boolean => !!role && (AIRCOVER_FLAG_ROLES as readonly string[]).includes(role);

export const AIRCOVER_REFERENCE_MAX = 120;
// The most the database accepts for one claim, in pence.
export const AIRCOVER_AMOUNT_MAX_MINOR = 10000000;

// True when the ticket already has a claim in progress (to claim or claimed). A paid or declined claim
// does not count: the database allows a new one after that.
export function hasLiveClaim(claims: readonly Pick<Claim, 'status' | 'workId' | 'issue'>[], workId: string): boolean {
  return claims.some(c => (c.workId ?? c.issue?.workId) === workId && (c.status === 'to_claim' || c.status === 'claimed'));
}

// The flagAirCover action: the amount (pounds, optional) and the AirCover reference (optional).
export function flagAirCoverAction(workId: string, amount: string, reference: string, requestId: string): { action: Extract<TeamsAction, { action: 'flagAirCover' }> } | { error: string } {
  const ref = reference.trim();
  if (ref.length > AIRCOVER_REFERENCE_MAX) return { error: `Keep the reference under ${AIRCOVER_REFERENCE_MAX} characters.` };
  let amountMinor: number | undefined;
  if (amount.trim()) {
    const money = poundsToMinor(amount);
    if (money === null || money > AIRCOVER_AMOUNT_MAX_MINOR) return { error: 'Enter the amount in pounds, like 120 or 120.50.' };
    amountMinor = money;
  }
  return { action: { action: 'flagAirCover', requestId, workId, ...(amountMinor !== undefined ? { amountMinor } : {}), ...(ref ? { reference: ref } : {}) } };
}
