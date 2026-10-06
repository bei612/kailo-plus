// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkspaceMembershipState } from "@client-kit/contracts";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { setLocale } from "@client-kit/platform/i18n";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StreamFrame } from "../bff-client";
import { InboxThreadPane } from "./InboxThreadPane";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ query: vi.fn(), publish: vi.fn(), openAuthor:vi.fn(), unavailable:vi.fn(), receive: null as null | ((frame: StreamFrame) => void), outcome: "" }));
vi.mock("@client-kit/platform/react/context", async (original) => ({ ...await original<typeof import("@client-kit/platform/react/context")>(), useBffClient: () => ({ workspaceMessages: state.query }), useLocale: () => "en", useT: () => (key: string) => key }));
vi.mock("@client-kit/platform/react/inbox-surface", () => ({ InboxDetailHeader: ({ title }: {title: string}) => <header>{title}</header> }));
vi.mock("@/features/chat/ui/MessageContent", () => ({ MessageContent: ({content}: {content:string}) => <p>{content}</p> }));
vi.mock("@/platform/bff-client", () => ({ publishMessage: (...args: unknown[]) => state.publish(...args), openStream: (_scope: string, receive: (frame: StreamFrame) => void) => { state.receive = receive; return () => {}; } }));
vi.mock("./ChannelPane", () => ({ Composer: ({ disabled, onPublish }: {disabled: boolean; onPublish: (content: string, attachments: [], key: string, installations: []) => Promise<unknown>}) => <button disabled={disabled} onClick={async () => { try { await onPublish("actual reply", [], "same-intent", []); state.outcome = "confirmed"; } catch { state.outcome = "unknown"; } }}>send</button> }));

const rootId = "a".repeat(64); const replyId = "b".repeat(64); const pubkey = "c".repeat(64);
const event = (id: string, content: string, tags: string[][]) => ({ id, content, tags, pubkey, kind: 9, created_at: id === rootId ? 1 : 2 });
const rootEvent = event(rootId, "thread root", [["h", "workspace"]]);
const reply = event(replyId, "selected reply", [["h", "workspace"], ["e", rootId, "", "root"], ["e", rootId, "", "reply"]]);
let host: HTMLDivElement; let root: Root; let query: QueryClient;
async function settle() { for (let index = 0; index < 8; index++) await act(async () => { await vi.advanceTimersByTimeAsync(10); }); }
async function mount(replyTargetEventId?: string) {
  await act(async () => root.render(<QueryClientProvider client={query}><TooltipProvider><InboxThreadPane principalId="human" workspaceId="workspace" rootId={rootId} selectedEventId={replyId}
    replyTargetEventId={replyTargetEventId} channelName="Admitted channel" members={[{ principalId: "human", displayName: "Member", pubkeys: [pubkey], state: WorkspaceMembershipState.Active }]} onOpen={vi.fn()} onOpenAuthor={state.openAuthor} onAuthorScopeUnavailable={state.unavailable} /></TooltipProvider></QueryClientProvider>));
  await settle();
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); state.outcome = "";
  setLocale("en");
  Object.defineProperty(window, "matchMedia", {configurable:true,value:()=>({matches:false,addEventListener(){},removeEventListener(){}})});
  state.query.mockResolvedValue({ events: [rootEvent, reply] });
  state.publish.mockResolvedValue({ eventId: "d".repeat(64), operationId: "operation" });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); query.clear(); host.remove(); vi.useRealTimers(); });

it("reads the true thread and preserves the original selected-reply parent when publishing", async () => {
  await mount();
  expect(state.query).toHaveBeenCalledWith("workspace", { messageType: "STREAM", parentEventId: rootId });
  expect(host.textContent).toContain("selected reply");
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(state.publish).toHaveBeenCalledWith("workspace", "actual reply", [], "same-intent", [], { messageType: "STREAM", parentEventId: rootId });
  expect(state.outcome).toBe("confirmed");
});

it("restores an explicit nested reply draft without retargeting it to its parent", async () => {
  await mount(replyId);
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(state.query).toHaveBeenCalledWith("workspace", { messageType: "STREAM", parentEventId: rootId });
  expect(state.publish).toHaveBeenCalledWith("workspace", "actual reply", [], "same-intent", [], { messageType: "STREAM", parentEventId: replyId });
});

it("does not report an unconfirmed receipt as success and removes detail on revoked admission", async () => {
  state.publish.mockResolvedValue({ operationId: "operation" });
  await mount();
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(state.outcome).toBe("unknown");
  await act(async () => state.receive!({ type: "closed", reason: "scope-revoked" }));
  await settle();
  expect(host.textContent).not.toContain("selected reply");
  expect(host.querySelector<HTMLButtonElement>("button")?.disabled).toBe(true);
});
it("opens the selected Inbox message author and withdraws that scope on revoked admission", async () => {
  await mount();
  const row=host.querySelector(`[data-message-id="${replyId}"]`)!;
  const trigger=row.querySelector<HTMLElement>('[role="button"][aria-label="Profile"]')!;
  await act(async () => trigger.click());
  expect(state.openAuthor).toHaveBeenCalledWith({principalId:"human",workspaceId:"workspace",eventId:replyId,pubkey});
  await act(async () => state.receive!({type:"closed",reason:"scope-revoked"}));
  await settle();
  expect(state.unavailable).toHaveBeenCalledWith("workspace");
  expect(host.querySelector('[aria-label="Profile"]')).toBeNull();
});
