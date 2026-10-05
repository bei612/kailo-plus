// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TransportError } from "@client-kit/platform/transport";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  AgentTrigger,
  AgentInstallationState,
  AgentPrincipalState,
  ResourceState,
  ChannelBindingStatus,
  type AgentInstallationView,
} from "@client-kit/contracts";
import { Composer } from "./ChannelPane";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let mounted: { root: Root; host: HTMLElement } | undefined;
afterEach(() => {
  if (mounted) {
    act(() => mounted!.root.unmount());
    mounted.host.remove();
    mounted = undefined;
  }
});
async function render(ui: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = { root, host };
  await act(async () => root.render(ui));
  return host;
}
async function settle() {
  await act(async () => {});
}
function button(host: HTMLElement, label: string) {
  const found = [...host.querySelectorAll("button")].find(
    (entry) => entry.textContent === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function click(target: HTMLElement) {
  await act(async () => target.click());
}
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const state = vi.hoisted(() => ({
  pages: [] as { installations: AgentInstallationView[] }[],
  success: true,
  next: false,
  more: vi.fn(),
  publish: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useInfiniteQuery: () => ({
    data: { pages: state.pages },
    isSuccess: state.success,
    isPending: false,
    isError: !state.success,
    hasNextPage: state.next,
    isFetchingNextPage: false,
    fetchNextPage: state.more,
  }),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
}));
vi.mock("@/platform/bff-client", () => ({
  bff: {},
  BffError: class extends Error {},
  publishMessage: state.publish,
  markRead: vi.fn(),
  openStream: vi.fn(),
  uploadMedia: vi.fn(),
  fetchUserState: vi.fn(),
}));
vi.mock("@/shared/i18n", () => ({ t: (key: string) => key }));
vi.mock("@/features/chat/ui/MessageContent", () => ({
  MessageContent: () => null,
}));

function installation(resourceId: string): AgentInstallationView {
  return {
    resourceId,
    workspaceId: "workspace-a",
    agentResourceId: "definition-a",
    pinnedVersionAssetId: "version-a",
    agentPrincipalId: resourceId,
    agentPrincipalState: AgentPrincipalState.Active,
    ownerPrincipalId: "human-a",
    resourceVersion: 1,
    resourceState: ResourceState.Active,
    state: AgentInstallationState.Active,
    executionPermission: {
      requested: true,
      effective: true,
      canGrant: false,
      canRevoke: true,
    },
    channelBinding: {
      status: ChannelBindingStatus.Active,
      triggers: [AgentTrigger.Mention],
    },
  };
}
beforeEach(() => {
  state.pages = [
    { installations: [installation("agent-b"), installation("agent-a")] },
  ];
  state.success = true;
  state.next = false;
  state.more.mockReset();
  state.publish
    .mockReset()
    .mockResolvedValue({ eventId: "event", operationId: "operation" });
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});
async function select(host: HTMLElement, id: string) {
  await click(button(host, "platform.mentionAgent"));
  const option = host.querySelector<HTMLElement>(
    `[data-testid="mention-suggestion-${id}"] button`,
  )!;
  expect(option).not.toBeNull();
  await act(async () => {
    option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
}

it("reuses the Buzz picker to send all selected Agents once in canonical order across overlapping pages", async () => {
  state.pages.push({
    installations: [installation("agent-b"), installation("agent-c")],
  });
  state.next = true;
  const host = await render(<Composer workspaceId="workspace-a" />);
  await select(host, "agent-b");
  await select(host, "agent-a");
  await click(button(host, "platform.mentionAgent"));
  expect(
    host.querySelector('[data-testid="mention-suggestion-agent-b"]'),
  ).toBeNull();
  expect(host.querySelectorAll("[data-mention-suggestion-index]")).toHaveLength(
    1,
  );
  await click(button(host, "platform.moreMentionAgents"));
  expect(state.more).toHaveBeenCalledOnce();
  await type(
    host.querySelector<HTMLInputElement>('[data-testid="message-input"]')!,
    "hello",
  );
  await click(button(host, "platform.send"));
  expect(state.publish).toHaveBeenCalledExactlyOnceWith(
    "workspace-a",
    "hello",
    [],
    expect.any(String),
    ["agent-a", "agent-b"],
  );
  expect(host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
});

it("preserves an UNKNOWN intent and changes its key only when the actual selected set changes", async () => {
  state.publish.mockRejectedValue(new TransportError("lost response"));
  const host = await render(<Composer workspaceId="workspace-a" />);
  await select(host, "agent-b");
  await select(host, "agent-a");
  await type(
    host.querySelector<HTMLInputElement>('[data-testid="message-input"]')!,
    "hello",
  );
  await click(button(host, "platform.send"));
  const key = state.publish.mock.calls[0][3];
  expect(host.textContent).toContain("platform.sendUnknown");
  expect(host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(2);
  await click(button(host, "agent-a"));
  await select(host, "agent-a");
  await click(button(host, "platform.send"));
  expect(state.publish.mock.calls[1][3]).toBe(key);
  await click(button(host, "agent-b"));
  await click(button(host, "platform.send"));
  expect(state.publish.mock.calls[2][3]).not.toBe(key);
  expect(state.publish.mock.calls[2][4]).toEqual(["agent-a"]);
});

it("fails closed when any selected Agent is revoked even if an overlapping page still has ACTIVE", async () => {
  const host = await render(<Composer workspaceId="workspace-a" />);
  await select(host, "agent-a");
  await select(host, "agent-b");
  state.pages = [
    { installations: [installation("agent-a"), installation("agent-b")] },
    {
      installations: [
        { ...installation("agent-a"), state: AgentInstallationState.Disabled },
      ],
    },
  ];
  await type(
    host.querySelector<HTMLInputElement>('[data-testid="message-input"]')!,
    "hello",
  );
  expect(button(host, "platform.send").disabled).toBe(true);
  await click(button(host, "platform.send"));
  expect(state.publish).not.toHaveBeenCalled();
  await click(button(host, "agent-a"));
  await click(button(host, "platform.send"));
  await settle();
  expect(state.publish.mock.calls[0][4]).toEqual(["agent-b"]);
});

it("selects through the original highlighted picker row with the keyboard", async () => {
  const host = await render(<Composer workspaceId="workspace-a" />);
  const trigger = button(host, "platform.mentionAgent");
  await click(trigger);
  await act(async () => {
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await act(async () => {
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(button(host, "agent-a").getAttribute("aria-pressed")).toBe("true");
  expect(host.querySelector('[data-testid="mention-autocomplete"]')).toBeNull();
});

it.each([false, undefined])(
  "excludes an Agent when execution permission is %s on either overlapping page",
  async (effective) => {
    const unavailable = installation("agent-a");
    unavailable.executionPermission =
      effective === undefined
        ? undefined
        : { ...unavailable.executionPermission!, effective };
    state.pages = [
      { installations: [unavailable] },
      { installations: [installation("agent-a"), installation("agent-b")] },
    ];
    const host = await render(<Composer workspaceId="workspace-a" />);
    await click(button(host, "platform.mentionAgent"));
    expect(host.querySelector('[data-testid="mention-suggestion-agent-a"]')).toBeNull();
    expect(host.querySelector('[data-testid="mention-suggestion-agent-b"]')).not.toBeNull();
  },
);

it("blocks a selected Agent after execution permission is revoked without changing installation state", async () => {
  const host = await render(<Composer workspaceId="workspace-a" />);
  await select(host, "agent-a");
  const revoked = installation("agent-a");
  revoked.executionPermission!.effective = false;
  state.pages = [{ installations: [revoked, installation("agent-b")] }];
  await type(
    host.querySelector<HTMLInputElement>('[data-testid="message-input"]')!,
    "hello",
  );
  expect(button(host, "platform.send").disabled).toBe(true);
  await click(button(host, "platform.send"));
  expect(state.publish).not.toHaveBeenCalled();
});
