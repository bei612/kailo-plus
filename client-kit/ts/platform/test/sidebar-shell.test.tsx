import { act, createRef, useState } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../src/i18n";
import { SidebarProvider, SidebarTrigger } from "../src/react/sidebar/sidebar";
import { AppSidebarFrame } from "../src/react/sidebar/app-sidebar-frame";
import { AppSidebarPrimaryMenu } from "../src/react/sidebar/app-sidebar-primary-menu";
import { SidebarProfileCard } from "../src/react/sidebar/sidebar-profile-card";
import { click, render, settle } from "./render";
import { ExperimentalFeaturesCard } from "../src/react/settings";
import { OVERRIDES_KEY, getOverrides, setOverride } from "../src/react/features/store";
import { emitChange, usePreviewFeatureWarning } from "../src/react/features/useFeatureEnabled";
import { toast } from "sonner";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(),
  })) });
});
beforeEach(() => { localStorage.removeItem(OVERRIDES_KEY); emitChange(); setLocale("en"); });

describe("shared original sidebar shell", () => {
  it.each(["en", "zh-CN"] as const)("retains the original empty-identity fallback in %s", async (locale) => {
    setLocale(locale);
    const expected = locale === "zh-CN" ? "当前身份" : "Current identity";
    const host = await render(<SidebarProfileCard communityLabel="Actual community" resolvedDisplayName="   "
      avatar={<span>avatar host</span>} popoverAvatar={<span>popover avatar host</span>}
      onOpenSettings={vi.fn()} onSignOut={vi.fn()} />);
    expect(host.querySelector('[data-testid="sidebar-profile-name"]')?.textContent).toBe(expected);
    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="sidebar-profile-avatar-button"]')!;
    expect(trigger.getAttribute("aria-label")).toContain(expected);
    await click(trigger);
    await settle();
    expect(document.querySelector('[data-testid="profile-popover"]')?.textContent).toContain(expected);
  });
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
    const host = await render(<SidebarProvider><AppSidebarPrimaryMenu
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

  it("restores original Inbox-first primary menu and Zap without an invented new-message row", async () => {
    setOverride("workflows", true);
    const home = vi.fn(); const select = vi.fn();
    const host = await render(<SidebarProvider><AppSidebarPrimaryMenu
      onSelectHome={home} onSelectPlatformSection={select} homeBadgeCount={3}
      selectedPlatformSection="workflows" selectedView="platform" /></SidebarProvider>);
    const primary = host.querySelector("[data-testid=sidebar-primary-menu]")!;
    expect(primary.querySelector("[data-testid=sidebar-new-message]")).toBeNull();
    expect(primary.querySelector("[data-sidebar=menu-button]")?.textContent).toBe("InboxInbox");
    expect(primary.querySelector("[data-testid=sidebar-platform-workflows] svg")?.classList.contains("lucide-zap")).toBe(true);
    expect(primary.querySelector("[data-testid=sidebar-platform-workflows] svg")?.classList.contains("lucide-workflow")).toBe(false);
    await click([...host.querySelectorAll("button")].find((item) => item.textContent === "InboxInbox")!);
    expect(home).toHaveBeenCalledOnce();
    expect(host.querySelector("[data-testid=sidebar-home-count]")?.textContent).toBe("3");
    expect(host.querySelector("[data-testid=sidebar-platform-workflows]")?.getAttribute("data-active")).toBe("true");
    await click(host.querySelector<HTMLButtonElement>("[data-testid=sidebar-platform-workflows]")!);
    expect(select).toHaveBeenCalledWith("workflows");
  });

  it.each(["en", "zh-CN"] as const)("connects the original four Experiments switches to actual sidebar entries and persists them in %s", async (locale) => {
    setLocale(locale);
    const select = vi.fn();
    const host = await render(<SidebarProvider><ExperimentalFeaturesCard /><AppSidebarPrimaryMenu
      onSelectHome={vi.fn()} onSelectPlatformSection={select} selectedView="home" selectedPlatformSection={null}
      projectsSection={<div data-testid="actual-project-subtree">original project subtree</div>} /></SidebarProvider>);
    expect(host.querySelectorAll('[role="switch"]')).toHaveLength(4);
    expect(host.querySelector('[data-testid="feature-toggle-agentManagedProfiles"]')).toBeNull();
    for (const id of ["pulse", "projects", "workflows"]) expect(host.querySelector(`[data-testid="sidebar-platform-${id}"]`)).toBeNull();
    expect(host.querySelector('[data-testid="actual-project-subtree"]')).toBeNull();
    expect(host.textContent).toContain(locale === "en" ? "Experiments" : "实验功能");
    for (const id of ["workflows", "projects", "pulse", "forum"]) {
      const control = host.querySelector<HTMLButtonElement>(`[data-testid="feature-toggle-${id}"]`)!;
      expect(control.getAttribute("aria-checked")).toBe("false");
      await click(control);
      expect(control.getAttribute("aria-checked")).toBe("true");
    }
    expect(getOverrides()).toEqual({ workflows: true, projects: true, pulse: true, forum: true });
    for (const id of ["pulse", "projects", "workflows"]) {
      await click(host.querySelector<HTMLButtonElement>(`[data-testid="sidebar-platform-${id}"]`)!);
      expect(select).toHaveBeenLastCalledWith(id);
    }
    expect(host.querySelector('[data-testid="actual-project-subtree"]')).not.toBeNull();
    await click(host.querySelector<HTMLButtonElement>('[data-testid="feature-toggle-projects"]')!);
    expect(host.querySelector('[data-testid="sidebar-platform-projects"]')).toBeNull();
    expect(host.querySelector('[data-testid="actual-project-subtree"]')).toBeNull();
    const reopened = await render(<ExperimentalFeaturesCard />);
    expect(reopened.querySelector('[data-testid="feature-toggle-projects"]')?.getAttribute("aria-checked")).toBe("false");
    expect(reopened.querySelector('[data-testid="feature-toggle-pulse"]')?.getAttribute("aria-checked")).toBe("true");
  });

  it("reacts to original cross-window storage updates and filters malformed/unknown overrides", async () => {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify({ pulse: "true", projects: 1, invented: true }));
    expect(getOverrides()).toEqual({});
    const host = await render(<SidebarProvider><AppSidebarPrimaryMenu onSelectHome={vi.fn()}
      onSelectPlatformSection={vi.fn()} selectedView="home" selectedPlatformSection={null} /></SidebarProvider>);
    expect(host.querySelector('[data-testid="sidebar-platform-pulse"]')).toBeNull();
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify({ pulse: true }));
    await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: OVERRIDES_KEY })));
    expect(host.querySelector('[data-testid="sidebar-platform-pulse"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="sidebar-platform-agents"]')).not.toBeNull();
    localStorage.setItem(OVERRIDES_KEY, "[]");
    await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: OVERRIDES_KEY })));
    expect(host.querySelector('[data-testid="sidebar-platform-pulse"]')).toBeNull();
  });

  it("keeps a disabled preview's direct page available with the original localized warning, not a permission downgrade", async () => {
    setLocale("zh-CN");
    const warning = vi.spyOn(toast, "warning").mockReturnValue("warning");
    function DirectProjectPage() {
      usePreviewFeatureWarning("projects");
      return <div data-testid="direct-original-project">existing original project consumer</div>;
    }
    try {
      const host = await render(<DirectProjectPage />);
      expect(host.querySelector('[data-testid="direct-original-project"]')).not.toBeNull();
      await vi.waitFor(() => expect(warning).toHaveBeenCalledWith("项目是一项预览功能。请在设置 → 实验功能中启用，以便在侧栏中显示。"));
      warning.mockClear();
      setOverride("projects", true);
      await act(async () => emitChange());
      expect(host.querySelector('[data-testid="direct-original-project"]')).not.toBeNull();
      expect(warning).not.toHaveBeenCalled();
    } finally { warning.mockRestore(); }
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
