// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { setLocale } from "@client-kit/platform/i18n";
import { MessageAuthorAvatar, MessageAuthorIdentity, useMessageAuthorLabels, MessageAuthorProfile, type MessageAuthor } from "./MessageAuthorProfile";
import { MessageAuthorText, UserAvatar } from "@client-kit/platform/react/messages";
import { MoreUnreadButton, type UnreadDmPreview } from "@client-kit/platform/react/sidebar/MoreUnreadButton";
import { canonicalNpub, truncateNpub } from "@client-kit/platform/react/conversations/pubkey";
import { ForumAuthorButton } from "@client-kit/platform/react/forum/ForumView";
import { InboxMessageRowSurface } from "@client-kit/platform/react/inbox-surface";
import { KIND_STREAM_MESSAGE, KIND_SYSTEM_MESSAGE } from "@client-kit/platform/react/thread/kinds";
import { toast } from "sonner";
import { AUXILIARY_PANEL_SINGLE_COLUMN_BREAKPOINT_PX } from "@client-kit/platform/react/thread/auxiliaryPanelLayout";

const api=vi.hoisted(()=>({messageAuthorProfile:vi.fn(),conversationMessageAuthorProfile:vi.fn()}));
vi.mock("../bff-client",()=>({bff:api}));
const author="a".repeat(64),other="b".repeat(64),eventId="c".repeat(64);
const target={principalId:"human",workspaceId:"workspace",eventId,pubkey:author};
let root:Root;let host:HTMLDivElement;let cache:QueryClient;
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(()=>{
  setLocale("en");
  vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));
  vi.stubGlobal("ResizeObserver",class{observe(){} unobserve(){} disconnect(){}});
  api.messageAuthorProfile.mockReset();api.conversationMessageAuthorProfile.mockReset();
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
  cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
});
afterEach(async()=>{await act(async()=>root.unmount());cache.clear();host.remove();vi.unstubAllGlobals();});
async function render(content:React.ReactNode){await act(async()=>root.render(<QueryClientProvider client={cache}><TooltipProvider>{content}</TooltipProvider></QueryClientProvider>));}
function profile(pubkey=author){return {pubkey,eventId,displayName:"Message author",about:"Original biography",avatarUrl:null,nip05Handle:"author@example.org",avatarMediaPaths:{}};}

it("resolves the original DM overflow avatar through the same admitted message and drops removed proof",async()=>{
  loadedImages();
  const url=`https://community.example/media/${eventId}.png`;
  const path=`/api/v1/conversations/private/media/${eventId}`;
  api.conversationMessageAuthorProfile.mockResolvedValue({...profile(),avatarUrl:url,avatarMediaPaths:{[url]:path}});
  const preview:UnreadDmPreview={channelId:"dm",label:"Recipient",accessibleLabel:"Recipient",avatarUrl:null,
    author:{conversationId:"private",eventId,pubkey:author}};
  const overflow=(row:UnreadDmPreview)=><MoreUnreadButton count={1} position="bottom" emphasis="primary" onClick={()=>{}}
    testId="dm-overflow" dmPreviews={[row]} renderAvatar={(item,props)=>item.author
      ? <MessageAuthorAvatar {...props} target={{...item.author,principalId:target.principalId,workspaceId:""}}/>
      : <UserAvatar {...props}/>}/>;
  await render(overflow(preview));
  await vi.waitFor(()=>expect(host.querySelector<HTMLImageElement>('[data-testid="sidebar-unread-dm-avatar-dm-image"]')?.getAttribute("src")).toBe(path));
  expect(api.conversationMessageAuthorProfile).toHaveBeenCalledExactlyOnceWith("private",eventId);
  expect(api.messageAuthorProfile).not.toHaveBeenCalled();
  expect(host.querySelector('[data-testid="sidebar-unread-dm-avatar-dm"]')?.className).toContain("h-5 w-5");
  await render(overflow({...preview,author:undefined}));
  expect(host.querySelector("img")).toBeNull();
  expect(api.conversationMessageAuthorProfile).toHaveBeenCalledTimes(1);
});

