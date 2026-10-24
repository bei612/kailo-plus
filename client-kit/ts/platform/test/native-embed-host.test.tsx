// DD-133 host half: launch presentation on the approved URL, the exact-origin
// postMessage handshake and the top-level sign-in request (V-SCN-191..193).
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { NATIVE_HANDSHAKE_GRACE_MS, NativeApplicationPage } from "../src/react/native-application-page";
import { actionMessage, confirmResultMessage, embedMessage, embedRequest, nativeEmbedUrl, navigateMessage, preferencesMessage, presentationMessage } from "../src/react/native-embed-host";
import { COMPONENT_PREFERENCES_EVENT, COMPONENT_PREFERENCES_STORAGE_KEY } from "../src/component-preferences";
import { button, click, render, settle } from "./render";

const toasts = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

const page = { bindingId: "binding-fixture", projectionGeneration: 4,
  url: "https://files.example.test/app/#/folder", origin: "https://files.example.test",
  allowedOrigins: ["https://files.example.test"] };

const text = (zh: string, en: string) => ({ ZH_CN: zh, EN: en });
const unit = { key: "documents.measurementUnit", settingsCategory: "DOCUMENTS", valueType: "ENUM",
  options: [{ value: "cm", label: text("厘米", "Centimeters") }, { value: "pt", label: text("点", "Points") }],
  defaultValue: "cm", label: text("度量单位", "Measurement unit") };
const spell = { key: "documents.spellcheck", settingsCategory: "DOCUMENTS", valueType: "BOOLEAN", options: [],
  defaultValue: "true", label: text("拼写检查", "Spell checking") };

async function mount(extra: { reauthenticateTopLevel?: () => void; locale?: "en" | "zh-CN"; body?: object } = {}) {
  const client = createBffClient({ send: async () => ({ status: 200, body: extra.body ?? page }) });
  const host = await render(<PlatformProvider client={client} locale={extra.locale ?? "en"}
    reauthenticateTopLevel={extra.reauthenticateTopLevel}>
    <NativeApplicationPage bindingId={page.bindingId} />
  </PlatformProvider>);
  const frame = host.querySelector("iframe")!;
  const target = frame.contentWindow!;
  const posted = vi.spyOn(target, "postMessage").mockImplementation(() => {});
  return { host, frame, target, posted };
}

async function fromFrame(source: Window, data: unknown, origin = page.origin) {
  await act(async () => window.dispatchEvent(new MessageEvent("message", { data, origin, source })));
  await settle();
}

afterEach(() => {
  document.documentElement.classList.remove("dark");
  window.localStorage.clear();
  vi.useRealTimers();
});

