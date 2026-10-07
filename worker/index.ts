/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { backendRouteAllowed, isWorkspaceApp } from "./backend-route-policy";
import { securityHeaders } from "../lib/auth-security-policy";

interface Env {
  BACKEND_ONLY?: string;
  INTEGRATION_SCHEDULE_ENABLED?: string;
  HOSTAWAY_ACCOUNT_ID?: string;
  HOSTAWAY_API_KEY?: string;
  HOSTAWAY_SYNC_ENABLED?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  AUTH_RATE_LIMIT_SECRET?: string;
  APP_ORIGIN?: string;
  ASSETS: Fetcher;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async scheduled(_controller: unknown, env: Env, ctx: ExecutionContext): Promise<void> {
    // Every 15 minutes (scripts/build-backend-config.mjs). Each job only runs once configured.
    if (env.BACKEND_ONLY !== 'true') return;
    if (env.HOSTAWAY_ACCOUNT_ID && env.HOSTAWAY_API_KEY && env.HOSTAWAY_SYNC_ENABLED !== 'false') {
      ctx.waitUntil(import('../lib/hostaway-sync').then(module => module.runHostawaySync('schedule')).catch(() => {
        console.error('Hostaway sync failed; the error is recorded and the next run retries.');
      }));
    }
    if (env.INTEGRATION_SCHEDULE_ENABLED !== 'true') return;
    ctx.waitUntil(import('../lib/integration-server').then(module => module.dispatchNotifications()).catch(() => {
      console.error('Recharge integration batch failed; durable job state retained.');
    }));
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (env.BACKEND_ONLY === "true") {
      const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" };
      if (url.pathname === "/health") {
        const configured = Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY && env.SUPABASE_SECRET_KEY?.startsWith("sb_secret_") && (env.AUTH_RATE_LIMIT_SECRET?.length || 0) >= 32 && env.APP_ORIGIN?.startsWith("https://"));
        return new Response(JSON.stringify({ service: "Recharge backend", configured }), { status: configured ? 200 : 503, headers });
      }
      if (!backendRouteAllowed(url.pathname)) return new Response(JSON.stringify({ error: "This endpoint is not available on the live backend" }), { status: 404, headers });
      // The pages' built scripts, styles and fonts live in the static asset store. The app
      // router only serves public files it knows about, so hand these over directly.
      if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/fonts/")) return env.ASSETS.fetch(request);
      // The workspace is the phone app's own browser build, so web and app are the same screens.
      // /workspace opens its live workspace; any other app page loads the single page.
      if (isWorkspaceApp(url.pathname)) {
        if (url.pathname === "/workspace" || url.pathname === "/workspace/") return Response.redirect(new URL("/workspace/live", url), 302);
        const file = /\.[a-z0-9]+$/i.test(url.pathname);
        const response = await env.ASSETS.fetch(file ? request : new Request(new URL("/workspace/", url), request));
        if (file) return response;
        const page = new Response(response.body, response);
        for (const [name, value] of Object.entries(securityHeaders)) page.headers.set(name, value);
        return page;
      }
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
