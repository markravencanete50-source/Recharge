# Integration structure, 6 October 2026

This release adds provider adapters and database contracts alongside the existing
property journey, operation, invoice, portfolio, report and access APIs. It does
not enable external services or import preview records. The Communication Centre
remains deferred.

## Deployment boundary

The additive migration `20261005172019_integration_foundation.sql` is tested
locally against all earlier migrations. It is **not installed in hosted Supabase**.
The connector refused project access, and the signed-in dashboard reported
"You do not have access to this project" for Recharge (`brixfalrrmzqoioggvfx`).
Restore access to that existing project and install this migration once before
activating providers. Never replay the already-installed migrations. No hosted
account, property, permission or credential was changed during this work.

The new routes fail closed without an active approved session. All provider
activation flags default off. Missing configuration neither fabricates successful
delivery nor consumes notification attempts. Existing workflows remain available.

## Photo evidence

Web: `/api/workspace/media`; native: `/api/mobile/media`.

`POST` accepts multipart `requestId`, `workId`, `purpose` and one `photo` file.
JPEG, PNG and WebP are checked by their bytes, with an 8 MiB file limit and bounded
stream parsing. Pasted URLs, SVG/HTML, arbitrary provider parameters and duplicate
fields are rejected. The database checks the current assigned job, role, operation
stage and mailbox consent before provider access. It checks those conditions again
before committing evidence, including revocation during an upload.

Cloudinary uploads use a server-generated immutable asset identifier,
`type=authenticated`, `overwrite=false` and a backend signature. The signed response
is validated. A fixed-host authenticated lookup recovers an existing upload after
a lost response or failed database commit. Retrying an intent with different bytes
is rejected. The API returns the verified evidence UUID used by existing cleaning
and delivery workflow actions, never a publicly accessible photo URL.

`GET ?workId=<uuid>` lists permitted verified evidence metadata.
`GET ?assetId=<evidence-uuid>` rechecks access and proxies the original photo through
the backend, with no-store headers. Download signatures stay server-side and expire
after 60 seconds. File bytes and format must match the verified asset metadata.
Do not configure incoming Cloudinary transformations that alter original bytes.

Cleaning/delivery upload controls in the live interfaces remain to be connected to
these endpoints; the old unavailable messages intentionally remain until then.
Avatar upload is a separate pending account feature; property evidence cannot be
reused as a public avatar.

## Notifications

Web: `/api/workspace/integrations`; native: `/api/mobile/integrations`.

Administrators can `GET` configuration booleans and aggregate job states, without
receiving recipient addresses, tokens or secrets. `POST {action:
"dispatchNotifications"}` processes at most five jobs. The Worker also has a
scheduled handler, gated separately; no cron trigger is installed by this release.

Each outbox recipient/channel/device has a durable unique delivery record. Claims
use row locks, skip locked rows and a five-minute lease. Each retry re-evaluates
current account status, assignment, tool grants and destination registration.
Removed access cancels pending deliveries. Lease fencing prevents late workers
from overwriting a subsequent claim. Bounded exponential retries stop after eight
attempts. Expired send leases and ambiguous sends require review rather than
blindly duplicating messages. Retrying receipt reads is safe.

Resend email sends use a stable idempotency key; provider acceptance is saved
separately from a delivered event. Expo push tickets are likewise accepted, then
receipt checks confirm handoff to APNs/FCM. A push receipt is not proof that a person
read the notification. Removed-device errors unregister the invalid token.
Notification bodies contain a generic sign-in instruction; no property address,
access code, bank information or job notes appear on a lock screen or in an email.
Existing in-app notifications continue to use their scoped outbox projection.
The parent outbox's historical `delivered_at` is not populated: delivery belongs
to the individual channel/device record, not the whole event.

## Reservation imports

