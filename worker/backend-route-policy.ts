// This deployable backend exposes only Supabase-backed routes. Legacy D1
// handlers remain excluded until their business contracts are ported.
const endpoints = new Set([
  "/sign-in", "/sign-out", "/reset-password", "/update-password", "/auth/recovery",
  "/api/session", "/api/session/logout", "/api/session/recovery", "/api/session/password",
  "/api/access", "/api/access/register", "/api/mobile/account", "/api/mobile/session",
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
  "/workspace", "/recharge-wordmark.svg", "/recharge-company-logo.png", "/recharge-company-logo-dark.png",
]);
export function backendRouteAllowed(path: string) {
  return endpoints.has(path) || path.startsWith("/assets/") || /^\/fonts\/(inter|montserrat)-(400|500|600|700)\.ttf$/.test(path);
}
