/**
 * DD-133 component presentation tokens, valued by the DD-141 Kailo visual
 * design system.
 *
 * Renders `client-kit/embed/kailo-theme-tokens.css` from the very sources the
 * Kailo shell paints with, so a component page embedded in the content area
 * resolves the same colors, type, radii, elevation and motion:
 *
 * - colors, elevation, motion and font stacks: `kailo-tokens.ts`, the single
 *   source `useAppearance` installs for the first-party theme;
 * - type: the `typography.css` ramp;
 * - radius: the `tailwind.config.js` radius scale over the Kailo base radius.
 *
 * Text sources are passed in so the rendering is a pure function; the drift
 * test reads the real files and fails when the committed CSS differs. Every
 * emitted name carries the `--kailo-` prefix so it never collides with a
 * component's own custom properties. Names that existed before DD-141 keep
 * their meaning; only their values follow the new design system.
 */
import {
  KAILO_FONT_FEATURES, KAILO_FONT_MONO, KAILO_FONT_SANS, KAILO_MOTION, KAILO_RADIUS, KAILO_SHADOWS,
  kailoExtendedVars, kailoThemeVars, type KailoMode,
} from "./kailo-tokens";

export interface EmbedTokenSources {
  /** `client-kit/ts/platform/src/typography.css` */
  typographyCss: string;
  /** `client-kit/ts/platform/src/tailwind.config.js` */
  tailwindConfig: string;
}

/** Semantic color tokens, in the order they are emitted. */
export const EMBED_COLOR_TOKENS = [
  "background", "foreground", "card", "card-foreground", "popover", "popover-foreground",
  "primary", "primary-foreground", "secondary", "secondary-foreground", "muted", "muted-foreground",
  "accent", "accent-foreground", "destructive", "destructive-foreground", "border", "input", "ring",
  "sidebar-background", "sidebar-foreground", "sidebar-primary", "sidebar-primary-foreground",
  "sidebar-active", "sidebar-active-foreground", "sidebar-accent", "sidebar-accent-foreground",
  "sidebar-border", "sidebar-ring", "chart-1", "chart-2", "chart-3", "chart-4", "chart-5",
] as const;

/** Tokens that are already complete CSS colors (hex/rgba), not HSL triplets. */
const DIRECT_COLOR_TOKENS = [
  ["status-added", "--status-added"], ["status-deleted", "--status-deleted"],
  ["status-modified", "--status-modified"], ["warning", "--ui-warning"], ["warning-background", "--ui-warning-bg"],
] as const;

/** DD-141 roles carried to components as complete colors (`--kailo-color-<name>` ← `--k-<role>`). */
const ROLE_COLOR_TOKENS = [
  ["brand", "--k-brand"], ["brand-hover", "--k-brand-hover"], ["brand-pressed", "--k-brand-pressed"],
  ["on-brand", "--k-on-brand"], ["brand-text", "--k-brand-text"],
  ["selected", "--k-brand-soft"], ["selected-hover", "--k-brand-soft-hover"], ["selected-foreground", "--k-brand-soft-text"],
  ["brand-line", "--k-brand-line"], ["hover", "--k-hover"], ["pressed", "--k-pressed"], ["canvas", "--k-canvas"],
  ["text-secondary", "--k-text-secondary"], ["text-disabled", "--k-text-disabled"], ["line-strong", "--k-line-strong"],
  ["success", "--k-success"], ["success-text", "--k-success-text"], ["success-soft", "--k-success-soft"],
  ["warning-text", "--k-warning-text"], ["warning-soft", "--k-warning-soft"],
  ["danger", "--k-danger"], ["danger-text", "--k-danger-text"], ["danger-soft", "--k-danger-soft"],
  ["info", "--k-info"], ["info-text", "--k-info-text"], ["info-soft", "--k-info-soft"],
] as const;

const BRAND_STEPS = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"] as const;

function block(css: string, selector: RegExp, what: string): string {
  const match = selector.exec(css);
  if (!match || match.index === undefined) throw new Error(`embed tokens: ${what} not found`);
  const start = css.indexOf("{", match.index) + 1;
  let depth = 1;
  let end = start;
  while (depth > 0 && end < css.length) {
    if (css[end] === "{") depth += 1;
    if (css[end] === "}") depth -= 1;
    end += 1;
  }
  if (depth !== 0) throw new Error(`embed tokens: ${what} is not closed`);
  return css.slice(start, end - 1);
}

