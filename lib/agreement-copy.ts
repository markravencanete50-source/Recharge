import { SIGNATURE_PATTERN } from './signature-png';
// A copy of the management agreement that owners and the team can keep: the exact wording published, the revision, and
// who signed and when. Saved as a web page, so it opens anywhere; its "Print or save as PDF" button (or the browser's
// print) makes the PDF. An agreement made from an uploaded contract (migration 20261020870000) is in the outline format
// below; a typed one is plain paragraphs, shown exactly as before. For a PDF contract this page is the cover, and the
// PDF itself is downloaded beside it.
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const longDate = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// The letterhead at the top of every agreement copy: who the Manager is, as on the approved agreement.
export const AGREEMENT_LETTERHEAD = {
  name: 'Recharge Stays Ltd', line: 'Registered in Scotland, company number SC799955', address: '14 Newton Place, Glasgow, G3 7PY',
  email: 'onboarding@rechargestays.co.uk', phone: '0141 375 9450',
} as const;

export type AgreementFormat = 'text' | 'outline';
export type AgreementAttachment = { fileName: string; sha256: string };
export type SignedAgreement = {
  propertyName: string; agreement: string; revision: number; signedName: string | null; signedAt: string | null;
  format?: AgreementFormat; attachment?: AgreementAttachment | null; signatureImage?: string | null;
};
export function agreementFileName(propertyName: string) {
  const slug = propertyName.trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'property';
  return `Recharge-management-agreement-${slug}.html`;
}