`POST {action:"importReservations",propertyId:"<uuid>",offset:0}` on the integration
endpoint requires Stays/admin access and an explicit mapping to an existing
property. A unique index prevents two properties sharing a Hostaway listing ID.
The response supplies changed/unchanged/failed counts and a next offset. Each run
processes ten records from the bounded provider listing (up to 500 records), with
fixed provider URLs and timeouts. This is not an unlimited historical import or
an automatic pricing/listing updater. Do not infer cancellation from missing rows.

Imported reservations keep stable source IDs and cannot overwrite manually entered
reservations. Retries return unchanged records without duplicating follow-ups.
Overlapping confirmed dates are rejected. Unknown provider states and wrong listing
IDs fail closed. Changed/cancelled reservations cancel unconfirmed follow-up work
through the domain status guard; stale date quotes/guest acceptances cannot be reused.
Eligible changed reservations receive a fresh follow-up. Paid booking confirmation
and Alex's unconfirmed discount policy retain their existing checks.

Imports are initiated by permitted users. Authenticated webhook ingestion and
automatic reservation polling still need a provider-specific design/acceptance
check after credentials become available; no unsigned webhook endpoint is exposed.

## Later configuration

All provider values below belong in the backend secret/variable store. None should
be put in `EXPO_PUBLIC_` or committed to the repository.

| Capability | Required configuration | Activation flag |
|---|---|---|
| Photo upload/view | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | `MEDIA_UPLOADS_ENABLED=true` |
| Notification email | `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL` (verified sender address) | `NOTIFICATION_EMAIL_ENABLED=true` |
| Push delivery | `EXPO_ACCESS_TOKEN`, correctly registered device tokens and iOS/Android push credentials in Expo | `NOTIFICATION_PUSH_ENABLED=true` |
| Hostaway reservation import | `HOSTAWAY_ACCOUNT_ID`, `HOSTAWAY_API_KEY`, explicit property/listing mappings | `HOSTAWAY_IMPORT_ENABLED=true` |
| Background receipt/delivery processing | A deliberate Cloudflare cron trigger, migration installed and the intended provider flags | `INTEGRATION_SCHEDULE_ENABLED=true` |

Supabase Auth verification/reset email and optional phone SMS are separate from
notification email. Their production provider configuration, verified accounts,
owner bootstrap and real-device acceptance are still pending. Adding a key alone
is insufficient: enable services only after their actual delivery/upload/import
tests pass. The admin configuration endpoint indicates local configuration presence,
not connectivity or verified sender/device health.

## Dependency audit

The refreshed mobile npm audit completed and reports 20 high findings propagated
from two underlying advisories: `braces <=3.0.3` and `node-forge <=1.4.0`. Those are
also the current registry latest versions at this check; no compatible patched
release is available. The audit's proposed Expo 44/React Native 0.72 downgrade is
not applied to an SDK 57 app.

Root npm audit failed twice with connection resets. A direct registry bulk request
for exact root lockfile versions succeeded and returned the `braces` advisory.
This is an advisory lookup, not an npm zero-vulnerability certification. No new
dependencies were installed for these integration adapters.

Track the publisher advisories for patched releases:
[braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and
[node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
These remain unresolved; production/native acceptance must include the dependency
update when the compatible fixes are available.

## Local verification

The full regression suite passed 168 tests. After the final per-send permission
check was added, all 23 integration tests passed, including two additional access
and schema checks. Root and mobile TypeScript, scoped ESLint, the production backend
build and both built-Worker boundary tests passed. The HTTP tests mock provider
responses; the database tests execute all migrations in local PostgreSQL. They
verify malformed files, forged origins, inactive accounts, table/RPC privilege
boundaries, duplicate intent/import handling, provider tickets/receipts, lease
fencing, revoked recipients and substituted download bytes. They create no hosted
accounts or records and do not prove real-provider delivery.

Provider contracts and receipt semantics follow the current
[Cloudinary API](https://cloudinary.com/documentation/image_upload_api_reference),
[Resend email API](https://resend.com/docs/api-reference/emails/retrieve-email) and
[Expo delivery documentation](https://docs.expo.dev/push-notifications/sending-notifications/).
