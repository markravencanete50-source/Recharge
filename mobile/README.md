# Recharge mobile app

This is the Recharge native React Native and Expo SDK 57 app, with Expo Router navigation. The preferred Windows preview is an iOS simulator hosted by Appetize. It does not embed the website or a WebView. The local Android emulator boots, but its Expo Go connection has not been verified.

## Build profiles

The app is Recharge (com.rechargegroup.app on iOS and Android). Its Expo project keeps the EAS slug `recharge-mobile-preview`. The slug is tied to the EAS project id, so do not change it, even though the app is no longer only a preview.

eas.json has three build profiles:

- `production` makes store builds. It points at https://app.rechargegroup.co.uk with RECHARGE_LIVE_ONLY=1.
- `pilot` makes internal device test builds against the same live site, with RECHARGE_LIVE_ONLY=1.
- `preview-ios` makes the sample-data iOS Simulator build described below.

## Preferred iOS preview on Windows

The user chose a cloud iPhone simulator. Sign in to Expo and Appetize. The preview-ios profile in eas.json creates a sample-data standalone iOS Simulator app with its JavaScript bundled, without needing a local Metro connection, TestFlight or Apple Developer membership. Run `npx eas-cli@latest build --platform ios --profile preview-ios` from this folder. Download its simulator .app archive and upload it to Appetize as a compressed .app bundle. An IPA store build is not accepted by Appetize. Select an iPhone and open its live stream in a separate browser window. Keep live account configuration disabled until the backend is configured and audited.

The first standalone EAS iOS Simulator build was uploaded to Appetize and ran successfully on an iPhone 14 Pro with iOS 17.2. Home, tools, native search, tool sheets, analytics and theme switching were exercised in the live native app. Each updated binary needs its own runtime check. The current free account limits each simulator session to three minutes; restart a session when its timer expires. Confirm the remaining account allowance before extended testing.

## Run on this Windows laptop

For a free browser view of the latest mobile UI, run `npx expo export --platform web --output-dir dist-web` from this folder and serve dist-web with a local static server that supports single-page routing. Open `/studio.html` for the floating phone view or `/home` for the full app. This uses the mobile components rendered for web and requires no Appetize minutes. It is a browser preview, not an iOS runtime.

The October polish update adds recognizable department tiles, a grouped feature grid, clearer work status chips, readable report labels and admin-only CSV report downloads. Native exports open the system share sheet; browser exports download a file. All preview exports are clearly marked as sample data. Live report downloads use the server authorization endpoint described in ../docs/ANALYTICS.md.

Run `scripts/start-mobile-preview.ps1` from the repository root. Android tools are installed in the current user's Android SDK directory. The launcher opens the emulator visibly, binds Metro to the local computer and opens the project in Expo Go. The first cold boot can take a few minutes. The development server must remain running while reviewing the app.

For another development machine, install Android SDK tools and a compatible emulator, then run `npm ci` in this folder followed by `npx expo start --android`. Node 22.13 or newer is required. The iOS bundle can be exported on Windows; an iOS simulator requires a Mac. This is not a signed store build.

## Available screens

Role-specific five-tab navigation, actionable Home, work lists and calendars, property detail screens, Inbox, approvals, searchable workspace tools with individual artwork, read-only tool and record sheets, light and dark themes, seven sample role views, and role-scoped analytics with native calendar dates, line, donut and bar charts. Tool search matches feature titles only, ignores capitalization and trims surrounding whitespace. Descriptions and category labels are excluded. Analytics reuse the existing tested calculation and access-scoping functions. Preview roles never grant live permissions. Detailed editing screens for every workflow remain part of the mobile implementation.

The interactive mobile workspace adds department filters, bookmarks, a saved-tools view, clearable title-only search, searchable record lists and status filters. Saved tools are stored on the device separately for each preview role. Analytics supports selecting individual days and status shares. Touch controls, cards, navigation, chart bars and onboarding steps use short animations that respect the device's Reduce Motion setting. Sheets support backdrop dismissal, a drag handle, keyboard avoidance and scrolling within the available screen height.

Profile settings include custom names and six monogram avatar styles. Preview customization is local to the running app and creates no account. Uploaded profile photographs are not implemented yet.

## Real account onboarding

The source includes email OR international phone registration, a password of at least 12 characters, contact verification, then a profile name and avatar. Contacts are verified before a profile is saved. Passwords are cleared after submitting registration and are never persisted. The short-lived profile bearer token stays only in memory and is discarded after completing or closing setup. It is never treated as a workspace authorization grant.

Live registration is disabled until the full backend is securely deployed. The static Cloudflare Pages sample preview has no account API. Do not point the mobile app at that preview expecting accounts to work.

Activation prerequisites:

1. Deploy the full server and its existing durable security migrations, with SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, AUTH_RATE_LIMIT_SECRET and APP_ORIGIN. Privileged secrets stay on the server.
2. Set MOBILE_REGISTRATION_ENABLED=true only after email confirmation and email delivery are configured. The Supabase confirmation email template must show the OTP using its Token template variable. Do not disable contact confirmation.
3. Configure a Supabase-supported SMS provider and phone confirmation before enabling MOBILE_PHONE_REGISTRATION_ENABLED=true. SMS provider charges are separate.
4. Set EXPO_PUBLIC_ACCOUNT_API_URL in the mobile environment to the full backend HTTPS origin, without a path. This public URL contains no secret. Rebuild or restart Metro after changing it.
5. Approve workspace access separately. User-editable display_name and avatar_preset metadata are cosmetic and must never drive authorization. Existing workspace grants currently use verified email identities; phone-only workspace provisioning by user UUID still needs implementation before phone users can access live business records.

The onboarding API rejects extra fields such as user IDs, roles, module lists or arbitrary avatar URLs. It uses the existing durable IP/contact quotas, bounded bodies, origin checks and no-store security headers. It fails closed when security or provider configuration is unavailable. The five-password-attempt and 24-hour lockout remains in the existing sign-in gateway; onboarding does not activate a workspace session or clear that lockout.

## Verification

On 4 October 2026, the interactive preview was checked in Appetize on iPhone 14 Pro, iOS 17.2. Verified bookmarks, saved filtering, title-only search, one-tap clearing, swipe and backdrop dismissal, calendar scrolling and custom-date recalculation, daily chart selection, status-share selection and dark-mode charts. The final simulator binary was built from commit f83fb78, EAS build b8fb6a48-ed2f-4aa1-9adb-ceddd8f1dbd0. Android bundling passed; Android runtime and live registration were not exercised in this pass. Screenshot evidence and the detailed verification report are stored locally under .audit.

Run `npx tsc --noEmit` here. Run repository ESLint against mobile sources. `npx expo export --platform android` and `--platform ios` check both bundles. Server security regression tests include `tests/registration.test.mjs`. Exporting iOS validates bundling, not behavior on an iPhone.

The SDK toolchain currently reports transitive dependency advisories. Do not force an Expo downgrade to satisfy npm audit. Keep the local development server bound to loopback and resolve remaining advisories before producing a release build.

The approved redesign and cleaner/cleaning-manager separation are documented in ../docs/MOBILE-REDESIGN-IMPLEMENTATION.md. The live workspace will start empty; synthetic preview data must not be imported.
