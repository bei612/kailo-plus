// DD-133 component half: client-kit/embed/kailo-embed.js, exercised as the
// plain script components load (V-SCN-191..193).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KailoEmbedRuntime, KailoPage } from "../../../embed/kailo-embed";

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../embed/kailo-embed.js"), "utf8");
const KAILO = "https://kailo.example.test";
const parentDescriptor = Object.getOwnPropertyDescriptor(window, "parent");
let host: HTMLIFrameElement | null = null;

function load(options: { search?: string; framed?: boolean; origins?: string; features?: string } = {}): KailoEmbedRuntime {
  window.history.replaceState(null, "", `/component/${options.search ?? ""}`);
  if (options.features !== undefined) {
    const declared = document.createElement("meta");
    declared.name = "kailo-embed-features";
    declared.content = options.features;
    document.head.append(declared);
  }
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
  for (const name of ["data-kailo-theme", "data-kailo-embedded", "data-kailo-runtime", "data-kailo-theme-switching", "lang", "style"])
    document.documentElement.removeAttribute(name);
  document.head.querySelectorAll('meta[name="kailo-web-origin"], meta[name="kailo-embed-features"]').forEach((meta) => meta.remove());
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
    expect(embed.getState()).toEqual({ theme: "dark", locale: "en", embedded: true, hostConnected: true, hostFeatures: [] });
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

  // DD-138 (07 §4.8.2, V-SCN-225): the values of the release's declared Kailo settings items.
  it("receives Kailo preferences, keeps them across a redirect and reports the changed keys", () => {
    const embed = load({ framed: true });
    expect(embed.getPreferences()).toEqual({});
    const seen: Array<[Record<string, unknown>, string[]]> = [];
    embed.onPreferencesChange((values, changed) => seen.push([values, changed]));
    const events: string[][] = [];
    window.addEventListener("kailo:preferences", (event) => events.push((event as CustomEvent).detail.changed));
    fromParent({ source: "kailo-host", version: 1, type: "preferences", values: { "documents.measurementUnit": "pt", "documents.spellcheck": true } });
    expect(embed.getPreferences()).toEqual({ "documents.measurementUnit": "pt", "documents.spellcheck": true });
    fromParent({ source: "kailo-host", version: 1, type: "preferences", values: { "documents.measurementUnit": "pt", "documents.spellcheck": false } });
    expect(seen.map(([, changed]) => changed)).toEqual([["documents.measurementUnit", "documents.spellcheck"], ["documents.spellcheck"]]);
    expect(events.at(-1)).toEqual(["documents.spellcheck"]);
    // A returned copy cannot change the runtime's values.
    embed.getPreferences()["documents.spellcheck"] = true;
    expect(embed.getPreferences()["documents.spellcheck"]).toBe(false);
    // Preferences are not presentation: theme and locale stay as they were.
    expect(embed.getState().hostConnected).toBe(false);
    delete window.KailoEmbed;
    expect(load({ framed: true }).getPreferences()).toEqual({ "documents.measurementUnit": "pt", "documents.spellcheck": false });
  });

  it("rejects preferences from another origin or window and any malformed message as a whole", () => {
    const embed = load({ framed: true });
    const changed = vi.fn();
    embed.onPreferencesChange(changed);
    const good = { "documents.spellcheck": false };
    fromParent({ source: "kailo-host", version: 1, type: "preferences", values: good }, "https://evil.example.test");
    fromParent({ source: "kailo-host", version: 1, type: "preferences", values: good }, KAILO, window);
    fromParent({ source: "kailo-host", version: 2, type: "preferences", values: good });
    for (const values of [null, ["documents.spellcheck"], { "documents.spellcheck": false, "Bad Key": true },
      { "documents.note": "free text with spaces" }, { "documents.zoom": 100 }, { "documents.spellcheck": null },
      Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`documents.flag${i}`, true]))])
      fromParent({ source: "kailo-host", version: 1, type: "preferences", values });
    expect(changed).not.toHaveBeenCalled();
    expect(embed.getPreferences()).toEqual({});
  });

  it("ignores preferences on a top-level visit (no Kailo host)", () => {
    const embed = load();
    fromParent({ source: "kailo-host", version: 1, type: "preferences", values: { "documents.spellcheck": false } }, KAILO, window);
    expect(embed.getPreferences()).toEqual({});
  });
});

