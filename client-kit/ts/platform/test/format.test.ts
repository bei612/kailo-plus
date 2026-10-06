// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { relativeTime } from "../src/format";
import {
  type PlatformLocale,
  type PlatformThemeMode,
  platformCalendarWeekdayBandDays,
  platformPluralForm,
  platformThemeModeKeys,
  platformTimeSeconds,
  resolveLocale,
  translate,
} from "../src/i18n";

const now = Date.parse("2026-09-25T14:00:00Z");

function at(secondsFromNow: number): string {
  return new Date(now + secondsFromNow * 1_000).toISOString();
}

describe("shared platform relative time", () => {
  it("defaults to Chinese without a device choice and preserves explicit English", () => {
    expect(resolveLocale()).toBe("zh-CN");
    expect(resolveLocale([])).toBe("zh-CN");
    expect(resolveLocale(["fr-FR"])).toBe("zh-CN");
    expect(resolveLocale(["en-US", "zh-CN"])).toBe("en");
  });
  it("uses the same bounded units and plural forms for past and future", () => {
    expect(relativeTime("en", at(0), now)).toBe("now");
    expect(relativeTime("en", at(-1), now)).toBe("1 second ago");
    expect(relativeTime("en", at(-59), now)).toBe("59 seconds ago");
    expect(relativeTime("en", at(-60), now)).toBe("1 minute ago");
    expect(relativeTime("en", at(120), now)).toBe("in 2 minutes");
    expect(relativeTime("en", at(-3600), now)).toBe("1 hour ago");
    expect(relativeTime("en", at(-86400), now)).toBe("yesterday");
    expect(relativeTime("en", at(86400), now)).toBe("tomorrow");
    expect(relativeTime("en", at(-2592000), now)).toBe("last month");
  });

  it("renders Chinese without English plural suffixes and does not invert future time", () => {
    expect(relativeTime("zh-CN", at(-60), now)).toBe("1 分钟前");
    expect(relativeTime("zh-CN", at(120), now)).toBe("2 分钟后");
    expect(relativeTime("zh-CN", at(86400), now)).toBe("明天");
    expect(relativeTime("zh-CN", at(-2592000), now)).toBe("上个月");
  });

  it("renders an invalid timestamp as an explicit unavailable state", () => {
    expect(relativeTime("en", "invalid", now)).toBe("Time unavailable");
    expect(relativeTime("zh-CN", "invalid", now)).toBe("时间不可用");
  });
});

// 三端同源：Web 与 Desktop 调用这里的 TypeScript，Mobile 调用生成的 Dart；两套测试读同一份
// 手写期望（client-kit/test-vectors/presentation.json），任一侧偏离即失败。
const vectors = JSON.parse(
  readFileSync(new URL("../../../test-vectors/presentation.json", import.meta.url), "utf8"),
) as PresentationVectors;

type PresentationVectors = {
  calendarWeekdayBandDays: number;
  timeSeconds: Record<string, number>;
  relativeTime: {
    now: string;
    cases: Array<{ offsetSeconds: number } & Record<PlatformLocale, string>>;
    invalid: { input: string } & Record<PlatformLocale, string>;
  };
  pluralOne: Array<{ locale: PlatformLocale; count: number; one: boolean }>;
  localeResolution: Array<{ input: string; locale: PlatformLocale }>;
  themeModes: Array<{ mode: string } & Record<PlatformLocale, string>>;
};

const locales: PlatformLocale[] = ["en", "zh-CN"];

describe("presentation semantics shared with Mobile", () => {
  it("relative time matches the shared vectors in both locales", () => {
    const base = Date.parse(vectors.relativeTime.now);
    for (const c of vectors.relativeTime.cases) {
      const at = new Date(base + c.offsetSeconds * 1_000).toISOString();
      for (const locale of locales) expect(relativeTime(locale, at, base)).toBe(c[locale]);
    }
    for (const locale of locales) {
      expect(relativeTime(locale, vectors.relativeTime.invalid.input, base)).toBe(
        vectors.relativeTime.invalid[locale],
      );
    }
  });

  it("plural category, locale resolution and the calendar band match the shared vectors", () => {
    for (const c of vectors.pluralOne) {
      expect(platformPluralForm(c.locale, c.count) === "one").toBe(c.one);
    }
    for (const c of vectors.localeResolution) expect(resolveLocale([c.input])).toBe(c.locale);
    expect(platformCalendarWeekdayBandDays).toBe(vectors.calendarWeekdayBandDays);
    expect(platformTimeSeconds).toEqual(vectors.timeSeconds);
  });

  it("theme modes are exactly the shared set, each with its catalog label", () => {
    expect(Object.keys(platformThemeModeKeys)).toEqual(vectors.themeModes.map((m) => m.mode));
    for (const m of vectors.themeModes) {
      for (const locale of locales) {
        expect(translate(locale, platformThemeModeKeys[m.mode as PlatformThemeMode])).toBe(m[locale]);
      }
    }
  });
});
