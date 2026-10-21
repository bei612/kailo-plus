// DD-133 component half: client-kit/embed/kailo-embed.js, exercised as the
// plain script components load (V-SCN-191..193).
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KailoEmbedRuntime } from "../../../embed/kailo-embed";

const source = readFileSync(new URL("../../../embed/kailo-embed.js", import.meta.url), "utf8");
const KAILO = "https://kailo.example.test";
const parentDescriptor = Object.getOwnPropertyDescriptor(window, "parent");
let host: HTMLIFrameElement | null = null;

function load(options: { search?: string; framed?: boolean; origins?: string } = {}): KailoEmbedRuntime {
  window.history.replaceState(null, "", `/component/${options.search ?? ""}`);
  const meta = document.createElement("meta");
  meta.name = "kailo-web-origin";
  meta.content = options.origins ?? KAILO;
  document.head.append(meta);
  if (options.framed) {
    if (!host) {
      host = document.createElement("iframe");
      document.body.append(host);
    }
    Object.defineProperty(window, "parent", { configurable: true, get: () => host!.contentWindow });
  }
  new Function(source)();
  return window.KailoEmbed!;
}

function fromParent(data: unknown, origin = KAILO, from: Window | null = host?.contentWindow ?? null) {
  window.dispatchEvent(new MessageEvent("message", { data, origin, source: from }));
}

beforeEach(() => {
  delete window.KailoEmbed;
  window.sessionStorage.clear();
  for (const name of ["data-kailo-theme", "data-kailo-embedded", "lang", "style"])
    document.documentElement.removeAttribute(name);
  document.head.querySelectorAll('meta[name="kailo-web-origin"]').forEach((meta) => meta.remove());
});

afterEach(() => {
  if (parentDescriptor) Object.defineProperty(window, "parent", parentDescriptor);
  host?.remove();
  host = null;
});

describe("kailo-embed.js", () => {
  it("applies the launch parameters before first paint and keeps them across a redirect", () => {
    const embed = load({ search: "?kailo_theme=dark&kailo_locale=en" });
    expect(document.documentElement.getAttribute("data-kailo-theme")).toBe("dark");
    expect(document.documentElement.lang).toBe("en");
    expect(embed.getState()).toEqual({ theme: "dark", locale: "en", embedded: false, hostConnected: false });
    // An OIDC callback drops the query string; the tab keeps what Kailo sent.
    delete window.KailoEmbed;
    expect(load().getState()).toMatchObject({ theme: "dark", locale: "en" });
  });

  it("rejects unknown launch values and falls back to the device defaults", () => {
    const embed = load({ search: "?kailo_theme=solarized&kailo_locale=fr" });
    expect(embed.getState()).toMatchObject({ theme: "light", locale: "zh-CN" });
    expect(document.documentElement.hasAttribute("data-kailo-theme")).toBe(false);
  });

  it("marks the embedded document and follows the Kailo presentation", () => {
    const embed = load({ framed: true, search: "?kailo_theme=light&kailo_locale=zh-CN" });
    expect(document.documentElement.hasAttribute("data-kailo-embedded")).toBe(true);
    const themes: string[] = [];
    const locales: string[] = [];
    embed.onThemeChange((theme) => themes.push(theme));
    embed.onLocaleChange((locale) => locales.push(locale));
    fromParent({ source: "kailo-host", version: 1, type: "presentation", theme: "dark", locale: "en" });
    expect(themes).toEqual(["dark"]);
    expect(locales).toEqual(["en"]);
    expect(embed.getState()).toEqual({ theme: "dark", locale: "en", embedded: true, hostConnected: true });
    expect(document.documentElement.getAttribute("data-kailo-theme")).toBe("dark");
  });

  it("ignores another origin, another window and malformed presentation", () => {
    const embed = load({ framed: true });
    const changed = vi.fn();
    embed.onChange(changed);
    fromParent({ source: "kailo-host", version: 1, type: "presentation", theme: "dark", locale: "en" }, "https://evil.example.test");
    fromParent({ source: "kailo-host", version: 1, type: "presentation", theme: "dark", locale: "en" }, KAILO, window);
    fromParent({ source: "kailo-host", version: 2, type: "presentation", theme: "dark", locale: "en" });
    fromParent({ source: "kailo-host", version: 1, type: "presentation", theme: "sepia", locale: "en" });
    expect(changed).not.toHaveBeenCalled();
    expect(embed.getState().hostConnected).toBe(false);
  });

  it("posts ready and auth-required with the exact Kailo origin, never a wildcard", () => {
    host = document.createElement("iframe");
    document.body.append(host);
    const posted = vi.spyOn(host.contentWindow!, "postMessage");
    const embed = load({ framed: true, origins: `${KAILO} not-an-origin https://kailo.example.test/path` });
    expect(posted).toHaveBeenCalledTimes(1);
    expect(posted).toHaveBeenCalledWith({ source: "kailo-embed", version: 1, type: "ready" }, KAILO);
    expect(embed.requestTopLevelSignIn()).toBe(true);
    expect(posted).toHaveBeenLastCalledWith({ source: "kailo-embed", version: 1, type: "auth-required" }, KAILO);
  });

  it("lets the identity locale seed only a top-level visit without a Kailo value", () => {
    expect(load().useIdentityLocale("en")).toBe(true);
    expect(window.KailoEmbed!.getState().locale).toBe("en");
    window.sessionStorage.clear();
    delete window.KailoEmbed;
    expect(load({ search: "?kailo_locale=zh-CN" }).useIdentityLocale("en")).toBe(false);
    expect(window.KailoEmbed!.getState().locale).toBe("zh-CN");
  });
});
