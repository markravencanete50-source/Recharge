// The text of a Word document (.docx), for a contract uploaded as the agreement template: headings, paragraphs and lists,
// in the outline format lib/agreement-copy.ts shows ("# " a heading, "## " a smaller one, "- " and "1. " list items, a
// blank line between blocks). A .docx is a zip of XML files. Only word/document.xml and word/numbering.xml are read, as
// text: nothing in the file is ever run, and macros, pictures, embedded objects, text boxes, fields and deleted text are
// left out. A document with macros (.docm saved as .docx) is refused. Runs in the Worker with the built-in
// DecompressionStream, so no library is needed.
export class DocxError extends Error {}
const MAX_PART_BYTES = 20 * 1024 * 1024;
type Entry = { method: number; flags: number; compressed: number; size: number; offset: number };

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

export const isZip = (bytes: Uint8Array) => bytes.length > 22 && u32(bytes, 0) === 0x04034b50;

// The zip's table of contents (the central directory at its end).
function directory(bytes: Uint8Array): Map<string, Entry> {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (u32(bytes, i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new DocxError('This file is not a Word document');
  const count = u16(bytes, end + 10), size = u32(bytes, end + 12), start = u32(bytes, end + 16);
  if (count > 2000 || start + size > end) throw new DocxError('This file is not a Word document');
  const names = new Map<string, Entry>(), decoder = new TextDecoder();
  for (let i = start, n = 0; n < count; n++) {
    if (i + 46 > bytes.length || u32(bytes, i) !== 0x02014b50) throw new DocxError('This file is not a Word document');
    const nameLength = u16(bytes, i + 28), extra = u16(bytes, i + 30), comment = u16(bytes, i + 32);
    const name = decoder.decode(bytes.subarray(i + 46, i + 46 + nameLength));
    names.set(name, { flags: u16(bytes, i + 8), method: u16(bytes, i + 10), compressed: u32(bytes, i + 20), size: u32(bytes, i + 24), offset: u32(bytes, i + 42) });
    i += 46 + nameLength + extra + comment;
  }
  return names;
}

// One file from the zip, as text. Stored or deflated only; encrypted or oversized parts are refused.
async function part(bytes: Uint8Array, entry: Entry): Promise<string> {
  if (entry.flags & 1) throw new DocxError('This document is password protected. Remove the password and upload it again.');
  if (entry.size > MAX_PART_BYTES || entry.compressed === 0xffffffff) throw new DocxError('This document is too large to read');
  const at = entry.offset;
  if (at + 30 > bytes.length || u32(bytes, at) !== 0x04034b50) throw new DocxError('This file is not a Word document');
  const from = at + 30 + u16(bytes, at + 26) + u16(bytes, at + 28), data = bytes.subarray(from, from + entry.compressed);
  if (data.length !== entry.compressed) throw new DocxError('This file is not a Word document');
  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new DocxError('This Word document could not be read. Save it again as a Word Document (.docx).');
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      // Never more than the zip says, so a "zip bomb" stops here.
      if (total > Math.min(entry.size, MAX_PART_BYTES)) { await reader.cancel(); throw new DocxError('This document is too large to read'); }
      chunks.push(value);
    }
  } catch (error) { throw error instanceof DocxError ? error : new DocxError('This Word document could not be read. Save it again as a Word Document (.docx).'); }
  const out = new Uint8Array(total);
  let i = 0;
  for (const c of chunks) { out.set(c, i); i += c.length; }
  return new TextDecoder().decode(out);
}

const decode = (s: string) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e: string) =>
  e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"' : e === 'apos' ? "'" : String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));
const attr = (xml: string, tag: string) => xml.match(new RegExp(`<w:${tag}\\b[^>]*\\bw:val="([^"]*)"`))?.[1];
// Parts of the document that are not its words, removed before reading.
const SKIP = ['mc:AlternateContent', 'w:drawing', 'w:pict', 'w:object', 'w:txbxContent', 'w:del', 'w:instrText', 'w:delText', 'w:fldChar', 'w:footnoteReference', 'w:commentReference'];
const strip = (xml: string) => SKIP.reduce((x, tag) => x.replace(new RegExp(`<${tag}\\b[^>]*/>`, 'g'), '').replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, 'g'), ''), xml);

