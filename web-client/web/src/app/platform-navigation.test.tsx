// @vitest-environment jsdom
import { act, useLayoutEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createBrowserHistory, createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { platformLocationSearch, usePlatformNavigation } from "./platform-navigation";
import { useHistoryShortcuts, useHomeShortcut } from "@client-kit/platform/react/use-navigation-shortcuts";
import { useChannelMessageEdit } from "@client-kit/platform/react/thread";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(window, "scrollTo", { value: vi.fn(), configurable: true });

const state = vi.hoisted(() => ({ mounts: 0 }));
vi.mock("@/platform/ui/PlatformApp", () => ({ PlatformApp: function Host() {
  const [scopeKey, setScopeKey] = useState("current-session");
  const navigation = usePlatformNavigation(scopeKey);
  const edit = useChannelMessageEdit(scopeKey);
  useLayoutEffect(() => {
    navigation.registerThreadNavigationGuard(edit.requireThreadEditResolution);
    return () => navigation.registerThreadNavigationGuard(null);
  }, [navigation.registerThreadNavigationGuard, edit.requireThreadEditResolution]);
  useHomeShortcut({ disabled: navigation.tab === "settings", onGoHome: () => navigation.openTab("inbox", navigation.workspaceId) });
  useHistoryShortcuts({ goBack: navigation.goBack, goForward: navigation.goForward });
  const [mount] = useState(() => ++state.mounts);
  return <div data-tab={navigation.tab} data-mount={mount} data-workspace={navigation.workspaceId}
    data-conversation={navigation.conversationId} data-application={navigation.applicationBindingId} data-project={navigation.projectId} data-message={navigation.messageTarget?.messageId}
    data-search-query={navigation.searchHighlight?.query} data-search-activation={navigation.searchHighlight?.activationId} data-thread={navigation.threadHeadId} data-editing={edit.editTarget?.id}
    data-draft={navigation.draftTarget?.key} data-send={navigation.draftTarget?.send}>
    <button onClick={() => { void navigation.openTab("audit", navigation.workspaceId); }}>audit</button>
    <button onClick={() => { void navigation.openTab("settings", navigation.workspaceId); }}>settings</button>
    <button onClick={() => { void navigation.openTab("agents", "workspace-b"); }}>agents</button>
    <button onClick={() => { void navigation.openTab("workflows", "workspace-b"); }}>workflows</button>
    <button onClick={() => { void navigation.openApplication("binding-a", "workspace-a"); }}>application</button>
    <button onClick={() => { void navigation.openProject("signed-project"); }}>project</button>
    <button onClick={() => { void navigation.openChannel("workspace-a", {channelId:"workspace-a",messageId:"diff-result",threadRootId:null}, "  exact needle  "); }}>search result</button>
    <button onClick={() => { void navigation.openConversation("conversation-a", {messageId:"diff-reply",threadRootId:"diff-root"}, "reply needle"); }}>DM search result</button>
    <button onClick={() => { void navigation.openChannel("workspace-a", {channelId:"workspace-a",messageId:"diff-result",threadRootId:null}); }}>ordinary link</button>
    <button onClick={() => setScopeKey("next-session")}>switch session</button>
    <button onClick={() => navigation.replaceDefaultChannel("workspace-a")}>admitted default</button>
    <button onClick={() => { navigation.clearMessageRouteTarget(); navigation.setThreadHeadId("thread-a"); }}>open thread</button>
    <button onClick={() => { navigation.clearMessageRouteTarget(); navigation.setThreadHeadId(null); }}>close thread</button>
    <button onClick={() => navigation.setThreadHeadId("thread-a", {replace:true})}>resolve linked thread</button>
    <button onClick={() => edit.setEditTarget({id:"reply-a",createdAt:1,author:"Me",body:"unsaved reply",time:"",depth:0,tags:[["e","thread-a","","root"],["e","thread-a","","reply"]]})}>edit thread reply</button>
    <button onClick={edit.handleCancelEdit}>finish thread edit</button>
    <button onClick={() => {void navigation.openConversation("conversation-a", {messageId:"reply-a",threadRootId:"root-a"}, undefined, {key:"thread:native-dm:root-a:reply-a",send:true});}}>send draft</button>
    <button onClick={() => {void navigation.consumeDraftSend();}}>consume draft send</button>
  </div>;
} }));

let root: Root | undefined;
let node: HTMLDivElement | undefined;
let destroyHistory: (() => void) | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; node?.remove(); node = undefined; destroyHistory?.(); destroyHistory=undefined; });

