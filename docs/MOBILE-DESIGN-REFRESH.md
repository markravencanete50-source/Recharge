# Recharge mobile design refresh

Approved direction: a new format, typography, colours and interaction design, retaining the existing feature inventory and access rules.

## Visual system

Blue, white and graphite replace the green mobile theme. Teal, lavender, coral and warm yellow distinguish departments. Both light and dark palettes define separate readable text, icon and surface colours. Inter regular, medium, semibold and bold are bundled locally; system text remains available if loading fails.

Every one of the 37 features has a distinct Feather vector symbol. Mobile screens no longer render the previous 3D PNG illustrations. Small property illustrations use vector architecture rather than fabricated property photos.

## Screen structure

The overview starts with role-specific work or approvals, real sample completion counts, waiting items and accessible properties. A selectable weekly schedule, department shortcuts and an attention queue lead to existing destinations. Days have a minimum 44-point width and scroll on narrow screens.

The workspace uses a full-width department directory and a grouped feature list. Titles wrap without truncation. Feature search still matches titles only. Bookmarks and the saved-only filter retain their existing persistence and role separation.

Work retains status filtering, title search and monthly calendar views. Property details retain their tool and work destinations. Reports retain custom dates, daily inspection, status inspection, source totals, tabular data and CSV export for admins and super admins. The browser preview now has a working custom date calendar; native platforms retain their native picker.

## Motion

Navigation uses a sliding selected indicator. Filters animate their selected background and keep externally selected departments visible. Touch controls use short press feedback. Screens and filtered schedules enter gently. The progress ring, activity line reveal, bar widths and successful profile confirmation use actual values or completed actions. Reduced-motion preferences suppress movement.

## Scope and validation

This release changes the mobile application and its hosted browser studio. The preview remains read-only and uses fictional data. Unconnected native business editing screens and live registration remain pending backend activation. No Supabase access rules, real user grants, credentials or production records change in this release.

Verification includes mobile TypeScript and Expo lint, the combined hosted-preview build, the existing mobile workspace, analytics and preview security suites, browser workflows for feature search, bookmarks, job filters, property navigation and custom dates, CSV reconciliation, and light/dark screenshots at phone and desktop sizes. Visual checks use the rendered SVG fill for graph text contrast.
