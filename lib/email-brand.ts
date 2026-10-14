// The Recharge logo in the emails we send (Lee, 14 October: "the logo of the email should use the logo of Recharge").
// Emails Recharge writes (the enquiry form, the estimate) start with the logo; replies written in Messages end with a small
// signature (logo, "Recharge Group", the mailbox), so they still read as a personal reply. Plain-text parts never change.
// The image is a small PNG made for email from public/recharge-company-logo.png: email apps block SVG, and it sits on its own
// solid cream background, so it reads the same when a mail app shows the email dark. Served from the app's own address.
export const EMAIL_LOGO_URL = 'https://app.rechargegroup.co.uk/recharge-email-logo.png';
// The PNG is 480 by 133; shown at these sizes (crisp on high-density screens).
const LOGO = { header: { width: 180, height: 50 }, signature: { width: 108, height: 30 } } as const;

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const logo = (size: keyof typeof LOGO) => {
  const { width, height } = LOGO[size];
  return `<img src="${EMAIL_LOGO_URL}" alt="Recharge" width="${width}" height="${height}" style="display:block;border:0;outline:none;text-decoration:none;width:${width}px;height:${height}px;border-radius:${size === 'header' ? 10 : 6}px">`;
};

/** The logo at the top of an email Recharge writes. */
export const emailHeader = () => `<div style="margin:0 0 24px">${logo('header')}</div>`;

/** The small signature under a reply written in Messages: the logo, "Recharge Group" and the mailbox it came from. */
export function replySignature(address: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 0;border-collapse:collapse"><tr>`
    + `<td style="padding:12px 0 0;border-top:1px solid #D9D3C4">${logo('signature')}`
    + `<div style="margin:8px 0 0;font-family:Inter,Arial,sans-serif;font-size:13px;line-height:1.5;color:#152D28"><strong>Recharge Group</strong><br>`
    + `<a href="mailto:${escape(address)}" style="color:#4E6259;text-decoration:none">${escape(address)}</a></div></td></tr></table>`;
}

/** A reply's HTML: the text exactly as written (paragraphs and line breaks kept, links not added), then the signature. */
export function replyHtml(text: string, address: string) {
  const body = text.replace(/\r\n?/g, '\n').trim().split(/\n{2,}/).map(part => `<p style="margin:0 0 14px">${escape(part).replace(/\n/g, '<br>')}</p>`).join('');
  return `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.6;color:#152D28;max-width:560px">${body}${replySignature(address)}</div>`;
}
