// DD-133 host half: launch presentation on the approved URL, the exact-origin
// postMessage handshake and the top-level sign-in request (V-SCN-191..193).
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { NATIVE_HANDSHAKE_GRACE_MS, NativeApplicationPage } from "../src/react/native-application-page";
import { embedRequest, nativeEmbedUrl, preferencesMessage, presentationMessage } from "../src/react/native-embed-host";
import { COMPONENT_PREFERENCES_EVENT, COMPONENT_PREFERENCES_STORAGE_KEY } from "../src/component-preferences";
import { button, click, render, settle } from "./render";

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
