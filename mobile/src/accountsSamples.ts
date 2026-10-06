import { useSyncExternalStore } from "react";
import { clientPortfolio, type Booking } from "./clientPortfolio";

// Fictional supplier invoices for the accounts preview. Invoices arrive by
// email, need evidence before approval and are then posted to Xero against
// the property they relate to.
export type ExpenseStatus = "to-approve" | "queried" | "approved";
export type Evidence = { kind: "invoice" | "photo" | "quote" | "report"; label: string };
export type Expense = {
  id: string;
  supplier: string;
  reference: string;
  propertyId: string;
  propertyName: string;
  category: "Maintenance" | "Property setup" | "Cleaning supplies" | "Utilities";
  amountMinor: number;
  received: string;
  from: string;
  description: string;
  evidence: Evidence[];
  status: ExpenseStatus;
  query?: string;
};

export const CLEAN_COST_MINOR = 6500;
export const MANAGEMENT_FEE_BPS = 1500;

function initialExpenses(): Expense[] {
  const live = clientPortfolio().perProperty;
  const [a, b] = [live[0], live[1] ?? live[0]];
  const at = (property: typeof a) => ({ propertyId: property?.id ?? "sample", propertyName: property?.name ?? "Example property" });
  return [
    { id: "exp-1", supplier: "Example Plumbing Ltd", reference: "INV-2291", ...at(a), category: "Maintenance", amountMinor: 18500, received: "Today, 08:42", from: "accounts@example-plumbing.test", description: "Replace leaking kitchen tap and isolate valve.", evidence: [{ kind: "invoice", label: "Invoice INV-2291.pdf" }, { kind: "photo", label: "Before: leaking tap" }, { kind: "photo", label: "After: new tap fitted" }, { kind: "report", label: "Ready team sign-off" }], status: "to-approve" },
    { id: "exp-2", supplier: "Example Interiors", reference: "Q-0184", ...at(b), category: "Property setup", amountMinor: 64000, received: "Yesterday, 16:10", from: "hello@example-interiors.test", description: "Bedding, towels and kitchen starter pack for go-live.", evidence: [{ kind: "quote", label: "Approved quotation Q-0184" }, { kind: "invoice", label: "Invoice 7781.pdf" }, { kind: "photo", label: "Delivery photo" }], status: "to-approve" },
    { id: "exp-3", supplier: "Example Electrical", reference: "E-5530", ...at(a), category: "Maintenance", amountMinor: 9500, received: "Yesterday, 11:03", from: "billing@example-electrical.test", description: "Call-out for tripped fuse board.", evidence: [{ kind: "invoice", label: "Invoice E-5530.pdf" }], status: "to-approve" },
    { id: "exp-4", supplier: "Example Supplies Co", reference: "SUP-118", ...at(b), category: "Cleaning supplies", amountMinor: 4200, received: "2 days ago", from: "orders@example-supplies.test", description: "Monthly consumables restock.", evidence: [{ kind: "invoice", label: "Invoice SUP-118.pdf" }, { kind: "report", label: "Stock check from cleaning manager" }], status: "approved" },
    { id: "exp-5", supplier: "Example Energy", reference: "UT-0921", ...at(a), category: "Utilities", amountMinor: 11800, received: "3 days ago", from: "bills@example-energy.test", description: "Electricity, September.", evidence: [{ kind: "invoice", label: "Bill UT-0921.pdf" }], status: "approved" },
  ];
}

// Tiny shared store so an approval shows on the owner statement straight away.
let expenses: Expense[] | null = null;
const listeners = new Set<() => void>();
const read = () => (expenses ??= initialExpenses());
export function useExpenses() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, read, read);
}
export function updateExpense(id: string, change: Partial<Expense>) {
  expenses = read().map(expense => (expense.id === id ? { ...expense, ...change } : expense));
  listeners.forEach(listener => listener());
}

const money = (minor: number) => (minor / 100).toFixed(2);
// Example payout exports shaped like the platform downloads. One Airbnb
// payout differs from the reservation and one Booking.com payout is missing,
// so the reconciliation has something to resolve.
export function samplePayoutReports(bookings: Booking[]) {
  const airbnb = bookings.filter(booking => booking.channel === "Airbnb");
  const booking = bookings.filter(item => item.channel === "Booking.com");
  const airbnbCsv = [
    "Date,Type,Confirmation Code,Start Date,Nights,Guest,Listing,Amount,Paid Out",
    `${airbnb[0]?.checkIn ?? ""},Payout,,,,,,,"${money(airbnb.reduce((sum, item) => sum + item.payoutMinor, 0))}"`,
    ...airbnb.map((item, index) => `${item.checkIn},Reservation,${item.code},${item.checkIn},3,${item.guest},Example listing,${money(item.payoutMinor - (index === 1 ? 1500 : 0))},`),
  ].join("\n");
  const bookingCsv = [
    "Reservation number,Check-in,Check-out,Guest name,Payout amount,Currency",
    ...booking.slice(0, Math.max(0, booking.length - 1)).map(item => `${item.code},${item.checkIn},${item.checkOut},${item.guest},${money(item.payoutMinor)},GBP`),
  ].join("\n");
  return { airbnbCsv, bookingCsv };
}
