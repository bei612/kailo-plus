// DD-119 (SF-BUZ-50, V-SCN-94..99): Buzz 779af8886caae1317b4de962082429867ab61503
// ChannelManagementSheet edit dialog and moderation rows over governed BFF hints.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionDispatchState, ActionGateState, ErrorClass, type ActionCommand } from "@client-kit/contracts";
import { createBffClient } from "../src/client";
import { setLocale } from "../src/i18n";
import { PlatformProvider } from "../src/react/context";
import {
  ChannelManagementSheet, type ChannelManagementChannel, type ChannelManagementHost,
} from "../src/react/channel-management-sheet";
import { ChannelMembersBar } from "../src/react/channel-members";
import { TransportError, type BffReply, type BffRequest } from "../src/transport";
import { click, render, settle, type } from "./render";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setLocale("en");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

type Hints = { updateActionKey?: string; canReopen?: boolean; leaveActionKey?: string; joinActionKey?: string; lifecycleActionKey?: string };

const baseChannel: ChannelManagementChannel = {
  channelId: "c", name: "general", description: "About", channelType: "stream", visibility: "open", ttlSeconds: null, topic: "Old topic",
};

const recorded = (command: ActionCommand, operationId = "operation"): BffReply => ({ status: 200, body: {
  actionExecutionId: "execution", actionKey: command.actionKey, operationId,
  gateState: ActionGateState.Allowed, dispatchState: ActionDispatchState.Dispatched,
} });

function mount(hints: Hints, options: { channel?: Partial<ChannelManagementChannel>; action?: (command: ActionCommand) => BffReply;
  publishTopic?: ChannelManagementHost["publishTopic"]; member?: boolean } = {}) {
  const { lifecycleActionKey, ...directoryHints } = hints;
  const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
    if (request.path === "/api/v1/workspaces/w/members")
      return { status: 200, body: [{ principalId: "me", displayName: "Ada", state: "ACTIVE", pubkeys: ["e".repeat(64)] }] };
    if (request.path === "/api/v1/discoverable-workspaces?channelId=c") return { status: 200, body: { items: [{
      id: "w", visibility: "open", isMember: options.member ?? true, memberCount: 1,
      ...(options.member === false ? {} : { membershipState: "ACTIVE" }), createdAt: "2026-10-16T00:00:00Z",
      channel: { channelId: "c", channelType: "stream", name: "general", archived: options.channel?.archived === true },
      ...directoryHints,
    }] } };
    if (request.path === "/api/v1/role-workspaces")
      return { status: 200, body: { workspaces: [{ id: "w", name: "general", state: "ACTIVE", ...(lifecycleActionKey ? { lifecycleActionKey } : {}) }] } };
    if (request.method === "POST" && request.path === "/api/v1/actions") {
      const command = request.body as ActionCommand;
      return (options.action ?? recorded)(command);
    }
    return { status: 404, body: {} };
  });
  const host: ChannelManagementHost = { refresh: vi.fn(), ...(options.publishTopic ? { publishTopic: options.publishTopic } : {}) };
  const opened = vi.fn();
  function Host() {
    const [open, setOpen] = useState(true);
    return <ChannelManagementSheet channel={{ ...baseChannel, ...options.channel }} isDark={false} management={host} onCopy={async () => {}}
      onOpenChange={(next) => { setOpen(next); opened(next); }} open={open} roster={{ kind: "workspace", workspaceId: "w" }} />;
  }
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const actions = () => send.mock.calls.map(([request]) => request).filter((request) => request.method === "POST")
    .map((request) => request.body as ActionCommand);
  return {
    send, host, opened, actions,
    render: async () => {
      await render(<QueryClientProvider client={cache}><PlatformProvider client={createBffClient({ send })} locale="en"><Host /></PlatformProvider></QueryClientProvider>);
      await vi.waitFor(() => expect(send.mock.calls.some(([request]) => request.path === "/api/v1/role-workspaces")).toBe(true));
      await settle();
    },
  };
}

const q = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) => root.querySelector<T & HTMLElement>(selector);

async function openEditDialog() {
  await vi.waitFor(() => expect(q("[data-testid=channel-management-edit]")).not.toBeNull());
  await click(q("[data-testid=channel-management-edit]")!);
  const dialog = q("[data-testid=channel-management-edit-dialog]");
  expect(dialog).not.toBeNull();
  return dialog!;
}

