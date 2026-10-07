// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { PlatformApp } from "./PlatformApp";

const state = vi.hoisted(() => ({ hook: 0, accessMode: "FULL", documentTheme: "", memberA: true, memberB: true, tab: "members", workspaceId: null as string | null, channelEnabled: false }));
vi.mock("@/app/platform-navigation", () => ({
  usePlatformNavigation: () => ({ tab: state.tab, workspaceId: state.workspaceId,
    conversationId: null, messageTarget: null, openTab: vi.fn(), openChannel: vi.fn(), openConversation: vi.fn() }),
}));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = state.hook++;
      return [
        index === 0
          ? {
              tenantPrincipalId: "human-a",
              currentWorkspaceId: "workspace-b",
              accessMode: state.accessMode,
            }
          : initial === "channel"
            ? state.tab
            : typeof initial === "function" ? initial() : initial,
        vi.fn(),
      ];
    },
  };
});
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: string[]; enabled?: boolean }) => {
    if (options.queryKey[1] === "channel-descriptor") state.channelEnabled = options.enabled === true;
    return ({
    data:
      options.queryKey[1] === "workspaces"
        ? [
            { id: "workspace-a", name: "A", isMember: state.memberA },
            { id: "workspace-b", name: "B", isMember: state.memberB },
          ]
        : { workspacePreferences: {} },
    isError: false,
    isPending: false,
  }); },
  useMutation: () => ({ mutate: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@client-kit/platform/react/context", () => ({
  useDeviceLocale: () => "en",
  useUiT: () => (key: string) => key,
  useT: () => (key: string) => key,
  useUiLocale: () => "en",
  PlatformProvider: ({
    children,
    documentTheme,
  }: {
    children: React.ReactNode;
    documentTheme?: string;
  }) => {
    state.documentTheme = documentTheme ?? "";
    return children;
  },
}));
vi.mock("@client-kit/platform/react/protocol-document-bridge", () => ({
  ProtocolDocumentBridge: ({ bindingId }: { bindingId: string }) => (
    <div data-document-binding={bindingId} />
  ),
}));
vi.mock("@client-kit/platform/react/channel-browser", () => ({
  ChannelBrowser: ({ open }: { open: boolean }) => (
    <div data-testid="shared-create-channel-dialog" data-open={open} />
  ),
}));
vi.mock("@client-kit/platform/react/new-message", () => ({
  ConversationVisibilityProvider: ({ children }: { children: React.ReactNode }) => children,
  useConversations: () => ({ items: [], loading: false, error: null, reload: vi.fn() }),
  ConversationList: () => <div data-testid="shared-conversation-list" />,
}));
vi.mock("./NewMessagePage", () => ({ NewMessagePage: () => null }));
vi.mock("./SidebarProfileCard", () => ({
  WebSidebarProfileCard: ({ onOpenSettings }: { onOpenSettings: () => void }) =>
    <button data-testid="sidebar-settings" onClick={onOpenSettings} />,
}));
vi.mock("@client-kit/platform/react/use-inbox-state", () => ({
  useInboxState: () => ({ state: { version: 0, workspacePreferences: {} }, refresh: vi.fn() }),
}));
vi.mock("@/platform/ui/ChannelSidebar", () => ({
  ChannelSidebar: ({ selectedId, workspaces }: { selectedId: string; workspaces: { id: string }[] }) => (
    <div data-testid="shared-channel-sidebar" data-selected={selectedId} data-channels={workspaces.length}>
      <button data-testid="create-channel" />
    </div>
  ),
}));
vi.mock("@client-kit/platform/react/governance", () => ({
  LifecycleRestrictedView: () => <div data-testid="shared-lifecycle-restricted" />,
  TasksPage: () => null,
  ApprovalsPage: () => null,
}));
vi.mock("@client-kit/platform/react/pages", () => ({
  NativeApplicationEntries: () => null,
  WorkspaceManagementPanels: ({ children }: { children: React.ReactNode }) => <div data-testid="shared-management-panels">{children}</div>,
  MembersPane: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="workspace-members" data-workspace={workspaceId} />
  ),
  AuditPage: () => null,
  DevicesPage: () => null,
}));
vi.mock("./AgentDefinitionsPane", () => ({
  AgentDefinitionsPane: ({ workspaceId }: { workspaceId?: string }) => <div data-testid="agents-scope" data-workspace={workspaceId} />,
}));
vi.mock("@client-kit/platform/react/workflows", () => ({
  WorkflowsPage: ({ workspaceId }: { workspaceId?: string }) => <div data-testid="workflows-scope" data-workspace={workspaceId} />,
}));
vi.mock("@client-kit/platform/react/invitations", () => ({
  TenantInvitations: () => <div data-testid="tenant-invitations" />,
  RedemptionProgress: () => null,
}));
vi.mock("@/platform/ui/ChannelPane", () => ({ ChannelPane: () => null }));
vi.mock("@/platform/ui/InboxPane", () => ({ InboxPane: () => null }));
vi.mock("@/platform/ui/SettingsPane", () => ({ SettingsPane: ({ active }: { active: boolean }) => <div data-testid="settings-host" data-active={active} /> }));
vi.mock("./BrowserNotifications", () => ({
  BrowserNotificationsProvider: ({ children }: { children: React.ReactNode }) => children,
  useBrowserNotifications: () => null,
}));
vi.mock("@/shared/i18n", () => ({ getLocale: () => "en", t: (key: string) => key }));
vi.mock("@/shared/theme/ThemeProvider", () => ({ useTheme: () => ({ isDark: true }) }));
vi.mock("@/platform/bff-client", () => ({
  bff: { workspaces: vi.fn() },
  conversationVisibility: vi.fn(),
  BffError: class extends Error {},
  fetchUserState: vi.fn(),
  setWorkspacePreference: vi.fn(),
  signOut: vi.fn(),
}));