function ResolvedAuthor({target, fallbackName, available=true, surface="text"}: {
  target:MessageAuthor; fallbackName?:string; available?:boolean; surface?:"text"|"avatar"|"inbox"|"forum";
}) {
  const event={id:target.eventId,pubkey:target.pubkey,kind:KIND_STREAM_MESSAGE};
  const label=useMessageAuthorLabels(target,[event],available);
  const message={...event,author:label(event,fallbackName),createdAt:1,body:"Message body",depth:0,time:""};
  if(surface==="inbox") return <InboxMessageRowSurface message={message} renderBody={()=>message.body}/>;
  if(surface==="forum") return <ForumAuthorButton displayName={message.author} large preview
    avatar={<MessageAuthorAvatar target={target} displayName={message.author}/>}/>;
  return <>{surface==="avatar"?<MessageAuthorAvatar target={target} displayName={message.author} testId="author-avatar"/>:null}
    <MessageAuthorText hoverUnderline>{message.author}</MessageAuthorText></>;
}

function loadedImages() {
  vi.stubGlobal("Image", function () {
    const image = document.createElement("img");
    let source = "";
    Object.defineProperties(image, {complete: {value: true}, naturalWidth: {value: 1}});
    Object.defineProperty(image, "src", {get: () => source, set: (value: string) => {
      source = value;
      queueMicrotask(() => image.dispatchEvent(new Event("load")));
    }});
    return image;
  });
}

