import { buildAnalytics, type AnalyticsPeriod, type AnalyticsSnapshot } from "./analytics";

function cell(value: string | number) {
  const text = String(value);
  // Quoting alone does not prevent spreadsheet formula execution.
  const safe = /^[\s\uFEFF]*[=+\-@]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function analyticsCsv(snapshot: AnalyticsSnapshot, period: AnalyticsPeriod, preview = false) {
  const metrics = buildAnalytics(snapshot, period);
  const available = metrics.sources.some(source => source.available);
  const count = (value: number) => available ? value : '-';
  const rows: (string | number)[][] = [
    ["Recharge analytics report"],
    ["Data", preview ? "SAMPLE DATA ONLY" : "Permitted workspace records"],
    ["Report", snapshot.title], ["Start date", period.from], ["End date", period.to],
    ["Date basis", "Europe/London, both dates included"],
    [], ["Summary", "Count"], ["Tasks", count(metrics.total)],
    ...metrics.status.map(status => [status.name, count(status.value)]),
    ["Properties (as of today, not date-filtered)", metrics.properties ?? '-'],
    [], ["Source", "Records in period", "Availability"],
    ...metrics.sources.map((source, index) => [source.name, source.available ? metrics.queues[index].value : '-', source.available ? "Available" : "Not connected, excluded"]),
    [], ["Date", "Tasks", "Completed", "Waiting", ...metrics.sources.map(source => source.name)],
    ...metrics.trend.map(day => [day.key, count(day.recorded), count(day.completed), count(day.waiting), ...metrics.sources.map(source => source.available ? day[source.key] || 0 : '-')]),
  ];
  return "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function analyticsFilename(period: AnalyticsPeriod) {
  return `recharge-report-${period.from}-${period.to}.csv`;
}
