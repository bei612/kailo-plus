// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { setLocale } from "@client-kit/platform/i18n";
import { MessageAuthorAvatar, MessageAuthorIdentity, MessageAuthorProfile } from "./MessageAuthorProfile";

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

it("uses the original split profile pane above Inbox's shared blur while keeping its real title, X and resize consumers",async()=>{
  api.messageAuthorProfile.mockResolvedValue(profile());const close=vi.fn();
  await render(<MessageAuthorProfile target={target} onClose={close} layout="split" transparentChrome/>);
  await vi.waitFor(()=>expect(host.textContent).toContain("Original biography"));
  const pane=host.querySelector<HTMLElement>('[data-testid="home-user-profile-panel"]')!;
  expect(pane.classList.contains("z-31")).toBe(true);
  expect(pane.classList.contains("isolate")).toBe(true);
  expect(pane.classList.contains("buzz-side-panel-enter")).toBe(false);
  const header=pane.querySelector('[data-testid="user-profile-panel-header"]')!;
  expect(header.classList.contains("bg-transparent")).toBe(true);
  expect(header.classList.contains("backdrop-blur-md")).toBe(false);
  expect(header.querySelector("h2")?.textContent).toBe("Profile");
  expect(pane.querySelectorAll('[data-testid="right-auxiliary-pane-resize-handle"]')).toHaveLength(1);
  expect(pane.querySelector('[data-testid="user-profile-resize-handle"]')).toBeNull();
  const button=pane.querySelector<HTMLButtonElement>('[data-testid="auxiliary-panel-close"]')!;
  expect(button.querySelector("svg")).not.toBeNull();
  await act(async()=>button.click());
  expect(close).toHaveBeenCalledOnce();
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
