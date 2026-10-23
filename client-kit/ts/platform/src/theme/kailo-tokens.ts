/**
 * DD-141 Kailo visual design system: the single source of every Kailo design
 * token. Web and Desktop paint with it (through `kailo-tokens.css`, rendered
 * below, and `useAppearance`); embedded components follow it through
 * `client-kit/embed/kailo-theme-tokens.css` (`embed-tokens.ts`).
 *
 * Palettes were tuned in OKLCH (perceptually even steps, sRGB gamut-clipped)
 * and are committed as literal hex so every consumer reads identical values.
 * Three brand directions are kept side by side as the design record of
 * `.design/20` §2; `KAILO_BRAND_DIRECTION` selects the shipped one.
 */
import { hexToHsl } from "./adaptive-theme";

export const KAILO_DIRECTIONS = {
  iris: {
    hue: 285,
    brand: { 50: "#f6f7fe", 100: "#ebebff", 200: "#d9d9ff", 300: "#c0bfff", 400: "#a09aff", 500: "#8371fe", 600: "#6d4fed", 700: "#593cc9", 800: "#452f9f", 900: "#342676", 950: "#20174e" },
    brandDark: { 50: "#eeeeff", 100: "#dfe0fe", 200: "#ccccfe", 300: "#b6b4fe", 400: "#9e97fd", 500: "#705fde", 600: "#6151c6", 700: "#4f41a2", 800: "#3d337d", 900: "#2b2556", 950: "#1e1a3e" },
    neutral: { 0: "#ffffff", 25: "#fafafc", 50: "#f5f5f9", 75: "#f2f2f6", 100: "#eeeef4", 150: "#e9e9ef", 200: "#e2e2e9", 250: "#d6d7de", 300: "#c6c6cf", 400: "#a3a4ad", 500: "#7f7f8a", 600: "#6a6b75", 700: "#51515c", 750: "#464751", 800: "#34343e", 850: "#292932", 875: "#212129", 900: "#1c1c23", 925: "#16161d", 950: "#121218", 975: "#0e0e14", 1000: "#0a0a10" },
  },
  violet: {
    hue: 298,
    brand: { 50: "#f8f6ff", 100: "#efeafe", 200: "#e1d6fe", 300: "#ceb9fe", 400: "#b590ff", 500: "#9e64fa", 600: "#8643e1", 700: "#6f31be", 800: "#572796", 900: "#412170", 950: "#2a1449" },
    brandDark: { 50: "#f2edfd", 100: "#e6ddfe", 200: "#d7c8fd", 300: "#c6aefc", 400: "#b290f5", 500: "#8757d4", 600: "#7649bd", 700: "#603a9a", 800: "#4a2e77", 900: "#342252", 950: "#25183b" },
    neutral: { 0: "#ffffff", 25: "#fafafc", 50: "#f6f5f9", 75: "#f3f2f6", 100: "#efeef3", 150: "#eae8ee", 200: "#e3e2e8", 250: "#d8d6dd", 300: "#c8c6ce", 400: "#a5a3ac", 500: "#817e89", 600: "#6d6a74", 700: "#53515b", 750: "#494650", 800: "#36343d", 850: "#2b2831", 875: "#222028", 900: "#1d1b23", 925: "#18161d", 950: "#131118", 975: "#0f0d13", 1000: "#0c0a10" },
  },
  orchid: {
    hue: 318,
    brand: { 50: "#fcf4ff", 100: "#f9e6fe", 200: "#f3cefe", 300: "#e9acfb", 400: "#d67ff1", 500: "#bf55de", 600: "#a632c5", 700: "#8a21a5", 800: "#6d1a82", 900: "#521862", 950: "#350e40" },
    brandDark: { 50: "#f7ecfa", 100: "#f0daf7", 200: "#e7c3f2", 300: "#dca7ec", 400: "#cc87e1", 500: "#a34bbc", 600: "#8f3da7", 700: "#753188", 800: "#5a2769", 900: "#3f1d49", 950: "#2d1534" },
    neutral: { 0: "#ffffff", 25: "#fbf9fb", 50: "#f7f5f8", 75: "#f4f1f5", 100: "#f1eef2", 150: "#ece8ed", 200: "#e5e1e7", 250: "#dad5dc", 300: "#cbc5cc", 400: "#a8a2aa", 500: "#847d87", 600: "#706972", 700: "#575059", 750: "#4c454e", 800: "#39333b", 850: "#2d282f", 875: "#251f26", 900: "#1f1a21", 925: "#1a151b", 950: "#151116", 975: "#110d12", 1000: "#0d090f" },
  },
} as const;

