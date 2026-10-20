// Buzz 779af8886caae1317b4de962082429867ab61503 UserProfilePanel Agent tabs, sections, focused
// views and activity ingress over the admitted Installation (DD-125(6), DD-68, 17 §8).
import { act, type ReactNode } from "react";
import type { AgentInstallationView } from "@client-kit/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { setLocale } from "../src/i18n";
import { PlatformProvider } from "../src/react/context";
import {
  AgentActivityOpenerProvider,
  type AgentActivityOpener,
} from "../src/react/agent-transcript";
import {
  UserProfileAgentPanel,
  useProfileAgentLookup,
  type UserProfileAgentScope,
} from "../src/react/pulse";
import type { BffReply, BffRequest } from "../src/transport";
import { click, render, settle } from "./render";

const AGENT = "a".repeat(64);
const OWNER = "b".repeat(64);
const OTHER_AGENT = "c".repeat(64);
const directoryPath = "/api/v1/agent-installations?workspaceId=workspace";
const membersPath = "/api/v1/workspaces/workspace/members";
const usersPath = "/api/v1/agent-installations/installation/users";
const versionPath = "/api/v1/agent-versions/version";

const installation = {
  resourceId: "installation",
  workspaceId: "workspace",
  agentResourceId: "definition",
  pinnedVersionAssetId: "version",
  agentPrincipalId: "agent-principal",
  ownerPrincipalId: "owner",
  resourceVersion: 3,
  resourceState: "ACTIVE",
  state: "ACTIVE",
  agentPrincipalState: "ACTIVE",
  agentPubkey: AGENT,
  agentDisplayName: "Scout",
  canAudit: true,
  canDisable: true,
  channelBinding: { channelId: "channel-1", status: "ACTIVE", triggers: ["MENTION"] },
  projection: {
    generation: 2,
    agentVersionAssetId: "version",
    runtimeProfileKey: "codex-server",
    configHash: "f".repeat(64),
    state: "ACTIVE",
  },
  activeProjectionGeneration: 2,
} as AgentInstallationView;
const sibling = {
  ...installation,
  resourceId: "installation-2",
  agentPrincipalId: "agent-principal-2",
  agentPubkey: OTHER_AGENT,
  agentDisplayName: "Scout copy",
  state: "DISABLED",
  canAudit: false,
  canDisable: false,
} as AgentInstallationView;

beforeEach(() => {
  setLocale("en");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

function Host({ pubkey, scope }: { pubkey: string; scope: UserProfileAgentScope }) {
  const agent = useProfileAgentLookup(scope, pubkey);
  if (agent.status === "pending") return <p data-testid="lookup-pending">pending</p>;
  if (agent.status !== "agent") return <p data-testid="public-profile">public</p>;
  return (
    <UserProfileAgentPanel
      displayName="Scout"
      installation={agent.installation}
      isOverlay={false}
      isSinglePanelView={false}
      isSplitLayout={false}
      mediaUrl={(url) => url}
      onClose={() => {}}
      profile={{ displayName: "Scout", about: "Release helper", avatarUrl: null, nip05Handle: null }}
      pubkey={pubkey}
      reload={agent.reload}
      rows={agent.rows}
      scope={scope}
      splitPaneClamp={false}
      widthPx={360}
    />
  );
}

async function setup({
  pubkey = AGENT,
  principal = "owner",
  opener,
  onOpenChannel,
}: {
  pubkey?: string;
  principal?: string;
  opener?: AgentActivityOpener;
  onOpenChannel?: (channelId: string) => void;
} = {}) {
  const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
    if (request.path === directoryPath) return { status: 200, body: { installations: [installation, sibling] } };
    if (request.path === membersPath) {
      return { status: 200, body: [{ principalId: "owner", displayName: "Olivia", pubkeys: [OWNER], state: "ACTIVE" }] };
    }
    if (request.path === usersPath) {
      return { status: 200, body: { installationId: "installation", resourceVersion: 3, members: [] } };
    }
    if (request.path === versionPath) {
      return { status: 200, body: { assetId: "version", content: { instructions: "Review every release note." } } };
    }
    return { status: 503, body: undefined };
  });
  const scope: UserProfileAgentScope = { workspaceId: "workspace", channelName: "general", onOpenChannel };
  let tree: ReactNode = <Host pubkey={pubkey} scope={scope} />;
  if (opener) tree = <AgentActivityOpenerProvider value={opener}>{tree}</AgentActivityOpenerProvider>;
  const host = await render(
    <PlatformProvider client={createBffClient({ send })} locale="en" currentPrincipalId={principal}>
      {tree}
    </PlatformProvider>,
  );
  await settle();
  return { host, send };
}

const byTestId = (host: ParentNode, id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);

async function selectTab(host: HTMLElement, tab: string) {
  const trigger = byTestId(host, `user-profile-tab-${tab}`);
  if (!trigger) throw new Error(`no ${tab} tab: ${host.textContent}`);
  // Radix Tabs activates on primary-button mousedown.
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  });
  await settle();
}

