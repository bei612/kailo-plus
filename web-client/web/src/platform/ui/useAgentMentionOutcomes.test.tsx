// @vitest-environment jsdom
// DD-121, V-SCN-105/106: the Web channel computes the sender-only Agent @mention outcome line:
// own messages only, PENDING until Core reports a row, DENIED mapped to its action, and polling
// that stops once every mentioned Agent settled or the per-message window closed.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentMentionOutcomeState, ReasonCode, type AgentMentionOutcomeView } from "@client-kit/contracts";
import { setLocale } from "@client-kit/platform/i18n";
import { AgentMentionStatus, type TimelineMessage } from "@client-kit/platform/react/messages";
import { AGENT_MENTION_POLL_MS, AGENT_MENTION_POLL_WINDOW_MS, agentMentionEntries, trackedAgentMentions, useAgentMentionOutcomes,
  type MentionableAgent } from "./useAgentMentionOutcomes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({
  responses: [] as AgentMentionOutcomeView[][],
  query: vi.fn(),
}));
vi.mock("@/platform/bff-client", () => ({
  AGENT_MENTION_OUTCOME_QUERY_LIMIT: 50,
  queryAgentMentionOutcomes: async (workspaceId: string, eventIds: string[]) => {
    state.query(workspaceId, eventIds);
    return { outcomes: state.responses.length > 1 ? state.responses.shift()! : state.responses[0] ?? [] };
  },
}));

const ME = "a".repeat(64);
const OTHER = "d".repeat(64);
const RESEARCH = "b".repeat(64);
const WRITER = "c".repeat(64);
const MINE = "1".repeat(64);
const THEIRS = "2".repeat(64);
const agents: MentionableAgent[] = [
  { pubkey: RESEARCH, displayName: "研究助理", installationId: "installation-research" },
  { pubkey: WRITER, displayName: "Writer", installationId: "installation-writer" },
];
const message = (id: string, signer: string, tags: string[][], createdAt: number): TimelineMessage =>
  ({ id, signerPubkey: signer, pubkey: signer, createdAt, kind: 9, tags, author: "", body: "", time: "", depth: 0 });

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); setLocale("en");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-10-16T08:00:00Z"));
  state.responses = [];
  state.query.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function Harness({ messages, onRenew }: { messages: TimelineMessage[]; onRenew?: (key: string) => void }) {
  const { entriesFor } = useAgentMentionOutcomes({ workspaceId: "workspace", principalId: "principal", ownPubkey: ME, agents, messages,
    enabled: true, fallbackName: "Agent" });
  const mine = entriesFor(MINE);
  return <>
    <div data-testid="mine">{mine ? <AgentMentionStatus entries={mine} onRenewDelegation={onRenew} /> : "none"}</div>
    <div data-testid="theirs">{entriesFor(THEIRS) ? "tracked" : "untracked"}</div>
  </>;
}
async function mount(messages: TimelineMessage[], onRenew?: (key: string) => void) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => root.render(<QueryClientProvider client={cache}><Harness messages={messages} onRenew={onRenew} /></QueryClientProvider>));
}
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const mine = () => host.querySelector('[data-testid="mine"]')!;
const now = () => Math.floor(Date.now() / 1_000);

it("tracks only own messages that p-tag a channel Agent, newest first and bounded", () => {
  const sent = now();
  const tracked = trackedAgentMentions([
    message(MINE, ME, [["p", RESEARCH], ["p", RESEARCH.toUpperCase()], ["p", OTHER]], sent),
    message(THEIRS, OTHER, [["p", RESEARCH]], sent),
    message("3".repeat(64), ME, [["p", OTHER]], sent),
    { ...message("4".repeat(64), ME, [["p", WRITER]], sent), pending: true },
  ], ME, agents);
  expect(tracked).toEqual([{ eventId: MINE, sentAtMs: sent * 1_000, agents: [agents[0]] }]);
  const many = Array.from({ length: 60 }, (_, index) => message(index.toString(16).padStart(64, "0"), ME, [["p", WRITER]], sent - index));
  const bounded = trackedAgentMentions(many, ME, agents);
  expect(bounded).toHaveLength(50);
  expect(bounded[0]?.eventId).toBe(many[0]?.id);
  expect(trackedAgentMentions(many, undefined, agents)).toEqual([]);
});

