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
    "",
  ].join("\n");
}