export const KAILO_STATUS_RAMPS = {
  success: {
    light: { 50: "#effbf2", 100: "#d9f6e2", 200: "#b6edc8", 300: "#7fdfa3", 400: "#07c874", 500: "#04a65f", 600: "#07894e", 700: "#03703e", 800: "#005830", 900: "#024324", 950: "#002b15" },
    dark: { 50: "#e6f5ea", 100: "#ceecd7", 200: "#ade0bd", 300: "#85d2a0", 400: "#52bf7f", 500: "#058f51", 600: "#047c46", 700: "#046538", 800: "#014f2a", 900: "#02381d", 950: "#012813" },
  },
  warning: {
    light: { 50: "#fef6ec", 100: "#ffead1", 200: "#fdd6a7", 300: "#f9b965", 400: "#e49504", 500: "#bd7c07", 600: "#9c6505", 700: "#7f5203", 800: "#654001", 900: "#4e3000", 950: "#331e00" },
    dark: { 50: "#f9eee1", 100: "#f5dfc5", 200: "#efcb9e", 300: "#e8b370", 400: "#db9631", 500: "#a36901", 600: "#8e5b00", 700: "#744a02", 800: "#5b3900", 900: "#412801", 950: "#2f1c00" },
  },
  danger: {
    light: { 50: "#fef5f4", 100: "#ffe7e5", 200: "#ffd1cc", 300: "#ffafa8", 400: "#ff7972", 500: "#f23f42", 600: "#d60323", 700: "#b0021b", 800: "#8d0013", 900: "#6b0810", 950: "#460508" },
    dark: { 50: "#feebe9", 100: "#ffd9d5", 200: "#fdc0ba", 300: "#faa39c", 400: "#f0817a", 500: "#ca3f3e", 600: "#b33232", 700: "#932828", 800: "#722120", 900: "#4f1a18", 950: "#391211" },
  },
  info: {
    light: { 50: "#f2f8fe", 100: "#e0f0fe", 200: "#c1e2ff", 300: "#94cdfe", 400: "#49b0ff", 500: "#0792e4", 600: "#0178bd", 700: "#03629b", 800: "#004d7c", 900: "#013a5f", 950: "#01253f" },
    dark: { 50: "#e5f2fe", 100: "#cce7fe", 200: "#abd7fe", 300: "#83c5fd", 400: "#51aef6", 500: "#067dc4", 600: "#046dab", 700: "#03588c", 800: "#01446f", 900: "#013050", 950: "#00223c" },
  },
} as const;

export type KailoBrandDirection = keyof typeof KAILO_DIRECTIONS;
export type KailoMode = "light" | "dark";

/** `.design/20` §2.2: the shipped brand direction (Iris, indigo-violet, OKLCH hue 285). */
export const KAILO_BRAND_DIRECTION: KailoBrandDirection = "iris";

/** Second stop of the brand gradient, used only at brand moments (§2.5). */
const GRADIENT_PARTNER: Record<KailoBrandDirection, KailoBrandDirection> = {
  iris: "orchid",
  violet: "orchid",
  orchid: "iris",
};

/** §3: Latin from Inter; CJK from the platform's own Simplified Chinese UI face. */
export const KAILO_FONT_SANS = [
  '"Inter Variable"', "Inter", '"PingFang SC"', '"HarmonyOS Sans SC"', '"Source Han Sans SC"',
  '"Noto Sans CJK SC"', '"Noto Sans SC"', '"Microsoft YaHei UI"', '"Microsoft YaHei"',
  "system-ui", "-apple-system", '"Segoe UI"', "sans-serif",
] as const;
export const KAILO_FONT_MONO = [
  '"JetBrains Mono"', '"SF Mono"', '"Cascadia Code"', "ui-monospace", "Menlo", "Consolas", "monospace",
] as const;
/** Inter alternates: open 4/6/9 and a straight-sided `l` keep digits and IDs legible. */
export const KAILO_FONT_FEATURES = '"cv02", "cv03", "cv04", "cv05", "ss03"';

