// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
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

const api = vi.hoisted(() => ({members:vi.fn(), workspaceMessages:vi.fn(), messageAuthorProfile:vi.fn(), memberProfile:vi.fn(), profile:vi.fn(), delete:vi.fn(),
  publish:vi.fn(), receive:null as null | ((frame: StreamFrame) => void)}));
vi.mock("@/platform/bff-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/platform/bff-client")>(),
  bff:api, publishMessage:api.publish, deleteMessage:api.delete,
  openStream: (_scope: string, receive: (frame: StreamFrame) => void) => {api.receive=receive;return () => {};}}));
vi.mock("./ChannelPane", async (importOriginal) => ({
  ...await importOriginal<typeof import("./ChannelPane")>(),
  Composer: () => <textarea aria-label="Reply draft" />,
}));
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
async function mount(principal="human", search?:Pick<ComponentProps<typeof ForumPane>, "target"|"searchMessageId"|"searchQuery"|"searchActivationId">) {
  await act(async () => root.render(<PlatformProvider client={api as unknown as BffClient} locale="en"><QueryClientProvider client={cache}><TooltipProvider>
    <ForumPane workspaceId="workspace" channelId="channel" archived={false} myPrincipalId={principal} onStartDm={startDm} {...search} />
  </TooltipProvider></QueryClientProvider></PlatformProvider>));
  await vi.waitFor(() => expect(host.textContent).toContain("Forum post"));
}
beforeEach(() => {
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  vi.clearAllMocks(); setLocale("en");
  vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener(){},removeEventListener(){}}));
  vi.stubGlobal("ResizeObserver",class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype,"scrollIntoView",{configurable:true,value:vi.fn()});
  api.members.mockResolvedValue([{principalId:"human",displayName:"Me",pubkeys:[self],state:"ACTIVE"},{principalId:"author",displayName:"Author",pubkeys:[author],state:"ACTIVE"}]);
  api.profile.mockResolvedValue({pubkey:self});
  api.workspaceMessages.mockImplementation((_scope, query) => Promise.resolve({events:query.messageType===WebMessageType.ForumComment?[reply]:[post,bounds]}));
  api.messageAuthorProfile.mockResolvedValue({pubkey:author,eventId:"profile",displayName:"Verified author",about:"Forum author biography",avatarUrl:null,nip05Handle:null,avatarMediaPaths:{}});
  api.memberProfile.mockResolvedValue({pubkey:author,eventId:"profile",displayName:"Verified member",about:"Mention member biography",avatarUrl:null,nip05Handle:null,avatarMediaPaths:{}});
  cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());cache.clear();host.remove();vi.unstubAllGlobals();});

it.each([{messageId:postId,kind:45001},{messageId:replyId,kind:45003}])("opens and highlights the actual searchable forum kind $kind, including a repeated activation",async({messageId})=>{
  const target={channelId:"channel",messageId,threadRootId:messageId===postId?null:postId};
  const search={target,searchMessageId:messageId,searchQuery:"Forum",searchActivationId:"first"};
  await mount("human",search);
  await vi.waitFor(()=>expect(host.querySelector(`[data-forum-event-id="${messageId}"] [data-search-match="true"]`)?.textContent).toBe("Forum"));
  const otherId=messageId===postId?replyId:postId;
  expect(host.querySelector(`[data-forum-event-id="${otherId}"] [data-search-match="true"]`)).toBeNull();
  const back=[...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.includes("Back"));
  expect(back).toBeDefined();
  await act(async()=>back!.click());
  expect(host.querySelector('[data-forum-event-id]')).toBeNull();
  await mount("human",{...search,searchActivationId:"second"});
  await vi.waitFor(()=>expect(host.querySelector(`[data-forum-event-id="${messageId}"] [data-search-match="true"]`)).not.toBeNull());
  await mount("human",{target});
  expect(host.querySelector('[data-search-match="true"]')).toBeNull();
  await act(async()=>api.receive!({type:"closed",reason:"scope-revoked"}));
  expect(host.querySelector('[data-forum-event-id]')).toBeNull();
});

it("opens the actual post author without selecting the post and withdraws on stream interruption",async()=>{
  await mount();
  expect(host.querySelector('[data-testid="user-profile-panel"]')).toBeNull();
  await act(async()=>host.querySelector<HTMLElement>('[role="button"][aria-label="Profile"] > button')!.click());
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

it("opens a mention using the admitted member profile and removes the panel on revocation",async()=>{
  api.workspaceMessages.mockImplementation((_scope, query) => Promise.resolve({events:query.messageType===WebMessageType.ForumComment
    ? [{...reply,content:"Forum reply @Author",tags:[...reply.tags,["p",author]]}] : [post,bounds]}));
  await mount();
  await act(async()=>host.querySelector<HTMLElement>('[role="button"][tabindex="0"]')!.click());
  const chip = await vi.waitFor(()=>{
    const node=host.querySelector<HTMLElement>(`[data-forum-event-id="${replyId}"] [data-mention-pubkey="${author}"]`);
    expect(node).not.toBeNull(); return node!;
  });
  expect(api.memberProfile).not.toHaveBeenCalled();
  const trigger=chip.closest('[role="button"]')!;
  await act(async()=>trigger.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})));
  await vi.waitFor(()=>expect(host.textContent).toContain("Mention member biography"));
  expect(api.memberProfile).toHaveBeenCalledWith("workspace","author",author);
  expect(api.messageAuthorProfile).toHaveBeenCalledWith("workspace",postId);
  expect(api.messageAuthorProfile).toHaveBeenCalledWith("workspace",replyId);
  expect(host.querySelector('[aria-label="Reply draft"]')).not.toBeNull();
  await act(async()=>api.receive!({type:"closed",reason:"scope-revoked"}));
  expect(host.textContent).not.toContain("Mention member biography");
});

