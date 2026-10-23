// DD-133: client-kit/embed/kailo-theme-tokens.css is generated from the shell's
// own theme sources (DD-141: kailo-tokens.ts). This test regenerates it and
// fails on any drift; with KAILO_WRITE_EMBED_TOKENS=1 it rewrites the committed
// file instead.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EMBED_COLOR_TOKENS, renderEmbedTokenCss } from "../src/theme/embed-tokens";
import { kailoExtendedVars, kailoThemeVars } from "../src/theme/kailo-tokens";

// Plain paths: Vite rewrites `new URL(literal, import.meta.url)` into served asset URLs.
const here = dirname(fileURLToPath(import.meta.url));
const text = (path: string) => readFileSync(resolve(here, path), "utf8");
const target = resolve(here, "../../../embed/kailo-theme-tokens.css");

function render() {
  return renderEmbedTokenCss({
    typographyCss: text("../src/typography.css"),
    tailwindConfig: text("../src/tailwind.config.js"),
  });
}

function section(css: string, marker: string): Map<string, string> {
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("\n}", start));
  return new Map([...body.matchAll(/(--kailo-[a-z0-9-]+): ([^;]+);/g)].map((m) => [m[1]!, m[2]!]));
}

describe("DD-133 distributable theme tokens", () => {
  it("matches the committed kailo-theme-tokens.css", () => {
    const generated = render();
    if (process.env.KAILO_WRITE_EMBED_TOKENS === "1") writeFileSync(target, generated);
    expect(readFileSync(target, "utf8")).toBe(generated);
  });

  it("carries the Kailo colors the shell applies for the first-party light and dark theme", () => {
    const css = render();
    const common = section(css, ":root {\n  --kailo-font-sans");
    const lightMode = section(css, ":root {\n  color-scheme: light;");
    const dark = section(css, ':root[data-kailo-theme="dark"] {');
    const light = kailoThemeVars("light");
    const darkVars = kailoThemeVars("dark");
    expect(lightMode.get("--kailo-hsl-foreground")).toBe(light["--foreground"]);
    expect(lightMode.get("--kailo-hsl-background")).toBe(light["--background"]);
    // DD-141: primary is the Iris brand, not a neutral foreground.
    expect(lightMode.get("--kailo-hsl-primary")).toBe(light["--primary"]);
    expect(lightMode.get("--kailo-hsl-primary")).not.toBe(light["--foreground"]);
    expect(dark.get("--kailo-hsl-foreground")).toBe(darkVars["--foreground"]);
    expect(dark.get("--kailo-hsl-background")).toBe(darkVars["--background"]);
    expect(lightMode.get("--kailo-color-brand-600")).toBe(kailoExtendedVars("light")["--k-brand-600"]);
    expect(dark.get("--kailo-color-brand-500")).toBe(kailoExtendedVars("dark")["--k-brand-500"]);
    expect(dark.get("--kailo-color-selected")).toBe(kailoExtendedVars("dark")["--k-brand-soft"]);
    for (const token of EMBED_COLOR_TOKENS) {
      expect(lightMode.has(`--kailo-hsl-${token}`)).toBe(true);
      expect(dark.has(`--kailo-hsl-${token}`)).toBe(true);
      expect(common.get(`--kailo-color-${token}`)).toBe(`hsl(var(--kailo-hsl-${token}))`);
    }
    for (const name of ["success", "success-text", "success-soft", "warning-text", "warning-soft", "danger", "danger-text", "danger-soft", "info", "info-text", "info-soft"]) {
      expect(lightMode.has(`--kailo-color-${name}`)).toBe(true);
      expect(dark.has(`--kailo-color-${name}`)).toBe(true);
    }
    for (const step of ["xs", "sm", "md", "lg", "xl"]) {
      expect(lightMode.has(`--kailo-shadow-${step}`)).toBe(true);
      expect(dark.has(`--kailo-shadow-${step}`)).toBe(true);
    }
    expect(common.get("--kailo-font-sans")).toContain('"Inter Variable"');
    expect(common.get("--kailo-font-sans")).toContain('"Noto Sans CJK SC"');
    expect(common.get("--kailo-font-size-sm")).toBe("0.875rem");
    expect(common.get("--kailo-radius-md")).toBe("calc(0.5rem - 2px)");
    expect(common.get("--kailo-duration-base")).toBe("200ms");
  });
});
