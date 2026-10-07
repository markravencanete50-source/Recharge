import { previewResponse } from "./responses";

const worker = {
  async fetch(request: Request, env: { ASSETS: Fetcher }): Promise<Response> {
    const result = previewResponse(request);
    if (result) return result;
    const url = new URL(request.url);
    // The old portal has been retired; send its preview address to the app.
    if (url.pathname === "/legacy-preview") return Response.redirect(new URL("/", url).toString(), 301);
    const mobileRoutes = ["/home", "/work", "/properties", "/inbox", "/more", "/workspace", "/analytics", "/calendar", "/approvals", "/help", "/activity"];
    // Pages redirects .html requests to extensionless URLs, even through ASSETS.
    // Request the canonical asset to preserve the user's route inside the frame.
    if (url.pathname === "/studio.html" || url.pathname === "/mobile" || (url.pathname === "/" && url.searchParams.get("view") === "phone")) url.pathname = "/studio";
    // Desktop and phone previews render the same responsive Expo screens.
    else if (url.pathname === "/" || mobileRoutes.includes(url.pathname)) url.pathname = "/native";
    const asset = await env.ASSETS.fetch(new Request(url, request));
    const response = new Response(asset.body, asset);
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  },
};

export default worker;
