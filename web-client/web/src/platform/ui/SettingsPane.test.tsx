// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPane, WorkspaceNotifications } from "./SettingsPane";
import { setLocale } from "@client-kit/platform/i18n";
import { PlatformProvider } from "@client-kit/platform/react/context";
import { createBffClient } from "@client-kit/platform/client";
import { SidebarProvider } from "@client-kit/platform/react/sidebar/sidebar";
import { npubEncode } from "nostr-tools/nip19";

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

const state = vi.hoisted(() => ({
  workspaces: {
    isSuccess: true,
    isError: false,
    isFetching: false,
    data: [{ id: "workspace-a", name: "A" }],
  },
  preferences: {
    isSuccess: true,
    isError: false,
    isFetching: false,
    data: {
      version: 7,
      workspacePreferences: { "workspace-a": { starred: true, muted: false } },
    },
  },
  write: vi.fn(),
  invalidate: vi.fn(),
  mutate: null as
    null | ((input: { id: string; muted: boolean }) => Promise<void>),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: string[] }) =>
    options.queryKey[1] === "workspaces" ? state.workspaces : state.preferences,
  useQueryClient: () => ({ invalidateQueries: state.invalidate }),
  useMutation: (options: { mutationFn: typeof state.mutate }) => {
    state.mutate = options.mutationFn;
    return { isError: false, isPending: false, mutate: (input: { id: string; muted: boolean }) => { void options.mutationFn?.(input); } };
  },
}));
vi.mock("@/platform/bff-client", () => ({
  bff: { workspaces: vi.fn() },
  fetchUserState: vi.fn(),
  setWorkspacePreference: state.write,
}));
vi.mock("@/shared/i18n", () => ({ getLocale: () => "en" }));
vi.mock("@/shared/theme/ThemeProvider", () => ({
  useTheme: () => ({ themeName: "buzz", selectedThemeName: "buzz", isDark: false, isLoading: false, followSystem: true, accentColor: "neutral", hasPair: true, setTheme: vi.fn(), setAccentColor: vi.fn(), setFollowSystem: vi.fn(), applyAppearance: vi.fn(), prominentActiveTab: false, setProminentActiveTab: vi.fn() }),
}));

beforeEach(() => {
  setLocale("en");
  state.write.mockReset().mockResolvedValue({ version: 8 });
  state.invalidate.mockReset().mockResolvedValue(undefined);
  state.workspaces.isSuccess = true;
  state.workspaces.isError = false;
  state.workspaces.isFetching = false;
  state.preferences.isSuccess = true;
  state.preferences.isError = false;
  state.preferences.isFetching = false;
});
describe("Web settings existing user-state CAS consumer", () => {
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
      expect(host.querySelectorAll('[data-shortcut]')).toHaveLength(9);
      expect(host.querySelector('[data-shortcut="close-dialog"]')).not.toBeNull();
      expect(host.querySelector('[data-shortcut="format-link"]')).not.toBeNull();
      expect(host.textContent).toContain("Formatting");
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });
  it("writes exact workspace/current version while preserving the existing star", async () => {
    renderToStaticMarkup(<WorkspaceNotifications />);
    await state.mutate!({ id: "workspace-a", muted: true });
    expect(state.write).toHaveBeenCalledExactlyOnceWith("workspace-a", {
      starred: true,
      muted: true,
      version: 7,
    });
    expect(state.invalidate).toHaveBeenCalledOnce();
  });
  it("never writes an unlisted workspace or unverified preference snapshot", async () => {
    renderToStaticMarkup(<WorkspaceNotifications />);
    await state.mutate!({ id: "workspace-b", muted: true });
    state.preferences.isSuccess = false;
    await state.mutate!({ id: "workspace-a", muted: true });
    expect(state.write).not.toHaveBeenCalled();
  });
  it("refetches after a lost response without replaying the write", async () => {
    state.write.mockRejectedValue(new Error("private native detail"));
    renderToStaticMarkup(<WorkspaceNotifications />);
    await expect(
      state.mutate!({ id: "workspace-a", muted: true }),
    ).rejects.toThrow();
    expect(state.write).toHaveBeenCalledTimes(1);
    expect(state.invalidate).toHaveBeenCalledOnce();
  });
  it("does not turn failed reads into unmuted defaults", () => {
    state.preferences.isSuccess = false;
    state.preferences.isError = true;
    const markup = renderToStaticMarkup(<WorkspaceNotifications />);
    expect(markup).not.toContain('role="switch"');
    expect(markup).not.toContain("private native detail");
    expect(markup).toContain('role="status"');
  });
  it("uses the original settings switch without changing the authoritative mute state", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<WorkspaceNotifications />));
      expect(host.querySelector('[data-slot="settings-section-card"]')).not.toBeNull();
      const toggle = host.querySelector<HTMLButtonElement>('[role="switch"]')!;
      expect(toggle.getAttribute("aria-checked")).toBe("false");
      expect(host.querySelector('label[for="workspace-mute-workspace-a"]')).not.toBeNull();
      await act(async () => toggle.click());
      expect(state.write).toHaveBeenCalledExactlyOnceWith("workspace-a", { muted: true, starred: true, version: 7 });
      expect(state.invalidate).toHaveBeenCalledOnce();
      expect(toggle.getAttribute("aria-checked")).toBe("false");
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
