import type { ModuleId, WorkspaceRole } from "./model";

// Fictional preview data for the team workflows described by the client.
// No real guests, staff, properties, messages or money.

// Quick access: the tools each role reaches for most.
export const QUICK_TOOLS: Record<WorkspaceRole, ModuleId[]> = {
  super_admin: ["guest-communication", "daily-pricing", "listing-health", "maintenance-reporting"],
  admin: ["guest-communication", "daily-pricing", "listing-health", "maintenance-reporting"],
  stays: ["guest-communication", "daily-pricing", "listing-health", "maintenance-reporting"],
  cleans: ["cleaning-schedule", "cleaner-performance", "cleans-invoices"],
  cleaning_manager: ["cleaning-schedule", "cleaner-database", "cleaner-performance", "clean-reporting"],
  ready: ["maintenance-reporting", "routine-bin-garden-board", "new-property-inspection-board", "purchase-order"],
  client: ["client-dashboard", "client-property-maintenance", "client-purchase-order-quotes", "client-mailbox"],
};

// The Stays team's daily routine, from the client's list of daily reports.
export const DAILY_ROUTINE: { id: ModuleId; label: string; cadence: string }[] = [
  { id: "daily-pricing", label: "Daily pricing report", cadence: "Every day" },
  { id: "listing-health", label: "Listing health report", cadence: "Every day" },
  { id: "maintenance-reporting", label: "Maintenance reporting", cadence: "Every day" },
  { id: "clean-reporting", label: "Approve yesterday's cleans", cadence: "Every day" },
  { id: "aircover-reporting", label: "AirCover reporting", cadence: "Every day" },
  { id: "direct-bookings", label: "Direct booking reporting", cadence: "Every day" },
  { id: "weekly-performance", label: "Weekly performance report", cadence: "Mondays" },
];

export type InboxChannel = "guests" | "clients" | "team" | "whatsapp" | "email";
export const CHANNELS: { key: InboxChannel; label: string; icon: "home" | "briefcase" | "users" | "message-circle" | "mail" }[] = [
  { key: "guests", label: "Guests", icon: "home" },
  { key: "clients", label: "Clients", icon: "briefcase" },
  { key: "team", label: "Team", icon: "users" },
  { key: "whatsapp", label: "WhatsApp", icon: "message-circle" },
  { key: "email", label: "Email", icon: "mail" },
];
export type Thread = {
  id: string;
  channel: InboxChannel;
  name: string;
  property: string;
  source: string;
  time: string;
  unread: boolean;
  messages: { from: "them" | "us"; author: string; body: string; time: string }[];
  suggestion?: string;
};
export const TEAM_THREADS: Thread[] = [
  { id: "t1", channel: "guests", name: "Example guest B", property: "Example Edinburgh Apartment", source: "Airbnb via Hostaway", time: "09:12", unread: true,
    messages: [{ from: "them", author: "Example guest B", body: "Hi! What time can we check in on Friday, and is there parking nearby?", time: "09:12" }],
    suggestion: "Hi! Check-in is from 3pm on Friday. Your door code and directions arrive by message on the morning of arrival. The nearest parking is the pay-and-display on the next street; there is no private space at the property. Let us know if anything else would help." },
  { id: "t2", channel: "guests", name: "Example guest F", property: "Example Glasgow Apartment", source: "Booking.com via Hostaway", time: "Yesterday", unread: false,
    messages: [{ from: "them", author: "Example guest F", body: "The Wi-Fi password on the card isn't working.", time: "18:40" }, { from: "us", author: "Stays team", body: "Sorry about that. Please try the network ending in 5G. We're sending the correct details now.", time: "18:46" }],
    suggestion: "Just checking the Wi-Fi is working well for you now. If it drops again, restarting the router in the hallway cupboard usually fixes it within a minute." },
  { id: "t3", channel: "clients", name: "Example owner", property: "Example Leith Townhouse", source: "Client portal", time: "08:30", unread: true,
    messages: [{ from: "them", author: "Example owner", body: "I've read the management agreement. Who do I speak to about the furnishing quote?", time: "08:30" }] },
  { id: "t4", channel: "team", name: "Maintenance coordinator", property: "Example Glasgow Apartment", source: "Ready team", time: "10:05", unread: true,
    messages: [{ from: "them", author: "Ready team", body: "Boiler engineer booked for Thursday 10am. Quote to follow after the visit.", time: "10:05" }] },
  { id: "t5", channel: "whatsapp", name: "Example cleaner", property: "Example Edinburgh Apartment", source: "Team WhatsApp", time: "07:58", unread: false,
    messages: [{ from: "them", author: "Example cleaner", body: "Turnover finished, photos uploaded. Bathroom extractor fan is noisy.", time: "07:58" }] },
  { id: "t6", channel: "email", name: "Example supplier", property: "Portfolio", source: "team@ shared inbox", time: "Mon", unread: false,
    messages: [{ from: "them", author: "Example supplier", body: "Your linen order has been dispatched and will arrive on Wednesday.", time: "Mon" }] },
];
export const CLEANER_THREADS: Thread[] = [
  { id: "c1", channel: "team", name: "Stays team", property: "Example Edinburgh Apartment", source: "Property chat", time: "08:10", unread: true,
    messages: [{ from: "them", author: "Stays team", body: "Early check-in requested for today. Could you finish by 1pm?", time: "08:10" }] },
  { id: "c2", channel: "team", name: "Ready team", property: "Example Glasgow Apartment", source: "Property chat", time: "Yesterday", unread: false,
    messages: [{ from: "us", author: "You", body: "Kitchen tap is dripping, photo attached.", time: "16:20" }, { from: "them", author: "Ready team", body: "Thanks, booked in for Thursday.", time: "16:45" }] },
];

