export function graphGeometry(values: number[], width: number, top: number, bottom: number, max = Math.max(1, ...values)) {
  const x = (i: number) => 8 + i / Math.max(1, values.length - 1) * (width - 16);
  const y = (value: number) => bottom - value / max * (bottom - top);
  const points = values.map((value, i) => `${x(i)},${y(value)}`).join(' ');
  return { x, y, points, area: `M8 ${bottom} L${points.split(' ').join(' L')} L${x(Math.max(0, values.length - 1))} ${bottom}Z` };
}
export const shortReportDate = (date: string) => date.split(' ').slice(0, 2).join(' ');

// Shared geometry keeps the native and DOM charts proportional to the same
// report counts. Zero values have no arc; rounded labels never size the chart.
export function statusBreakdown(status: { name: string; kind: string; value: number }[], total: number) {
  const circumference = 2 * Math.PI * 76;
  let offset = 0;
  return status.map(item => {
    const share = total > 0 ? item.value / total : 0;
    const length = share * circumference;
    const segment = { ...item, share, percentage: Math.round(share * 1000) / 10, offset, length, circumference };
    offset += length;
    return segment;
  });
}

// A smooth line through the points that never overshoots them (monotone cubic, Fritsch–Carlson):
// curves read as calmer than straight segments, and a flat stretch stays flat.
export function smoothPath(points: { x: number; y: number }[]) {
  const n = points.length, r = (v: number) => Math.round(v * 100) / 100;
  if (!n) return '';
  if (n === 1) return `M${r(points[0].x)} ${r(points[0].y)}`;
  const dx: number[] = [], m: number[] = [], t: number[] = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = points[i + 1].x - points[i].x; m[i] = (points[i + 1].y - points[i].y) / (dx[i] || 1); }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], h = a * a + b * b;
    if (h > 9) { const k = 3 / Math.sqrt(h); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${r(points[0].x)} ${r(points[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${r(points[i].x + h)} ${r(points[i].y + h * t[i])} ${r(points[i + 1].x - h)} ${r(points[i + 1].y - h * t[i + 1])} ${r(points[i + 1].x)} ${r(points[i + 1].y)}`;
  }
  return d;
}
// The same curve closed down to a baseline, for the soft fill under a line.
export const smoothArea = (points: { x: number; y: number }[], baseline: number) =>
  points.length ? `${smoothPath(points)} L${points[points.length - 1].x} ${baseline} L${points[0].x} ${baseline} Z` : '';
// Roughly how long the curve is, so a line can draw itself in (stroke-dashoffset from length to 0).
export const pathLength = (points: { x: number; y: number }[]) =>
  points.reduce((sum, p, i) => i ? sum + Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) * 1.08 : sum, 0);