// Which lists are bullets (numId and level to the format in word/numbering.xml).
function listFormats(numbering: string) {
  const abstract = new Map<string, Map<string, string>>();
  for (const m of numbering.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)) {
    const levels = new Map<string, string>();
    for (const l of m[2].matchAll(/<w:lvl\b[^>]*w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g)) levels.set(l[1], attr(l[2], 'numFmt') ?? 'decimal');
    abstract.set(m[1], levels);
  }
  const nums = new Map<string, Map<string, string>>();
  for (const m of numbering.matchAll(/<w:num\b[^>]*w:numId="(\d+)"[^>]*>([\s\S]*?)<\/w:num>/g)) nums.set(m[1], abstract.get(attr(m[2], 'abstractNumId') ?? '') ?? new Map());
  return (numId: string, level: string) => { const f = nums.get(numId)?.get(level) ?? 'bullet'; return f === 'bullet' || f === 'none' ? 'bullet' : 'number'; };
}

// A paragraph that would read as a heading or a list item but is not one keeps its first character with a backslash.
const escapeLine = (text: string) => (/^(#|-\s|\d+\.\s|\\)/.test(text) ? '\\' + text : text);

export async function docxOutline(bytes: Uint8Array): Promise<string> {
  if (!isZip(bytes)) throw new DocxError('This file is not a Word document');
  const files = directory(bytes);
  if (files.has('word/vbaProject.bin')) throw new DocxError('This document contains macros. Save it as a Word Document (.docx) without macros and upload it again.');
  const main = files.get('word/document.xml');
  if (!main) throw new DocxError('This file is not a Word document');
  const types = files.get('[Content_Types].xml');
  if (types && /macroEnabled/i.test(await part(bytes, types))) throw new DocxError('This document contains macros. Save it as a Word Document (.docx) without macros and upload it again.');
  const numbering = files.get('word/numbering.xml');
  const format = listFormats(numbering ? await part(bytes, numbering) : '');
  const body = strip((await part(bytes, main)).replace(/^[\s\S]*?<w:body\b[^>]*>/, ''));
  const blocks: { text: string; list: '' | 'bullet' | 'number' }[] = [], counters = new Map<string, number>();
  for (const p of body.matchAll(/<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/g)) {
    const xml = p[1] ?? '', props = xml.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0] ?? '';
    let text = '';
    for (const r of xml.replace(/<w:pPr\b[\s\S]*?<\/w:pPr>/, '').matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br|cr|noBreakHyphen)\b[^>]*\/>/g))
      text += r[1] !== undefined ? decode(r[1]) : r[2] === 'tab' ? ' ' : r[2] === 'noBreakHyphen' ? '-' : '\n';
    text = text.replace(/[  ]+/g, ' ').split('\n').map(l => l.trim()).join('\n').replace(/\n{2,}/g, '\n').trim();
    if (!text) continue;
    const style = attr(props, 'pStyle') ?? '', heading = style.match(/^(?:heading|Heading)\s*(\d)$/)?.[1] ?? (/^Title$/i.test(style) ? '1' : '');
    const numId = attr(props, 'numId'), level = attr(props, 'ilvl') ?? '0';
    if (heading) { blocks.push({ text: (heading === '1' ? '# ' : '## ') + text.replace(/\n/g, ' '), list: '' }); continue; }
    const listStyle = /^List ?Bullet/i.test(style) ? 'bullet' : /^List ?Number/i.test(style) ? 'number' : '';
    if ((numId && numId !== '0') || listStyle) {
      const kind = numId && numId !== '0' ? format(numId, level) : listStyle, key = `${numId ?? style}:${level}`;
      for (const k of [...counters.keys()]) if (k.startsWith(`${numId ?? style}:`) && Number(k.split(':')[1]) > Number(level)) counters.delete(k);
      const n = (counters.get(key) ?? 0) + 1;
      counters.set(key, n);
      blocks.push({ text: (kind === 'bullet' ? '- ' : `${n}. `) + text.replace(/\n/g, ' '), list: kind === 'bullet' ? 'bullet' : 'number' });
      continue;
    }
    blocks.push({ text: text.split('\n').map(escapeLine).join('\n'), list: '' });
  }
  // Items of the same list stay together; anything else is its own block.
  return blocks.map((b, i) => (i === 0 ? '' : b.list && b.list === blocks[i - 1].list ? '\n' : '\n\n') + b.text).join('');
}
