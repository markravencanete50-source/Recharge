# Local review backend with a sample business

A local stand-in for the live backend, for reviewing screens and recording Demo mode. It runs the
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

## Recording Demo mode

With the server running: `DEMO_BACKEND=http://localhost:4318 node scripts/build-demo-data.mjs`
replays the reads in `requests.json` (one list per role) and writes `mobile/web-static/demo-data.json`.

## The interactive demo (in the browser)

Demo mode in the browser app runs this same backend inside the viewer's browser, so every flow can be
tried on a private copy of the sample business (Lee: "in the demo account we should be able to process
anything"). Nothing reaches the live API or database; see `docs/notes-session-D.md` for the details.

- `browser/engine.mjs` is the backend, run in a Web Worker: PGlite (WebAssembly Postgres) opened from a
  prebuilt snapshot, the repo's own `/api/workspace/**` route handlers (same request schemas, same
  database functions), the Worker's route allowlist, and `devstack-core.mjs` in place of Supabase.
  `browser/dates.mjs` moves the copy's dates to today when it opens; `browser/jobs.mjs` is "Run today's
  automatic jobs"; `browser/services.mjs` answers Hostaway, email and phone notifications inside the
  browser and says what would have been sent.
- `db-core.mjs` and `devstack-core.mjs` are shared with `server.mjs` (the Node review server), so the
  two can't drift apart.
- `build-browser-demo.mjs --out <dir>` builds the files: the engine bundle (esbuild), PGlite's
  WebAssembly and data files, the database snapshot (the cached seed, compacted: no template databases,
  vacuumed, only the write-ahead log the last checkpoint needs) and the sample photos. `npm run build`
  runs it into `dist/client/workspace/demo` (from `scripts/build-workspace-web.mjs`).
- To try it locally: build the app as above into `dist-review`, then
  `node scripts/demo/build-browser-demo.mjs --out dist-review/demo` and start `server.mjs`. Sign in as
  the super admin and switch Demo on.
- The app side is `mobile/src/demo/` (starting the worker, the notes) and the demo parts of
  `mobile/src/backend/client.ts`. Where the worker can't run (the phone app, or a browser without
  WebAssembly) the app falls back to the recording below, read-only.
