// A copy of the management agreement that owners and the team can keep: the exact wording published, the revision, and
// who signed and when. Saved as a web page, so it opens anywhere; its "Print or save as PDF" button (or the browser's
// print) makes the PDF. An agreement made from an uploaded contract (migration 20261020870000) is in the outline format
// below; a typed one is plain paragraphs, shown exactly as before. For a PDF contract this page is the cover, and the
// PDF itself is downloaded beside it.
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const longDate = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export type AgreementFormat = 'text' | 'outline';
export type AgreementAttachment = { fileName: string; sha256: string };
export type SignedAgreement = {
  propertyName: string; agreement: string; revision: number; signedName: string | null; signedAt: string | null;
  format?: AgreementFormat; attachment?: AgreementAttachment | null;
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
    : `<p>${b.lines.map(escape).join('<br>')}</p>`).join('\n');
}

export function agreementDocument({ propertyName, agreement, revision, signedName, signedAt, format = 'text', attachment = null }: SignedAgreement) {
  const when = signedAt ? longDate(signedAt) + ' (UK time)' : 'date not recorded';
  const signed = signedName
    ? `<div class="signed"><b>Accepted electronically by ${escape(signedName)}</b>On ${escape(when)}, in the Recharge app, against revision ${revision} of this agreement.</div>`
    : `<div class="signed"><b>Not signed yet</b>This is revision ${revision} of the agreement, published for signing in the Recharge app.</div>`;
  const attached = attachment
    ? `<div class="signed"><b>The attached contract</b>${escape(attachment.fileName)}, downloaded with this page. Its SHA-256 fingerprint is <span class="hash">${escape(attachment.sha256)}</span>, so anyone can check it is the exact file.</div>`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Management agreement: ${escape(propertyName)}</title>
<style>body{font-family:Georgia,'Times New Roman',serif;color:#17302A;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.6}
h1{font-family:Helvetica,Arial,sans-serif;font-size:22px;margin:0 0 4px}h2{font-family:Helvetica,Arial,sans-serif;font-size:18px;margin:28px 0 8px}h3{font-family:Helvetica,Arial,sans-serif;font-size:16px;margin:22px 0 6px}
.meta{font-family:Helvetica,Arial,sans-serif;color:#5B6B65;font-size:14px;margin:0 0 28px}
.signed{margin-top:32px;padding:16px 18px;border:1px solid #DDD5C6;border-radius:10px;font-family:Helvetica,Arial,sans-serif;font-size:14px}
.signed b{display:block;font-size:16px;margin-bottom:4px}.hash{word-break:break-all;font-family:monospace;font-size:12px}
.print{font-family:Helvetica,Arial,sans-serif;font-size:14px;padding:10px 18px;border-radius:999px;border:1px solid #17302A;background:#fff;color:#17302A;cursor:pointer;margin:0 0 24px}
@media print{.print{display:none}body{margin:0 auto}h2,h3{break-after:avoid}.signed{break-inside:avoid}}</style></head>
<body>
<button class="print" type="button" onclick="window.print()">Print or save as PDF</button>
<h1>Management agreement</h1>
<p class="meta">${escape(propertyName)} · Revision ${revision}</p>
${agreementBody(agreement, format)}
${attached}${signed}
</body></html>
`;
}