/** §5: base radius; Tailwind lg/md/sm derive from it. */
export const KAILO_RADIUS = "0.5rem";

/** §7: motion durations and curves. */
export const KAILO_MOTION = {
  duration: { instant: "90ms", fast: "140ms", base: "200ms", slow: "280ms", slower: "420ms" },
  easing: {
    standard: "cubic-bezier(0.2, 0, 0, 1)",
    out: "cubic-bezier(0.16, 1, 0.3, 1)",
    in: "cubic-bezier(0.4, 0, 1, 1)",
    inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
  },
} as const;

/** §6: elevation. Light shadows are tinted with the neutral hue; dark ones carry a hairline. */
export const KAILO_SHADOWS: Record<KailoMode, Record<"xs" | "sm" | "md" | "lg" | "xl", string>> = {
  light: {
    xs: "0 1px 2px 0 rgb(20 18 42 / 0.05)",
    sm: "0 1px 2px 0 rgb(20 18 42 / 0.06), 0 1px 3px 0 rgb(20 18 42 / 0.07)",
    md: "0 2px 4px -1px rgb(20 18 42 / 0.06), 0 8px 20px -6px rgb(20 18 42 / 0.14)",
    lg: "0 4px 8px -2px rgb(20 18 42 / 0.06), 0 18px 36px -10px rgb(20 18 42 / 0.20)",
    xl: "0 8px 16px -4px rgb(20 18 42 / 0.08), 0 32px 64px -16px rgb(20 18 42 / 0.30)",
  },
  dark: {
    xs: "0 1px 2px 0 rgb(0 0 0 / 0.40)",
    sm: "0 0 0 1px rgb(255 255 255 / 0.05), 0 1px 3px 0 rgb(0 0 0 / 0.50)",
    md: "0 0 0 1px rgb(255 255 255 / 0.06), 0 8px 20px -6px rgb(0 0 0 / 0.60)",
    lg: "0 0 0 1px rgb(255 255 255 / 0.07), 0 18px 36px -10px rgb(0 0 0 / 0.70)",
    xl: "0 0 0 1px rgb(255 255 255 / 0.08), 0 32px 64px -16px rgb(0 0 0 / 0.75)",
  },
};

function rgbTriplet(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`kailo tokens: invalid color ${hex}`);
  return `${parseInt(m[1]!, 16)} ${parseInt(m[2]!, 16)} ${parseInt(m[3]!, 16)}`;
}