beforeEach(() => {
  state.hook = 0;
  state.accessMode = "FULL";
  state.documentTheme = "";
  state.memberA = true;
  state.memberB = true;
  state.tab = "members";
  state.workspaceId = null;
  state.channelEnabled = false;
  window.history.replaceState({}, "", "/app/");
});
it("uses the native shared restricted view without mounting ordinary workspace menus", () => {
  state.accessMode = "LIFECYCLE_RESTRICTED";
  const markup = renderToStaticMarkup(<PlatformApp />);
  expect(markup).toContain('data-testid="shared-lifecycle-restricted"');
  expect(markup).not.toContain('data-testid="shared-management-panels"');
  expect(markup).not.toContain('data-testid="sidebar-settings"');
  expect(markup).not.toContain('data-testid="workspace-members"');
});
it("mounts the original settings page beside rather than inside the ordinary content card", () => {
  state.tab = "settings";
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<PlatformApp />);
  const settings = host.querySelector('[data-testid="settings-host"]')!;
  expect(settings.getAttribute("data-active")).toBe("true");
  expect(settings.closest('[data-testid="app-content-surface"]')).toBeNull();
  expect(settings.closest("main")).toBeNull();
  expect(settings.closest('[data-testid="app-sidebar-layer"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="app-top-chrome"]')?.className).toContain("absolute inset-x-0 top-0");
  expect(host.querySelector('[data-testid="app-sidebar"]')?.closest("[hidden]")).not.toBeNull();
});
it("retains the host-selected Workspace and mounts shared member management", () => {
  const markup = renderToStaticMarkup(<PlatformApp />);
  expect(markup).toContain('data-testid="shared-management-panels"');
  expect(markup).toContain('data-workspace="workspace-b"');
  expect(markup).not.toContain('data-workspace="workspace-a"');
  expect(markup).toContain('data-testid="sidebar-settings"');
  expect(markup).toContain('data-testid="create-channel"');
  expect(markup).toContain('data-testid="shared-channel-sidebar" data-selected="workspace-b" data-channels="2"');
  expect(markup).not.toContain("<select");
  expect(markup).toContain('data-testid="shared-create-channel-dialog" data-open="false"');
});

it("routes a native file menu through the normal platform session with the resolved Buzz theme", () => {
  const binding = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  window.history.replaceState({}, "", `/app/?protocolBinding=${binding}`);
  const markup = renderToStaticMarkup(<PlatformApp />);
  expect(markup).toContain(`data-document-binding="${binding}"`);
  expect(markup).not.toContain('data-testid="workspace-members"');
  expect(state.documentTheme).toBe("DARK");
});

it("defaults to an actual membership without deleting management-visible workspaces", () => {
  state.memberB = false;
  const markup = renderToStaticMarkup(<PlatformApp />);
  expect(markup).toContain('data-selected="workspace-a" data-channels="2"');
  expect(markup).toContain('data-testid="shared-management-panels"');
});

it("shows a nonmember state instead of opening a Relay query when no channel is joined", () => {
  state.memberA = false;
  state.memberB = false;
  state.tab = "channel";
  const markup = renderToStaticMarkup(<PlatformApp />);
  expect(markup).toContain('data-channels="2"');
  expect(markup).toContain("platform.channel.membershipRequired");
  expect(state.channelEnabled).toBe(false);
});

it("does not expose the document bridge to a lifecycle-restricted platform session", () => {
  window.history.replaceState({}, "", "/app/?protocolBinding=dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  state.accessMode = "LIFECYCLE_RESTRICTED";
  const markup = renderToStaticMarkup(<PlatformApp />);
  expect(markup).toContain('data-testid="shared-lifecycle-restricted"');
  expect(markup).not.toContain("data-document-binding");
});

it("does not substitute a default channel for a route outside the fresh workspace directory", () => {
  state.tab = "channel";
  state.workspaceId = "revoked-workspace";
  const markup = renderToStaticMarkup(<PlatformApp />);
  expect(markup).toContain("platform.noWorkspace");
  expect(state.channelEnabled).toBe(false);
  expect(markup).not.toContain('data-selected="workspace-b"');
});

it.each(["agents", "workflows"])("passes the exact %s URL workspace to the shared page, even when unavailable", (section) => {
  state.tab = section;
  state.workspaceId = "revoked-workspace";
  const markup = renderToStaticMarkup(<PlatformApp />);
  expect(markup).toContain(`data-testid="${section}-scope" data-workspace="revoked-workspace"`);
  expect(markup).not.toContain('data-workspace="workspace-b"');
});
