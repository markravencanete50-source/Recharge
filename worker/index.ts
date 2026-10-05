/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { backendRouteAllowed } from "./backend-route-policy";

interface Env {
  BACKEND_ONLY?: string;
  INTEGRATION_SCHEDULE_ENABLED?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  AUTH_RATE_LIMIT_SECRET?: string;
  APP_ORIGIN?: string;
  ASSETS: Fetcher;
  DB: D1Database;
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
    // Scheduling and provider flags are separately enabled after client configuration.
    // The deployment config intentionally installs no cron trigger yet.
    if (env.BACKEND_ONLY !== 'true' || env.INTEGRATION_SCHEDULE_ENABLED !== 'true') return;
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
