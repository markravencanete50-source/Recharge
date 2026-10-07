function json(value: unknown, status = 200) {
  return Response.json(value, {status, headers: {"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff"}});
}

// The preview has no live data or storage. It serves the app's built screens only:
// mutations are refused, and API or sign-in paths never fall back to page HTML.
export function previewResponse(request: Request): Response | null {
  const path = new URL(request.url).pathname;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({error: "This is a read-only product preview. Changes, uploads and live integrations are disabled."}, 403);
  }
  if (path === "/api" || path.startsWith("/api/")) {
    return json({error: "This service is not connected in the product preview."}, 404);
  }
  if (path === "/_worker.js" || path === "/_routes.json" || path.startsWith("/tool/") || path.startsWith("/auth/") || path.includes("signin") || path.includes("signout") || path === "/sign-in" || path === "/sign-out" || path === "/reset-password" || path === "/update-password") {
    return json({error: "Live sign-in and external tools are not connected in this preview. Return to the preview home."}, 404);
  }
  return null;
}
