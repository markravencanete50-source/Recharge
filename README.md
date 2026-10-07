# Recharge

Recharge's property management platform: a Supabase database, a backend served from a Cloudflare
Worker, a phone app (Expo), and the public site at rechargegroup.co.uk.

## How it fits together

| Part | Where | What it does |
| --- | --- | --- |
| Database | `supabase/migrations/` | Every record and every permission check. Each action runs as a checked database function. |
| Backend | `app/api/{mobile,workspace,session,access}/`, `worker/` | Signs people in, checks request shape and quotas, and calls the database. Deployed as the `recharge-backend` Worker. `worker/backend-route-policy.ts` lists every allowed path. |
| Phone app | `mobile/` | One app for every role. Live mode (`/live`) uses the backend; preview mode uses sample data. |
| Web workspace | `app/workspace/` | The signed-in web view. `/` sends people here. |
| Public site | `landing/` | The coming-soon page on Vercel. |
| Preview | `preview/`, `scripts/build-preview.mjs` | A read-only build of the phone app's sample mode for design review. |

Shared rules and response shapes live in `lib/`. The `*-live.ts` files in `lib/` are shared by the
phone screens and the contract tests in `tests/live-*-contract.test.mjs`. Those tests run every
request the screens send through the real schemas and database functions.

## Commands

- `npm ci` and `npm ci --prefix mobile`: install.
- `npm test`: build everything and run the full test suite, including the database tests, which
  apply all migrations to an in-memory Postgres.
- `npm run build && npm run backend:deploy`: build and deploy the backend Worker. Run
  `wrangler login` first.
- `cd mobile && npx expo start`: run the phone app.
- `npm run preview:build`: build the read-only preview.

## Configuration

The backend needs these Worker secrets: `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
`AUTH_RATE_LIMIT_SECRET`, `APP_ORIGIN`. It also needs these, as each feature is switched on:
- photo uploads: the Cloudinary keys and `MEDIA_UPLOADS_ENABLED=true`;
- Hostaway: `HOSTAWAY_ACCOUNT_ID` and `HOSTAWAY_API_KEY`;
- email: Resend;
- notifications: Expo push.

Set them with `wrangler secret put`. Never commit them.

## Further reading

- `docs/BACKEND-FINANCE-AND-TEAMS-2026-10-07.md`: the live screens, what each role sees, and
  what each one still needs.
- `docs/LEGACY-PORT-PLAN.md`: the plan for the remaining work.
