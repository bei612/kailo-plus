import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import type { RelayEvent } from "../src/react/forum/channelWindowResponse";
import { WorkflowTriggerConditions } from "../src/react/workflow-trigger-conditions";
import type { ParsedConditionExpression } from "../src/react/workflow-condition-expression";
import { WorkflowMessageHostProvider, type WorkflowMessageHost } from "../src/react/workflow-message-host";
import type { BffReply, BffRequest } from "../src/transport";
import type { AutomationVersionContent } from "@client-kit/contracts";
import { translate, type PlatformMessageKey } from "../src/i18n";
import { splitWorkflowAuthorDescription, workflowTriggerCardClause, workflowTriggerDescription, workflowTriggerSummary } from "../src/react/workflow-card-label";
import { click, render, settle, type } from "./render";

const channelId = "11111111-1111-4111-8111-111111111111";
const otherChannel = "22222222-2222-4222-8222-222222222222";
const author = "a".repeat(64);
const message = (id: string, content: string, channel = channelId, kind = 9): RelayEvent =>
  ({ id, pubkey: author, created_at: 1_790_000_000, kind, content, tags: [["h", channel]] });
const first = message("1".repeat(64), "Deploy finished");
const second = message("2".repeat(64), "Release notes ready");
const foreign = message("3".repeat(64), "Other channel secret", otherChannel);
const bounds: RelayEvent = { id: "b".repeat(64), pubkey: author, created_at: 1_790_000_001, kind: 39006,
  content: JSON.stringify({ has_more: false, next_cursor: null }), tags: [["d", `${channelId}:head`]] };

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

function Harness({ initial, onValue }: { initial: string; onValue: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  const [drafts, setDrafts] = useState<ParsedConditionExpression[] | null>(null);
  return <WorkflowTriggerConditions triggerType="reaction_added" value={value} conditionDrafts={drafts}
    workflowChannelId="workspace" onConditionDraftsChange={setDrafts}
    onChange={(next) => { setValue(next); onValue(next); }} />;
}

async function mount(initial: string, host: WorkflowMessageHost | undefined) {
  const values: string[] = [];
  const send = vi.fn(async (request: BffRequest): Promise<BffReply> => request.path === "/api/v1/workspaces/workspace/channel"
    ? { status: 200, body: { channelId, channelType: "stream", name: "Channel", archived: false } }
    : { status: 503, body: undefined });
  const node = await render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <PlatformProvider client={createBffClient({ send })} locale="en">
      <WorkflowMessageHostProvider value={host}><Harness initial={initial} onValue={(value) => values.push(value)} /></WorkflowMessageHostProvider>
    </PlatformProvider>
  </QueryClientProvider>);
  await settle();
  return { node, values };
}

