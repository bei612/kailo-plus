// @vitest-environment jsdom
// DD-125(6), V-SCN-143/144: the Codex item adapter over the original transcript
// renderers, the audit-only page reader, live merge and the governed interrupt.
import { act, useState } from "react";
import type { AgentInstallationView, AgentTranscriptEvent, AgentTranscriptItem } from "@client-kit/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { setLocale } from "../src/i18n";
import { PlatformProvider } from "../src/react/context";
import {
  adaptTranscriptItems,
  AgentSessionTranscriptView,
  AgentTranscriptHostProvider,
  buildTranscriptDisplayBlocks,
  fileChangeDiff,
  getActivityHeadline,
  useInterruptTurn,
  type AgentTranscriptHost,
} from "../src/react/agent-transcript";
import { applyTranscriptEvent, type LiveTranscriptEntry, type LiveTurn } from "../src/react/agent-transcript/liveTranscriptStore";
import type { BffReply, BffRequest } from "../src/transport";
import { button, click, render, settle } from "./render";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setLocale("en");
});

const item = (value: Partial<AgentTranscriptItem> & Pick<AgentTranscriptItem, "itemId" | "kind" | "nativeType">) =>
  ({ turnId: "turn-1", ...value }) as AgentTranscriptItem;
const entry = (value: AgentTranscriptItem) => ({ item: value, rootEventId: "root", projectionGeneration: 2 });

describe("Codex item adapter", () => {
  it("maps every forwarded kind onto the original transcript items without inventing times", () => {
    const items = adaptTranscriptItems([
      entry(item({ itemId: "u", kind: "USER_MESSAGE" as AgentTranscriptItem["kind"], nativeType: "userMessage", text: "@Scout hi" })),
      entry(item({ itemId: "r", kind: "REASONING" as AgentTranscriptItem["kind"], nativeType: "reasoning", reasoningSummary: ["Reading"] })),
      entry(item({ itemId: "c", kind: "COMMAND_EXECUTION" as AgentTranscriptItem["kind"], nativeType: "commandExecution",
        status: "FAILED" as AgentTranscriptItem["status"], command: "git log", aggregatedOutput: "fatal", exitCode: 128,
        startedAtMs: 1_760_860_800_000, completedAtMs: 1_760_860_801_500 })),
      entry(item({ itemId: "f", kind: "FILE_CHANGE" as AgentTranscriptItem["kind"], nativeType: "fileChange",
        status: "COMPLETED" as AgentTranscriptItem["status"],
        fileChanges: [{ path: "a.md", changeKind: "ADD", diff: "one\ntwo\n" }, { path: "b.md", changeKind: "UPDATE", movePath: "c.md",
          diff: "@@ -1 +1 @@\n-draft\n+final\n" }] as AgentTranscriptItem["fileChanges"] })),
      entry(item({ itemId: "m", kind: "MCP_TOOL_CALL" as AgentTranscriptItem["kind"], nativeType: "mcpToolCall", server: "platform",
        tool: "memory_entry_read", argumentsJson: "{\"slug\":\"release\"}", resultText: "Friday",
        status: "IN_PROGRESS" as AgentTranscriptItem["status"] })),
      entry(item({ itemId: "p", kind: "PLAN" as AgentTranscriptItem["kind"], nativeType: "plan", text: "1. Read" })),
      entry(item({ itemId: "a", kind: "AGENT_MESSAGE" as AgentTranscriptItem["kind"], nativeType: "agentMessage", text: "Ships Friday." })),
      entry(item({ itemId: "x", kind: "CONTEXT_COMPACTION" as AgentTranscriptItem["kind"], nativeType: "contextCompaction" })),
      entry(item({ itemId: "o", kind: "OTHER" as AgentTranscriptItem["kind"], nativeType: "hookPrompt" })),
    ], { agentName: "Scout", channelId: "channel" });
    expect(items.map((value) => [value.type, value.renderClass])).toEqual([
      ["message", "message"], ["thought", "thought"], ["tool", "error"], ["tool", "file-edit"], ["tool", "file-edit"],
      ["tool", "generic"], ["plan", "plan"], ["message", "message"], ["lifecycle", "status"], ["metadata", "raw-rail"],
    ]);
    const [user, , shell, added, moved, mcp, , assistant] = items;
    expect(user).toMatchObject({ role: "user", acpSource: "session/prompt:user", timestamp: "", sessionId: "root:2", channelId: "channel" });
    expect(assistant).toMatchObject({ role: "assistant", title: "Scout", text: "Ships Friday.", timestamp: "" });
    expect(shell).toMatchObject({ toolName: "shell", status: "failed", isError: true, args: { command: "git log" },
      startedAt: "2025-10-19T08:00:00.000Z", completedAt: "2025-10-19T08:00:01.500Z" });
    expect(JSON.parse(shell?.type === "tool" ? shell.result : "{}")).toEqual({ stdout: "fatal", exit_code: 128 });
    expect(added).toMatchObject({ args: { path: "a.md" }, result: "@@ -0,0 +1,2 @@\n+one\n+two" });
    expect(moved).toMatchObject({ args: { path: "c.md" } });
    expect(mcp).toMatchObject({ status: "executing", args: { slug: "release" }, result: "Friday", timestamp: "", completedAt: null });
    expect(getActivityHeadline(assistant!)).toBe("Ships Friday.");
  });

  it("marks only the first user message of a turn as the prompt and later ones as steers", () => {
    const items = adaptTranscriptItems([
      entry(item({ itemId: "u1", kind: "USER_MESSAGE" as AgentTranscriptItem["kind"], nativeType: "userMessage", text: "first" })),
      entry(item({ itemId: "u2", kind: "USER_MESSAGE" as AgentTranscriptItem["kind"], nativeType: "userMessage", text: "again" })),
    ], { agentName: "Scout" });
    expect(items.map((value) => value.type === "message" ? value.acpSource : null)).toEqual(["session/prompt:user", "session/steer:user"]);
  });

  it("projects native add/delete bodies as the unified diff the original renderer counts", () => {
    expect(fileChangeDiff("DELETE", "gone\n")).toBe("@@ -1,1 +0,0 @@\n-gone");
    expect(fileChangeDiff("UPDATE", "@@ -1 +1 @@\n-a\n+b")).toBe("@@ -1 +1 @@\n-a\n+b");
  });

  it("keeps the original two-pass grouping for a burst of commands", () => {
    const commands = [1, 2, 3].map((index) => entry(item({ itemId: `c${index}`, kind: "COMMAND_EXECUTION" as AgentTranscriptItem["kind"],
      nativeType: "commandExecution", status: "COMPLETED" as AgentTranscriptItem["status"], command: `echo ${index}`, exitCode: 0 })));
    const blocks = buildTranscriptDisplayBlocks(adaptTranscriptItems(commands, { agentName: "Scout" }));
    expect(blocks).toHaveLength(1);
    const turn = blocks[0];
    expect(turn?.kind === "turn" ? turn.segments.map((segment) => segment.kind === "summary" ? segment.summary.label : segment.kind) : [])
      .toEqual(["Ran 3 commands"]);
  });
});

