// Buzz 779af8886caae1317b4de962082429867ab61503 MembersSidebar agent rows and AddChannelBotDialog,
// mapped onto the governed Workspace installation directory (agent.installation.create).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { ChannelMembersDialog, type MemberRoster } from "../src/react/channel-members";
import type { BffReply, BffRequest } from "../src/transport";
import { render, settle, click, type } from "./render";

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(420);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 420));
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const installation = (resourceId: string, name: string, state = "ACTIVE") => ({
  resourceId, workspaceId: "w", agentResourceId: `def-${resourceId}`, pinnedVersionAssetId: `asset-${resourceId}`,
  agentPrincipalId: `agent-${resourceId}`, ownerPrincipalId: "me", resourceVersion: 1, resourceState: "ACTIVE", state,
  agentPrincipalState: "ACTIVE", agentDisplayName: name, agentPubkey: "a".repeat(64),
  channelBinding: { status: state === "ACTIVE" ? "ACTIVE" : "DISABLED", triggers: ["MENTION"], channelId: "c" },
  ...(state === "ACTIVE" ? { projection: { generation: 1, agentVersionAssetId: `asset-${resourceId}`, runtimeProfileKey: "default",
    configHash: "0".repeat(64), state: "ACTIVE" }, activeProjectionGeneration: 1 } : {}),
});
const helper = installation("inst-1", "Helper"), paused = installation("inst-2", "Paused", "DISABLED");

function route(request: BffRequest): BffReply {
  const path = request.path;
  if (path === "/api/v1/workspaces/w/members") return { status: 200, body: [{ principalId: "me", displayName: "Ada", state: "ACTIVE", pubkeys: ["e".repeat(64)] }] };
  if (path.startsWith("/api/v1/agent-installations?")) return { status: 200, body: { installations: [helper, paused] } };
  if (path === "/api/v1/agent-installations/inst-1") return { status: 200, body: helper };
  if (path.startsWith("/api/v1/agent-installation-candidates?")) return { status: 200, body: { workspaceId: "w", canCreate: true,
    candidates: [{ agentResourceId: "def-new", agentVersionAssetId: "asset-new", displayName: "Writer", resourceVersion: 1, assetVersion: 1, ordinal: 1 }] } };
  if (path === "/api/v1/tasks") return { status: 200, body: [] };
  return { status: 403, body: {} };
}

function mount(roster: MemberRoster, workspaceName?: string) {
  const send = vi.fn(async (request: BffRequest) => route(request));
  const closed = vi.fn();
  function Host() {
    const [open, setOpen] = useState(true);
    return <ChannelMembersDialog roster={roster} open={open} currentPrincipalId="me" workspaceName={workspaceName}
      onOpenChange={(next) => { setOpen(next); if (!next) closed(); }} />;
  }
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return { send, closed, render: () => render(<QueryClientProvider client={cache}><PlatformProvider locale="en" client={createBffClient({ send })} currentPrincipalId="me"><Host /></PlatformProvider></QueryClientProvider>) };
}

describe("original channel member dialog agent rows over governed installations", () => {
  it("lists the Workspace's installations with name, owner and presence, one directory read", async () => {
    const m = mount({ kind: "workspace", workspaceId: "w" }, "General");
    await m.render();
    await vi.waitFor(() => expect(document.querySelector('[data-testid="sidebar-agent-inst-1"]')).not.toBeNull());
    const section = document.querySelector<HTMLElement>('[data-testid="members-sidebar-agents"]')!;
    expect(section.textContent).toContain("Agents · 2");
    expect(section.textContent).toContain("Helper");
    expect(section.textContent).toContain("Added by Ada");
    expect(document.querySelector('[data-testid="sidebar-agent-presence-inst-1"] span')!.className).toContain("bg-emerald-500");
    expect(document.querySelector('[data-testid="sidebar-agent-presence-inst-2"] span')!.className).toContain("bg-muted-foreground/35");
    expect(m.send.mock.calls.filter(([request]) => request.path.startsWith("/api/v1/agent-installations?"))).toHaveLength(1);
    await type(document.querySelector<HTMLInputElement>('[data-testid="channel-management-search-users"]')!, "help");
    await settle();
    expect(document.querySelector('[data-testid="sidebar-agent-inst-1"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="sidebar-agent-inst-2"]')).toBeNull();
  });

  it("opens the governed installation detail from an agent row", async () => {
    const m = mount({ kind: "workspace", workspaceId: "w" }, "General");
    await m.render();
    await vi.waitFor(() => expect(document.querySelector('[data-testid="sidebar-agent-open-inst-1"]')).not.toBeNull());
    await click(document.querySelector<HTMLButtonElement>('[data-testid="sidebar-agent-open-inst-1"]')!);
    expect(m.closed).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(document.querySelector('[data-testid="agent-installation-detail"]')).not.toBeNull());
    expect(m.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/agent-installations/inst-1" });
  });

  it("opens the governed agent.installation.create dialog from Add agent without writing", async () => {
    const n = mount({ kind: "workspace", workspaceId: "w" }, "General");
    await n.render();
    await vi.waitFor(() => expect(document.querySelector('[data-testid="members-sidebar-add-agent"]')).not.toBeNull());
    await click(document.querySelector<HTMLButtonElement>('[data-testid="members-sidebar-add-agent"]')!);
    await vi.waitFor(() => expect(document.querySelector('[data-testid="agent-installation-create"]')?.textContent).toContain("Writer"));
    expect(n.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/agent-installation-candidates?workspaceId=w&offset=0" });
    expect(n.send.mock.calls.some(([request]) => request.method !== "GET")).toBe(false);
  });

  it("offers no Add agent without a Workspace name", async () => {
    const m = mount({ kind: "workspace", workspaceId: "w" });
    await m.render();
    await vi.waitFor(() => expect(document.querySelector('[data-testid="sidebar-agent-inst-1"]')).not.toBeNull());
    expect(document.querySelector('[data-testid="members-sidebar-add-agent"]')).toBeNull();
  });

  it("has no agent section on a DM roster", async () => {
    const dm = mount({ kind: "conversation", conversation: { id: "dm", participantPrincipalIds: ["me", "peer"] } }, "General");
    await dm.render(); await settle();
    expect(document.querySelector('[data-testid="members-sidebar-agents"]')).toBeNull();
    expect(dm.send.mock.calls.some(([request]) => request.path.includes("agent-installations"))).toBe(false);
  });
});