describe("DD-133 component presentation host", () => {
  it("adds only the launch theme and locale to the approved URL", () => {
    const launch = new URL(nativeEmbedUrl(page.url, { theme: "dark", locale: "zh-CN" }));
    expect(launch.origin).toBe(page.origin);
    expect(launch.pathname).toBe("/app/");
    expect(launch.hash).toBe("#/folder");
    expect([...launch.searchParams]).toEqual([["kailo_theme", "dark"], ["kailo_locale", "zh-CN"]]);
  });

  it("accepts only versioned component requests", () => {
    expect(embedRequest({ source: "kailo-embed", version: 1, type: "ready" })).toBe("ready");
    expect(embedRequest({ source: "kailo-embed", version: 1, type: "auth-required" })).toBe("auth-required");
    for (const data of [null, "ready", { source: "kailo-embed", version: 2, type: "ready" },
      { source: "kailo-host", version: 1, type: "ready" }, { source: "kailo-embed", version: 1, type: "presentation" }])
      expect(embedRequest(data)).toBeNull();
  });

  it("launches with the applied theme and posts later changes without reloading the frame", async () => {
    document.documentElement.classList.add("dark");
    const { host, frame, target, posted } = await mount({ locale: "zh-CN" });
    expect(frame.getAttribute("src")).toBe("https://files.example.test/app/?kailo_theme=dark&kailo_locale=zh-CN#/folder");
    // DD-138: Kailo's loading state, not a sign-in button, while the page loads.
    expect(host.textContent).not.toContain("登录服务");
    expect(host.querySelector('[data-testid="native-page-loading"]')).not.toBeNull();
    await fromFrame(target, { source: "kailo-embed", version: 1, type: "ready" });
    expect(posted).toHaveBeenLastCalledWith(presentationMessage({ theme: "dark", locale: "zh-CN" }), page.origin);
    // A speaking component manages its own silent SSO: no Kailo sign-in button or boundary note.
    expect(host.textContent).not.toContain("登录服务");
    expect(host.querySelector('[data-testid="native-page-loading"]')).toBeNull();
    await act(async () => { document.documentElement.classList.remove("dark"); });
    await settle();
    expect(posted).toHaveBeenLastCalledWith(presentationMessage({ theme: "light", locale: "zh-CN" }), page.origin);
    expect(host.querySelector("iframe")).toBe(frame);
    expect(frame.getAttribute("src")).toContain("kailo_theme=dark");
    expect(posted.mock.calls.every(([, origin]) => origin === page.origin)).toBe(true);
  });

  it("ignores messages from another origin or another window", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { host, target, posted } = await mount();
    await fromFrame(target, { source: "kailo-embed", version: 1, type: "ready" }, "https://evil.example.test");
    await fromFrame(window, { source: "kailo-embed", version: 1, type: "ready" });
    await fromFrame(target, { source: "kailo-embed", version: 1, type: "auth-required" }, "https://evil.example.test");
    expect(posted).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    // Without a handshake within the grace period the page is a DD-127 page.
    await act(async () => { vi.advanceTimersByTime(NATIVE_HANDSHAKE_GRACE_MS); });
    await settle();
    expect(button(host, "Sign in to service")).toBeTruthy();
  });

  it("sends the page's declared preferences after ready and on every Kailo settings change (DD-138)", async () => {
    window.localStorage.setItem(COMPONENT_PREFERENCES_STORAGE_KEY, JSON.stringify({ "documents.measurementUnit": "pt", "other.key": true }));
    const { target, posted } = await mount({ body: { ...page, preferences: [unit, spell] } });
    await fromFrame(target, { source: "kailo-embed", version: 1, type: "ready" });
    // Only this page's declared keys; a missing value takes the declared default.
    expect(posted).toHaveBeenCalledWith(preferencesMessage({ "documents.measurementUnit": "pt", "documents.spellcheck": true }), page.origin);
    expect(posted.mock.calls.some(([data]) => JSON.stringify(data).includes("other.key"))).toBe(false);
    window.localStorage.setItem(COMPONENT_PREFERENCES_STORAGE_KEY, JSON.stringify({ "documents.measurementUnit": "inch", "documents.spellcheck": false }));
    await act(async () => { window.dispatchEvent(new Event(COMPONENT_PREFERENCES_EVENT)); });
    await settle();
    // "inch" is not a declared option: the default replaces it.
    expect(posted).toHaveBeenLastCalledWith(preferencesMessage({ "documents.measurementUnit": "cm", "documents.spellcheck": false }), page.origin);
    expect(posted.mock.calls.every(([, origin]) => origin === page.origin)).toBe(true);
  });

  it("sends no preferences message to a page that declares none", async () => {
    const { target, posted } = await mount();
    await fromFrame(target, { source: "kailo-embed", version: 1, type: "ready" });
    expect(posted.mock.calls.some(([data]) => (data as { type?: string }).type === "preferences")).toBe(false);
  });

  it("turns a component sign-in request into a user-triggered top-level sign-in", async () => {
    const reauthenticateTopLevel = vi.fn();
    const popup = vi.spyOn(window, "open").mockReturnValue(null);
    const { host, frame, target } = await mount({ reauthenticateTopLevel });
    await fromFrame(target, { source: "kailo-embed", version: 1, type: "ready" });
    await fromFrame(target, { source: "kailo-embed", version: 1, type: "auth-required" });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Sign in to Kailo again");
    expect(reauthenticateTopLevel).not.toHaveBeenCalled();
    await click(button(host, "Sign in again"));
    expect(reauthenticateTopLevel).toHaveBeenCalledOnce();
    expect(popup).not.toHaveBeenCalled();
    expect(host.querySelector("iframe")).toBe(frame);
    // The next document load re-announces itself and clears the request.
    await fromFrame(target, { source: "kailo-embed", version: 1, type: "ready" });
    expect(host.querySelector('[role="alert"]')).toBeNull();
    popup.mockRestore();
  });
});

