// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPane } from "./SettingsPane";
import { setLocale } from "@client-kit/platform/i18n";
import { PlatformProvider } from "@client-kit/platform/react/context";
import { createBffClient } from "@client-kit/platform/client";
import { SidebarProvider } from "@client-kit/platform/react/sidebar/sidebar";
import { npubEncode } from "nostr-tools/nip19";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserNotificationsProvider } from "./BrowserNotifications";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const copyFeedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: copyFeedback }));

vi.mock("@client-kit/platform/react/custom-emoji", async (original) => ({
  ...await original<typeof import("@client-kit/platform/react/custom-emoji")>(),
  // Exercise the real settings host's mount lifetime; the real write controller
  // and UNKNOWN/refusal behavior are covered by custom-emoji.test.tsx.
  CustomEmojiSettingsCard: () => {
    const [pending, setPending] = useState(false);
    return <button data-testid="emoji-pending-probe" onClick={() => setPending(true)}>{pending ? "UNKNOWN" : "empty"}</button>;
  },
}));

vi.mock("@client-kit/platform/react/context", async (original) => ({
  ...await original<typeof import("@client-kit/platform/react/context")>(),
  useBffClient: () => ({ invitations: async () => [], profile: async () => ({ pubkey: "a".repeat(64), eventId: null, displayName: null, about: null, avatarUrl: null, nip05Handle: null, avatarMediaPaths: {} }) }),
}));

vi.mock("@/platform/bff-client", () => ({ bff: { workspaces: vi.fn(), profile: vi.fn(async () => ({ pubkey: "a".repeat(64) })) }, fetchUserState: vi.fn() }));
vi.mock("@/shared/i18n", () => ({ getLocale: () => "en" }));
vi.mock("@/shared/theme/ThemeProvider", () => ({
  useTheme: () => ({ themeName: "buzz", selectedThemeName: "buzz", isDark: false, isLoading: false, followSystem: true, accentColor: "neutral", hasPair: true, setTheme: vi.fn(), setAccentColor: vi.fn(), setFollowSystem: vi.fn(), applyAppearance: vi.fn(), prominentActiveTab: false, setProminentActiveTab: vi.fn() }),
}));

