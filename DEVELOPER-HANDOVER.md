# Recharge developer handover

Source snapshot: Site version 79, commit ba5ca178db3a55e7e887cb5eeb7592dae4d7cbd9.

This ZIP contains the complete tracked source for the central Recharge platform: UI, API routes, shared components, database schema, all 28 Drizzle migrations, assets, scripts, tests and dependency lockfile. It includes Routine Maintenance, regional property planning and scheduled inspection forms.

## Setup

Use Node.js >=22.13.0. The supplied shell scripts target Linux (or WSL) and require curl, flock and GNU timeout.

1. Extract the recharge-source folder.
2. Run npm ci.
3. Configure the required runtime bindings and secrets.
4. Run npm run dev for development and npm run build for a production build.

## Runtime requirements

- Cloudflare D1 binding: DB
- Cloudflare R2 binding: BUCKET
- Hostaway: HOSTAWAY_ACCOUNT_ID and HOSTAWAY_API_KEY
- Communication integrations, where enabled: BONLINE_API_KEY, COMMUNICATION_EMAIL_BRIDGE_TOKEN, WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID
- Migration endpoint, where used: CLICKUP_MIGRATION_KEY

Secrets, live database records and stored uploads are not included. Apply existing migrations in order to a new database; do not regenerate or rewrite applied migration history. Database migration and live-data transfer are separate tasks.

## External hosting

The current application uses Sites-managed Cloudflare bindings and ChatGPT sign-in. Moving it to external hosting requires configuring Cloudflare resources and replacing or securely adapting the authentication layer. Never accept user-supplied identity headers without a trusted authentication proxy.

Some tools in the portal link to separate websites. This archive contains this Recharge project only; it does not contain the source of those separate sites.

No source changes or production deployments were made for this export.
