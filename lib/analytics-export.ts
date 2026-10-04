import { buildAnalytics, type AnalyticsPeriod, type AnalyticsSnapshot } from "./analytics";

function cell(value: string | number) {
  const text = String(value);
  // Quoting alone does not prevent spreadsheet formula execution.
  const safe = /^[\s\uFEFF]*[=+\-@]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function analyticsCsv(snapshot: AnalyticsSnapshot, period: AnalyticsPeriod, preview = false) {
  const metrics = buildAnalytics(snapshot, period);
  const rows: (string | number)[][] = [
    ["Recharge analytics report"],
    ["Data", preview ? "SAMPLE DATA ONLY" : "Permitted workspace records"],
    ["Report", snapshot.title], ["Start date", period.from], ["End date", period.to],
    ["Date basis", "Europe/London, both dates included"],
    ["Coverage", "Current source snapshots, not a complete historical ledger. Linked work can appear in multiple queues."],
    ["Source limits", "250 workflows, 500 maintenance records, 1500 cleans, 300 onboarding cases"],
    [], ["Summary", "Count"], ["Recorded items", metrics.total], ["Completed", metrics.complete],
    ["Waiting", metrics.waiting], ["In progress", metrics.total - metrics.complete - metrics.waiting],
    [snapshot.propertyLabel + " (current snapshot, not date-filtered)", snapshot.propertyCount],
    [], ["Source", "Records in period", "Availability"],
    ...metrics.sources.map((source, index) => [source.name, metrics.queues[index].value, source.available ? "Available" : "Not connected, excluded"]),
    [], ["Date", ...metrics.sources.map(source => source.name)],
    ...metrics.trend.map(day => [day.key, ...metrics.sources.map(source => day[source.key] || 0)]),
  ];
  return "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function analyticsFilename(period: AnalyticsPeriod) {
  return `recharge-report-${period.from}-${period.to}.csv`;
}
