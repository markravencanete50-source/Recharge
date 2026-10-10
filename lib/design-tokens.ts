// One source for CSS variables on the web and resolved colours on iOS/Android.
// Dominant background sampled from the supplied company logo, RGB 239/233/219.
export const brandCanvas = "#EFE9DB";
// Dominant dark background sampled from the supplied alternate logo, RGB 27/62/56.
export const darkBrandCanvas = "#1B3E38";
export const designTokens = {
  light: {
    background: brandCanvas,
    surface: "#FCFAF5",
    elevated: "#E7E0D0",
    text: "#152D28",
    muted: "#4E6259",
    // A hairline: cards stand off the canvas by soft depth (depthTokens), so outlines stay quiet.
    border: "#DCD5C5",
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
    waiting: "#9A5A12",
    success: "#177A41",
    danger: "#A63A32",
    utilityArt: "#F1E8FF",
    utilityInk: "#7A3FD4",
    utilityAccent: "#7A3FD4",
    successWash: "#E1F5E8",
    cautionWash: "#FFF0D6",
    dangerWash: "#F6DEDA",
    // The unread count sits on the header in both themes, so it keeps one strong red.
    badge: "#A63A32",
    onBadge: "#FFFFFF",
    hero: "#1F3D38",
    heroEnd: "#315F50",
    heroGlow: "#A7D9C1",
    heroText: "#FFFFFF",
    heroMuted: "#FFFFFF",
    heroLine: "#A7D9C1",
    overlay: "#070D2280",
    shadow: "#152D2812",
  },
  dark: {
    background: "#0F1E1A",
    surface: "#182C26",
    elevated: "#213A32",
    text: "#FAF7F0",
    muted: "#C7CBBE",
    border: "#2F4B41",
    controlBorder: "#79998C",
    primary: "#A7D9C1",
    bright: "#A7D9C1",
    onPrimary: "#1F3D38",
    wash: "#254538",
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
    waiting: "#E8C27D",
    success: "#86D99B",
    danger: "#EDAAA1",
    utilityArt: "#2A1F4A",
    utilityInk: "#C4A2FF",
    utilityAccent: "#C4A2FF",
    successWash: "#142E22",
    cautionWash: "#3A2A12",
    dangerWash: "#3A201D",
    badge: "#A63A32",
    onBadge: "#FFFFFF",
    hero: "#1F3D38",
    heroEnd: "#315F50",
    heroGlow: "#A7D9C1",
    heroText: "#FFFFFF",
    heroMuted: "#FFFFFF",
    heroLine: "#A7D9C1",
    overlay: "#070D22CC",
    shadow: "#00000000",
  },
};
// Depth for the web: layered soft shadows (elev-1 resting cards, elev-2 raised and hovered,
// elev-3 floating sheets and menus), a hairline highlight along each surface's top edge (sheen),
// the focus glow, the pointer spotlight on cards, and two light pools on the canvas.
// iOS and Android use the matching shadow props in mobile/src/theme.ts (depth).
export const depthTokens = {
  light: {
    "elev-1": "0 1px 1px rgba(21,45,40,.04),0 2px 6px -2px rgba(21,45,40,.06),0 18px 32px -22px rgba(21,45,40,.28)",
    "elev-2": "0 1px 2px rgba(21,45,40,.05),0 12px 24px -10px rgba(21,45,40,.14),0 34px 60px -30px rgba(21,45,40,.36)",
    "elev-3": "0 2px 6px rgba(21,45,40,.08),0 32px 90px -28px rgba(12,30,26,.5)",
    sheen: "inset 0 1px 0 rgba(255,255,255,.75)",
    glow: "rgba(122,196,163,.42)",
    spot: "rgba(167,217,193,.26)",
    shimmer: "rgba(255,255,255,.55)",
    "canvas-a": "rgba(167,217,193,.34)",
    "canvas-b": "rgba(255,255,255,.7)",
  },
  dark: {
    "elev-1": "0 1px 1px rgba(0,0,0,.22),0 18px 34px -22px rgba(0,0,0,.7)",
    "elev-2": "0 2px 4px rgba(0,0,0,.28),0 34px 60px -30px rgba(0,0,0,.8)",
    "elev-3": "0 2px 8px rgba(0,0,0,.35),0 32px 90px -28px rgba(0,0,0,.85)",
    sheen: "inset 0 1px 0 rgba(255,255,255,.06)",
    glow: "rgba(167,217,193,.32)",
    spot: "rgba(167,217,193,.11)",
    shimmer: "rgba(255,255,255,.07)",
    "canvas-a": "rgba(143,211,194,.12)",
    "canvas-b": "rgba(255,255,255,.035)",
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
// Web-only hover feedback. `translate` composes with the inline `transform`
// that the press animation owns, so hover lift and press scale never fight.
const hoverCss = `[data-glyph-mark]{transition:transform 520ms cubic-bezier(.34,1.56,.64,1)}[data-glyph-tile]{transition:translate 420ms cubic-bezier(.16,1,.3,1),box-shadow 420ms ease}@media(hover:hover) and (pointer:fine){:is([data-hover],[role="button"]):hover [data-glyph-mark]{transform:rotate(-8deg) scale(1.1)}:is([data-hover],[role="button"]):hover [data-glyph-tile]{translate:0 -2px;box-shadow:0 10px 18px -10px rgba(21,45,40,.45)}}[data-reduce-motion="true"] :is([data-glyph-mark],[data-glyph-tile]){transition:none!important;transform:none!important;translate:none!important}@media(prefers-reduced-motion:reduce){:is([data-glyph-mark],[data-glyph-tile]){transition:none!important}}[data-hover]{transition:background-color 260ms cubic-bezier(.16,1,.3,1),box-shadow 420ms cubic-bezier(.16,1,.3,1),translate 420ms cubic-bezier(.16,1,.3,1),border-color 260ms ease}@media(hover:hover) and (pointer:fine){[data-hover="tint"]:hover{background-color:color-mix(in srgb,var(--rc-elevated) 70%,transparent)}[data-hover="lift"]:hover{translate:0 -3px;box-shadow:0 22px 44px -22px rgba(21,45,40,.42);border-color:var(--rc-controlBorder)}}[data-reduce-motion="true"] [data-hover]{transition:none}[data-reduce-motion="true"] [data-hover="lift"]:hover{translate:none}@media(prefers-reduced-motion:reduce){[data-hover]{transition:none}[data-hover="lift"]:hover{translate:none}}::selection{background:var(--rc-primary);color:var(--rc-onPrimary)}@media(hover:hover) and (pointer:fine){:is([role="button"],[role="radio"],[role="link"],[role="checkbox"]):not([data-hover]):not([aria-disabled="true"]){transition:box-shadow 160ms ease}:is([role="button"],[role="radio"],[role="link"],[role="checkbox"]):not([data-hover]):not([aria-disabled="true"]):hover{box-shadow:inset 0 0 0 999px rgba(127,127,127,.07)}}[data-reduce-motion="true"] [role]{transition:none!important}html{-webkit-tap-highlight-color:transparent}input:-webkit-autofill,input:-webkit-autofill:hover,input:-webkit-autofill:focus,input:-webkit-autofill:active{-webkit-text-fill-color:var(--rc-text);caret-color:var(--rc-text);transition:background-color 600000s 0s,color 600000s 0s}input:autofill{background:transparent}@media(prefers-reduced-motion:no-preference){html:not([data-reduce-motion="true"]){scroll-behavior:smooth}}[data-overlay="blur"]{backdrop-filter:blur(14px) saturate(140%);-webkit-backdrop-filter:blur(14px) saturate(140%)}`;
// List rows that open something, and may hold their own buttons (the payout stays). On hover the whole row takes one quiet wash.
// On keyboard focus a bar runs down its leading edge and the row takes the same wash. They never get the 2px box that other
// pressables get, which read as a frame around a payout. "row" is the row or its wrapper; "rowhit" is the part of a row that
// opens it, inside a wrapper. The :has() rule stands alone so a browser without it ignores only that rule.
const rowWash = "background-color:color-mix(in srgb,var(--rc-elevated) 60%,transparent)";
const rowCss = `@media(hover:hover) and (pointer:fine){[data-hover="row"]:hover{${rowWash}}}[data-hover="row"][role="button"]:focus-visible,[data-hover="rowhit"][role="button"]:focus-visible{outline:none;box-shadow:inset 3px 0 0 var(--rc-primary)}[data-hover="row"][role="button"]:focus-visible{${rowWash}}[data-hover="row"]:has([data-hover="rowhit"]:focus-visible){${rowWash}}`;
// The finishing layer on the web. Cards that lift carry a soft light that follows the pointer
// (motion.tsx sets --mx/--my on the card under the pointer). Primary buttons catch a sheen on hover.
// Loading placeholders sweep. Inputs and controls glow when focused. The workspace canvas holds two
// faint light pools. Thin scrollbars. Everything decorative stops with reduced motion.
const premiumCss = `@media(hover:hover) and (pointer:fine){[data-hover="lift"]::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;transition:opacity 360ms ease;background:radial-gradient(560px circle at var(--mx,50%) var(--my,0%),var(--rc-spot),transparent 44%)}[data-hover="lift"]:hover::after{opacity:1}[data-sheen]:hover::before{left:130%;transition:left 800ms cubic-bezier(.22,1,.36,1)}[data-hover="lift"]:hover{box-shadow:var(--rc-elev-2),var(--rc-sheen)}}[data-sheen]{overflow:hidden}[data-sheen]::before{content:"";position:absolute;top:0;bottom:0;left:-70%;width:45%;transform:skewX(-20deg);background:linear-gradient(90deg,transparent,rgba(255,255,255,.24),transparent);pointer-events:none}[data-shimmer]{background-image:linear-gradient(100deg,transparent 25%,var(--rc-shimmer) 50%,transparent 75%);background-size:220% 100%;background-repeat:no-repeat;animation:rc-sweep 1500ms cubic-bezier(.4,0,.2,1) infinite}@keyframes rc-sweep{from{background-position:160% 0}to{background-position:-60% 0}}[data-canvas]{background-image:radial-gradient(1100px 560px at 104% -12%,var(--rc-canvas-a),transparent 62%),radial-gradient(900px 520px at -8% -14%,var(--rc-canvas-b),transparent 60%)}input:focus-visible,textarea:focus-visible{outline:2px solid var(--rc-primary)!important;outline-offset:1px;box-shadow:0 0 0 6px var(--rc-glow)!important}[role="button"]:focus-visible,[role="radio"]:focus-visible,[role="checkbox"]:focus-visible,[role="link"]:focus-visible{box-shadow:0 0 0 6px var(--rc-glow)}*{scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--rc-muted) 40%,transparent) transparent}[data-reduce-motion="true"] :is([data-shimmer],[data-sheen]::before,[data-hover="lift"]::after){animation:none!important;transition:none!important}@media(prefers-reduced-motion:reduce){[data-shimmer]{animation:none}[data-sheen]::before,[data-hover="lift"]::after{transition:none}}`;
export const designTokenCss = `${hoverCss}${rowCss}${premiumCss}:root:not(.dark):not([data-recharge-theme="dark"]),[data-recharge-theme="light"]{${variables("light")}${aliases}color-scheme:light}:root.dark:not([data-recharge-theme="light"]),[data-recharge-theme="dark"]{${variables("dark")}${aliases}color-scheme:dark}${themeTransitionCss}${headerCss}[data-testid="workspace-scroll"]{scrollbar-width:thin;scrollbar-color:var(--rc-muted) transparent}button:focus-visible,[role="button"]:focus-visible,[role="checkbox"]:focus-visible,input:focus-visible{outline:2px solid var(--rc-primary);outline-offset:3px} [data-search-shell] input:focus{outline:none;box-shadow:none}[data-search-shell]:focus-within{outline:none;border-color:var(--rc-primary)!important;box-shadow:inset 0 0 0 1px var(--rc-primary)} [data-tool-section="collapsed"]{content-visibility:auto;contain-intrinsic-size:auto 76px}`;
