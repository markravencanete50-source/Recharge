# Recharge frontend upgrade, Phase 3

The user approved all remaining phases. Phase 3 completes the supplied presentation upgrade without changing the 37-feature registry, seven roles, access mapping, destinations, data fetching or sample records.

## Added interactions

Quick search opens from the header or Control/Command K on the website. It searches feature titles only, highlights matching words, groups results by department and includes the existing Reports, Calendar, Inbox and Profile shortcuts in the mobile workspace. It receives the current user's permitted catalog. Arrow keys choose a result, Enter opens its existing destination, Escape closes and keyboard focus stays within the dialog. The desktop portal uses its existing card actions and existing workflow destinations.

Saved tools now follow the user's saved order. A grip supports horizontal dragging, while separate Earlier and Later buttons provide a keyboard and touch alternative. Dragging does not take over ordinary card taps or horizontal scrolling. Unknown, duplicated and no-longer-permitted saved keys are filtered out. Preview preferences remain session-only and have no arbitrary pin limit.

The Today summary tilts at most 1.5 degrees in each direction on a browser with a fine mouse pointer. It returns to rest on pointer exit and is disabled by Reduce motion. Touch and native devices retain the normal card. This avoids conflicting with phone scrolling or requiring sensor permissions.

Property placeholders use a small isometric architectural glyph built from flat polygons, shared across the website and mobile app. It uses the existing Stays and Clients accent tokens. The unique 37 feature icons and five department icons remain unchanged.

## Reversible decisions

No runtime dependencies or new colour tokens were added. Motion continues to use transform and opacity. The Phase 1 contrast corrections remain documented in that phase's notes; this phase changes no contrast pairs. The existing script's front-facing building placeholder becomes an isometric flat glyph. Mouse tilt is limited to the Today summary rather than every card. Dragging has no automatic edge scrolling; the row can be scrolled between moves, and Earlier/Later buttons work for any saved position. Hardware tilt is intentionally omitted. No new backend success states, permission changes or authentication workflows were introduced.

## Verification

Website and mobile TypeScript checks, Expo lint, the production preview build and targeted ESLint pass, apart from three existing portal warnings. The relevant pin-order, analytics, contrast/icon, mobile, preview-security and access suites pass 41 tests. Whole-repository lint/test limitations from Phase 2 remain unchanged and are not described as passing here.

Browser checks cover title-only results, keyboard opening and navigation, both themes at 375, 768 and 1440 pixels, truthful results for all seven roles, dragging and opening the same card afterwards, accessible reorder buttons, reduced-motion suppression and bounded mouse tilt. The 100-tool harness verifies saved ordering beyond the visible row, title search and empty results. The checked 375-pixel light Tools screen has no automated visual-lint findings. Screenshots are preserved in `.audit/phase3-review` and a local gallery at `http://127.0.0.1:4174/phase3-gallery/index.html`.

A refreshed iOS simulator build succeeded in the existing Expo project: `d3b3a3fa-2b2d-4670-879a-6d509c38479b`. Expo's build page confirms the simulator artifact is ready. Its download is blocked in Chrome and the command-line download connection is reset, so the new binary could not be uploaded to Appetize from this laptop. The existing Appetize build remains unchanged and no simulator session was started. Browser testing is not presented as an actual iOS simulator run. Physical-device and full screen-reader testing remain outside the verified results.

The presentation changes were pushed to `codex/cloudflare-preview` in commit `d79a4de`. The public studio preview was reloaded and its new quick-search button and title-only Routine results were verified after deployment.
