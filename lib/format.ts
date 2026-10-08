// One way to write numbers, money, percentages and dates everywhere in the app (UK English).
const group = new Intl.NumberFormat('en-GB');
const pence = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const oneDecimal = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });

// 1234 → "1,234".
export const formatCount = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? '–' : group.format(Math.round(n));
// 1234 → "1.2k", 2_500_000 → "2.5m"; below 10,000 the full number is clearer.
export function formatCompact(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '–';
  const a = Math.abs(n), sign = n < 0 ? '−' : '';
  if (a < 10_000) return sign + group.format(Math.round(a));
  if (a < 1_000_000) return sign + oneDecimal.format(a / 1000) + 'k';
  return sign + oneDecimal.format(a / 1_000_000) + 'm';
}
// Pence → "£1,234.50"; negatives use a true minus sign: "−£12.00".
export function formatMoney(minor: number | null | undefined) {
  if (minor == null || !Number.isFinite(minor)) return '–';
  return (minor < 0 ? '−£' : '£') + pence.format(Math.abs(minor) / 100);
}
// For headline tiles: whole pounds drop the pence, large sums shorten: "£850", "£12.5k".
export function formatMoneyShort(minor: number | null | undefined) {
  if (minor == null || !Number.isFinite(minor)) return '–';
  const pounds = Math.abs(minor) / 100, sign = minor < 0 ? '−£' : '£';
  if (pounds >= 10_000) return sign + formatCompact(pounds);
  return sign + (Number.isInteger(pounds) ? group.format(pounds) : pence.format(pounds));
}
// Basis points → "12.5%"; a share (0–1) → "94%".
export const formatBps = (bps: number | null | undefined) => bps == null || !Number.isFinite(bps) ? '–' : oneDecimal.format(bps / 100) + '%';
export const formatShare = (share: number | null | undefined) => share == null || !Number.isFinite(share) ? '–' : Math.floor(share * 100) + '%';
// Minutes → "45 min", "7h 05m".
export const formatDuration = (minutes: number) => minutes < 60 ? `${Math.max(0, Math.round(minutes))} min` : `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, '0')}m`;
// "2026-10-08" → "Thu 8 Oct"; with year when it is not this year.
export function formatDay(iso: string | null | undefined, today = new Date()) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '–';
  const date = new Date(iso.slice(0, 10) + 'T12:00:00Z');
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(date.getUTCFullYear() !== today.getUTCFullYear() ? { year: 'numeric' } : {}), timeZone: 'UTC' }).replaceAll(',', '');
}
// "1 property", "3 properties".
export const plural = (n: number, one: string, many = one + 's') => `${formatCount(n)} ${n === 1 ? one : many}`;
