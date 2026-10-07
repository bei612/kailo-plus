// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { platformLocationSearch, usePlatformNavigation } from "./platform-navigation";
import { useHistoryShortcuts, useHomeShortcut } from "@client-kit/platform/react/use-navigation-shortcuts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(window, "scrollTo", { value: vi.fn(), configurable: true });

const state = vi.hoisted(() => ({ mounts: 0 }));
vi.mock("@/platform/ui/PlatformApp", () => ({ PlatformApp: function Host() {
  const navigation = usePlatformNavigation();
  useHomeShortcut({ disabled: navigation.tab === "settings", onGoHome: () => navigation.openTab("inbox", navigation.workspaceId) });
  useHistoryShortcuts({ goBack: navigation.goBack, goForward: navigation.goForward });
  const [mount] = useState(() => ++state.mounts);
  return <div data-tab={navigation.tab} data-mount={mount} data-workspace={navigation.workspaceId}
    data-conversation={navigation.conversationId} data-application={navigation.applicationBindingId} data-project={navigation.projectId} data-message={navigation.messageTarget?.messageId}>
    <button onClick={() => { void navigation.openTab("audit", navigation.workspaceId); }}>audit</button>
    <button onClick={() => { void navigation.openTab("settings", navigation.workspaceId); }}>settings</button>
    <button onClick={() => { void navigation.openTab("agents", "workspace-b"); }}>agents</button>
    <button onClick={() => { void navigation.openTab("workflows", "workspace-b"); }}>workflows</button>
    <button onClick={() => { void navigation.openApplication("binding-a", "workspace-a"); }}>application</button>
    <button onClick={() => { void navigation.openProject("signed-project"); }}>project</button>
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

it.each(["MacIntel", "Win32"])("drives real URL history and Home from original %s shortcuts", async (platform) => {
  const platformSpy = vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
  try {
    const router = await mount("/app/channels/workspace-a");
    const mountId = node!.querySelector("[data-tab]")?.getAttribute("data-mount");
    const press = async (init: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", { cancelable: true, ...init });
      await act(async () => { window.dispatchEvent(event); await router.load(); });
      return event;
    };
    const mac = platform === "MacIntel";
    const home = { key: "A", shiftKey: true, metaKey: mac, ctrlKey: !mac };
    const back = mac ? { key: "[", metaKey: true } : { key: "ArrowLeft", altKey: true };
    const forward = mac ? { key: "]", metaKey: true } : { key: "ArrowRight", altKey: true };
    await press(back); // No prior admitted app history: remain in this channel.
    expect(router.history.location.pathname).toBe("/app/channels/workspace-a");
    expect((await press(home)).defaultPrevented).toBe(true);
    expect(router.history.location.pathname).toBe("/app/inbox");
    expect(node!.querySelector("[data-tab]")?.getAttribute("data-workspace")).toBe("workspace-a");
    await press(back);
    expect(router.history.location.pathname).toBe("/app/channels/workspace-a");
    await press(forward);
    expect(router.history.location.pathname).toBe("/app/inbox");
    expect(node!.querySelector("[data-tab]")?.getAttribute("data-mount")).toBe(mountId);
    await act(async () => { (node!.querySelectorAll("button")[1] as HTMLButtonElement).click(); });
    expect((await press(home)).defaultPrevented).toBe(false);
    expect(router.history.location.pathname).toBe("/app/settings");
  } finally { platformSpy.mockRestore(); }
});

it("restores only a conversation reference and rejects unregistered page names", async () => {
  await mount("/app/conversations/conversation-a");
  expect(node!.querySelector("[data-tab]")?.getAttribute("data-tab")).toBe("conversation");
  expect(node!.querySelector("[data-tab]")?.getAttribute("data-conversation")).toBe("conversation-a");
  await act(async () => root!.unmount()); root = undefined; node!.remove();
  await mount("/app/not-an-enabled-page");
  expect(node!.querySelector("[data-tab]")).toBeNull();
});

it("restores the selected hidden-DM Inbox message from the original conversation URL",async()=>{
  await mount("/app/conversations/conversation-a?messageId=selected-message&threadRootId=thread-root");
  expect(node!.querySelector("[data-tab]")?.getAttribute("data-conversation")).toBe("conversation-a");
  expect(node!.querySelector("[data-tab]")?.getAttribute("data-message")).toBe("selected-message");
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

it("opens the actual selected project through the existing route and restores it after reload",async()=>{
  const router=await mount("/app/inbox");
  await act(async()=>{[...node!.querySelectorAll("button")].find(button=>button.textContent==="project")!.click();});
  expect(router.history.location.pathname).toBe("/app/projects");
  expect(node!.querySelector("[data-project]")?.getAttribute("data-project")).toBe("signed-project");
  const url=router.history.location.href;
  await act(async()=>root!.unmount());root=undefined;node!.remove();
  await mount(url);
  expect(node!.querySelector("[data-project]")?.getAttribute("data-project")).toBe("signed-project");
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
