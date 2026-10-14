# Local review backend with a sample business

A local stand-in for the live backend, for developers to review screens. It runs the
repo's own `/api/workspace/**` route handlers (through Vite) on the repo's own database functions
(PGlite with every migration in `supabase/migrations/`), with a fictional Scottish short-let business
seeded through the real database actions, as the right person each time. Nothing here talks to the
live Supabase project, email or the channel manager.

Only these are replaced, at module-resolution time: `lib/supabase-server.ts`, `lib/auth-security.ts`
(no rate limits), `cloudflare:workers` and the service client from `@supabase/supabase-js` (storage is
kept on disk in `scripts/demo/storage/`).

## Start

Build the app for the web once (any time the app changes):

    cd mobile && RECHARGE_WEB_BASE_URL=/workspace EXPO_PUBLIC_WORKSPACE_WEB=same-origin RECHARGE_LIVE_ONLY=1 \
      npx expo export --platform web --output-dir ../dist-review && cd ..

Then, from the repo root:

    node scripts/demo/server.mjs --static dist-review [--port 4318] [--reseed]

- `http://localhost:4318/workspace` opens the app. Sign in as a role at
  `/dev/as/<super_admin|admin|stays|cleaning_manager|cleans|ready|accounts|client>` (`/dev/as/cleans/2`
  is the second cleaner); `/dev/users` lists everyone.
- The seed is cached (`seed.tar.gz`) and rebuilt by itself when a migration, `db.mjs` or `seed.mjs`
  changes; `--reseed` rebuilds it now.
- `node scripts/demo/smoke.mjs` checks that every read the app makes on load answers for every role.

## The enquiry form

`/enquiry?t=<token>` shows the landlord's form (Client Enquiries) after
`node scripts/demo/build-enquiry-harness.mjs`, which builds `app/enquiry`'s form for the browser.
Make a link from Client enquiries → Send the form → Make the link.
