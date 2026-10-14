import type { WorkflowField } from './workflow-forms';
import { DEFAULT_OWN_COST_CATEGORIES } from './agreement-template';
import type { OwnCost } from './estimate-projection';

// "Your own costs" on the estimate (migration 20261020890000): one optional monthly amount per category, the categories
// an admin keeps in Onboarding settings (the journey carries them for the team while the estimate can be published).
// Amounts left empty or at zero are left out; with none the estimate is published exactly as before.
export function ownCostCategories(j: unknown): string[] {
  const list = (j as { ownCostCategories?: unknown } | null)?.ownCostCategories;
  return Array.isArray(list) && list.length && list.every(c => typeof c === 'string') ? list as string[] : [...DEFAULT_OWN_COST_CATEGORIES];
}
export function ownCostFields(j: unknown): WorkflowField[] {
  return ownCostCategories(j).map((category, i) => ({
    name: `ownCost${i}`, label: `${category}, per month, GBP`, type: 'money', required: false,
    ...(i === 0 ? { section: 'Owner’s own costs (optional)', help: 'Their monthly costs, such as the mortgage and insurance. The estimate then shows their estimated net profit.' } : {}),
  }));
}
export function ownCostsFrom(j: unknown, values: Record<string, unknown>): { ownCosts?: OwnCost[] } {
  const costs = ownCostCategories(j).flatMap((category, i) => {
    const amount = values[`ownCost${i}`];
    return typeof amount === 'number' && amount > 0 ? [{ category, monthlyMinor: amount }] : [];
  });
  return costs.length ? { ownCosts: costs } : {};
}