describe("live transcript merge", () => {
  it("never replaces a completed item with a late start and tracks turn boundaries", () => {
    const entries = new Map<string, LiveTranscriptEntry>();
    const turns = new Map<string, LiveTurn>();
    const frame = (phase: string, extra: Partial<AgentTranscriptEvent> = {}) => ({ installationId: "installation", rootEventId: "root",
      projectionGeneration: 2, threadId: "thread", turnId: "turn-1", phase, ...extra }) as AgentTranscriptEvent;
    const done = item({ itemId: "a", kind: "AGENT_MESSAGE" as AgentTranscriptItem["kind"], nativeType: "agentMessage", text: "done" });
    expect(applyTranscriptEvent(entries, turns, frame("TURN_STARTED", { atMs: 1000 }))).toBe(true);
    expect(applyTranscriptEvent(entries, turns, frame("ITEM_COMPLETED", { item: done }))).toBe(true);
    expect(applyTranscriptEvent(entries, turns, frame("ITEM_STARTED", { item: { ...done, text: "partial" } }))).toBe(false);
    expect([...entries.values()].map((value) => value.item.text)).toEqual(["done"]);
    applyTranscriptEvent(entries, turns, frame("TURN_COMPLETED", { atMs: 2000 }));
    expect(turns.get("root:2")).toEqual({ rootEventId: "root", projectionGeneration: 2, turnId: "turn-1", startedAtMs: 1000, completed: true });
  });
});

const installation = { resourceId: "installation", workspaceId: "workspace", agentPrincipalId: "agent", canAudit: true } as AgentInstallationView;
const pagePath = "/api/v1/agent-installations/installation/transcript?rootEventId=root&projectionGeneration=2";
const page = { installationId: "installation", rootEventId: "root", projectionGeneration: 2, threadId: "thread",
  items: [
    item({ itemId: "u", kind: "USER_MESSAGE" as AgentTranscriptItem["kind"], nativeType: "userMessage", text: "Summarize" }),
    item({ itemId: "a", kind: "AGENT_MESSAGE" as AgentTranscriptItem["kind"], nativeType: "agentMessage", text: "The release ships Friday." }),
  ] };

async function mountView(options: { view?: AgentInstallationView; reply?: (request: BffRequest) => BffReply | undefined;
  host?: AgentTranscriptHost } = {}) {
  const send = vi.fn(async (request: BffRequest): Promise<BffReply> => options.reply?.(request)
    ?? (request.path === pagePath ? { status: 200, body: page } : { status: 503, body: undefined }));
  const host = await render(<PlatformProvider client={createBffClient({ send })} locale="en">
    <AgentTranscriptHostProvider value={options.host ?? {}}>
      <AgentSessionTranscriptView agentAvatarUrl={null} agentName="Scout" agentPubkey={"a".repeat(64)} emptyDescription="Mention Scout"
        installation={options.view ?? installation} projectionGeneration={2} rootEventId="root" />
    </AgentTranscriptHostProvider>
  </PlatformProvider>);
  await settle();
  return { host, send };
}

