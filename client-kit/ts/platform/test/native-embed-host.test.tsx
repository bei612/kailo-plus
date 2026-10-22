// DD-133 host half: launch presentation on the approved URL, the exact-origin
// postMessage handshake and the top-level sign-in request (V-SCN-191..193).
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { NativeApplicationPage } from "../src/react/native-application-page";
import { embedRequest, nativeEmbedUrl, presentationMessage } from "../src/react/native-embed-host";
import { button, click, render, settle } from "./render";

const page = { bindingId: "binding-fixture", projectionGeneration: 4,
  url: "https://files.example.test/app/#/folder", origin: "https://files.example.test",
  allowedOrigins: ["https://files.example.test"] };

async function mount(extra: { reauthenticateTopLevel?: () => void; locale?: "en" | "zh-CN" } = {}) {
  const client = createBffClient({ send: async () => ({ status: 200, body: page }) });
  const host = await render(<PlatformProvider client={client} locale={extra.locale ?? "en"}
    reauthenticateTopLevel={extra.reauthenticateTopLevel}>
    <NativeApplicationPage bindingId={page.bindingId} onBack={() => {}} />
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

afterEach(() => { document.documentElement.classList.remove("dark"); });

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
    expect(host.textContent).toContain("登录服务");
    await fromFrame(target, { source: "kailo-embed", version: 1, type: "ready" });
    expect(posted).toHaveBeenLastCalledWith(presentationMessage({ theme: "dark", locale: "zh-CN" }), page.origin);
    // A speaking component manages its own silent SSO: no Kailo sign-in button or boundary note.
    expect(host.textContent).not.toContain("登录服务");
    await act(async () => { document.documentElement.classList.remove("dark"); });
    await settle();
    expect(posted).toHaveBeenLastCalledWith(presentationMessage({ theme: "light", locale: "zh-CN" }), page.origin);
    expect(host.querySelector("iframe")).toBe(frame);
    expect(frame.getAttribute("src")).toContain("kailo_theme=dark");
    expect(posted.mock.calls.every(([, origin]) => origin === page.origin)).toBe(true);
  });

  it("ignores messages from another origin or another window", async () => {
    const { host, target, posted } = await mount();
    await fromFrame(target, { source: "kailo-embed", version: 1, type: "ready" }, "https://evil.example.test");
    await fromFrame(window, { source: "kailo-embed", version: 1, type: "ready" });
    await fromFrame(target, { source: "kailo-embed", version: 1, type: "auth-required" }, "https://evil.example.test");
    expect(posted).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(button(host, "Sign in to service")).toBeTruthy();
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
