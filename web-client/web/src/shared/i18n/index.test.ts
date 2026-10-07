// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLocale, t, initializeDocumentLanguage } from "@/shared/i18n";
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
  it("projects the existing device choice to OIDC without reading a cookie as authority", () => {
    document.head.innerHTML = '<meta name="platform-display-name" content="Kailo">';
    localStorage.removeItem(platformLocaleStorageKey);
    document.cookie = `${platformLocaleStorageKey}=en; Path=/`;
    initializeDocumentLanguage();
    expect(document.cookie).toContain(`${platformLocaleStorageKey}=zh-CN`);
    setLocale("en");
    expect(document.cookie).toContain(`${platformLocaleStorageKey}=en`);
    setLocale("zh-CN");
    expect(document.cookie).toContain(`${platformLocaleStorageKey}=zh-CN`);
    localStorage.removeItem(platformLocaleStorageKey);
    window.dispatchEvent(new StorageEvent("storage", { key: platformLocaleStorageKey }));
    expect(document.cookie).toContain(`${platformLocaleStorageKey}=zh-CN`);
    expect(document.cookie).not.toContain("token");
  });
});
