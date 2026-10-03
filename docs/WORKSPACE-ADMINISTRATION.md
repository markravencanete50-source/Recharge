# Recharge workspace update

The preview adds persistent light and dark themes, a compact navigation layout,
37 independently cropped tool illustrations and an analytics board with daily
line, status donut and queue bar charts. The chart data table provides exact
values. Motion follows the operating system's reduced-motion preference.

Department artwork is saved in `public/recharge-departments-v2.png`, generated
using the built-in image generation tool with a transparent background. The
five objects have independent crop bounds and never share a feature-card cell.

Final image prompt: Create a single horizontal sprite atlas with five separate
realistic miniature 3D object groups, one isolated group per column. Cleaning:
forest-green bucket, ivory towel and hand brush. Ready: green cordless drill
and cream hard hat. Stays: Scottish townhouse and green suitcase. Clients:
brass rolodex with cream profile cards and green tabs. Accounts: neoclassical
bank facade, green calculator and brass coins. Photoreal studio miniatures,
tactile enamel, leather, ivory paper and stone, brass details, isometric camera,
soft studio light and short shadows. Consistent visual size, generous transparent
gaps, no overlapping groups, text, labels, letters, numbers, frames or watermarks.

## Authentication and access

Live application authentication uses the pinned Supabase SSR and Auth clients.
Cookies are HTTP-only. Each request verifies the user with Auth, and workspace
access is resolved by the authenticated user ID using a checked database RPC.
User-editable metadata supplies display names only.

The legacy ChatGPT header authentication is disabled by default. It is allowed
only with `TRUSTED_CHATGPT_GATEWAY=true` behind the original gateway that removes
and supplies those headers. Never enable this setting on a public Cloudflare app.
There is no automatic privileged role based on an email address in Supabase mode.

Super admins have every module and administration access. Regular admins have
every module but can manage only non-admin accounts. The database enforces this
hierarchy, checks live Auth sessions and current profile status, records access
changes, validates grants atomically, and prevents losing the last active super
admin. Revocation changes the current database status and blocks later requests
even if an old JWT has not expired. Reset to role defaults resets tool grants;
it does not change a sign-in password. Removing access revokes it without deleting
the Auth account or its audit history.

## Live activation checklist

1. Apply `20261003151028_workspace_administration.sql` after the access foundation.
2. Configure `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` on the full server
   deployment. Never supply a service-role key to the browser or preview bundle.
3. Create and verify `enquiries@rechargestays.co.uk` in Supabase Auth. Alex sets
   his own password. Run `supabase/provision-owner.sql` from trusted administration
   once the email is verified. The file is idempotent for this owner and refuses
   to bootstrap over a different active super admin.
4. Connect the existing D1 business database and required integration bindings
   to the full application deployment. This update moves identity and access
   management to Supabase, not the 52 business tables. Do not expose any migrated
   business tables through Supabase without tenant-specific RLS policies.
5. Verify live login, refresh, all departments, admin grants, revocation and logout
   with disposable staff accounts before giving client access.

At implementation time the Supabase connector denied project queries. The
dashboard displayed no Auth users. The administration migration and owner
provisioning have therefore NOT been applied to the live project. The public
Cloudflare preview remains synthetic and read-only, with no Auth or DB binding.
Its role picker is for design review and never provisions an account.

## Analytics limits

Counts use records returned to the signed-in workspace. The period filters
workflow/repair creation dates and scheduled clean dates. Work status is the
current status of records created in that period, not a historical status series.
Linked work can appear in separate queues. Workflow snapshots contain at most
250 records. Revenue, occupancy, complete historical totals and booking metrics
require their live source integrations. Disconnected sources are identified;
no historical values are invented. Preview workload examples are fictional.

## Validation

The PGlite test executes both migrations against PostgreSQL with synthetic Auth
users, sessions and roles. It checks role escalation, RLS visibility, immediate
revocation, logged-out JWTs, atomic rollback, audit records and owner protection.
This verifies database logic locally, not hosted Supabase deployment or email
delivery. Browser evidence is captured for desktop and mobile in both themes.
All 23 targeted tests, TypeScript checking and both build outputs passed.
The full local Worker rejected forged owner headers on access, workflow and
team endpoints. Unconfigured password sign-in returned 503 without creating a
session. At the normal 1536px desktop viewport, the navigation's 518px content
fits its 518px area and the Access row is fully visible. The 390px mobile view
has no horizontal overflow; account dialogs and feature details were exercised.
