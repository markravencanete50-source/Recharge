// Who Recharge is, for the privacy policy, the terms and the account-deletion page. This is the
// only place these details live: fill in each "TO BE CONFIRMED" before the app goes to the
// stores, and the pages update themselves.
export const TO_BE_CONFIRMED = 'TO BE CONFIRMED';

export const legalDetails = {
  // The registered company that runs Recharge, exactly as on Companies House.
  legalName: 'Recharge Stays Ltd',
  tradingName: 'Recharge',
  registeredAddress: '25 Bothwell Street, Glasgow, G2 6NL',
  companyNumber: 'SC799955',
  // From the Information Commissioner's Office data protection fee register.
  icoRegistrationNumber: TO_BE_CONFIRMED,
  contactEmail: TO_BE_CONFIRMED,
  // The person or role who answers privacy requests, with how to reach them.
  dataProtectionContact: TO_BE_CONFIRMED,
  // The date the privacy policy and terms were last changed, written out (for example "10 October 2026").
  lastUpdated: TO_BE_CONFIRMED,
} as const;

export type LegalDetails = typeof legalDetails;

// The name Recharge trades under on its invoices and emails ("Recharge Group"), above the legal name. Read from here only
// (lib/recharge-invoice.ts); kept out of legalDetails so the policy pages are unchanged.
export const groupTradingName = 'Recharge Group';

// True once every detail above is filled in. The pages show a notice until then.
export const legalDetailsComplete = Object.values(legalDetails).every(value => value.trim() !== '' && value !== TO_BE_CONFIRMED);

// The public addresses of the policy pages, on the same site as the app's backend.
export const LEGAL_PATHS = { privacy: '/privacy', terms: '/terms', deleteAccount: '/delete-account' } as const;