/** Semantic roles (§2.4) for one mode, as complete colors. */
export function kailoRoles(mode: KailoMode, direction: KailoBrandDirection = KAILO_BRAND_DIRECTION) {
  const dir = KAILO_DIRECTIONS[direction];
  const n = dir.neutral;
  const s = KAILO_STATUS_RAMPS;
  const partner = KAILO_DIRECTIONS[GRADIENT_PARTNER[direction]];
  if (mode === "light") {
    const b = dir.brand;
    return {
      canvas: n[50], surface: n[0], raised: n[0], overlay: n[0], sunken: n[25],
      text: n[925], textSecondary: n[700], textMuted: n[600], textDisabled: n[400],
      line: n[200], lineStrong: n[250], hover: n[100], pressed: n[150],
      sidebar: n[50], sidebarText: n[800], sidebarHover: n[100], sidebarLine: n[200],
      brand: b[600], brandHover: b[700], brandPressed: b[800], onBrand: "#ffffff",
      brandText: b[600], brandSoft: b[50], brandSoftHover: b[100], brandSoftText: b[700], brandLine: b[200],
      ring: b[500], selection: b[100],
      success: s.success.light[600], successText: s.success.light[700], successSoft: s.success.light[50],
      warning: s.warning.light[400], warningText: s.warning.light[700], warningSoft: s.warning.light[50],
      danger: s.danger.light[600], dangerText: s.danger.light[700], dangerSoft: s.danger.light[50],
      info: s.info.light[600], infoText: s.info.light[700], infoSoft: s.info.light[50],
      chart: [b[500], s.info.light[500], s.success.light[500], s.warning.light[400], partner.brand[500]],
      gradientFrom: b[500], gradientVia: b[600], gradientTo: partner.brand[500], glow: b[500],
      ramp: b,
    };
  }
  const b = dir.brandDark;
  return {
    canvas: n[1000], surface: n[950], raised: n[925], overlay: n[900], sunken: n[975],
    text: n[50], textSecondary: n[300], textMuted: n[400], textDisabled: n[600],
    line: n[850], lineStrong: n[800], hover: n[875], pressed: n[850],
    sidebar: n[975], sidebarText: n[150], sidebarHover: n[900], sidebarLine: n[850],
    brand: b[500], brandHover: b[400], brandPressed: b[600], onBrand: "#ffffff",
    brandText: b[200], brandSoft: b[950], brandSoftHover: b[900], brandSoftText: b[100], brandLine: b[800],
    ring: b[400], selection: b[800],
    success: s.success.dark[400], successText: s.success.dark[300], successSoft: s.success.dark[950],
    warning: s.warning.dark[400], warningText: s.warning.dark[300], warningSoft: s.warning.dark[950],
    danger: s.danger.dark[600], dangerText: s.danger.dark[300], dangerSoft: s.danger.dark[950],
    info: s.info.dark[400], infoText: s.info.dark[300], infoSoft: s.info.dark[950],
    chart: [b[400], s.info.dark[400], s.success.dark[400], s.warning.dark[400], partner.brandDark[400]],
    gradientFrom: b[400], gradientVia: b[500], gradientTo: partner.brandDark[400], glow: b[500],
    ramp: b,
  };
}

/**
 * The shadcn variables `useAppearance` installs for the first-party theme:
 * bare `H S% L%` triplets plus the direct status colors, the same names an
 * adaptive (Shiki-derived) theme produces, so every component stays theme-agnostic.
 */
export function kailoThemeVars(mode: KailoMode, direction: KailoBrandDirection = KAILO_BRAND_DIRECTION): Record<string, string> {
  const r = kailoRoles(mode, direction);
  const h = hexToHsl;
  const vars: Record<string, string> = {
    "--background": h(r.surface), "--foreground": h(r.text),
    "--card": h(r.raised), "--card-foreground": h(r.text),
    "--popover": h(r.overlay), "--popover-foreground": h(r.text),
    "--primary": h(r.brand), "--primary-foreground": h(r.onBrand),
    "--secondary": h(r.hover), "--secondary-foreground": h(r.text),
    "--muted": h(r.hover), "--muted-foreground": h(r.textMuted),
    "--accent": h(r.hover), "--accent-foreground": h(r.text),
    "--destructive": h(r.danger), "--destructive-foreground": "0 0% 100.0%",
    "--border": h(r.line), "--input": h(r.lineStrong), "--ring": h(r.ring),
    "--sidebar-background": h(r.sidebar), "--sidebar-foreground": h(r.sidebarText),
    "--sidebar-primary": h(r.brand), "--sidebar-primary-foreground": h(r.onBrand),
    "--sidebar-active": h(r.brand), "--sidebar-active-foreground": h(r.onBrand),
    "--sidebar-accent": h(r.sidebarHover), "--sidebar-accent-foreground": h(r.text),
    "--sidebar-border": h(r.sidebarLine), "--sidebar-ring": h(r.ring),
    "--status-added": r.success, "--status-deleted": mode === "dark" ? r.dangerText : r.danger, "--status-modified": r.warning,
    "--ui-warning": r.warningText, "--ui-warning-bg": r.warningSoft,
  };
  r.chart.forEach((color, index) => { vars[`--chart-${index + 1}`] = h(color); });
  return vars;
}

