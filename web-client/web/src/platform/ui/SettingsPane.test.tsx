// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPane, WorkspaceNotifications } from "./SettingsPane";
import { setLocale } from "@client-kit/platform/i18n";
import { PlatformProvider } from "@client-kit/platform/react/context";
import { createBffClient } from "@client-kit/platform/client";
import { SidebarProvider } from "@client-kit/platform/react/sidebar/sidebar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
