// DD-150 (V-SCN-247): Buzz 779af8886caae1317b4de962082429867ab61503
// ChannelManagementModerationActions.tsx::ChannelDeleteConfirmationDialog over the governed workspace.delete.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionDispatchState, ActionGateState, ErrorClass, type ActionCommand } from "@client-kit/contracts";
import { createBffClient } from "../src/client";
import { setLocale } from "../src/i18n";
import { PlatformProvider } from "../src/react/context";
import { ChannelManagementSheet, type ChannelManagementHost } from "../src/react/channel-management-sheet";
import type { BffReply, BffRequest } from "../src/transport";
import { click, render, settle } from "./render";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setLocale("en");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const recorded = (command: ActionCommand, operationId = "operation"): BffReply => ({ status: 200, body: {
  actionExecutionId: "execution", actionKey: command.actionKey, operationId,
  gateState: ActionGateState.Allowed, dispatchState: ActionDispatchState.Dispatched,
} });

function mount(role: { deleteActionKey?: string; state?: string }, options: { action?: (command: ActionCommand) => BffReply | Promise<BffReply> } = {}) {
  const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
    if (request.path === "/api/v1/workspaces/w/members")
      return { status: 200, body: [{ principalId: "me", displayName: "Ada", state: "ACTIVE", pubkeys: ["e".repeat(64)] }] };
    if (request.path === "/api/v1/discoverable-workspaces?channelId=c") return { status: 200, body: { items: [{
      id: "w", visibility: "open", isMember: true, memberCount: 1, membershipState: "ACTIVE", createdAt: "2026-10-16T00:00:00Z",
      channel: { channelId: "c", channelType: "stream", name: "general", archived: false },
    }] } };
    if (request.path === "/api/v1/role-workspaces")
      return { status: 200, body: { workspaces: [{ id: "w", name: "general", state: role.state ?? "ACTIVE",
        ...(role.deleteActionKey ? { deleteActionKey: role.deleteActionKey } : {}) }] } };
    if (request.method === "POST" && request.path === "/api/v1/actions") {
      const command = request.body as ActionCommand;
      return (options.action ?? recorded)(command);
    }
    return { status: 404, body: {} };
  });
  const host: ChannelManagementHost = { refresh: vi.fn() };
  function Host() {
    const [open, setOpen] = useState(true);
    return <ChannelManagementSheet channel={{ channelId: "c", name: "general", description: "", channelType: "stream", visibility: "open", ttlSeconds: null }}
      isDark={false} management={host} onCopy={async () => {}} onOpenChange={setOpen} open={open} roster={{ kind: "workspace", workspaceId: "w" }} />;
  }
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const actions = () => send.mock.calls.map(([request]) => request).filter((request) => request.method === "POST")
    .map((request) => request.body as ActionCommand);
  return {
    send, host, actions,
    render: async () => {
      await render(<QueryClientProvider client={cache}><PlatformProvider client={createBffClient({ send })} locale="en"><Host /></PlatformProvider></QueryClientProvider>);
      await vi.waitFor(() => expect(send.mock.calls.some(([request]) => request.path === "/api/v1/role-workspaces")).toBe(true));
      await settle();
    },
  };
}

const q = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector);

