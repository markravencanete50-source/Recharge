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

## Runtime requirements

- **Supabase project** `brixfalrrmzqoioggvfx`. Apply `supabase/migrations/` in order and never
  rewrite applied history.
- **Backend Worker secrets:** see `README.md`, under Configuration.
- **Hostaway:** `HOSTAWAY_ACCOUNT_ID` and `HOSTAWAY_API_KEY`, set as Worker secrets when the sync
  is switched on. `lib/hostaway.ts` is the API client.

Secrets and live records are never stored in this repository.
