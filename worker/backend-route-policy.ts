// This deployable backend exposes only Supabase-backed routes. Legacy D1
// handlers remain excluded until their business contracts are ported.
const endpoints = new Set([
  "/sign-in", "/sign-out", "/reset-password", "/update-password", "/auth/recovery", "/auth/set-password",
  "/api/session", "/api/session/logout", "/api/session/recovery", "/api/session/password",
  "/api/mobile/account", "/api/mobile/session",
  "/api/mobile/workspace", "/api/mobile/reports", "/api/mobile/reports/export",
  "/api/mobile/property-details", "/api/mobile/devices",
  "/api/workspace", "/api/workspace/reports", "/api/workspace/reports/export", "/api/workspace/property-details",
  "/api/workspace/journeys", "/api/mobile/journeys",
  "/api/workspace/operations", "/api/mobile/operations",
  "/api/workspace/portfolio", "/api/mobile/portfolio",
  "/api/workspace/controls", "/api/mobile/controls",
  "/api/session/phone-recovery", "/api/mobile/recovery",
  "/api/workspace/integrations", "/api/mobile/integrations",
  "/api/workspace/media", "/api/mobile/media",
  "/api/workspace/finance", "/api/mobile/finance",
  "/api/workspace/teams", "/api/mobile/teams",
  "/api/workspace/admin", "/api/mobile/admin",
  "/api/workspace/chat", "/api/mobile/chat", "/api/workspace/guest-inbox", "/api/mobile/guest-inbox", "/api/workspace/training-files", "/api/mobile/training-files",
  // The PriceLabs report kept with a lead (20261025300000).
  "/api/workspace/lead-files", "/api/mobile/lead-files",
  // Agreement follow-ups (20261027200000).
  "/api/workspace/agreement-follow-ups", "/api/mobile/agreement-follow-ups",
  "/api/workspace/owner", "/api/mobile/owner",
  "/api/hostaway/webhook", "/api/resend/webhook", "/api/workspace/email-files", "/api/mobile/email-files", "/api/workspace/email-inbox", "/api/mobile/email-inbox", "/api/workspace/client-email", "/api/mobile/client-email", "/api/workspace/account", "/api/workspace/notifications",
  "/api/workspace/oversight", "/api/mobile/oversight",
  "/api/workspace/checklists", "/api/mobile/checklists",
  // Recharge's invoices and the invoice maker (20261022100000).
  "/api/workspace/documents", "/api/mobile/documents",
  // Furnishing Studio: catalogue, client quotes, shopping lists and analytics (20261023200000).
  "/api/workspace/furnishing", "/api/mobile/furnishing",
  // Client Enquiries: the landlord's form (no account), and the team opening the files sent with it.
  "/enquiry", "/api/enquiry", "/api/enquiry/upload", "/api/workspace/enquiry-files", "/api/mobile/enquiry-files",
  // The estimate emailed with a private link: the client's page (no account) and the team's Resend / Copy link.
  "/estimate", "/api/estimate", "/api/workspace/estimate-link", "/api/mobile/estimate-link",
  // Guest messages from the company website's server, and its chat window reading a chat back (shared key; 20261026200000, 20261027100000).
  "/api/website/guest-messages", "/api/website/guest-chat",
  // The survey a guest opens from the email after a direct stay (no account; the link is for one stay).
  "/stay-survey", "/api/stay-survey",
  // Onboarding settings (the contract used as the agreement template) and the owner's account made on Proceed.
  "/api/workspace/onboarding-settings", "/api/mobile/onboarding-settings", "/api/workspace/owner-account", "/api/mobile/owner-account",
  // The owner's onboarding checklist and the onboarding videos (migration 20261025200000).
  "/api/workspace/client-onboarding", "/api/mobile/client-onboarding",
  // Messages photos and videos, and profile photos.
  "/api/workspace/chat-files", "/api/mobile/chat-files", "/api/workspace/profile", "/api/mobile/profile",
  "/privacy", "/terms", "/delete-account", "/api/session/delete-account", "/api/workspace/privacy", "/api/mobile/privacy",
  "/workspace", "/favicon.svg", "/recharge-wordmark.svg", "/recharge-company-logo.png", "/recharge-company-logo-dark.png", "/recharge-email-logo.png",
]);
// The app's browser build is served from /workspace/ (scripts/build-workspace-web.mjs).
export const isWorkspaceApp = (path: string) => path === "/workspace" || path.startsWith("/workspace/");
// Built app files whose names carry a content hash (entry-<hash>.js, logo.<hash>.png): safe to cache for good.
export const hashedWorkspaceFile = (path: string) => isWorkspaceApp(path) && /[.-][0-9a-f]{20,}\.(js|css|png|jpg|svg|ttf|woff2?|ico)$/.test(path);
export function backendRouteAllowed(path: string) {
  return endpoints.has(path) || isWorkspaceApp(path) || path.startsWith("/assets/") || /^\/fonts\/(inter|montserrat)-(400|500|600|700)\.ttf$/.test(path);
}
