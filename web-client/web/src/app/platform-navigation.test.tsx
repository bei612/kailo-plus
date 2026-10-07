// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { platformLocationSearch, usePlatformNavigation } from "./platform-navigation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(window, "scrollTo", { value: vi.fn(), configurable: true });

const state = vi.hoisted(() => ({ mounts: 0 }));
vi.mock("@/platform/ui/PlatformApp", () => ({ PlatformApp: function Host() {
  const navigation = usePlatformNavigation();
  const [mount] = useState(() => ++state.mounts);
  return <div data-tab={navigation.tab} data-mount={mount} data-workspace={navigation.workspaceId}
    data-conversation={navigation.conversationId} data-application={navigation.applicationBindingId}>
    <button onClick={() => { void navigation.openTab("audit", navigation.workspaceId); }}>audit</button>
    <button onClick={() => { void navigation.openTab("settings", navigation.workspaceId); }}>settings</button>
    <button onClick={() => { void navigation.openTab("agents", "workspace-b"); }}>agents</button>
    <button onClick={() => { void navigation.openTab("workflows", "workspace-b"); }}>workflows</button>
    <button onClick={() => { void navigation.openApplication("binding-a", "workspace-a"); }}>application</button>
  </div>;
} }));

let root: Root | undefined;
let node: HTMLDivElement | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; node?.remove(); node = undefined; });

async function mount(url: string) {
  const history = createMemoryHistory({ initialEntries: [url] });
  const router = createRouter({ routeTree, history, basepath: "/app", defaultPendingMinMs: 0 });
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  await act(async () => { await router.load(); root!.render(<RouterProvider router={router} />); });
  return router;
}

it("keeps the original host mounted and restores the audit URL after a full document reload", async () => {
  const router = await mount("/app/channels/workspace-a");
  const mountId = node!.querySelector("[data-tab]")?.getAttribute("data-mount");
  await act(async () => { (node!.querySelector("button") as HTMLButtonElement).click(); });
  expect(router.history.location.pathname).toBe("/app/audit");
  expect(node!.querySelector("[data-tab]")?.getAttribute("data-tab")).toBe("audit");
  expect(node!.querySelector("[data-tab]")?.getAttribute("data-mount")).toBe(mountId);
  const returnUrl = router.history.location.href;
  await act(async () => root!.unmount()); root = undefined; node!.remove();
  await mount(returnUrl);
  expect(node!.querySelector("[data-tab]")?.getAttribute("data-tab")).toBe("audit");
  expect(node!.querySelector("[data-tab]")?.getAttribute("data-workspace")).toBe("workspace-a");
});

it("uses the same browser history for back and forward without changing the host", async () => {
  const router = await mount("/app/inbox");
  await act(async () => { (node!.querySelectorAll("button")[1] as HTMLButtonElement).click(); });
  expect(node!.querySelector("[data-tab]")?.getAttribute("data-tab")).toBe("settings");
  await act(async () => { router.history.back(); await router.load(); });
  expect(node!.querySelector("[data-tab]")?.getAttribute("data-tab")).toBe("inbox");
  await act(async () => { router.history.forward(); await router.load(); });
  expect(node!.querySelector("[data-tab]")?.getAttribute("data-tab")).toBe("settings");
});

it("restores only a conversation reference and rejects unregistered page names", async () => {
  await mount("/app/conversations/conversation-a");
  expect(node!.querySelector("[data-tab]")?.getAttribute("data-tab")).toBe("conversation");
  expect(node!.querySelector("[data-tab]")?.getAttribute("data-conversation")).toBe("conversation-a");
  await act(async () => root!.unmount()); root = undefined; node!.remove();
  await mount("/app/not-an-enabled-page");
  expect(node!.querySelector("[data-tab]")).toBeNull();
});

it("never stores identity, credentials or commands in navigation search", () => {
  const search = platformLocationSearch({ workspaceId: "workspace-a", tenantId: "other", token: "not-a-secret",
    command: { idempotencyKey: "not-an-intent" }, protocolBinding: "binding-a" });
  expect(search.workspaceId).toBe("workspace-a");
  expect(search.protocolBinding).toBe("binding-a");
  expect(search).not.toHaveProperty("tenantId");
  expect(search).not.toHaveProperty("token");
  expect(search).not.toHaveProperty("command");
});

it("routes the approved service binding in the same host and preserves its scope on reload", async () => {
  const router = await mount("/app/inbox");
  const mountId = node!.querySelector("[data-tab]")?.getAttribute("data-mount");
  await act(async () => { [...node!.querySelectorAll("button")].find((button) => button.textContent === "application")!.click(); });
  expect(router.history.location.pathname).toBe("/app/applications/binding-a");
  expect(node!.querySelector("[data-tab]")?.getAttribute("data-tab")).toBe("application");
  expect(node!.querySelector("[data-tab]")?.getAttribute("data-mount")).toBe(mountId);
  const url = router.history.location.href;
  await act(async () => { router.history.back(); await router.load(); });
  expect(node!.querySelector("[data-tab]")?.getAttribute("data-tab")).toBe("inbox");
  await act(async () => root!.unmount()); root = undefined; node!.remove();
  await mount(url);
  expect(node!.querySelector("[data-tab]")?.getAttribute("data-application")).toBe("binding-a");
  expect(node!.querySelector("[data-tab]")?.getAttribute("data-workspace")).toBe("workspace-a");
});

it.each(["agents", "workflows"])("keeps the %s workspace selection in the original URL across reload and history", async (section) => {
  const router = await mount(`/app/${section}?workspaceId=workspace-a`);
  const mountId = node!.querySelector("[data-tab]")?.getAttribute("data-mount");
  await act(async () => { [...node!.querySelectorAll("button")].find((button) => button.textContent === section)!.click(); });
  expect(router.history.location.search).toBe("?workspaceId=workspace-b");
  expect(node!.querySelector("[data-tab]")?.getAttribute("data-mount")).toBe(mountId);
  await act(async () => { router.history.back(); await router.load(); });
  expect(node!.querySelector("[data-tab]")?.getAttribute("data-workspace")).toBe("workspace-a");
  await act(async () => { router.history.forward(); await router.load(); });
  const url = router.history.location.href;
  await act(async () => root!.unmount()); root = undefined; node!.remove();
  await mount(url);
  expect(node!.querySelector("[data-tab]")?.getAttribute("data-workspace")).toBe("workspace-b");
});
