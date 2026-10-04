import { buildAnalytics, type AnalyticsPeriod, type AnalyticsSnapshot } from './analytics';

// Presentation only. Reuses the same scoped records and dates as CSV exports.
export function reportPresentation(snapshot: AnalyticsSnapshot, period: AnalyticsPeriod) {
  const current = buildAnalytics(snapshot, period);
  const duration = (Date.parse(period.to + 'T00:00:00Z') - Date.parse(period.from + 'T00:00:00Z')) / 86400000 + 1;
  const previousEnd = Date.parse(period.from + 'T00:00:00Z') - 86400000;
  const previousPeriod = { from: new Date(previousEnd - (duration - 1) * 86400000).toISOString().slice(0, 10), to: new Date(previousEnd).toISOString().slice(0, 10) };
  const previous = buildAnalytics(snapshot, previousPeriod);
  const available = current.sources.some(source => source.available);
  const partial = current.sources.some(source => !source.available);
  const days = current.trend.map(day => ({ key: day.key, date: day.date, value: current.sources.reduce((sum, source) => sum + (day[source.key] || 0), 0) }));
  const peak = days.reduce((index, day, i) => day.value > days[index].value ? i : index, 0);
  const labels = [...new Set([0, peak, days.length - 1])].filter(i => i >= 0).map(index => ({ ...days[index], index, kind: index === 0 ? 'First' : index === days.length - 1 ? 'Latest' : 'Peak' }));
  const delta = (value: number, before: number) => available ? `${value - before >= 0 ? '+' : ''}${value - before} vs preceding period` : 'Source not connected';
  const queues = current.queues.map((queue, index) => ({ ...queue, available: current.sources[index].available, index })).sort((a, b) => b.value - a.value || a.index - b.index);
  return { current, previous, previousPeriod, available, partial, days, labels, queues,
    headline: !available ? 'Connect a permitted source to see your progress.' : current.total ? `${current.complete} of ${current.total} recorded items are complete.` : 'No dated records in this period.',
    deltas: { total: delta(current.total, previous.total), complete: delta(current.complete, previous.complete), waiting: delta(current.waiting, previous.waiting) },
    comparisonNote: 'Compared with the preceding equal-length period in this source snapshot. Source limits apply.',
  };
}

export function weeklySparkline(snapshot: AnalyticsSnapshot, end: string) {
  const endMs = Date.parse(end + 'T00:00:00Z');
  const report = reportPresentation(snapshot, { from: new Date(endMs - 6 * 86400000).toISOString().slice(0, 10), to: end });
  return { ...report, deltaLabel: report.available ? `${report.current.total - report.previous.total >= 0 ? '+' : ''}${report.current.total - report.previous.total} vs last week` : 'Activity source not connected' };
}
