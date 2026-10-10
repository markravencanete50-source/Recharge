/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { backendRouteAllowed, hashedWorkspaceFile, isWorkspaceApp } from "./backend-route-policy";
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
  async scheduled(controller: { cron?: string }, env: Env, ctx: ExecutionContext): Promise<void> {
    if (env.BACKEND_ONLY !== 'true') return;
    // Every minute: notices go out to the browsers and phones that allowed notifications.
    ctx.waitUntil(import('../lib/web-push-server').then(module => module.runWebPush()).catch(() => {
      console.error('Web push batch failed; the next run retries.');
    }));
    // The rest runs every 15 minutes (scripts/build-backend-config.mjs). Each job only runs once configured.
    if (controller.cron && controller.cron !== '*/15 * * * *') return;
    // Off unless switched on: Recharge starts as a new business and Hostaway is being replaced.
    if (env.HOSTAWAY_ACCOUNT_ID && env.HOSTAWAY_API_KEY && env.HOSTAWAY_SYNC_ENABLED === 'true') {
      ctx.waitUntil(import('../lib/hostaway-sync').then(module => module.runHostawaySync('schedule')).catch(() => {
        console.error('Hostaway sync failed; the error is recorded and the next run retries.');
      }));
    }
    // Empty nights in the coming week become "price the empty nights" tickets for Stays.
    ctx.waitUntil(import('../lib/auth-security').then(module => module.securityRpc('workspace_open_pricing_gaps', {})).catch(() => {
      console.error('Pricing gap check failed; the next run retries.');
    }));
    // Routine visits for this month and next, and a reminder three days before each is due.
    ctx.waitUntil(import('../lib/auth-security').then(module => module.securityRpc('workspace_routine_auto', {})).catch(() => {
      console.error('Routine visit schedule failed; the next run retries.');
    }));
    // Owners are reminded once an approval has waited 48 hours; client relations are told at 96.
    ctx.waitUntil(import('../lib/auth-security').then(module => module.securityRpc('workspace_chase_owner_approvals', {})).catch(() => {
      console.error('Owner approval reminders failed; the next run retries.');
    }));
    // Each morning after 08:00: yesterday's missed Stays sign-offs and listing checks roll over to management (once a day).
    ctx.waitUntil(import('../lib/auth-security').then(module => module.securityRpc('workspace_roll_over_signoffs', {})).catch(() => {
      console.error('Sign-off rollover failed; the next run retries.');
    }));
    // Monday mornings: owners are told in the app that their weekly report is ready (once a week).
    ctx.waitUntil(import('../lib/auth-security').then(module => module.securityRpc('workspace_weekly_report_notices', {})).catch(() => {
      console.error('Weekly report notices failed; the next run retries.');
    }));
    // Once a day: read notifications after 12 months, sign-in security records after 90 days,
    // expired recovery proofs and anything left on deleted accounts (see the privacy policy).
    ctx.waitUntil(import('../lib/auth-security').then(module => module.securityRpc('workspace_privacy_retention', {})).catch(() => {
      console.error('Privacy retention failed; the next run retries.');
    }));
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
      // Pages opened on the old workers.dev address move to the app's own domain, where sign-in works
      // (its cookies and origin checks belong to APP_ORIGIN). API calls such as the Hostaway webhook
      // are left alone, so integrations pointed at the old address keep working.
      if (env.APP_ORIGIN?.startsWith("https://") && url.hostname.endsWith(".workers.dev") && url.origin !== new URL(env.APP_ORIGIN).origin
        && (request.method === "GET" || request.method === "HEAD") && !url.pathname.startsWith("/api/")) {
        return Response.redirect(new URL(url.pathname + url.search, env.APP_ORIGIN).toString(), 308);
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
        // Scripts, fonts and images carry a content hash in their names, so a phone keeps them
        // and the app opens without downloading them again; a new build gets new names.
        if (file && response.ok && hashedWorkspaceFile(url.pathname)) {
          const cached = new Response(response.body, response);
          cached.headers.set("Cache-Control", "public, max-age=31536000, immutable");
          return cached;
        }
        // Any page (the app shell or another HTML file) carries the same protections as /workspace/live.
        if (file && !/\.html?$/i.test(url.pathname)) return response;
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
