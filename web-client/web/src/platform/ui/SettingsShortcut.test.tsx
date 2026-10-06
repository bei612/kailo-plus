// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlatformApp } from "./PlatformApp";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ accessMode: "FULL" }));
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
  PlatformProvider: ({
    children,
    documentTheme,
  }: {
    children: React.ReactNode;
    documentTheme?: string;
  }) => {
    void documentTheme;
    return children;
  },
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
  SettingsPane: () => <div data-testid="settings-content" />,
}));
vi.mock("@/shared/i18n", () => ({ getLocale: () => "en", t: (key: string) => key }));
vi.mock("@/shared/theme/ThemeProvider", () => ({ useTheme: () => ({ isDark: true }) }));
vi.mock("@/platform/bff-client", () => ({
  bff: {
    workspaces: vi.fn(),
    session: async () => ({
      tenantPrincipalId: "human-a",
      currentWorkspaceId: "workspace-b",
      accessMode: state.accessMode,
    }),
  },
  BffError: class extends Error {},
  fetchUserState: vi.fn(),
  setWorkspacePreference: vi.fn(),
  signOut: vi.fn(),
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  state.accessMode = "FULL";
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
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="sidebar-inbox"]')!.click(),
  );
  expect(host.querySelector('[data-testid="inbox-content"]')).not.toBeNull();
  expect((await shortcut()).defaultPrevented).toBe(true);
  expect(host.querySelector('[data-testid="settings-content"]')).not.toBeNull();
  await shortcut();
  expect(host.querySelector('[data-testid="inbox-content"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="settings-content"]')).toBeNull();
});
it("closes settings opened by the existing sidebar without resetting Workspace", async () => {
  await open();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="sidebar-settings"]')!.click(),
  );
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
