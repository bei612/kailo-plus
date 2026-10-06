// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PlatformProvider } from "@client-kit/platform/react/context";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { setLocale } from "@client-kit/platform/i18n";
import type { BffClient } from "@client-kit/platform/client";
import { WebMessageType } from "@client-kit/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StreamFrame } from "../bff-client";
import { ForumPane } from "./ForumPane";

const api = vi.hoisted(() => ({members:vi.fn(), workspaceMessages:vi.fn(), messageAuthorProfile:vi.fn(),
  publish:vi.fn(), receive:null as null | ((frame: StreamFrame) => void)}));
vi.mock("@/platform/bff-client", () => ({bff:api, publishMessage:api.publish,
  openStream: (_scope: string, receive: (frame: StreamFrame) => void) => {api.receive=receive;return () => {};}}));
vi.mock("./ChannelPane", () => ({Composer: () => <textarea aria-label="Reply draft" />}));
vi.mock("@/features/chat/ui/MessageContent", () => ({MessageContent: ({content}: {content:string}) => <p>{content}</p>}));
// jsdom has no layout/virtual scroll; keep the original ForumView and its card,
// keyboard, profile and panel behavior, rendering the supplied list items.
vi.mock("@tanstack/react-virtual", () => ({useVirtualizer: ({count, getItemKey}: {count:number; getItemKey:(index:number)=>string}) => ({
  getVirtualItems: () => Array.from({length:count}, (_,index)=>({index,key:getItemKey(index),start:index*120})),
  getTotalSize: () => count*120, measureElement: () => {},
})}));

const postId="a".repeat(64), author="b".repeat(64), replyId="c".repeat(64), self="d".repeat(64);
const post={id:postId,pubkey:author,kind:45001,created_at:1,tags:[["h","channel"]],content:"Forum post"};
const reply={...post,id:replyId,kind:45003,created_at:2,tags:[...post.tags,["e",postId,"","root"]],content:"Forum reply"};
const bounds={...post,id:"e".repeat(64),kind:39006,tags:[["d","channel:head"]],content:JSON.stringify({has_more:false,next_cursor:null})};
let host:HTMLDivElement, root:Root, cache:QueryClient;
const startDm=vi.fn();
async function mount(principal="human") {
  await act(async () => root.render(<PlatformProvider client={api as unknown as BffClient} locale="en"><QueryClientProvider client={cache}><TooltipProvider>
    <ForumPane workspaceId="workspace" channelId="channel" archived={false} myPrincipalId={principal} onStartDm={startDm} />
  </TooltipProvider></QueryClientProvider></PlatformProvider>));
  await vi.waitFor(() => expect(host.textContent).toContain("Forum post"));
}
beforeEach(() => {
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  vi.clearAllMocks(); setLocale("en");
  vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener(){},removeEventListener(){}}));
  vi.stubGlobal("ResizeObserver",class { observe() {} unobserve() {} disconnect() {} });
  api.members.mockResolvedValue([{principalId:"human",displayName:"Me",pubkeys:[self],state:"ACTIVE"},{principalId:"author",displayName:"Author",pubkeys:[author],state:"ACTIVE"}]);
  api.workspaceMessages.mockImplementation((_scope, query) => Promise.resolve({events:query.messageType===WebMessageType.ForumComment?[reply]:[post,bounds]}));
  api.messageAuthorProfile.mockResolvedValue({pubkey:author,eventId:"profile",displayName:"Verified author",about:"Forum author biography",avatarUrl:null,nip05Handle:null,avatarMediaPaths:{}});
  cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());cache.clear();host.remove();vi.unstubAllGlobals();});

it("opens the actual post author without selecting the post and withdraws on stream interruption",async()=>{
  await mount();
  expect(api.messageAuthorProfile).not.toHaveBeenCalled();
  await act(async()=>host.querySelector<HTMLElement>('[role="button"][aria-label="Profile"]')!.click());
  await vi.waitFor(()=>expect(host.textContent).toContain("Forum author biography"));
  expect(api.messageAuthorProfile).toHaveBeenCalledWith("workspace",postId);
  expect(host.querySelector('[data-forum-event-id]')).toBeNull();
  await act(async()=>api.receive!({type:"interrupted"}));
  expect(host.textContent).not.toContain("Forum author biography");
  expect(host.querySelector('[aria-label="Profile"]')).toBeNull();
});

it("keeps the selected reply composer mounted while reading its author's profile",async()=>{
  await mount();
  const postCard=host.querySelector<HTMLElement>('[role="button"][tabindex="0"]')!;
  await act(async()=>postCard.click());
  await vi.waitFor(()=>expect(host.querySelector(`[data-forum-event-id="${replyId}"]`)).not.toBeNull());
  const composer=host.querySelector<HTMLTextAreaElement>('[aria-label="Reply draft"]')!;
  composer.value="Unsent forum reply";
  await act(async()=>host.querySelector<HTMLElement>(`[data-forum-event-id="${replyId}"] [aria-label="Profile"]`)!.click());
  await vi.waitFor(()=>expect(host.textContent).toContain("Forum author biography"));
  expect(api.messageAuthorProfile).toHaveBeenCalledWith("workspace",replyId);
  expect(host.querySelector('[aria-label="Reply draft"]')).toBe(composer);
  expect(composer.value).toBe("Unsent forum reply");
  await mount("different-human");
  expect(host.textContent).not.toContain("Forum author biography");
});
