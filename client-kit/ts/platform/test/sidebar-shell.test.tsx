import { act, createRef, useState } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../src/i18n";
import { SidebarProvider, SidebarTrigger } from "../src/react/sidebar/sidebar";
import { AppSidebarFrame } from "../src/react/sidebar/app-sidebar-frame";
import { AppSidebarPrimaryMenu } from "../src/react/sidebar/app-sidebar-primary-menu";
import { SidebarProfileCard } from "../src/react/sidebar/sidebar-profile-card";
import { click, render, settle } from "./render";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(),
  })) });
});
beforeEach(() => setLocale("en"));

describe("shared original sidebar shell", () => {
  it.each([false, true])("retains original wheel boundaries and cleans up with host ref=%s", async (externalRef) => {
    const scrollRef = createRef<HTMLDivElement>();
    function Host() {
      const [mounted, setMounted] = useState(true);
      return <SidebarProvider><button onClick={() => setMounted(false)}>Unmount sidebar</button>
        {mounted ? <AppSidebarFrame footer={null} scrollRef={externalRef ? scrollRef : undefined}>
          <span>Channels</span>
        </AppSidebarFrame> : null}
      </SidebarProvider>;
    }
    const host = await render(<Host />);
    const content = host.querySelector<HTMLDivElement>("[data-sidebar=content]")!;
    if (externalRef) expect(scrollRef.current).toBe(content);
    Object.defineProperties(content, {
      scrollHeight: { configurable: true, value: 500 },
      clientHeight: { configurable: true, value: 100 },
    });
    const parentWheel = vi.fn();
    host.addEventListener("wheel", parentWheel);
    function wheel(deltaY: number) {
      const event = new WheelEvent("wheel", { deltaY, deltaX: 10, bubbles: true, cancelable: true });
      content.dispatchEvent(event);
      return event.defaultPrevented;
    }
    content.scrollTop = 0;
    expect(wheel(-1)).toBe(true);
    expect(parentWheel).not.toHaveBeenCalled();
    content.scrollTop = 399.5;
    expect(wheel(1)).toBe(true);
    expect(content.scrollTop).toBe(400);
    content.scrollTop = 200;
    expect(wheel(1)).toBe(false);
    expect(wheel(-1)).toBe(false);
    expect(wheel(0)).toBe(false);
    Object.defineProperty(content, "scrollHeight", { value: 100 });
    expect(wheel(1)).toBe(true);
    await click([...host.querySelectorAll("button")].find((item) => item.textContent === "Unmount sidebar")!);
    expect(wheel(1)).toBe(false);
    if (externalRef) expect(scrollRef.current).toBeNull();
  });
  it("keeps the Chinese Inbox label connected to the same host action", async () => {
    setLocale("zh-CN");
    const home = vi.fn();
    const host = await render(<SidebarProvider><AppSidebarPrimaryMenu onNewMessage={vi.fn()}
      onSelectHome={home} onSelectPlatformSection={vi.fn()} homeBadgeCount={0}
      selectedView="platform" selectedPlatformSection="workflows" /></SidebarProvider>);
    await click([...host.querySelectorAll("button")].find((item) => item.textContent === "收件箱收件箱")!);
    expect(home).toHaveBeenCalledOnce();
  });
  it("retains the original collapse control, keyboard shortcut, resize rail and content slots", async () => {
    const host = await render(<SidebarProvider><SidebarTrigger /><AppSidebarFrame
      pinnedHeader={<span>search host</span>} above={<span>unread above</span>} below={<span>unread below</span>}
      footer={<span>profile host</span>}><span>authorized channels</span></AppSidebarFrame></SidebarProvider>);
    const sidebar = host.querySelector("[data-state=expanded]");
    expect(sidebar).not.toBeNull();
    expect(host.querySelector("[data-sidebar=rail]")).not.toBeNull();
    expect(host.querySelector("[data-testid=sidebar-scroll-content]")?.textContent).toContain("authorized channels");
    await click(host.querySelector<HTMLButtonElement>("[data-sidebar=trigger]")!);
    expect(sidebar?.getAttribute("data-state")).toBe("collapsed");
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", {key: "s", ctrlKey: true, bubbles: true})));
    expect(sidebar?.getAttribute("data-state")).toBe("expanded");
    expect(host.textContent).toContain("unread below");
    expect(host.querySelector("[data-sidebar=footer]")?.textContent).toContain("profile host");
  });

  it("connects original new-message, inbox and governed navigation callbacks", async () => {
    const newMessage = vi.fn(); const home = vi.fn(); const select = vi.fn();
    const host = await render(<SidebarProvider><AppSidebarPrimaryMenu onNewMessage={newMessage}
      onSelectHome={home} onSelectPlatformSection={select} homeBadgeCount={3}
      selectedPlatformSection="workflows" selectedView="platform" /></SidebarProvider>);
    await click(host.querySelector<HTMLButtonElement>("[data-testid=sidebar-new-message]")!);
    await click([...host.querySelectorAll("button")].find((item) => item.textContent === "InboxInbox")!);
    expect(newMessage).toHaveBeenCalledOnce();
    expect(home).toHaveBeenCalledOnce();
    expect(host.querySelector("[data-testid=sidebar-home-count]")?.textContent).toBe("3");
    expect(host.querySelector("[data-testid=sidebar-platform-workflows]")?.getAttribute("data-active")).toBe("true");
    await click(host.querySelector<HTMLButtonElement>("[data-testid=sidebar-platform-workflows]")!);
    expect(select).toHaveBeenCalledWith("workflows");
  });

  it("uses the original avatar/name card and profile popover to invoke real sign-out", async () => {
    const signOut = vi.fn();
    const host = await render(<SidebarProfileCard communityLabel="Actual community" resolvedDisplayName="Actual person"
      avatar={<span>avatar host</span>} popoverAvatar={<span>popover avatar host</span>}
      onOpenSettings={vi.fn()} onSignOut={signOut} />);
    await click(host.querySelector<HTMLButtonElement>("[data-testid=sidebar-profile-avatar-button]")!);
    await settle();
    expect(document.querySelector("[data-testid=profile-popover]")?.textContent).toContain("Actual person");
    await click(document.querySelector<HTMLButtonElement>("[data-testid=profile-popover-sign-out]")!);
    expect(signOut).toHaveBeenCalledOnce();
  });
});
