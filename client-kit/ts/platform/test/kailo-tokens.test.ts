// DD-141: src/styles/kailo-tokens.css is rendered from src/theme/kailo-tokens.ts,
// the single source of Kailo design tokens. This test regenerates it and fails
// on drift (KAILO_WRITE_TOKENS=1 rewrites the committed file), and it holds the
// .design/20 §2.6 contrast table to WCAG AA for both modes.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KAILO_BRAND_DIRECTION, KAILO_DIRECTIONS, kailoRoles, renderKailoTokenCss, type KailoMode } from "../src/theme/kailo-tokens";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../src/styles/kailo-tokens.css");

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

describe("DD-141 Kailo design tokens", () => {
  it("matches the committed kailo-tokens.css", () => {
    const generated = renderKailoTokenCss();
    if (process.env.KAILO_WRITE_TOKENS === "1") writeFileSync(target, generated);
    expect(readFileSync(target, "utf8")).toBe(generated);
  });

  it("ships the Iris direction", () => {
    expect(KAILO_BRAND_DIRECTION).toBe("iris");
    expect(KAILO_DIRECTIONS.iris.brand[600]).toBe("#6d4fed");
  });

  for (const direction of Object.keys(KAILO_DIRECTIONS) as (keyof typeof KAILO_DIRECTIONS)[]) {
    for (const mode of ["light", "dark"] as KailoMode[]) {
      it(`keeps ${direction} ${mode} text roles at WCAG AA`, () => {
        const r = kailoRoles(mode, direction);
        const pairs: [string, string, string][] = [
          ["text/surface", r.text, r.surface], ["secondary/surface", r.textSecondary, r.surface],
          ["muted/surface", r.textMuted, r.surface], ["muted/sidebar", r.textMuted, r.sidebar],
          ["muted/overlay", r.textMuted, r.overlay], ["on-brand/brand", r.onBrand, r.brand],
          ["brand-text/surface", r.brandText, r.surface], ["selected", r.brandSoftText, r.brandSoft],
          ["success", r.successText, r.surface], ["warning", r.warningText, r.surface],
          ["danger", r.dangerText, r.surface], ["info", r.infoText, r.surface],
        ];
        for (const [name, fg, bg] of pairs) {
          expect(contrast(fg, bg), `${direction} ${mode} ${name}`).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }
});
