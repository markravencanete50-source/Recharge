// Column widths for the thin tables (the To-do list on a computer and every tracker table). Lee's rule, from E's
// review: no table is ever wider than its card. Fixed columns (the tick, When, Due, Status, Progress) keep their
// width; the text columns (property, task, latest update and so on) share what is left, growing or shrinking from
// their usual width, never below `min` while there is room, and their text ends in "…". Every column always
// shows, empty or not.
export type ThinColumnSize = { width: number; fixed?: boolean; grow?: boolean; min?: number };
export const THIN_MIN_TEXT = 64;

export function thinWidths(columns: readonly ThinColumnSize[], available: number): number[] {
  const room = Math.max(0, Math.floor(available));
  const fixedTotal = columns.reduce((n, c) => n + (c.fixed ? c.width : 0), 0);
  const flex = columns.map((c, i) => ({ c, i })).filter(x => !x.c.fixed);
  const out = columns.map(c => (c.fixed ? c.width : 0));
  // Narrower than the fixed columns alone (never at the widths the tables show): everything scales down.
  if (fixedTotal >= room || !flex.length) {
    const total = columns.reduce((n, c) => n + c.width, 0) || 1;
    const scaled = columns.map(c => Math.floor(Math.min(1, room / total) * c.width));
    return fixedTotal >= room ? scaled : out;
  }
  const rest = room - fixedTotal;
  const base = flex.reduce((n, x) => n + x.c.width, 0);
  const min = (x: { c: ThinColumnSize }) => Math.min(x.c.width, x.c.min ?? THIN_MIN_TEXT);
  const minTotal = flex.reduce((n, x) => n + min(x), 0);
  if (base <= rest) {
    // Room to spare: it goes to the growing columns (or the last text column when none grows).
    const growers = flex.filter(x => x.c.grow);
    const takers = growers.length ? growers : [flex[flex.length - 1]];
    const takerBase = takers.reduce((n, x) => n + x.c.width, 0);
    for (const x of flex) out[x.i] = x.c.width;
    let spare = rest - base;
    for (const x of takers) { const add = Math.floor(((rest - base) * x.c.width) / takerBase); out[x.i] += add; spare -= add; }
    out[takers[takers.length - 1].i] += spare;
  } else if (minTotal <= rest) {
    // Too wide: each text column gives up width in proportion to what it has above its minimum.
    const give = base - rest, slack = base - minTotal;
    for (const x of flex) out[x.i] = Math.floor(x.c.width - (give * (x.c.width - min(x))) / slack);
  } else {
    // Narrower than every minimum: the text columns share what is left in proportion.
    for (const x of flex) out[x.i] = Math.floor((rest * x.c.width) / base);
  }
  return out;
}