async function mount(url: string, browser = false) {
  if (browser) window.history.replaceState(null,"",url);
  const history = browser ? createBrowserHistory() : createMemoryHistory({ initialEntries: [url] });
  destroyHistory=()=>history.destroy();
  const router = createRouter({ routeTree, history, basepath: "/app", defaultPendingMinMs: 0 });
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  await act(async () => { await router.load(); root!.render(<RouterProvider router={router} />); });
  return router;
}

it("pins an admitted index channel with replace before thread navigation and restores its thread on reload", async () => {
  let router = await mount("/app/?thread=root-a&messageId=reply-a&threadRootId=root-a&body=never-copy");
  expect(node!.querySelector("[data-thread]")).toBeNull();
  const length = router.history.length;
  await act(async () => {[...node!.querySelectorAll("button")].find(button => button.textContent === "admitted default")!.click();});
  expect(router.history.location.pathname).toBe("/app/channels/workspace-a");
  expect(router.history.length).toBe(length);
  expect(router.history.location.search).not.toContain("body");
  expect(node!.querySelector("[data-thread]")?.getAttribute("data-thread")).toBe("root-a");
  expect(node!.querySelector("[data-message]")?.getAttribute("data-message")).toBe("reply-a");
  const reloadUrl = router.history.location.href;
  await act(async () => root!.unmount()); root = undefined; node!.remove();
  router = await mount(reloadUrl);
  expect(node!.querySelector("[data-workspace]")?.getAttribute("data-workspace")).toBe("workspace-a");
  expect(node!.querySelector("[data-thread]")?.getAttribute("data-thread")).toBe("root-a");
});

it.each(["/app/channels/revoked?thread=root-a", "/app/conversations/conversation-a?thread=root-a", "/app/inbox?thread=root-a", "/app/?workspaceId=other&thread=root-a"])(
  "never rewrites an explicit or differently scoped destination %s to a directory default", async url => {
    const router = await mount(url);
    const before = router.history.location.href;
    await act(async () => {[...node!.querySelectorAll("button")].find(button => button.textContent === "admitted default")!.click();});
    expect(router.history.location.href).toBe(before);
    expect(router.history.length).toBe(1);
  },
);

it("carries only a same-session draft reference and consumes its send marker before history can replay it", async () => {
  const router = await mount("/app/inbox");
  const click = (label:string) => act(async()=>{[...node!.querySelectorAll("button")].find(button=>button.textContent===label)!.click();});
  await click("send draft");
  expect(node!.querySelector("[data-draft]")?.getAttribute("data-send")).toBe("true");
  expect(router.history.location.search).not.toMatch(/autoSend|draft|send=true/);
  const length=router.history.length;
  await click("consume draft send");
  expect(router.history.length).toBe(length);
  expect(node!.querySelector("[data-draft]")?.getAttribute("data-send")).toBe("false");
  await click("audit");
  await act(async()=>{router.history.back();await router.load();});
  expect(node!.querySelector("[data-draft]")?.getAttribute("data-send")).toBe("false");
  await click("switch session");
  expect(node!.querySelector("[data-draft]")).toBeNull();
});

it.each(["channels/workspace-a", "conversations/conversation-a"])("restores the original thread URL on back, forward and reload for %s", async route => {
  let router = await mount(`/app/${route}?messageId=reply-a&threadRootId=root-a&workspaceId=scope-a`);
  const click = (label: string) => act(async () => {[...node!.querySelectorAll("button")].find(button => button.textContent === label)!.click();});
  const startLength = router.history.length;
  await click("open thread");
  expect(router.history.length).toBe(startLength + 1);
  expect(node!.querySelector("[data-thread]")?.getAttribute("data-thread")).toBe("thread-a");
  expect(router.history.location.search).toContain("workspaceId=scope-a");
  expect(router.history.location.search).not.toContain("messageId");
  expect(router.history.location.search).not.toContain("threadRootId");
  await click("open thread");
  expect(router.history.length).toBe(startLength + 1);
  await click("close thread");
  expect(node!.querySelector("[data-thread]")).toBeNull();
  await act(async () => { router.history.back(); await router.load(); });
  expect(node!.querySelector("[data-thread]")?.getAttribute("data-thread")).toBe("thread-a");
  const reloadUrl = router.history.location.href;
  await act(async () => { router.history.forward(); await router.load(); });
  expect(node!.querySelector("[data-thread]")).toBeNull();
  await act(async () => root!.unmount()); root = undefined; node!.remove();
  router = await mount(reloadUrl);
  expect(node!.querySelector("[data-thread]")?.getAttribute("data-thread")).toBe("thread-a");
  await click("audit");
  expect(node!.querySelector("[data-thread]")).toBeNull();
  expect(router.history.location.search).not.toContain("thread=");
});