describe("audit-only transcript view", () => {
  it("reads the Session's Codex items fresh and renders them with the original renderers", async () => {
    const { host, send } = await mountView();
    expect(send).toHaveBeenCalledWith({ method: "GET", path: pagePath, fresh: true });
    expect(host.querySelector('[data-testid="transcript-user-message"]')?.textContent).toContain("Summarize");
    expect(host.querySelector('[data-testid="transcript-assistant-message"]')?.textContent).toContain("The release ships Friday.");
  });

  it("does not read or render anything without Installation audit", async () => {
    const { host, send } = await mountView({ view: { ...installation, canAudit: false } });
    expect(send).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="agent-session-transcript"]')).toBeNull();
  });

  it("refuses a page of another Session instead of showing it", async () => {
    const { host } = await mountView({ reply: (request) => request.path === pagePath
      ? { status: 200, body: { ...page, rootEventId: "other" } } : undefined });
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).not.toContain("The release ships Friday.");
  });

  it("merges live frames and re-reads the last page at a turn boundary", async () => {
    let emit: ((event: AgentTranscriptEvent) => void) | undefined;
    const close = vi.fn();
    const openStream = vi.fn((_id: string, onEvent: (event: AgentTranscriptEvent) => void) => { emit = onEvent; return close; });
    const { host, send } = await mountView({ host: { scopeKey: "viewer", openStream } });
    expect(openStream).toHaveBeenCalledTimes(1);
    const live = item({ itemId: "c", kind: "COMMAND_EXECUTION" as AgentTranscriptItem["kind"], nativeType: "commandExecution",
      status: "IN_PROGRESS" as AgentTranscriptItem["status"], command: "ls" });
    await act(async () => emit?.({ installationId: "installation", rootEventId: "root", projectionGeneration: 2, threadId: "thread",
      turnId: "turn-1", phase: "ITEM_STARTED", item: live } as AgentTranscriptEvent));
    expect(host.querySelector('[data-testid="transcript-tool-item"]')?.textContent).toContain("ls");
    const reads = send.mock.calls.length;
    await act(async () => emit?.({ installationId: "installation", rootEventId: "root", projectionGeneration: 2, threadId: "thread",
      turnId: "turn-1", phase: "TURN_COMPLETED", atMs: 2000 } as AgentTranscriptEvent));
    await settle();
    expect(send.mock.calls.length).toBeGreaterThan(reads);
  });
});

function InterruptHarness({ cancelActionKey }: { cancelActionKey?: string }) {
  const stop = useInterruptTurn({ installationId: "installation", invocationId: "invocation", originalActionExecutionId: "original",
    rootEventId: "root", projectionGeneration: 2, cancelActionKey } as never);
  const [outcome, setOutcome] = useState("none");
  return <div>
    <span data-testid="outcome">{outcome}</span>
    <span data-testid="available">{String(stop.available)}</span>
    <button onClick={() => { void stop.interrupt().then((value) => setOutcome(value?.kind ?? "none")); }} type="button">stop</button>
  </div>;
}

describe("governed interrupt (DD-84 widened)", () => {
  it("is offered only with the cancel key Core gives and keeps one key while the outcome is unknown", async () => {
    const commands: Record<string, unknown>[] = [];
    let dispatch = "UNKNOWN";
    const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
      commands.push(request.body as Record<string, unknown>);
      return { status: 200, body: { actionExecutionId: "control", operationId: "operation", actionKey: "task.cancel.agent.invoke.v1",
        gateState: "ALLOWED", dispatchState: dispatch } };
    });
    const without = await render(<PlatformProvider client={createBffClient({ send })} locale="en"><InterruptHarness /></PlatformProvider>);
    expect(without.querySelector('[data-testid="available"]')?.textContent).toBe("false");
    const host = await render(<PlatformProvider client={createBffClient({ send })} locale="en">
      <InterruptHarness cancelActionKey="task.cancel.agent.invoke.v1" />
    </PlatformProvider>);
    await click(button(host, "stop"));
    expect(host.querySelector('[data-testid="outcome"]')?.textContent).toBe("unknown");
    dispatch = "DISPATCHED";
    await click(button(host, "stop"));
    expect(host.querySelector('[data-testid="outcome"]')?.textContent).toBe("requested");
    expect(commands).toHaveLength(2);
    expect(commands[0]).toMatchObject({ actionKey: "task.cancel.agent.invoke.v1", originalActionExecutionId: "original" });
    expect(commands[1]?.idempotencyKey).toBe(commands[0]?.idempotencyKey);
    expect(send.mock.calls.every(([request]) => request.method === "POST" && request.path === "/api/v1/actions")).toBe(true);
  });
});
