import type { PropertyView } from './workspace-view';
import { normaliseRegion } from './regions';
import type { JourneyView } from './workflow-forms';

// Clients who asked for more time on their estimate, whose check-in date has arrived.
export type FollowUp = { propertyId: string; propertyName: string; followUpOn: string; feedback: string; overdueDays: number };
export function followUpsDue(journeys: JourneyView[], properties: Pick<PropertyView, 'id' | 'name'>[], today: string): FollowUp[] {
  const names = new Map(properties.map(p => [p.id, p.name]));
  return journeys
    .filter(j => j.stage === 'reviewing' && typeof j.followUpOn === 'string' && j.followUpOn <= today)
    .map(j => ({ propertyId: j.propertyId, propertyName: names.get(j.propertyId) ?? 'Property', followUpOn: j.followUpOn as string, feedback: j.feedback ?? '',
      overdueDays: Math.round((Date.parse(today + 'T12:00:00Z') - Date.parse(j.followUpOn + 'T12:00:00Z')) / 86_400_000) }))
    .sort((a, b) => a.followUpOn.localeCompare(b.followUpOn) || a.propertyName.localeCompare(b.propertyName));
}

// The whole portfolio at a glance: live, onboarding, owners and properties per region.
export type PortfolioSummary = { total: number; live: number; onboarding: number; archived: number; owners: number; regions: { region: string; count: number }[] };
export function portfolioSummary(properties: (Pick<PropertyView, 'id' | 'region' | 'status'> & { address?: string })[], journeys: Pick<JourneyView, 'propertyId' | 'clientId'>[]): PortfolioSummary {
  const current = properties.filter(p => p.status !== 'archived');
  const regions = new Map<string, number>();
  for (const p of current) { const region = normaliseRegion(p.region, 'address' in p ? String(p.address) : '') || 'Region not set'; regions.set(region, (regions.get(region) ?? 0) + 1); }
  const ids = new Set(current.map(p => p.id));
  return {
    total: current.length, live: current.filter(p => p.status === 'active').length, onboarding: current.filter(p => p.status === 'onboarding').length,
    archived: properties.length - current.length,
    owners: new Set(journeys.filter(j => ids.has(j.propertyId)).map(j => j.clientId)).size,
    regions: [...regions].map(([region, count]) => ({ region, count })).sort((a, b) => b.count - a.count || a.region.localeCompare(b.region)),
  };
}
