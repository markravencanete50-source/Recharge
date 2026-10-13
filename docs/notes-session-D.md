# Session D notes: the interactive demo (13 October 2026)

Branch `claude/interactive-demo-session-d`, from `main` at `b25d02f`. Nothing is deployed, no migration was
needed and none was added. These notes are for whoever merges and updates `DEVELOPER-HANDOVER.md` (this session
was told not to edit it).

Lee's words: "in the demo account we should be able to process anything so we know how the structure and flow
works." Demo mode in the browser app now does exactly that.

## 1. What changed for the person using it

- A super admin switches **Demo** on as before (the header on wide screens, and Profile). The switch and who may
  use it are unchanged.
- The demo is now **interactive**: every screen works, writes included, as the sample business's super admin or,
  through **View as**, as any of its people (one per role: Morag admin, Fiona Stays, Isla cleaning manager, Ewan
  cleaner, Rory Ready, Graham accounts, Alasdair owner). Viewing as someone in the demo signs in as them, so you
  can do their part of a flow and switch to the next person.
- It runs on a **private copy** of the sample business kept in that browser (IndexedDB). It stays there, with
  everything done to it, until **Reset demo** (in the demo banner, with a confirm step). Other viewers and other
  browsers each have their own copy.
- **Run today's automatic jobs** (in the banner) runs the backend's scheduled sweeps on the copy now: pricing
  gaps, routine visits, mid-stay cleans, daily to-dos, the clean-form sweep, direct-booking follow-ups, owner
  approval reminders, sign-off rollover, weekly report notices, privacy clean-up, then the email/phone delivery
  batch.
- Nothing is sent to anyone. Where Live would email, notify a phone or call Hostaway, the banner shows a quiet
  line instead, for example *"In demo, this email would be sent to ann@example.com: “Your free property
  performance estimate from Recharge”."* (screenshot 8).
- The sample business's dates follow today: each time the copy opens, every date in it moves by the days since it
  was last opened, so today's cleans are today's.
- Banner wording: "Try anything: it all works on a private copy of a sample business kept in this browser. Your
  real records aren't shown or changed, and nothing is sent to anyone."

## 2. How it works

The local review backend (`scripts/demo/`, devstack) already ran the repo's own route handlers on the repo's own
database functions in PGlite. The browser demo is the same thing, moved into a Web Worker:

| Part | File | What it does |
|---|---|---|
| Shared database layer | `scripts/demo/db-core.mjs` (split out of `db.mjs`) | The Supabase bootstrap, the sample people, and the PostgREST "act as" helpers (JWT claims, `set local role`, the pre-request hook). `db.mjs` keeps the Node file handling and re-exports it. |
| Shared Supabase stand-in | `scripts/demo/devstack-core.mjs` (split out of `server.mjs`) | The signed-in client, the service client, storage, and the source of the swapped server-only modules (`lib/supabase-server.ts`, `lib/auth-security.ts`, `cloudflare:workers`, `@supabase/supabase-js`, and for the browser `next/server`). `server.mjs` now uses it too, so the two can't drift apart. |
| The backend in the browser | `scripts/demo/browser/engine.mjs` | Opens PGlite from the snapshot (first time) or from IndexedDB, moves the dates, and answers each request with the route handler for its path: **every `app/api/workspace/**/route.ts` is bundled as is**, so the request schemas, `lib/*-server.ts`, `lib/*-live.ts` and the database functions are the real ones. Before a route is called, the path must pass the Worker's own allowlist (`backendRouteAllowed` from `worker/backend-route-policy.ts`). |
| Network guard | `engine.mjs` | Inside the worker, `fetch` only reaches the demo's own static files; outside services get a stand-in answer and a note (`browser/services.mjs`: Resend, Expo push, Hostaway); anything else, `/api/…` above all, is refused. `XMLHttpRequest`, `WebSocket`, `EventSource` and `sendBeacon` are switched off. |
| Dates | `scripts/demo/browser/dates.mjs` | Moves every date and timestamp column, and ISO dates and months written as text or inside JSON, by whole days (triggers off; unique dates moved via a far-away park so they never collide). |
| Automatic jobs | `scripts/demo/browser/jobs.mjs` | The schedule's sweeps in `worker/index.ts`, same order. A test fails if the schedule gains a sweep this list lacks. |
| Photos and files | `engine.mjs` | Supabase Storage is IndexedDB (the viewer's uploads) plus the sample photos as static files, fetched the first time one is opened. Signed links become object URLs; chat one-off upload links are `demo-upload://…` and are kept by the worker. No Cloudinary, no Supabase Storage. |
| Build | `scripts/demo/build-browser-demo.mjs` | Run by `scripts/build-workspace-web.mjs` (so by `npm run build`) into `dist/client/workspace/demo/`. Seeds the sample business (or reuses the devstack's cached seed), compacts it into a snapshot (no template databases, `vacuum full`, only the write-ahead log the last checkpoint needs with its unused tail zeroed: 24 MB → 2.6 MB), bundles the engine with esbuild, and copies PGlite's WebAssembly and data files gzipped. Every file but `manifest.json` has a content hash in its name. |
| The app side | `mobile/src/demo/engine.ts`, `mobile/src/demo/notes.ts`, demo parts of `mobile/src/backend/client.ts`, `mobile/src/DemoMode.tsx` | Starts the worker when Demo is switched on and routes `workspaceRequest` (reads and writes), photos, profile photos, chat file links and chat uploads to it. The banner has Reset demo, Run today's automatic jobs and the notes. |

Safety details:
- `workspaceRequest` answers from the demo before any live call. While Demo is being switched on, and after a
  reload of a tab that was in the demo, the app's requests **wait** for the demo instead of going to Live (they go
  on after 30 seconds only if the demo never starts).
- Browser notification set-up (`/api/workspace/notifications`) is skipped in the demo.
- The worker never sees a live session: the sample people are signed in inside the worker.
- The copy is kept across deploys while the migrations and the seed stay the same (`manifest.snapshot` is the
  devstack's `sourceHash`); when they change, the next open starts a fresh copy.
- Photos a sample person queued in the upload line are tied to that sample person's id (never a real account's),
  so they can never be sent to Live; Reset demo clears them.

Fallback: where the worker can't run (the phone app, or a browser without WebAssembly, workers or IndexedDB, or if
it fails to open in two minutes) the app falls back to the recording (`mobile/web-static/demo-data.json`),
read-only, exactly as before. So the recording is **kept as the fallback**, not retired.