it("reads the admitted author's actual avatar into the original inbox avatar without a directory lookup", async () => {
  loadedImages();
  const avatarUrl = `https://community.example/media/${eventId}.png`;
  const mediaPath = `/api/v1/workspaces/${target.workspaceId}/media/${eventId}`;
  api.messageAuthorProfile.mockResolvedValue({...profile(), avatarUrl, avatarMediaPaths: {[avatarUrl]: mediaPath}});
  await render(<MessageAuthorAvatar target={target} displayName="Message author" size="md" className="h-9 w-9" shape="squircle" testId="author-avatar" />);
  await vi.waitFor(() => expect(host.querySelector<HTMLImageElement>('[data-testid="author-avatar-image"]')?.getAttribute("src")).toBe(mediaPath));
  expect(api.messageAuthorProfile).toHaveBeenCalledWith("workspace", eventId);
  expect(api.conversationMessageAuthorProfile).not.toHaveBeenCalled();
  const avatar = host.querySelector('[data-testid="author-avatar"]')!;
  expect(avatar.getAttribute("data-avatar-shape")).toBe("squircle");
  expect(avatar.className).toContain("h-9 w-9");
  expect(host.querySelector("img")?.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(host.querySelector("img")?.getAttribute("alt")).toBe("Message author Avatar");
  await act(async () => setLocale("zh-CN"));
  expect(host.querySelector("img")?.getAttribute("alt")).toBe("Message author 头像");
});

it("uses one admitted read for the original author text and avatar, preferring the real profile over the member fallback", async () => {
  loadedImages();
  const avatarUrl = `https://community.example/media/${eventId}.png`;
  const mediaPath = `/api/v1/workspaces/${target.workspaceId}/media/${eventId}`;
  api.messageAuthorProfile.mockResolvedValue({...profile(), displayName:"  Actual public name  ", avatarUrl,
    avatarMediaPaths:{[avatarUrl]:mediaPath}});
  await render(<ResolvedAuthor target={target} fallbackName="Member fallback" surface="avatar"/>);
  await vi.waitFor(() => expect(host.querySelector('[data-testid="message-author"]')?.textContent).toBe("Actual public name"));
  await vi.waitFor(() => expect(host.querySelector("img")?.getAttribute("alt")).toBe("Actual public name Avatar"));
  expect(host.querySelector('[data-testid="message-author"]')?.className).toBe("truncate text-message font-semibold leading-message-author tracking-normal hover:underline");
  expect(api.messageAuthorProfile).toHaveBeenCalledExactlyOnceWith("workspace", eventId);
  expect(api.conversationMessageAuthorProfile).not.toHaveBeenCalled();
});

it.each([
  [{displayName:"",nip05Handle:"  person@example.org  "}, "Member fallback", "person@example.org"],
  [{displayName:null,nip05Handle:null}, "  Member fallback  ", "Member fallback"],
  [{displayName:null,nip05Handle:null}, undefined, truncateNpub(author)],
] as const)("keeps the original NIP-05, explicit fallback and npub precedence %#", async (fields, fallbackName, expected) => {
  api.conversationMessageAuthorProfile.mockResolvedValue({...profile(), ...fields});
  await render(<ResolvedAuthor target={{...target,conversationId:"private"}} fallbackName={fallbackName} />);
  await vi.waitFor(() => expect(cache.isFetching()).toBe(0));
  await vi.waitFor(() => expect(host.querySelector('[data-testid="message-author"]')?.textContent).toBe(expected));
  expect(api.conversationMessageAuthorProfile).toHaveBeenCalledExactlyOnceWith("private", eventId);
  expect(api.messageAuthorProfile).not.toHaveBeenCalled();
});

it("keeps the exact original forum author button while resolving its visible and accessible label through the same profile read", async () => {
  api.messageAuthorProfile.mockResolvedValue({...profile(), displayName:"Actual forum author"});
  await render(<ResolvedAuthor target={target} fallbackName="Member fallback" surface="forum"/>);
  await vi.waitFor(() => expect(host.querySelector("button")?.textContent).toContain("Actual forum author"));
  expect(host.querySelector("button")?.className).toBe("flex items-center gap-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring rounded-xl");
  expect(api.messageAuthorProfile).toHaveBeenCalledOnce();
});

it("preserves the original Inbox author element rather than replacing it with a different message-row layout", async () => {
  api.messageAuthorProfile.mockResolvedValue({...profile(),displayName:"Actual inbox author"});
  await render(<ResolvedAuthor target={target} fallbackName="Member fallback" surface="inbox"/>);
  await vi.waitFor(() => expect(host.querySelector('[data-testid="message-author"]')?.textContent).toBe("Actual inbox author"));
  expect(host.querySelector('[data-testid="message-author"]')?.className).toBe("block max-w-full truncate rounded text-message font-semibold leading-message-author text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring");
  expect(host.querySelectorAll('[data-testid="message-author"]')).toHaveLength(1);
  expect(host.querySelector('[data-testid="message-body"]')?.textContent).toContain("Message body");
});

it("drops the resolved name while rechecking, on 403 and on a different principal/scope without accepting a late response", async () => {
  api.messageAuthorProfile.mockResolvedValue({...profile(), displayName:"First scoped name"});
  await render(<ResolvedAuthor target={target} fallbackName="First member" />);
  await vi.waitFor(() => expect(host.textContent).toBe("First scoped name"));
  let finish!: (value: ReturnType<typeof profile>) => void;
  api.messageAuthorProfile.mockReturnValue(new Promise(resolve => {finish=resolve;}));
  await act(async () => {void cache.invalidateQueries({queryKey:["platform","message-author"]});});
  await vi.waitFor(() => expect(host.textContent).toBe("First member"));
  api.conversationMessageAuthorProfile.mockRejectedValue(new Error("403 forbidden"));
  await render(<ResolvedAuthor target={{...target,principalId:"another-human",conversationId:"not-admitted"}} fallbackName="Second member" />);
  await vi.waitFor(() => expect(api.conversationMessageAuthorProfile).toHaveBeenCalledOnce());
  await act(async () => finish({...profile(),displayName:"Late first scoped name"}));
  expect(host.textContent).toBe("Second member");
  expect(host.textContent).not.toContain("First scoped name");
  expect(host.textContent).not.toContain("Late first scoped name");
});

it("does not show a mismatched author's display name or NIP-05", async () => {
  api.messageAuthorProfile.mockResolvedValue({...profile(other),displayName:"Wrong identity",nip05Handle:"wrong@example.org"});
  await render(<ResolvedAuthor target={target} fallbackName="Admitted member" />);
  await vi.waitFor(() => expect(cache.isFetching()).toBe(0));
  expect(host.textContent).toBe("Admitted member");
  expect(host.textContent).not.toContain("Wrong identity");
  expect(host.textContent).not.toContain("wrong@example.org");
});

it("removes a cached profile immediately when the event's read scope becomes unavailable", async()=>{
  api.messageAuthorProfile.mockResolvedValue({...profile(),displayName:"Admitted name"});
  await render(<ResolvedAuthor target={target} fallbackName="Member"/>);
  await vi.waitFor(()=>expect(host.textContent).toBe("Admitted name"));
  await render(<ResolvedAuthor target={target} fallbackName="Member" available={false}/>);
  expect(host.textContent).toBe("Member");
  expect(api.messageAuthorProfile).toHaveBeenCalledOnce();
});

it("does not reuse another event's successful profile for a refused event by the same author",async()=>{
  api.messageAuthorProfile.mockImplementation((_scope:string,id:string)=>id===eventId?Promise.resolve(profile()):Promise.reject(new Error("403 forbidden")));
  function TwoEvents(){
    const events=[{id:eventId,pubkey:author,kind:KIND_STREAM_MESSAGE},{id:"d".repeat(64),pubkey:author,kind:KIND_STREAM_MESSAGE}];
    const label=useMessageAuthorLabels(target,events,true);
    return <>{events.map(event=><output key={event.id}>{label(event,"Member")}</output>)}</>;
  }
  await render(<TwoEvents/>);
  await vi.waitFor(()=>expect(cache.isFetching()).toBe(0));
  await vi.waitFor(() => expect([...host.querySelectorAll("output")].map(node=>node.textContent)).toEqual(["Message author","Member"]));
});

it("does not query a Relay system-row signer as an admitted message author",async()=>{
  api.messageAuthorProfile.mockResolvedValue(profile());
  function MixedEvents(){
    const message={id:eventId,pubkey:author,kind:KIND_STREAM_MESSAGE};
    const system={id:"d".repeat(64),pubkey:other,kind:KIND_SYSTEM_MESSAGE};
    const label=useMessageAuthorLabels(target,[system,message],true);
    return <output>{label(message,"Member")}</output>;
  }
  await render(<MixedEvents/>);
  await vi.waitFor(()=>expect(host.textContent).toBe("Message author"));
  expect(api.messageAuthorProfile).toHaveBeenCalledExactlyOnceWith(target.workspaceId,eventId);
  expect(api.conversationMessageAuthorProfile).not.toHaveBeenCalled();
});

it("preserves the original animated avatar poster and hover playback through authorized media paths", async () => {
  loadedImages();
  const poster = `https://community.example/media/${eventId}.png`;
  const animation = `https://community.example/media/${other}.png`;
  const posterPath = `/api/v1/conversations/private/media/${eventId}`;
  const animationPath = `/api/v1/conversations/private/media/${other}`;
  api.conversationMessageAuthorProfile.mockResolvedValue({...profile(), avatarUrl: `${poster}#buzz-anim=${encodeURIComponent(animation)}`,
    avatarMediaPaths: {[poster]: posterPath, [animation]: animationPath}});
  await render(<MessageAuthorAvatar target={{...target, conversationId: "private"}} displayName="Message author" testId="author-avatar" />);
  await vi.waitFor(() => expect(host.querySelector("img")?.getAttribute("src")).toBe(posterPath));
  const avatar = host.querySelector('[data-testid="author-avatar"]')!;
  await act(async () => avatar.dispatchEvent(new MouseEvent("mouseover", {bubbles: true})));
  await vi.waitFor(() => expect(host.querySelector("img")?.getAttribute("src")).toBe(animationPath));
  await act(async () => avatar.dispatchEvent(new MouseEvent("mouseout", {bubbles: true})));
  await vi.waitFor(() => expect(host.querySelector("img")?.getAttribute("src")).toBe(posterPath));
  expect(api.conversationMessageAuthorProfile).toHaveBeenCalledWith("private", eventId);
  expect(api.messageAuthorProfile).not.toHaveBeenCalled();
});

it("never uses a mismatched author's avatar or biography", async () => {
  loadedImages();
  const avatarUrl = `https://community.example/media/${other}.png`;
  api.messageAuthorProfile.mockResolvedValue({...profile(other), avatarUrl, avatarMediaPaths: {[avatarUrl]: `/api/v1/workspaces/${target.workspaceId}/media/${other}`}});
  await render(<><MessageAuthorAvatar target={target} displayName="Message author" testId="author-avatar" />
    <MessageAuthorProfile target={target} onClose={() => {}} /></>);
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')).not.toBeNull());
  expect(host.querySelector('[data-testid="author-avatar-image"]')).toBeNull();
  expect(host.textContent).not.toContain("Original biography");
  expect(api.messageAuthorProfile).toHaveBeenCalledOnce();
});

it("removes the old avatar on Principal or scope changes and ignores a late prior-scope read", async () => {
  loadedImages();
  const avatarUrl = `https://community.example/media/${eventId}.png`;
  const mediaPath = `/api/v1/workspaces/${target.workspaceId}/media/${eventId}`;
  const actual = {...profile(), avatarUrl, avatarMediaPaths: {[avatarUrl]: mediaPath}};
  api.messageAuthorProfile.mockResolvedValue(actual);
  await render(<MessageAuthorAvatar target={target} displayName="Message author" testId="author-avatar" />);
  await vi.waitFor(() => expect(host.querySelector("img")?.getAttribute("src")).toBe(mediaPath));
  let complete!: (value: typeof actual) => void;
  api.messageAuthorProfile.mockReturnValue(new Promise((resolve) => {complete = resolve;}));
  await render(<MessageAuthorAvatar target={{...target, principalId: "another-human"}} displayName="Message author" testId="author-avatar" />);
  expect(host.querySelector("img")).toBeNull();
  expect(api.messageAuthorProfile).toHaveBeenCalledTimes(2);
  api.conversationMessageAuthorProfile.mockRejectedValue(new Error("denied"));
  await render(<><MessageAuthorAvatar target={{...target, principalId: "another-human", conversationId: "not-admitted"}} displayName="Message author" testId="author-avatar" />
    <MessageAuthorProfile target={{...target, principalId: "another-human", conversationId: "not-admitted"}} onClose={() => {}} /></>);
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')).not.toBeNull());
  await act(async () => complete(actual));
  expect(host.querySelector("img")).toBeNull();
  expect(host.textContent).not.toContain("Original biography");
});

it("keeps original author triggers lazy until a real open, without a directory request",async()=>{
  const open=vi.fn();
  await render(<MessageAuthorIdentity target={target} onOpen={open}><span>Author</span></MessageAuthorIdentity>);
  expect(api.messageAuthorProfile).not.toHaveBeenCalled();
  expect(api.conversationMessageAuthorProfile).not.toHaveBeenCalled();
  await act(async()=>host.querySelector<HTMLElement>('[role="button"]')!.click());
  expect(open).toHaveBeenCalledOnce();
  expect(api.messageAuthorProfile).not.toHaveBeenCalled();
});

it("opens the actual message author, uses the private scope and passes the verified identity to DM",async()=>{
  api.conversationMessageAuthorProfile.mockResolvedValue(profile());const start=vi.fn();
  await render(<MessageAuthorProfile target={{...target,conversationId:"private"}} onClose={()=>{}} onStartDm={start}/>);
  await vi.waitFor(()=>expect(host.textContent).toContain("Original biography"));
  expect(api.conversationMessageAuthorProfile).toHaveBeenCalledWith("private",eventId);
  expect(api.messageAuthorProfile).not.toHaveBeenCalled();
  const message=host.querySelector<HTMLButtonElement>('[data-testid="user-profile-message"]')!;
  expect(message.getAttribute("aria-label")).toBe("Message");
  expect(message.className).toContain("min-h-20");
  expect(host.querySelector('[data-testid="user-profile-info-section"] h2')?.textContent).toBe("Info");
  await act(async()=>message.click());
  expect(start).toHaveBeenCalledWith(author);
});

it("uses the original human profile frame surface while keeping its real title, X and resize consumers",async()=>{
  api.messageAuthorProfile.mockResolvedValue(profile());const close=vi.fn();
  await render(<MessageAuthorProfile target={target} onClose={close} layout="split" transparentChrome/>);
  await vi.waitFor(()=>expect(host.textContent).toContain("Original biography"));
  const pane=host.querySelector<HTMLElement>('[data-testid="home-user-profile-panel"]')!;
  expect(pane.classList.contains("z-31")).toBe(true);
  expect(pane.classList.contains("isolate")).toBe(true);
  expect(pane.classList.contains("buzz-side-panel-enter")).toBe(false);
  const header=pane.querySelector('[data-testid="user-profile-panel-header"]')!;
  expect(header.classList.contains("bg-transparent")).toBe(false);
  expect(header.classList.contains("backdrop-blur-md")).toBe(true);
  expect(pane.querySelector('[data-testid="user-profile-sticky-chrome-surface"]')?.getAttribute("data-active")).toBe("false");
  expect(header.querySelector("h2")?.textContent).toBe("Profile");
  expect(pane.querySelectorAll('[data-testid="right-auxiliary-pane-resize-handle"]')).toHaveLength(1);
  expect(pane.querySelector('[data-testid="user-profile-resize-handle"]')).toBeNull();
  const button=pane.querySelector<HTMLButtonElement>('[data-testid="auxiliary-panel-close"]')!;
  expect(button.querySelector("svg")).not.toBeNull();
  await act(async()=>button.click());
  expect(close).toHaveBeenCalledOnce();
});

it("uses the original overlay profile header without a desktop resize border",async()=>{
  vi.stubGlobal("innerWidth",AUXILIARY_PANEL_SINGLE_COLUMN_BREAKPOINT_PX-1);
  vi.stubGlobal("matchMedia",()=>({matches:true,addEventListener:()=>{},removeEventListener:()=>{}}));
  api.messageAuthorProfile.mockResolvedValue(profile());
  await render(<MessageAuthorProfile target={target} onClose={()=>{}}/>);
  await vi.waitFor(()=>expect(host.textContent).toContain("Original biography"));
  const header=host.querySelector<HTMLElement>('[data-testid="user-profile-panel-header"]')!;
  expect(header.className).not.toContain("after:w-px");
  expect(header.className).toContain("backdrop-blur-md");
  expect(header.querySelector("h2")?.textContent).toBe("Profile");
  expect(host.querySelector('[data-testid="user-profile-sticky-chrome-surface"]')?.getAttribute("data-active")).toBe("false");
  expect(api.messageAuthorProfile).toHaveBeenCalledExactlyOnceWith("workspace",eventId);
});

it("uses the same original public sections in Chinese without offering unsupported actions",async()=>{
  setLocale("zh-CN");api.messageAuthorProfile.mockResolvedValue(profile());
  await render(<MessageAuthorProfile target={target} onClose={()=>{}} onStartDm={()=>{}}/>);
  await vi.waitFor(()=>expect(host.querySelector('[data-testid="user-profile-info-section"]')).not.toBeNull());
  expect(host.querySelector('[data-testid="user-profile-info-section"] h2')?.textContent).toBe("信息");
  expect(host.querySelector('[data-testid="user-profile-message"]')?.getAttribute("aria-label")).toBe("发消息");
  expect(host.querySelector('[data-testid="user-profile-public-key"]')?.getAttribute("aria-label")).toBe("复制公钥");
  expect(host.querySelector('[data-testid="user-profile-huddle"]')).toBeNull();
  expect(host.querySelector('[data-testid="user-profile-wave"]')).toBeNull();
  expect(host.querySelector('[data-testid="user-profile-agent-primary-action"]')).toBeNull();
});

it("copies the admitted author's original public-key field on HTTP and reports refused writes",async()=>{
  api.messageAuthorProfile.mockResolvedValue(profile());
  const originalExec=Object.getOwnPropertyDescriptor(document,"execCommand");
  const success=vi.spyOn(toast,"success").mockImplementation(()=>0);
  const error=vi.spyOn(toast,"error").mockImplementation(()=>0);
  vi.stubGlobal("navigator",{clipboard:undefined});
  let copied="";
  const execute=vi.fn(()=>{copied=(document.activeElement as HTMLTextAreaElement).value;return true;});
  Object.defineProperty(document,"execCommand",{configurable:true,value:execute});
  try {
    await render(<MessageAuthorProfile target={target} onClose={()=>{}}/>);
    await vi.waitFor(()=>expect(host.querySelector('[data-testid="user-profile-public-key"]')).not.toBeNull());
    const button=host.querySelector<HTMLButtonElement>('[data-testid="user-profile-public-key"]')!;
    await act(async()=>button.click());
    expect(copied).toBe(canonicalNpub(author));
    expect(execute).toHaveBeenCalledExactlyOnceWith("copy");
    expect(success).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    expect(document.querySelector("textarea")).toBeNull();
    execute.mockReturnValue(false);success.mockClear();
    await act(async()=>button.click());
    expect(error).toHaveBeenLastCalledWith("Could not copy to clipboard");
    expect(success).not.toHaveBeenCalled();
    const writes=execute.mock.calls.length;
    const modern=vi.fn().mockRejectedValue(new Error("Permission denied"));
    vi.stubGlobal("navigator",{clipboard:{writeText:modern}});
    await act(async()=>button.click());
    expect(modern).toHaveBeenCalledExactlyOnceWith(canonicalNpub(author));
    expect(execute).toHaveBeenCalledTimes(writes);
    expect(error).toHaveBeenCalledTimes(2);
    expect(success).not.toHaveBeenCalled();
  } finally {
    if(originalExec)Object.defineProperty(document,"execCommand",originalExec);
    else Reflect.deleteProperty(document,"execCommand");
    success.mockRestore();error.mockRestore();
  }
});

it("does not expose another author's profile when a response mismatches the signed message",async()=>{
  api.messageAuthorProfile.mockResolvedValue(profile(other));
  await render(<MessageAuthorProfile target={target} onClose={()=>{}}/>);
  await vi.waitFor(()=>expect(host.querySelector('[role="alert"]')).not.toBeNull());
  expect(host.textContent).not.toContain("Original biography");
  expect(host.textContent).not.toContain("Message author");
});

it("rechecks the actual event and never shows prior-scope profile data after a scope switch",async()=>{
  api.messageAuthorProfile.mockResolvedValue(profile());
  await render(<MessageAuthorProfile target={target} onClose={()=>{}}/>);
  await vi.waitFor(()=>expect(host.textContent).toContain("Original biography"));
  api.conversationMessageAuthorProfile.mockRejectedValue(new Error("denied"));
  await render(<MessageAuthorProfile target={{...target,conversationId:"not-admitted"}} onClose={()=>{}}/>);
  await vi.waitFor(()=>expect(host.querySelector('[role="alert"]')).not.toBeNull());
  expect(host.textContent).not.toContain("Original biography");
});

it("keeps the original Message tile pending until actual DM navigation completes, even when its host callback rerenders",async()=>{
  api.messageAuthorProfile.mockResolvedValue(profile());
  let finish!:()=>void;
  const start=vi.fn((_pubkey:string)=>new Promise<void>(resolve=>{finish=resolve;}));
  const close=vi.fn();
  await render(<MessageAuthorProfile target={target} onClose={close} onStartDm={start}/>);
  await vi.waitFor(()=>expect(host.querySelector('[data-testid="user-profile-message"]')).not.toBeNull());
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="user-profile-message"]')!.click());
  expect(close).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLButtonElement>('[data-testid="user-profile-message"]')!.disabled).toBe(true);
  await render(<MessageAuthorProfile target={target} onClose={close} onStartDm={async key=>{await start(key);}}/>);
  await vi.waitFor(()=>expect(host.querySelector<HTMLButtonElement>('[data-testid="user-profile-message"]')?.disabled).toBe(true));
  await act(async()=>finish());
  expect(close).toHaveBeenCalledOnce();
  expect(start).toHaveBeenCalledOnce();
});