it("uses the admitted author's original avatar in cards, details and replies without opening a panel or starting a DM", async () => {
  vi.stubGlobal("Image", function () {
    const image = document.createElement("img"); let source = "";
    Object.defineProperties(image, {complete: {value: true}, naturalWidth: {value: 1},
      src: {get: () => source, set: (value: string) => {source = value; queueMicrotask(() => image.dispatchEvent(new Event("load")));}},
    });
    return image;
  });
  const avatarUrl = `https://community.example/media/${postId}.png`;
  const mediaPath = `/api/v1/workspaces/workspace/media/${postId}`;
  api.messageAuthorProfile.mockResolvedValue({pubkey:author,eventId:"profile",displayName:"Author",about:null,
    avatarUrl,nip05Handle:null,avatarMediaPaths:{[avatarUrl]:mediaPath}});
  await mount();
  await vi.waitFor(() => expect(host.querySelector("[data-avatar-shape] img")?.getAttribute("src")).toBe(mediaPath));
  const cardAvatar = host.querySelector("[data-avatar-shape]")!;
  expect(cardAvatar.classList.contains("h-6")).toBe(true);
  const cardAuthor = cardAvatar.closest("button")!;
  expect(cardAuthor.classList.contains("rounded-lg")).toBe(true);
  expect(cardAuthor.lastElementChild!.classList.contains("truncate")).toBe(true);
  expect(cardAuthor.lastElementChild!.classList.contains("font-medium")).toBe(true);
  expect(host.querySelector('[data-testid="user-profile-panel"]')).toBeNull();
  expect(host.querySelector("[data-forum-event-id]")).toBeNull();
  await act(async () => host.querySelector<HTMLElement>('[role="button"][tabindex="0"]')!.click());
  const detail = await vi.waitFor(() => {const node=host.querySelector(`[data-forum-event-id="${postId}"] [data-avatar-shape]`); expect(node).not.toBeNull(); return node!;});
  await vi.waitFor(() => expect(detail.querySelector("img")?.getAttribute("src")).toBe(mediaPath));
  expect(detail.classList.contains("h-9")).toBe(true);
  const detailAuthor = detail.closest("button")!;
  expect(detailAuthor.classList.contains("rounded-xl")).toBe(true);
  expect(detailAuthor.lastElementChild!.classList.contains("font-semibold")).toBe(true);
  expect(detailAuthor.lastElementChild!.classList.contains("truncate")).toBe(false);
  const replyAvatar = host.querySelector(`[data-forum-event-id="${replyId}"] [data-avatar-shape]`)!;
  await vi.waitFor(() => expect(replyAvatar.querySelector("img")?.getAttribute("src")).toBe(mediaPath));
  expect(replyAvatar.classList.contains("h-6")).toBe(true);
  const replyAuthor = replyAvatar.closest("button")!;
  expect(replyAuthor.classList.contains("rounded-lg")).toBe(true);
  expect(replyAuthor.lastElementChild!.classList.contains("font-medium")).toBe(true);
  expect(replyAuthor.lastElementChild!.classList.contains("truncate")).toBe(false);
  expect(api.messageAuthorProfile).toHaveBeenCalledWith("workspace",postId);
  expect(api.messageAuthorProfile).toHaveBeenCalledWith("workspace",replyId);
  expect(api.memberProfile).not.toHaveBeenCalled();
  expect(startDm).not.toHaveBeenCalled();
  expect(api.publish).not.toHaveBeenCalled();
  expect(host.querySelector('[data-testid="user-profile-panel"]')).toBeNull();
  await act(async () => api.receive!({type:"interrupted"}));
  expect(host.querySelectorAll("[data-avatar-shape] img")).toHaveLength(0);
  expect(host.querySelectorAll('[aria-label="Profile"]')).toHaveLength(0);
  expect(host.querySelector<HTMLButtonElement>(`[data-forum-event-id="${postId}"] [data-avatar-shape]`)!.closest("button")!.disabled).toBe(true);
  expect(host.querySelector<HTMLButtonElement>(`[data-forum-event-id="${replyId}"] [data-avatar-shape]`)!.closest("button")!.disabled).toBe(true);
});

it("offers deletion only for the actual SERVER signer and invokes the existing publish seam", async () => {
  api.profile.mockResolvedValue({pubkey:author});
  api.delete.mockResolvedValue({eventId:"f".repeat(64),operationId:"operation"});
  await mount();
  const trigger = await vi.waitFor(() => {
    const node=host.querySelector<HTMLButtonElement>('[aria-label="Delete post"]');expect(node).not.toBeNull();return node!;
  });
  await act(async()=>trigger.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})));
  await act(async()=>document.querySelector<HTMLElement>('[role="menuitem"]')!.click());
  const confirm=[...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((node)=>node.textContent==="Delete post")!;
  await act(async()=>confirm.click());
  expect(api.delete).toHaveBeenCalledWith("workspace",postId,WebMessageType.ForumPost);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});

it("does not equate another bound pubkey with the active SERVER signer", async () => {
  api.members.mockResolvedValue([{principalId:"human",displayName:"Me",pubkeys:[self,author],state:"ACTIVE"}]);
  await mount();
  expect(host.querySelector('[aria-label="Delete post"]')).toBeNull();
  expect(api.delete).not.toHaveBeenCalled();
});
