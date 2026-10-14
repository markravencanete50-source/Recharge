// One source for CSS variables on the web and resolved colours on iOS/Android.
// Dominant background sampled from the supplied company logo, RGB 239/233/219.
export const brandCanvas = "#EFE9DB";
// Dominant dark background sampled from the supplied alternate logo, RGB 27/62/56.
export const darkBrandCanvas = "#1B3E38";
export const designTokens = {
  light: {
    background: brandCanvas,
    surface: "#FCFAF5",
    elevated: "#E3DBCA",
    text: "#152D28",
    muted: "#4E6259",
    // A hairline: cards stand off the canvas by soft depth (depthTokens), so outlines stay quiet.
    border: "#D2CAB8",
    controlBorder: "#697A6D",
    primary: "#1F3D38",
    bright: "#315F50",
    onPrimary: "#FAF7F0",
    wash: "#E0E7D9",
    accent: "#1F3D38",
    // Client preference: green branding contrasts with the bone light canvas.
    header: darkBrandCanvas,
    headerText: "#FFFFFF",
    headerMuted: "#EFE9DB",
    headerControl: "#182C26",
    headerControlText: "#FFFFFF",
    headerBorder: "#79998C",
    chart: "#2F6F63",
    waiting: "#8A5010",
    success: "#136D3A",
    danger: "#A63A32",
    utilityArt: "#F1E8FF",
    utilityInk: "#7A3FD4",
    utilityAccent: "#7A3FD4",
    // Text or a tick on a solid success fill.
    onSuccess: "#FFFFFF",
    successWash: "#E1F5E8",
    cautionWash: "#FFF0D6",
    dangerWash: "#F6DEDA",
    // The unread count sits on the header in both themes, so it keeps one strong red.
    badge: "#A63A32",
    onBadge: "#FFFFFF",
    hero: "#1F3D38",
    // Flat: the Home panel is one solid forest, so the end colour is the start colour.
    heroEnd: "#1F3D38",
    heroGlow: "#A7D9C1",
    heroText: "#FFFFFF",
    heroMuted: "#FFFFFF",
    heroLine: "#A7D9C1",
    overlay: "#070D2280",
    shadow: "#152D2812",
    // States. disabled: the label of a control that can't be used yet. primaryHover: the primary
    // fill under the pointer. washBorder: the outline of a secondary (wash) button. selected,
    // onSelected and selectedBorder: a chosen pill, tab or option, quieter than a primary button in
    // dark mode so a row of pills doesn't read as a row of actions. hover: a row or option under the pointer.
    disabled: "#647169",
    primaryHover: "#315F50",
    washBorder: "#C9D5C4",
    selected: "#1F3D38",
    onSelected: "#FAF7F0",
    selectedBorder: "#1F3D38",
    hover: "#EEE8DA",
  },
  dark: {
    // A clear scale, darkest to lightest: page, card, raised (inputs, popovers, table heads), then the
    // hairline and the control outline. Each step is visibly lighter than the one under it, so cards stand
    // off the page without leaning on shadows (which barely show on a dark page).
    background: "#0B1714",
    surface: "#1A322B",
    elevated: "#25453D",
    text: "#F5F1E8",
    muted: "#BFC9C2",
    // Separators and card outlines: quiet, but visible against both the page and a card.
    border: "#41655A",
    // Outlines that mark a control (fields, outlined buttons, unselected pills): 3:1 against every surface.
    controlBorder: "#8AAC9E",
    // The brand mint: the one solid action colour, and links and icons on dark surfaces.
    primary: "#A7D9C1",
    bright: "#A7D9C1",
    onPrimary: "#10302A",
    wash: "#2A594A",
    accent: "#A7D9C1",
    // Client direction: dark mode reverses the light bar, bone with forest lettering, so the
    // two themes mirror each other and the bone logo artwork sits flush on it.
    header: brandCanvas,
    headerText: "#1B3E38",
    headerMuted: "#4E6259",
    headerControl: "#E3DAC6",
    headerControlText: "#1B3E38",
    headerBorder: "#697A6D",
    chart: "#8FD3C2",
    waiting: "#EBC687",
    success: "#8ADBA0",
    danger: "#F2B3AA",
    utilityArt: "#2A1F4A",
    utilityInk: "#C9AAFF",
    utilityAccent: "#C9AAFF",
    onSuccess: "#0B1714",
    successWash: "#16392A",
    cautionWash: "#3D2E14",
    dangerWash: "#45241F",
    badge: "#A63A32",
    onBadge: "#FFFFFF",
    hero: "#1F3D38",
    // Flat: the Home panel is one solid forest, so the end colour is the start colour.
    heroEnd: "#1F3D38",
    heroGlow: "#A7D9C1",
    heroText: "#FFFFFF",
    heroMuted: "#FFFFFF",
    heroLine: "#A7D9C1",
    overlay: "#03080799",
    shadow: "#00000000",
    // States (see the light theme for what each is for).
    disabled: "#8E9F97",
    primaryHover: "#C1E6D5",
    washBorder: "#5A8F7C",
    selected: "#356C5A",
    onSelected: "#F5F1E8",
    selectedBorder: "#A7D9C1",
    hover: "#223E35",
  },
};
// Depth for the web: layered soft shadows (elev-1 resting cards, elev-2 raised and hovered,
// elev-3 floating sheets and menus). The calm style pass retired the decorative layers: the sheen
// stays only as an empty shadow ("0 0 #0000") because it sits in comma lists with the elevations,
// and glow, spot, shimmer and the two canvas pools are transparent.
// iOS and Android use the matching shadow props in mobile/src/theme.ts (depth).
const clear = "rgba(0,0,0,0)";
export const depthTokens = {
  light: {
    "elev-1": "0 1px 1px rgba(21,45,40,.04),0 2px 6px -2px rgba(21,45,40,.06),0 18px 32px -22px rgba(21,45,40,.28)",
    "elev-2": "0 1px 2px rgba(21,45,40,.05),0 12px 24px -10px rgba(21,45,40,.14),0 34px 60px -30px rgba(21,45,40,.36)",
    "elev-3": "0 2px 6px rgba(21,45,40,.08),0 32px 90px -28px rgba(12,30,26,.5)",
    sheen: "0 0 #0000",
    glow: clear,
    spot: clear,
    shimmer: clear,
    "canvas-a": clear,
    "canvas-b": clear,
  },
  dark: {
    "elev-1": "0 1px 1px rgba(0,0,0,.22),0 18px 34px -22px rgba(0,0,0,.7)",
    "elev-2": "0 2px 4px rgba(0,0,0,.28),0 34px 60px -30px rgba(0,0,0,.8)",
    "elev-3": "0 2px 8px rgba(0,0,0,.35),0 32px 90px -28px rgba(0,0,0,.85)",
    sheen: "0 0 #0000",
    glow: clear,
    spot: clear,
    shimmer: clear,
    "canvas-a": clear,
    "canvas-b": clear,
  },
};
export const departmentTokens = {
  // One earthy family that sits with bone and forest: each department stays
  // distinguishable without leaving the brand palette.
  light: {
    stays: { ink: "#1F5F55", wash: "#DCEAE4" },
    ready: { ink: "#3F6A2A", wash: "#E4EDD8" },
    cleans: { ink: "#875A1C", wash: "#F3E7CF" },
    clients: { ink: "#3B5866", wash: "#DFE7E8" },
    accounts: { ink: "#8E3F38", wash: "#F2E1DB" },
  },
  dark: {
    stays: { ink: "#8FD3C2", wash: "#173A33" },
    ready: { ink: "#B7DA92", wash: "#22341A" },
    cleans: { ink: "#E8C27D", wash: "#3A2C15" },
    clients: { ink: "#A9C6D2", wash: "#1D2F36" },
    accounts: { ink: "#EDAAA1", wash: "#3A201D" },
  },
};
// The left panel's icon tiles: one hue for each kind of place, muted to sit with bone and forest
// (departments keep their own colours above).
export const navHueTokens = {
  light: {
    forest: { ink: "#1F5F55", wash: "#DCEAE4" }, ocean: { ink: "#2E5A86", wash: "#DFE6EF" }, plum: { ink: "#674A96", wash: "#E8E1F1" },
    amber: { ink: "#8F5D14", wash: "#F4E7CE" }, rose: { ink: "#A13F4C", wash: "#F3DFE0" }, sky: { ink: "#21708A", wash: "#D9EAEE" },
    sage: { ink: "#3F6A2A", wash: "#E3ECD7" }, slate: { ink: "#4E6259", wash: "#E5E2D8" },
  },
  dark: {
    forest: { ink: "#8FD3C2", wash: "#173A33" }, ocean: { ink: "#9CC3EA", wash: "#1B2E42" }, plum: { ink: "#C9B2F0", wash: "#2C2442" },
    amber: { ink: "#E8C27D", wash: "#3A2C15" }, rose: { ink: "#F0A8B2", wash: "#3D2126" }, sky: { ink: "#8FD0DD", wash: "#173540" },
    sage: { ink: "#B7DA92", wash: "#22341A" }, slate: { ink: "#C7CBBE", wash: "#2A332F" },
  },
};
export type NavHue = keyof typeof navHueTokens.light;
const variables = (mode: "light" | "dark") =>
  Object.entries(designTokens[mode])
    .map(([key, value]) => `--rc-${key}:${value};`)
    .join("") +
  Object.entries(depthTokens[mode])
    .map(([key, value]) => `--rc-${key}:${value};`)
    .join("") +
  Object.entries(departmentTokens[mode])
    .map(
      ([key, value]) =>
        `--rc-${key}-ink:${value.ink};--rc-${key}-wash:${value.wash};`,
    )
    .join("") +
  Object.entries(navHueTokens[mode])
    .map(([key, value]) => `--rc-hue-${key}-ink:${value.ink};--rc-hue-${key}-wash:${value.wash};`)
    .join("");