## 3. Size and speed

Extra download, **only when Demo is switched on** (Live requests none of these files; the e2e test checks it):

| File | Download |
|---|---|
| PGlite WebAssembly (`pglite.wasm.<hash>.gz`) | 3.44 MB |
| PGlite data (`pglite.data.<hash>.gz`) | 2.14 MB |
| initdb (`initdb.wasm.<hash>.gz`) | 0.15 MB |
| Sample business snapshot (`database.<hash>.tgz`) | 2.64 MB (first open only) |
| Demo backend (`engine.<hash>.js`, 0.89 MB) | 0.22 MB compressed in transit |
| **First open** | **about 8.2 MB** |
| Sample photos | 13 pictures, about 45 KB each, only when one is opened |

Files are kept in the browser's Cache Storage after the first open, so later opens download nothing but
`manifest.json` and the engine script.

The live app's own bundle grows by the demo client code only (about 3 KB minified for `mobile/src/demo/`, plus the
new branches in `client.ts` and the banner).

Time from clicking Demo to the demo's Home on screen (Chromium, measured with Playwright; includes the switch's
deliberate 0.65 s animation):

| Network | First open | Open again |
|---|---|---|
| Local, unthrottled | 1.9 – 2.4 s | – |
| 50 Mb/s, 20 ms | 3.6 s | 2.0 s |
| 10 Mb/s, 60 ms | 9.1 s | 1.6 s |

Inside the worker the database itself is ready about 1.1 s after the files arrive (`timings` in the open result).
Storage used per viewer: about 8 MB in IndexedDB and 8 MB in Cache Storage.

## 4. Tried in the browser (Playwright, Chromium)

Every step below ran against the in-browser backend with **zero `/api` requests** after Demo was switched on.
Screenshots in `docs/session-D-screenshots/`.

1. **Super admin (Sam):** upheld a contested clean in "Needs a management decision" with a note (the decision is
   recorded; Disputed cleans 2 → 1; screenshot 1). Ran today's automatic jobs. Reset demo (the copy is wiped and
   reopened in place).
2. **Cleaner (Ewan), via View as:** clocked in; opened an overdue redo clean; ticked the 7-item checklist, uploaded
   3 photos (stored in the browser, shown as Saved), answered the 7 property-check questions, wrote the report and
   submitted the clean (screenshots 2, 3).
3. **Cleaning manager (Isla):** saw Ewan's submission under *Waiting for your review*, with the uploaded photos and
   the seeded ones (screenshot 4); ticked "Form checked and guest happy", Accept, guest feedback, review, Save
   review: it left the review list (screenshot 5).
4. **Owner (Alasdair):** approved a £180 repair quote in Approvals (screenshot 6).
5. **Stays (Fiona):** clocked out with the end-of-day reflection (screenshot 7); recorded a reply to a guest in
   Messages ("I replied on the platform").
6. **Super admin, Client enquiries:** sent the enquiry form by email: the flow completes and the banner says the
   email would have been sent (screenshot 8).

Also checked: every read in `scripts/demo/requests.json` (the reads the recording was made from, for all 8 roles,
291 requests) through the in-browser backend: all answer 200, or 403 where the role may not read it, or 404 for
the few work ids taken from an older seed. No errors. The Node devstack (`smoke.mjs`) still answers every read
for every role after the refactor.

