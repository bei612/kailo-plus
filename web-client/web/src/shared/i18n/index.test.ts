// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLocale, t } from "@/shared/i18n";
import { setLocale, platformLocaleStorageKey } from "@client-kit/platform/i18n";

afterEach(() => { vi.unstubAllGlobals(); localStorage.removeItem(platformLocaleStorageKey); });

describe("resolveLocale", () => {
  it("resolves an explicit Chinese locale", () => {
    expect(resolveLocale(["zh-Hans-CN", "en-US"])).toBe("zh-CN");
  });

  it("uses English when it is preferred, even with Chinese as a fallback", () => {
    expect(resolveLocale(["en-US", "zh-CN"])).toBe("en");
  });

  it("localizes the image preparation error in English and Chinese", () => {
    setLocale("en");
    expect(t("error.attachmentImagePrepare")).toBe("We couldn't prepare this image for upload.");
    setLocale("zh-CN");
    expect(t("error.attachmentImagePrepare")).toBe("无法处理此图片以上传。");
  });
  it("does not let browser English override the Chinese default", () => {
    localStorage.removeItem(platformLocaleStorageKey);
    vi.stubGlobal("navigator", { language: "en-US", languages: ["en-US"] });
    expect(resolveLocale()).toBe("zh-CN");
  });
});
