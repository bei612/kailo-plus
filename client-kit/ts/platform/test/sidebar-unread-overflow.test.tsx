import { act, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../src/i18n";
import { MoreUnreadButton } from "../src/react/sidebar/MoreUnreadButton";
import { deriveUnreadOverflow, useUnreadOverflow } from "../src/react/sidebar/useUnreadOverflow";
import { click, render, settle } from "./render";

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