const disclosure = (node: HTMLElement, label: string) => [...node.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")]
  .find((button) => button.textContent?.startsWith(label))!;

describe("original workflow message picker through the host channel reads", () => {
  it("lists only validated messages from the admitted channel and selects one as trigger_message_id", async () => {
    const host: WorkflowMessageHost = {
      history: vi.fn(async () => [first, foreign, second, bounds]),
      event: vi.fn(async () => null),
      search: vi.fn(async () => []),
    };
    const { node, values } = await mount("", host);
    await click(disclosure(node, "Message"));
    await settle();
    const results = node.querySelector<HTMLElement>('[data-testid="workflow-message-picker-results"]')!;
    expect(results.textContent).toContain("Deploy finished");
    expect(results.textContent).toContain("Release notes ready");
    expect(results.textContent).not.toContain("Other channel secret");
    expect(host.history).toHaveBeenCalledWith({ workspaceId: "workspace", channelId }, null, 25);
    await click([...results.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((option) => option.textContent?.includes("Release notes"))!);
    expect(values.at(-1)).toBe(`trigger_message_id == "${second.id}"`);
  });

  it("summarizes the selected message only from an exact same-channel lookup", async () => {
    const host: WorkflowMessageHost = {
      history: vi.fn(async () => [bounds]),
      event: vi.fn(async (_scope, id) => (id === first.id ? first : null)),
      search: vi.fn(async () => []),
    };
    const { node } = await mount(`trigger_message_id == "${first.id}"`, host);
    expect(disclosure(node, "Message").textContent).toContain("“Deploy finished”");

    const foreignHost: WorkflowMessageHost = { ...host, event: vi.fn(async () => ({ ...foreign, id: first.id })) };
    const other = await mount(`trigger_message_id == "${first.id}"`, foreignHost);
    expect(disclosure(other.node, "Message").textContent).not.toContain("Other channel secret");
  });

  it("rejects a pasted ID that the channel cannot provide", async () => {
    const host: WorkflowMessageHost = {
      history: vi.fn(async () => [bounds]),
      event: vi.fn(async () => foreign),
      search: vi.fn(async () => []),
    };
    const { node, values } = await mount("", host);
    await click(disclosure(node, "Message"));
    const input = node.querySelector<HTMLInputElement>("#wf-trigger-message-id-value")!;
    await type(input, foreign.id);
    await settle();
    expect(node.textContent).toContain("That message is not available in this channel.");
    await click(node.querySelector<HTMLButtonElement>('[role="option"]')!);
    expect(values).toHaveLength(0);
  });

  it("does not read messages without a host seam", async () => {
    const { node } = await mount("", undefined);
    await click(disclosure(node, "Message"));
    const input = node.querySelector<HTMLInputElement>("#wf-trigger-message-id-value")!;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe("Choose a channel first");
  });
});

// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/workflows/ui/workflowTriggerDescription.test.mjs cases on the shared canvas.
describe("original canvas trigger description", () => {
  const en = (key: PlatformMessageKey, variables?: Record<string, string | number>) => translate("en", key, variables);
  const zh = (key: PlatformMessageKey, variables?: Record<string, string | number>) => translate("zh-CN", key, variables);
  const describeTrigger = (kind: string, filter?: string, options = {}, t = en) => workflowTriggerDescription(
    { trigger: { kind, ...(filter ? { filter } : {}) }, action: { kind: "POST_MESSAGE", template: "x" }, resultTarget: "TRIGGER_THREAD" } as unknown as AutomationVersionContent,
    t, options);
  const a = "a".repeat(64);
  const b = "b".repeat(64);

  it("describes message, diff and reaction conditions like the original canvas", () => {
    expect(describeTrigger("CHANNEL_MESSAGE", `trigger_author == "${a}"`, { authorLabel: "Carl" })).toBe("Message posted by Carl");
    expect(describeTrigger("CHANNEL_MESSAGE", `trigger_author == "${a}"`, { authorLoading: true })).toBe("Message posted by loading author");
    expect(describeTrigger("CHANNEL_MESSAGE", 'str_contains(trigger_text, "deploy")')).toBe("Message contains “deploy”");
    expect(describeTrigger("CHANNEL_MESSAGE", `str_contains(trigger_text, "deploy") && trigger_author == "${a}"`, { authorLabel: "Carl" }))
      .toBe("Message by Carl contains “deploy”");
    expect(describeTrigger("CHANNEL_MESSAGE", `trigger_text == "FUCK" && trigger_author == "${a}"`, { authorLabel: "Carl" }))
      .toBe("Message “FUCK” is posted by Carl");
    expect(describeTrigger("DIFF_POSTED", `str_contains(trigger_text, "fix") && trigger_author == "${a}"`, { authorLabel: "Carl" }))
      .toBe("Diff by Carl contains “fix”");
    expect(describeTrigger("REACTION_ADDED", 'trigger_emoji == "🔥"')).toBe("🔥 reaction added");
    expect(describeTrigger("REACTION_ADDED", 'trigger_emoji == "🔥"', { iconEmoji: "🔥" })).toBe("Reaction added");
    expect(describeTrigger("REACTION_ADDED", `trigger_message_id == "${b}"`, { messageLoading: true })).toBe("Reaction added to loading message");
    expect(describeTrigger("REACTION_ADDED", `trigger_emoji == "👾" && trigger_author == "${a}" && trigger_message_id == "${b}"`,
      { authorLabel: "Carl", messageLabel: "hey yourself" })).toBe("👾 reaction added by Carl to “hey yourself”");
    expect(describeTrigger("REACTION_ADDED", `trigger_emoji != "👀"`)).toBe("Any reaction except 👀 added");
    expect(describeTrigger("CHANNEL_MESSAGE", `trigger_author == "${a}"`, { authorLabel: "Carl" }, zh)).toBe("由Carl发布消息");
  });

  it("builds the original presented card clauses and omitting detail summary for diff and reaction", () => {
    const card = (kind: string, filter?: string, options = {}, emoji?: string) => workflowTriggerCardClause(
      { trigger: { kind, ...(filter ? { filter } : {}), ...(emoji ? { emoji } : {}) }, action: { kind: "POST_MESSAGE", template: "x" },
        resultTarget: "TRIGGER_THREAD" } as unknown as AutomationVersionContent, en, options);
    expect(card("DIFF_POSTED")).toBe("When a diff is posted");
    expect(card("DIFF_POSTED", 'str_contains(trigger_text, "fix")')).toBe("When a diff contains “fix”");
    expect(card("DIFF_POSTED", `trigger_text == "fix" && trigger_author == "${a}"`, { authorLabel: "Carl" })).toBe("When a diff “fix” is posted by Carl");
    expect(card("REACTION_ADDED")).toBe("When someone adds a reaction");
    expect(card("REACTION_ADDED", undefined, {}, "🔥")).toBe("When someone reacts with 🔥");
    expect(card("REACTION_ADDED", `trigger_emoji == "🔥" && trigger_author == "${a}"`, { authorLabel: "Carl" })).toBe("When someone reacts with 🔥");
    expect(card("REACTION_ADDED", `trigger_emoji != "👀"`)).toBe("When any reaction except 👀 is added");
    expect(card("REACTION_ADDED", `trigger_author == "${a}" && trigger_message_id == "${b}"`, { authorLabel: "Carl", messageLabel: "hey yourself" }))
      .toBe("When a reaction is added by Carl to “hey yourself”");
    const summary = (filter: string) => workflowTriggerSummary({ trigger: { kind: "REACTION_ADDED", filter },
      action: { kind: "POST_MESSAGE", template: "x" }, resultTarget: "TRIGGER_THREAD" } as unknown as AutomationVersionContent, en);
    expect(summary(`trigger_emoji == "🔥" && trigger_message_id == "${b}"`)).toBe("🔥 reaction added");
  });

  it("splits the generated author attribution, not quoted user copy", () => {
    expect(splitWorkflowAuthorDescription("Reaction added by Carl to “thanks Carl”", "Carl", en))
      .toEqual({ prefix: "Reaction added by", suffix: "to “thanks Carl”" });
    expect(splitWorkflowAuthorDescription("Message by anyone except Carl contains “Carl”", "Carl", en))
      .toEqual({ prefix: "Message by anyone except", suffix: "contains “Carl”" });
    expect(splitWorkflowAuthorDescription("Message contains “Carl”", "Carl", en)).toBeNull();
    expect(splitWorkflowAuthorDescription("由Carl发布消息", "Carl", zh)).toEqual({ prefix: "由", suffix: "发布消息" });
  });
});
