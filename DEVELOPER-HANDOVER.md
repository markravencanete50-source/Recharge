# Recharge developer handover

Start with `README.md`. It describes the parts of the platform and the commands.

## The old portal has been retired (7 October 2026)

The original portal ran on a separate Cloudflare D1 database and R2 file storage. It held no real
records and was never served by the deployed backend, so it has been removed:
- `/` now sends people to the live workspace (`/workspace`);
- the preview's `/legacy-preview` address redirects to the preview home;
- its screens, its APIs, the D1 schema and Drizzle migrations, and the D1 and R2 bindings are gone.

`docs/LEGACY-PORT-PLAN.md` records what each old centre did, and where that work now lives or is
planned.

## The app on phones (8 October 2026)

- **Home tools.** `lib/home-tools.ts` lists the tools each role sees first on Home. Each tool opens
  a Work view, a tab inside it (`sub`), or a section further down (`anchor`). Sections are found by
  their heading (`sectionAnchor("Daily checks")` is `section-daily-checks`), so renaming a
  `<Section title>` breaks a Home tool. `tests/home-tools.test.mjs` catches that.
- **Icons.** The illustrated icons are drawn in `mobile/src/DimensionalIcon.tsx`. `MODULE_ART`
  gives every tool its icon in the full tools list.
- **Speed.** The live build (`RECHARGE_LIVE_ONLY=1`, set by `scripts/build-workspace-web.mjs`)
  leaves out the sample-data preview (`mobile/App.tsx`). It uses resized logos
  (`mobile/assets/brand`) and Montserrat cut down to Latin characters (`mobile/assets/fonts`).
  The Worker tells browsers to keep content-hashed app files for a year
  (`hashedWorkspaceFile`). The welcome intro plays once a day per device, and it can be skipped.
- **Feedback.** Sheets wrap their "done" handler in `useSaved()` (`mobile/src/Celebrate.tsx`),
  so every successful save shows a short confirmation.

## Follow-ups without outside services (8 October 2026)

- **Home shortcuts** (`homeActionsFor` in `lib/home-tools.ts`) open a form straight away. The Work
  screen reads `focus.open` when it mounts (`useWorkFocus`).
- **Automatic refresh.** `LiveWorkspace` refreshes quietly every minute while open and when the
  app comes back to the front. It pauses while a form or sheet is open.
- **Update wording.** `lib/notice-copy.ts` titles every update in the app, and gives the subject and
  message for email and push. `integration_claim_notifications` now passes `eventType`.
- **Weekly report notice.** `workspace_weekly_report_notices()` runs on the backend schedule. It
  sends owners an in-app notice on Mondays from 8am UK time, once per property per week.
- **Repair quotes.** The `reviseQuote` step updates the quote. A higher quote above the owner's
  limit sends the repair back to `owner_approval` with a `resumePhase`. `approveBudget` returns it
  to that phase.
- **Garden routine.** An owner's "has a garden" answer also creates a monthly "Garden and bins"
  routine plan.
- **Agreement copy.** `lib/agreement-copy.ts` builds a page with the signed agreement.
- **Map.** `lib/scotland-map.ts` has a hand-traced outline and area centres. Circles are placed
  so they never overlap.
- **Native scrolling.** `Anchor` (`LiveKit`) registers sections so the phone app can scroll to them.

## Access control for super admins (8 October 2026)

- **Where:** Work → Management → Access control (`mobile/src/LiveAccessControl.tsx`). It's also on
  a super admin's Home.
- **Backend:** it uses the admin endpoints (sections `accessControl` and `accessHistory`; actions
  `setAccess`, `block`, `unblock`, `signOut`, `revokePassword` and `deleteAccount`). The database
  functions are `workspace_access_control_*`, and only super admins can call them. Nobody can act on
  their own account.
- **Revoke password:** adds a row to `private.workspace_password_revocations`, which
  `auth_server_finish_password` checks before approving a sign-in. Email or phone recovery clears it.
- **Block:** sets the status to `revoked`, ends sessions and sets `auth.users.banned_until`.
- **Delete:** removes the auth user when nothing refers to it. Otherwise the account is closed:
  "Deleted account", no access, banned, password revoked.
- **History:** every change is logged in `workspace_access_events`.
- **Changing a role:** the sheet lists every role with what it gives (`ROLE_SUMMARY`), and previews
  what the person will see (`roleChange`: Work views, Home tools, properties). The tools reset to the
  new role's usual set. `workspace_move_assignments` (migration `20261008290000`) moves property
  assignments to the new role's kind, because property access matches the assignment kind to the
  role. An owner becoming a team member, or the reverse, is unassigned. A `role_changed` event
  records the old and new role. The person's app reads the account returned with every refresh and
  switches to the new role without signing in again.
- **Applying it live:** migration `20261008280000_access_control.sql` removes sign-in sessions, so the
  database tool asks for confirmation. Run `docs/APPLY-ACCESS-CONTROL.sql` in the Supabase SQL editor
  if it isn't applied yet.

## Built without outside services (9 October 2026)

- **Photos** use a private Supabase Storage bucket (`workspace-media`) that only the backend reads
  or writes (`uploadStoragePhoto`/`downloadStoragePhoto` in `lib/integration-providers.ts`).
  Cloudinary is used instead only when `MEDIA_UPLOADS_ENABLED=true` and its keys are set; set
  `MEDIA_STORAGE=off` to switch photos off. Photo kinds now include `inspection` and `setup` on the
  onboarding journey, and post photos (`mailPhotoIds`) on a clean. `mobile/src/Photos.tsx` has the
  picker and viewer; workflow forms take a `photos` field.
- **Web push** (`lib/web-push.ts`): VAPID-signed, aes128gcm-encrypted, sent from the Worker every
  minute (second cron). Keys: `npm run push:setup` stores `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` as
  Worker secrets without printing them. People switch it on in Profile & preferences. The browser
  build adds `mobile/web-static` (service worker, manifest, icons) so the app can be installed.
- **Messages** (`mobile/src/LiveChat.tsx`, `lib/workspace-chat-*.ts`, migration `20261009110000`):
  direct, group and owner conversations; the open conversation polls every 3 seconds. Owner
  messages are timed for client relations (`workspace_client_relations_read`).
- **Weekly report page** (`weeklyReportDocument` in `lib/weekly-report.ts`) and **local events**
  added by hand (`recordLocalEvent`).
- **Listings** per property with links and IDs (`saveListingLinks`, migration `20261009120000`).
- **Applying it live:** run `docs/APPLY-2026-10-09.sql` in the Supabase SQL editor (it avoids
  `select … into`, which the editor misreads).

## Runtime requirements

- **Supabase project** `brixfalrrmzqoioggvfx`. Apply `supabase/migrations/` in order and never
  rewrite applied history.
- **Backend Worker secrets:** see `README.md`, under Configuration.
- **Hostaway:** `HOSTAWAY_ACCOUNT_ID` and `HOSTAWAY_API_KEY`, set as Worker secrets when the sync
  is switched on. `lib/hostaway.ts` is the API client.

Secrets and live records are never stored in this repository.