export type CleanSubmission = {
  id: string;
  cleaner: string;
  property: string;
  date: string;
  photos: number;
  issue?: string;
};
export const CLEANS_TO_APPROVE: CleanSubmission[] = [
  { id: "s1", cleaner: "Example cleaner", property: "Example Edinburgh Apartment", date: "Today, 11:40", photos: 18 },
  { id: "s2", cleaner: "Example cleaner 2", property: "Example Glasgow Apartment", date: "Today, 10:15", photos: 14, issue: "Bathroom extractor fan is noisy" },
];
export const CLEANER_PERFORMANCE = [
  { name: "Example cleaner", approved: 42, rejected: 0, warning: "none" as const },
  { name: "Example cleaner 2", approved: 31, rejected: 1, warning: "none" as const },
  { name: "Example cleaner 3", approved: 18, rejected: 2, warning: "warning" as const },
];
export const CLEAN_CHECKLIST = [
  "Kitchen cleaned and dishes put away",
  "Bathrooms cleaned and restocked",
  "Beds made with fresh linen",
  "Floors vacuumed and mopped",
  "Bins emptied and recycling out",
  "Welcome pack and toiletries restocked",
];

// Ready: how a repair moves, with sample counts.
export const REPAIR_STAGES = [
  { key: "reported", label: "Reported", count: 3 },
  { key: "visit", label: "Visit booked", count: 2 },
  { key: "quote", label: "Quote with landlord", count: 1 },
  { key: "approved", label: "Approved", count: 1 },
  { key: "scheduled", label: "Scheduled", count: 2 },
  { key: "completed", label: "Completed", count: 1 },
  { key: "accounts", label: "With Accounts", count: 1 },
];
export const ROUTINE_VISITS = [
  { property: "Example Edinburgh Apartment", status: "booked" as const, when: "Thu 9 Oct" },
  { property: "Example Glasgow Apartment", status: "due" as const, when: "Due this month" },
  { property: "Example Stirling Cottage", status: "done" as const, when: "Done 2 Oct" },
];

export type Course = { id: string; title: string; category: string; minutes: number; progress: number; summary: string; points: string[] };
export const COURSES: Course[] = [
  { id: "guest-standards", title: "Guest communication standards", category: "Stays", minutes: 12, progress: 1,
    summary: "Tone, response times and the templates we use with guests on every platform.",
    points: ["Reply to every guest within 15 minutes during working hours.", "Use the guest's name and confirm the property in your first line.", "Check the AI suggestion against the property's details before sending."] },
  { id: "clean-standards", title: "Cleaning standards and photo evidence", category: "Cleans", minutes: 15, progress: 0.4,
    summary: "What a guest-ready property looks like, room by room, and how to photograph it.",
    points: ["Photograph every room from the doorway, then any detail you fixed.", "Confirm Wi-Fi and broadband before you leave.", "Report maintenance issues in the clean form, not by message."] },
  { id: "maintenance-handover", title: "Maintenance handover to Ready", category: "Ready", minutes: 8, progress: 0,
    summary: "Raising a repair, getting a quote approved and closing it with Accounts.",
    points: ["Include photos and the guest impact when you raise a repair.", "Quotes over the agreed limit need landlord approval.", "Completion reports go to Accounts automatically."] },
  { id: "using-recharge", title: "Getting the most from Recharge", category: "Everyone", minutes: 6, progress: 0,
    summary: "Finding tools, pinning favourites and keeping your inbox under control.",
    points: ["Pin your daily tools from the Tools tab.", "Use Quick search to jump anywhere.", "Turn on notifications so nothing waits on you."] },
];