beforeEach(() => { setLocale("en"); });
describe("Web original settings host", () => {
  it("renders one original notification page without the invented workspace settings block", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true }));
    vi.stubGlobal("Notification", class { static permission = "granted"; static requestPermission = vi.fn(); });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const client = createBffClient({ send: async () => ({ status: 200, body: [] }) });
    try {
      await act(async () => root.render(<QueryClientProvider client={queryClient}><PlatformProvider client={client} locale="en"><BrowserNotificationsProvider principalId="current"><SidebarProvider><SettingsPane /></SidebarProvider></BrowserNotificationsProvider></PlatformProvider></QueryClientProvider>));
      await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="settings-nav-notifications"]')!.click());
      expect(host.querySelectorAll('[data-testid="settings-notifications"]')).toHaveLength(1);
      expect(host.querySelector('[data-testid="workspace-notifications"]')).toBeNull();
      expect(host.querySelector('[data-testid="notifications-desktop-toggle"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="notifications-home-badge-toggle"]')).not.toBeNull();
      expect(host.textContent).not.toContain("Workspace notifications");
      expect(Notification.requestPermission).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      queryClient.clear();
      host.remove();
      vi.unstubAllGlobals();
    }
  });
  it("keeps a visited emoji controller through category switches but not authenticated scope replacement", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true }));
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const client = createBffClient({ send: async () => ({ status: 200, body: [] }) });
    const page = (scope: string) => <PlatformProvider client={client} locale="en"><SidebarProvider><SettingsPane key={scope} /></SidebarProvider></PlatformProvider>;
    try {
      await act(async () => root.render(page("tenant:principal:session-1")));
      expect(host.querySelector('[data-testid="emoji-pending-probe"]')).toBeNull();
      await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="settings-nav-custom-emoji"]')!.click());
      const pending = host.querySelector<HTMLButtonElement>('[data-testid="emoji-pending-probe"]')!;
      await act(async () => pending.click());
      await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="settings-nav-appearance"]')!.click());
      expect(host.querySelector('[data-testid="emoji-pending-probe"]')).toBe(pending);
      expect(pending.closest("[hidden]")).not.toBeNull();
      await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="settings-nav-custom-emoji"]')!.click());
      expect(pending.textContent).toBe("UNKNOWN");
      expect(pending.closest("[hidden]")).toBeNull();
      await act(async () => root.render(page("tenant:principal:session-2")));
      expect(host.contains(pending)).toBe(false);
      await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="settings-nav-custom-emoji"]')!.click());
      expect(host.querySelector('[data-testid="emoji-pending-probe"]')?.textContent).toBe("empty");
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });
  it.each(["en", "zh-CN"] as const)("copies the original public identity on HTTP and reports real refusal in %s", async (locale) => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true }));
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const commandDescriptor = Object.getOwnPropertyDescriptor(document, "execCommand");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    const copy = vi.fn(() => {
      const field = document.activeElement as HTMLTextAreaElement;
      expect(field.tagName).toBe("TEXTAREA");
      expect(field.value).toBe(npubEncode("a".repeat(64)));
      expect(field.selectionStart).toBe(0);
      expect(field.selectionEnd).toBe(field.value.length);
      return true;
    });
    Object.defineProperty(document, "execCommand", { configurable: true, value: copy });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    copyFeedback.success.mockReset();
    copyFeedback.error.mockReset();
    try {
      const client = createBffClient({ send: async () => ({ status: 200, body: [] }) });
      await act(async () => root.render(<PlatformProvider client={client} locale={locale}><SidebarProvider><SettingsPane /></SidebarProvider></PlatformProvider>));
      const button = host.querySelector<HTMLButtonElement>('[data-testid="copy-profile-pubkey"]')!;
      button.focus();
      const textareas = document.querySelectorAll("textarea").length;
      await act(async () => button.click());
      expect(copy).toHaveBeenCalledExactlyOnceWith("copy");
      expect(copyFeedback.success).toHaveBeenCalledExactlyOnceWith(locale === "en" ? "Copied to clipboard" : "已复制到剪贴板");
      expect(copyFeedback.error).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(button);
      expect(document.querySelectorAll("textarea")).toHaveLength(textareas);

      copy.mockReturnValueOnce(false);
      await act(async () => button.click());
      expect(copyFeedback.error).toHaveBeenLastCalledWith(locale === "en" ? "Could not copy to clipboard" : "未能复制到剪贴板");
      expect(copyFeedback.success).toHaveBeenCalledTimes(1);
      expect(document.querySelectorAll("textarea")).toHaveLength(textareas);

      copy.mockImplementationOnce(() => { throw new Error("private browser detail"); });
      await act(async () => button.click());
      expect(copyFeedback.error).toHaveBeenCalledTimes(2);
      expect(copyFeedback.success).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(button);
      expect(document.querySelectorAll("textarea")).toHaveLength(textareas);

      const writeText = vi.fn().mockRejectedValue(new Error("permission denied"));
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
      await act(async () => button.click());
      expect(writeText).toHaveBeenCalledExactlyOnceWith(npubEncode("a".repeat(64)));
      expect(copy).toHaveBeenCalledTimes(3);
      expect(copyFeedback.error).toHaveBeenCalledTimes(3);
      expect(copyFeedback.success).toHaveBeenCalledTimes(1);
      writeText.mockResolvedValueOnce(undefined);
      await act(async () => button.click());
      expect(copyFeedback.success).toHaveBeenCalledTimes(2);
      expect(copy).toHaveBeenCalledTimes(3);
      expect(host.textContent).not.toContain("private browser detail");
    } finally {
      await act(async () => root.unmount());
      host.remove();
      if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
      else Reflect.deleteProperty(navigator, "clipboard");
      if (commandDescriptor) Object.defineProperty(document, "execCommand", commandDescriptor);
      else Reflect.deleteProperty(document, "execCommand");
      vi.unstubAllGlobals();
    }
  });
  it("opens original Profile first and retains the same Buzz appearance controls", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true }));
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      const client=createBffClient({send:async()=>({status:200,body:[]})});
      const close = vi.fn();
      await act(async () => root.render(<PlatformProvider client={client} locale="en"><SidebarProvider><SettingsPane onClose={close} /></SidebarProvider></PlatformProvider>));
      const back = host.querySelector<HTMLButtonElement>('[data-testid="settings-back-to-app"]')!;
      expect(back.textContent).toBe("Back to app");
      await act(async () => back.click());
      expect(close).toHaveBeenCalledOnce();
      expect(host.querySelector('[data-testid="settings-profile"]')).not.toBeNull();
      const appearance = host.querySelector<HTMLButtonElement>('[data-testid="settings-nav-appearance"]');
      expect(appearance).not.toBeNull();
      await act(async () => appearance!.click());
      const markup = host.innerHTML;
      expect(markup).toContain('data-testid="conversation-display-group"');
      expect(markup).toContain('data-testid="prominent-active-tab-toggle"');
      expect(markup).toContain('role="switch"');
      expect(markup).toContain('data-testid="font-size-larger"');
      expect(markup).toContain('data-testid="conversation-density-spacious"');
      expect(markup).toContain('data-testid="thread-layout-control"');
      expect(host.querySelector<HTMLButtonElement>('[data-testid="glass-background-toggle"]')!.disabled).toBe(true);
      expect(host.querySelector('[data-testid="glass-background-row"]')?.textContent).toContain("Available in the macOS desktop app.");
      expect(markup).not.toMatch(/private.key|provider.credential|pairing/i);
      expect(host.querySelector('[data-sidebar="group"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="settings-content-surface"]')).not.toBeNull();
      await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="settings-nav-shortcuts"]')!.click());
      expect(host.querySelectorAll('[data-shortcut]')).toHaveLength(12);
      expect(host.querySelector('[data-shortcut="close-dialog"]')).not.toBeNull();
      expect(host.querySelector('[data-shortcut="format-link"]')).not.toBeNull();
      expect(host.textContent).toContain("Formatting");
      expect(host.textContent).toContain("Zoom");
      for (const id of ["zoom-in", "zoom-out", "zoom-reset"]) {
        expect(host.querySelector(`[data-shortcut="${id}"]`)).not.toBeNull();
      }
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });
});
