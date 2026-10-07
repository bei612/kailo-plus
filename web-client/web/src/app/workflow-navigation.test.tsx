// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBrowserHistory, createHashHistory, createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider, useBlocker, useRouterState } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBffClient } from "@client-kit/platform/client";
import type { BffReply, BffRequest } from "@client-kit/platform/transport";
import { PlatformProvider } from "@client-kit/platform/react/context";
import { WorkflowsPage, workflowBlocksNavigation, type WorkflowNavigationState } from "@client-kit/platform/react/workflows";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let node: HTMLDivElement | undefined;
let destroyHistory: (() => void) | undefined;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn();
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; node?.remove(); node = undefined; destroyHistory?.(); destroyHistory = undefined; vi.unstubAllGlobals(); });

async function mount(prefix: "" | "/platform", locale: "en" | "zh-CN" = "en", browserHistory = false) {
  const executor = { resourceId: "executor", workspaceId: "workspace", agentResourceId: "agent",
    pinnedVersionAssetId: "agent-version", agentPrincipalId: "agent-principal", agentPrincipalState: "ACTIVE",
    ownerPrincipalId: "human", resourceVersion: 1, resourceState: "ACTIVE", state: "ACTIVE",
    automationResultTargets: ["TRIGGER_THREAD", "CHANNEL"], activeProjectionGeneration: 1,
    projection: { generation: 1, agentVersionAssetId: "agent-version", runtimeProfileKey: "profile", configHash: "a".repeat(64), state: "ACTIVE" } };
  const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
    if (request.path === "/api/v1/tasks") return { status: 200, body: [] };
    if (request.path === "/api/v1/workspaces") return { status: 200, body: [
      { id: "workspace", name: "Channel", slug: "channel" }, { id: "other", name: "Other", slug: "other" },
    ] };
    if (request.path.startsWith("/api/v1/automations?")) return { status: 200,
      body: { automations: [], canCreate: true, availableApprovalPolicies: [] } };
    if (request.path.startsWith("/api/v1/agent-installations?")) return { status: 200, body: { installations: [executor] } };
    if (request.path === "/api/v1/agent-installations/executor") return { status: 200, body: executor };
    if (request.path === "/api/v1/actions") return { status: 202, body: {
      actionKey: (request.body as { actionKey: string }).actionKey, actionExecutionId: "execution", operationId: "operation",
      gateState: "ALLOWED", dispatchState: "UNKNOWN",
    } };
    return { status: 503, body: undefined };
  });
  const client = createBffClient({ send });
  function Host() {
    const location = useRouterState({ select: (state) => state.location });
    const [state, onStateChange] = useState<WorkflowNavigationState>({ dirty: false, locked: false });
    const blocker = useBlocker({ shouldBlockFn: ({ current, next }) => workflowBlocksNavigation(state, current, next),
      withResolver: true, enableBeforeUnload: false });
    return location.pathname.endsWith("/workflows")
      ? <WorkflowsPage workspaceId={location.search.workspaceId}
          onWorkspaceChange={(workspaceId) => { void router.navigate({ to: `${prefix}/workflows`, search: { workspaceId } }); }}
          workflowNavigation={{ blocker, onStateChange }} />
      : <div data-testid="destination" />;
  }
  const rootRoute = createRootRoute({ component: Host });
  const route = createRoute({ getParentRoute: () => rootRoute, path: "$section",
    validateSearch: (search: Record<string, unknown>) => ({ workspaceId: typeof search.workspaceId === "string" ? search.workspaceId : undefined }) });
  const nativeRoute = createRoute({ getParentRoute: () => rootRoute, path: "platform/$section",
    validateSearch: (search: Record<string, unknown>) => ({ workspaceId: typeof search.workspaceId === "string" ? search.workspaceId : undefined }) });
  if (browserHistory) window.history.replaceState(null, "", prefix ? `/#${prefix}/inbox` : "/inbox");
  const history = browserHistory ? prefix ? createHashHistory() : createBrowserHistory()
    : createMemoryHistory({ initialEntries: [`${prefix}/inbox`, `${prefix}/workflows?workspaceId=workspace`], initialIndex: 1 });
  if (browserHistory) { history.push(`${prefix}/workflows?workspaceId=workspace`); history.flush(); }
  destroyHistory = () => history.destroy();
  const router = createRouter({ routeTree: rootRoute.addChildren([route, nativeRoute]), history, defaultPendingMinMs: 0 });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  await act(async () => { await router.load(); root!.render(<QueryClientProvider client={cache}>
    <PlatformProvider client={client} locale={locale}><RouterProvider router={router} /></PlatformProvider>
  </QueryClientProvider>); });
  return { router, send };
}