it("keeps the original profile open and shows the unknown DM result without a false close",async()=>{
  api.messageAuthorProfile.mockResolvedValue(profile());
  const start=vi.fn().mockRejectedValue(new Error("Direct message result unknown"));
  const close=vi.fn();
  await render(<MessageAuthorProfile target={target} onClose={close} onStartDm={start}/>);
  await vi.waitFor(()=>expect(host.querySelector('[data-testid="user-profile-message"]')).not.toBeNull());
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="user-profile-message"]')!.click());
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Direct message result unknown");
  expect(close).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLButtonElement>('[data-testid="user-profile-message"]')!.disabled).toBe(false);
});

it("does not close a new profile when an old-scope DM completes late",async()=>{
  api.messageAuthorProfile.mockResolvedValue(profile());
  let finish!:()=>void;
  const start=vi.fn((_pubkey:string)=>new Promise<void>(resolve=>{finish=resolve;}));
  const close=vi.fn();
  await render(<MessageAuthorProfile target={target} onClose={close} onStartDm={start}/>);
  await vi.waitFor(()=>expect(host.querySelector('[data-testid="user-profile-message"]')).not.toBeNull());
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="user-profile-message"]')!.click());
  await render(<MessageAuthorProfile target={{...target,principalId:"another-viewer"}} onClose={close} onStartDm={start}/>);
  await act(async()=>finish());
  expect(close).not.toHaveBeenCalled();
  await vi.waitFor(()=>expect(host.querySelector<HTMLButtonElement>('[data-testid="user-profile-message"]')?.disabled).toBe(false));
});
