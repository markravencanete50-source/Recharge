# Recharge initial source audit

Reviewed 3 October 2026. This is a source review and backend foundation, not a production readiness certificate.

## Source and scope

The export contains a working React web application using TypeScript, Next-style routes, Vinext/Vite, Tailwind, Drizzle, Cloudflare D1 and R2. It is not a React Native project. The export contains 32 API routes, 52 database tables, 28 SQLite migrations and 37 workspace module identifiers. Preserve this implementation as the functional reference for the Android and iOS rebuild.

The source backup is preserved on GitHub `main`. Development continues on `codex/backend-foundation`. The GitHub repository is private. No live D1 records, R2 files or integration credentials were supplied with the ZIP. Cloudflare access and data migration are deferred as requested.

## Findings and initial fixes

| Finding | Impact | Status |
| --- | --- | --- |
| User-uploaded HTML was rendered inline on the application domain. Cleaning and purchase-order file routes also rendered arbitrary formats inline. | An uploaded active document could execute with the reader's application origin. | File responses now have a restrictive sandbox CSP, no MIME sniffing, private caching and sanitized filenames. Known photos and videos retain previews. HTML previews retain static document styling but cannot run scripts, submit forms or gain same-origin privileges. SVG and unknown formats download. Four regression tests pass. |
| Export lacked Worker type declarations and had genuine TypeScript errors. | Build success alone did not catch a missing Textarea import, missing property data and incomplete migration profile. | Local-only Worker types generated. Missing fields and import corrected. Hostaway matching preserves its selected row type, response types are explicit and optional listing labels no longer crash synchronization. TypeScript passes. |
| Authentication trusts hosting-supplied identity headers. The owner email receives full legacy admin access. | This authentication is safe only behind the intended proxy that verifies and replaces those headers. Reusing it directly on Vercel or in a mobile API would permit identity spoofing. | Deployment blocker for the new backend. Replace with verified Supabase identities and database-owned access before public deployment. No claim that the current trusted hosting proxy is exploitable. |
| The temporary ClickUp migration key can create an admin-like profile. | A retained migration credential has broad access to property operations. | Restrict to migration-only operations or remove it during the backend replacement. No migration secret was found in this export. |
| Guest message notification code polls Hostaway synchronization every four seconds. | Repeated upstream requests and database work can increase cost and hit service limits. | Replace with controlled server synchronization and native push events in the mobile implementation. |
| Some integrations are represented by connection flags. | A connected-looking interface does not prove outbound email, WhatsApp or telephone workflows work. | Verify each integration end to end when credentials and scope are available. The furnishing calculator also links to a separate site whose source is absent. |

## Supabase foundation

The target project is Recharge, reference `brixfalrrmzqoioggvfx`. Before setup, it had no public application tables, no migration history and no Auth users.

The additive migration creates `workspace_profiles`, `workspace_module_grants` and `workspace_access_events`. Every public table has RLS. Anonymous callers have no table access. Authenticated users can read only their own profile and active module grants; active super admins can monitor profiles and role/status events. Browser and mobile clients cannot write access tables. Trusted server administration must perform approvals and permission changes after verifying the acting administrator.

Roles are `super_admin`, `admin`, `stays`, `cleans`, `ready` and `client`. New users always start as pending clients. User-editable metadata supplies display text only. No user has been promoted to super admin. Alex must first register with a verified email address, then receive access through trusted administration.

Module permissions do not replace property ownership or task assignment restrictions. Each of the 52 business tables needs a specific ownership, client or staff policy before being exposed. The existing web application still uses D1 and the hosting identity headers. This migration does not connect the legacy UI to Supabase or transfer live data.

## Validation

Production Vite build passes. TypeScript passes. Four new file-response security tests and four existing UI tests pass. The existing rendered-page test fails under plain Node because the build imports `cloudflare:workers`; it requires runtime-aware execution. The full suite is therefore not marked clean.

The Supabase foundation was syntax-checked in a rollback transaction. Access tests use disposable synthetic accounts and roll back all fixtures. Checks cover forged role metadata, client isolation, pending and revoked accounts, super admin monitoring, missing identities and denied client writes. See `supabase/tests/access_foundation.sql`.

The migration was applied and recorded as `20261003120633`. The same access tests passed after application. Final verification shows three application tables with RLS, no anonymous profile access, no authenticated role-update permission and zero retained test users, profiles or events. Supabase advisors show two informational unused-index notices for the empty access-events table; the indexes are retained for future user and actor lookups. No security or warning-level items were shown in the advisor list with filters cleared.

The dependency advisory service could not be reached; `npm audit` returned a connection reset. Dependency vulnerability status remains unverified. A limited source-pattern scan found no credential-like literals or private keys, but this is not an exhaustive secrets audit.

## Development order

1. Finish integration and dependency verification; confirm the reusable module scope and role matrix.
2. Connect verified Supabase Auth to the new backend and provision Alex's verified super admin account. Build audited server-side access management.
3. Convert business schema and queries from SQLite/D1 to PostgreSQL. Test ownership and assignment rules for each workflow. Import live data after Cloudflare access becomes available.
4. Implement the Android and iOS interfaces with React Native and Expo, using the existing app as the workflow reference. Connect Cloudinary media and native notifications.
5. Prepare any separately agreed web administration interface for Vercel. The Vinext/Workers export needs adaptation before Vercel deployment.
6. Conduct three days of role-based user testing, regression testing and release checks before store submission. Store review and account readiness affect public release dates.

The previously discussed three-week estimate should be checked against the 37-module scope, access to integrations and the data migration. Development and submission dates cannot guarantee App Store or Play Store approval dates.

## Reproducing checks locally

Install with `npm ci --ignore-scripts`. Run `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/vite/bin/vite.js build` and `node --test tests/file-response.test.mjs tests/ui-components.test.mjs`. The source's original npm build wrapper expects a Linux shell, so the direct Vite command is used on Windows.

Regenerate legacy Worker declarations using `node node_modules/wrangler/bin/wrangler.js types worker-configuration.d.ts --config wrangler.types.jsonc --strict-vars=false`. This configuration contains local placeholders and must not be used for production deployment. Supabase CLI 2.119.0 created the migration filename.

Relevant vendor references: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Auth profiles](https://supabase.com/docs/guides/auth/managing-user-data), [migration tracking](https://supabase.com/docs/guides/deployment/database-migrations).