async function choose(trigger: HTMLElement, option: string) {
  await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); trigger.focus(); });
  await act(async () => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  await settle();
  await click(q(`[data-testid=${option}]`)!);
}

describe("original channel management edits over workspace.update", () => {
  it("keeps the read-only summary without updateActionKey, and never renders a delete row", async () => {
    const none = mount({});
    await none.render();
    expect(q("[data-testid=channel-management-edit]")).toBeNull();
    expect(q("[data-testid=channel-management-type]")?.tagName).toBe("DIV");
    expect(q("[data-testid=channel-management-visibility]")?.tagName).toBe("DIV");
    expect(q("[data-testid=channel-management-actions]")).toBeNull();
    expect(q("[data-testid=channel-management-delete]")).toBeNull();
  });

  it("restores the original hero, Channel type and Visibility edit entries with updateActionKey", async () => {
    const editable = mount({ updateActionKey: "workspace.update" });
    await editable.render();
    await vi.waitFor(() => expect(q("[data-testid=channel-management-edit]")).not.toBeNull());
    expect(q("[data-testid=channel-management-edit]")?.getAttribute("aria-label")).toBe("Edit channel");
    expect(q("[data-testid=channel-management-type]")?.tagName).toBe("BUTTON");
    expect(q("[data-testid=channel-management-visibility]")?.getAttribute("aria-label")).toBe("Edit visibility");
    expect(q("[data-testid=channel-management-delete]")).toBeNull();
    expect(editable.actions()).toHaveLength(0);
  });

  it("saves only the changed fields as one workspace.update command and re-reads the host view", async () => {
    const m = mount({ updateActionKey: "workspace.update" });
    await m.render();
    const dialog = await openEditDialog();
    const save = q<HTMLButtonElement>("[data-testid=channel-management-save-changes]", dialog)!;
    expect(save.disabled).toBe(true);
    await type(q<HTMLInputElement>("[data-testid=channel-management-name]", dialog)!, " renamed ");
    await type(q<HTMLTextAreaElement>("[data-testid=channel-management-description]", dialog)!, "");
    await settle();
    await click(save);
    const commands = m.actions();
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ actionKey: "workspace.update", workspaceId: "w" });
    expect(commands[0]!.workspaceUpdate).toEqual({ name: "renamed", description: "" });
    expect(typeof commands[0]!.idempotencyKey).toBe("string");
    expect(q("[data-testid=channel-management-edit-dialog]")).toBeNull();
    expect(m.host.refresh).toHaveBeenCalled();
    expect(q("[data-testid=channel-management-update-outcome]")?.textContent).toContain("Operation: operation");
  });

  it("clears an existing TTL by switching the original Channel type row to Ongoing", async () => {
    const m = mount({ updateActionKey: "workspace.update" }, { channel: { ttlSeconds: 5_000 } });
    await m.render();
    expect(q("[data-testid=channel-management-type]")?.textContent).toContain("Temporary · 1h23m20s");
    const dialog = await openEditDialog();
    expect(q("[data-testid=channel-management-ttl]", dialog)?.textContent).toContain("Current (1h23m20s)");
    await choose(q("[data-testid=channel-management-channel-type]", dialog)!, "channel-management-channel-type-option-ongoing");
    await click(q("[data-testid=channel-management-save-changes]", dialog)!);
    expect(m.actions().map((command) => command.workspaceUpdate)).toEqual([{ clearTtl: true }]);
  });

  it("toggles visibility in the original permissions control and sends only visibility", async () => {
    const m = mount({ updateActionKey: "workspace.update" });
    await m.render();
    const dialog = await openEditDialog();
    expect(dialog.textContent).toContain("Edit public channel");
    await choose(q("[data-testid=channel-management-permissions]", dialog)!, "channel-management-permissions-option-private");
    expect(dialog.textContent).toContain("Edit private channel");
    await click(q("[data-testid=channel-management-save-changes]", dialog)!);
    expect(m.actions().map((command) => command.workspaceUpdate)).toEqual([{ visibility: "private" }]);
  });

  it("keeps an UNKNOWN update frozen and resends the same command with the same key", async () => {
    let writes = 0;
    const m = mount({ updateActionKey: "workspace.update" }, { action: (command) => ++writes === 1
      ? { status: 503, body: { class: ErrorClass.Unknown, operationId: "uncertain" } } : recorded(command, "uncertain") });
    await m.render();
    const dialog = await openEditDialog();
    await type(q<HTMLInputElement>("[data-testid=channel-management-name]", dialog)!, "renamed");
    await settle();
    await click(q("[data-testid=channel-management-save-changes]", dialog)!);
    expect(q("[data-testid=channel-management-edit-error]", dialog)?.textContent).toContain("uncertain");
    expect(q<HTMLInputElement>("[data-testid=channel-management-name]", dialog)?.disabled).toBe(true);
    const retry = q<HTMLButtonElement>("[data-testid=channel-management-save-changes]", dialog)!;
    expect(retry.textContent).toBe("Retry same request");
    await click(retry);
    const commands = m.actions();
    expect(commands).toHaveLength(2);
    expect(commands[1]).toEqual(commands[0]);
    expect(q("[data-testid=channel-management-edit-dialog]")).toBeNull();
  });
});

