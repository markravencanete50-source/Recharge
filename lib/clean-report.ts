import { z } from 'zod';

// The post-clean report from the cleaners' form: the questions the cleaner answers after each
// clean, besides the checklist and photos. The database checks the same values
// (private.workspace_clean_condition).
export const CLEAN_QUESTIONS = [
  { key: 'broadband', label: 'Is the broadband working?', options: [['working', 'Working'], ['not_working', 'Not working'], ['none', 'No broadband']] },
  { key: 'heatingHotWater', label: 'Are the heating and hot water working?', options: [['working', 'Working'], ['not_working', 'Not working']] },
  { key: 'bins', label: 'Do the bins need emptying?', options: [['fine', 'No'], ['need_emptying', 'Yes, they need emptying']] },
  { key: 'garden', label: 'Does the grass need cut?', options: [['fine', 'No'], ['needs_cut', 'Yes'], ['none', 'No garden']] },
  { key: 'prepaymentMeter', label: 'Prepayment meter: more than £10 on it?', options: [['over_10', 'Yes, more than £10'], ['under_10', 'No, £10 or less'], ['none', 'No prepayment meter']] },
  { key: 'cutlery', label: 'Is there enough cutlery?', options: [['enough', 'Yes'], ['short', 'No, some is missing']] },
  { key: 'letters', label: 'Any letters?', options: [['none', 'No'], ['some', 'Yes']] },
] as const;
export type CleanQuestionKey = typeof CLEAN_QUESTIONS[number]['key'];

const text = (n: number) => z.string().trim().max(n);
const answer = <T extends readonly (readonly [string, string])[]>(options: T) => z.enum(options.map(o => o[0]) as [string, ...string[]]);
export const cleanConditionSchema = z.object({
  ...Object.fromEntries(CLEAN_QUESTIONS.map(q => [q.key, answer(q.options).optional()])) as Record<CleanQuestionKey, z.ZodOptional<z.ZodEnum<[string, ...string[]]>>>,
  repairs: text(2000).optional(),
  itemOrder: z.array(z.object({ item: text(120).min(1), quantity: z.number().int().min(1).max(100) }).strict()).max(20).optional(),
  recommendations: text(2000).optional(),
}).strict();
export type CleanCondition = { [K in CleanQuestionKey]?: string } & { repairs?: string; itemOrder?: { item: string; quantity: number }[]; recommendations?: string };

// Answers that need someone to act, worded for the team reading the report.
const ATTENTION: Partial<Record<CleanQuestionKey, string>> = {
  broadband: 'not_working', heatingHotWater: 'not_working', bins: 'need_emptying', garden: 'needs_cut', prepaymentMeter: 'under_10', cutlery: 'short', letters: 'some',
};
export function readCleanCondition(raw: unknown): CleanCondition | null {
  const parsed = cleanConditionSchema.safeParse(raw);
  return parsed.success && Object.keys(parsed.data).length ? parsed.data as CleanCondition : null;
}
export function cleanAnswers(c: CleanCondition): { label: string; answer: string; attention: boolean }[] {
  return CLEAN_QUESTIONS.filter(q => c[q.key]).map(q => ({
    label: q.label, answer: q.options.find(o => o[0] === c[q.key])?.[1] ?? '', attention: ATTENTION[q.key] === c[q.key],
  }));
}
// What a purchase order raised from the clean starts with: the items to order, plus cutlery if short.
export function purchaseFromClean(c: CleanCondition): string {
  const lines = (c.itemOrder ?? []).map(i => `${i.quantity} × ${i.item}`);
  if (c.cutlery === 'short' && !lines.some(l => /cutlery/i.test(l))) lines.push('Cutlery to replace what is missing');
  return lines.length ? 'From the clean report:\n' + lines.join('\n') : '';
}
// What a reactive maintenance job raised from the clean starts with.
export function repairFromClean(c: CleanCondition): string {
  const lines = [
    c.broadband === 'not_working' && 'The broadband is not working.',
    c.heatingHotWater === 'not_working' && 'The heating or hot water is not working.',
    c.repairs,
  ].filter((x): x is string => !!x);
  return lines.join('\n');
}
