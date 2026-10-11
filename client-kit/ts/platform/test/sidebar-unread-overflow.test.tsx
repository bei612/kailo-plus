import { act, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../src/i18n";
import { MoreUnreadButton, canPreviewUnreadDm, preferredUnreadTarget, visibleUnreadDmPreviews, type UnreadDmPreview } from "../src/react/sidebar/MoreUnreadButton";
import { useConversationUnreadProjection, useSidebarUnreadOverflow, type ConversationUnreadEntry } from "../src/react/sidebar/useSidebarUnreadOverflow";
import { deriveUnreadOverflow, useUnreadOverflow } from "../src/react/sidebar/useUnreadOverflow";
import { click, render, settle } from "./render";
import { UserAvatar, type UserAvatarProps } from "../src/react/messages/UserAvatar";

let intersections: Array<{ callback: IntersectionObserverCallback; elements: Element[] }>;
beforeEach(() => {
  setLocale("en");
  intersections = [];
  vi.stubGlobal("IntersectionObserver", class {
    state: typeof intersections[number];
    constructor(callback: IntersectionObserverCallback) { this.state = {callback, elements: []}; intersections.push(this.state); }
    observe(element: Element) { this.state.elements.push(element); }
    disconnect() { this.state.elements = []; }
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { top: Number(this.dataset.top ?? 0), height: 100 } as DOMRect;
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); setLocale("zh-CN"); });

function Sidebar() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [unread, setUnread] = useState<ReadonlySet<string>>(() => new Set(["before", "after"]));
  const overflow = useUnreadOverflow({scrollRef, unreadChannelIds: unread});
  return <>
    {overflow.unreadAboveCount > 0 && <MoreUnreadButton count={overflow.unreadAboveCount} position="top" emphasis="default" onClick={overflow.scrollToNextAbove} testId="above" />}
    <div ref={scrollRef}>
      <button data-channel-id="before" data-top="-20">Before</button>
      <button data-channel-id="after" data-top="150">After</button>
      <button data-channel-id="read" data-top="180">Already read</button>
    </div>
    {overflow.unreadBelowCount > 0 && <MoreUnreadButton count={overflow.unreadBelowCount} position="bottom" bottomClassName="bottom-full" emphasis="default" onClick={overflow.scrollToNextBelow} testId="below" />}
    <button onClick={() => setUnread(new Set())}>Authoritative read update</button>
  </>;
}

describe("original sidebar unread observers and real scroll controls", () => {
  it("passes the original avatar shape, animation and stack props to the actual host adapter",async()=>{
    const renderAvatar=vi.fn((_preview:UnreadDmPreview,props:UserAvatarProps)=><UserAvatar {...props}/>);
    const host=await render(<MoreUnreadButton count={1} position="bottom" emphasis="primary" onClick={()=>{}} testId="avatar-host"
      renderAvatar={renderAvatar} dmPreviews={[{channelId:"dm",label:"Bob",accessibleLabel:"Bob",avatarUrl:null,
        author:{conversationId:"conversation",eventId:"message",pubkey:"b".repeat(64)}}]}/>);
    expect(renderAvatar).toHaveBeenCalledWith(expect.objectContaining({author:{conversationId:"conversation",eventId:"message",pubkey:"b".repeat(64)}}),
      {avatarUrl:null,className:"ring-2 ring-primary",displayName:"Bob",shape:"circle",fallbackDelayMs:0,size:"xs",testId:"sidebar-unread-dm-avatar-dm"});
    expect(host.querySelector('[data-testid="sidebar-unread-dm-avatar-dm"]')?.className).toContain("ring-2");
    expect(host.querySelector("img")).toBeNull();
  });
  it("keeps the original 1v1 preview gate, three-avatar cap, and DM-priority scroll target", async () => {
    expect(canPreviewUnreadDm(2,1)).toBe(true);
    expect(canPreviewUnreadDm(3,2)).toBe(false);
    expect(canPreviewUnreadDm(2,0)).toBe(false);
    const previews: UnreadDmPreview[] = ["Bob","Zara","Alice","Dan"].map(label=>({
      channelId:label,accessibleLabel:label,label,avatarUrl:null,
    }));
    expect(visibleUnreadDmPreviews(previews).map(preview=>preview.label)).toEqual(["Bob","Zara","Alice"]);
    const ids=new Set(["Bob"]), ordinary=new Set(["channel"]), highPriority=new Set<string>();
    function DmSidebar() {
      const scrollRef=useRef<HTMLDivElement>(null);
      const overflow=useSidebarUnreadOverflow({scrollRef,dmChannelIds:ids,highPriorityUnreadChannelIds:highPriority,
        previewActivityChannelIds:ids,unreadChannelIds:ordinary});
      const target=preferredUnreadTarget(overflow.unreadMessageBelowChannelIds,ids);
      return <><div ref={scrollRef}><button data-channel-id="channel" data-top="120"/><button data-channel-id="Bob" data-top="150"/></div>
        <MoreUnreadButton count={overflow.unreadBelowCount} position="bottom" dmPreviews={previews} targetChannelId={target}
          emphasis={overflow.hasHighPriorityBelow?"primary":"default"} testId="dm-below"
          onClick={()=>target?overflow.scrollToChannel(target):overflow.scrollToNextBelow()}/></>;
    }
    const host=await render(<DmSidebar/>);
    const target=host.querySelector<HTMLElement>('[data-channel-id="Bob"]')!;
    target.scrollIntoView=vi.fn();
    const button=host.querySelector<HTMLElement>('[data-testid="dm-below"]')!;
    expect(button.getAttribute("aria-label")).toBe("Go to unread direct message from Bob. 2 unread below.");
    expect(button.className).toContain("bg-primary");
    expect(host.querySelectorAll('[data-avatar-shape][data-testid^="sidebar-unread-dm-avatar-"]').length).toBe(3);
    expect(host.querySelector('[data-testid="sidebar-unread-dm-avatar-Dan"]')).toBeNull();
    expect(host.querySelector("img")).toBeNull();
    await click(button);
    expect(target.scrollIntoView).toHaveBeenCalledWith({behavior:"smooth",block:"center"});
  });

  it("rejects the previous scope publisher and clears the projected names synchronously on a scope change",async()=>{
    const scopes=[{},{}];
    const publishers: Array<(entries: readonly ConversationUnreadEntry[])=>void> = [];
    function Host() {
      const [scope,setScope]=useState(scopes[0]!);
      const projection=useConversationUnreadProjection(scope);
      publishers[scope===scopes[0]?0:1]=projection.onUnreadChange;
      return <><output>{projection.entries.map(entry=>entry.preview?.label).join(",")}</output><button onClick={()=>setScope(scopes[1]!)}>Switch scope</button></>;
    }
    const host=await render(<Host/>);
    const bob={channelId:"bob",preview:{channelId:"bob",accessibleLabel:"Bob",label:"Bob",avatarUrl:null}};
    await act(async()=>publishers[0]!([bob]));
    expect(host.querySelector("output")?.textContent).toBe("Bob");
    await click(host.querySelector("button")!);
    expect(host.querySelector("output")?.textContent).toBe("");
    await act(async()=>publishers[0]!([bob]));
    expect(host.querySelector("output")?.textContent).toBe("");
    await act(async()=>publishers[1]!([bob]));
    expect(host.querySelector("output")?.textContent).toBe("Bob");
    await act(async()=>publishers[1]!([]));
    expect(host.querySelector("output")?.textContent).toBe("");
  });

  it("keeps the complete original DM target sentence through the same Chinese catalog",async()=>{
    setLocale("zh-CN");
    const host=await render(<MoreUnreadButton count={2} position="bottom" emphasis="primary" onClick={()=>{}} testId="dm"
      targetChannelId="bob" dmPreviews={[{channelId:"bob",label:"Bob",accessibleLabel:"Bob",avatarUrl:null}]}/>);
    expect(host.querySelector('[data-testid="dm"]')?.getAttribute("aria-label")).toBe("前往来自Bob的未读私聊。下方2 项未读。");
  });
  it("scrolls to the nearest real unread row and removes the controls after the read projection changes", async () => {
    const host = await render(<Sidebar />);
    const above = host.querySelector<HTMLElement>('[data-testid="above"]')!;
    const below = host.querySelector<HTMLElement>('[data-testid="below"]')!;
    expect(above.getAttribute("aria-label")).toBe("1 unread above");
    expect(below.getAttribute("aria-label")).toBe("1 unread below");
    const beforeScroll = vi.fn(), afterScroll = vi.fn(), readScroll = vi.fn();
    host.querySelector<HTMLElement>('[data-channel-id="before"]')!.scrollIntoView = beforeScroll;
    host.querySelector<HTMLElement>('[data-channel-id="after"]')!.scrollIntoView = afterScroll;
    host.querySelector<HTMLElement>('[data-channel-id="read"]')!.scrollIntoView = readScroll;
    await click(above); await click(below);
    expect(beforeScroll).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(afterScroll).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(readScroll).not.toHaveBeenCalled();
    await click([...host.querySelectorAll<HTMLElement>("button")].find(button => button.textContent === "Authoritative read update")!);
    expect(host.querySelector('[data-testid="above"]')).toBeNull();
    expect(host.querySelector('[data-testid="below"]')).toBeNull();
  });

  it("reacts to actual intersection observations instead of keeping a stale offscreen count", async () => {
    const host = await render(<Sidebar />);
    const observer = intersections.at(-1)!;
    const row = host.querySelector<HTMLElement>('[data-channel-id="after"]')!;
    const rect = row.getBoundingClientRect();
    await act(async () => observer.callback([{target: row, isIntersecting: true, boundingClientRect:rect,
      intersectionRatio:1, intersectionRect:rect, rootBounds:rect, time:0}], {} as IntersectionObserver));
    await settle();
    expect(host.querySelector('[data-testid="below"]')).toBeNull();
    expect(host.querySelector('[data-testid="above"]')).not.toBeNull();
  });

  it("counts duplicated channel destinations once and omits an offscreen duplicate if another is visible", () => {
    const root = document.createElement("div");
    const row = (id: string, top: string) => { const element = document.createElement("button"); element.dataset.channelId = id; element.dataset.top = top; return element; };
    expect(deriveUnreadOverflow([
      {element:row("duplicate", "-30"),isIntersecting:false},
      {element:row("duplicate", "-20"),isIntersecting:false},
      {element:row("visible", "160"),isIntersecting:false},
      {element:row("visible", "30"),isIntersecting:true},
    ], root)).toEqual({unreadAboveCount:1, unreadBelowCount:0, unreadAboveChannelIds:["duplicate"], unreadBelowChannelIds:[]});
  });

  it("uses the same Chinese default vocabulary without changing original pill layout", async () => {
    setLocale("zh-CN");
    const host = await render(<Sidebar />);
    expect(host.querySelector('[data-testid="above"]')?.getAttribute("aria-label")).toBe("上方1 项未读");
    expect(host.querySelector('[data-testid="below"]')?.textContent).toBe("1 项未读");
    expect(host.querySelector('[data-testid="below"]')?.parentElement?.classList.contains("bottom-full")).toBe(true);
  });
});
