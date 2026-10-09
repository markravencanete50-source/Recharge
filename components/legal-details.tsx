import { legalDetails, legalDetailsComplete } from "@/lib/legal-details";

// Who runs Recharge, from lib/legal-details.ts, as shown on the privacy, terms and deletion pages.
export function LegalIdentity() {
  const rows: [string, string][] = [
    ["Company", legalDetails.legalName], ["Trading as", legalDetails.tradingName], ["Registered office", legalDetails.registeredAddress],
    ["Company number", legalDetails.companyNumber], ["ICO registration", legalDetails.icoRegistrationNumber],
    ["Email", legalDetails.contactEmail], ["Data protection contact", legalDetails.dataProtectionContact],
  ];
  return <>
    {!legalDetailsComplete && <p role="status" className="auth-note">Some company details on this page are still being confirmed.</p>}
    <dl className="legal-details">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  </>;
}

// The contact email as a link once it is known.
export function ContactEmail() {
  const email = legalDetails.contactEmail;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? <a href={`mailto:${email}`}>{email}</a> : <>the contact email above</>;
}
