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

## Runtime requirements

- **Supabase project** `brixfalrrmzqoioggvfx`. Apply `supabase/migrations/` in order and never
  rewrite applied history.
- **Backend Worker secrets:** see `README.md`, under Configuration.
- **Hostaway:** `HOSTAWAY_ACCOUNT_ID` and `HOSTAWAY_API_KEY`, set as Worker secrets when the sync
  is switched on. `lib/hostaway.ts` is the API client.

Secrets and live records are never stored in this repository.