describe("original moderation rows over governed hints", () => {
  it("shows Leave and Archive by hint and submits leave for the caller only", async () => {
    const m = mount({ leaveActionKey: "workspace.leave", lifecycleActionKey: "workspace.suspend" });
    await m.render();
    await vi.waitFor(() => expect(q("[data-testid=channel-management-leave]")).not.toBeNull());
    expect(q("[data-testid=channel-management-leave]")?.textContent).toBe("Leave channel");
    expect(q("[data-testid=channel-management-archive]")?.textContent).toBe("Archive channel");
    expect(q("[data-testid=channel-management-unarchive]")).toBeNull();
    expect(q("[data-testid=channel-management-delete]")).toBeNull();
    await click(q("[data-testid=channel-management-leave]")!);
    expect(m.actions()).toEqual([{ actionKey: "workspace.leave", workspaceId: "w", idempotencyKey: expect.any(String) }]);
    expect(m.opened).toHaveBeenCalledWith(false);
    expect(m.host.refresh).toHaveBeenCalled();
  });

  it("restores the original Join channel row for a non-member and submits workspace.join", async () => {
    const m = mount({ joinActionKey: "workspace.join" }, { member: false });
    await m.render();
    await vi.waitFor(() => expect(q("[data-testid=channel-management-join]")).not.toBeNull());
    const row = q("[data-testid=channel-management-join]")!;
    expect(row.textContent).toContain("Join channel");
    expect(row.textContent).toContain("Add this channel to your sidebar");
    expect(q("[data-testid=channel-management-leave]")).toBeNull();
    await click(row);
    await settle();
    const commands = m.actions();
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ actionKey: "workspace.join", workspaceId: "w" });
    expect(m.host.refresh).toHaveBeenCalled();
    expect(m.opened).not.toHaveBeenCalledWith(false);
    expect(q("[data-testid=channel-management-join-outcome]")?.textContent).toContain("Operation: operation");
  });

  it("offers no Join row to a member even with a join hint", async () => {
    const member = mount({ joinActionKey: "workspace.join" });
    await member.render();
    expect(q("[data-testid=channel-management-join]")).toBeNull();
  });

  it("offers no Join row on an archived channel even with a join hint", async () => {
    const archived = mount({ joinActionKey: "workspace.join" }, { member: false, channel: { archived: true } });
    await archived.render();
    expect(q("[data-testid=channel-management-join]")).toBeNull();
    expect(archived.actions()).toHaveLength(0);
  });

  it("confirms Archive before submitting the existing workspace.suspend", async () => {
    const m = mount({ lifecycleActionKey: "workspace.suspend" });
    await m.render();
    await vi.waitFor(() => expect(q("[data-testid=channel-management-archive]")).not.toBeNull());
    expect(q("[data-testid=channel-management-leave]")).toBeNull();
    await click(q("[data-testid=channel-management-archive]")!);
    expect(m.actions()).toHaveLength(0);
    expect(q("[data-testid=channel-management-lifecycle-confirm]")?.textContent).toContain("Archive general?");
    await click(q("[data-testid=channel-management-lifecycle-submit]")!);
    expect(m.actions()).toEqual([{ actionKey: "workspace.suspend", workspaceId: "w", idempotencyKey: expect.any(String) }]);
    expect(q("[data-testid=channel-management-lifecycle-confirm]")).toBeNull();
  });

  it("offers only reopen for a TTL-archived channel and sends reopen alone", async () => {
    const m = mount({ updateActionKey: "workspace.update", canReopen: true, lifecycleActionKey: "workspace.suspend" },
      { channel: { archived: true, ttlSeconds: 3_600 } });
    await m.render();
    await vi.waitFor(() => expect(q("[data-testid=channel-management-unarchive]")).not.toBeNull());
    expect(q("[data-testid=channel-management-edit]")).toBeNull();
    expect(q("[data-testid=channel-management-archive]")).toBeNull();
    const unarchive = q("[data-testid=channel-management-unarchive]")!;
    expect(unarchive.textContent).toBe("Unarchive channel");
    await click(unarchive);
    expect(m.actions()).toEqual([{ actionKey: "workspace.update", workspaceId: "w", workspaceUpdate: { reopen: true }, idempotencyKey: expect.any(String) }]);
  });
});

