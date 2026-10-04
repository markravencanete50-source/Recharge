// One source for CSS variables on the web and resolved colours on iOS/Android.
export const designTokens = {
  light: {
    background: "#F6F8FD",
    surface: "#FFFFFF",
    elevated: "#EEF2FA",
    text: "#141B2E",
    muted: "#556079",
    border: "#E1E6F0",
    controlBorder: "#8590A8",
    primary: "#3457D5",
    bright: "#5B7CFF",
    onPrimary: "#FFFFFF",
    wash: "#E8EEFF",
    accent: "#3457D5",
    chart: "#0A6F7B",
    waiting: "#AD5008",
    success: "#177A41",
    danger: "#D92D4A",
    utilityArt: "#F1E8FF",
    utilityInk: "#7A3FD4",
    utilityAccent: "#7A3FD4",
    successWash: "#E1F5E8",
    cautionWash: "#FFF0D6",
    hero: "#3457D5",
    heroEnd: "#5B4BDB",
    heroGlow: "#38BDF8",
    heroText: "#FFFFFF",
    heroMuted: "#FFFFFF",
    heroLine: "#A9BAFF",
    overlay: "#070D2280",
    shadow: "#3457D51A",
  },
  dark: {
    background: "#0D1220",
    surface: "#151C30",
    elevated: "#1C2540",
    text: "#F4F6FF",
    muted: "#B4BDD3",
    border: "#2A3552",
    controlBorder: "#6B789C",
    primary: "#A9BAFF",
    bright: "#A9BAFF",
    onPrimary: "#0D1220",
    wash: "#1F2B55",
    accent: "#A9BAFF",
    chart: "#5FD6DE",
    waiting: "#FFB547",
    success: "#4ADE80",
    danger: "#FF7A8A",
    utilityArt: "#2A1F4A",
    utilityInk: "#C4A2FF",
    utilityAccent: "#C4A2FF",
    successWash: "#142E22",
    cautionWash: "#3A2A12",
    hero: "#3457D5",
    heroEnd: "#5B4BDB",
    heroGlow: "#38BDF8",
    heroText: "#FFFFFF",
    heroMuted: "#FFFFFF",
    heroLine: "#A9BAFF",
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
export const designTokenCss = `:root:not(.dark):not([data-recharge-theme="dark"]),[data-recharge-theme="light"]{${variables("light")}${aliases}}html.dark,[data-recharge-theme="dark"]{${variables("dark")}${aliases}color-scheme:dark}::view-transition-old(root),::view-transition-new(root){animation-duration:200ms}@media(prefers-reduced-motion:reduce){::view-transition-old(root),::view-transition-new(root){animation:none}}[data-testid="workspace-scroll"]{scrollbar-width:thin;scrollbar-color:var(--rc-muted) transparent}button:focus-visible,[role="button"]:focus-visible,[role="checkbox"]:focus-visible,input:focus-visible{outline:2px solid var(--rc-primary);outline-offset:3px} [data-tool-section="collapsed"]{content-visibility:auto;contain-intrinsic-size:auto 76px}`;
