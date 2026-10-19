// @vitest-environment jsdom
// DD-125(4) (SF-BUZ-54, V-SCN-135): Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/channels/ui/ChannelCanvas.tsx and the ChannelManagementSheet Canvas row,
// over the BFF Canvas read and the governed workspace.canvas.set.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionDispatchState, ActionGateState, ErrorClass, ReasonCode, type ActionCommand } from "@client-kit/contracts";
import { createBffClient } from "../src/client";
import { setLocale } from "../src/i18n";
import { PlatformProvider } from "../src/react/context";
import { ChannelCanvas, getMarkdownPreviewText, MAX_CANVAS_BYTES } from "../src/react/channel-canvas";
import { ChannelManagementSheet, type ChannelManagementHost } from "../src/react/channel-management-sheet";
import type { BffReply, BffRequest } from "../src/transport";
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

type View = { content?: string; setActionKey?: string };

const recorded = (command: ActionCommand): BffReply => ({ status: 200, body: {
  actionExecutionId: "execution", actionKey: command.actionKey, operationId: "operation",
  gateState: ActionGateState.Allowed, dispatchState: ActionDispatchState.Dispatched,
} });

function backend(initial: View, action: (command: ActionCommand, attempt: number) => BffReply = recorded) {
  let view: View = initial;
  let attempt = 0;
  const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
    if (request.path === "/api/v1/workspaces/w/canvas") return { status: 200, body: { workspaceId: "w", ...view } };
    if (request.method === "POST" && request.path === "/api/v1/actions") {
      const command = request.body as ActionCommand;
      const reply = action(command, attempt++);
      if (reply.status === 200 && command.workspaceCanvas) view = { ...view, content: command.workspaceCanvas.content };
      return reply;
    }
    if (request.path === "/api/v1/workspaces/w/members")
      return { status: 200, body: [{ principalId: "me", displayName: "Ada", state: "ACTIVE", pubkeys: ["e".repeat(64)] }] };
    if (request.path === "/api/v1/discoverable-workspaces?channelId=c") return { status: 200, body: { items: [] } };
    if (request.path === "/api/v1/role-workspaces") return { status: 200, body: { workspaces: [] } };
    return { status: 404, body: {} };
  });
  const commands = () => send.mock.calls.map(([request]) => request)
    .filter((request) => request.method === "POST" && request.path === "/api/v1/actions").map((request) => request.body as ActionCommand);
  return { send, commands };
}

const markdown = (content: string) => <div data-testid="rendered-markdown">{content}</div>;

async function mountCanvas(initial: View, options: { archived?: boolean; action?: (command: ActionCommand, attempt: number) => BffReply } = {}) {
  const api = backend(initial, options.action);
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await render(<QueryClientProvider client={cache}><PlatformProvider client={createBffClient({ send: api.send })} locale="en">
    <ChannelCanvas canEdit={initial.setActionKey === "workspace.canvas.set"} isArchived={options.archived === true}
      renderMarkdown={markdown} workspaceId="w" />
  </PlatformProvider></QueryClientProvider>);
  await settle();
  return api;
}

const q = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T & HTMLElement>(selector);

