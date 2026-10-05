# Activate the connected property workspace

## Backend deployment

Build the server, generate the backend config with `node scripts/build-backend-config.mjs`, and deploy with `npm run backend:deploy`. The production Worker must keep the existing encrypted Supabase keys, canonical `APP_ORIGIN` and durable authentication limiter secret. The generated config contains no production credentials or legacy D1/R2 bindings. Deploy only `dist/server/wrangler.backend.json` for this backend.

The public Pages product preview stays read-only. Its sample data must never be imported into the live database. The approved repository connection now deploys both Pages and the separate backend Worker from `codex/cloudflare-preview`.

### Historical deployment status, 5 October 2026 (resolved below)

The Home layout/navigation update (`cc653c5`) is published on Pages. Backend branding allowlist update `06f17b5` is built and tested locally, but neither that update nor the prepared property workflow handlers have been redeployed to the backend Worker. The existing CLI login cannot refresh because its connection to Cloudflare's authentication server fails. Stored credentials were not replaced and TLS validation was not bypassed.

An alternative Workers Builds connection is prepared in the signed-in dashboard for the existing Recharge repository and `codex/cloudflare-preview` branch, using `npm run build` and `npx wrangler deploy --config dist/server/wrangler.backend.json --keep-vars`, with preview builds disabled. It has not been connected. Cloudflare's proposed automatic build token includes account-wide product edit permissions beyond this Worker's needs. An approval request explaining the exact configuration and permissions was emailed to the user; no new token or expanded permissions have been created. Confirm that action or use a narrower deployment credential before connecting.

### Release follow-up, 6 October 2026

The latest production Worker bundle is built, with the property journey,
operations and portfolio handlers and both company logo assets. The generated
backend config and its two boundary tests passed. Renewing the existing
Wrangler login with its unchanged scopes failed during
the OAuth token exchange with a connection reset. The dashboard code editor
also failed to load and its Deploy control remained disabled. The active
backend version at that check was still `cdda731e`.

The user then approved the prepared Workers Builds connection and its
Cloudflare-managed deployment token. The repository is now connected to the
same production branch, using the reviewed build/deploy commands above and
preserving existing runtime variables/secrets. The first build exposed missing
Linux executable bits on the build helpers; those Git file permissions were
restored. The next build deployed commit `edea813` successfully as Worker
version `49a0b862-9a65-4edf-91bb-7cca9aca78bf`. The dashboard confirms the four
existing encrypted runtime secrets remain. Future pushes to this branch now
trigger both the Pages preview and the backend build.

`npm run backend:deploy` now preserves runtime variables with `--keep-vars`
and runs `npm run backend:verify` after uploading. The read-only release
checks cover health/configuration, anonymous web/native route refusal,
no-store/CORS boundaries, excluded legacy routes, invalid-origin write
refusal, sign-in availability and exact hashes of both logo assets. They
use no credentials and create no business records. The first cloud run passed
all 22 HTTP checks on commit `a8b1aec`, after deploying version
`7aaf8416-0e8d-4e02-bb50-3651b2b7a507`. This verifies the installed API boundary
and configuration presence; it does not prove real-user workflows or provider
delivery. Running these checks in Cloudflare avoids this laptop's current
Workers URL connection block. The client feedback is published on Pages and
checked in both themes; the live workspace remains separate from sample data.

## Native build configuration

Set `EXPO_PUBLIC_WORKSPACE_API_ORIGIN` to the deployed backend's canonical HTTPS origin, with no path, query, fragment or embedded credentials. This public value is a URL, not an API secret. Rebuild the native app after setting it. The native entry opens `/live` only when configured; web product previews continue using preview routes.

Never place the Supabase secret/service key, email/SMS provider token, Hostaway token, Cloudinary API secret or push signing credential in an `EXPO_PUBLIC_` variable, frontend bundle or source control. Store privileged provider values in the backend's secret store.

## Service activation order

1. Verify the backend `/sign-in` page and guarded account/session routes after deployment. Check its origin, recovery redirect and no-store headers.
2. Configure production email delivery and SMS if phone registration is enabled. Confirm domain authentication and real reset/verification delivery. Keep registration gated when a required provider is missing.
3. Register verified accounts, bootstrap the approved first super-admin and grant department roles/property assignments. Keep cleaners separate from cleaning managers. Start with no business records.
4. Run one authorised property enquiry through the estimate, agreement, form, issued/paid invoice, booked/completed inspection and actual listing stages. The client and each assigned team must see the same property and only their permitted details.
5. Wire Cloudinary through a trusted server-side upload/evidence path. The evidence RPC requires a provider-verified asset belonging to the correct work item; a pasted photo URL is insufficient.
6. Wire Hostaway using authenticated server-side imports and verified webhooks. Preserve source reservation IDs and apply idempotent imports. Until then, listing and pricing checks represent manually recorded observations, not automatic OTA scans.
7. Wire native push and notification email delivery to the scoped outbox. Mark delivery only after provider acknowledgement. Use idempotent delivery IDs, bounded retries and clear failure records.
8. Confirm the direct-booking discount policy with Alex. Seven nights is the initial follow-up threshold; the proposed discount and cap stay unconfirmed until a super-admin records confirmation. Never confirm a booking before the matching invoice settles.
9. Complete the interface and real-device acceptance items in `ALEX-IMPLEMENTATION-MATRIX.md`. Test revoked access, offline failures, duplicate retries, private exports, accessibility and long-form scrolling before launch.

No credentials are needed to continue the pending local interface work. Production integration validation and delivery must wait for the relevant service configuration.

## Integration structure release, 6 October 2026

Read `BACKEND-STRUCTURE-2026-10-06.md` before enabling external services. The new
integration migration is locally tested but cannot be installed from the currently
connected Supabase account: both the connector and dashboard deny access to the
existing Recharge project. Keep all provider and scheduling flags off until this
migration is installed and actual provider tests pass. Photo upload/viewing,
reservation imports and separate notification channel/device receipt processing
now have server contracts. The existing hosted onboarding/operation workflow
migrations remain unchanged. No provider credentials were requested or added.