it("presents a missing row as PENDING inside the window only, and an unknown Installation's refusal by fallback name", () => {
  const sentAtMs = Date.now();
  const tracked = [{ eventId: MINE, sentAtMs, agents }];
  const rows: AgentMentionOutcomeView[] = [
    { eventId: MINE, installationId: "installation-writer", state: AgentMentionOutcomeState.Replied, replyEventId: "e".repeat(64) },
    { eventId: MINE, installationId: "installation-gone", state: AgentMentionOutcomeState.Denied, reasonCode: ReasonCode.PermissionDenied },
  ];
  expect(agentMentionEntries(tracked, rows, agents, sentAtMs + 1_000, "Agent").get(MINE)).toEqual([
    { key: "installation-research", name: "研究助理", state: "PENDING", reasonCode: undefined, delegable: true },
    { key: "installation-writer", name: "Writer", state: AgentMentionOutcomeState.Replied, reasonCode: undefined, delegable: true },
    { key: "installation-gone", name: "Agent", state: AgentMentionOutcomeState.Denied, reasonCode: ReasonCode.PermissionDenied, delegable: false },
  ]);
  // Past the window an unscanned mention is no longer claimed as processing.
  expect(agentMentionEntries(tracked, rows, agents, sentAtMs + AGENT_MENTION_POLL_WINDOW_MS, "Agent").get(MINE)?.map((entry) => entry.key))
    .toEqual(["installation-writer", "installation-gone"]);
});

it("polls own mentions until every Agent settled and maps PERMISSION_DENIED to delegation renewal", async () => {
  const onRenew = vi.fn();
  state.responses = [
    [],
    [{ eventId: MINE, installationId: "installation-research", state: AgentMentionOutcomeState.Denied, reasonCode: ReasonCode.PermissionDenied },
      { eventId: MINE, installationId: "installation-writer", state: AgentMentionOutcomeState.Running }],
    [{ eventId: MINE, installationId: "installation-research", state: AgentMentionOutcomeState.Denied, reasonCode: ReasonCode.PermissionDenied },
      { eventId: MINE, installationId: "installation-writer", state: AgentMentionOutcomeState.Replied, replyEventId: "e".repeat(64) }],
  ];
  await mount([message(MINE, ME, [["p", RESEARCH], ["p", WRITER]], now()), message(THEIRS, OTHER, [["p", RESEARCH]], now())], onRenew);
  await vi.waitFor(() => expect(mine().textContent).toContain("研究助理 is working on it…"));
  expect(mine().textContent).toContain("Writer is working on it…");
  // Only the sender's own event is ever asked about; other members' messages stay untouched.
  expect(state.query).toHaveBeenCalledExactlyOnceWith("workspace", [MINE]);
  expect(host.querySelector('[data-testid="theirs"]')?.textContent).toBe("untracked");

  await advance(AGENT_MENTION_POLL_MS);
  await vi.waitFor(() => expect(mine().textContent).toContain("研究助理 did not respond: your delegation to it has expired or was never granted."));
  expect(mine().textContent).toContain("Writer is working on it…");
  await act(async () => [...mine().querySelectorAll("button")].find((node) => node.textContent === "Renew delegation")!.click());
  expect(onRenew).toHaveBeenCalledExactlyOnceWith("installation-research");

  await advance(AGENT_MENTION_POLL_MS);
  await vi.waitFor(() => expect(mine().textContent).not.toContain("Writer"));
  expect(state.query).toHaveBeenCalledTimes(3);
  // Every mentioned Agent settled: no further reads.
  await advance(AGENT_MENTION_POLL_MS * 6);
  expect(state.query).toHaveBeenCalledTimes(3);
});

it("stops polling and stops claiming processing once the per-message window closes", async () => {
  state.responses = [[]];
  await mount([message(MINE, ME, [["p", RESEARCH]], now())]);
  await vi.waitFor(() => expect(mine().textContent).toBe("研究助理 is working on it…"));
  await advance(AGENT_MENTION_POLL_WINDOW_MS + AGENT_MENTION_POLL_MS);
  await vi.waitFor(() => expect(mine().textContent).toBe("none"));
  const calls = state.query.mock.calls.length;
  expect(calls).toBeGreaterThan(30);
  expect(calls).toBeLessThanOrEqual(AGENT_MENTION_POLL_WINDOW_MS / AGENT_MENTION_POLL_MS + 2);
  await advance(AGENT_MENTION_POLL_MS * 6);
  expect(state.query).toHaveBeenCalledTimes(calls);
});
