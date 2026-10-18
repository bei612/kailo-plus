// DD-119 (5)(8), REQ-24: Buzz 779af8886caae1317b4de962082429867ab61503
// ChannelContextMenu Leave/Archive entries and ChannelSectionDialogs::LeaveChannelAlertDialog over
// the existing governed workspace.leave / workspace.suspend actions.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionDispatchState, ActionGateState, ErrorClass, type ActionCommand } from "@client-kit/contracts";
import { createBffClient } from "../src/client";
import { setLocale } from "../src/i18n";
import { PlatformProvider } from "../src/react/context";
import { ChannelGroupSection } from "../src/react/sidebar/channel-group";
import { ChannelContextMenuItems } from "../src/react/sidebar/channel-context-menu";
import { useChannelSidebarActionDialogs } from "../src/react/sidebar/channel-section-dialogs";
import { TooltipProvider } from "../src/react/sidebar/tooltip";
import type { BffReply, BffRequest } from "../src/transport";
import { click, render, settle } from "./render";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setLocale("en");
});
afterEach(() => { vi.restoreAllMocks(); });

const channel = { id: "w", name: "general", lastMessageAt: null };

const recorded = (command: ActionCommand): BffReply => ({ status: 200, body: {
  actionExecutionId: "execution", actionKey: command.actionKey, operationId: "operation",
  gateState: ActionGateState.Allowed, dispatchState: ActionDispatchState.Dispatched,
} });

function backend(options: { lifecycleActionKey?: string; roleFailure?: boolean; action?: (command: ActionCommand) => BffReply } = {}) {
  return vi.fn(async (request: BffRequest): Promise<BffReply> => {
    if (request.path === "/api/v1/discoverable-workspaces?channelId=c") return { status: 200, body: { items: [{
      id: "w", visibility: "open", isMember: true, memberCount: 1, membershipState: "ACTIVE", createdAt: "2026-10-16T00:00:00Z",
      channel: { channelId: "c", channelType: "stream", name: "general", archived: false }, leaveActionKey: "workspace.leave",
    }] } };
    if (request.path === "/api/v1/role-workspaces") return options.roleFailure ? { status: 500, body: {} }
      : { status: 200, body: { workspaces: [{ id: "w", name: "general", state: "ACTIVE",
        ...(options.lifecycleActionKey ? { lifecycleActionKey: options.lifecycleActionKey } : {}) }] } };
    if (request.method === "POST" && request.path === "/api/v1/actions") return (options.action ?? recorded)(request.body as ActionCommand);
    return { status: 404, body: {} };
  });
}

function Sidebar({ onRecorded, withOwnerActions = true }: { onRecorded: () => void; withOwnerActions?: boolean }) {
  const { requestLeaveChannel, requestArchiveChannel, dialog } = useChannelSidebarActionDialogs(onRecorded);
  return <TooltipProvider>
    <ChannelGroupSection title="Channels" items={[channel]} hasUnread={false} isCollapsed={false}
      onToggleCollapsed={() => {}} listTestId="channel-list" actionsTestId="channel-actions"
      renderRow={() => <button>Open context</button>}
      renderContextMenu={(row) => <ChannelContextMenuItems channel={row} hasUnread={false} onCopy={() => {}}
        onLeaveChannel={(target) => requestLeaveChannel({ workspaceId: target.id, name: target.name })}
        ownerActions={withOwnerActions ? { workspaceId: row.id, channelId: "c",
          onArchiveChannel: (target) => requestArchiveChannel({ workspaceId: target.id, name: target.name }) } : undefined} />} />
    {dialog}
  </TooltipProvider>;
}

async function mount(send: ReturnType<typeof backend>, withOwnerActions = true) {
  const onRecorded = vi.fn();
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const host = await render(<QueryClientProvider client={cache}><PlatformProvider client={createBffClient({ send })} locale="en">
    <Sidebar onRecorded={onRecorded} withOwnerActions={withOwnerActions} /></PlatformProvider></QueryClientProvider>);
  const actions = () => send.mock.calls.map(([request]) => request).filter((request) => request.method === "POST")
    .map((request) => request.body as ActionCommand);
  return { host, onRecorded, actions };
}

const menuItems = () => [...document.querySelectorAll<HTMLElement>("[role=menuitem]")];

async function openMenu(host: HTMLElement) {
  await act(async () => host.querySelector("li")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 1, clientY: 1 })));
  await settle();
}

