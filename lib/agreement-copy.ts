// A copy of the signed management agreement that owners and the team can keep: the exact wording
// that was signed, the revision, who signed and when. Saved as a web page, so it opens anywhere
// and can be printed or saved as a PDF from the browser.
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const longDate = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export type SignedAgreement = { propertyName: string; agreement: string; revision: number; signedName: string; signedAt: string | null };
export function agreementFileName(propertyName: string) {
  const slug = propertyName.trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'property';
  return `Recharge-management-agreement-${slug}.html`;
}
export function agreementDocument({ propertyName, agreement, revision, signedName, signedAt }: SignedAgreement) {
  const paragraphs = agreement.split(/\n{2,}/).map(p => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`).join('\n');
  const when = signedAt ? longDate(signedAt) + ' (UK time)' : 'date not recorded';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Management agreement: ${escape(propertyName)}</title>
<style>body{font-family:Georgia,'Times New Roman',serif;color:#17302A;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.6}
h1{font-family:Helvetica,Arial,sans-serif;font-size:22px;margin:0 0 4px}.meta{font-family:Helvetica,Arial,sans-serif;color:#5B6B65;font-size:14px;margin:0 0 28px}
.signed{margin-top:32px;padding:16px 18px;border:1px solid #DDD5C6;border-radius:10px;font-family:Helvetica,Arial,sans-serif;font-size:14px}
.signed b{display:block;font-size:16px;margin-bottom:4px}</style></head>
<body>
<h1>Management agreement</h1>
<p class="meta">${escape(propertyName)} · Revision ${revision}</p>
${paragraphs}
<div class="signed"><b>Accepted electronically by ${escape(signedName)}</b>On ${escape(when)}, in the Recharge app, against revision ${revision} of this agreement.</div>
</body></html>
`;
}
