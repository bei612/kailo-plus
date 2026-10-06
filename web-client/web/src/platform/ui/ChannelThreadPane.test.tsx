// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkspaceMembershipState } from "@client-kit/contracts";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { setLocale } from "@client-kit/platform/i18n";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StreamFrame } from "../bff-client";
import { ChannelThreadPane } from "./ChannelThreadPane";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({query: vi.fn(), publish: vi.fn(), profile: vi.fn(), openAuthor: vi.fn(), receive: null as null | ((frame: StreamFrame) => void), outcome: ""}));
vi.mock("@client-kit/platform/react/context", async (original) => ({
  ...await original<typeof import("@client-kit/platform/react/context")>(),
  useBffClient: () => ({workspaceMessages: state.query}), useLocale: () => "en", useT: () => (key: string) => key,
}));
vi.mock("@/features/chat/ui/MessageContent", () => ({MessageContent: ({content}: {content: string}) => <p>{content}</p>}));
vi.mock("@/platform/bff-client", () => ({
  bff: {messageAuthorProfile: (...args: unknown[]) => state.profile(...args)},
  publishMessage: (...args: unknown[]) => state.publish(...args),
  openStream: (_scope: string, receive: (frame: StreamFrame) => void) => {state.receive = receive; return () => {};},
}));
vi.mock("./ChannelPane", () => ({Composer: ({disabled, onPublish}: {disabled: boolean; onPublish: (content: string, attachments: [], key: string, installations: []) => Promise<unknown>}) =>
  <button data-testid="host-send" disabled={disabled} onClick={async () => {try {await onPublish("reply", [], "original-intent", []); state.outcome = "confirmed";} catch {state.outcome = "unknown";}}}>send</button>}));
const rootId = "a".repeat(64); const replyId = "b".repeat(64); const author = "c".repeat(64);
const event = (id: string, content: string, tags: string[][], created_at: number) => ({id, pubkey: author, content, tags: [["h", "workspace"], ...tags], created_at, kind: 9});
const rootEvent = event(rootId, "Root body", [], 1);
const reply = event(replyId, "Nested body", [["e", rootId, "", "root"], ["e", rootId, "", "reply"]], 2);
const selected = {id: replyId, createdAt: 2, pubkey: author, author: "Alice", body: "Nested body", tags: reply.tags, depth: 0, time: ""};
let host: HTMLDivElement; let root: Root; let query: QueryClient;
async function settle() {for (let i = 0; i < 12; i++) await act(async () => {await vi.advanceTimersByTimeAsync(10);});}
async function mount() {
  await act(async () => root.render(<QueryClientProvider client={query}><TooltipProvider>
    <ChannelThreadPane workspaceId="workspace" principalId="human" selected={selected}
      members={[{principalId: "human", displayName: "Alice", pubkeys: [author], state: WorkspaceMembershipState.Active}]}
      disabled={false} onClose={vi.fn()} onCopyMessage={vi.fn()} onOpenAuthor={state.openAuthor} />
  </TooltipProvider></QueryClientProvider>));
  await settle();
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); localStorage.clear(); setLocale("en"); state.outcome = "";
  Object.defineProperty(window, "matchMedia", {configurable: true, value: () => ({matches: false, addEventListener() {}, removeEventListener() {}})});
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {configurable: true, value: vi.fn()});
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {configurable: true, value: vi.fn()});
  state.query.mockResolvedValue({events: [rootEvent, reply]});
  state.publish.mockResolvedValue({eventId: "d".repeat(64), operationId: "operation"});
  state.profile.mockResolvedValue({pubkey:author,eventId:"profile",displayName:"Verified author",about:null,avatarUrl:null,nip05Handle:null,avatarMediaPaths:{}});
  query = new QueryClient({defaultOptions: {queries: {retry: false}}});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {await act(async () => root.unmount()); query.clear(); host.remove(); vi.useRealTimers();});
it("uses the admitted thread query, original panel and exact selected parent when publishing", async () => {
  await mount();
  expect(state.query).toHaveBeenCalledWith("workspace", {messageType: "STREAM", parentEventId: rootId});
  expect(host.querySelector('[data-testid="message-thread-panel"]')).not.toBeNull();
  expect(host.textContent).toContain("Root body"); expect(host.textContent).toContain("Nested body");
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="host-send"]')!.click());
  expect(state.publish).toHaveBeenCalledWith("workspace", "reply", [], "original-intent", [], {messageType: "STREAM", parentEventId: replyId});
  expect(state.outcome).toBe("confirmed");
});
it("requires confirmed receipt and removes thread content on revoked admission", async () => {
  state.publish.mockResolvedValue({operationId: "operation"});
  await mount();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="host-send"]')!.click());
  expect(state.outcome).toBe("unknown");
  await act(async () => state.receive!({type: "closed", reason: "scope-revoked"}));
  await settle();
  expect(host.textContent).not.toContain("Root body");
  expect(host.querySelector('[data-testid="host-send"]')).toBeNull();
});
it("traverses forward cursors and refuses a repeated cursor without offering an empty-success or enabled send", async () => {
  const cursor = {createdAt: 2, eventId: replyId};
  state.query.mockResolvedValue({events: [rootEvent, reply], nextCursor: cursor});
  await mount(); await settle();
  expect(state.query).toHaveBeenCalledTimes(2);
  expect(state.query.mock.calls[1]?.[1]).toMatchObject({before: 2, beforeId: replyId});
  expect(host.querySelector<HTMLButtonElement>('[data-testid="host-send"]')?.disabled).toBe(true);
});
it("keeps thread author lookup lazy and opens only the actual admitted message author", async () => {
  await mount();
  expect(state.profile).not.toHaveBeenCalled();
  const trigger = [...host.querySelectorAll<HTMLElement>('[role="button"][aria-label="Profile"]')].find((node) => node.textContent === "Alice")!;
  expect(trigger).toBeDefined();
  await act(async () => {trigger.dispatchEvent(new MouseEvent("mouseover", {bubbles:true})); await vi.advanceTimersByTimeAsync(600);});
  await settle();
  expect(state.profile).toHaveBeenCalledWith("workspace", rootId);
  await act(async () => trigger.click());
  expect(state.openAuthor).toHaveBeenCalledWith(expect.objectContaining({id:rootId,pubkey:author}));
  await act(async () => state.receive!({type:"closed",reason:"scope-revoked"}));
  await settle();
  expect(host.querySelector('[aria-label="Profile"]')).toBeNull();
});
