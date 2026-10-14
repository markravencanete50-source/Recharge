// The Recharge logo in the emails we send (Lee, 14 October: "the logo of the email should use the logo of Recharge").
// Every email ends with a small signature at the bottom (Lee, 14 October: "the logo in the email should be in the bottom
// like a signature"): a hairline, the logo, "Recharge Group" and the mailbox it came from. That covers the enquiry form, the
// estimate, replies written in Messages and staff notices. Plain-text parts never change.
// The image is a small PNG made for email from public/recharge-company-logo.png: email apps block SVG, and it sits on its own
// solid cream background, so it reads the same when a mail app shows the email dark. Served from the app's own address.
export const EMAIL_LOGO_URL = 'https://app.rechargegroup.co.uk/recharge-email-logo.png';
// The PNG is 480 by 133; shown at this size (crisp on high-density screens).
const LOGO = { width: 108, height: 30 } as const;

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const logo = () => `<img src="${EMAIL_LOGO_URL}" alt="Recharge" width="${LOGO.width}" height="${LOGO.height}" style="display:block;border:0;outline:none;text-decoration:none;width:${LOGO.width}px;height:${LOGO.height}px;border-radius:6px">`;

/** The signature at the bottom of every email: the logo, "Recharge Group" and, when there is one, the mailbox it came from. */
export function emailSignature(address?: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 0;border-collapse:collapse"><tr>`
    + `<td style="padding:12px 0 0;border-top:1px solid #D9D3C4">${logo()}`
    + `<div style="margin:8px 0 0;font-family:Inter,Arial,sans-serif;font-size:13px;line-height:1.5;color:#152D28"><strong>Recharge Group</strong>`
    + (address ? `<br><a href="mailto:${escape(address)}" style="color:#4E6259;text-decoration:none">${escape(address)}</a>` : '')
    + `</div></td></tr></table>`;
}
/** The same signature under a reply written in Messages. */
export const replySignature = (address: string) => emailSignature(address);

const paragraphs = (text: string) => text.replace(/\r\n?/g, '\n').trim().split(/\n{2,}/).map(part => `<p style="margin:0 0 14px">${escape(part).replace(/\n/g, '<br>')}</p>`).join('');
const frame = (inner: string) => `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.6;color:#152D28;max-width:560px">${inner}</div>`;

/** A reply's HTML: the text exactly as written (paragraphs and line breaks kept, links not added), then the signature. Every reply. */
export const replyHtml = (text: string, address: string) => frame(paragraphs(text) + replySignature(address));

/** A plain-text email Recharge sends (the staff notice emails), with the signature at the bottom. */
export const noticeHtml = (text: string) => frame(paragraphs(text) + emailSignature());
