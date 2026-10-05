# Schedule and reports revision

5 October 2026. Targeted changes to the existing Today and Reports screens. The 37 feature destinations, seven roles, permissions, authentication and application stack are preserved. No dependencies were added.

The schedule is a Monday-to-Sunday grid with responsive 4, 6 and 8 pixel gaps, a 520 pixel desktop cap, 72 pixel high buttons, previous/next week controls, conditional Today link and the existing full-calendar destination. Its sliding selection uses the existing primary-blue hero token with white text in both themes. This preserves white-text contrast; the dark theme's pale primary token would fail with white text. Today when unselected has the requested primary ring. Reduced motion changes the selection immediately. Empty days have the requested wording and only the existing role-permitted work action.

Reports, table and CSV use the existing buildAnalytics function for all counts. Daily recorded, completed and waiting counts are derived there. Unknown normalized statuses appear as Other and all status counts reconcile. Properties carry availability separately so missing values show a dash. Charts and comparisons use the selected inclusive date range and the immediately preceding equal-length range. Periods longer than 31 days aggregate chart points into seven-day buckets without changing totals. Sparse metric series show Not enough days to chart. The table and CSV retain daily detail.

Workflows and Maintenance use primary blue because they cross departments. Cleans uses its amber department colour. Client Onboarding and Mailbox use the Clients colour. Properties uses the neutral primary-soft tile, not violet. Completed and Waiting retain their existing status meanings and tokens.

## Evidence

Screenshots and browser measurements are in `.audit/schedule-report-review`; the review gallery is `index.html`. Light and dark screenshots cover 320, 360, 375, 390 and 430 pixels, with desktop captures and deuteranopia/protanopia simulations. The public preview remains sample data, not production records.

Actual narrowest day tap widths: 38.5 at 320, 44.2 at 360, 46.4 at 375, 48.6 at 390 and 54.3 at 430 pixels. The visible Windows scrollbar consumes approximately 10 pixels, so 320 is slightly below the requested approximate 40 pixels. Sunday is fully visible in every capture. The grid has no horizontal scroll control; extended hit areas deliberately cover the gaps.

Text, direct graph labels, solid graph lines, status fills and bar tracks pass the AA/3:1 token checks in both themes. Statuses retain symbols and words in both colour-vision simulations, and the completed line is dashed as well as green. The requested 12 percent area fills cannot reach 3:1 against their card backgrounds. They remain decorative, with high-contrast lines and labels carrying the information.

Preview build, root/mobile TypeScript, changed-file ESLint and Expo lint pass. The focused regression suite covers analytics/CSV/date arithmetic, all feature destinations, role scoping, pins, read-only preview security and PostgreSQL access/RLS/revocation. Visual lint reports zero findings at 320 light and 375 dark. Week navigation, Sunday selection, table switching and immediate reduced-motion selection were checked through browser controls. This revision was verified as an Expo web preview; a new native iOS simulator build was not part of this change.
