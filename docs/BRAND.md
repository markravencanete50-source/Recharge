# Recharge brand: the logo

**Use only the final logo (Lee, 15 October 2026).** It is the thin-line logo: a bed with a charging battery inside
a circle, beside "RECHARGE." The originals as supplied are `docs/brand-logo-on-cream.jpg` and
`docs/brand-logo-on-forest.jpg`. Never use the earlier bold logo, the old bold favicon, Expo's placeholder icons,
or a redrawn or recoloured version of the logo.

The files made from it (the line art is unchanged; only the background is set to the app's exact colours, so the
logo sits flush on the headers):

| Where | File |
| --- | --- |
| App headers, sign-in, guest inbox badge | `mobile/assets/brand/recharge-logo-light.png` (on cream `#EFE9DB`), `recharge-logo-dark.png` (on forest `#1B3E38`), through `CompanyLogo` |
| Website and server copies | `public/recharge-company-logo.png`, `public/recharge-company-logo-dark.png` |
| Email signature | `public/recharge-email-logo.png` (`lib/email-brand.ts`) |
| Browser tab | `public/favicon.svg`, `mobile/assets/favicon.png` |
| Logo on a dark background | `public/recharge-wordmark.svg` (cream line art, transparent), `public/recharge-logo.svg` (on forest) |
| Phone app icon and splash | `mobile/assets/icon.png`, `android-icon-*.png`, `splash-icon.png`, `splash-icon-dark.png` (`mobile/app.json`) |

New screens, emails, documents and exports use these files (in the app, `CompanyLogo`). If a size or colour is
missing, make it from the originals above in the same way and add it to this table. `tests/brand-logo.test.mjs`
fails if the old logo or the placeholder icons come back.
