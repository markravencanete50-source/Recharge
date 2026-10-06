# Recharge frontend upgrade, Phase 2 review

Phase 2 applies the supplied prompt to motion, Reports, Work, Properties and the desktop shell. It preserves the 37-feature registry, seven roles, destinations, permission checks, source fetching and sample records. Preview changes remain read-only.

## Presentation changes

Reports has a plain-language headline, four summary tiles, comparisons with the preceding equal-length calendar period, direct first/peak/latest labels, a labelled status donut, sorted queue bars and a Chart or Table switch. The accessible table and CSV use the existing analytics engine and the same records and dates. Unavailable sources display a dash. Source limits and overlapping queues are explained. Comparisons describe records in the available snapshot, not unrecorded historical business performance.

Today adds the seven-day source-based sparkline and its calculated change. Its completion ring is centred correctly and numbers reveal once per role and session. Work has a sticky search/filter area that compacts on scroll, a week strip, a month calendar with recorded-work dots and distinct selected/today states. The week and month selections share moving highlight pills. Property cards use the existing verified status and flat architectural fallback. Desktop uses a grid and mobile a list; full property records and permitted tools remain reachable. The original desktop property database also provides a directory/record switch. Existing weekly property performance displays a thin occupancy bar calculated from recorded bookings.

The desktop shell is 240 pixels wide, uses a moving active indicator, has collapsible department shortcuts and gains a header shadow on scroll. Table headings stick, figures use tabular numerals and row hover remains subtle. Active navigation symbols fill and settle with a small spring. Profile, report-date and tool-detail sheets enter from below on phones and centre on wider screens. Offline messaging is triggered by the browser connection state. Existing field errors, recovery actions and form values remain intact.

Motion uses the installed Animated API, opacity and transforms. Interface transitions are about 200 milliseconds, reveals at most 550 milliseconds and sections stagger by 55 milliseconds. Initial reveals do not replay on ordinary filters or revisits. Both the operating-system preference and the saved Reduce motion setting suppress decoration. No runtime dependencies were added.

## Tokens, fonts and reversible differences

Colour and contrast tokens from Phase 1 are unchanged. The report eyebrow now uses the existing readable muted-text token rather than the legacy low-contrast colour, and desktop sidebar category labels are at least 11 pixels. The website resolves the `--font-inter` family to locally hosted Inter regular, medium, semibold and bold, instead of a missing or inconsistent preview typeface. The four font assets total about 1.37 MB uncompressed; their SIL Open Font License is included. Native chart labels explicitly use the existing Inter family and larger sizes. Charts retain names and values independently of colour, with dashed callouts for additional distinction.

The prompt asks for both stroke-drawing reveals and transform/opacity-only animation. This phase follows the latter: the ring reveals with opacity and rotation, and charts with opacity and a short rise. Arc proportions and chart values are static final geometry during the reveal. This avoids animating SVG dash offsets. Direct status labels use leader lines ordered by segment position to keep them clear of the centre total. The earlier chart-detail sheet is superseded by the always-available Table presentation. Photos are omitted where the source does not supply verified photos. Occupancy appears only in the existing booking-backed performance view, not invented for the native sample cards. Optional grain remains omitted.

The 37 feature and five department glyphs from Phase 1 are unchanged. Active navigation adds filled versions from the same flat geometry. No decorative 3D assets are reintroduced.

## Verification and limits

Production preview build, website TypeScript check, mobile TypeScript check and Expo lint pass. The changed report/shell components pass targeted ESLint with three existing portal warnings. The existing client-workspace file still has two React Compiler lint errors in its unchanged memoization/loading logic; the occupancy addition is presentation only. A whole-suite run also encounters the existing edge-runtime HTML test setup and an obsolete test expecting 3D artwork. The relevant analytics, access, mobile, icon/contrast and preview-security suites pass 37 tests, including three new source/comparison regressions.

Browser checks covered phone scrolling to the final item and opening a record afterwards, sticky Work search, date selection, property record navigation, Chart/Table switching, CSV initiation, persisted reduced motion, keyboard activation, no horizontal overflow and light/dark layouts at 375, 768 and 1440 pixels. All seven preview roles show their own analytics; only admin and super admin expose exports and administrative access. Deuteranopia and protanopia render checks retain direct words and values. Automated visual lint reported no findings on the checked 375-pixel light Reports and Work screens.

CSV reconciliation and authorization are tested. The in-app browser displayed the download-started result, but did not expose a completed download event. Native sources compile; a refreshed iOS simulator binary, physical-device testing and a full screen-reader audit are not completed in this phase.

## Review boundary

The supplied prompt says to stop after each phase for review. Phase 2 is ready for review. Phase 3 still requires approval: command palette, drag-to-reorder pins, parallax and an optional isometric building glyph. No authentication, authorization, database schema, access grants, integrations or billing were changed.