## 5. Tests

- `tests/demo-browser.test.mjs` (new, no browser): the jobs list matches the schedule in `worker/index.ts`; dates
  move in columns, text and JSON with unique dates and triggers safe; outside services answered with the right
  note and nothing else answered; the engine refuses other addresses and applies the Worker allowlist; the app
  answers from the demo before any live call.
- `tests/demo-browser-e2e.test.mjs` (new, real Chromium): a stand-in "Live" that records every `/api` request; the
  super admin switches Demo on; asserts **Live loaded none of the demo files**, then records a management
  decision, runs the automatic jobs and views as the cleaner, and asserts **no `/api` request was made while Demo
  was on** and nothing else left the browser. It needs the built app (`npm run build`, or `DEMO_WEB_DIR`) and
  Playwright (installed globally in the dev container; it skips without them).
- `tests/demo-data.test.mjs`: the recording's tests stay (it is the fallback), plus a check that the browser app
  tries the interactive demo first and that only the recorded demo is read-only.
- Results: `node --test tests/demo-data.test.mjs tests/demo-browser.test.mjs tests/demo-browser-e2e.test.mjs`
  all pass (11). `npx tsc --noEmit -p mobile/tsconfig.json` clean. ESLint on every changed file: no errors (one
  existing warning in `seed.mjs`, not touched).

## 6. The phone app

The Expo app has the Demo switch (Profile). It **keeps the recorded, read-only demo**. The interactive demo needs
WebAssembly to run Postgres, and the phone app's JavaScript engine (Hermes) has none, so PGlite cannot run there.
What it would take, best first:
1. Run the same worker inside a hidden `react-native-webview` (WebAssembly and IndexedDB work in the system web
   view) and bridge `workspaceRequest` to it with `postMessage`. Same engine file, no backend work; needs the
   `react-native-webview` dependency and a new app build. About 2–3 days with testing on both platforms.
2. A sandboxed demo backend per viewer on the server: more infrastructure, and it would mean the demo talks to a
   server, which this design avoids.

## 7. Hooks for the Lead to apply at merge (files this session doesn't own)

`mobile/src/LiveWorkspace.tsx` (Session B):
1. Pins and favorites can be saved in the interactive demo (they go to the demo's copy). Line 347:
   `useFavoritesStore(team && !(viewAs && !viewAs.person), demo ? DEMO_SAVE_MESSAGE : …` →
   `useFavoritesStore(team && !(viewAs && !viewAs.person), demo && !demoInteractive() ? DEMO_SAVE_MESSAGE : …`
   (import `demoInteractive` from `./backend/client`).
2. Left panel wording, line 446: `detail: "A sample business. Nothing you do here is saved."` →
   `detail: demoInteractive() ? "A sample business in this browser. Try anything." : "A sample business. Nothing you do here is saved."`
3. Reload the screens straight after Reset demo and the automatic jobs (today they reload on the next quiet
   refresh: the banner fires the app's "back in view" event, which refreshes if the last refresh was over 20
   seconds ago). In `Workspace`, after `const refreshAll = …` (line 323):
   `const refreshAllRef = useRef(refreshAll); refreshAllRef.current = refreshAll;`
   `useEffect(() => onDemoChanged(() => refreshAllRef.current()), []);`
   (import `onDemoChanged` from `./demo/notes`).

`mobile/src/ViewAs.tsx`, line 51: "… messages. Nothing is saved." → in the interactive demo "… messages. What you
do as them stays in this browser's demo."

`worker/backend-route-policy.ts` (optional): let browsers keep the demo's hashed `.gz` and `.tgz` files for good
too: add `gz|tgz` to the extensions in `hashedWorkspaceFile`. Not required (the demo keeps them in Cache Storage).

`DEVELOPER-HANDOVER.md`, "Demo mode" section: replace with section 1–2 above.

## 8. Open points

- **Inviting a new person** in the demo answers "Invites are not sent on the devstack" (the stand-in has no auth
  admin). Making it work would mean creating the sample account in the worker; not done.
- **The landlord's enquiry form link** made in the demo points at the real `/enquiry` page, where the token is
  unknown ("invalid link"). Onboarding an enquiry works from the two sample enquiries already answered ("New:
  ready to value") and by adding one by hand. A demo copy of the landlord's form would be a follow-up.
- **Hostaway:** "Sync now" answers with a demo note and changes nothing. The sample business has no Hostaway-linked
  guest conversation, so "send through Hostaway" is covered by the unit test, not a screen.
- **Postcode lookups** for the map still go to postcodes.io in the demo (as in Live; only postcodes are sent).
- **Rate limits** are off in the demo (as on the devstack).
- **Time of day** isn't moved, only the date: a shift seeded at 08:52 shows "since 08:52".
- Headless Chromium reported times in UTC in the screenshots; real browsers use the viewer's clock.