/** Kailo-only tokens (`--k-*`), complete CSS values, per mode. */
export function kailoExtendedVars(mode: KailoMode, direction: KailoBrandDirection = KAILO_BRAND_DIRECTION): Record<string, string> {
  const r = kailoRoles(mode, direction);
  const vars: Record<string, string> = {};
  for (const [step, value] of Object.entries(r.ramp)) vars[`--k-brand-${step}`] = value;
  const roles: [string, string][] = [
    ["canvas", r.canvas], ["surface", r.surface], ["raised", r.raised], ["overlay", r.overlay], ["sunken", r.sunken],
    ["text", r.text], ["text-secondary", r.textSecondary], ["text-muted", r.textMuted], ["text-disabled", r.textDisabled],
    ["line", r.line], ["line-strong", r.lineStrong], ["hover", r.hover], ["pressed", r.pressed],
    ["brand", r.brand], ["brand-hover", r.brandHover], ["brand-pressed", r.brandPressed], ["on-brand", r.onBrand],
    ["brand-text", r.brandText], ["brand-soft", r.brandSoft], ["brand-soft-hover", r.brandSoftHover],
    ["brand-soft-text", r.brandSoftText], ["brand-line", r.brandLine], ["selection", r.selection],
    ["success", r.success], ["success-text", r.successText], ["success-soft", r.successSoft],
    ["warning", r.warning], ["warning-text", r.warningText], ["warning-soft", r.warningSoft],
    ["danger", r.danger], ["danger-text", r.dangerText], ["danger-soft", r.dangerSoft],
    ["info", r.info], ["info-text", r.infoText], ["info-soft", r.infoSoft],
  ];
  for (const [name, value] of roles) vars[`--k-${name}`] = value;
  vars["--k-brand-rgb"] = rgbTriplet(r.brand);
  vars["--k-glow-rgb"] = rgbTriplet(r.glow);
  vars["--k-gradient-from"] = r.gradientFrom;
  vars["--k-gradient-via"] = r.gradientVia;
  vars["--k-gradient-to"] = r.gradientTo;
  vars["--k-gradient-brand"] = `linear-gradient(135deg, ${r.gradientFrom} 0%, ${r.gradientVia} 50%, ${r.gradientTo} 100%)`;
  vars["--k-focus-ring"] = `0 0 0 2px ${r.surface}, 0 0 0 4px ${r.ring}`;
  for (const [step, value] of Object.entries(KAILO_SHADOWS[mode])) vars[`--k-shadow-${step}`] = value;
  return vars;
}

/** Mode-independent tokens: neutral ramp, type, radius, motion. */
export function kailoCommonVars(direction: KailoBrandDirection = KAILO_BRAND_DIRECTION): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [step, value] of Object.entries(KAILO_DIRECTIONS[direction].neutral)) vars[`--k-neutral-${step}`] = value;
  vars["--k-font-sans"] = KAILO_FONT_SANS.join(", ");
  vars["--k-font-mono"] = KAILO_FONT_MONO.join(", ");
  vars["--k-font-features"] = KAILO_FONT_FEATURES;
  vars["--radius"] = KAILO_RADIUS;
  for (const [name, value] of Object.entries(KAILO_MOTION.duration)) vars[`--k-duration-${name}`] = value;
  for (const [name, value] of Object.entries(KAILO_MOTION.easing)) {
    vars[`--k-ease-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = value;
  }
  return vars;
}

function declarationBlock(selector: string, vars: Record<string, string>): string {
  return [`  ${selector} {`, ...Object.entries(vars).map(([k, v]) => `    ${k}: ${v};`), "  }"].join("\n");
}

/** The committed `src/styles/kailo-tokens.css`, byte for byte (drift-tested). */
export function renderKailoTokenCss(direction: KailoBrandDirection = KAILO_BRAND_DIRECTION): string {
  return [
    "/*",
    " * Kailo design tokens (DD-141, .design/20). Generated by src/theme/kailo-tokens.ts;",
    " * do not edit. Regenerate with",
    " *   KAILO_WRITE_TOKENS=1 pnpm --filter @client-kit/platform exec vitest run test/kailo-tokens.test.ts",
    " * Light on :root, dark on .dark. useAppearance installs the same shadcn values inline.",
    " */",
    "@layer base {",
    declarationBlock(":root", { ...kailoCommonVars(direction), ...kailoThemeVars("light", direction), "--sidebar": "var(--sidebar-background)", ...kailoExtendedVars("light", direction) }),
    "",
    declarationBlock(".dark", { ...kailoThemeVars("dark", direction), "--sidebar": "var(--sidebar-background)", ...kailoExtendedVars("dark", direction) }),
    "}",
    "",
  ].join("\n");
}
