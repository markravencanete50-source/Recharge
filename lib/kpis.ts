import { z } from 'zod';
import { DEPARTMENT_LABEL } from './management-live';
import { DEPARTMENTS, KPI_MEASURES } from './workspace-teams-policy';

// The KPI tracker (supabase/migrations/20261015100000_kpi_tracker.sql): what the 'kpis' team read answers, and the
// shaping behind My performance, the Team performance list and the admin's KPI screen. Everything is a percentage:
// never a figure in pounds. A KPI with nothing to measure has no value (null), shown as "nothing to measure yet".

export type KpiMeasure = (typeof KPI_MEASURES)[number];
export type KpiArea = (typeof DEPARTMENTS)[number];

export const kpiMeasureSchema = z.object({ key: z.string(), label: z.string(), needsMinutes: z.boolean(), direction: z.enum(['higher', 'lower']), areas: z.array(z.string()) });
export const kpiSchema = z.object({
  id: z.string(), name: z.string(), area: z.string(), measure: z.string(), minutes: z.number().nullable(), direction: z.enum(['higher', 'lower']),
  targetPercent: z.number().nullable(), bonusTiers: z.array(z.number()), countsForBonus: z.boolean(), placeholder: z.boolean(), active: z.boolean(),
  sortOrder: z.number(), version: z.number(), updatedAt: z.string(),
  // Admins only.
  updatedByName: z.string().nullable().optional(),
});
export const kpiResultSchema = z.object({
  kpiId: z.string(), value: z.number().nullable(), measured: z.number(), count: z.number().nullable(),
  onTarget: z.boolean().nullable(), tier: z.number().nullable(), tierAt: z.number().nullable(),
});
export const replyBandsSchema = z.object({
  waits: z.number(), stillWaiting: z.number(),
  bands: z.array(z.object({ key: z.string(), minutes: z.number(), count: z.number().nullable(), measured: z.number(), value: z.number().nullable() })),
});
export const kpiReadSchema = z.object({
  from: z.string(), to: z.string(), canEdit: z.boolean(), myArea: z.string().nullable(),
  measures: z.array(kpiMeasureSchema), kpis: z.array(kpiSchema),
  people: z.array(z.object({ userId: z.string(), fullName: z.string().nullable(), role: z.string(), area: z.string().nullable(), results: z.array(kpiResultSchema), guestReplies: replyBandsSchema.nullable() })),
  teams: z.array(z.object({ area: z.string(), members: z.number(), results: z.array(kpiResultSchema), guestReplies: replyBandsSchema.nullable() })),
  changes: z.array(z.object({ kpiId: z.string(), change: z.string(), changedAt: z.string(), changedByName: z.string().nullable() })),
});
export type Kpi = z.infer<typeof kpiSchema>;
export type KpiResult = z.infer<typeof kpiResultSchema>;
export type KpiRead = z.infer<typeof kpiReadSchema>;
export type KpiMeasureInfo = z.infer<typeof kpiMeasureSchema>;

export const areaLabel = (area: string | null | undefined) => area ? DEPARTMENT_LABEL[area] ?? area : 'No area';
export const CHANGE_LABEL: Record<string, string> = { seeded: 'Set up', created: 'Added', edited: 'Edited', switched_off: 'Switched off', switched_on: 'Switched on', moved: 'Moved' };

// What a KPI measures, in words.
export function kpiMeasureLabel(kpi: Pick<Kpi, 'measure' | 'minutes'>): string {
  const n = kpi.minutes ?? 0, mins = `${n} ${n === 1 ? 'minute' : 'minutes'}`;
  switch (kpi.measure) {
    case 'guest_reply_within': return `Guest messages answered within ${mins}`;
    case 'guest_reply_over': return `Guest messages waiting over ${mins} (lower is better)`;
    case 'daily_work_done': return 'Daily work done against its targets';
    case 'performance_score': return 'Performance score';
    case 'clean_forms_on_time': return 'Cleaning forms in by 18:00 on the day';
    default: return kpi.measure;
  }
}

// The KPIs of an area in the admin's order: active ones only unless asked.
export function areaKpis(kpis: readonly Kpi[], area: string | null | undefined, includeOff = false): Kpi[] {
  return kpis.filter(k => k.area === area && (includeOff || k.active)).sort((a, b) => a.sortOrder - b.sortOrder);
}
export const bonusKpi = (kpis: readonly Kpi[], area: string | null | undefined) => kpis.find(k => k.area === area && k.active && k.countsForBonus) ?? null;

