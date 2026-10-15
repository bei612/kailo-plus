// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { routeTree } from "@/app/routeTree.gen";

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
// PlatformApp navigates through the real TanStack routes (/_platform layout and its sections),
// so mount it the way the app does instead of rendering it outside a router.
async function open() {
  const url = `${window.location.pathname}${window.location.search}`;
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [url] }), basepath: "/app", defaultPendingMinMs: 0 });
  await act(async () => { await router.load(); root.render(<RouterProvider router={router} />); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
// The restored original sidebar: Inbox is the primary menu's first row, Settings lives in
// the profile card popover and opens on the next frame.
async function openInboxFromSidebar() {
  const inbox = host.querySelector('[data-testid="sidebar-primary-menu"] .lucide-inbox')?.closest("button");
  expect(inbox).toBeTruthy();
  await act(async () => inbox!.click());
}
async function openSettingsFromSidebar() {
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="open-settings"]')!.click());
  const item = document.querySelector<HTMLButtonElement>('[data-testid="profile-popover-settings"]');
  expect(item).not.toBeNull();
  await act(async () => item!.click());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
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
