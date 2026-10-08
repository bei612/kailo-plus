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
const state = vi.hoisted(() => ({query: vi.fn(), publish: vi.fn(), reaction:vi.fn(), profile: vi.fn(), openAuthor: vi.fn(), receive: null as null | ((frame: StreamFrame) => void), outcome: ""}));
vi.mock("@client-kit/platform/react/context", async (original) => ({
  ...await original<typeof import("@client-kit/platform/react/context")>(),
  useBffClient: () => ({workspaceMessages: state.query}), useLocale: () => "en", useT: () => (key: string) => key,
}));
vi.mock("@/features/chat/ui/MessageContent", () => ({MessageContent: ({content}: {content: string}) => <p>{content}</p>}));
vi.mock("@/platform/bff-client", async(original) => ({
  ...await original<typeof import("@/platform/bff-client")>(),
  bff: {profile:async()=>({pubkey:"c".repeat(64)}),customEmoji:async()=>({events:[],mediaPaths:{}}),messageAuthorProfile: (...args: unknown[]) => state.profile(...args)},
  publishMessageReaction:(...args:unknown[])=>state.reaction(...args),
  publishMessage: (...args: unknown[]) => state.publish(...args),
  openStream: (_scope: string, receive: (frame: StreamFrame) => void) => {state.receive = receive; return () => {};},
}));
vi.mock("./ChannelPane", async(original) => ({...await original<typeof import("./ChannelPane")>(),Composer: ({disabled, onPublish}: {disabled: boolean; onPublish: (content: string, attachments: [], key: string, installations: []) => Promise<unknown>}) =>
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
  vi.stubGlobal("Image",function(){
    const image=document.createElement("img");let source="";
    Object.defineProperties(image,{complete:{value:true},naturalWidth:{value:1},src:{get:()=>source,set:(value:string)=>{
      source=value;queueMicrotask(()=>image.dispatchEvent(new Event("load")));
    }}});return image;
  });
  Object.defineProperty(window, "matchMedia", {configurable: true, value: () => ({matches: false, addEventListener() {}, removeEventListener() {}})});
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {configurable: true, value: vi.fn()});
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {configurable: true, value: vi.fn()});
  state.query.mockResolvedValue({events: [rootEvent, reply]});
  state.publish.mockResolvedValue({eventId: "d".repeat(64), operationId: "operation"});
  state.reaction.mockResolvedValue({eventId:"d".repeat(64),operationId:"operation"});
  state.profile.mockResolvedValue({pubkey:author,eventId:"profile",displayName:"Verified author",about:null,avatarUrl:null,nip05Handle:null,avatarMediaPaths:{}});
  query = new QueryClient({defaultOptions: {queries: {retry: false}}});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {await act(async () => root.unmount()); query.clear(); host.remove(); vi.useRealTimers();vi.unstubAllGlobals();});
it("uses the admitted thread query, original panel and exact selected parent when publishing", async () => {
  await mount();
  expect(state.query).toHaveBeenCalledWith("workspace", {messageType: "STREAM", parentEventId: rootId});
  expect(host.querySelector('[data-testid="message-thread-panel"]')).not.toBeNull();
  expect(host.textContent).toContain("Root body"); expect(host.textContent).toContain("Nested body");
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="host-send"]')!.click());
  expect(state.publish).toHaveBeenCalledWith("workspace", "reply", [], "original-intent", [], {messageType: "STREAM", parentEventId: replyId});
  expect(state.outcome).toBe("confirmed");
});
it("retains V2 roots and replies in the same admitted original thread projection", async () => {
  state.query.mockResolvedValue({events:[{...rootEvent,kind:40002},{...reply,kind:40002}]});
  await mount();
  expect(host.querySelector('[data-testid="message-thread-panel"]')).not.toBeNull();
  expect(host.textContent).toContain("Root body");expect(host.textContent).toContain("Nested body");
  expect(host.querySelector<HTMLButtonElement>('[data-testid="host-send"]')?.disabled).toBe(false);
});
it("renders thread auxiliary reactions and removes the actual own reaction through the admitted route",async()=>{
  const reactionId="e".repeat(64);
  state.query.mockResolvedValue({events:[rootEvent,reply,{...reply,id:reactionId,kind:7,content:"👍",tags:[["e",replyId]]}]});
  await mount();
  const pill=[...host.querySelectorAll<HTMLButtonElement>('button[aria-label]')].find(button=>button.getAttribute("aria-label")==="Toggle 👍 reaction");
  expect(pill).toBeDefined();
  await act(async()=>pill!.click());await settle();
  expect(state.reaction).toHaveBeenCalledWith("workspace",undefined,{operation:"UNLIKE",content:"",targetEventId:reactionId},expect.any(String));
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
it("keeps opening the actual admitted thread author separate from its restored avatar reads", async () => {
  await mount();
  expect(state.profile).toHaveBeenCalledWith("workspace",rootId);
  expect(state.profile).not.toHaveBeenCalledWith("workspace",replyId);
  expect(host.querySelectorAll('[data-testid="message-avatar"]')).toHaveLength(1);
  expect(state.openAuthor).not.toHaveBeenCalled();
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

it("renders the original thread author avatars through admitted media and removes them on interruption",async()=>{
  const avatarUrl="https://community.example/media/thread-author.png",mediaPath="/api/v1/workspaces/workspace/media/thread-author";
  const peer="e".repeat(64);
  state.query.mockResolvedValue({events:[rootEvent,{...reply,pubkey:peer}]});
  state.profile.mockImplementation(async(_scope,eventId)=>({pubkey:eventId===replyId?peer:author,eventId:"profile",displayName:"Alice",about:null,avatarUrl,nip05Handle:null,avatarMediaPaths:{[avatarUrl]:mediaPath}}));
  await mount();
  const avatars=[...host.querySelectorAll('[data-testid="message-avatar"]')];
  expect(avatars).toHaveLength(2);
  for(const avatar of avatars){
    expect(avatar.classList.contains("h-9")).toBe(true);expect(avatar.classList.contains("w-9")).toBe(true);
    expect(avatar.getAttribute("data-avatar-shape")).toBe("circle");expect(avatar.querySelector("img")?.getAttribute("src")).toBe(mediaPath);
  }
  expect(state.openAuthor).not.toHaveBeenCalled();expect(state.publish).not.toHaveBeenCalled();
  await act(async()=>state.receive!({type:"interrupted"}));await settle();
  expect(host.querySelector("img")).toBeNull();expect(host.querySelector('[aria-label="Profile"]')).toBeNull();
});