// --- The bonus bar -------------------------------------------------------------------------------------
export type KpiMark = { label: string; at: number; reached: boolean };
export type KpiProgress = {
  kpiId: string; name: string; area: string; areaLabel: string; measureLabel: string; placeholder: boolean; direction: 'higher' | 'lower';
  // 0 to 100, or null when there is nothing to measure yet in the period.
  value: number | null;
  // The target first, then each tier beyond it.
  marks: KpiMark[];
  // How many marks are reached: 0 short of the target, 1 the target, 2 tier 1, 3 tier 2.
  reached: number;
  headline: string; next: string;
};

const clamp = (v: number | null | undefined) => v == null || !Number.isFinite(v) ? null : Math.max(0, Math.min(100, Math.round(v)));

// Where a value stands against a KPI's target and tiers. Null when the KPI has no target (tracked only).
export function kpiProgress(kpi: Kpi, result: Pick<KpiResult, 'value'> | null | undefined): KpiProgress | null {
  if (kpi.targetPercent === null) return null;
  const lower = kpi.direction === 'lower', target = kpi.targetPercent, value = clamp(result?.value);
  const meets = (at: number) => value !== null && (lower ? value <= at : value >= at);
  const tiers = [...new Set(kpi.bonusTiers)].filter(t => lower ? t < target : t > target).sort((a, b) => lower ? b - a : a - b);
  const marks: KpiMark[] = [{ label: 'Target', at: target, reached: meets(target) }, ...tiers.map((at, i) => ({ label: `Tier ${i + 1}`, at, reached: meets(at) }))];
  const reached = marks.filter(m => m.reached).length, upcoming = marks[reached] ?? null;
  const next = upcoming ? `${upcoming.label === 'Target' ? 'The target is' : upcoming.label + ' starts at'} ${upcoming.at}%${lower ? ' or less' : ''}.` : 'That is the top tier.';
  const headline = value === null ? 'Nothing to measure yet'
    : reached === 0 ? (lower ? `${value - target}% above the target` : `${target - value}% to go to the target`)
    : reached === 1 ? 'Target reached'
    : `Bonus tier ${reached - 1} reached`;
  return { kpiId: kpi.id, name: kpi.name, area: kpi.area, areaLabel: areaLabel(kpi.area), measureLabel: kpiMeasureLabel(kpi), placeholder: kpi.placeholder, direction: kpi.direction, value, marks, reached, headline, next };
}

// One line per KPI under the bar: the value and where it stands.
export type KpiRow = { kpiId: string; name: string; value: string; note: string; tone: 'good' | 'bad' | 'plain' };
export function kpiRow(kpi: Kpi, result: KpiResult | null | undefined): KpiRow {
  const value = result?.value ?? null;
  const shown = value === null ? 'Nothing to measure yet' : `${value}%`;
  const note = value === null || kpi.targetPercent === null ? (kpi.targetPercent === null ? 'Tracked' : '')
    : result?.tier ? `Bonus tier ${result.tier}` : result?.onTarget ? 'On target' : `Target ${kpi.direction === 'lower' ? 'at most ' : ''}${kpi.targetPercent}%`;
  const tone = value === null || kpi.targetPercent === null ? 'plain' : result?.onTarget ? 'good' : 'bad';
  return { kpiId: kpi.id, name: kpi.name, value: shown, note, tone };
}

export type MyKpis = { area: string | null; areaLabel: string; bonus: KpiProgress | null; rows: KpiRow[] };
// A person's own KPIs from the read: the bonus bar from their area's bonus KPI and every other active KPI as a row.
// Only their own row: when the id is known and missing there is nothing; with no id, a list of one is theirs.
export function myKpis(read: Pick<KpiRead, 'kpis' | 'people'>, userId: string | null | undefined): MyKpis | null {
  const me = userId ? read.people.find(p => p.userId === userId) : read.people.length === 1 ? read.people[0] : undefined;
  if (!me) return null;
  const find = (id: string) => me.results.find(r => r.kpiId === id) ?? null;
  const kpis = areaKpis(read.kpis, me.area), bonus = bonusKpi(read.kpis, me.area);
  return {
    area: me.area, areaLabel: areaLabel(me.area),
    bonus: bonus ? kpiProgress(bonus, find(bonus.id)) : null,
    rows: kpis.filter(k => k.id !== bonus?.id).map(k => kpiRow(k, find(k.id))),
  };
}

