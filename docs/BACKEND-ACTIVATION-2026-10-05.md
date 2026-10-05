# Recharge backend activation

Verified 5 October 2026 against Supabase project `brixfalrrmzqoioggvfx` through the signed-in dashboard. This records the first hosted backend milestone. It does not mark the mobile application, business workflows or production authentication ready.

## Completed on the hosted project

Preflight confirmed PostgreSQL 17.11, zero Auth users, zero workspace profiles and only `20261003120633_access_foundation` recorded.

The following original migrations were applied in one transaction, with exact original SQL stored in `supabase_migrations.schema_migrations.statements`:

- `20261003151028_workspace_administration`
- `20261003162617_authentication_security`
- `20261004083809_cleaning_manager_role`

The transaction succeeded. No accounts or role grants were created. New accounts continue to default to pending clients; a requested or user-editable role cannot activate access.

`supabase/tests/hosted_security_activation.sql` then passed on the actual project. It checks migration presence, private security-table RLS, access-table RLS, invoker-only public RPCs, direct-write denial, server-only guard permissions, the separate cleaning-manager role, five failures followed by a 24-hour lockout, persistent quota enforcement and refusal of an unapproved workspace session. Synthetic guard counters and events roll back. It does not create Auth users or send messages.

The existing local route and PostgreSQL access suites passed 31 checks covering recovery proofs, session invalidation, role escalation, custom grants, revocation, cleaner restrictions, lockout and rate limiting. These provider-mocked/local tests complement the hosted checks; they do not prove email/SMS delivery or a native login.

The refreshed Security Advisor reported zero errors and zero warnings, with six informational notices for RLS-enabled private security tables without policies. Those tables intentionally deny direct client access and are written only through checked server RPCs. Adding permissive policies to remove those notices would weaken the design.

Data API schema selection confirmed `public` and `graphql_public` exposed, with `private` unchecked. Automatic exposure of new tables was disabled and saved. No paid plan, third-party subscription or new credential was enabled.

## Remaining work in dependency order

1. Build the PostgreSQL business schema from the existing 52-table D1 contract. Keep the approved first workspace empty. Separate operational property data from access codes, financial details and other restricted fields; preserving table names alone is not sufficient for safe client access.
2. Establish UUID-based ownership and assignments for clients, cleaners and managers. Add and exercise per-table allow/deny policies before granting Data API access. Replace legacy email identity matching in the new business services.
3. Deploy the full backend with its server-only Supabase and rate-limit configuration. The public Pages deployment is still a synthetic preview and has no live account API.
4. Connect verified mobile sessions, refresh and logout to the same approval guard. Complete verified phone identity support and UUID-based phone-only account provisioning before enabling phone workspace access.
5. Configure production email delivery, verification and recovery redirects; configure a supported SMS provider before enabling phone registration. Test actual delivery with designated test accounts.
6. Alex registers and verifies `enquiries@rechargestays.co.uk`, setting his own password. Trusted owner provisioning then establishes the first super admin. There are currently no registered users, so owner provisioning has not run.
7. Replace mobile sample loaders and read-only detail flows with the authorized live read/write services, including onboarding, job assignment, maintenance, approvals, invoices and communication workflows.
8. Connect Cloudinary, uploaded avatars, push notifications, required integrations, live analytics/exports and server activity history.
9. Run deployed allow/deny tests, physical-device checks and the agreed three days of role-based acceptance testing before launch.

The installed database lockout cannot protect an application that bypasses the guarded server path. Direct Supabase password tokens still need server session approval to reach Recharge. The full server and native client must both enforce this before live use.

Earlier audit documents describe historical observations. This document supersedes their statements that the three security/access migrations remain unapplied.

Local evidence is in the ignored `.audit/backend-activation` directory. No service key, password or client business data is stored in this report.
