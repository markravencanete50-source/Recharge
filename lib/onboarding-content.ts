// Words the owner reads during onboarding, kept in one place so Recharge can adjust them without
// touching the screens: what Recharge does, the extras, how onboarding runs, owner questions, and
// the new-property inspection checklist.

export const SERVICES: { title: string; detail: string; icon: string }[] = [
  { title: 'Listing and pricing', icon: 'trending-up', detail: 'Your property listed on Airbnb, Booking.com and the Recharge direct-booking site. Every empty night in the coming week is checked daily and the price held or changed for a reason.' },
  { title: 'Guests looked after', icon: 'message-circle', detail: 'Our guest relations team answers guests quickly, with reply times tracked for every message.' },
  { title: 'Cleaning between stays', icon: 'wind', detail: 'A checklist clean after every stay, checked with the guest, and replaced if a clean is not up to standard.' },
  { title: 'Repairs handled', icon: 'tool', detail: 'We troubleshoot with the guest first, then our Ready team fixes it. Repairs under your limit go ahead; anything above it comes to you to approve.' },
  { title: 'Weekly performance report', icon: 'file-text', detail: 'Every price change we made, listing checks, and local events that could bring bookings, sent to you each week.' },
  { title: 'Longer stays booked direct', icon: 'home', detail: 'Guests staying a week or more are offered a direct booking, so less of your income goes in platform fees.' },
];

export const EXTRAS: { title: string; detail: string }[] = [
  { title: 'Licensing', detail: 'We take your short-term let licence through application, safety checks and grant.' },
  { title: 'Furnishing', detail: 'We quote for and furnish the property, or give you the full list to do it yourself.' },
  { title: 'Garden and bins', detail: 'Regular garden maintenance and bin collections arranged by our Ready team.' },
  { title: 'Your post', detail: 'Letters photographed (or opened and photographed) and shown in your mailbox in the app.' },
];

export const PROCESS: { step: string; detail: string }[] = [
  { step: 'Estimate', detail: 'You review what the property could earn and decide.' },
  { step: 'Agreement', detail: 'You sign the management agreement in the app.' },
  { step: 'Property set-up', detail: 'You tell us about access, utilities, repairs, post and furnishing.' },
  { step: 'Onboarding invoice', detail: 'Accounts send the onboarding invoice; the tick appears here once it is paid.' },
  { step: 'Inspection', detail: 'Our Ready team inspects the property on your access date.' },
  { step: 'Live', detail: 'The listings go live and the first guests can book.' },
];

export const OWNER_FAQ: { q: string; a: string }[] = [
  { q: 'How is my estimate worked out?', a: 'From the nightly rates similar properties nearby achieve (the comparables shown) and how often they are booked. Use "Explore your estimate" to try a quieter or stronger year, a different occupancy, or more direct bookings.' },
  { q: 'What if I need more time to decide?', a: 'Choose "Thank you, I’ll be in touch" with a date. We will check in with you then, and nothing moves on until you decide.' },
  { q: 'Who decides on repairs?', a: 'You set a limit per repair in the property set-up form. Repairs under it go ahead so guests are not left waiting; anything over it comes to you to approve first. You can also name a contractor or warranty provider for us to contact first.' },
  { q: 'How do I get paid?', a: 'Your earnings are paid to the bank account you give in the property set-up form, and you will see a statement for each period. Your payout details are only shown when someone asks to see them.' },
  { q: 'What happens to my post?', a: 'You choose in the set-up form: photograph it, open and photograph it, or leave it somewhere safe. Photographed post appears in your mailbox in the app.' },
  { q: 'Can I ask something else?', a: 'Yes. Use "Ask Recharge a question" here at any point. The team is told straight away and the answer appears on this page.' },
];

export const INSPECTION_CHECKS: { key: string; label: string }[] = [
  { key: 'keysAccess', label: 'Keys, key safe and locks all work' },
  { key: 'alarms', label: 'Smoke, heat and carbon monoxide alarms tested' },
  { key: 'heatingHotWater', label: 'Heating and hot water working' },
  { key: 'appliances', label: 'All appliances working' },
  { key: 'wifi', label: 'Wi-Fi connected and the details recorded' },
  { key: 'damage', label: 'No damage, or damage noted and photographed' },
  { key: 'furnishing', label: 'Furnishing and linen complete' },
  { key: 'safetyItems', label: 'Fire blanket, first-aid kit and safety items in place' },
  { key: 'guestReady', label: 'Clean and ready for guests' },
];