it("blocks Back with the original thread edit guard and keeps the URL and edit until explicitly resolved", async () => {
  // The installed memory history applies blockers to PUSH/REPLACE, not POP.
  // Exercise the same browser popstate/rollback implementation as the host.
  const router = await mount("/app/channels/workspace-a", true);
  const click = (label: string) => act(async () => {[...node!.querySelectorAll("button")].find(button => button.textContent === label)!.click();});
  await click("open thread");
  await click("edit thread reply");
  const url = router.history.location.href;
  await act(async () => {
    const popped=new Promise<void>(resolve=>window.addEventListener("popstate",()=>resolve(),{once:true}));
    router.history.back(); await popped;
    await vi.waitFor(()=>expect(window.location.pathname+window.location.search).toBe(url));
  });
  expect(router.history.location.href).toBe(url);
  expect(node!.querySelector("[data-editing]")?.getAttribute("data-editing")).toBe("reply-a");
  expect(node!.querySelector("[data-thread]")?.getAttribute("data-thread")).toBe("thread-a");
  await click("finish thread edit");
  await act(async () => {
    const popped=new Promise<void>(resolve=>window.addEventListener("popstate",()=>resolve(),{once:true}));
    router.history.back(); await popped; await router.load();
  });
  expect(node!.querySelector("[data-editing]")).toBeNull();
  expect(node!.querySelector("[data-thread]")).toBeNull();
  expect(router.history.location.pathname).toBe("/app/channels/workspace-a");
});

it("records a resolved deep-link thread in the same history entry without losing its target", async () => {
  const router = await mount("/app/channels/workspace-a?messageId=reply-a&threadRootId=root-a");
  const length = router.history.length;
  await act(async () => {[...node!.querySelectorAll("button")].find(button => button.textContent === "resolve linked thread")!.click();});
  expect(router.history.length).toBe(length);
  expect(router.history.location.search).toContain("thread=thread-a");
  expect(router.history.location.search).toContain("messageId=reply-a");
  expect(router.history.location.search).toContain("threadRootId=root-a");
  expect(platformLocationSearch({thread: {body:"not a reference"}}).thread).toBeUndefined();
  expect(platformLocationSearch({thread:"   "}).thread).toBeUndefined();
});

it("carries the original search activation in history, not the URL, and clears ordinary navigation", async () => {
  const router = await mount("/app/inbox");
  const click = (label: string) => act(async () => {[...node!.querySelectorAll("button")].find(button => button.textContent === label)!.click();});
  await click("search result");
  expect(node!.querySelector("[data-search-query]")?.getAttribute("data-search-query")).toBe("exact needle");
  const activation = node!.querySelector("[data-search-activation]")?.getAttribute("data-search-activation");
  expect(activation).toBeTruthy();
  expect(router.history.location.href).not.toContain("needle");
  expect(router.history.location.state).toMatchObject({searchHighlight:{messageId:"diff-result",query:"exact needle"}});
  await click("search result");
  expect(node!.querySelector("[data-search-activation]")?.getAttribute("data-search-activation")).not.toBe(activation);
  await click("ordinary link");
  expect(node!.querySelector("[data-search-query]")).toBeNull();
  await click("DM search result");
  expect(router.history.location.pathname).toBe("/app/conversations/conversation-a");
  expect(node!.querySelector("[data-search-query]")?.getAttribute("data-search-query")).toBe("reply needle");
  await click("audit");
  expect(node!.querySelector("[data-search-query]")).toBeNull();
  await act(async () => {router.history.back(); await router.load();});
  expect(node!.querySelector("[data-search-query]")?.getAttribute("data-search-query")).toBe("reply needle");
  await click("switch session");
  expect(node!.querySelector("[data-search-query]")).toBeNull();
});

it("rejects malformed or mismatched target search history without altering navigation admission", async () => {
  const router = await mount("/app/inbox");
  for (const highlight of [{messageId:"diff-result",query:"needle"}, {activationId:"activation",messageId:"other-message",query:"needle"}]) {
    await act(async () => {await router.navigate({to:"/channels/$channelId",params:{channelId:"workspace-a"},search:{messageId:"diff-result"},
      state: previous => ({...previous,searchHighlightScope:"current-session",searchHighlight:highlight})});});
    expect(node!.querySelector("[data-search-query]")).toBeNull();
    expect(node!.querySelector("[data-message]")?.getAttribute("data-message")).toBe("diff-result");
  }
});

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
