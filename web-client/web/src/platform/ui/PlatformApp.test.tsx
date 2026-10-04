import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { PlatformApp } from "./PlatformApp";

const state = vi.hoisted(() => ({ hook: 0, accessMode: "FULL" }));
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
            ? "members"
            : initial,
        vi.fn(),
      ];
    },
  };
});
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: string[] }) => ({
    data:
      options.queryKey[1] === "workspaces"
        ? [
            { id: "workspace-a", name: "A" },
            { id: "workspace-b", name: "B" },
          ]
        : { workspacePreferences: {} },
    isError: false,
    isPending: false,
  }),
  useMutation: () => ({ mutate: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@client-kit/platform/react/context", () => ({
  PlatformProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@client-kit/platform/react/governance", () => ({
  LifecycleRestrictedView: () => <div data-testid="shared-lifecycle-restricted" />,
  TasksPage: () => null,
  ApprovalsPage: () => null,
}));
vi.mock("@client-kit/platform/react/pages", () => ({
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
vi.mock("@/platform/ui/ChannelPane", () => ({ ChannelPane: () => null }));
vi.mock("@/platform/ui/InboxPane", () => ({ InboxPane: () => null }));
vi.mock("@/platform/ui/SettingsPane", () => ({ SettingsPane: () => null }));
vi.mock("@/shared/i18n", () => ({ getLocale: () => "en", t: (key: string) => key }));
vi.mock("@/platform/bff-client", () => ({
  bff: { workspaces: vi.fn() },
  BffError: class extends Error {},
  fetchUserState: vi.fn(),
  setWorkspacePreference: vi.fn(),
  signOut: vi.fn(),
}));

beforeEach(() => {
  state.hook = 0;
  state.accessMode = "FULL";
});
it("uses the native shared restricted view without mounting ordinary workspace menus", () => {
  state.accessMode = "LIFECYCLE_RESTRICTED";
  const markup = renderToStaticMarkup(<PlatformApp />);
  expect(markup).toContain('data-testid="shared-lifecycle-restricted"');
  expect(markup).not.toContain('data-testid="shared-management-panels"');
  expect(markup).not.toContain('data-testid="sidebar-settings"');
  expect(markup).not.toContain('data-testid="workspace-members"');
});
it("retains the host-selected Workspace and mounts all shared management panels plus invitations", () => {
  const markup = renderToStaticMarkup(<PlatformApp />);
  expect(markup).toContain('data-testid="shared-management-panels"');
  expect(markup).toContain('data-testid="tenant-invitations"');
  expect(markup).toContain('data-workspace="workspace-b"');
  expect(markup).not.toContain('data-workspace="workspace-a"');
  expect(markup).toContain('data-testid="sidebar-settings"');
});
