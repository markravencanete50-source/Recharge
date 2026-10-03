import { previewResponse } from "./responses";

const worker = {
  async fetch(request: Request, env: { ASSETS: Fetcher }): Promise<Response> {
    const result = previewResponse(request);
    if (result) return result;
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  },
};

export default worker;
