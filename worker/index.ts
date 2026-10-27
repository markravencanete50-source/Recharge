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
  // Replies written in the Guest inbox reach the guest through Hostaway only when this is 'true' (read by lib/guest-reply-server.ts).
  HOSTAWAY_REPLIES_ENABLED?: string;
  // Email through Resend (Worker secrets): the key, the webhook signing secret, the switch for replies, and an escape for mail without an authentication header.
  RESEND_API_KEY?: string;
  RESEND_WEBHOOK_SECRET?: string;
  EMAIL_REPLIES_ENABLED?: string;
  EMAIL_ALLOW_UNVERIFIED?: string;
  // The key the company website's server sends with each guest message (lib/website-guest-messages-server.ts); at least 32 characters.
  WEBSITE_MESSAGES_KEY?: string;
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

// The minute past each hour on which the guest reviews run (see below).
const REVIEWS_MINUTE = 5;

// The scheduled jobs, each started through ctx.waitUntil; scheduled() below waits for every one of them to settle.
function startScheduledJobs(controller: { cron?: string; scheduledTime?: number }, env: Env, ctx: ExecutionContext): void {
  if (env.BACKEND_ONLY !== 'true') return;
  // The Worker has one trigger, every minute (scripts/build-backend-config.mjs). A "*/15 * * * *" trigger left in the
  // Cloudflare dashboard does nothing at all: the minute ticks at :00, :15, :30 and :45 already do its work.
  if (controller.cron === '*/15 * * * *') return;
  // The minute this tick was scheduled for, so a tick that starts a few seconds late still counts as its own minute.
  const tick = new Date(controller.scheduledTime ?? Date.now());
  // Every minute: notices go out to the browsers and phones that allowed notifications.
  ctx.waitUntil(import('../lib/web-push-server').then(module => module.runWebPush()).catch(() => {
    console.error('Web push batch failed; the next run retries.');
  }));
  // Every minute too: replies to owners who wrote by email are sent through Resend (nothing happens unless EMAIL_REPLIES_ENABLED is true).
  if (env.RESEND_API_KEY && env.EMAIL_REPLIES_ENABLED === 'true') {
    ctx.waitUntil(import('../lib/email-inbound-server').then(module => module.runEmailOutbox()).catch(() => {
      console.error('Owner email replies failed; the next run retries.');
    }));
  }
  // Every minute too: guests' messages from Hostaway (one request, plus the conversations that changed),
  // so the reply-time clock starts within about a minute. Off unless switched on, like the sync below.
  const hostawayOn = Boolean(env.HOSTAWAY_ACCOUNT_ID && env.HOSTAWAY_API_KEY && env.HOSTAWAY_SYNC_ENABLED === 'true');
  // Hourly, on its own tick at :05, where nothing else heavy runs: guest reviews for each property's ratings
  // (20261022500000). Not on the :00 tick, whose sync can take most of a minute, and only once that tick's messages are
  // in, so the two never ask Hostaway at once. A failure is recorded on its own; the next hour retries.
  const reviewsTick = tick.getUTCMinutes() === REVIEWS_MINUTE;
  if (hostawayOn) {
    ctx.waitUntil(import('../lib/hostaway-sync').then(async module => {
      await module.runHostawayMessages('schedule').catch(() => {
        console.error('Hostaway messages failed; the next run retries.');
      });
      if (reviewsTick) await module.runHostawayReviews('schedule').catch(() => {
        console.error('Hostaway reviews failed; the error is recorded and the next hour retries.');
      });
    }).catch(() => {
      console.error('Hostaway messages failed; the next run retries.');
    }));
  }
  // The rest runs every 15 minutes: on the minute ticks at :00, :15, :30 and :45. Each job only runs once configured.
  if (tick.getUTCMinutes() % 15 !== 0) return;
  // Off unless switched on: Recharge starts as a new business and Hostaway is being replaced.
  if (hostawayOn) {
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
  // Stays of more than 14 nights get a mid-stay clean, and lose an unstarted one when the stay no longer needs it.
  // Every stay, wherever it came from, so this runs whether or not the Hostaway sync is on (the sync also runs it).
  ctx.waitUntil(import('../lib/auth-security').then(module => module.securityRpc('workspace_mid_stay_cleans', {})).catch(() => {
    console.error('Mid-stay cleans failed; the next run retries.');
  }));
  // Only the :00, :15, :30 and :45 ticks get this far, so these sweeps are paced by the clock: hourly is the :00 tick.
  // All are idempotent (a second run finds nothing to do) and bounded per run, so a late or doubled tick is harmless.
  const hourly = tick.getUTCMinutes() < 15, everySixHours = hourly && tick.getUTCHours() % 6 === 0;
  // Hourly, which includes the first tick after midnight London: today's daily and department to-dos are added for each team.
  if (hourly) {
    ctx.waitUntil(import('../lib/auth-security').then(module => module.securityRpc('workspace_ensure_daily_todos', {})).catch(() => {
      console.error('Daily to-dos failed; the next run retries.');
    }));
    // Hourly: a clean whose day has passed with no form gets a warning and a management flag (at most 200 a run).
    ctx.waitUntil(import('../lib/auth-security').then(module => module.securityRpc('workspace_clean_form_sweep', {})).catch(() => {
      console.error('Clean form check failed; the next run retries.');
    }));
    // Hourly, so the first tick after midnight London closes the week or month: each cleaner's accepted cleans become
    // one invoice for the period that ended. Idempotent (one invoice per cleaner and period), and a missed hour catches up.
    ctx.waitUntil(import('../lib/auth-security').then(module => module.securityRpc('workspace_cleaner_invoice_run', {})).catch(() => {
      console.error('Cleaner invoices failed; the next run retries.');
    }));
    // Hourly, so the first tick after midnight London on the 1st makes each VA's Request for Invoice for the month just
    // ended. Idempotent (one request per VA per month, a unique key), and a missed day catches up until the 7th.
    ctx.waitUntil(import('../lib/auth-security').then(module => module.securityRpc('workspace_va_pay_run', {})).catch(() => {
      console.error('VA requests for invoice failed; the next run retries.');
    }));
  }
  // Every six hours: a long stay booked through a booking site gets its direct-booking follow-up (at most 50 a run).
  // A scheduled sweep rather than a trigger, so it can never hold up the Hostaway sync.
  if (everySixHours) {
    ctx.waitUntil(import('../lib/auth-security').then(module => module.securityRpc('workspace_direct_booking_sweep', {})).catch(() => {
      console.error('Direct-booking follow-ups failed; the next run retries.');
    }));
  }
  // Each morning from 07:00 London: one "your cleans today" notice per cleaner with a clean that day. It runs every
  // 15 minutes so a missed 07:00 tick catches up; the database sends each notice once and never from 11:00.
  ctx.waitUntil(import('../lib/auth-security').then(module => module.securityRpc('workspace_clean_morning_notices', {})).catch(() => {
    console.error('Clean morning notices failed; the next run retries.');
  }));
  // Why guests stay (20261021800000), both OFF until an admin switches them on in Reports > Guests & stays. From 10:00
  // London (catching up until 12:59): the question to each guest 3 days before check-in, through the Guest inbox's own
  // Hostaway send, and the survey email the day after a direct stay, from the guest mailbox. The database takes each stay
  // once, so a late or doubled tick never sends twice. Nothing goes unless Hostaway replies or guest email are switched on.
  ctx.waitUntil(import('../lib/stay-reason-server').then(module => module.runStayReasonQuestions()).catch(() => {
    console.error('Stay reason questions failed; the next run retries.');
  }));
  ctx.waitUntil(import('../lib/stay-reason-server').then(module => module.runStaySurveys()).catch(() => {
    console.error('Stay surveys failed; the next run retries.');
  }));
  // Agreement follow-ups (20261027200000): until the owner signs, the automatic messages and the personal follow-up notices,
  // stopped by a reply and archived after the last step. The steps are an admin setting; at most 50 a run, each step once.
  ctx.waitUntil(import('../lib/auth-security').then(module => module.securityRpc('workspace_agreement_followup_sweep', {})).catch(() => {
    console.error('Agreement follow-ups failed; the next run retries.');
  }));
  // Onboarding fee reminders (20261027300000): a sent fee not yet settled reminds the owner in the app and by email every 48
  // hours (an admin setting). At most 50 a run, each fee once per interval.
  ctx.waitUntil(import('../lib/auth-security').then(module => module.securityRpc('workspace_onboarding_fee_sweep', {})).catch(() => {
    console.error('Onboarding fee reminders failed; the next run retries.');
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
}

const worker = {
  async scheduled(controller: { cron?: string; scheduledTime?: number }, env: Env, ctx: ExecutionContext): Promise<void> {
    // Every job is handed to ctx.waitUntil (so a failure is recorded as the tick's status) and also awaited here, so the
    // invocation lasts until they have all settled. Cloudflare waits for scheduled()'s own promise up to the Cron Trigger
    // wall time of 15 minutes, while work left only to waitUntil after the handler has returned can be cut off after 30
    // seconds (developers.cloudflare.com/workers/runtime-apis/context/#waituntil). Each job catches its own error.
    const jobs: Promise<unknown>[] = [];
    startScheduledJobs(controller, env, {
      waitUntil(job) { jobs.push(job); ctx.waitUntil(job); },
      passThroughOnException() { ctx.passThroughOnException(); },
    });
    await Promise.allSettled(jobs);
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
        // Only the path and query move across: a path such as "//other.site/x" must not become another host.
        const target = new URL(env.APP_ORIGIN); target.pathname = url.pathname.replace(/^[/\\]+/, "/"); target.search = url.search;
        return Response.redirect(target.toString(), 308);
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
