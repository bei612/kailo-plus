// DD-133: client-kit/embed/kailo-theme-tokens.css is generated from the shell's
// own theme sources. This test regenerates it and fails on any drift; with
// KAILO_WRITE_EMBED_TOKENS=1 it rewrites the committed file instead.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import githubDark from "shiki/themes/github-dark.mjs";
import githubLight from "shiki/themes/github-light.mjs";
import { describe, expect, it } from "vitest";
import { createThemeVars } from "../src/theme/adaptive-theme";
import { EMBED_COLOR_TOKENS, renderEmbedTokenCss } from "../src/theme/embed-tokens";
import { extractThemeInfo } from "../src/theme/theme-loader";

// Plain paths: Vite rewrites `new URL(literal, import.meta.url)` into served asset URLs.
const here = dirname(fileURLToPath(import.meta.url));
const text = (path: string) => readFileSync(resolve(here, path), "utf8");
const target = resolve(here, "../../../embed/kailo-theme-tokens.css");

function render() {
  return renderEmbedTokenCss({
    themeCss: text("../src/theme.css"),
    typographyCss: text("../src/typography.css"),
    tailwindConfig: text("../src/tailwind.config.js"),
    light: githubLight,
    dark: githubDark,
  });
}

function section(css: string, marker: string): Map<string, string> {
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("}", start));
  return new Map([...body.matchAll(/(--kailo-[a-z0-9-]+): ([^;]+);/g)].map((m) => [m[1]!, m[2]!]));
}

describe("DD-133 distributable theme tokens", () => {
  it("matches the committed kailo-theme-tokens.css", () => {
    const generated = render();
    if (process.env.KAILO_WRITE_EMBED_TOKENS === "1") writeFileSync(target, generated);
    expect(readFileSync(target, "utf8")).toBe(generated);
  });

  it("carries the colors the shell applies for buzz / buzz-dark and the dark content canvas", () => {
    const css = render();
    const common = section(css, ":root {\n  --kailo-font-sans");
    const lightMode = section(css, ":root {\n  color-scheme: light;");
    const dark = section(css, ':root[data-kailo-theme="dark"] {');
    const lightInfo = extractThemeInfo("buzz", githubLight);
    const lightVars = createThemeVars(lightInfo.bg, lightInfo.fg, lightInfo.comment).vars;
    const darkInfo = extractThemeInfo("buzz-dark", githubDark);
    const darkVars = createThemeVars(darkInfo.bg, darkInfo.fg, darkInfo.comment).vars;
    expect(lightMode.get("--kailo-hsl-foreground")).toBe(lightVars["--foreground"]);
    expect(lightMode.get("--kailo-hsl-background")).toBe(lightVars["--background"]);
    // Neutral accent: Buzz themes pin primary to the foreground.
    expect(lightMode.get("--kailo-hsl-primary")).toBe(lightVars["--foreground"]);
    expect(dark.get("--kailo-hsl-foreground")).toBe(darkVars["--foreground"]);
    expect(dark.get("--kailo-hsl-card")).toBe(darkVars["--background"]);
    expect(dark.get("--kailo-hsl-background")).toBe("0 0% 10.1960784314%");
    for (const token of EMBED_COLOR_TOKENS) {
      expect(lightMode.has(`--kailo-hsl-${token}`)).toBe(true);
      expect(dark.has(`--kailo-hsl-${token}`)).toBe(true);
      expect(common.get(`--kailo-color-${token}`)).toBe(`hsl(var(--kailo-hsl-${token}))`);
    }
    expect(common.get("--kailo-font-sans")).toContain('"Inter Variable"');
    expect(common.get("--kailo-font-size-sm")).toBe("0.875rem");
    expect(common.get("--kailo-radius-md")).toBe("calc(0.625rem - 2px)");
  });
});