// DD-152 (07 §4.8.7, V-SCN-251..253): Kailo draws the component page shell.
describe("DD-152 component page shell", () => {
  const ready = { source: "kailo-embed", version: 1, type: "ready", features: ["page", "toast", "confirm", "shortcuts"] };
  const header = { title: "季度报告", breadcrumbs: [{ id: "/ws/a", label: "个人文件" }],
    tabs: [{ id: "home", label: "主页" }, { id: "all", label: "所有文件" }], activeTab: "all",
    actions: [{ id: "upload", label: "上传", variant: "primary", icon: "upload" }, { id: "mkdir", label: "新建文件夹", variant: "secondary" }] };

  it("validates every page shell message whole", () => {
    expect(embedMessage(ready)).toEqual({ type: "ready", features: ["page", "toast", "confirm", "shortcuts"] });
    expect(embedMessage({ source: "kailo-embed", version: 1, type: "page", page: header })).toMatchObject({ type: "page", page: { title: "季度报告" } });
    for (const page of [{ title: "" }, { ...header, activeTab: "nope" }, { ...header, tabs: Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, label: "x" })) },
      { ...header, actions: [header.actions[0], { ...header.actions[0], id: "x" }] }, { title: "a\u0007b" }, { title: "x", actions: [{ id: "a", label: "a", icon: "skull" }] }])
      expect(embedMessage({ source: "kailo-embed", version: 1, type: "page", page })).toBeNull();
    expect(embedMessage({ source: "kailo-embed", version: 1, type: "toast", toast: { tone: "loud", title: "x" } })).toBeNull();
    expect(embedMessage({ source: "kailo-embed", version: 1, type: "shortcut", shortcut: "quit" })).toBeNull();
    expect(embedMessage({ source: "kailo-embed", version: 1, type: "confirm", confirm: { id: "../x", title: "x" } })).toBeNull();
  });

  it("keeps Kailo's skeleton until the first header, then renders it and relays clicks to the frame only", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { host, frame, target, posted } = await mount({ locale: "zh-CN" });
    await fromFrame(target, ready);
    expect(host.querySelector('[data-testid="native-page-loading"]')).not.toBeNull();
    expect(frame.className).toContain("invisible");
    await fromFrame(target, { source: "kailo-embed", version: 1, type: "page", page: header });
    expect(host.querySelector('[data-testid="native-page-loading"]')).toBeNull();
    expect(frame.className).not.toContain("invisible");
    const bar = host.querySelector('[data-testid="native-page-header"]')!;
    expect(bar.textContent).toContain("个人文件");
    expect(bar.querySelector('[aria-current="page"]')?.textContent).toContain("季度报告");
    await click(button(host, "上传"));
    expect(posted).toHaveBeenLastCalledWith(actionMessage("upload"), page.origin);
    await click(host.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="false"]')!);
    expect(posted).toHaveBeenLastCalledWith(navigateMessage("tab", "home"), page.origin);
    await click(button(host, "个人文件"));
    expect(posted).toHaveBeenLastCalledWith(navigateMessage("breadcrumb", "/ws/a"), page.origin);
    // The header from another window is ignored.
    await fromFrame(window, { source: "kailo-embed", version: 1, type: "page", page: { title: "伪造" } });
    expect(host.textContent).not.toContain("伪造");
  });

  it("does not wait for a header from a page that did not declare one", async () => {
    const { host, target } = await mount();
    await fromFrame(target, { source: "kailo-embed", version: 1, type: "ready" });
    expect(host.querySelector('[data-testid="native-page-loading"]')).toBeNull();
    // An undeclared page header is not drawn.
    await fromFrame(target, { source: "kailo-embed", version: 1, type: "page", page: header });
    expect(host.querySelector('[data-testid="native-page-tabs"]')).toBeNull();
  });

  it("shows component toasts through Kailo, merging repeats and capping bursts", async () => {
    Object.values(toasts).forEach((fn) => fn.mockClear());
    const { target } = await mount();
    await fromFrame(target, ready);
    const toast = (title: string) => fromFrame(target, { source: "kailo-embed", version: 1, type: "toast", toast: { tone: "success", title } });
    await toast("已上传");
    await toast("已上传");
    expect(toasts.success).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 8; i++) await toast(`第 ${i} 个`);
    expect(toasts.success).toHaveBeenCalledTimes(5);
  });

  it("answers a confirmation in Kailo's dialog and declines a second one while it is open", async () => {
    const { target, posted } = await mount({ locale: "zh-CN" });
    await fromFrame(target, ready);
    await fromFrame(target, { source: "kailo-embed", version: 1, type: "confirm", confirm: { id: "c1", tone: "danger", title: "删除 3 个文件？", confirmLabel: "删除" } });
    const dialog = document.querySelector('[data-testid="native-confirm-dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("删除 3 个文件？");
    await fromFrame(target, { source: "kailo-embed", version: 1, type: "confirm", confirm: { id: "c2", title: "另一个？" } });
    expect(posted).toHaveBeenLastCalledWith(confirmResultMessage("c2", false), page.origin);
    await click(button(dialog, "删除"));
    expect(posted).toHaveBeenLastCalledWith(confirmResultMessage("c1", true), page.origin);
    expect(document.querySelector('[data-testid="native-confirm-dialog"]')).toBeNull();
  });

  it("replays Kailo's chords pressed inside the frame on the host window", async () => {
    const { target } = await mount();
    await fromFrame(target, ready);
    const seen: KeyboardEvent[] = [];
    const listener = (event: KeyboardEvent) => seen.push(event);
    window.addEventListener("keydown", listener);
    await fromFrame(target, { source: "kailo-embed", version: 1, type: "shortcut", shortcut: "search" });
    window.removeEventListener("keydown", listener);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.key).toBe("k");
    expect(seen[0]!.ctrlKey || seen[0]!.metaKey).toBe(true);
  });
});