function declarations(body: string): Map<string, string> {
  const withoutComments = body.replace(/\/\*[\s\S]*?\*\//g, "");
  const values = new Map<string, string>();
  for (const match of withoutComments.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    values.set(match[1]!, match[2]!.trim().replace(/\s+/g, " "));
  }
  return values;
}

function required(values: Record<string, string>, name: string, what: string): string {
  const value = values[name];
  if (value === undefined) throw new Error(`embed tokens: ${what} lacks ${name}`);
  return value;
}

function typeRamp(typographyCss: string): [string, string][] {
  const root = declarations(block(typographyCss, /:root\s*\{/, "typography :root"));
  const ramp: [string, string][] = [];
  for (const [name, value] of root) {
    const step = /^--text-([a-z0-9]+)$/.exec(name);
    if (!step) continue;
    if (value === "var(--buzz-type-rem)") {
      ramp.push([step[1]!, "1rem"]);
      continue;
    }
    const scaled = /^calc\(var\(--buzz-type-rem\) \* ([0-9.]+)\)$/.exec(value);
    if (!scaled) throw new Error(`embed tokens: unsupported type step ${name}: ${value}`);
    ramp.push([step[1]!, `${scaled[1]}rem`]);
  }
  if (ramp.length === 0) throw new Error("embed tokens: typography ramp is empty");
  return ramp;
}

function radiusScale(tailwindConfig: string, radius: string): [string, string][] {
  const body = /borderRadius:\s*\{([^}]*)\}/.exec(tailwindConfig)?.[1];
  if (!body) throw new Error("embed tokens: tailwind borderRadius not found");
  const scale: [string, string][] = [];
  for (const match of body.matchAll(/(\w+):\s*"([^"]+)"/g)) {
    scale.push([match[1]!, match[2]!.replaceAll("var(--radius)", radius)]);
  }
  if (scale.length === 0) throw new Error("embed tokens: tailwind borderRadius is empty");
  // DD-141 §5: card/popover and dialog radii.
  scale.push(["xl", "0.75rem"], ["2xl", "1rem"]);
  return scale;
}

function modeBlock(selector: string, mode: KailoMode): string {
  const colors = kailoThemeVars(mode);
  const roles = kailoExtendedVars(mode);
  const lines = [`${selector} {`, `  color-scheme: ${mode};`];
  for (const token of EMBED_COLOR_TOKENS) {
    lines.push(`  --kailo-hsl-${token}: ${required(colors, `--${token}`, `${mode} theme`)};`);
  }
  for (const [token, source] of DIRECT_COLOR_TOKENS) {
    lines.push(`  --kailo-color-${token}: ${required(colors, source, `${mode} theme`)};`);
  }
  for (const [token, source] of ROLE_COLOR_TOKENS) {
    lines.push(`  --kailo-color-${token}: ${required(roles, source, `${mode} roles`)};`);
  }
  for (const step of BRAND_STEPS) {
    lines.push(`  --kailo-color-brand-${step}: ${required(roles, `--k-brand-${step}`, `${mode} brand ramp`)};`);
  }
  for (const [step, value] of Object.entries(KAILO_SHADOWS[mode])) lines.push(`  --kailo-shadow-${step}: ${value};`);
  lines.push(`  --kailo-gradient-brand: ${required(roles, "--k-gradient-brand", `${mode} roles`)};`);
  lines.push(`  --kailo-focus-ring: ${required(roles, "--k-focus-ring", `${mode} roles`)};`);
  lines.push("}");
  return lines.join("\n");
}

