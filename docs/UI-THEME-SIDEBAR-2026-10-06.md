# Header themes and desktop sidebar — 6 October 2026

Latest client direction supersedes the earlier green-header-in-both-themes choice.
Light mode uses the supplied light logo on bone `#EFE9DB`; dark mode uses the
supplied dark logo on green `#1B3E38`. Both original logo files remain unchanged.
Header text, controls, borders and avatar initials use matching theme tokens.
The responsive Expo preview, native components, live web header and legacy portal
share the updated palette/logo selection.

The desktop hide button is inside the sidebar's branding row. Hiding navigation
leaves a 64px left rail containing its restore button and widens the content area.
Neither button is beside the Home heading. Mobile has no desktop sidebar control.

Verification:

- Root/mobile TypeScript and mobile lint passed; scoped root lint has no errors
  (two existing unused-component warnings in the legacy portal).
- Four existing design/contrast regression checks passed.
- Production Worker and combined responsive preview builds passed.
- Browser checks verified light/dark logo selection, header colours, sidebar
  hide/restore placement and expanded content width.
- Desktop and 390px mobile screenshots were captured in both themes.
- At 320px, mobile has no horizontal overflow. Measured header control/initials
  contrast is 11.01:1 in light mode and 13.75:1 in dark mode.
- Shared visual-lint DOM checks, scoped to changed headers/sidebar branding,
  returned no findings in either theme; no preview console errors were recorded.

Ignored evidence: `outputs/theme-sidebar-2026-10-06/` (screenshots and audit JSON).
Browser checks validate the responsive web bundle; no new native iOS binary or
physical-device acceptance is claimed.
