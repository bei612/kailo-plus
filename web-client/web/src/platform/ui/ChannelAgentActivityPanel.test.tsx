// @vitest-environment jsdom
// DD-125(6), V-SCN-143: the channel opens an Agent's activity panel only for an
// Installation whose `audit` the viewer holds; others stay closed (20002 only).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentInstallationView } from "@client-kit/contracts";
import { createBffClient } from "@client-kit/platform/client";
import { setLocale } from "@client-kit/platform/i18n";
import { PlatformProvider } from "@client-kit/platform/react/context";
import type { BffReply, BffRequest } from "@client-kit/platform/transport";
import type { ComposerAgent } from "@client-kit/platform/react/composer/features/messages/lib/composerAgentDirectory";
import { useChannelAgentActivityPanel } from "./ChannelAgentActivityPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setLocale("en");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const audited = "a".repeat(64);
const member = "b".repeat(64);
const agent = (pubkey: string, canAudit: boolean): ComposerAgent => ({ pubkey, displayName: canAudit ? "Scout" : "Helper", avatarUrl: null,
  installation: { resourceId: `installation-${pubkey.slice(0, 1)}`, workspaceId: "workspace", agentPrincipalId: "agent", agentPubkey: pubkey,
    canAudit } as AgentInstallationView });
const agents = [agent(audited, true), agent(member, false)];
let opener: ReturnType<typeof useChannelAgentActivityPanel>["opener"] | undefined;

function Harness() {
  const activity = useChannelAgentActivityPanel({ agents, channelId: "channel", channelName: "release", enabled: true,
    scopeId: "workspace" });
  opener = activity.opener;
  return <>{activity.panel}</>;
}

it("mounts the audit-only activity panel and keeps others closed", async () => {
  const send = vi.fn(async (request: BffRequest): Promise<BffReply> => request.path === "/api/v1/agent-installations/installation-a/sessions"
    ? { status: 200, body: { sessions: [] } } : { status: 503, body: undefined });
  await act(async () => root.render(<PlatformProvider client={createBffClient({ send })} locale="en"><Harness /></PlatformProvider>));
  expect(opener?.canOpenAgentActivity?.(member)).toBe(false);
  await act(async () => opener?.openAgentActivity(member));
  expect(host.querySelector('[data-testid="agent-session-thread-panel"]')).toBeNull();
  expect(send).not.toHaveBeenCalled();
  expect(opener?.canOpenAgentActivity?.(audited.toUpperCase())).toBe(true);
  await act(async () => opener?.openAgentActivity(audited.toUpperCase()));
  await vi.waitFor(() => expect(host.querySelector('[data-testid="agent-session-thread-panel"]')).not.toBeNull());
  expect(host.querySelector('[data-testid="agent-session-agent-name"]')?.textContent).toBe("Scout");
  expect(host.querySelector('[data-testid="agent-session-scope-label"]')?.textContent).toBe("Activity · #release");
  expect(send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/agent-installations/installation-a/sessions" });
});
