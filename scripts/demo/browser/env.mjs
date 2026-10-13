// The Worker variables the demo backend's routes read (cloudflare:workers). Imported before anything
// else in engine.mjs: some modules read them as they load.
export const ENV = {
  APP_ORIGIN: self.location.origin,
  // Photos are kept by the demo's own storage (the live app's own-storage mode).
  SUPABASE_URL: 'https://demo.localhost', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_demo', SUPABASE_SECRET_KEY: 'sb_secret_demo',
  // Outside services are "configured" so every flow runs; their calls are answered by services.mjs.
  HOSTAWAY_ACCOUNT_ID: 'demo', HOSTAWAY_API_KEY: 'demo', HOSTAWAY_SYNC_ENABLED: 'true', HOSTAWAY_REPLIES_ENABLED: 'true',
  NOTIFICATION_EMAIL_ENABLED: 'true', RESEND_API_KEY: 'demo', NOTIFICATION_FROM_EMAIL: 'hello@recharge.example',
  NOTIFICATION_PUSH_ENABLED: 'true', EXPO_ACCESS_TOKEN: 'demo',
};
globalThis.__devstack = { env: ENV };