// DD-157 (07 §4.8.7, V-SCN-257..259): page shell API.
describe("kailo-embed.js page shell (DD-157)", () => {
  function framedWithSpy(features = "page toast confirm shortcuts") {
    host = document.createElement("iframe");
    document.body.append(host);
    const posted = vi.spyOn(host.contentWindow!, "postMessage");
    const embed = load({ framed: true, features });
    return { embed, posted };
  }
  const connect = (features = ["page", "toast", "confirm", "shortcuts", "files"]) =>
    fromParent({ source: "kailo-host", version: 1, type: "presentation", theme: "light", locale: "zh-CN", features });
  const page: KailoPage & { actions: NonNullable<KailoPage["actions"]> } = { title: "季度报告", breadcrumbs: [{ id: "/ws/a", label: "个人文件" }], tabs: [{ id: "home", label: "主页" }, { id: "all", label: "所有文件" }],
    activeTab: "all", actions: [{ id: "upload", label: "上传", variant: "primary", icon: "upload" }, { id: "mkdir", label: "新建文件夹" }] };

  it("announces the declared features in ready and marks the Kailo runtime", () => {
    const { embed, posted } = framedWithSpy("page toast bogus page");
    expect(embed.features).toEqual(["page", "toast"]);
    expect(posted).toHaveBeenCalledWith({ source: "kailo-embed", version: 1, type: "ready", features: ["page", "toast"] }, KAILO);
    expect(document.documentElement.hasAttribute("data-kailo-runtime")).toBe(true);
  });

  it("sends a validated page header and re-sends it when Kailo first answers", () => {
    const { embed, posted } = framedWithSpy();
    expect(embed.setPage(page)).toBe(true);
    const sent = { source: "kailo-embed", version: 1, type: "page",
      page: { ...page, actions: [page.actions[0]!, { id: "mkdir", label: "新建文件夹", variant: "secondary" }] } };
    expect(posted).toHaveBeenLastCalledWith(sent, KAILO);
    posted.mockClear();
    connect();
    expect(posted).toHaveBeenCalledWith(sent, KAILO);
    expect(() => embed.setPage({ title: "" })).toThrow(TypeError);
    expect(() => embed.setPage({ ...page, activeTab: "missing" })).toThrow(TypeError);
    expect(() => embed.setPage({ ...page, actions: [page.actions[0]!, { ...page.actions[0]!, id: "b" }] })).toThrow(TypeError);
    expect(() => embed.setPage({ title: "x", actions: [{ id: "a", label: "a", icon: "skull" as never }] })).toThrow(TypeError);
    expect(() => embed.setPage({ title: "x", actions: [{ id: "a", label: "one" }, { id: "a", label: "two" }] })).toThrow(TypeError);
    for (const control of ["\t", "\n", "\r", "\f", "\v"]) {
      expect(() => embed.setPage({ ...page, title: `a${control}b` })).toThrow(TypeError);
      expect(embed.toast({ title: "x", description: `a${control}b` })).toBe(false);
      expect(embed.confirm({ title: "x", confirmLabel: `a${control}b` })).toBeNull();
    }
  });

  it("stops claiming the header once an older Kailo answers without announcing it", () => {
    const { embed } = framedWithSpy();
    expect(embed.setPage(page)).toBe(true);
    connect([]);
    expect(embed.hostSupports("page")).toBe(false);
    expect(embed.setPage(page)).toBe(false);
    expect(embed.toast({ title: "已上传" })).toBe(false);
    expect(document.documentElement.getAttribute("data-kailo-host-features")).toBe("");
  });

  it("does nothing for pages that did not declare the feature", () => {
    const { embed } = framedWithSpy("toast");
    expect(embed.setPage(page)).toBe(false);
    expect(embed.confirm({ title: "删除？" })).toBeNull();
  });

  it("delivers navigate and action only for ids of the current header", () => {
    const { embed } = framedWithSpy();
    const navigations: unknown[] = [];
    const actions: string[] = [];
    embed.onNavigate((target) => navigations.push(target));
    embed.onAction((id) => actions.push(id));
    embed.setPage(page);
    fromParent({ source: "kailo-host", version: 1, type: "navigate", target: { kind: "tab", id: "home" } });
    fromParent({ source: "kailo-host", version: 1, type: "navigate", target: { kind: "tab", id: "/ws/a" } });
    fromParent({ source: "kailo-host", version: 1, type: "navigate", target: { kind: "breadcrumb", id: "/ws/a" } });
    fromParent({ source: "kailo-host", version: 1, type: "action", id: "upload" });
    fromParent({ source: "kailo-host", version: 1, type: "action", id: "rm -rf" });
    fromParent({ source: "kailo-host", version: 1, type: "action", id: "upload" }, "https://evil.example.test");
    embed.setPage({ ...page, actions: [{ ...page.actions[0]!, busy: true }] });
    fromParent({ source: "kailo-host", version: 1, type: "action", id: "upload" });
    embed.setPage({ ...page, actions: [{ ...page.actions[0]!, disabled: true }] });
    fromParent({ source: "kailo-host", version: 1, type: "action", id: "upload" });
    expect(navigations).toEqual([{ kind: "tab", id: "home" }, { kind: "breadcrumb", id: "/ws/a" }]);
    expect(actions).toEqual(["upload"]);
  });

  it("delivers files chosen in Kailo only to an action that declared them", () => {
    const { embed } = framedWithSpy();
    const seen: unknown[] = [];
    embed.onAction((id, selection) => seen.push([id, selection?.paths ?? null]));
    embed.setPage({ title: "x", actions: [{ id: "upload", label: "上传", variant: "primary", files: { multiple: true, accept: ".pdf,image/*" } },
      { id: "mkdir", label: "新建文件夹" }] });
    const file = new File(["a"], "a.pdf");
    fromParent({ source: "kailo-host", version: 1, type: "action", id: "upload", files: [file, new File(["b"], "b.pdf")], paths: ["a.pdf", "b.pdf"] });
    fromParent({ source: "kailo-host", version: 1, type: "action", id: "mkdir", files: [file] });
    fromParent({ source: "kailo-host", version: 1, type: "action", id: "upload", files: ["not a file"] });
    fromParent({ source: "kailo-host", version: 1, type: "action", id: "upload", files: [file], paths: ["a\u0000"] });
    fromParent({ source: "kailo-host", version: 1, type: "action", id: "mkdir" });
    expect(seen).toEqual([["upload", ["a.pdf", "b.pdf"]], ["mkdir", null]]);
    expect(() => embed.setPage({ title: "x", actions: [{ id: "u", label: "u", files: { accept: "<script>" } }] })).toThrow(TypeError);
  });

  it("delivers a file action without files from a Kailo that has no file channel, and only then", () => {
    const { embed } = framedWithSpy();
    const seen: unknown[] = [];
    embed.onAction((id, selection) => seen.push([id, selection ?? null]));
    embed.setPage({ title: "x", actions: [{ id: "upload", label: "上传", files: { multiple: true } }] });
    connect(["page", "toast", "confirm", "shortcuts", "files"]);
    fromParent({ source: "kailo-host", version: 1, type: "action", id: "upload" });
    expect(seen).toEqual([]);
    connect(["page", "toast", "confirm", "shortcuts"]);
    fromParent({ source: "kailo-host", version: 1, type: "action", id: "upload" });
    expect(seen).toEqual([["upload", null]]);
  });

  it("hands toasts and confirmations to Kailo once connected, and resolves the confirmation from its answer", async () => {
    const { embed, posted } = framedWithSpy();
    expect(embed.toast({ tone: "success", title: "已上传" })).toBe(false);
    expect(embed.confirm({ title: "删除？" })).toBeNull();
    connect();
    expect(embed.toast({ tone: "success", title: "已上传", description: "3 个文件" })).toBe(true);
    expect(posted).toHaveBeenLastCalledWith({ source: "kailo-embed", version: 1, type: "toast",
      toast: { tone: "success", title: "已上传", description: "3 个文件" } }, KAILO);
    expect(embed.toast({ tone: "loud" as never, title: "x" })).toBe(false);
    const answer = embed.confirm({ tone: "danger", title: "删除 3 个文件？", confirmLabel: "删除" })!;
    const request = (posted.mock.lastCall![0] as { confirm: { id: string } }).confirm;
    expect(request).toMatchObject({ tone: "danger", title: "删除 3 个文件？", confirmLabel: "删除" });
    fromParent({ source: "kailo-host", version: 1, type: "confirm-result", id: "other", confirmed: true });
    fromParent({ source: "kailo-host", version: 1, type: "confirm-result", id: request.id, confirmed: true });
    await expect(answer).resolves.toBe(true);
  });

  it("forwards Kailo's global chords to Kailo before the page's own handlers", () => {
    const { posted } = framedWithSpy();
    const own = vi.fn();
    document.addEventListener("keydown", own);
    const ctrl = !/mac/i.test(navigator.platform);
    const event = new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: ctrl, metaKey: !ctrl, bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(own).not.toHaveBeenCalled();
    expect(posted).toHaveBeenLastCalledWith({ source: "kailo-embed", version: 1, type: "shortcut", shortcut: "search" }, KAILO);
    // Ordinary typing is untouched.
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "k", bubbles: true }));
    expect(own).toHaveBeenCalledOnce();
    document.removeEventListener("keydown", own);
  });

  it("switches theme without transitions for one frame", () => {
    framedWithSpy();
    fromParent({ source: "kailo-host", version: 1, type: "presentation", theme: "dark", locale: "zh-CN" });
    expect(document.documentElement.hasAttribute("data-kailo-theme-switching")).toBe(true);
  });
});
