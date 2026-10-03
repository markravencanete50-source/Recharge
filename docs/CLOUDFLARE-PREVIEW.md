# Recharge Cloudflare preview

This deployment reuses the existing React portal to review the product while the Supabase integration is being built. All preview records are fictional. The role switcher demonstrates existing screen visibility, not real authentication or a production super admin account.

Production code and its ChatGPT authentication remain separate. Only the portal's optional `preview` prop suppresses guest notification polling. The preview build does not include the legacy server routes. Its Worker has an ASSETS binding only, with no D1, R2, Supabase credentials or third-party integration credentials. It rejects every mutation, serves a fixed allowlist of synthetic API responses and returns JSON errors for unsupported APIs, authentication routes and external tool redirects.

## Build and deployment

Use the private Recharge repository, branch `codex/cloudflare-preview`, Cloudflare Pages project `recharge-preview`.

Build command: `npm run preview:build`

Build output directory: `preview-dist`. The build includes a bundled `_worker.js` with the read-only API safeguards and `_routes.json` to handle every request. No application environment variables or database bindings are needed.

`preview/wrangler.jsonc` is an optional standalone Workers configuration for local verification or a later Workers deployment with `npm run preview:deploy`. Do not use the separate `wrangler.types.jsonc` type-generation configuration for deployment.

Local verification: `npx wrangler dev --config preview/wrangler.jsonc --port 4173 --local`, then `node --test tests/preview-security.test.mjs`.

For remote verification, set `PREVIEW_TEST_URL` to the deployment URL before running the same tests.

The underlying product is a web application. This preview does not create native iOS/Android builds or connect production business records. Those remain part of the application development plan.
