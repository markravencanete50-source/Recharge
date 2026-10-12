# Live testing setup (2026-10-06)

The redesigned app at https://recharge-preview-28v.pages.dev runs on sample data and blocks
every save. Real testing happens on the Supabase-backed workspace served by the
`recharge-backend` Worker:

- Sign in: https://recharge-backend.markravencanete50.workers.dev/sign-in
- Live workspace (after sign-in): https://recharge-backend.markravencanete50.workers.dev/workspace
- The app's Profile panel links to it as "Live workspace".

## Current state (checked 2026-10-06)

| Area | State |
|---|---|
| Supabase project `Recharge` (brixfalrrmzqoioggvfx) | Healthy, 13 of 14 migrations recorded |
| `integration_foundation`, `backend_internal_controls` | Applied today, recorded under their repo versions |
| `verified_phone_sessions` | **Not applied** (step 1 below). Only phone-number sign-in needs it |
| Auth users / workspace profiles | 0 / 0 (step 2) |
| Business data | Empty (step 4 seeds labelled test data) |
| Worker `recharge-backend` | Deployed. Secrets are dashboard-managed and cannot be read from here |
| Cloudinary, Resend, Expo push, Hostaway | Off until their keys are added (later) |

## 1. Finish the last migration (Supabase SQL editor, about 1 minute)

The Supabase connector used for the other migrations holds any SQL that contains `delete`
statements for a confirmation it cannot show, so this one must be run by hand.

1. Open Supabase → project **Recharge** → **SQL Editor** → **New query**.
2. Paste the whole of `supabase/migrations/20261006022727_verified_phone_sessions.sql` and run it.
3. Record it so future migration tooling stays in sync:

```sql
insert into supabase_migrations.schema_migrations(version, name)
values ('20261006022727', 'verified_phone_sessions');
```

## 2. Create the owner account (no email delivery needed)

1. Supabase → **Authentication** → **Users** → **Add user** → **Create new user**.
2. Email `enquiries@rechargestays.co.uk`, a strong password, tick **Auto Confirm User**.
   A workspace profile is created automatically by the `recharge_auth_user_created` trigger.
3. SQL Editor: run `supabase/provision-owner.sql` to make that account the active super admin.
4. Sign in at https://recharge-backend.markravencanete50.workers.dev/sign-in.

Five wrong passwords lock that address for 24 hours by design. Earlier failed attempts against
the not-yet-existing account are already recorded; if sign-in reports a lock, wait it out or
use password recovery once email delivery (step 5) is set up.

## 3. Extra test users for each role (optional)

Create more users the same way (for example `test-cleaner@…`, `test-client@…`), then give them a
role, department and property assignments from the live workspace's access management as the
super admin. Use addresses you control.

## 4. Seed labelled test data

After step 2, run `supabase/seed-test-data.sql` in the SQL Editor. It adds three `[TEST]`
properties, six work items across maintenance, cleaning, listing health, replenishment,
onboarding and safety, a message thread and an invoice, all owned by the super admin.
`supabase/remove-test-data.sql` deletes all of it again.

## 5. Settings to confirm in the Supabase dashboard

- **Authentication → URL Configuration**: Site URL
  `https://recharge-backend.markravencanete50.workers.dev/sign-in`; exactly one redirect URL,
  `https://recharge-backend.markravencanete50.workers.dev/auth/recovery`.
- **Authentication → Emails → SMTP**: add a production SMTP sender. The built-in sender only
  delivers to project team members, so registration emails, confirmation codes and password
  recovery to anyone else need this. The confirmation template must include `{{ .Token }}`.
- **Authentication → Sign In / Providers → Phone**: set up an SMS provider (for example Twilio)
  only when phone registration or recovery is needed.
- **Data API**: expose only `public` and `graphql_public`; keep `private` hidden and turn off
  automatic exposure of new tables.

## 6. Later: provider keys (each stays off until set)

Add as encrypted Worker secrets on `recharge-backend`, then switch on the matching flag:

| Feature | Secrets | Flag |
|---|---|---|
| Photo uploads | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | `MEDIA_UPLOADS_ENABLED=true` |
| Email notifications | `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL` | `NOTIFICATION_EMAIL_ENABLED=true` |
| Push notifications | `EXPO_ACCESS_TOKEN` | `NOTIFICATION_PUSH_ENABLED=true` |
| Hostaway import | `HOSTAWAY_ACCOUNT_ID`, `HOSTAWAY_API_KEY` | `HOSTAWAY_IMPORT_ENABLED=true` |
| Self-registration | — | `MOBILE_REGISTRATION_ENABLED`, `MOBILE_PHONE_REGISTRATION_ENABLED` |

## Why the redesigned app is not yet on live data

The native API (`/api/mobile/*`) deliberately refuses browser requests (no cookies, no
cross-site requests, no CORS), and the browser workspace uses HTTP-only cookies on the backend's
own origin. Bringing the redesigned screens onto live data means serving them from that origin
with the cookie transport, centre by centre, as part of the planned legacy-to-app port.

The phone app is different: it already reads live data. Builds from the `production` and `pilot`
EAS profiles in `mobile/eas.json` set `RECHARGE_LIVE_ONLY=1` and `EXPO_PUBLIC_WORKSPACE_API_ORIGIN`
to `https://app.rechargegroup.co.uk`, so the sample-data preview is left out and the app signs in
to the live workspace. The `preview-ios` profile is still a sample-data simulator build.