function button(text: string) { const found = [...document.querySelectorAll("button")].find((button) => button.textContent === text || button.getAttribute("aria-label") === text); expect(found, document.body.textContent ?? "").toBeDefined(); return found!; }
async function click(text: string) { await act(async () => button(text).click()); }
async function draft(text: string) {
  const create = document.querySelector<HTMLButtonElement>('[data-testid="new-workflow-card"]');
  expect(create).not.toBeNull();
  await act(async () => create!.click());
  const input = document.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it.each(["", "/platform"] as const)("guards actual %s navigation: stay preserves scope/raw draft; discard enters requested route", async (prefix) => {
  const { router, send } = await mount(prefix);
  await draft("unsaved content");
  let pending: Promise<void> | undefined;
  await act(async () => { pending = router.navigate({ to: `${prefix}/audit`, search: {} }); });
  expect(router.state.location.pathname).toBe(`${prefix}/workflows`);
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  await click("Keep editing");
  expect(router.state.location.search.workspaceId).toBe("workspace");
  expect(document.querySelector("textarea")?.value).toBe("unsaved content");
  await act(async () => { pending = router.navigate({ to: `${prefix}/audit`, search: {} }); });
  await click("Discard changes");
  await act(async () => { await pending; });
  expect(router.state.location.pathname).toBe(`${prefix}/audit`);
  expect(document.querySelector('[data-testid="destination"]')).not.toBeNull();
  expect(send.mock.calls.some(([request]) => request.method === "POST")).toBe(false);
});

it.each(["", "/platform"] as const)("keeps %s scope selection unchanged while blocked and applies it only after discard", async (prefix) => {
  const { router } = await mount(prefix);
  await draft("scope draft");
  const scope = document.querySelector<HTMLSelectElement>('select')!;
  await act(async () => { scope.value = "other"; scope.dispatchEvent(new Event("change", { bubbles: true })); });
  await click("Keep editing");
  expect(router.state.location.search.workspaceId).toBe("workspace");
  expect(scope.value).toBe("workspace");
  expect(document.querySelector("textarea")?.value).toBe("scope draft");
  await act(async () => { scope.value = "other"; scope.dispatchEvent(new Event("change", { bubbles: true })); });
  await click("Discard changes");
  expect(router.state.location.search.workspaceId).toBe("other");
  expect(document.querySelector('[data-testid="workflow-editor-dialog"]')).toBeNull();
});

it.each(["", "/platform"] as const)("blocks %s back without consuming history, then supports confirmed back/forward and clean navigation", async (prefix) => {
  // MemoryHistory does not run POP blockers; exercise the installed browser
  // history implementation used by both hosts instead of faking that behavior.
  const { router } = await mount(prefix, "en", true);
  await draft("history draft");
  await act(async () => router.history.back());
  await vi.waitFor(async () => { await act(async () => {}); expect(document.querySelector('[role="alertdialog"]')).not.toBeNull(); });
  await click("Keep editing");
  await vi.waitFor(async () => { await act(async () => {}); expect(router.history.location.pathname).toBe(`${prefix}/workflows`); });
  expect(router.state.location.pathname).toBe(`${prefix}/workflows`);
  await act(async () => router.history.back());
  await vi.waitFor(async () => { await act(async () => {}); expect(document.querySelector('[role="alertdialog"]')).not.toBeNull(); });
  await click("Discard changes");
  await vi.waitFor(async () => { await act(async () => {}); expect(router.state.location.pathname).toBe(`${prefix}/inbox`); });
  expect(router.state.location.pathname).toBe(`${prefix}/inbox`);
  await act(async () => router.history.forward());
  await vi.waitFor(async () => { await act(async () => {}); expect(router.state.location.pathname).toBe(`${prefix}/workflows`); });
  expect(router.state.location.pathname).toBe(`${prefix}/workflows`);
  await act(async () => { await router.navigate({ to: `${prefix}/audit`, search: {} }); });
  expect(router.state.location.pathname).toBe(`${prefix}/audit`);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});

it("preserves only pane-only navigation, not changed workflow scope hidden alongside a pane", () => {
  const state = { dirty: true, locked: false };
  const current = { pathname: "/platform/workflows", search: { workspaceId: "a", pane: "one" } };
  expect(workflowBlocksNavigation(state, current, { ...current, search: { workspaceId: "a", pane: "two" } })).toBe(false);
  expect(workflowBlocksNavigation(state, current, { ...current, search: { workspaceId: "b", pane: "two" } })).toBe(true);
});

it.each(["", "/platform"] as const)("does not discard a %s UNKNOWN command on route switch or replay it with another identity", async (prefix) => {
  const { router, send } = await mount(prefix);
  await draft("frozen command");
  const executor = [...document.querySelectorAll("select")].find((select) => [...select.options].some((option) => option.value === "executor"))!;
  await act(async () => { executor.value = "executor"; executor.dispatchEvent(new Event("change", { bubbles: true })); });
  await click("Review request");
  await click("Submit governed request");
  const command = send.mock.calls.filter(([request]) => request.method === "POST")[0][0].body;
  await act(async () => { void router.navigate({ to: `${prefix}/audit`, search: {} }); });
  expect(router.state.location.pathname).toBe(`${prefix}/workflows`);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(document.querySelector('[data-testid="workflow-editor-dialog"]')).not.toBeNull();
  await click("Re-check same request");
  expect(send.mock.calls.filter(([request]) => request.method === "POST").map(([request]) => request.body)).toEqual([command, command]);
});