describe("Agent profile panel over the admitted Installation", () => {
  it("keeps a pubkey outside the Workspace directory a public profile", async () => {
    const { host, send } = await setup({ pubkey: "d".repeat(64) });
    expect(byTestId(host, "public-profile")).not.toBeNull();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: directoryPath }));
    expect(send.mock.calls.some(([request]) => request.path === membersPath)).toBe(false);
  });

  it("shows the owner the original Info, Runtime, Channels and Memories tabs", async () => {
    const { host, send } = await setup();
    const tabs = [...(byTestId(host, "user-profile-tab-list")?.querySelectorAll('[role="tab"]') ?? [])]
      .map((tab) => tab.getAttribute("data-testid"));
    expect(tabs).toEqual([
      "user-profile-tab-info",
      "user-profile-tab-runtime",
      "user-profile-tab-channels",
      "user-profile-tab-memories",
    ]);
    expect(byTestId(host, "user-profile-sticky-hero")?.textContent).toContain("Release helper");
    expect(byTestId(host, "user-profile-managed-by")?.textContent).toContain("Olivia (you)");
    expect(byTestId(host, "user-profile-public-key")).not.toBeNull();
    expect(byTestId(host, "user-profile-agent-instruction-row")).not.toBeNull();
    expect(byTestId(host, "user-profile-delete-agent-row")).not.toBeNull();
    expect(byTestId(host, "user-profile-agent-primary-action")?.textContent).toContain("Stop");
    expect(send.mock.calls.every(([request]) => request.method === "GET")).toBe(true);

    await selectTab(host, "runtime");
    const runtime = byTestId(host, "user-profile-runtime-sections");
    expect(runtime?.textContent).toContain("Running");
    expect(runtime?.textContent).toContain("codex-server");
    expect(runtime?.textContent).toContain("Only Olivia (you) (owner)");
    expect(byTestId(host, "user-profile-instances")?.textContent).toContain("2 instances");
    await click(byTestId(host, "user-profile-instances")!);
    expect(byTestId(host, `user-profile-instance-${AGENT}`)?.textContent).toContain("Current");
    expect(byTestId(host, `user-profile-instance-${OTHER_AGENT}`)?.textContent).toContain("Disabled");

    await selectTab(host, "memories");
    expect(byTestId(host, "agent-memory")).not.toBeNull();
    expect(send.mock.calls.some(([request]) => request.path.includes("/memory/"))).toBe(false);
  });

  it("opens the instructions focused view and returns to the summary", async () => {
    const { host } = await setup();
    await click(byTestId(host, "user-profile-agent-instruction-row")!);
    expect(byTestId(host, "user-profile-agent-instructions-view")?.textContent).toBe("Review every release note.");
    expect(byTestId(host, "user-profile-summary-scroll-layout")).toBeNull();
    await click(byTestId(host, "user-profile-panel-back")!);
    expect(byTestId(host, "user-profile-summary-scroll-layout")).not.toBeNull();
  });

  it("gives another member only public fields, the owner and the channel", async () => {
    const onOpenChannel = vi.fn();
    const { host, send } = await setup({ principal: "member", onOpenChannel });
    expect(byTestId(host, "user-profile-tab-runtime")).toBeNull();
    expect(byTestId(host, "user-profile-tab-memories")).toBeNull();
    expect(byTestId(host, "user-profile-managed-by")?.textContent).toContain("Olivia");
    expect(byTestId(host, "user-profile-managed-by")?.textContent).not.toContain("(you)");
    expect(byTestId(host, "user-profile-agent-instruction-row")).toBeNull();
    expect(byTestId(host, "user-profile-delete-agent-row")).toBeNull();
    expect(byTestId(host, "user-profile-primary-actions")).toBeNull();
    expect(send.mock.calls.some(([request]) => request.path === usersPath || request.path === versionPath)).toBe(false);

    await selectTab(host, "channels");
    await click(byTestId(host, "user-profile-channel-link-general")!);
    expect(onOpenChannel).toHaveBeenCalledWith("channel-1");
  });

  it("offers the activity log only through the audited opener", async () => {
    const opener = { openAgentActivity: vi.fn(), canOpenAgentActivity: (pubkey: string) => pubkey === AGENT };
    const { host } = await setup({ opener });
    const ingress = byTestId(host, `user-profile-view-activity-${AGENT}`);
    expect(ingress?.textContent).toContain("Activity log");
    await click(ingress!);
    expect(opener.openAgentActivity).toHaveBeenCalledWith(AGENT, { channelId: null });

    const { host: withoutOpener } = await setup();
    expect(byTestId(withoutOpener, `user-profile-view-activity-${AGENT}`)).toBeNull();
  });

  it("maps Delete agent onto the governed disable confirm", async () => {
    const { host, send } = await setup();
    await click(byTestId(host, "user-profile-delete-agent-row")!);
    expect(byTestId(document, "agent-lifecycle-confirm")?.textContent).toContain("Remove 1 agent from channel?");
    expect(send.mock.calls.every(([request]) => request.method === "GET")).toBe(true);
  });
});
