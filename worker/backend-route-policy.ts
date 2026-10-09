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
  "/api/workspace/owner", "/api/mobile/owner",
  "/api/hostaway/webhook", "/api/workspace/account", "/api/workspace/notifications",
  "/api/workspace/oversight", "/api/mobile/oversight",
  "/api/workspace/checklists", "/api/mobile/checklists",
  "/workspace", "/recharge-wordmark.svg", "/recharge-company-logo.png", "/recharge-company-logo-dark.png",
]);
// The app's browser build is served from /workspace/ (scripts/build-workspace-web.mjs).
export const isWorkspaceApp = (path: string) => path === "/workspace" || path.startsWith("/workspace/");
// Built app files whose names carry a content hash (entry-<hash>.js, logo.<hash>.png): safe to cache for good.
export const hashedWorkspaceFile = (path: string) => isWorkspaceApp(path) && /[.-][0-9a-f]{20,}\.(js|css|png|jpg|svg|ttf|woff2?|ico)$/.test(path);
export function backendRouteAllowed(path: string) {
  return endpoints.has(path) || isWorkspaceApp(path) || path.startsWith("/assets/") || /^\/fonts\/(inter|montserrat)-(400|500|600|700)\.ttf$/.test(path);
}
