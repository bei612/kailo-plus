// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { PlatformApp } from "./PlatformApp";
// This SSR shell fixture isolates data-owning hosts. The actual original
// project region and governed membership are mounted in shared Projects tests.
vi.mock("./SidebarProjects",()=>({SidebarProjects:()=>null}));
vi.mock("./ConversationSidebar",()=>({ConversationSidebar:()=> <div data-testid="shared-conversation-list" />}));
vi.mock("@tanstack/react-router", () => ({ useBlocker: () => ({ status: "idle" }) }));
vi.mock("@client-kit/platform/react/create-channel-dialog", () => ({ CreateChannelDialog: () => null }));

const state = vi.hoisted(() => ({ hook: 0, accessMode: "FULL", documentTheme: "", memberA: true, memberB: true, tab: "members", workspaceId: null as string | null, channelEnabled: false,
  channelType: "stream", conversationId: null as string | null,
  startDm: {} as Record<string, (pubkey: string) => void | Promise<void>>,
  openDm: vi.fn(), reloadConversations: vi.fn(), openConversation: vi.fn(), openTab: vi.fn(),
  search: null as import("react").ComponentProps<typeof import("./TopbarSearch").TopbarSearch> | null,
  openChannel: vi.fn(), searchRefetch: vi.fn(),
}));
const searchWorkspaces=[{id:"workspace-a",isMember:true,channel:{channelId:"native-a"}}, {id:"workspace-b",isMember:true,channel:{channelId:"native-b"}}];
function searchHit(channelId:string,threadRootId:string|null=null):import("@client-kit/platform/react/search/types").SearchHit {
  return {channelId,eventId:"actual-message",threadRootId,content:"actual result",pubkey:"b".repeat(64),kind:9,channelName:null,createdAt:12,score:1};
}
vi.mock("./search",()=>({useWebSearchDirectory:()=>({data:{channels:[],labels:{},workspaces:searchWorkspaces},error:null,isError:false,refetch:state.searchRefetch})}));
vi.mock("./TopbarSearch",()=>({TopbarSearch:(props:import("react").ComponentProps<typeof import("./TopbarSearch").TopbarSearch>)=>{state.search=props;return <button data-testid="actual-web-search-host"/>;}}));
vi.mock("@/app/platform-navigation", () => ({
  usePlatformNavigation: () => ({ tab: state.tab, workspaceId: state.workspaceId,
    conversationId: state.conversationId, messageTarget: null, openTab: state.openTab, openChannel: state.openChannel, openConversation: state.openConversation }),
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
        : options.queryKey[1] === "channel-descriptor"
          ? { channelId: "native-stream", channelType: state.channelType, name: "Actual channel" }
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
  useConversations: () => ({ items: state.conversationId ? [{id: state.conversationId, channelId: "native-private"}] : [], loading: false, error: null, reload: state.reloadConversations }),
  useDirectMessageOpen: () => ({open: state.openDm}),
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
  MembersPane: ({ workspaceId, onStartDm }: { workspaceId: string; onStartDm: (pubkey: string) => void | Promise<void> }) => {
    state.startDm.members = onStartDm;
    return <div data-testid="workspace-members" data-workspace={workspaceId} />;
  },
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
vi.mock("@/platform/ui/ChannelPane", () => ({ ChannelPane: ({conversation, onStartDm}: {conversation?: unknown; onStartDm: (pubkey: string) => void | Promise<void>}) => {
  state.startDm[conversation ? "conversation" : "stream"] = onStartDm;
  return null;
} }));
vi.mock("@/platform/ui/ForumPane", () => ({ ForumPane: ({onStartDm}: {onStartDm: (pubkey: string) => void | Promise<void>}) => {
  state.startDm.forum = onStartDm;
  return null;
} }));
vi.mock("./PulsePane", () => ({ PulsePane: ({onStartDm}: {onStartDm: (pubkey: string) => void | Promise<void>}) => {
  state.startDm.pulse = onStartDm;
  return null;
} }));
vi.mock("@/platform/ui/InboxPane", async () => {
  const { InboxLayout, InboxEmptyDetail } = await import("@client-kit/platform/react/inbox-surface");
  return {InboxPane: ({onStartDm}: {onStartDm: (pubkey: string) => void | Promise<void>}) => {
    state.startDm.inbox = onStartDm;
    return <InboxLayout listWidth={320} showList showDetail onResize={() => {}}>
      <section data-testid="inbox-list-consumer" /><InboxEmptyDetail />
    </InboxLayout>;
  }};
});
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
  state.channelType = "stream";
  state.conversationId = null;
  state.startDm = {};
  state.search = null;
  state.openChannel.mockReset().mockResolvedValue(undefined);
  state.searchRefetch.mockReset().mockResolvedValue({isError:false,data:{channels:[],labels:{},workspaces:searchWorkspaces}});
  state.openDm.mockReset().mockResolvedValue({id: "actual-dm", channelId: "actual-native-dm", state: "ACTIVE"});
  state.reloadConversations.mockReset().mockResolvedValue(undefined);
  state.openConversation.mockReset().mockResolvedValue(undefined);
  state.openTab.mockReset();
  window.history.replaceState({}, "", "/app/");
});

it("mounts the same original search in the fixed pinned sidebar header, with real browse/create and People consumers",async()=>{
  const host=document.createElement("div");host.innerHTML=renderToStaticMarkup(<PlatformApp/>);
  expect(host.querySelector('[data-testid="actual-web-search-host"]')?.closest('[data-testid="sidebar-pinned-header"]')).not.toBeNull();
  expect(state.search?.onBrowseChannels).toBeTypeOf("function");
  expect(state.search?.onCreateChannel).toBeTypeOf("function");
  expect(state.search?.onCreateAgent).toBeUndefined();
  await state.search!.onOpenUser!({pubkey:"b".repeat(64),displayName:null,avatarUrl:null,nip05Handle:null,ownerPubkey:null,isAgent:false});
  expect(state.openDm).toHaveBeenCalledWith("b".repeat(64));
  expect(state.openConversation).toHaveBeenCalledWith("actual-dm");
});

it("maps native search Channel IDs to the actual Workspace reference after fresh directory read",async()=>{
  state.tab="channel";renderToStaticMarkup(<PlatformApp/>);
  expect(state.search?.currentChannelId).toBe("native-b");
  state.search!.onOpenChannel("native-a");
  await vi.waitFor(()=>expect(state.openChannel).toHaveBeenCalledWith("workspace-a",undefined));
  expect(state.searchRefetch).toHaveBeenCalledOnce();
});

it("keeps actual original search hit and thread focus when mapping native channel to Workspace navigation",async()=>{
  renderToStaticMarkup(<PlatformApp/>);
  state.search!.onOpenResult(searchHit("native-a","actual-root"),"actual");
  await vi.waitFor(()=>expect(state.openChannel).toHaveBeenCalledWith("workspace-a",{channelId:"workspace-a",messageId:"actual-message",threadRootId:"actual-root"}));
});

it("resolves a fresh participant DM by native channel without treating that ID as a Workspace",async()=>{
  state.reloadConversations.mockResolvedValue([{id:"actual-private",channelId:"native-private",state:"ACTIVE",participantPrincipalIds:["human-a","human-b"]}]);
  renderToStaticMarkup(<PlatformApp/>);
  state.search!.onOpenResult(searchHit("native-private"),"actual");
  await vi.waitFor(()=>expect(state.openConversation).toHaveBeenCalledWith("actual-private",{messageId:"actual-message",threadRootId:null}));
  expect(state.openChannel).not.toHaveBeenCalled();
});

it.each(["directory-unavailable","membership-revoked"])("does not navigate a %s search hit",async(failure)=>{
  state.searchRefetch.mockResolvedValue(failure==="directory-unavailable"?{isError:true}: {isError:false,data:{workspaces:searchWorkspaces.map(row=>({...row,isMember:false}))}});
  renderToStaticMarkup(<PlatformApp/>);
  state.search!.onOpenResult(searchHit("native-a"),"actual");
  await vi.waitFor(()=>expect(state.searchRefetch).toHaveBeenCalledOnce());
  await Promise.resolve();
  expect(state.openChannel).not.toHaveBeenCalled();
  expect(state.openConversation).not.toHaveBeenCalled();
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
it("mounts the original Inbox grid and both panes in its viewport host without adding a second scrolling or padded container", () => {
  state.tab = "inbox";
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<PlatformApp />);
  const inbox = host.querySelector('[data-testid="home-inbox"]')!;
  const viewport = inbox.parentElement!;
  expect(viewport.tagName).toBe("MAIN");
  expect(viewport.classList.contains("flex")).toBe(true);
  expect(viewport.classList.contains("overflow-hidden")).toBe(true);
  expect(viewport.classList.contains("p-4")).toBe(false);
  expect(inbox.querySelector('[data-testid="inbox-list-consumer"]')).not.toBeNull();
  expect(inbox.querySelector('[data-testid="home-inbox-detail-empty"]')).not.toBeNull();
  expect(inbox.querySelector('[data-testid="home-inbox-list-resize-handle"]')).not.toBeNull();
  expect(viewport.closest('[data-buzz-content-surface]')).not.toBeNull();
  expect(host.querySelector('[data-testid="settings-host"]')).toBeNull();
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

it.each(["inbox", "pulse", "stream", "forum", "conversation", "members"])("the actual %s profile consumer opens the confirmed DM, not a new-message page", async (surface) => {
  state.tab = surface === "stream" || surface === "forum" ? "channel" : surface;
  state.channelType = surface;
  if (surface === "conversation") state.conversationId = "current-private";
  const order: string[] = [];
  let confirm!: (value: {id: string}) => void;
  state.openDm.mockImplementation(() => new Promise((resolve) => {confirm = resolve;}));
  state.reloadConversations.mockImplementation(async () => {order.push("reload");});
  state.openConversation.mockImplementation(async (id) => {order.push(`navigate:${id}`);});
  renderToStaticMarkup(<PlatformApp />);
  const pending = state.startDm[surface]("b".repeat(64));
  expect(state.openDm).toHaveBeenCalledWith("b".repeat(64));
  expect(order).toEqual([]);
  confirm({id: "confirmed-private"});
  await pending;
  expect(order).toEqual(["reload", "navigate:confirmed-private"]);
  expect(state.openTab).not.toHaveBeenCalled();
});

it.each(["inbox", "pulse", "stream", "forum", "conversation", "members"])("the actual %s profile consumer preserves an unknown DM without navigation", async (surface) => {
  state.tab = surface === "stream" || surface === "forum" ? "channel" : surface;
  state.channelType = surface;
  if (surface === "conversation") state.conversationId = "current-private";
  const unknown = new Error("Opening outcome unknown");
  state.openDm.mockRejectedValue(unknown);
  renderToStaticMarkup(<PlatformApp />);
  await expect(state.startDm[surface]("b".repeat(64))).rejects.toBe(unknown);
  expect(state.reloadConversations).not.toHaveBeenCalled();
  expect(state.openConversation).not.toHaveBeenCalled();
  expect(state.openTab).not.toHaveBeenCalled();
});
