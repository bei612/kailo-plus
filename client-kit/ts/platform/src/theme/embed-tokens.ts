/**
 * DD-133 component presentation tokens.
 *
 * Renders `client-kit/embed/kailo-theme-tokens.css` from the very sources the
 * Kailo shell paints with, so a component page embedded in the content area
 * resolves the same colors, type, radii and elevation:
 *
 * - colors: the default Buzz pair (`buzz` / `buzz-dark`) through the same
 *   `extractThemeInfo` → `createThemeVars` → neutral-accent path that
 *   `useAppearance` applies to `:root`, plus the static `theme.css` values that
 *   path leaves in place (radius, charts) and the Buzz Dark content canvas that
 *   `[data-buzz-content-surface]` installs under the content area;
 * - type: the `theme.css` body font stack and the `typography.css` ramp;
 * - radius: the `tailwind.config.js` radius scale.
 *
 * Sources are passed in as text/JSON so the rendering is a pure function; the
 * drift test reads the real files and fails when the committed CSS differs.
 * Every emitted name carries the `--kailo-` prefix so it never collides with a
 * component's own custom properties.
 */
import type { ThemeRegistrationRaw } from "shiki";
import { createThemeVars } from "./adaptive-theme";
import { extractThemeInfo } from "./theme-loader";

export interface EmbedTokenSources {
  /** `client-kit/ts/platform/src/theme.css` */
  themeCss: string;
  /** `client-kit/ts/platform/src/typography.css` */
  typographyCss: string;
  /** `client-kit/ts/platform/src/tailwind.config.js` */
  tailwindConfig: string;
  /** Shiki `github-light`, the palette the `buzz` theme reuses. */
  light: ThemeRegistrationRaw;
  /** Shiki `github-dark`, the palette the `buzz-dark` theme reuses. */
  dark: ThemeRegistrationRaw;
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

/**
 * Elevation used by Kailo popovers, menus and dialogs: the Tailwind v4 default
 * shadow scale (`tailwindcss` ^4.3 in web-client and desktop) that their
 * `shadow-sm|md|lg` utilities resolve to, plus the shell's own named shadows.
 */
const TAILWIND_SHADOWS = [
  ["sm", "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)"],
  ["md", "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)"],
  ["lg", "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)"],
] as const;

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

function required(values: Map<string, string>, name: string, what: string): string {
  const value = values.get(name);
  if (value === undefined) throw new Error(`embed tokens: ${what} lacks ${name}`);
  return value;
}

/** The colors `useAppearance` installs for a Buzz theme (vars + neutral accent). */
function shellColors(raw: ThemeRegistrationRaw, name: string): Map<string, string> {
  const info = extractThemeInfo(name, raw);
  const { vars } = createThemeVars(info.bg, info.fg, info.comment, {
    added: info.added, deleted: info.deleted, modified: info.modified,
  });
  const colors = new Map(Object.entries(vars));
  const foreground = required(colors, "--foreground", name);
  const background = required(colors, "--background", name);
  // applyNeutralThemeAccent: Buzz themes pin the neutral accent.
  for (const key of ["--primary", "--sidebar-primary", "--sidebar-active"]) colors.set(key, foreground);
  for (const key of ["--primary-foreground", "--sidebar-primary-foreground", "--sidebar-active-foreground"]) {
    colors.set(key, background);
  }
  return colors;
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
  return scale;
}

function fontStack(themeCss: string): string {
  // `html, body { overflow }` precedes the `body` rule that sets the font.
  for (const rule of themeCss.matchAll(/(?:^|[\s,])body\s*\{([^{}]*)\}/g)) {
    const family = /font-family:\s*([^;]+);/.exec(rule[1]!)?.[1];
    if (family) return family.trim().replace(/\s+/g, " ");
  }
  throw new Error("embed tokens: body font-family not found");
}

function modeBlock(selector: string, scheme: "light" | "dark", colors: Map<string, string>, statics: Map<string, string>,
  canvas: string | null): string {
  const lines = [`${selector} {`, `  color-scheme: ${scheme};`];
  for (const token of EMBED_COLOR_TOKENS) {
    const raw = token === "background" && canvas !== null ? canvas
      : colors.get(`--${token}`) ?? required(statics, `--${token}`, `${scheme} theme.css`);
    lines.push(`  --kailo-hsl-${token}: ${raw};`);
  }
  for (const [token, source] of DIRECT_COLOR_TOKENS) {
    lines.push(`  --kailo-color-${token}: ${required(colors, source, `${scheme} adaptive theme`)};`);
  }
  lines.push("}");
  return lines.join("\n");
}

/** The complete distributable stylesheet, byte-for-byte what is committed. */
export function renderEmbedTokenCss(sources: EmbedTokenSources): string {
  const lightStatic = declarations(block(sources.themeCss, /:root\s*\{/, "theme :root"));
  const darkStatic = declarations(block(sources.themeCss, /\.dark\s*\{/, "theme .dark"));
  const radius = required(lightStatic, "--radius", "theme :root");
  const contentDark = required(lightStatic, "--buzz-content-dark", "theme :root");
  const common = [
    ":root {",
    `  --kailo-font-sans: ${fontStack(sources.themeCss)};`,
    ...typeRamp(sources.typographyCss).map(([step, size]) => `  --kailo-font-size-${step}: ${size};`),
    `  --kailo-radius: ${radius};`,
    ...radiusScale(sources.tailwindConfig, radius).map(([step, value]) => `  --kailo-radius-${step}: ${value};`),
    ...TAILWIND_SHADOWS.map(([step, value]) => `  --kailo-shadow-${step}: ${value};`),
    // Resolved on :root against whichever mode block below is in effect.
    ...EMBED_COLOR_TOKENS.map((token) => `  --kailo-color-${token}: hsl(var(--kailo-hsl-${token}));`),
    "}",
  ].join("\n");
  return [
    "/*",
    " * Kailo presentation tokens (DD-133). Generated from client-kit/ts/platform:",
    " * theme.css, typography.css, tailwind.config.js and the buzz / buzz-dark",
    " * palettes (adaptive-theme.ts over Shiki github-light / github-dark) by",
    " * src/theme/embed-tokens.ts. Do not edit; regenerate with",
    " *   KAILO_WRITE_EMBED_TOKENS=1 pnpm --filter @client-kit/platform exec vitest run test/embed-tokens.test.ts",
    " * Light is the default; <html data-kailo-theme=\"dark\"> selects dark (kailo-embed.js sets it).",
    " * --kailo-hsl-* are bare \"H S% L%\" triplets for alpha: hsl(var(--kailo-hsl-border) / 0.5).",
    " */",
    common,
    modeBlock(":root", "light", shellColors(sources.light, "buzz"), lightStatic, null),
    // Buzz Dark paints the content area with its warmer neutral canvas; an
    // embedded page sits on that canvas, so its background is the same value.
    modeBlock(":root[data-kailo-theme=\"dark\"]", "dark", shellColors(sources.dark, "buzz-dark"), darkStatic, contentDark),
    "",
  ].join("\n");
}