async function choose(label: string) {
  const item = menuItems().find((node) => node.textContent === label);
  expect(item).toBeDefined();
  await click(item!);
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  await settle();
}

describe("original sidebar Leave/Archive over DD-119 governed actions", () => {
  it("shows Leave at once and Archive only after the lifecycle hint answers suspend", async () => {
    const m = await mount(backend({ lifecycleActionKey: "workspace.suspend" }));
    await openMenu(m.host);
    expect(menuItems().some((node) => node.textContent === "Leave channel")).toBe(true);
    await vi.waitFor(() => expect(menuItems().some((node) => node.textContent === "Archive channel")).toBe(true));
    expect(menuItems().some((node) => node.textContent === "Delete channel")).toBe(false);
    expect(m.actions()).toHaveLength(0);
  });

  it("hides Archive without a suspend hint and reports an unavailable hint read", async () => {
    const none = await mount(backend());
    await openMenu(none.host);
    await vi.waitFor(() => expect(menuItems().some((node) => node.textContent === "Loading channel actions...")).toBe(false));
    expect(menuItems().some((node) => node.textContent === "Archive channel")).toBe(false);
  });

  it("marks the owner actions unavailable when the hint read fails", async () => {
    const failed = await mount(backend({ roleFailure: true }));
    await openMenu(failed.host);
    await vi.waitFor(() => expect(menuItems().find((node) => node.textContent === "Channel actions unavailable")
      ?.getAttribute("aria-disabled")).toBe("true"));
  });

  it("does not read authority without owner actions", async () => {
    const send = backend({ lifecycleActionKey: "workspace.suspend" });
    const m = await mount(send, false);
    await openMenu(m.host);
    expect(menuItems().some((node) => node.textContent === "Leave channel")).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it("confirms Leave with the original dialog and submits workspace.leave once", async () => {
    const m = await mount(backend());
    await openMenu(m.host);
    await choose("Leave channel");
    const dialog = document.querySelector<HTMLElement>("[data-testid=leave-channel-dialog]")!;
    expect(dialog.textContent).toContain("Leave \"general\"? You'll stop receiving its messages and can rejoin later.");
    expect(m.actions()).toHaveLength(0);
    await click([...dialog.querySelectorAll("button")].find((button) => button.textContent === "Leave")!);
    expect(m.actions()).toEqual([{ actionKey: "workspace.leave", workspaceId: "w", idempotencyKey: expect.any(String) }]);
    expect(document.querySelector("[data-testid=leave-channel-dialog]")).toBeNull();
    expect(m.onRecorded).toHaveBeenCalled();
  });

  it("keeps an UNKNOWN leave frozen and re-checks only the same request", async () => {
    let writes = 0;
    const m = await mount(backend({ action: (command) => ++writes === 1
      ? { status: 503, body: { class: ErrorClass.Unknown, operationId: "uncertain" } } : recorded(command) }));
    await openMenu(m.host);
    await choose("Leave channel");
    const dialog = document.querySelector<HTMLElement>("[data-testid=leave-channel-dialog]")!;
    await click([...dialog.querySelectorAll("button")].find((button) => button.textContent === "Leave")!);
    expect(dialog.textContent).toContain("uncertain");
    const retry = [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Retry same request")!;
    expect(retry).toBeDefined();
    await click(retry);
    const commands = m.actions();
    expect(commands).toHaveLength(2);
    expect(commands[1]).toEqual(commands[0]);
    expect(document.querySelector("[data-testid=leave-channel-dialog]")).toBeNull();
  });

  it("confirms Archive with the channel sheet copy before submitting workspace.suspend", async () => {
    const m = await mount(backend({ lifecycleActionKey: "workspace.suspend" }));
    await openMenu(m.host);
    await vi.waitFor(() => expect(menuItems().some((node) => node.textContent === "Archive channel")).toBe(true));
    await choose("Archive channel");
    const dialog = document.querySelector<HTMLElement>("[data-testid=archive-channel-dialog]")!;
    expect(dialog.textContent).toContain("Archive general?");
    expect(m.actions()).toHaveLength(0);
    await click([...dialog.querySelectorAll("button")].find((button) => button.textContent === "Archive channel")!);
    expect(m.actions()).toEqual([{ actionKey: "workspace.suspend", workspaceId: "w", idempotencyKey: expect.any(String) }]);
    expect(document.querySelector("[data-testid=archive-channel-dialog]")).toBeNull();
  });
});
