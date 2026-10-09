import { z } from 'zod';
import { plural } from './format';

// Clean checklists with photo rules: admins and cleaning managers keep one checklist for every
// property and, where a property differs, one for that property. A check can need photos (1 to 5).
// The cleaner takes those photos on the check itself, and cannot submit the clean until every
// check is ticked and has its photos. The database decides who may read or change each of these.
const uuid = z.string().uuid();
export const checklistReadSchema = z.discriminatedUnion('section', [
  z.object({ section: z.literal('templates') }).strict(),
  z.object({ section: z.literal('clean'), workId: uuid }).strict(),
]);
export const MAX_ITEM_PHOTOS = 5;
const itemInput = z.object({
  label: z.string().trim().min(1, 'Name every check').max(200, 'Keep each check under 200 characters'),
  photoRequired: z.boolean(),
  minPhotos: z.number().int().min(1).max(MAX_ITEM_PHOTOS).optional(),
}).strict();
export const checklistActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('saveTemplate'), requestId: uuid, propertyId: uuid.nullable(), version: z.number().int().min(0), items: z.array(itemInput).min(1, 'Add at least one check').max(30, 'Up to 30 checks') }).strict(),
  z.object({ action: z.literal('removeTemplate'), requestId: uuid, propertyId: uuid.nullable(), version: z.number().int().min(1) }).strict(),
]);
export type ChecklistAction = z.infer<typeof checklistActionSchema>;

export const templateItemSchema = z.object({ label: z.string(), photoRequired: z.boolean(), minPhotos: z.number().int().optional() });
export type TemplateItem = z.infer<typeof templateItemSchema>;
export const templatesSchema = z.object({
  canEdit: z.boolean(),
  templates: z.array(z.object({ propertyId: uuid.nullable(), propertyName: z.string().nullable(), items: z.array(templateItemSchema), version: z.number(), updatedAt: z.string() })),
});
export type ChecklistTemplate = z.infer<typeof templatesSchema>['templates'][number];
export const photoRuleSchema = z.object({ label: z.string(), minPhotos: z.number().int().min(1) });
export type PhotoRule = z.infer<typeof photoRuleSchema>;
export const cleanRulesSchema = z.object({ workId: uuid, rules: z.array(photoRuleSchema) });

// The checklist that applies at a property: its own, otherwise the one for every property.
export const templateFor = (templates: ChecklistTemplate[], propertyId: string | null | undefined) =>
  templates.find(t => !!propertyId && t.propertyId === propertyId) ?? templates.find(t => t.propertyId === null) ?? null;

// Where a cleaner is up to: checks ticked, and photos still needed on checks that need them.
export type ChecklistProgress = { done: number; total: number; photosNeeded: number; unticked: string[]; missing: { label: string; missing: number }[] };
export function checklistProgress(checklist: string[], ticked: readonly string[], rules: PhotoRule[], photos: Record<string, number>): ChecklistProgress {
  const on = new Set(ticked);
  const missing = rules.filter(r => checklist.includes(r.label)).map(r => ({ label: r.label, missing: Math.max(0, r.minPhotos - (photos[r.label] ?? 0)) })).filter(x => x.missing > 0);
  return { done: checklist.filter(c => on.has(c)).length, total: checklist.length, photosNeeded: missing.reduce((n, x) => n + x.missing, 0), unticked: checklist.filter(c => !on.has(c)), missing };
}
// "12 of 18 done · 3 photos needed"
export const progressCounter = (p: ChecklistProgress) => `${p.done} of ${p.total} done${p.photosNeeded ? ` · ${plural(p.photosNeeded, 'photo')} needed` : ''}`;

const names = (labels: string[]) => labels.length === 1 ? labels[0] : labels.length === 2 ? `${labels[0]} and ${labels[1]}` : `${labels[0]}, ${labels[1]} and ${plural(labels.length - 2, 'more check')}`;
// Why Submit is not available yet, in the order the cleaner fixes them; empty when it is.
export function submitBlockers(p: ChecklistProgress, state: { report: string; savedPhotos: number; uploading: boolean }): string[] {
  const out: string[] = [];
  if (!p.total) out.push('This clean has no checklist yet. Ask your cleaning manager.');
  if (p.unticked.length) out.push(p.unticked.length === 1 ? `Tick the last check: ${p.unticked[0]}.` : `Tick ${p.unticked.length} more checks.`);
  if (p.missing.length) out.push(`Add the photos for ${names(p.missing.map(m => m.label))}.`);
  if (!state.savedPhotos) out.push('Add at least one photo of the clean.');
  if (state.report.trim().length < 5) out.push('Write a short report.');
  if (state.uploading) out.push('Wait for your photos to finish saving.');
  return out;
}
