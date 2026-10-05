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
