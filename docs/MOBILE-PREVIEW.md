# Mobile preview

Open the public product preview with `?view=phone` to view Recharge inside an interactive phone frame. The normal product preview includes a Mobile preview link.

The iPhone setting uses a 390 by 720 CSS-pixel app viewport. Android uses 412 by 740. Fit scales the frame to the available space while preserving the app's mobile viewport. The 100% setting shows the original dimensions with scrolling when necessary. These are representative browser sizes, not native device emulators.

The embedded app uses the same Recharge components and synthetic fixtures as the desktop product preview. Role selection reloads the embedded app with a whitelisted preview role. Theme changes synchronize between the two documents through the existing theme preference. Reload resets the selected role's app navigation. The role selector is a design-review control, not an authentication or authorization mechanism.

All existing preview restrictions still apply: sample data only, no connected production credentials, mutations disabled, live authentication routes unavailable. This page is part of the standalone Vite preview and does not alter the authenticated production application's routing or permissions.

Verified on desktop and a 390-pixel outer browser viewport: phone sizing, role switching, mobile menu navigation, cleaner analytics, custom date selection, reload, and light/dark theme synchronization. Existing preview security tests cover read-only requests and blocked authentication/integration endpoints.
