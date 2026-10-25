// The furnishing list as a real PDF file (A4), built here without a library so it downloads the same
// way on every browser and phone. Page 1 opens with the property and its layout; then each category
// is a table of item, rule, quantity and a tick box, with the header repeated when a table runs on
// to the next page, and "Page X of Y" in every footer.
import { INPUTS, type FurnishingList, type Layout } from './furnishing-calculator';

const W = 595.28, H = 841.89, M = 40, BOTTOM = H - 58;
const INK = '0f1f3d', BLUE = '0A46EF', GREEN = '4a7a1f', MUTED = '5b6475', BORDER = 'dfe3ea', WASH = 'f3f5f9', WHITE = 'ffffff', SOFT = 'c9d3ea';

// Helvetica and Helvetica-Bold widths (per 1000) for characters 32-126; anything else counts as 556.
const REGULAR = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
const WIN: Record<string, number> = { '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '\u2014': 0x97, '™': 0x99 };

// Each character as a WinAnsi code (what the standard PDF fonts can draw); anything else prints as "?".
const codes = (s: string) => Array.from(s.replace(/[\t\r\n]+/g, ' '), ch => {
  const c = ch.codePointAt(0)!;
  return c >= 32 && c <= 126 ? c : c >= 160 && c <= 255 ? c : WIN[ch] ?? 63;
});
const EXTRA_WIDTH: Record<number, [number, number]> = { 0x85: [1000, 1000], 0x91: [222, 278], 0x92: [222, 278], 0x93: [333, 500], 0x94: [333, 500], 0x95: [350, 350], 0x96: [556, 556], 0x97: [1000, 1000], 0x99: [1000, 1000], 0xb7: [278, 278], 0xd7: [584, 584] };
const width = (s: string, size: number, bold = false) => codes(s).reduce((sum, c) => sum + (c >= 32 && c <= 126 ? (bold ? BOLD : REGULAR)[c - 32] : EXTRA_WIDTH[c]?.[bold ? 1 : 0] ?? 556), 0) * size / 1000;
const pdfString = (s: string) => '(' + codes(s).map(c => c === 40 || c === 41 || c === 92 ? '\\' + String.fromCharCode(c) : c > 126 ? '\\' + c.toString(8).padStart(3, '0') : String.fromCharCode(c)).join('') + ')';
// Document info (the title a PDF viewer shows) is UTF-16, unlike page text.
const infoString = (s: string) => '<FEFF' + Array.from(s, ch => ch.charCodeAt(0).toString(16).padStart(4, '0')).join('').toUpperCase() + '>';
const rgb = (hex: string) => [0, 2, 4].map(i => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
const n = (v: number) => (Math.round(v * 100) / 100).toString();

// Word-wrap to a width; a word longer than the line is broken by character.
export function wrapText(s: string, max: number, size: number, bold = false): string[] {
  const lines: string[] = [];
  let line = '';
  for (let word of s.trim().split(/\s+/).filter(Boolean)) {
    while (width(word, size, bold) > max) {
      let cut = word.length - 1;
      while (cut > 1 && width(word.slice(0, cut), size, bold) > max) cut--;
      if (line) { lines.push(line); line = ''; }
      lines.push(word.slice(0, cut)); word = word.slice(cut);
    }
    const next = line ? `${line} ${word}` : word;
    if (width(next, size, bold) <= max) line = next; else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
const units = (q: number) => `${q} ${q === 1 ? 'unit' : 'units'}`;

export function furnishingFileName(layout: Layout, ext: 'pdf' | 'csv') {
  const slug = layout.address.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `Recharge-furnishing-list${slug ? '-' + slug : ''}.${ext}`;
}

export function furnishingPdf(layout: Layout, list: FurnishingList, options: { generatedOn?: Date } = {}): Uint8Array {
  const address = layout.address.trim() || 'Address not entered';
  const pages: string[][] = [];
  let ops: string[] = [];
  let y = 0;
  const rect = (x: number, top: number, w: number, h: number, fill: string) => ops.push(`${rgb(fill)} rg ${n(x)} ${n(H - top - h)} ${n(w)} ${n(h)} re f`);
  const stroke = (x: number, top: number, w: number, h: number, color: string) => ops.push(`${rgb(color)} RG 0.8 w ${n(x)} ${n(H - top - h)} ${n(w)} ${n(h)} re S`);
  const rule = (x1: number, x2: number, at: number, color = BORDER) => ops.push(`${rgb(color)} RG 0.6 w ${n(x1)} ${n(H - at)} m ${n(x2)} ${n(H - at)} l S`);
  const text = (x: number, baseline: number, s: string, size: number, color = INK, bold = false, spacing = 0) =>
    ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${spacing ? `${spacing} Tc ` : ''}${rgb(color)} rg ${n(x)} ${n(H - baseline)} Td ${pdfString(s)} Tj${spacing ? ' 0 Tc' : ''} ET`);
  const right = (xr: number, baseline: number, s: string, size: number, color = INK, bold = false) => text(xr - width(s, size, bold), baseline, s, size, color, bold);
  const fit = (s: string, max: number, size: number, bold = false) => { if (width(s, size, bold) <= max) return s; let t = s; while (t.length > 1 && width(t + '…', size, bold) > max) t = t.slice(0, -1); return t + '…'; };

  const newPage = () => {
    ops = []; pages.push(ops);
    if (pages.length === 1) {
      rect(0, 0, W, 104, INK);
      rect(0, 104, W, 4, BLUE);
      text(M, 38, 'RECHARGE', 10, SOFT, true, 2);
      text(M, 70, 'Furnishing list', 26, WHITE, true);
      text(M, 90, 'Required quantities for a guest-ready property', 10, SOFT);
      right(W - M, 38, 'Prepared ' + longDate(options.generatedOn ?? new Date()), 9, SOFT);
      y = 136;
    } else {
      text(M, 36, 'RECHARGE', 8, BLUE, true, 1.5);
      right(W - M, 36, fit('Furnishing list · ' + address, 360, 8), 8, MUTED);
      rule(M, W - M, 46);
      y = 66;
    }
  };
  const room = (h: number) => { if (y + h > BOTTOM) { newPage(); return true; } return false; };

  newPage();

  // The property and the headline figures.
  text(M, y, 'PROPERTY', 8, MUTED, true, 1);
  y += 18;
  for (const line of wrapText(address, W - 2 * M, 15, true)) { text(M, y, line, 15, INK, true); y += 19; }
  y += 6;
  const tiles: [string, number][] = [['Bedrooms', layout.bedrooms], ['Maximum guests', layout.guests], ['Total beds', list.beds], ['Required units', list.total]];
  const gap = 10, tw = (W - 2 * M - gap * (tiles.length - 1)) / tiles.length;
  tiles.forEach(([label, value], i) => {
    const x = M + i * (tw + gap), last = i === tiles.length - 1;
    rect(x, y, tw, 58, last ? INK : WASH);
    text(x + 12, y + 30, String(value), 20, last ? WHITE : INK, true);
    text(x + 12, y + 47, label.toUpperCase(), 7.5, last ? SOFT : MUTED, true, 0.6);
  });
  y += 88;

  // Every layout figure the quantities were worked out from, in two columns.
  text(M, y, 'Property layout', 12, INK, true);
  y += 12;
  const half = Math.ceil(INPUTS.length / 2), colW = (W - 2 * M - 20) / 2;
  for (let r = 0; r < half; r++) {
    const top = y + r * 20;
    [INPUTS[r], INPUTS[r + half]].forEach((input, c) => {
      if (!input) return;
      const x = M + c * (colW + 20);
      text(x, top + 14, input.label, 9.5, MUTED);
      right(x + colW, top + 14, String(layout[input.key]), 9.5, INK, true);
      rule(x, x + colW, top + 20);
    });
  }
  y += half * 20 + 28;

  // One table per category.
  const X_ITEM = M + 10, W_ITEM = 196, X_RULE = M + 216, W_RULE = 200, X_QTY = M + 470, X_BOX = W - M - 22;
  const head = (title: string, summary: string) => {
    rect(M, y, W - 2 * M, 26, INK);
    text(M + 10, y + 17, title, 11, WHITE, true);
    right(W - M - 10, y + 17, summary, 8.5, SOFT);
    y += 26;
    rect(M, y, W - 2 * M, 20, WASH);
    text(X_ITEM, y + 13.5, 'ITEM', 7.5, MUTED, true, 0.6);
    text(X_RULE, y + 13.5, 'HOW IT IS WORKED OUT', 7.5, MUTED, true, 0.6);
    right(X_QTY, y + 13.5, 'QTY', 7.5, MUTED, true);
    text(X_BOX - 6, y + 13.5, 'DONE', 7.5, MUTED, true, 0.6);
    y += 20;
  };
  for (const c of list.categories) {
    const summary = `${c.lines.length} ${c.lines.length === 1 ? 'item' : 'items'} · ${units(c.lines.reduce((s, l) => s + l.quantity, 0))}`;
    const rows = c.lines.map(l => {
      const item = wrapText(l.item, W_ITEM, 9.5, true), why = wrapText(l.rule, W_RULE, 8.5);
      return { l, item, why, h: Math.max(item.length * 12, why.length * 11) + 12 };
    });
    if (y + 46 + (rows[0]?.h ?? 0) > BOTTOM) newPage();
    else y += 4;
    head(c.title, summary);
    rows.forEach((row, i) => {
      if (room(row.h)) head(`${c.title} (continued)`, summary);
      if (i % 2 === 1) rect(M, y, W - 2 * M, row.h, 'fafbfd');
      row.item.forEach((line, k) => text(X_ITEM, y + 15 + k * 12, line, 9.5, INK, true));
      row.why.forEach((line, k) => text(X_RULE, y + 15 + k * 11, line, 8.5, MUTED));
      right(X_QTY, y + 16, String(row.l.quantity), 11, INK, true);
      stroke(X_BOX, y + 7, 10, 10, MUTED);
      rule(M, W - M, y + row.h);
      y += row.h;
    });
    y += 18;
  }

  // The grand total.
  room(64);
  rect(M, y, W - 2 * M, 50, WASH);
  rect(M, y, 4, 50, GREEN);
  text(M + 16, y + 21, 'Total required units', 11, INK, true);
  text(M + 16, y + 37, `${list.categories.length} categories · ${list.categories.reduce((s, c) => s + c.lines.length, 0)} item types`, 8.5, MUTED);
  right(W - M - 16, y + 32, String(list.total), 22, INK, true);
  y += 66;
  for (const line of wrapText('Quantities follow the Recharge furnishing guidance for the layout above. Items under "Other items" were added by the person who prepared this list.', W - 2 * M, 8, false)) {
    room(12); text(M, y, line, 8, MUTED); y += 11;
  }

  // Footers, now the page count is known.
  pages.forEach((page, i) => {
    ops = page;
    rule(M, W - M, H - 38);
    text(M, H - 24, fit('Recharge · Furnishing list · ' + address, 380, 7.5), 7.5, MUTED);
    right(W - M, H - 24, `Page ${i + 1} of ${pages.length}`, 7.5, MUTED);
  });

  // The file: catalog, page tree, two fonts, then a page and its content stream for each page.
  const objects: string[] = [];
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  pages.forEach((page, i) => {
    const stream = page.join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects.push(`<< /Title ${infoString('Recharge furnishing list · ' + address)} /Producer (Recharge) >>`);
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => { const at = out.length; out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i);
  return bytes;
}
