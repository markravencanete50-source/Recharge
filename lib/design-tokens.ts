// One source for CSS variables on the web and resolved colours on iOS/Android.
// Dominant background sampled from the supplied company logo, RGB 239/233/219.
export const brandCanvas = "#EFE9DB";
// Dominant dark background sampled from the supplied alternate logo, RGB 27/62/56.
export const darkBrandCanvas = "#1B3E38";
export const designTokens = {
  light: {
    background: brandCanvas,
    surface: "#FAF7F0",
    elevated: "#E7E0D0",
    text: "#152D28",
    muted: "#4E6259",
    border: "#CCC8B8",
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
    border: "#345347",
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
const variables = (mode: "light" | "dark") =>
  Object.entries(designTokens[mode])
    .map(([key, value]) => `--rc-${key}:${value};`)
    .join("") +
  Object.entries(departmentTokens[mode])
    .map(
      ([key, value]) =>
        `--rc-${key}-ink:${value.ink};--rc-${key}-wash:${value.wash};`,
    )
    .join("");
const aliases = `--background:var(--rc-background);--foreground:var(--rc-text);--card:var(--rc-surface);--card-foreground:var(--rc-text);--popover:var(--rc-elevated);--popover-foreground:var(--rc-text);--muted:var(--rc-elevated);--muted-foreground:var(--rc-muted);--border:var(--rc-border);--input:var(--rc-muted);--ring:var(--rc-primary);--primary:var(--rc-primary);--primary-foreground:var(--rc-onPrimary);--secondary:var(--rc-elevated);--secondary-foreground:var(--rc-text);--accent:var(--rc-wash);--accent-foreground:var(--rc-text);--chart-1:var(--rc-bright);--chart-2:var(--rc-chart);--chart-3:var(--rc-waiting);`;
// Reveal one opaque palette over the other instead of blending both screenshots.
const themeTransitionCss = `::view-transition-group(root){animation:none}::view-transition-image-pair(root){isolation:isolate}::view-transition-old(root){animation:none;opacity:1;mix-blend-mode:normal}::view-transition-new(root){animation:rc-theme-reveal 180ms ease-out;opacity:1;mix-blend-mode:normal}@keyframes rc-theme-reveal{from{clip-path:inset(0 0 100% 0)}to{clip-path:inset(0)}}@media(prefers-reduced-motion:reduce){::view-transition-new(root){animation:none}}[data-reduce-motion="true"]::view-transition-new(root){animation:none}`;
const headerCss = `:is([data-testid="workspace-toolbar"],[data-testid="sidebar-brand"],[data-testid="workspace-sidebar-collapsed"]),:is([data-testid="workspace-toolbar"],[data-testid="sidebar-brand"],[data-testid="workspace-sidebar-collapsed"]) *{color:var(--rc-headerText)}:is([data-testid="workspace-toolbar"],[data-testid="sidebar-brand"],[data-testid="workspace-sidebar-collapsed"]) [role="button"]:focus-visible{outline-color:var(--rc-headerText)}`;
// Web-only hover feedback. `translate` composes with the inline `transform`
// that the press animation owns, so hover lift and press scale never fight.
const hoverCss = `[data-glyph-mark]{transition:transform 520ms cubic-bezier(.34,1.56,.64,1)}[data-glyph-tile]{transition:translate 420ms cubic-bezier(.16,1,.3,1),box-shadow 420ms ease}@media(hover:hover) and (pointer:fine){:is([data-hover],[role="button"]):hover [data-glyph-mark]{transform:rotate(-8deg) scale(1.1)}:is([data-hover],[role="button"]):hover [data-glyph-tile]{translate:0 -2px;box-shadow:0 10px 18px -10px rgba(21,45,40,.45)}}[data-reduce-motion="true"] :is([data-glyph-mark],[data-glyph-tile]){transition:none!important;transform:none!important;translate:none!important}@media(prefers-reduced-motion:reduce){:is([data-glyph-mark],[data-glyph-tile]){transition:none!important}}[data-hover]{transition:background-color 260ms cubic-bezier(.16,1,.3,1),box-shadow 420ms cubic-bezier(.16,1,.3,1),translate 420ms cubic-bezier(.16,1,.3,1),border-color 260ms ease}@media(hover:hover) and (pointer:fine){[data-hover="tint"]:hover{background-color:color-mix(in srgb,var(--rc-elevated) 70%,transparent)}[data-hover="lift"]:hover{translate:0 -3px;box-shadow:0 22px 44px -22px rgba(21,45,40,.42);border-color:var(--rc-controlBorder)}}[data-reduce-motion="true"] [data-hover]{transition:none}[data-reduce-motion="true"] [data-hover="lift"]:hover{translate:none}@media(prefers-reduced-motion:reduce){[data-hover]{transition:none}[data-hover="lift"]:hover{translate:none}}::selection{background:var(--rc-primary);color:var(--rc-onPrimary)}[data-overlay="blur"]{backdrop-filter:blur(8px) saturate(120%);-webkit-backdrop-filter:blur(8px) saturate(120%)}`;
export const designTokenCss = `${hoverCss}:root:not(.dark):not([data-recharge-theme="dark"]),[data-recharge-theme="light"]{${variables("light")}${aliases}color-scheme:light}:root.dark:not([data-recharge-theme="light"]),[data-recharge-theme="dark"]{${variables("dark")}${aliases}color-scheme:dark}${themeTransitionCss}${headerCss}[data-testid="workspace-scroll"]{scrollbar-width:thin;scrollbar-color:var(--rc-muted) transparent}button:focus-visible,[role="button"]:focus-visible,[role="checkbox"]:focus-visible,input:focus-visible{outline:2px solid var(--rc-primary);outline-offset:3px} [data-search-shell] input:focus{outline:none;box-shadow:none}[data-search-shell]:focus-within{outline:none;border-color:var(--rc-primary)!important;box-shadow:inset 0 0 0 1px var(--rc-primary)} [data-tool-section="collapsed"]{content-visibility:auto;contain-intrinsic-size:auto 76px}`;
