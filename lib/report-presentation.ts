import { buildAnalytics, periodLabel, type AnalyticsPeriod, type AnalyticsSnapshot } from './analytics';

export function comparison(value: number, before: number, duration: number) {
  if (value === before) return { text: 'Same as before', direction: 'same' as const };
  if (before === 0) return { text: 'New this period', direction: 'up' as const };
  return { text: `${value > before ? 'Up' : 'Down'} from ${before} in the previous ${duration} ${duration === 1 ? 'day' : 'days'}`, direction: value > before ? 'up' as const : 'down' as const };
}

// All report values come from buildAnalytics, including the export and table.
export function reportPresentation(snapshot: AnalyticsSnapshot, period: AnalyticsPeriod) {
  const current = buildAnalytics(snapshot, period);
  const duration = (Date.parse(period.to + 'T00:00:00Z') - Date.parse(period.from + 'T00:00:00Z')) / 86400000 + 1;
  const previousEnd = Date.parse(period.from + 'T00:00:00Z') - 86400000;
  const previousPeriod = { from: new Date(previousEnd - (duration - 1) * 86400000).toISOString().slice(0, 10), to: new Date(previousEnd).toISOString().slice(0, 10) };
  const previous = buildAnalytics(snapshot, previousPeriod);
  const available = current.sources.some(source => source.available);
  const partial = current.sources.some(source => !source.available);
  const days = current.trend.map(day => ({ key: day.key, date: day.date, value: day.recorded, completed: day.completed, waiting: day.waiting }));
  const chartDays = duration > 31 ? Array.from({ length: Math.ceil(days.length / 7) }, (_, i) => {
    const bucket = days.slice(i * 7, i * 7 + 7);
    return { ...bucket[0], end: bucket.at(-1)!.key, value: bucket.reduce((n, day) => n + day.value, 0), completed: bucket.reduce((n, day) => n + day.completed, 0), waiting: bucket.reduce((n, day) => n + day.waiting, 0) };
  }) : days.map(day => ({ ...day, end: day.key }));
  const peak = chartDays.reduce((index, day, i) => day.value > chartDays[index].value ? i : index, 0);
  const labels = [...new Set([0, peak, chartDays.length - 1])].filter(i => i >= 0).map(index => ({ ...chartDays[index], index, kind: index === peak ? 'Peak' : index === 0 ? 'First' : 'Latest' }));
  const comparisons = { total: comparison(current.total, previous.total, duration), complete: comparison(current.complete, previous.complete, duration), waiting: comparison(current.waiting, previous.waiting, duration) };
  const delta = (key: keyof typeof comparisons) => available ? comparisons[key].text : 'Data unavailable';
  const queues = current.queues.map((queue, index) => ({ ...queue, available: current.sources[index].available, key: current.sources[index].key, index,
    // Workflows and Maintenance cross departments; Cleans is one department.
    tone: current.sources[index].key === 'cleans' ? 'cleans' as const : ['onboarding', 'mail'].includes(current.sources[index].key) ? 'clients' as const : 'primary' as const,
  })).sort((a, b) => b.value - a.value || a.index - b.index);
  const dominant = queues.find(queue => queue.available && queue.value > 0);
  return { current, previous, previousPeriod, available, partial, duration, days, chartDays, labels, peak, queues, comparisons,
    propertyAvailable: current.properties !== null,
    headline: available ? `${current.complete} of ${current.total} tasks are done.` : 'Task data is unavailable.',
    summary: !available ? 'Connect the permitted data to see your tasks.' : dominant ? `Most work is in ${dominant.name}: ${dominant.value} of ${current.total} tasks.` : 'There are no tasks in this period.',
    deltas: { total: delta('total'), complete: delta('complete'), waiting: delta('waiting') },
    comparisonNote: `Compared with the previous ${duration} ${duration === 1 ? 'day' : 'days'} (${periodLabel(previousPeriod)}).`,
    sparkReady: { total: days.filter(day => day.value > 0).length >= 3 && chartDays.length >= 2, complete: days.filter(day => day.completed > 0).length >= 3 && chartDays.length >= 2, waiting: days.filter(day => day.waiting > 0).length >= 3 && chartDays.length >= 2 },
  };
}
export type ReportPresentation = ReturnType<typeof reportPresentation>;
export function weeklySparkline(snapshot: AnalyticsSnapshot, end: string) {
  const endMs = Date.parse(end + 'T00:00:00Z');
  const report = reportPresentation(snapshot, { from: new Date(endMs - 6 * 86400000).toISOString().slice(0, 10), to: end });
  return { ...report, deltaLabel: report.available ? `${report.current.total - report.previous.total >= 0 ? '+' : ''}${report.current.total - report.previous.total} vs last week` : 'Activity data unavailable' };
}
