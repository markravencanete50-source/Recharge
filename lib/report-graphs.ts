export function graphGeometry(values: number[], width: number, top: number, bottom: number, max = Math.max(1, ...values)) {
  const x = (i: number) => 8 + i / Math.max(1, values.length - 1) * (width - 16);
  const y = (value: number) => bottom - value / max * (bottom - top);
  const points = values.map((value, i) => `${x(i)},${y(value)}`).join(' ');
  return { x, y, points, area: `M8 ${bottom} L${points.split(' ').join(' L')} L${x(Math.max(0, values.length - 1))} ${bottom}Z` };
}
export const shortReportDate = (date: string) => date.split(' ').slice(0, 2).join(' ');
