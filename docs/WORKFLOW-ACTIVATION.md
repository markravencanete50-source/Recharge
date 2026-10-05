# Activate the connected property workspace

## Backend deployment

Build the server, generate the backend config with `node scripts/build-backend-config.mjs`, and deploy with `npm run backend:deploy`. The production Worker must keep the existing encrypted Supabase keys, canonical `APP_ORIGIN` and durable authentication limiter secret. The generated config contains no production credentials or legacy D1/R2 bindings. Deploy only `dist/server/wrangler.backend.json` for this backend.

The public Pages product preview stays read-only. Its sample data must never be imported into the live database. Git deployments of `codex/cloudflare-preview` update the preview; they do not deploy the backend Worker.

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