describe("original channel delete over the governed workspace.delete (DD-150)", () => {
  it("shows no delete row without the role projection's deleteActionKey", async () => {
    const m = mount({});
    await m.render();
    expect(q("[data-testid=channel-management-delete]")).toBeNull();
  });

  it("confirms in the original dialog before submitting workspace.delete with explicit confirmation", async () => {
    const m = mount({ deleteActionKey: "workspace.delete" });
    await m.render();
    await vi.waitFor(() => expect(q("[data-testid=channel-management-delete]")).not.toBeNull());
    expect(q("[data-testid=channel-management-delete]")?.textContent).toBe("Delete channel");
    await click(q("[data-testid=channel-management-delete]")!);
    expect(m.actions()).toHaveLength(0);
    const dialog = q("[data-testid=channel-delete-confirmation-dialog]");
    expect(dialog?.textContent).toContain("Delete channel?");
    expect(dialog?.textContent).toContain("Delete general from the community list. This action cannot be undone.");
    await click(q("[data-testid=channel-delete-confirm]")!);
    expect(m.actions()).toEqual([{ actionKey: "workspace.delete", workspaceId: "w", explicitConfirmation: true, idempotencyKey: expect.any(String) }]);
    // Recorded is not done: the channel stays listed as deleting and the row is gone.
    await vi.waitFor(() => expect(q("[data-testid=channel-management-deleting]")).not.toBeNull());
    expect(q("[data-testid=channel-management-deleting]")?.textContent).toContain("being deleted");
    expect(q("[data-testid=channel-management-delete]")).toBeNull();
    expect(q("[data-testid=channel-delete-confirmation-dialog]")).toBeNull();
    expect(m.host.refresh).toHaveBeenCalled();
  });

  it("shows the converging delete from the role projection (state DELETING) without offering it again", async () => {
    const m = mount({ state: "DELETING" });
    await m.render();
    await vi.waitFor(() => expect(q("[data-testid=channel-management-deleting]")).not.toBeNull());
    expect(q("[data-testid=channel-management-delete]")).toBeNull();
  });

  it("keeps an UNKNOWN delete frozen and resends the same command with the same key", async () => {
    let writes = 0;
    const m = mount({ deleteActionKey: "workspace.delete" }, { action: (command) => ++writes === 1
      ? { status: 503, body: { class: ErrorClass.Unknown, operationId: "uncertain" } } : recorded(command, "uncertain") });
    await m.render();
    await vi.waitFor(() => expect(q("[data-testid=channel-management-delete]")).not.toBeNull());
    await click(q("[data-testid=channel-management-delete]")!);
    await click(q("[data-testid=channel-delete-confirm]")!);
    await vi.waitFor(() => expect(q("[data-testid=channel-delete-problem]")).not.toBeNull());
    expect(q("[data-testid=channel-delete-confirm]")?.textContent).toBe("Retry same request");
    // The unknown intent cannot be cancelled away from the dialog.
    expect(q<HTMLButtonElement>("[data-testid=channel-delete-cancel]")?.hasAttribute("disabled")).toBe(true);
    await click(q("[data-testid=channel-delete-confirm]")!);
    const [sent, resent] = m.actions();
    expect(resent).toEqual(sent);
    await vi.waitFor(() => expect(q("[data-testid=channel-management-deleting]")).not.toBeNull());
  });

  it("reports a definite refusal in the dialog and sends nothing else", async () => {
    const m = mount({ deleteActionKey: "workspace.delete" }, { action: (command) => ({ status: 200, body: {
      actionExecutionId: "execution", actionKey: command.actionKey, operationId: "operation",
      gateState: ActionGateState.Denied, dispatchState: ActionDispatchState.NotDispatched, reason: "TARGET_STATE_CONFLICT",
    } }) });
    await m.render();
    await vi.waitFor(() => expect(q("[data-testid=channel-management-delete]")).not.toBeNull());
    await click(q("[data-testid=channel-management-delete]")!);
    await click(q("[data-testid=channel-delete-confirm]")!);
    await vi.waitFor(() => expect(q("[data-testid=channel-delete-problem]")?.getAttribute("role")).toBe("alert"));
    expect(m.actions()).toHaveLength(1);
    expect(q("[data-testid=channel-management-deleting]")).toBeNull();
  });

  it("renders the delete copy in Chinese", async () => {
    setLocale("zh-CN");
    const m = mount({ deleteActionKey: "workspace.delete" });
    const send = m.send;
    await render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <PlatformProvider client={createBffClient({ send })} locale="zh-CN">
        <ChannelManagementSheet channel={{ channelId: "c", name: "general", description: "", channelType: "stream", visibility: "open", ttlSeconds: null }}
          isDark={false} management={{ refresh: vi.fn() }} onCopy={async () => {}} onOpenChange={() => {}} open roster={{ kind: "workspace", workspaceId: "w" }} />
      </PlatformProvider></QueryClientProvider>);
    await vi.waitFor(() => expect(q("[data-testid=channel-management-delete]")?.textContent).toBe("删除频道"));
    await click(q("[data-testid=channel-management-delete]")!);
    expect(q("[data-testid=channel-delete-confirmation-dialog]")?.textContent).toContain("删除频道？");
    expect(q("[data-testid=channel-delete-confirmation-dialog]")?.textContent).toContain("此操作无法撤销");
  });
});
