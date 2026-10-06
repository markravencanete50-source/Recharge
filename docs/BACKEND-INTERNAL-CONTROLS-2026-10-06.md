# Internal backend controls — 6 October 2026

## Implemented

The existing enquiry, estimate publication, agreement signature, private onboarding
form, invoice/payment, inspection, listing and departmental handover workflows remain
in place. Communication Centre remains deferred. This release adds internal API
contracts; it does not seed records or activate external providers.

Web: `/api/workspace/controls`; native: `/api/mobile/controls`.
Verified, approved sessions and active database access are required. Writes share
the durable quota, validate strict input, recheck current permission before retry
receipts and preserve an audit trail.

| Read section | Scope/result |
| --- | --- |
| `resources` | Property UUID; optional work UUID. Admins receive up to 100 active assignment candidates; team staff see eligible assigned candidates for permitted work. Names, roles and UUIDs only. |
| `reservations` | Stays/admin direct-booking permission for the property; up to 100 source/date/status/version records. |
| `events` | Stays/admin weekly-performance permission; up to 100 versioned event records and archive state. |
| `estimate` | Stays/admin property-onboarding permission; submitted assumptions, calculated projections and version. |
| `notifications` | Up to 50 updates addressed to the current user, restricted by current property/work access, with in-app read state. |

All actions require a caller-generated UUID `requestId`. Identical retries return
the receipt; different input with the same identifier fails. Removed assignments,
revoked accounts and changed roles cannot reuse old receipts.

| Action | Required data/behavior |
| --- | --- |
| `updateReservation` | Property/reservation UUID, expected version, check-in/out and status. Manual source only; 1–365 nights; confirmed overlaps fail atomically. |
| `updateEvent` | Property/event UUID, expected version, name, date, public HTTPS source and recorded opportunity. |
| `archiveEvent` | Property/event UUID and expected version. Soft archive; weekly reports omit archived events. |
| `markNotificationRead` | Decimal-string event ID. Current recipient only; never claims email/push delivery. |
| `saveEstimate` | Property UUID, version (zero for first save) and all eight assumptions below. Does not publish an estimate or advance onboarding. |
| `issueOperationInvoice` | Property/work UUID, expected work version, eligible recipient UUID, reference and integer GBP minor-unit amount. Accepted cleaning/booking, delivered purchase or completed maintenance evidence is required. |

Reservation changes, including source imports, lock relevant work/invoices before
checking paid or confirmed bookings. Such bookings require manual resolution;
changes cannot silently invalidate them. Unpaid obsolete invoices are voided and
old follow-ups cancelled, then a new eligible follow-up is created when needed.
Records and payment history remain for audit. Source imports also update versions.
The existing minimum-stay configuration is retained; discounts remain unconfirmed
until Alex's policy is approved.

Generic invoice creation enforces the same phase, module, currency, amount and
duplicate-invoice gates. Maintenance/direct-booking amounts match evidence exactly;
purchases cannot exceed the approved amount. Admins confirm payment separately.

## Explicit estimate assumptions

Required: `availableNights` (1–366), `occupancyBps`, `directBookingBps`, `otaFeeBps`,
`managementFeeBps` (0–10,000 each), and ordered `lowRateMinor`, `mediumRateMinor`,
`highRateMinor` (integer minor units, 0–10,000,000 each).

Gross revenue is the rounded nightly rate × available nights × occupancy. OTA fees
apply to the non-direct share; management fees apply to gross. Amounts round to
pennies. Net excludes cleaning, maintenance, taxes and other operating costs.
Outputs are labelled user-entered projections, not actual earnings. No occupancy,
booking mix or fees are invented or automatically substituted.

## Restricted property details

`section=access` returns entry instructions only. Cleaners require a currently
assigned open cleaning-schedule job. `section=ota` separately requires OTA permission
and denies clients, cleaners and cleaning managers. Finance retains its own tool
permission. Admin writes update one section without clearing the other.

While installation is pending, HTTP reads strip unrelated legacy fields and writes
require `workspace_controls_version() = 1`. This prevents the old access writer
from clearing OTA information. The direct Supabase RPC permission fix is in the
migration and is **not applied to the hosted database yet**.

## Phone-only authentication/recovery

Web login accepts exactly email/password or international phone/password. Native
login supports `action: loginPhone`. The submitted contact must be verified; another
verified contact on the user does not bypass that check. Phone users share the
existing five-failure, 24-hour password lockout and approved-session boundary.
An ordinary provider/OTP token alone grants no workspace access.
The lockout bucket is keyed by the submitted contact. Registration uses one contact;
if both email and phone are later added to one identity, cross-contact lock sharing
needs a separate account-level guard before enabling both login methods for it.
Provider contact comparison accepts Supabase's canonical digits-only phone value
while app input remains strict international `+` format, following the
[Supabase Auth implementation](https://github.com/supabase/auth/blob/master/internal/api/phone.go).

SMS reset endpoints: web `/api/session/phone-recovery`; native `/api/mobile/recovery`.
`request` accepts `phone` and never creates users; known/unknown numbers receive
the same acknowledgement. `verify` accepts `phone`, `code` and `password` satisfying
existing password rules. It verifies contact/session, consumes a server one-time
proof, unlocks the guard, revokes approved sessions and globally signs out provider
sessions. No access/refresh token is returned; revoked roles stay revoked.
IP/contact quotas bound sending and OTP checks.

SMS reset stays off until `MOBILE_REGISTRATION_ENABLED=true`,
`MOBILE_PHONE_REGISTRATION_ENABLED=true` and the production SMS provider are
configured and tested. Email reset remains email-specific. Native SDK helpers
support phone sign-in/reset, internal controls and authenticated multipart evidence
uploads with explicit retry UUIDs. No dependencies were added. Actual device
multipart uploads still require acceptance testing.

## Installation and remaining work

Install these migrations in order once access to Recharge's existing project is restored:

1. `20261005172019_integration_foundation.sql`
2. `20261006021530_backend_internal_controls.sql`
3. `20261006022727_verified_phone_sessions.sql`

The connected Supabase account cannot access project `brixfalrrmzqoioggvfx`. These
migrations execute in local PostgreSQL tests but have **not** been installed there.
No alternate project is used. Hosted advisors and cross-role acceptance remain
pending; do not activate services before installation and real provider tests.

External credentials/delivery, owner bootstrap, real accounts, native device
acceptance, scheduler activation and provider webhooks/automatic polling remain
pending. Existing interfaces still need assignment/editing/calculator/invoice/photo
controls and phone-reset forms. An API or SDK helper is not a finished screen.
The map renderer is interface work. Profile setup supports names/avatar presets;
image-avatar upload remains separate. Dependency advisories documented in
`BACKEND-STRUCTURE-2026-10-06.md` remain unresolved.

## Verification

The full regression run passed 190 tests before the final compatibility guard.
After that guard, all 25 focused HTTP/SQL/auth tests passed, including three new
legacy-projection/migration-availability checks. Tests cover current permissions,
version conflicts, invoices, quote invalidation, archiving, exact projections,
phone-only session approval, lockout, recovery replay and provider failures.
SQL tests execute migrations locally; provider responses are mocked. No real SMS,
email, import or photo delivery is claimed. Root/mobile TypeScript, scoped root
ESLint, Expo lint and the production Worker build passed.
The final phone-format check passed 20 native-session/recovery/registration tests;
15 release SQL/Worker checks also passed after the database capability guard.