/** DD-157 (20 §13.6): static base layer for pages running kailo-embed.js; values only via tokens. */
export const EMBED_BASE_LAYER = `/*
 * DD-157 base layer (.design/20 §13.6): Kailo canvas, scrollbars, selection, focus
 * ring and theme-switch behaviour for every page that runs kailo-embed.js
 * (<html data-kailo-runtime>). Zero-specificity where a component may refine it.
 */
:root[data-kailo-runtime] {
  background-color: var(--kailo-color-background);
  color: var(--kailo-color-foreground);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
:where(:root[data-kailo-runtime]) body {
  background-color: var(--kailo-color-background);
}
:root[data-kailo-runtime] ::selection {
  background-color: var(--kailo-color-brand-100);
}
:root[data-kailo-runtime][data-kailo-theme="dark"] ::selection {
  background-color: var(--kailo-color-brand-800);
}
:where(:root[data-kailo-runtime]) :where(a[href], button, [role="button"], [role="tab"], [role="menuitem"], [role="option"], summary, [tabindex]:not([tabindex="-1"])):focus-visible {
  outline: 2px solid var(--kailo-color-ring);
  outline-offset: 2px;
}
:root[data-kailo-runtime] ::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
:root[data-kailo-runtime] ::-webkit-scrollbar-track,
:root[data-kailo-runtime] ::-webkit-scrollbar-corner {
  background: transparent;
}
:root[data-kailo-runtime] ::-webkit-scrollbar-thumb {
  background-color: hsl(var(--kailo-hsl-muted-foreground) / 0.3);
  background-clip: content-box;
  border: 2px solid transparent;
  border-radius: 9999px;
}
:root[data-kailo-runtime] ::-webkit-scrollbar-thumb:hover {
  background-color: hsl(var(--kailo-hsl-muted-foreground) / 0.5);
}
@supports not selector(::-webkit-scrollbar) {
  :root[data-kailo-runtime] * {
    scrollbar-color: hsl(var(--kailo-hsl-muted-foreground) / 0.3) transparent;
    scrollbar-width: thin;
  }
}
:root[data-kailo-theme-switching] *,
:root[data-kailo-theme-switching] *::before,
:root[data-kailo-theme-switching] *::after {
  transition: none !important;
}
@media (prefers-reduced-motion: reduce) {
  :root[data-kailo-runtime] *,
  :root[data-kailo-runtime] *::before,
  :root[data-kailo-runtime] *::after {
    animation-duration: 1ms !important;
    transition-duration: 1ms !important;
  }
}
/*
 * DD-167 type dials (07 §4.8.10): kailo-embed.js mirrors Kailo's font size preference in
 * <html data-kailo-font-size> and its zoom in --kailo-zoom (data-kailo-zoomed when not 1).
 * --kailo-type-scale multiplies text only (body 13 / 14 / 15 px); the --kailo-text-* steps are
 * the .design/20 §3 ramp already scaled. Zoom scales a whole page; each component applies it
 * to its own root so that layout, popups and scrolling stay single (20 §13.5).
 */
:root {
  --kailo-type-scale: 1;
  --kailo-zoom: 1;
  --kailo-text-overline: calc(11px * var(--kailo-type-scale));
  --kailo-text-caption: calc(12px * var(--kailo-type-scale));
  --kailo-text-callout: calc(13px * var(--kailo-type-scale));
  --kailo-text-body: calc(14px * var(--kailo-type-scale));
  --kailo-text-headline: calc(15px * var(--kailo-type-scale));
  --kailo-text-title2: calc(17px * var(--kailo-type-scale));
  --kailo-text-title1: calc(22px * var(--kailo-type-scale));
  --kailo-text-display: calc(30px * var(--kailo-type-scale));
}
:root[data-kailo-font-size="smaller"] {
  --kailo-type-scale: calc(13 / 14);
}
:root[data-kailo-font-size="larger"] {
  --kailo-type-scale: calc(15 / 14);
}`;

/** The complete distributable stylesheet, byte-for-byte what is committed. */
export function renderEmbedTokenCss(sources: EmbedTokenSources): string {
  const common = [
    ":root {",
    `  --kailo-font-sans: ${KAILO_FONT_SANS.join(", ")};`,
    `  --kailo-font-mono: ${KAILO_FONT_MONO.join(", ")};`,
    `  --kailo-font-features: ${KAILO_FONT_FEATURES};`,
    ...typeRamp(sources.typographyCss).map(([step, size]) => `  --kailo-font-size-${step}: ${size};`),
    `  --kailo-radius: ${KAILO_RADIUS};`,
    ...radiusScale(sources.tailwindConfig, KAILO_RADIUS).map(([step, value]) => `  --kailo-radius-${step}: ${value};`),
    ...Object.entries(KAILO_MOTION.duration).map(([name, value]) => `  --kailo-duration-${name}: ${value};`),
    ...Object.entries(KAILO_MOTION.easing).map(([name, value]) => `  --kailo-ease-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${value};`),
    // Resolved on :root against whichever mode block below is in effect.
    ...EMBED_COLOR_TOKENS.map((token) => `  --kailo-color-${token}: hsl(var(--kailo-hsl-${token}));`),
    "}",
  ].join("\n");
  return [
    "/*",
    " * Kailo presentation tokens (DD-133), valued by the Kailo visual design system",
    " * (DD-141, .design/20). Generated from client-kit/ts/platform: theme/kailo-tokens.ts,",
    " * typography.css and tailwind.config.js by src/theme/embed-tokens.ts. Do not edit;",
    " * regenerate with",
    " *   KAILO_WRITE_EMBED_TOKENS=1 pnpm --filter @client-kit/platform exec vitest run test/embed-tokens.test.ts",
    " * Light is the default; <html data-kailo-theme=\"dark\"> selects dark (kailo-embed.js sets it).",
    " * --kailo-hsl-* are bare \"H S% L%\" triplets for alpha: hsl(var(--kailo-hsl-border) / 0.5).",
    " */",
    common,
    modeBlock(":root", "light"),
    modeBlock(":root[data-kailo-theme=\"dark\"]", "dark"),
    EMBED_BASE_LAYER,
    "",
  ].join("\n");
}
