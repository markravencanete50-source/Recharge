// This deployable backend exposes only Supabase-backed routes. Legacy D1
// handlers remain excluded until their business contracts are ported.
const endpoints = new Set([
  "/sign-in", "/sign-out", "/reset-password", "/update-password", "/auth/recovery",
  "/api/session", "/api/session/logout", "/api/session/recovery", "/api/session/password",
  "/api/access", "/api/access/register", "/api/mobile/account", "/api/mobile/session",
  "/api/mobile/workspace", "/api/mobile/reports", "/api/mobile/reports/export",
  "/api/mobile/property-details", "/api/mobile/devices",
  "/api/workspace", "/api/workspace/reports", "/api/workspace/reports/export", "/api/workspace/property-details",
]);
export function backendRouteAllowed(path: string) {
  return endpoints.has(path) || path.startsWith("/assets/");
}
