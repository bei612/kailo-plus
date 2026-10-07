// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkspaceMembershipState } from "@client-kit/contracts";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { setLocale } from "@client-kit/platform/i18n";
import { BffError, TransportError } from "@client-kit/platform/transport";
import { ErrorClass, ReasonCode } from "@client-kit/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StreamFrame } from "../bff-client";
import { InboxThreadPane } from "./InboxThreadPane";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ query: vi.fn(), publish: vi.fn(), reaction:vi.fn(), openAuthor:vi.fn(), unavailable:vi.fn(), receive: null as null | ((frame: StreamFrame) => void), outcome: "", error: null as unknown }));
vi.mock("@client-kit/platform/react/context", async (original) => ({ ...await original<typeof import("@client-kit/platform/react/context")>(), useBffClient: () => ({ workspaceMessages: state.query }), useLocale: () => "en", useT: () => (key: string) => key }));
vi.mock("@client-kit/platform/react/inbox-surface", () => ({ InboxDetailHeader: ({ title }: {title: string}) => <header>{title}</header> }));
vi.mock("@/features/chat/ui/MessageContent", () => ({ MessageContent: ({content}: {content:string}) => <p>{content}</p> }));
vi.mock("@/platform/bff-client", () => ({ bff:{profile:async()=>({pubkey:"c".repeat(64)}),customEmoji:async()=>({events:[],mediaPaths:{}})},publishMessageReaction:(...args:unknown[])=>state.reaction(...args),publishMessage: (...args: unknown[]) => state.publish(...args), openStream: (_scope: string, receive: (frame: StreamFrame) => void) => { state.receive = receive; return () => {}; } }));
vi.mock("./ChannelPane", () => ({ Composer: ({ disabled, onPublish, replyTarget, onCancelReply, draftKey }: {disabled: boolean; onPublish: (content: string, attachments: [], key: string, installations: []) => Promise<unknown>; replyTarget?: {id:string;body:string}; onCancelReply?:()=>void; draftKey?:string}) => <div data-testid="inbox-composer" data-draft-key={draftKey}>
  {replyTarget ? <div data-testid="reply-preview">{replyTarget.body}{onCancelReply ? <button data-testid="cancel-reply" onClick={onCancelReply}>cancel reply</button> : null}</div> : null}
  <button data-testid="inbox-send" disabled={disabled} onClick={async () => { try { await onPublish("actual reply", [], "same-intent", []); state.outcome = "confirmed"; } catch (error) { state.error = error; state.outcome = "unknown"; } }}>send</button>
</div> }));

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
  vi.useFakeTimers(); vi.clearAllMocks(); state.outcome = ""; state.error = null;
  localStorage.clear(); setLocale("en");
  Object.defineProperty(window, "matchMedia", {configurable:true,value:()=>({matches:false,addEventListener(){},removeEventListener(){}})});
  state.query.mockResolvedValue({ events: [rootEvent, reply] });
  state.publish.mockResolvedValue({ eventId: "d".repeat(64), operationId: "operation" });
  state.reaction.mockResolvedValue({eventId:"d".repeat(64),operationId:"operation"});
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); query.clear(); host.remove(); vi.useRealTimers(); });

it("reads the true thread and preserves the original selected-reply parent when publishing", async () => {
  await mount();
  expect(state.query).toHaveBeenCalledWith("workspace", { messageType: "STREAM", parentEventId: rootId });
  expect(host.textContent).toContain("selected reply");
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(state.publish).toHaveBeenCalledWith("workspace", "actual reply", [], "same-intent", [], { messageType: "STREAM", parentEventId: rootId });
  expect(state.outcome).toBe("confirmed");
});

it("renders the original Inbox reaction pill and removes only the own signed reaction",async()=>{
  const reactionId="e".repeat(64);
  state.query.mockResolvedValue({events:[rootEvent,reply,{...reply,id:reactionId,kind:7,content:"👍",tags:[["e",replyId]]}]});
  await mount();
  const pill=[...host.querySelectorAll<HTMLButtonElement>('button[aria-label]')].find(button=>button.getAttribute("aria-label")==="Toggle 👍 reaction");
  expect(pill).toBeDefined();
  await act(async()=>pill!.click());await settle();
  expect(state.reaction).toHaveBeenCalledWith("workspace",undefined,{operation:"UNLIKE",content:"",targetEventId:reactionId},expect.any(String));
});

it("restores an explicit nested reply draft without retargeting it to its parent", async () => {
  await mount(replyId);
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(state.query).toHaveBeenCalledWith("workspace", { messageType: "STREAM", parentEventId: rootId });
  expect(state.publish).toHaveBeenCalledWith("workspace", "actual reply", [], "same-intent", [], { messageType: "STREAM", parentEventId: replyId });
});

it("does not report an unconfirmed receipt as success and removes detail on revoked admission", async () => {
  state.publish.mockResolvedValue({ operationId: "operation" });
  await mount();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(state.outcome).toBe("unknown");
  await act(async () => state.receive!({ type: "closed", reason: "scope-revoked" }));
  await settle();
  expect(host.textContent).not.toContain("selected reply");
  expect(host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')?.disabled).toBe(true);
});

it("restores the original row reply toggle and banner while cancelling returns to the captured parent", async () => {
  await mount();
  const select = () => host.querySelector<HTMLButtonElement>(`[data-testid="reply-message-${replyId}"]`)!;
  expect(select().getAttribute("aria-label")).toBe("Reply");
  await act(async () => select().click());
  expect(host.querySelector('[data-testid="reply-preview"]')?.textContent).toContain("selected reply");
  expect(host.querySelector('[data-testid="inbox-composer"]')?.getAttribute("data-draft-key")).toBe(`thread:workspace:${rootId}:${replyId}`);
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(state.publish.mock.lastCall?.[5]).toEqual({messageType:"STREAM",parentEventId:replyId});
  await settle();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="cancel-reply"]')!.click());
  expect(host.querySelector('[data-testid="reply-preview"]')).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(state.publish.mock.lastCall?.[5]).toEqual({messageType:"STREAM",parentEventId:rootId});
  await settle();
  await act(async () => select().click());
  await act(async () => select().click());
  expect(host.querySelector('[data-testid="reply-preview"]')).toBeNull();
});

it("keeps the same target and draft after UNKNOWN and a later forbidden observation", async () => {
  state.publish.mockRejectedValueOnce(new TransportError("receipt missing"));
  await mount();
  await act(async () => host.querySelector<HTMLButtonElement>(`[data-testid="reply-message-${replyId}"]`)!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(host.querySelector(`[data-testid="reply-message-${rootId}"]`)).toBeNull();
  expect(host.querySelector('[data-testid="cancel-reply"]')).toBeNull();
  expect(host.querySelector('[data-testid="reply-preview"]')?.textContent).toContain("selected reply");
  state.publish.mockRejectedValueOnce(new BffError(403,"forbidden",{class:ErrorClass.Denied,reason:ReasonCode.PermissionDenied}));
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(host.querySelector('[data-testid="cancel-reply"]')).toBeNull();
  expect(state.error).toBeInstanceOf(TransportError);
  expect(state.publish.mock.calls.every((call) => call[3] === "same-intent" && call[5].parentEventId === replyId)).toBe(true);
  state.publish.mockResolvedValueOnce({eventId:"d".repeat(64),operationId:"operation"});
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="inbox-send"]')!.click());
  expect(host.querySelector('[data-testid="cancel-reply"]')).not.toBeNull();
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
