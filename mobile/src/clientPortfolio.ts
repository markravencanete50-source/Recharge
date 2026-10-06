import { propertiesFor } from "./model";

// Fictional client portfolio for the preview: onboarding stages, bookings and
// earnings derived from them. No real guests, owners, addresses or money.
export const ONBOARDING_STEPS = [
  { key: "enquiry", label: "Enquiry" },
  { key: "estimate", label: "Estimate" },
  { key: "agreement", label: "Agreement" },
  { key: "setup", label: "Property setup" },
  { key: "inspection", label: "Inspection" },
  { key: "live", label: "Live" },
] as const;
export type OnboardingStage = (typeof ONBOARDING_STEPS)[number]["key"];

export type ClientProperty = {
  id: string;
  name: string;
  region: string;
  bedrooms: number;
  stage: OnboardingStage;
  nextStep: string;
};
export type Booking = {
  id: string;
  propertyId: string;
  guest: string;
  channel: "Airbnb" | "Booking.com" | "Direct";
  checkIn: string;
  checkOut: string;
  guests: number;
  payoutMinor: number;
};

const day = 86400000;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const nightsBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / day);

export function stageIndex(stage: OnboardingStage) {
  return ONBOARDING_STEPS.findIndex((step) => step.key === stage);
}

export function clientPortfolio(now = new Date()) {
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const at = (offset: number) => iso(new Date(today.getTime() + offset * day));
  const live = propertiesFor("client").map((property) => ({
    id: property.id,
    name: property.propertyName,
    region: property.region,
    bedrooms: Number(property.bedrooms) || 0,
    stage: "live" as const,
    nextStep: "Taking bookings",
  }));
  const properties: ClientProperty[] = [
    ...live,
    { id: "sample-leith", name: "Example Leith Townhouse", region: "Edinburgh & Lothians", bedrooms: 3, stage: "agreement", nextStep: "Review and sign the management agreement" },
    { id: "sample-stirling", name: "Example Stirling Cottage", region: "Central Scotland", bedrooms: 2, stage: "inspection", nextStep: "Inspection booked for next week" },
  ];
  const [first, second] = live;
  const plan: [string | undefined, string, Booking["channel"], number, number, number, number][] = [
    [first?.id, "Example guest A", "Airbnb", -9, -5, 2, 46000],
    [first?.id, "Example guest B", "Booking.com", -2, 2, 3, 52000],
    [first?.id, "Example guest C", "Direct", 4, 9, 2, 61000],
    [first?.id, "Example guest D", "Airbnb", 12, 15, 4, 39000],
    [second?.id, "Example guest E", "Airbnb", -6, -3, 2, 33000],
    [second?.id, "Example guest F", "Direct", 0, 4, 2, 44000],
    [second?.id, "Example guest G", "Booking.com", 7, 10, 1, 31000],
    [second?.id, "Example guest H", "Airbnb", 18, 23, 3, 58000],
  ];
  const bookings: Booking[] = plan
    .filter((row): row is [string, string, Booking["channel"], number, number, number, number] => !!row[0])
    .map(([propertyId, guest, channel, start, end, guests, payoutMinor], index) => ({
      id: "sample-booking-" + index, propertyId, guest, channel, checkIn: at(start), checkOut: at(end), guests, payoutMinor,
    }));
  const todayKey = iso(today);
  const monthStart = iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
  const monthEnd = iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1)));
  const daysInMonth = nightsBetween(monthStart, monthEnd);
  const nightsIn = (booking: Booking, from: string, to: string) => {
    const start = booking.checkIn > from ? booking.checkIn : from;
    const end = booking.checkOut < to ? booking.checkOut : to;
    return Math.max(0, nightsBetween(start, end));
  };
  const perProperty = live.map((property) => {
    const own = bookings.filter((booking) => booking.propertyId === property.id);
    const nights = own.reduce((total, booking) => total + nightsIn(booking, monthStart, monthEnd), 0);
    // Earnings are attributed by nights stayed within the month.
    const earningsMinor = own.reduce((total, booking) => total + Math.round(booking.payoutMinor * nightsIn(booking, monthStart, monthEnd) / Math.max(1, nightsBetween(booking.checkIn, booking.checkOut))), 0);
    return { ...property, nights, earningsMinor, occupancy: daysInMonth ? nights / daysInMonth : 0, bookings: own.length };
  });
  const earningsMinor = perProperty.reduce((total, property) => total + property.earningsMinor, 0);
  const bookedNights = perProperty.reduce((total, property) => total + property.nights, 0);
  return {
    properties,
    bookings,
    perProperty,
    inHouse: bookings.filter((booking) => booking.checkIn <= todayKey && booking.checkOut > todayKey),
    upcoming: bookings.filter((booking) => booking.checkIn > todayKey).sort((a, b) => a.checkIn.localeCompare(b.checkIn)),
    earningsMinor,
    occupancy: live.length && daysInMonth ? bookedNights / (live.length * daysInMonth) : 0,
    averageNightlyMinor: bookedNights ? Math.round(earningsMinor / bookedNights) : 0,
    onboarding: properties.filter((property) => property.stage !== "live"),
    today: todayKey,
    monthLabel: today.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}

export const formatMoney = (minor: number) => "£" + Math.round(minor / 100).toLocaleString("en-GB");
export const nights = nightsBetween;
