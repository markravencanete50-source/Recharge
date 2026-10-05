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
    header: darkBrandCanvas,
    headerText: "#EFE9DB",
    headerMuted: "#C7CBBE",
    headerControl: "#182C26",
    headerControlText: "#FAF7F0",
    headerBorder: "#79998C",
    chart: "#0A6F7B",
    waiting: "#AD5008",
    success: "#177A41",
    danger: "#C82140",
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
    shadow: "#152D280A",
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
    header: darkBrandCanvas,
    headerText: "#EFE9DB",
    headerMuted: "#C7CBBE",
    headerControl: "#182C26",
    headerControlText: "#FAF7F0",
    headerBorder: "#79998C",
    chart: "#5FD6DE",
    waiting: "#FFB547",
    success: "#4ADE80",
    danger: "#FF7A8A",
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
  light: {
    stays: { ink: "#0A6F7B", wash: "#DFF4F6" },
    ready: { ink: "#17703B", wash: "#E1F5E8" },
    cleans: { ink: "#9A5100", wash: "#FFF0D6" },
    clients: { ink: "#7A3FD4", wash: "#F1E8FF" },
    accounts: { ink: "#C0265F", wash: "#FFE4EC" },
  },
  dark: {
    stays: { ink: "#5FD6DE", wash: "#12302F" },
    ready: { ink: "#5FD08A", wash: "#142E22" },
    cleans: { ink: "#FFC36B", wash: "#3A2A12" },
    clients: { ink: "#C4A2FF", wash: "#2A1F4A" },
    accounts: { ink: "#FF8FB1", wash: "#3D1A28" },
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
export const designTokenCss = `:root:not(.dark):not([data-recharge-theme="dark"]),[data-recharge-theme="light"]{${variables("light")}${aliases}color-scheme:light}:root.dark:not([data-recharge-theme="light"]),[data-recharge-theme="dark"]{${variables("dark")}${aliases}color-scheme:dark}${themeTransitionCss}[data-testid="workspace-toolbar"] [role="button"]:focus-visible{outline-color:var(--rc-headerText)}[data-testid="workspace-scroll"]{scrollbar-width:thin;scrollbar-color:var(--rc-muted) transparent}button:focus-visible,[role="button"]:focus-visible,[role="checkbox"]:focus-visible,input:focus-visible{outline:2px solid var(--rc-primary);outline-offset:3px} [data-search-shell] input:focus{outline:none;box-shadow:none}[data-search-shell]:focus-within{outline:2px solid var(--rc-primary);outline-offset:2px} [data-tool-section="collapsed"]{content-visibility:auto;contain-intrinsic-size:auto 76px}`;