// The tier line on the Team performance list: the person's bonus KPI, its value and the tier reached.
export function bonusTag(read: Pick<KpiRead, 'kpis' | 'people'>, userId: string): [string, 'good' | 'bad' | 'plain'] | null {
  const person = read.people.find(p => p.userId === userId);
  const kpi = person && bonusKpi(read.kpis, person.area);
  if (!person || !kpi) return null;
  const r = person.results.find(x => x.kpiId === kpi.id);
  if (!r || r.value === null) return [`${kpi.name}: nothing to measure yet`, 'plain'];
  if (r.tier) return [`Bonus tier ${r.tier} · ${kpi.name} ${r.value}%`, 'good'];
  return [`${kpi.name} ${r.value}%${r.onTarget ? ' · on target' : ''}`, r.onTarget ? 'good' : 'bad'];
}

// --- The admin form -------------------------------------------------------------------------------------
export type KpiForm = { name: string; area: string; measure: string; minutes: string; target: string; tiers: string; countsForBonus: boolean; placeholder: boolean };
export const emptyKpiForm = (area: string = 'guest_relations'): KpiForm => ({ name: '', area, measure: '', minutes: '', target: '', tiers: '', countsForBonus: false, placeholder: false });
export const kpiForm = (k: Kpi): KpiForm => ({
  name: k.name, area: k.area, measure: k.measure, minutes: k.minutes === null ? '' : String(k.minutes), target: k.targetPercent === null ? '' : String(k.targetPercent),
  tiers: k.bonusTiers.join(', '), countsForBonus: k.countsForBonus, placeholder: k.placeholder,
});
const whole = (s: string) => /^\d{1,4}$/.test(s.trim()) ? Number(s.trim()) : NaN;

// The fields the saveKpi action takes, or the first thing to fix. The database checks the same again.
export function kpiInput(form: KpiForm, measures: readonly KpiMeasureInfo[]): { value: { name: string; area: KpiArea; measure: KpiMeasure; minutes: number | null; targetPercent: number | null; bonusTiers: number[]; countsForBonus: boolean; placeholder: boolean } } | { error: string } {
  const name = form.name.trim();
  if (name.length < 2 || name.length > 120) return { error: 'Give the KPI a name.' };
  if (!(DEPARTMENTS as readonly string[]).includes(form.area)) return { error: 'Choose an area.' };
  const m = measures.find(x => x.key === form.measure);
  if (!m || !(KPI_MEASURES as readonly string[]).includes(m.key)) return { error: 'Choose what it measures.' };
  if (!m.areas.includes(form.area)) return { error: `That measure does not fit ${areaLabel(form.area).toLowerCase()}.` };
  let minutes: number | null = null;
  if (m.needsMinutes) {
    minutes = whole(form.minutes);
    if (!(minutes >= 1 && minutes <= 1440)) return { error: 'Set the minutes, from 1 to 1440.' };
  }
  let target: number | null = null;
  if (form.target.trim()) {
    target = whole(form.target);
    if (!(target >= 0 && target <= 100)) return { error: 'The target is a percentage from 0 to 100.' };
  }
  const parts = form.tiers.split(/[,\s]+/).filter(Boolean), tiers = [...new Set(parts.map(whole))].sort((a, b) => a - b);
  if (tiers.some(t => !(t >= 0 && t <= 100)) || tiers.length > 5) return { error: 'Bonus tiers are up to five percentages from 0 to 100, separated by commas.' };
  if (tiers.length && target === null) return { error: 'Set a target before the bonus tiers.' };
  if (target !== null && m.direction === 'higher' && tiers.some(t => t <= target)) return { error: 'Each bonus tier must be above the target.' };
  if (target !== null && m.direction === 'lower' && tiers.some(t => t >= target)) return { error: 'Lower is better here, so each bonus tier must be below the target.' };
  if (form.countsForBonus && target === null) return { error: 'A bonus KPI needs a target.' };
  return { value: { name, area: form.area as KpiArea, measure: m.key as KpiMeasure, minutes, targetPercent: target, bonusTiers: tiers, countsForBonus: form.countsForBonus, placeholder: form.placeholder } };
}