describe("member topic publication", () => {
  it("shows the topic read-only without a host publisher", async () => {
    const m = mount({});
    await m.render();
    const row = q("[data-testid=channel-management-topic]")!;
    expect(row.tagName).toBe("DIV");
    expect(row.textContent).toContain("Old topic");
  });

  it("publishes with one Idempotency-Key and keeps the UNKNOWN intent for the same resend", async () => {
    const publishTopic = vi.fn<NonNullable<ChannelManagementHost["publishTopic"]>>()
      .mockRejectedValueOnce(new TransportError("connection lost"))
      .mockResolvedValueOnce(undefined);
    const m = mount({}, { publishTopic });
    await m.render();
    await vi.waitFor(() => expect(q("[data-testid=channel-management-topic]")?.tagName).toBe("BUTTON"));
    await click(q("[data-testid=channel-management-topic]")!);
    const dialog = q("[data-testid=channel-management-topic-dialog]")!;
    const input = q<HTMLTextAreaElement>("[data-testid=channel-management-topic-input]", dialog)!;
    expect(input.value).toBe("Old topic");
    await type(input, " New topic ");
    await settle();
    await click(q("[data-testid=channel-management-topic-save]", dialog)!);
    expect(q("[data-testid=channel-management-topic-error]", dialog)?.textContent)
      .toBe("The topic change is not confirmed yet. Retry checks the same publication.");
    expect(input.disabled).toBe(true);
    const retry = q<HTMLButtonElement>("[data-testid=channel-management-topic-save]", dialog)!;
    expect(retry.textContent).toBe("Retry same request");
    await click(retry);
    expect(publishTopic).toHaveBeenCalledTimes(2);
    const [first, second] = publishTopic.mock.calls;
    expect(first?.[0]).toBe("w");
    expect(first?.[1]).toEqual({ topic: "New topic" });
    expect(second?.[1]).toEqual(first?.[1]);
    expect(typeof first?.[2]).toBe("string");
    expect(second?.[2]).toBe(first?.[2]);
    expect(q("[data-testid=channel-management-topic-dialog]")).toBeNull();
    expect(m.host.refresh).toHaveBeenCalled();
    expect(m.actions()).toHaveLength(0);
  });
});

describe("original ChannelMembersBar count", () => {
  it("shows the directory memberCount until the roster read settles (original channel.memberCount)", async () => {
    const send = vi.fn((request: BffRequest): Promise<BffReply> => request.path === "/api/v1/workspaces/w/members"
      ? new Promise<BffReply>(() => {}) : Promise.resolve({ status: 404, body: {} }));
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    await render(<QueryClientProvider client={cache}><PlatformProvider client={createBffClient({ send })} locale="en">
      <ChannelMembersBar fallbackMemberCount={7} onManageChannel={() => {}} onToggleMembers={() => {}} roster={{ kind: "workspace", workspaceId: "w" }} />
    </PlatformProvider></QueryClientProvider>);
    await settle();
    expect(q("[data-testid=channel-members-trigger]")?.getAttribute("aria-label")).toContain("7");
  });
});
