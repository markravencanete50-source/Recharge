# Recharge design alignment

The latest supplied asset, Refined Recharge logo with slim emblem.png, is the
company logo. The original file is bundled unchanged; layout clips its outer
margins without redrawing the emblem, lettering or final dot.

The main light background is bone #EFE9DB, sampled from the supplied artwork.
Dark green #1F3D38 is used for lettering and actions. Cards use a lighter bone
surface #FAF7F0. Status and department accents remain small and semantic.
The latest palette supersedes the previous blue Today hero. Home analytics use
bone surfaces and green text/strokes in light mode, then dark green surfaces
and bone text/mint strokes in dark mode. The graph, ring, change chip and status
tiles all change with the theme. Both themes use locally bundled Montserrat
400/500/600/700.

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

## Client feedback, 6 October 2026

The supplied feedback video was transcribed locally with the cached Whisper
model. Its design requests are one Recharge logo on desktop and contrasting
green/bone colours when switching themes. Desktop now keeps the company logo
in the sidebar and shows the current section name in the toolbar. Phone keeps
its single toolbar logo. Navigation, counts and tap destinations are unchanged.

Root/mobile typechecks, scoped lint, production and preview builds passed.
Five Home analytics/contrast tests and two backend deployment boundary tests
passed. Local desktop and phone checks confirmed both themes and navigation.
The live backend asset allowlist now includes the supplied dark-mode logo in
source; publication of that Worker is tracked in WORKFLOW-ACTIVATION.md.
The Pages release is published and the prepared backend is now deployed. Its
cloud release checks passed, including exact hashes of both logo variants.

## Header contrast correction, 6 October 2026

Reviewing one visual frame from every second of the complete 55-second client
video showed that the light page needs a contrasting green top bar. Both
themes now use the supplied dark logo's green (#1B3E38) for the toolbar and
desktop sidebar brand strip, with bone lettering (#EFE9DB). Light page content
remains bone; dark page content remains dark green. Header controls use
#182C26 with #FAF7F0 icons. The logo variant is selected for the header surface,
independently of the page theme, in responsive, native and live web headers.
Desktop retains one logo, in the sidebar; phone retains one toolbar logo.

The control border was adjusted from #697A6D to #79998C in both themes:
contrast against the header improved from 2.57:1 to 3.76:1. Bone header text
has 9.68:1 contrast and control icons have 13.75:1 against their surface.
Root/mobile TypeScript, scoped lint (no errors), nine design/analytics checks,
production build and preview export passed. Desktop and 390px phone screenshots
confirmed both themes, one logo and no horizontal overflow; quick search opened.

## Desktop panel visibility, 6 October 2026

A toolbar sidebar button hides and reopens the entire 240px left panel.
It announces its expanded state and supports keyboard activation. While hidden,
the single company logo moves to the toolbar and the workspace gains the freed
width. The choice remains during section and theme changes in the current
session. Phone layouts retain their existing bottom navigation.
Root/mobile TypeScript, scoped lint and preview export passed. Browser checks
confirmed hide/reopen, keyboard activation, Reports navigation while hidden,
both themes, one logo and no overflow at desktop and 390px phone widths.
