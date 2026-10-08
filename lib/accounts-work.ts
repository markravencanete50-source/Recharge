import { z } from 'zod';
import type { OperationView } from './workflow-forms';

// The budget chart: the most one of each item should cost.
export const budgetChartSchema = z.array(z.object({ id: z.string().uuid(), item: z.string(), maxUnitMinor: z.number(), note: z.string(), version: z.number() }));
export type BudgetItem = z.infer<typeof budgetChartSchema>[number];

// Accepted cleans waiting to be invoiced, grouped by cleaner (most cleans first), so several can
// go on one invoice.
export type CleanerGroup = { cleanerId: string; cleanerName: string; tasks: { workId: string; version: number; propertyName: string; cleanedOn: string | null }[] };
export function cleanerInvoiceGroups(work: readonly OperationView[], propertyName: (id: string) => string): CleanerGroup[] {
  const groups = new Map<string, CleanerGroup>();
  for (const w of work) {
    if (w.kind !== 'cleaning_invoice' || ['completed', 'cancelled'].includes(w.status) || typeof w.data.cleanerId !== 'string') continue;
    const g = groups.get(w.data.cleanerId) ?? { cleanerId: w.data.cleanerId, cleanerName: typeof w.data.cleanerName === 'string' && w.data.cleanerName ? w.data.cleanerName : 'Cleaner', tasks: [] };
    g.tasks.push({ workId: w.workId, version: w.version, propertyName: propertyName(w.propertyId), cleanedOn: typeof w.data.cleanedOn === 'string' ? w.data.cleanedOn : null });
    groups.set(w.data.cleanerId, g);
  }
  return [...groups.values()].map(g => ({ ...g, tasks: g.tasks.sort((a, b) => (a.cleanedOn ?? '').localeCompare(b.cleanedOn ?? '')) }))
    .sort((a, b) => b.tasks.length - a.tasks.length || a.cleanerName.localeCompare(b.cleanerName));
}
