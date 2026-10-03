import { properties, workflows, communications, maintenance, onboarding, cleans, operations, ownerStatements, team, accessUsers } from "./fixtures";

const endpoints: Record<string, unknown> = {
  "/api/property-database": {data: properties},
  "/api/workflows": {data: workflows},
  "/api/workflows/tickets": {data: workflows},
  "/api/communications/threads": {data: communications},
  "/api/maintenance": {data: maintenance},
  "/api/onboarding": {data: onboarding},
  "/api/cleans": {data: cleans},
  "/api/operations": operations,
  "/api/owner-statements": {data: ownerStatements},
  "/api/team": {data: team},
  "/api/purchase-orders": {data: {available: true, role: "admin", orders: []}},
  "/api/access": {users: accessUsers},
  "/api/client-reservations": {reservations: []},
  "/api/hostaway/reservations": {reservations: []},
  "/api/hostaway/properties": {properties: []},
};
function json(value: unknown, status = 200) {
  return Response.json(value, {status, headers: {"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff"}});
}

export function previewResponse(request: Request): Response | null {
  const path = new URL(request.url).pathname;
  // This Worker has no live data/storage bindings. Reject mutations before any routing.
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({error: "This is a read-only product preview. Changes, uploads and live integrations are disabled."}, 403);
  }
  if (path === "/api" || path.startsWith("/api/")) {
    return Object.hasOwn(endpoints, path) ? json(endpoints[path]) : json({error: "This service is not connected in the product preview."}, 404);
  }
  if (path === "/_worker.js" || path === "/_routes.json" || path.startsWith("/tool/") || path.includes("signin") || path.includes("signout") || path === "/sign-in" || path === "/sign-out") {
    return json({error: "Live sign-in and external tools are not connected in this preview. Return to the preview home."}, 404);
  }
  return null;
}