describe("original channel Canvas over the governed write", () => {
  it("reads the adopted Canvas through the host renderer and the empty state", async () => {
    await mountCanvas({ content: "# Release room" });
    await vi.waitFor(() => expect(q("[data-testid=rendered-markdown]")?.textContent).toBe("# Release room"));
    expect(q("[data-testid=channel-canvas-content]")).not.toBeNull();
    expect(q("[data-testid=channel-canvas-edit]")).toBeNull();
  });

  it("offers no edit without the BFF hint", async () => {
    await mountCanvas({});
    await vi.waitFor(() => expect(document.body.textContent).toContain("No canvas set for this channel."));
    expect(q("[data-testid=channel-canvas-edit]")).toBeNull();
  });

  it("offers no edit on an archived channel even with the hint", async () => {
    await mountCanvas({ content: "x", setActionKey: "workspace.canvas.set" }, { archived: true });
    await vi.waitFor(() => expect(q("[data-testid=channel-canvas-content]")).not.toBeNull());
    expect(q("[data-testid=channel-canvas-edit]")).toBeNull();
  });

  it("saves one explicitly confirmed workspace.canvas.set with the body and leaves edit mode", async () => {
    const api = await mountCanvas({ setActionKey: "workspace.canvas.set" });
    await vi.waitFor(() => expect(q("[data-testid=channel-canvas-edit]")?.textContent).toBe("Create canvas"));
    await click(q("[data-testid=channel-canvas-edit]")!);
    await type(q<HTMLTextAreaElement>("[data-testid=channel-canvas-editor]")!, "# Plan\n\nShip it.");
    await click(q("[data-testid=channel-canvas-save]")!);
    const commands = api.commands();
    expect(commands).toEqual([{ actionKey: "workspace.canvas.set", idempotencyKey: commands[0]!.idempotencyKey, workspaceId: "w",
      explicitConfirmation: true, workspaceCanvas: { content: "# Plan\n\nShip it." } }]);
    expect(commands[0]!.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await vi.waitFor(() => expect(q("[data-testid=rendered-markdown]")?.textContent).toBe("# Plan\n\nShip it."));
    expect(q("[data-testid=channel-canvas-editor]")).toBeNull();
    expect(q("[data-testid=channel-canvas-edit]")?.textContent).toBe("Edit canvas");
  });

  it("keeps the same command and key after an unknown outcome and resends only that", async () => {
    const api = await mountCanvas({ content: "old", setActionKey: "workspace.canvas.set" }, {
      action: (command, attempt) => attempt === 0
        ? { status: 503, body: { class: ErrorClass.Unknown, reason: ReasonCode.DependencyUnavailable, operationId: "operation" } }
        : recorded(command),
    });
    await vi.waitFor(() => expect(q("[data-testid=channel-canvas-edit]")).not.toBeNull());
    await click(q("[data-testid=channel-canvas-edit]")!);
    await type(q<HTMLTextAreaElement>("[data-testid=channel-canvas-editor]")!, "new");
    await click(q("[data-testid=channel-canvas-save]")!);
    expect(q("[data-testid=channel-canvas-save-outcome]")?.textContent)
      .toBe("The canvas save isn't confirmed yet. Check Tasks before trying again.");
    expect(q<HTMLTextAreaElement>("[data-testid=channel-canvas-editor]")!.disabled).toBe(true);
    expect(q<HTMLButtonElement>("[data-testid=channel-canvas-cancel]")!.disabled).toBe(true);
    await click(q("[data-testid=channel-canvas-save]")!);
    const commands = api.commands();
    expect(commands).toHaveLength(2);
    expect(commands[1]).toEqual(commands[0]);
    await vi.waitFor(() => expect(q("[data-testid=channel-canvas-editor]")).toBeNull());
  });

  it("reports a refusal and refuses an oversized Canvas locally", async () => {
    const api = await mountCanvas({ setActionKey: "workspace.canvas.set" }, {
      action: () => ({ status: 403, body: { class: ErrorClass.Denied, reason: ReasonCode.PermissionDenied } }),
    });
    await vi.waitFor(() => expect(q("[data-testid=channel-canvas-edit]")).not.toBeNull());
    await click(q("[data-testid=channel-canvas-edit]")!);
    await type(q<HTMLTextAreaElement>("[data-testid=channel-canvas-editor]")!, "x".repeat(MAX_CANVAS_BYTES + 1));
    await settle();
    expect(document.body.textContent).toContain("The canvas is larger than 64 KB.");
    expect(q<HTMLButtonElement>("[data-testid=channel-canvas-save]")!.disabled).toBe(true);
    expect(api.commands()).toHaveLength(0);
    await type(q<HTMLTextAreaElement>("[data-testid=channel-canvas-editor]")!, "fits");
    await click(q("[data-testid=channel-canvas-save]")!);
    expect(api.commands()).toHaveLength(1);
    expect(q("[data-testid=channel-canvas-save-outcome]")?.textContent).toMatch(/^Couldn't save the canvas: /);
    expect(q("[data-testid=channel-canvas-editor]")).not.toBeNull();
  });

  it("previews Markdown as one plain line", () => {
    expect(getMarkdownPreviewText("# Title\n\n- [x] **done** with [link](https://x.test)\n> `code`"))
      .toBe("Title done with link code");
  });
});

describe("Channel settings Canvas row", () => {
  async function mountSheet(initial: View, renderCanvas: ChannelManagementHost["renderCanvas"]) {
    const api = backend(initial);
    const host: ChannelManagementHost = { refresh: vi.fn(), ...(renderCanvas ? { renderCanvas } : {}) };
    function Host() {
      const [open, setOpen] = useState(true);
      return <ChannelManagementSheet channel={{ channelId: "c", name: "general", description: "", channelType: "stream", ttlSeconds: null }}
        isDark={false} management={host} onCopy={async () => {}} onOpenChange={setOpen} open={open}
        roster={{ kind: "workspace", workspaceId: "w" }} />;
    }
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    await render(<QueryClientProvider client={cache}><PlatformProvider client={createBffClient({ send: api.send })} locale="en">
      <Host /></PlatformProvider></QueryClientProvider>);
    await settle();
    return api;
  }

  it("shows the original row with the preview and opens the Canvas view", async () => {
    await mountSheet({ content: "## Goals\nShip **v2**" }, markdown);
    await vi.waitFor(() => expect(q("[data-testid=channel-canvas-ingress]")).not.toBeNull());
    expect(q("[data-testid=channel-canvas-ingress-section]")?.textContent).toContain("Goals Ship v2");
    await click(q("[data-testid=channel-canvas-ingress]")!);
    await vi.waitFor(() => expect(q("[data-testid=channel-canvas-section]")).not.toBeNull());
    expect(q("[data-testid=rendered-markdown]")?.textContent).toBe("## Goals\nShip **v2**");
    await click(q("[data-testid=channel-management-back]")!);
    expect(q("[data-testid=channel-canvas-section]")).toBeNull();
  });

  it("hides the row without a Canvas or edit hint", async () => {
    const empty = await mountSheet({}, markdown);
    await vi.waitFor(() => expect(empty.send.mock.calls.some(([request]) => request.path === "/api/v1/workspaces/w/canvas")).toBe(true));
    await settle();
    expect(q("[data-testid=channel-canvas-ingress]")).toBeNull();
  });

  it("offers the row to an editor before any Canvas exists", async () => {
    await mountSheet({ setActionKey: "workspace.canvas.set" }, markdown);
    await vi.waitFor(() => expect(q("[data-testid=channel-canvas-ingress]")).not.toBeNull());
  });

  it("never reads or offers the Canvas on a host without a Markdown renderer", async () => {
    const noRenderer = await mountSheet({ content: "x", setActionKey: "workspace.canvas.set" }, undefined);
    expect(noRenderer.send.mock.calls.some(([request]) => request.path === "/api/v1/workspaces/w/canvas")).toBe(false);
    expect(q("[data-testid=channel-canvas-ingress]")).toBeNull();
  });
});
