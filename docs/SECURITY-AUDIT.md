# Recharge security review

Reviewed 4 October 2026. The following controls are implemented in the full
application, but need the pending hosted migrations and server configuration
before live activation. The public Pages preview is a separate synthetic,
read-only deployment without accounts or a database binding.

## Controls implemented

| Layer | Behavior |
| --- | --- |
| Authentication | Supabase verifies the user and confirmed email. A live Auth session also needs Recharge server approval. Session cookies are HTTP-only. |
| Password lockout | Five incorrect passwords in the account's current 24-hour attempt window block new password entry for 24 hours from the fifth failure. A successful guarded login resets failures. Existing valid sessions are not logged out merely by failed login attempts. |
| Concurrency | Database row locks and short reservations cap parallel attempts at five. Provider outages do not count as incorrect passwords. |
| Recovery | Email PKCE recovery creates a session-bound, one-use proof. Only successful password replacement unlocks login. It invalidates all approved application sessions and preserves revoked permissions. New passwords require 12 characters, maximum 72 UTF-8 bytes. |
| Rate limits | Persistent buckets: 120 API requests/minute/IP, 20 logins/minute/IP, five recovery requests/hour/IP, three recovery emails/hour/account, 20 recovery callbacks/minute/IP and 10 password updates/minute/IP. Excess requests return 429 and Retry-After. |
| Authorization | Current active profile and server module permissions govern access. Only super admins manage privileged accounts. Email headers and editable metadata cannot grant roles. |
| RLS | All three exposed access tables and six private guard tables have RLS. Clients cannot directly write access/security tables. Public RPCs are invokers; private checked helpers use explicit grants and an empty search path. |
| SQL | Reviewed D1 paths bind caller values rather than interpolating them. Supabase access updates are atomic checked RPCs. Private helpers qualify object names and do not concatenate caller SQL. |
| Request protection | Cookie-authenticated API mutations require an exact origin match. Authentication JSON is capped at 16 KiB. Responses prevent caching, MIME sniffing, framing and recovery-link referrer leakage. |
| Failure handling | Missing server credentials, database failures and missing trusted IP headers refuse access. Legacy owner-email, gateway-header and migration-key access shortcuts have been removed. |

Rate-limit account identifiers are HMACs of normalized emails. Passwords, proofs
and provider credentials are not logged. The guard's private records are writable
only through narrowly granted server RPCs. Privileged keys never enter client
assets or the preview bundle.

## Platform boundaries

The Supabase Password Verification Attempt hook requires Teams or Enterprise.
This Free-plan project instead enforces lockout at Recharge's application/data
boundary. A password token obtained directly from Supabase Auth cannot access
Recharge APIs or protected access tables without server session approval. This
does not claim to lock Supabase's own token endpoint. OAuth, magic-link and native
mobile entry points need an equivalent checked approval flow before enabling them.

The limiter trusts Cloudflare's overwritten CF-Connecting-IP header. Other hosts
need a trusted-address adapter. These routes use browser cookies and same-origin
checks; future Android/iOS clients need a mobile API flow with the same guard.

The 52 original business tables remain in Cloudflare D1, which has no PostgreSQL
RLS. They rely on server-only bindings, department checks and ownership/assignment
filters. Access-table RLS is not business-table RLS. Migration to Supabase requires
table-specific tenant policies and adversarial ownership tests before Data API
exposure. This review does not certify every original business workflow.

## Hosted observations

Read-only dashboard SQL found three public tables: workspace_profiles,
workspace_module_grants and workspace_access_events, all with RLS and one SELECT
policy each. The profile self-read policy still lacks the new approved-session
check; all six private guard tables are absent. The Security Advisor displayed
zero errors, warnings and suggestions. A linter result is not a production
security certification. The Supabase connector denied access to this project.
Hosted password policy was strengthened to a 12-character minimum and secure
password changes now require a recent session or reauthentication. These settings
were saved and verified in the dashboard. No account password, privileged role,
SMTP setting or pending migration was changed.

## Dependencies

Patched compatible versions of Next.js, React, React DOM, React Server Components,
Vite, Cloudflare's plugin and Wrangler. Overrode Vinext's pinned vulnerable
image-size parser with 2.0.4. The production-dependency audit reports zero findings.
The full audit still reports 12: eight high and four moderate, zero critical.
Remaining chains concern braces/micromatch, CommonJS build tooling, lint tooling
and Drizzle's older development loader. No compatible fix resolves every chain.
Vinext is listed as a development dependency but produces server code, so the
production-only audit does not certify the deployed bundle. Do not expose build
servers or accept untrusted build configurations. Vite now binds to localhost.

## Activation requirements

1. Apply 20261003151028_workspace_administration.sql, then
   20261003162617_authentication_security.sql. The foundation is already applied;
   do not replay it. Record successful pending migrations in migration history.
2. Configure SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY,
   AUTH_RATE_LIMIT_SECRET and APP_ORIGIN on the full server only. The privileged
   key must be a modern sb_secret_ key. Use a random HMAC secret of at least 32
   characters and the exact application origin. Keep secrets outside Git and
   browser assets. No secret values belong in this document.
3. Allowlist the exact APP_ORIGIN/auth/recovery URL in Supabase and configure
   production email delivery and provider password rules. Default email delivery
   has a low project-wide quota and cannot support normal production recovery.
   No paid subscription has been enabled by this change.
4. Finish the separate owner-account handoff and reviewed provisioning. Alex
   sets his own password; an email header must never establish admin identity.
5. Connect the full deployment's business/integration bindings. Verify real email
   recovery, five failures, expiry, direct-token rejection, role isolation,
   revocation and logout with designated test accounts on the actual host.

Existing sessions need a fresh login after the approval migration. Request new
reset links through Recharge's recovery flow. HMAC-secret rotation changes account
hashes and starts new counters; do not rotate it casually during active lockouts.
Configure retention/capacity monitoring as real security-event traffic begins.

## Verification and limits

Tests execute the actual migrations against isolated PostgreSQL, including the
fifth failure, expiry, concurrent reservations, expired/replayed attempts, session
approval, direct-token denial, rate-limit expiry, bound recovery proofs, session
invalidation, escalation, immediate revocation and RLS. Route tests mock the Auth
provider to verify sequencing, locked-account refusal and failure handling.

The built local Worker rejects forged identity/migration headers, blocks cross-site
API requests and disables unconfigured sign-in/recovery forms. Both builds and
TypeScript checking and all 44 targeted tests pass. Live email delivery and provider behavior remain hosted
activation tests, not verified by these local checks.

References: [Auth hooks](https://supabase.com/docs/guides/auth/auth-hooks),
[password recovery](https://supabase.com/docs/guides/auth/passwords),
[Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits),
[password security](https://supabase.com/docs/guides/auth/password-security).
