# Recharge design alignment

The latest supplied asset, Refined Recharge logo with slim emblem.png, is the
company logo. The original file is bundled unchanged; layout clips its outer
margins without redrawing the emblem, lettering or final dot.

The main light background is bone #EFE9DB, sampled from the supplied artwork.
Dark green #1F3D38 is used for lettering and actions. Cards use a lighter bone
surface #FAF7F0. Status and department accents remain small and semantic.
The latest palette supersedes the previous blue Today hero; its gradient now
uses dark green. Both themes use locally bundled Montserrat 400/500/600/700.

The public web preview at / and the phone studio at /studio now render the
same responsive Expo component bundle. Desktop uses a sidebar and wider grids;
phone uses the existing bottom navigation. The original detailed DOM portal is
retained at /legacy-preview during backend integration, rather than discarding
its tool implementations. This routing change applies to the readonly preview.

Tasks by status uses a proportional donut and labelled status rows with counts,
percentages and comparison bars. Selecting a row highlights its arc without
changing the report totals or exported data. Empty periods have zero counts and
an empty ring. Unavailable data retains its existing message. Native and DOM
charts share statusBreakdown geometry, calculated from the Reports snapshot.

Authentication, access grants, report export permissions and readonly preview
restrictions are unchanged. Backend integration and native store builds are
separate from publication of this web preview.

Verification: root and mobile TypeScript, scoped ESLint, production build and
preview build passed. All 40 selected analytics, preview-security, design and
mobile-workspace checks passed. Browser checks covered desktop and phone
layouts, both themes, title-only search, status highlighting and date selection.
Original and bundled logo SHA-256 hashes match. Screenshots are saved locally
under .audit/design-alignment (not included in the source commit).