const aliases = `--background:var(--rc-background);--foreground:var(--rc-text);--card:var(--rc-surface);--card-foreground:var(--rc-text);--popover:var(--rc-elevated);--popover-foreground:var(--rc-text);--muted:var(--rc-elevated);--muted-foreground:var(--rc-muted);--border:var(--rc-border);--input:var(--rc-muted);--ring:var(--rc-primary);--primary:var(--rc-primary);--primary-foreground:var(--rc-onPrimary);--secondary:var(--rc-elevated);--secondary-foreground:var(--rc-text);--accent:var(--rc-wash);--accent-foreground:var(--rc-text);--chart-1:var(--rc-bright);--chart-2:var(--rc-chart);--chart-3:var(--rc-waiting);`;
// Reveal one opaque palette over the other instead of blending both screenshots.
const themeTransitionCss = `::view-transition-group(root){animation:none}::view-transition-image-pair(root){isolation:isolate}::view-transition-old(root){animation:none;opacity:1;mix-blend-mode:normal}::view-transition-new(root){animation:rc-theme-reveal 180ms ease-out;opacity:1;mix-blend-mode:normal}@keyframes rc-theme-reveal{from{clip-path:inset(0 0 100% 0)}to{clip-path:inset(0)}}@media(prefers-reduced-motion:reduce){::view-transition-new(root){animation:none}}[data-reduce-motion="true"]::view-transition-new(root){animation:none}`;
const headerCss = `:is([data-testid="workspace-toolbar"],[data-testid="sidebar-brand"],[data-testid="workspace-sidebar-collapsed"]),:is([data-testid="workspace-toolbar"],[data-testid="sidebar-brand"],[data-testid="workspace-sidebar-collapsed"]) *{color:var(--rc-headerText)}:is([data-testid="workspace-toolbar"],[data-testid="sidebar-brand"],[data-testid="workspace-sidebar-collapsed"]) [role="button"]:focus-visible{outline-color:var(--rc-headerText)}`;
// Web-only hover feedback (no icon turns, no tile lifts). `translate` composes with the inline `transform`
// that the press animation owns, so hover lift and press scale never fight.
const hoverCss = `[data-hover]{transition:background-color 260ms cubic-bezier(.16,1,.3,1),box-shadow 420ms cubic-bezier(.16,1,.3,1),translate 420ms cubic-bezier(.16,1,.3,1),border-color 260ms ease}@media(hover:hover) and (pointer:fine){[data-hover="tint"]:hover{background-color:var(--rc-hover)}[data-hover="primary"]:hover{background-color:var(--rc-primaryHover)!important}[data-hover="lift"]:hover{translate:0 -3px;box-shadow:0 22px 44px -22px rgba(21,45,40,.42);border-color:var(--rc-controlBorder)}}[data-reduce-motion="true"] [data-hover]{transition:none}[data-reduce-motion="true"] [data-hover="lift"]:hover{translate:none}@media(prefers-reduced-motion:reduce){[data-hover]{transition:none}[data-hover="lift"]:hover{translate:none}}::selection{background:var(--rc-primary);color:var(--rc-onPrimary)}@media(hover:hover) and (pointer:fine){:is([role="button"],[role="radio"],[role="link"],[role="checkbox"]):not([data-hover]):not([aria-disabled="true"]){transition:box-shadow 160ms ease}:is([role="button"],[role="radio"],[role="link"],[role="checkbox"]):not([data-hover]):not([aria-disabled="true"]):hover{box-shadow:inset 0 0 0 999px rgba(127,127,127,.07)}}[data-reduce-motion="true"] [role]{transition:none!important}html{-webkit-tap-highlight-color:transparent}input:-webkit-autofill,input:-webkit-autofill:hover,input:-webkit-autofill:focus,input:-webkit-autofill:active{-webkit-text-fill-color:var(--rc-text);caret-color:var(--rc-text);transition:background-color 600000s 0s,color 600000s 0s}input:autofill{background:transparent}@media(prefers-reduced-motion:no-preference){html:not([data-reduce-motion="true"]){scroll-behavior:smooth}}[data-overlay="blur"]{backdrop-filter:blur(14px) saturate(140%);-webkit-backdrop-filter:blur(14px) saturate(140%)}`;
// List rows that open something, and may hold their own buttons (the payout stays). On hover the whole row takes one quiet wash.
// On keyboard focus a bar runs down its leading edge and the row takes the same wash. They never get the 2px box that other
// pressables get, which read as a frame around a payout. "row" is the row or its wrapper; "rowhit" is the part of a row that
// opens it, inside a wrapper. The :has() rule stands alone so a browser without it ignores only that rule.
const rowWash = "background-color:var(--rc-hover)";
const rowCss = `@media(hover:hover) and (pointer:fine){[data-hover="row"]:hover{${rowWash}}}[data-hover="row"][role="button"]:focus-visible,[data-hover="rowhit"][role="button"]:focus-visible{outline:none;box-shadow:inset 3px 0 0 var(--rc-primary)}[data-hover="row"][role="button"]:focus-visible{${rowWash}}[data-hover="row"]:has([data-hover="rowhit"]:focus-visible){${rowWash}}`;
// The finishing layer on the web, kept calm: raised cards take the deeper shadow on hover, inputs and
// controls show focus, thin scrollbars. No spotlight, sheen sweep, shimmer or canvas light. A field
// whose frame shows focus itself (data-search-shell, data-bare-input) never gets the second box inside it.
const premiumCss = `@media(hover:hover) and (pointer:fine){[data-hover="lift"]:hover{box-shadow:var(--rc-elev-2),var(--rc-sheen)}}input:focus-visible,textarea:focus-visible{outline:2px solid var(--rc-primary)!important;outline-offset:1px;box-shadow:0 0 0 6px var(--rc-glow)!important}[role="button"]:focus-visible,[role="radio"]:focus-visible,[role="checkbox"]:focus-visible,[role="link"]:focus-visible{box-shadow:0 0 0 6px var(--rc-glow)}*{scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--rc-muted) 40%,transparent) transparent}`;
// Messages: a message's react button shows on hover (always, faintly, on touch screens).
const chatCss = `[data-chat-tools]{opacity:0;transition:opacity 160ms ease}[data-chat-row]:hover [data-chat-tools],[data-chat-tools]:focus-within{opacity:1}@media(hover:none){[data-chat-tools]{opacity:.75}}`;
export const designTokenCss = `${hoverCss}${rowCss}${premiumCss}${chatCss}:root:not(.dark):not([data-recharge-theme="dark"]),[data-recharge-theme="light"]{${variables("light")}${aliases}color-scheme:light}:root.dark:not([data-recharge-theme="light"]),[data-recharge-theme="dark"]{${variables("dark")}${aliases}color-scheme:dark}${themeTransitionCss}${headerCss}[data-testid="workspace-scroll"]{scrollbar-width:thin;scrollbar-color:var(--rc-muted) transparent}button:focus-visible,[role="button"]:focus-visible,[role="checkbox"]:focus-visible,[role="radio"]:focus-visible,[role="link"]:focus-visible,[role="tab"]:focus-visible,[role="switch"]:focus-visible,input:focus-visible{outline:2px solid var(--rc-primary);outline-offset:3px} [data-search-shell] :is(input,textarea):is(:focus,:focus-visible),[data-bare-input] :is(input,textarea):is(:focus,:focus-visible){outline:none!important;box-shadow:none!important}[data-search-shell]:focus-within{outline:none;border-color:var(--rc-primary)!important;box-shadow:inset 0 0 0 1px var(--rc-primary)} [data-tool-section="collapsed"]{content-visibility:auto;contain-intrinsic-size:auto 76px}`;
