// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlatformApp } from "./PlatformApp";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no layout observers; the restored sidebar's unread overflow uses them.
class NoopObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
for (const name of ["IntersectionObserver", "ResizeObserver"] as const)
  if (!(name in globalThis)) Object.assign(globalThis, { [name]: NoopObserver });
if (typeof window.matchMedia !== "function")
  window.matchMedia = (query: string) => ({ matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false });
const state = vi.hoisted(() => ({ accessMode: "FULL" }));
// PlatformApp reads its section from the TanStack-backed platform navigation. A small
// stateful stand-in keeps the real shell (settings shortcut, settingsReturn) under test.
const nav = vi.hoisted(() => {
  const store = { tab: "channel", workspaceId: "workspace-b" as string | null, listeners: new Set<() => void>(),
    navigate(tab: string, workspaceId?: string | null) {
      store.tab = tab;
      if (workspaceId !== undefined) store.workspaceId = workspaceId;
      store.listeners.forEach((listener) => listener());
      return Promise.resolve();
    } };
  return store;
});
const navigate = (tab: string, workspaceId?: string | null) => nav.navigate(tab, workspaceId);
vi.mock("@tanstack/react-router", () => ({ useBlocker: () => ({ status: "idle" }) }));
vi.mock("@/app/platform-navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    usePlatformNavigation: () => {
      const tab = useSyncExternalStore((listener) => { nav.listeners.add(listener); return () => { nav.listeners.delete(listener); }; },
        () => nav.tab);
      return { tab, workspaceId: nav.workspaceId, conversationId: null, messageTarget: undefined,
        openTab: (next: string, workspaceId?: string | null) => nav.navigate(next, workspaceId ?? nav.workspaceId),
        openChannel: (workspaceId: string) => nav.navigate("channel", workspaceId),
        openConversation: vi.fn(), openApplication: vi.fn(), openProject: vi.fn() };
    },
  };
});
// Sidebar, dialog and header consumers this test does not exercise (as in PlatformApp.test).
vi.mock("./SidebarProjects", () => ({ SidebarProjects: () => null }));
vi.mock("./ConversationSidebar", () => ({ ConversationSidebar: () => null }));
vi.mock("@/platform/ui/ChannelSidebar", () => ({ ChannelSidebar: () => null }));
vi.mock("@client-kit/platform/react/create-channel-dialog", () => ({ CreateChannelDialog: () => null }));
vi.mock("@client-kit/platform/react/channel-browser", () => ({ ChannelBrowser: () => null, ChannelJoinButton: () => null }));
vi.mock("@client-kit/platform/react/channel-members", () => ({ ChannelMembersBar: () => null, ChannelMembersDialog: () => null }));
vi.mock("@client-kit/platform/react/channel-management-sheet", () => ({ ChannelManagementSheet: () => null }));
vi.mock("./SidebarProfileCard", () => ({
  WebSidebarProfileCard: ({ onOpenSettings }: { onOpenSettings: () => void }) =>
    <button data-testid="sidebar-settings" onClick={onOpenSettings} />,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: string[] }) => ({
    data:
      options.queryKey[1] === "workspaces"
        ? [
            { id: "workspace-a", name: "A", isMember: true },
            { id: "workspace-b", name: "B", isMember: true },
          ]
        : options.queryKey[1] === "channel-descriptor"
          ? { channelId: "native-stream", channelType: "stream", name: "B" }
        : options.queryKey[2] === "search-directory"
          ? { channels: [], labels: {}, workspaces: [] }
          : String(options.queryKey[2] ?? "").startsWith("search-")
            ? []
            : { workspacePreferences: {} },
    isError: false,
    isPending: false,
  }),
  useMutation: () => ({ mutate: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@client-kit/platform/react/protocol-document-bridge", () => ({
  ProtocolDocumentBridge: ({ bindingId }: { bindingId: string }) => (
    <div data-document-binding={bindingId} />
  ),
}));
vi.mock("@client-kit/platform/react/governance", () => ({
  LifecycleRestrictedView: () => <div data-testid="shared-lifecycle-restricted" />,
  TasksPage: () => null,
  ApprovalsPage: () => null,
}));
vi.mock("@client-kit/platform/react/pages", () => ({
  NativeApplicationEntries: () => null,
  WorkspaceManagementPanels: () => <div data-testid="shared-management-panels" />,
  MembersPane: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="workspace-members" data-workspace={workspaceId} />
  ),
  AgentDefinitionsPage: () => null,
  AuditPage: () => null,
  DevicesPage: () => null,
}));
vi.mock("@client-kit/platform/react/invitations", () => ({
  TenantInvitations: () => <div data-testid="tenant-invitations" />,
  RedemptionProgress: () => null,
}));
vi.mock("@/platform/ui/ChannelPane", () => ({
  ChannelPane: () => <div data-testid="channel-content" />,
}));
vi.mock("@/platform/ui/InboxPane", () => ({
  InboxPane: () => <div data-testid="inbox-content" />,
}));
vi.mock("@/platform/ui/SettingsPane", () => ({
  // The settings layer stays mounted and is shown only while active (as in PlatformApp.test).
  SettingsPane: ({ active }: { active: boolean }) => active ? <div data-testid="settings-content" /> : null,
}));
vi.mock("@/shared/i18n", () => ({ getLocale: () => "en", t: (key: string) => key }));
vi.mock("@/shared/theme/ThemeProvider", () => ({ useTheme: () => ({ isDark: true }) }));
vi.mock("@/platform/bff-client", () => ({
  // The real PlatformProvider receives this client. Reads this test does not exercise stay
  // pending (loading UI) instead of each shell dependency needing its own stub.
  bff: new Proxy({
    workspaces: vi.fn(),
    session: async () => ({
      tenantPrincipalId: "human-a",
      currentWorkspaceId: "workspace-b",
      accessMode: state.accessMode,
    }),
  } as Record<string, unknown>, { get: (known, key) => typeof key === "string" && key in known ? known[key] : () => new Promise(() => {}) }),
  // The shell provides the real host to ConversationVisibilityProvider; settings never reads it.
  conversationVisibility: { read: vi.fn(), prepare: vi.fn() },
  BffError: class extends Error {},
  fetchUserState: vi.fn(),
  setWorkspacePreference: vi.fn(),
  signOut: vi.fn(),
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  state.accessMode = "FULL";
  nav.tab = "channel";
  nav.workspaceId = "workspace-b";
  nav.listeners.clear();
  window.history.replaceState({}, "", "/app/");
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function open() {
  await act(async () => root.render(<PlatformApp />));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
// Selecting Inbox in the sidebar is a platform navigation to the inbox section.
async function openInboxFromSidebar() {
  await act(async () => { await navigate("inbox"); });
}
async function openSettingsFromSidebar() {
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="sidebar-settings"]')!.click());
}
async function shortcut() {
  const event = new KeyboardEvent("keydown", { key: ",", ctrlKey: true, cancelable: true });
  await act(async () => {
    window.dispatchEvent(event);
  });
  return event;
}
it("opens the actual host settings and closes back to the previously selected Inbox", async () => {
  await open();
  expect(host.querySelector('[data-testid="channel-content"]')).not.toBeNull();
  await openInboxFromSidebar();
  expect(host.querySelector('[data-testid="inbox-content"]')).not.toBeNull();
  expect((await shortcut()).defaultPrevented).toBe(true);
  expect(host.querySelector('[data-testid="settings-content"]')).not.toBeNull();
  await shortcut();
  expect(host.querySelector('[data-testid="inbox-content"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="settings-content"]')).toBeNull();
});
it("closes settings opened by the existing sidebar without resetting Workspace", async () => {
  await open();
  await openSettingsFromSidebar();
  expect(host.querySelector('[data-testid="settings-content"]')).not.toBeNull();
  await shortcut();
  expect(host.querySelector('[data-testid="channel-content"]')).not.toBeNull();
});
it.each(["restricted", "document"])(
  "does not install the application shortcut in the %s host",
  async (mode) => {
    if (mode === "restricted") state.accessMode = "LIFECYCLE_RESTRICTED";
    else
      window.history.replaceState(
        {},
        "",
        "/app/?protocolBinding=dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      );
    await open();
    expect((await shortcut()).defaultPrevented).toBe(false);
    expect(host.querySelector('[data-testid="settings-content"]')).toBeNull();
  },
);