// The outline format: blocks separated by a blank line. "# " a heading, "## " a smaller heading, lines starting "- " a
// bulleted list, lines starting "1. " a numbered list, anything else a paragraph (single line breaks kept). A paragraph
// line starting with a backslash is shown without it (lib/docx-text.ts adds it so text is never read as a heading).
export type OutlineBlock = { kind: 'h1' | 'h2' | 'ul' | 'ol' | 'p'; lines: string[] };
const unescapeLine = (line: string) => line.replace(/^\\/, '');
export function outlineBlocks(text: string): OutlineBlock[] {
  return text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map(b => b.replace(/^\n+|\n+$/g, '')).filter(Boolean).map((block): OutlineBlock => {
    const lines = block.split('\n');
    if (lines.length === 1 && /^# /.test(block)) return { kind: 'h1', lines: [block.slice(2).trim()] };
    if (lines.length === 1 && /^## /.test(block)) return { kind: 'h2', lines: [block.slice(3).trim()] };
    if (lines.every(l => /^- /.test(l))) return { kind: 'ul', lines: lines.map(l => l.slice(2).trim()) };
    if (lines.every(l => /^\d+\. /.test(l))) return { kind: 'ol', lines: lines.map(l => l.replace(/^\d+\. /, '').trim()) };
    return { kind: 'p', lines: lines.map(unescapeLine) };
  });
}
// The agreement as plain text for the app (the owner reads it before signing): headings on their own, lists kept.
export function agreementReadable(agreement: string, format: AgreementFormat = 'text') {
  if (format !== 'outline') return agreement;
  return outlineBlocks(agreement).map(b => b.kind === 'ul' ? b.lines.map(l => '• ' + l).join('\n')
    : b.kind === 'ol' ? b.lines.map((l, i) => `${i + 1}. ${l}`).join('\n') : b.lines.join('\n')).join('\n\n');
}
function agreementBody(agreement: string, format: AgreementFormat) {
  if (format !== 'outline') return agreement.split(/\n{2,}/).map(p => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`).join('\n');
  return outlineBlocks(agreement).map(b => b.kind === 'h1' ? `<h2>${escape(b.lines[0])}</h2>` : b.kind === 'h2' ? `<h3>${escape(b.lines[0])}</h3>`
    : b.kind === 'ul' || b.kind === 'ol' ? `<${b.kind}>${b.lines.map(l => `<li>${escape(l)}</li>`).join('')}</${b.kind}>`
    : clauseOf(b) ?? `<p>${b.lines.map(escape).join('<br>')}</p>`).join('\n');
}
// A numbered clause ("1.1 The Client hereby appoints..."): the number hangs in its own column, so the wording lines up.
function clauseOf(b: OutlineBlock) {
  const first = b.lines[0].match(/^(\d+(?:\.\d+)+|\(\d+\))\.?\s+([\s\S]*)$/);
  return first ? `<p class="clause"><span class="no">${escape(first[1])}</span><span>${[first[2], ...b.lines.slice(1)].map(escape).join('<br>')}</span></p>` : null;
}

export function agreementDocument({ propertyName, agreement, revision, signedName, signedAt, format = 'text', attachment = null, signatureImage = null }: SignedAgreement) {
  const when = signedAt ? longDate(signedAt) + ' (UK time)' : 'date not recorded';
  // The drawn signature (migration 20261024100000): only a PNG data URL is ever put in the page.
  const drawn = signedName && signatureImage && SIGNATURE_PATTERN.test(signatureImage) ? `<img class="signature" alt="Signature of ${escape(signedName)}" src="${signatureImage}">` : '';
  const signed = signedName
    ? `<div class="signed"><b>${drawn ? 'Signed' : 'Accepted'} electronically by ${escape(signedName)}</b>${drawn}On ${escape(when)}, in the Recharge app, against revision ${revision} of this agreement.</div>`
    : `<div class="signed"><b>Not signed yet</b>This is revision ${revision} of the agreement, published for signing in the Recharge app.</div>`;
  const attached = attachment
    ? `<div class="signed"><b>The attached contract</b>${escape(attachment.fileName)}, downloaded with this page. Its SHA-256 fingerprint is <span class="hash">${escape(attachment.sha256)}</span>, so anyone can check it is the exact file.</div>`
    : '';
  const L = AGREEMENT_LETTERHEAD;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Management agreement: ${escape(propertyName)}</title>
<style>:root{--ink:#17302A;--forest:#1D4038;--sand:#F3EEE4;--line:#DDD5C6;--muted:#5B6B65}
*{box-sizing:border-box}body{font-family:Georgia,'Times New Roman',serif;color:var(--ink);max-width:780px;margin:0 auto;padding:0 20px 48px;line-height:1.65;font-size:15px}
.sans,.letterhead,.title,.meta,h1,h2,h3,.signed,.parties,.print,.foot{font-family:Helvetica,Arial,sans-serif}
.letterhead{background:var(--forest);color:#fff;margin:0 -20px;padding:26px 36px;display:flex;flex-wrap:wrap;gap:12px 32px;justify-content:space-between;align-items:flex-end}
.letterhead b{display:block;font-size:22px;letter-spacing:.2px}.letterhead span{display:block;font-size:12.5px;opacity:.85;line-height:1.5}.letterhead .right{text-align:right}
.title{margin:34px 0 22px;padding-bottom:18px;border-bottom:3px solid var(--forest)}
h1{font-weight:700}
.title h1{font-size:28px;letter-spacing:0;text-transform:none;color:var(--forest);margin:0}
.meta{color:var(--muted);font-size:14px;margin:8px 0 0}
.parties{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin:0 0 26px}.parties div{background:var(--sand);border-radius:10px;padding:12px 16px;font-size:13.5px;line-height:1.5}.parties b{display:block;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:var(--muted);margin-bottom:2px}
h2{font-size:17px;margin:30px 0 10px;padding:7px 0 7px 14px;border-left:4px solid var(--forest);background:var(--sand);color:var(--forest)}
h3{font-size:15px;margin:22px 0 6px;color:var(--forest)}
p{margin:0 0 12px}.clause{display:flex;gap:14px}.clause .no{flex:0 0 38px;font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:13.5px;color:var(--forest);padding-top:1px}
ul,ol{margin:0 0 14px;padding-left:24px}li{margin:0 0 5px}ul{list-style:none;padding-left:52px}ul li{position:relative}ul li:before{content:"";position:absolute;left:-16px;top:.7em;width:6px;height:6px;border-radius:50%;background:var(--forest)}
.signed{margin-top:34px;padding:18px 20px;border:1px solid var(--line);border-top:4px solid var(--forest);border-radius:10px;font-size:14px;background:#fff}
.signed b{display:block;font-size:16px;margin-bottom:4px}.signature{display:block;width:240px;max-width:100%;height:auto;margin:6px 0 8px;border-bottom:1px solid var(--line)}.hash{word-break:break-all;font-family:monospace;font-size:12px}
.foot{margin-top:30px;padding-top:12px;border-top:1px solid var(--line);color:var(--muted);font-size:12px;text-align:center}
.print{font-size:14px;padding:10px 18px;border-radius:999px;border:1px solid var(--ink);background:#fff;color:var(--ink);cursor:pointer;margin:18px 0 0}
@page{size:A4;margin:16mm 14mm}
@media (max-width:560px){.parties{grid-template-columns:1fr}.letterhead .right{text-align:left}}
@media print{.print{display:none}body{margin:0 auto;padding:0;font-size:12.5pt;max-width:none}.letterhead{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}h2{-webkit-print-color-adjust:exact;print-color-adjust:exact;break-after:avoid}h3{break-after:avoid}.parties div{-webkit-print-color-adjust:exact;print-color-adjust:exact}.clause,li{break-inside:avoid}.signed{break-inside:avoid}}</style></head>
<body>
<div class="letterhead"><div><b>${escape(L.name)}</b><span>${escape(L.line)}</span></div><div class="right"><span>${escape(L.address)}</span><span>${escape(L.email)} · ${escape(L.phone)}</span></div></div>
<button class="print" type="button" onclick="window.print()">Print or save as PDF</button>
<div class="title"><h1>Management agreement</h1><p class="meta">${escape(propertyName)} · Revision ${revision}</p></div>
<div class="parties"><div><b>The Manager</b>${escape(L.name)}<br>${escape(L.address)}</div><div><b>The Property</b>${escape(propertyName)}</div><div><b>Status</b>${signedName && signedAt ? 'Signed ' + escape(new Date(signedAt).toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric' })) : 'Awaiting signature'}</div></div>
${agreementBody(agreement, format)}
${attached}${signed}
<p class="foot">${escape(L.name)} · ${escape(L.line)} · ${escape(L.address)}</p>
</body></html>
`;
}
