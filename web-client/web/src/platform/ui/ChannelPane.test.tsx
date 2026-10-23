// @vitest-environment jsdom
import { act, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StreamFrame } from "../bff-client";
import { ChannelPane as ActualChannelPane } from "./ChannelPane";
import { setLocale } from "@client-kit/platform/i18n";
import { setThreadViewMode } from "@client-kit/platform/react/thread/threadViewModePreference";
import type { TimelineMessage } from "@client-kit/platform/react/messages";
import { ConversationViewState } from "@client-kit/contracts";
import type { MessageAuthor } from "./MessageAuthorProfile";
import { parseMentionClipboardRecords } from "@client-kit/platform/react/composer/features/messages/lib/mentionClipboard";
import { SETTLE_FRAME_COUNT, SETTLE_MOTION_WINDOW_MS } from "@client-kit/platform/react/messages/timeline/useSettleGatedPrependMessages";
import { toast } from "sonner";
import { CollaborationPreferencesProvider, type CollaborationPreferenceActions } from "@client-kit/platform/react/collaboration-preferences";

// Isolate the stream lifecycle from the rich editor. Original Tiptap is mounted
// by Composer/ChannelRead tests; the channel and original message rows mount here.
vi.mock("@tiptap/react", async (original) => ({
  ...(await original<typeof import("@tiptap/react")>()), useEditor: () => null,
}));

const state = vi.hoisted(() => ({
  receive: null as null | ((frame: StreamFrame) => void),
  stop: vi.fn(),
  reason: (reason: string) => reason,
  members: { isSuccess: true, data: [] as { principalId: string; pubkeys: string[]; displayName: string }[] },
  memberReads: [] as (readonly unknown[])[],
  userState: { isSuccess: true, data: { version: 0, readContexts: {}, workspacePreferences: {}, conversationPreferences: {} as Record<string, {muted: boolean}> } },
  notify: vi.fn(),
  richContent: false,
  typingAgents: {isSuccess:true,isFetching:false,data:{principalId:"me",members:[] as unknown[],agents:[] as {pubkey:string;installation:{resourceId:string}}[]}},
  // DD-147(1): the member-readable Agent author directory (owner line).
  agentAuthors: {isSuccess:true,isFetching:false,data:{agents:[] as unknown[]}},
  // DD-125(6): the readable Installation directory behind the working signal.
  channelAgents: {isSuccess:true,isFetching:false,data:[] as Record<string, unknown>[]},
  openActivity: vi.fn(),
  emoji: { isSuccess: true, data: { events: [] } },
  infinite: { data: { pages: [] }, isSuccess: true },
  queryClient: { invalidateQueries: vi.fn() },
  mutation: { isPending: false, mutate: vi.fn() },
  route: {messages:[] as import("./inbox-events").Event[],denied:false,interrupted:false,
    thread:{isSuccess:true,isError:false,isFetching:false,hasNextPage:false,isFetchingNextPage:false,fetchNextPage:vi.fn()}},
  routeRead:vi.fn(),
}));
type HistoryProps = Pick<ComponentProps<typeof ActualChannelPane>, "threadHeadId" | "onThreadHeadIdChange" | "onClearMessageRouteTarget" | "onNavigationGuardChange">;
const ignoreNavigationGuard = () => {};
function ChannelPane(props: Omit<ComponentProps<typeof ActualChannelPane>, keyof HistoryProps> & Partial<HistoryProps>) {
  const [headId, setHeadId] = useState<string | null>(null);
  return <ActualChannelPane {...props} threadHeadId={props.threadHeadId === undefined ? headId : props.threadHeadId}
    onThreadHeadIdChange={props.onThreadHeadIdChange ?? setHeadId}
    onClearMessageRouteTarget={props.onClearMessageRouteTarget ?? (() => {})}
    onNavigationGuardChange={props.onNavigationGuardChange ?? ignoreNavigationGuard} />;
}
vi.mock("./useWorkspaceThread",()=>({useWorkspaceThread:(...args:unknown[])=>{state.routeRead(...args);return state.route;}}));
vi.mock("@client-kit/platform/react/context", async (original) => ({
  ...await original<typeof import("@client-kit/platform/react/context")>(),
  useReasonText: () => state.reason,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueries: ({queries}: {queries: readonly unknown[]}) => queries.map(() => ({isSuccess:false,isFetching:false})),
  useQuery: (options: { queryKey: readonly unknown[] }) => {
    if (options.queryKey.includes("composer-agent-directory")) return state.typingAgents;
    if (options.queryKey.includes("agent-authors")) return state.agentAuthors;
    // DD-125(8): the Tenant @ directory is read only on demand; these shell tests never open it.
    if (options.queryKey.includes("tenant-mention-directory")) return { data: undefined };
    if (options.queryKey.includes("channel-agents")) return state.channelAgents;
    if (options.queryKey.some(key => key === "members" || key === "conversation-members")) {
      state.memberReads.push(options.queryKey);
      return state.members;
    }
    return options.queryKey.includes("custom-emoji") ? state.emoji : state.userState;
  },
  useInfiniteQuery: () => state.infinite,
  useQueryClient: () => state.queryClient,
  useMutation: () => state.mutation,
}));
vi.mock("@client-kit/platform/react/agent-transcript", async (original) => ({
  ...await original<typeof import("@client-kit/platform/react/agent-transcript")>(),
  useAgentTranscript: () => [],
  useOpenAgentActivity: () => ({ openAgentActivity: state.openActivity }),
}));
vi.mock("./BrowserNotifications", () => ({ useBrowserNotifications: () => ({notify: state.notify, settings: {homeBadgeEnabled: true}}) }));
vi.mock("@/platform/bff-client", () => ({
  bff: { members: vi.fn(), workspaces: vi.fn() },
  BffError: class extends Error {},
  fetchUserState: vi.fn(),
  markRead: vi.fn(),
  publishMessage: vi.fn(),
  uploadMedia: vi.fn(),
  openStream: (_workspace: string, receive: (frame: StreamFrame) => void) => {
    state.receive = receive;
    return state.stop;
  },
}));
vi.mock("@/features/chat/ui/MessageContent", async (original) => {
  const actual = await original<typeof import("@/features/chat/ui/MessageContent")>();
  return { MessageContent: (props: import("react").ComponentProps<typeof actual.MessageContent>) =>
    state.richContent ? <actual.MessageContent {...props} /> : <span>{props.content}</span> };
});
vi.mock("@/shared/i18n", () => ({ t: (key: string) => key }));
vi.mock("@/shared/lib/relative-time", () => ({ relativeTime: () => "now" }));
vi.mock("./ChannelThreadPane", async () => {
  const { useState } = await import("react");
  return { ChannelThreadPane: ({selected, routeTargetMessageId, conversation, typingEntries, onOpenAuthor, onAuthorScopeUnavailable, onClose, onEdit, onCancelEdit}: {
    selected: TimelineMessage; onOpenAuthor: (message: TimelineMessage) => void; onAuthorScopeUnavailable: () => void;
    routeTargetMessageId?:string;
    conversation?:{id:string};
    typingEntries?: readonly import("@client-kit/platform/react/messages/typingState").TypingIndicatorEntry[];
    onClose: () => void;
    onEdit: (message: TimelineMessage) => void;
    onCancelEdit: () => void;
  }) => {
    const [pending, setPending] = useState(false);
    return <section data-testid="thread-lifetime" data-selected-id={selected.id} data-route-target={routeTargetMessageId} data-conversation-id={conversation?.id} data-typing={JSON.stringify(typingEntries ?? [])}>
      <button onClick={() => setPending(true)}>pending reply</button>
      <output>{pending ? "reply pending" : "reply idle"}</output>
      <button onClick={() => onOpenAuthor(selected)}>thread author</button>
      <button onClick={onAuthorScopeUnavailable}>thread unavailable</button>
      <button onClick={onClose}>close thread</button>
      <button onClick={() => onEdit({...selected,id:"edited-reply",tags:[["e",selected.id,"","root"],["e",selected.id,"","reply"]]})}>edit reply</button>
      <button onClick={onCancelEdit}>finish reply edit</button>
    </section>;
  }};
});
vi.mock("./MessageAuthorProfile", async (original) => ({
  ...await original<typeof import("./MessageAuthorProfile")>(),
  MessageAuthorProfile: ({onClose, target}: {onClose: () => void; target: MessageAuthor}) => <button data-testid="close-author" data-author-target={JSON.stringify(target)} onClick={onClose}>close author</button>,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
function render() { return host.innerHTML; }
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
beforeEach(async () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  // Reuse ChannelRead's actual Virtua measurement boundary: jsdom's zero-size
  // viewport cannot prove that a newly prepended target row is mounted.
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(function (this: HTMLElement) {
    return this.isConnected && getComputedStyle(this).display !== "none" ? this.parentElement : null;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.style.position === "absolute" ? 40 : 800; });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1440);
  vi.stubGlobal("ResizeObserver", class {
    private targets = new Set<Element>();
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.targets.add(target);
      queueMicrotask(() => {
        if (!this.targets.has(target)) return;
        const height = target instanceof HTMLElement && target.style.position === "absolute" ? 40 : 800;
        this.callback([{ target, contentRect: new DOMRect(0, 0, 1440, height),
          borderBoxSize: [{ inlineSize: 1440, blockSize: height }],
          contentBoxSize: [{ inlineSize: 1440, blockSize: height }], devicePixelContentBoxSize: [] }], this);
      });
    }
    unobserve(target: Element) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: () => [] },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
  });
  setLocale("en");
  setThreadViewMode("split");
  state.stop.mockClear();
  state.notify.mockClear();
  state.richContent = false;
  state.typingAgents.data.agents=[];
  state.agentAuthors.data.agents=[];
  state.channelAgents.data=[];
  state.openActivity.mockClear();
  state.route.messages=[];state.route.denied=false;state.route.interrupted=false;
  state.route.thread.isSuccess=true;state.route.thread.isError=false;state.route.thread.isFetching=false;
  state.routeRead.mockClear();
  state.members.data = [];
  state.memberReads = [];
  state.userState.data.conversationPreferences = {};
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<TooltipProvider><ChannelPane workspaceId="workspace-a" channelId="channel-a" myPrincipalId="human-a" /></TooltipProvider>); });
  await act(async () => {
  state.receive!({
    type: "snapshot",
    events: [
      {
        id: "event-a",
        pubkey: "author-a",
        kind: 9,
        created_at: 1,
        tags: [],
        content: "existing message",
      },
      { id: "bounds", pubkey: "relay", kind: 39006, created_at: 1, tags: [["d", "channel-a:head"]], content: JSON.stringify({has_more:false,next_cursor:null}) },
    ],
  });
  state.receive!({ type: "live" });
  });
});

it("mounts the original project workspace drawer over a retained thread and removes it on scope revocation",async()=>{
  const close=vi.fn();
  await act(async()=>root.render(<TooltipProvider><ChannelPane workspaceId="workspace-a" channelId="channel-a" myPrincipalId="human-a"
    threadHeadId="event-a" idleAuxiliaryPanel={<p>Real project Tasks consumer</p>} idleAuxiliaryTitle="Tasks"
    idleAuxiliaryOverridesThread onCloseIdleAuxiliaryPanel={close}/></TooltipProvider>));
  const thread=host.querySelector('[data-testid="thread-lifetime"]');
  expect(thread).not.toBeNull();expect(thread?.closest("[inert]")).not.toBeNull();
  expect(host.querySelector('[data-testid="focus-thread-drawer"]')?.getAttribute("aria-label")).toBe("Tasks");
  expect(host.textContent).toContain("Real project Tasks consumer");
  await act(async()=>window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));
  expect(close).toHaveBeenCalledOnce();
  await act(async()=>state.receive!({type:"closed",reason:"scope-revoked"}));
  expect(host.textContent).not.toContain("Real project Tasks consumer");
});

it.each(["denied", "interrupted", "error"] as const)("does not fall back to warm root or selected reply rows after thread %s", async boundary => {
  await act(async () => state.receive!({type:"event",event:{id:"warm-reply",pubkey:"author-a",kind:9,created_at:2,
    tags:[["e","event-a","","root"],["e","event-a","","reply"]],content:"warm reply"}}));
  state.route.messages=[{id:"event-a",pubkey:"author-a",kind:9,createdAt:1,created_at:1,channelId:"channel-a",category:"activity",tags:[],content:"existing message"},
    {id:"warm-reply",pubkey:"author-a",kind:9,createdAt:2,created_at:2,channelId:"channel-a",category:"activity",tags:[["e","event-a","","root"],["e","event-a","","reply"]],content:"warm reply"}];
  const renderHistory = (targetMessageId?: string) => act(async () => root.render(<TooltipProvider><ChannelPane
    workspaceId="workspace-a" channelId="channel-a" myPrincipalId="human-a" threadHeadId="event-a"
    targetMessageId={targetMessageId} targetThreadRootId="event-a"/></TooltipProvider>));
  for (const selected of [undefined,"warm-reply"]) {
    state.route.denied=false; state.route.interrupted=false; state.route.thread.isError=false;
    await renderHistory(selected);
    expect(host.querySelector('[data-testid="thread-lifetime"]')).not.toBeNull();
    if (boundary === "error") state.route.thread.isError=true;
    else state.route[boundary]=true;
    await renderHistory(selected);
    expect(host.querySelector('[data-testid="thread-lifetime"]')).toBeNull();
  }
});

it.each(["thread-read", "scope"] as const)("clears original focus coverage after %s denial and fresh readmission", async boundary => {
  const renderHistory = (headId: string | null, workspaceId="workspace-a") => act(async () => root.render(<TooltipProvider><ChannelPane
    workspaceId={workspaceId} channelId="channel-a" myPrincipalId="human-a" threadHeadId={headId}/></TooltipProvider>));
  await act(async () => setThreadViewMode("focus"));
  await renderHistory("event-a");
  expect(host.querySelector('[data-testid="thread-lifetime"]')).not.toBeNull();
  expect(host.querySelector("[inert]")).not.toBeNull();
  if (boundary === "thread-read") {
    state.route.denied = true;
    await renderHistory("event-a");
  } else await act(async () => state.receive!({type:"closed",reason:"scope-revoked"}));
  expect(host.querySelector('[data-testid="thread-lifetime"]')).toBeNull();
  expect(host.querySelector("[inert]")).toBeNull();
  // A terminal revoked subscription cannot be revived by late frames. Leave
  // and return through the actual scope effect to obtain a new subscription.
  if (boundary === "scope") await renderHistory(null, "workspace-b");
  await renderHistory(null);
  state.route.denied = false;
  await act(async () => {
    state.receive!({type:"snapshot",events:[
      {id:"event-a",pubkey:"author-a",kind:9,created_at:1,tags:[],content:"existing message"},
      {id:"fresh-bounds",pubkey:"relay",kind:39006,created_at:1,tags:[["d","channel-a:head"]],content:JSON.stringify({has_more:false,next_cursor:null})},
    ]});
    state.receive!({type:"live"});
  });
  expect(host.querySelector("[inert]")).toBeNull();
  await renderHistory("event-a");
  expect(host.querySelector('[data-testid="thread-lifetime"]')).not.toBeNull();
  expect(host.querySelector("[inert]")).not.toBeNull();
});

it("keeps the original edit guard and mounted draft during metadata refetch but never blocks actual revocation", async () => {
  let guard: (() => boolean) | null = null;
  const register = (next: (() => boolean) | null) => { guard=next; };
  const renderHistory = (metadataPending=false) => act(async () => root.render(<TooltipProvider><ChannelPane
    workspaceId="workspace-a" channelId="channel-a" myPrincipalId="human-a" threadHeadId="event-a"
    metadataPending={metadataPending} onNavigationGuardChange={register}/></TooltipProvider>));
  await renderHistory();
  await act(async () => {
    [...host.querySelectorAll("button")].find(button => button.textContent === "pending reply")!.click();
    [...host.querySelectorAll("button")].find(button => button.textContent === "edit reply")!.click();
  });
  expect(guard!()).toBe(false);
  await renderHistory(true);
  expect(guard!()).toBe(false);
  expect(host.querySelector('[data-testid="thread-lifetime"]')?.textContent).toContain("reply pending");
  await act(async () => state.receive!({type:"closed",reason:"scope-revoked"}));
  expect(guard!()).toBe(true);
  expect(host.querySelector('[data-testid="thread-lifetime"]')).toBeNull();
});

it.each(["channel", "conversation"] as const)("freshly reads a reloaded %s thread reference and follows its history without storing a body", async scope => {
  const conversation=scope === "conversation" ? {id:"workspace-a",channelId:"channel-a",state:ConversationViewState.Active,
    participantPrincipalIds:["human-a","human-b"],operationId:"operation",version:1} : undefined;
  const renderHistory = (headId: string | null) => act(async () => root.render(<TooltipProvider><ChannelPane
    workspaceId="workspace-a" channelId="channel-a" myPrincipalId="human-a" conversation={conversation} threadHeadId={headId}/></TooltipProvider>));
  state.route.thread.isFetching = true;
  await renderHistory("cold-root");
  if (conversation) await act(async () => {
    state.receive!({type:"snapshot",events:[{id:"dm-bounds",pubkey:"relay",kind:39006,created_at:1,tags:[["d","channel-a:head"]],content:JSON.stringify({has_more:false,next_cursor:null})}]});
    state.receive!({type:"live"});
  });
  expect(state.routeRead).toHaveBeenLastCalledWith("human-a", "workspace-a", "cold-root", conversation?.id, undefined, true, conversation?.channelId);
  expect(host.querySelector('[data-testid="thread-lifetime"]')).toBeNull();
  state.route.thread.isFetching = false;
  state.route.messages = [{id:"cold-root",pubkey:"author-a",kind:9,createdAt:1,created_at:1,channelId:"channel-a",category:"activity",tags:[],content:"freshly admitted root"}];
  await renderHistory("cold-root");
  expect(host.querySelector('[data-testid="thread-lifetime"]')?.getAttribute("data-selected-id")).toBe("cold-root");
  await renderHistory(null);
  await vi.waitFor(() => expect(host.querySelector('[data-testid="thread-lifetime"]')).toBeNull());
  await renderHistory("cold-root");
  expect(host.querySelector('[data-testid="thread-lifetime"]')).not.toBeNull();
  state.route.denied = true;
  await renderHistory("cold-root");
  expect(host.querySelector('[data-testid="thread-lifetime"]')).toBeNull();
  expect(host.textContent).not.toContain("freshly admitted root");
  await act(async () => state.receive!({type:"closed",reason:"scope-revoked"}));
  expect(state.routeRead).toHaveBeenLastCalledWith("human-a", "workspace-a", "cold-root", conversation?.id, undefined, false, conversation?.channelId);
  expect(host.querySelector('[data-testid="thread-lifetime"]')).toBeNull();
});

it.each(["channel", "conversation"] as const)("passes admitted %s thread typing from the live window and clears completed, expired and revoked indicators", async scope => {
  state.typingAgents.data={principalId:"me",members:[],agents:[{pubkey:"agent",installation:{resourceId:"agent-installation"}}]};
  state.members.data = [{principalId:"human-a",pubkeys:["self-key"],displayName:"Me"}, {principalId:"human-b",pubkeys:["peer"],displayName:"Peer"}];
  const conversation=scope==="conversation"?{id:"workspace-a",channelId:"channel-a",state:ConversationViewState.Active,participantPrincipalIds:["human-a","human-b"],operationId:"operation",version:1}:undefined;
  await act(async () => root.render(<TooltipProvider><ChannelPane workspaceId="workspace-a" channelId="channel-a" myPrincipalId="human-a" conversation={conversation} /></TooltipProvider>));
  if(conversation) await act(async()=>{
    state.receive!({type:"snapshot",events:[{id:"event-a",pubkey:"author-a",kind:9,created_at:1,tags:[["h","channel-a"]],content:"existing message"},
      {id:"dm-bounds",pubkey:"relay",kind:39006,created_at:1,tags:[["d","channel-a:head"]],content:JSON.stringify({has_more:false,next_cursor:null})}]});
    state.receive!({type:"live"});
  });
  await vi.waitFor(() => expect(host.querySelector('[data-testid="reply-message-event-a"]')).not.toBeNull());
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="reply-message-event-a"]')!.click());
  const indicators = () => JSON.parse(host.querySelector('[data-testid="thread-lifetime"]')!.getAttribute("data-typing")!);
  const now = Math.floor(Date.now() / 1000);
  const send = (id:string, pubkey:string, created_at=now, kind=20002) => act(async () => state.receive!({type:"event",event:{id,pubkey,created_at,kind,tags:[["h","channel-a"],["e","event-a","","reply"]],content:kind===20002 ? "" : "reply"}}));
  await send("typing-self", "self-key");
  if(!conversation) await send("typing-agent", "agent");
  await send("typing-expired", "expired", now-9);
  await send("typing-peer", "peer");
  expect(indicators()).toEqual([{pubkey:"peer",threadHeadId:"event-a"}]);
  await send("completed-peer", "peer", now, 9);
  expect(indicators()).toEqual([]);
  await send("typing-next", "next-peer");
  expect(indicators()).toEqual([{pubkey:"next-peer",threadHeadId:"event-a"}]);
  await act(async () => state.receive!({type:"closed",reason:"readmission-unavailable"}));
  expect(host.querySelector('[data-testid="thread-lifetime"]')).toBeNull();
});

it.each([9, 40002])("highlights only the matching searchable kind %s live body and clears it on ordinary navigation", async (kind) => {
  state.richContent = true;
  const mountSearch = (query?:string) => act(async () => root.render(<TooltipProvider><ChannelPane workspaceId="workspace-a" channelId="channel-a" myPrincipalId="human-a"
    targetSearchMessageId={query ? "search-result" : undefined} targetSearchQuery={query} /></TooltipProvider>));
  await mountSearch("needle");
  await act(async () => {
    for (const id of ["search-result","other-result"]) state.receive!({type:"event",event:{id,pubkey:"author-a",kind,created_at:2,tags:[],content:"needle **needle** `needle`"}});
  });
  await vi.waitFor(() => expect(host.querySelectorAll('[data-message-id="search-result"] [data-search-match="true"]')).toHaveLength(2));
  expect(host.querySelector('[data-message-id="other-result"] [data-search-match="true"]')).toBeNull();
  expect(host.querySelector('code [data-search-match="true"]')).toBeNull();
  await mountSearch();
  expect(host.querySelector('[data-search-match="true"]')).toBeNull();
  await act(async () => state.receive!({type:"closed",reason:"scope-revoked"}));
  expect(host.querySelector('[data-message-id="search-result"]')).toBeNull();
});

it("routes ordinary live DM messages through the DM slot while honoring self, mute and revocation", async () => {
  const conversation = { id: "dm", channelId: "channel-a", state: ConversationViewState.Active, participantPrincipalIds: ["human-a", "human-b"], operationId: "op", version: 1 };
  state.members.data = [{ principalId: "human-a", pubkeys: ["own"], displayName: "Me" }, { principalId: "human-b", pubkeys: ["peer"], displayName: "Alice" }];
  const mountDm = async () => act(async () => { root.render(<TooltipProvider><ChannelPane workspaceId="workspace-a" channelId="channel-a" myPrincipalId="human-a" conversation={conversation} /></TooltipProvider>); });
  await mountDm();
  await act(async () => {
    state.receive!({type: "snapshot", events: [{id: "dm-bounds", pubkey: "relay", kind: 39006, created_at: 1, tags: [["d", "channel-a:head"]], content: JSON.stringify({has_more: false, next_cursor: null})}]});
    state.receive!({type: "live"});
  });
  const send = async (id: string, pubkey = "peer") => act(async () => {
    state.receive!({ type: "event", event: {id, pubkey, kind: 9, created_at: 2, tags: [], content: "DM content"} });
  });
  await send("dm-message");
  expect(state.notify).toHaveBeenCalledWith(expect.objectContaining({ eventId: "dm-message", title: "Alice", body: "DM content", slot: "dm" }));
  await send("self", "own");
  expect(state.notify).toHaveBeenCalledTimes(1);
  state.userState.data.conversationPreferences = {dm: {muted: true}};
  await mountDm();
  await send("muted");
  expect(state.notify).toHaveBeenCalledTimes(1);
  await act(async () => { state.receive!({type: "closed", reason: "scope-revoked"}); });
  await send("revoked");
  expect(state.notify).toHaveBeenCalledTimes(1);
});

it("alerts replies in followed threads and never in muted ones, per the original shouldNotifyForEvent (DD-125(1))", async () => {
  state.members.data = [{ principalId: "human-a", pubkeys: ["own"], displayName: "Me" }, { principalId: "human-b", pubkeys: ["peer"], displayName: "Alice" }];
  let followed = new Set<string>(), muted = new Set<string>();
  const preferences = { writable: true, isFollowingThread: (id: string) => followed.has(id), isThreadMuted: (id: string) => muted.has(id) } as unknown as CollaborationPreferenceActions;
  await act(async () => { root.render(<CollaborationPreferencesProvider value={preferences}><TooltipProvider>
    <ChannelPane workspaceId="workspace-a" channelId="channel-a" myPrincipalId="human-a" /></TooltipProvider></CollaborationPreferencesProvider>); });
  await act(async () => {
    state.receive!({ type: "snapshot", events: [{ id: "event-a", pubkey: "author-a", kind: 9, created_at: 1, tags: [], content: "existing message" },
      { id: "bounds", pubkey: "relay", kind: 39006, created_at: 1, tags: [["d", "channel-a:head"]], content: JSON.stringify({ has_more: false, next_cursor: null }) }] });
    state.receive!({ type: "live" });
  });
  const reply = (id: string, pubkey = "peer") => act(async () => {
    state.receive!({ type: "event", event: { id, pubkey, kind: 9, created_at: 3, tags: [["e", "event-a", "", "root"], ["e", "event-a", "", "reply"]], content: "Reply" } });
  });
  await reply("unfollowed-reply");
  expect(state.notify).not.toHaveBeenCalled();
  followed = new Set(["event-a"]);
  await reply("followed-reply");
  expect(state.notify).toHaveBeenCalledWith(expect.objectContaining({ eventId: "followed-reply", slot: "thread_reply" }));
  // Unfollowing mutes: even the person's own participation no longer alerts.
  followed = new Set(); muted = new Set(["event-a"]);
  await reply("own-reply", "own");
  await reply("muted-reply");
  expect(state.notify).toHaveBeenCalledTimes(1);
});

it("opens a DM mention against the admitted second-device author event and drops it on revocation", async () => {
  const firstKey = "11".repeat(32);
  const secondKey = "22".repeat(32);
  const ownKey = "33".repeat(32);
  const authorEventId = "44".repeat(32);
  const mentionEventId = "55".repeat(32);
  const conversation = { id: "dm-multiple-keys", channelId: "dm-channel", state: ConversationViewState.Active, participantPrincipalIds: ["human-a", "human-b"], operationId: "op", version: 1 };
  state.members.data = [
    { principalId: "human-a", pubkeys: [ownKey], displayName: "Me" },
    { principalId: "human-b", pubkeys: [firstKey, secondKey], displayName: "Alice" },
  ];
  state.richContent = true;
  await act(async () => { root.render(<TooltipProvider><ChannelPane workspaceId={conversation.id} myPrincipalId="human-a" conversation={conversation} /></TooltipProvider>); });
  const authorEvent = { id: authorEventId, pubkey: secondKey, kind: 9, created_at: 1, tags: [["h", conversation.channelId]], content: "admitted second-device message" };
  const mentionEvent = { id: mentionEventId, pubkey: ownKey, kind: 9, created_at: 2, tags: [["h", conversation.channelId], ["p", secondKey]], content: "Hello @Alice" };
  const snapshot = [mentionEvent, authorEvent,
    { id: "dm-second-key-bounds", pubkey: "relay", kind: 39006, created_at: 1, tags: [["d", `${conversation.channelId}:head`]], content: JSON.stringify({ has_more: false, next_cursor: null }) }];
  await act(async () => {
    state.receive!({ type: "snapshot", events: snapshot });
    state.receive!({ type: "live" });
  });
  const chip = host.querySelector<HTMLElement>(`[data-event-id="${mentionEventId}"] [data-mention-pubkey="${secondKey}"]`);
  expect(chip).not.toBeNull();
  expect(host.querySelector(`[data-event-id="${mentionEventId}"] [data-mention-pubkey="${firstKey}"]`)).toBeNull();
  expect(chip!.closest('[role="button"]')).not.toBeNull();
  await act(async () => chip!.click());
  const profile = host.querySelector<HTMLElement>('[data-testid="close-author"]');
  expect(profile).not.toBeNull();
  expect(JSON.parse(profile!.dataset.authorTarget!)).toEqual({ principalId: "human-a", workspaceId: conversation.id, conversationId: conversation.id, eventId: authorEventId, pubkey: secondKey });
  await act(async () => {
    state.receive!({ type: "closed", reason: "scope-revoked" });
    state.receive!({ type: "snapshot", events: snapshot });
    state.receive!({ type: "live" });
  });
  expect(host.querySelector('[data-testid="close-author"]')).toBeNull();
  expect(host.querySelector('[data-mention]')).toBeNull();
  expect(render()).not.toContain("admitted second-device message");
});

it("restores the actual DM intro once per human, using the admitted second-device author for profile access", async () => {
  const ownKey="11".repeat(32), firstKey="22".repeat(32), secondKey="33".repeat(32);
  const conversation={id:"dm-intro",channelId:"dm-channel",state:ConversationViewState.Active,
    participantPrincipalIds:["human-a","human-b"],operationId:"op",version:1};
  state.members.data=[{principalId:"human-a",pubkeys:[ownKey,"44".repeat(32)],displayName:"Me"},
    {principalId:"human-b",pubkeys:[firstKey,secondKey],displayName:"Alice"}];
  await act(async()=>root.render(<TooltipProvider><ChannelPane key="dm-intro" workspaceId={conversation.id}
    myPrincipalId="human-a" conversation={conversation}/></TooltipProvider>));
  await act(async()=>{
    state.receive!({type:"snapshot",events:[{id:"dm-intro-bounds",pubkey:"relay",kind:39006,created_at:1,
      tags:[["d",`${conversation.channelId}:head`]],content:JSON.stringify({has_more:false,next_cursor:null})}]});
    state.receive!({type:"live"});
  });
  let intro=host.querySelector('[data-testid="message-dm-intro"]');
  expect(state.memberReads).toContainEqual(["platform","conversation-members",conversation.id,"human-a",
    {conversationId:conversation.id,participantPrincipalIds:conversation.participantPrincipalIds}]);
  expect(intro?.textContent).toContain("This is the beginning of your direct message with Alice.");
  expect(intro?.querySelectorAll('[data-testid="message-dm-intro-avatar-stack-participant"]')).toHaveLength(1);
  expect(intro?.querySelector('[role="button"]')).toBeNull();
  const author={id:"55".repeat(32),pubkey:secondKey,kind:9,created_at:2,tags:[["h",conversation.channelId]],content:"actual DM author"};
  await act(async()=>state.receive!({type:"event",event:author}));
  intro=host.querySelector('[data-testid="message-dm-intro"]');
  const profileTrigger=intro?.querySelector<HTMLElement>('[role="button"]');
  expect(profileTrigger).not.toBeNull();
  await act(async()=>profileTrigger!.click());
  expect(JSON.parse(host.querySelector<HTMLElement>('[data-testid="close-author"]')!.dataset.authorTarget!)).toEqual({
    principalId:"human-a",workspaceId:conversation.id,conversationId:conversation.id,eventId:author.id,pubkey:secondKey});
  await act(async()=>state.receive!({type:"closed",reason:"scope-revoked"}));
  expect(host.querySelector('[data-testid="message-dm-intro"]')).toBeNull();
});

it.each(["missing-recipient","duplicate-principal","inactive-conversation"])("does not present a DM intro from %s directory facts",async boundary=>{
  const ownKey="11".repeat(32),peerKey="22".repeat(32);
  const conversation={id:"dm-untrusted-intro",channelId:"dm-channel",state:boundary==="inactive-conversation"?ConversationViewState.Disabled:ConversationViewState.Active,
    participantPrincipalIds:["human-a","human-b"],operationId:"op",version:1};
  state.members.data=[{principalId:"human-a",pubkeys:[ownKey],displayName:"Me"}];
  if(boundary!=="missing-recipient")state.members.data.push({principalId:"human-b",pubkeys:[peerKey],displayName:"Alice"});
  if(boundary==="duplicate-principal")state.members.data.push({principalId:"human-b",pubkeys:[peerKey],displayName:"Fake duplicate"});
  await act(async()=>root.render(<TooltipProvider><ChannelPane key={boundary} workspaceId={conversation.id} myPrincipalId="human-a" conversation={conversation}/></TooltipProvider>));
  await act(async()=>{state.receive!({type:"snapshot",events:[{id:"dm-untrusted-bounds",pubkey:"relay",kind:39006,created_at:1,
    tags:[["d",`${conversation.channelId}:head`]],content:JSON.stringify({has_more:false,next_cursor:null})}]});state.receive!({type:"live"});});
  expect(host.querySelector('[data-testid="message-dm-intro"]')).toBeNull();
});

it("partitions the actual recipient read when the same workspace switches DM or that DM's people change", async () => {
  const ownKey="11".repeat(32),aliceKey="22".repeat(32),bobKey="33".repeat(32),carolKey="44".repeat(32);
  const first={id:"dm-first",channelId:"channel-first",state:ConversationViewState.Active,
    participantPrincipalIds:["human-a","alice"],operationId:"op",version:1};
  const second={...first,id:"dm-second",channelId:"channel-second",participantPrincipalIds:["human-a","bob"]};
  const changed={...second,participantPrincipalIds:["human-a","bob","carol"]};
  async function open(conversation: typeof first) {
    await act(async()=>root.render(<TooltipProvider><ChannelPane key="switch-dm" workspaceId="same-workspace" myPrincipalId="human-a" conversation={conversation}/></TooltipProvider>));
    await act(async()=>{state.receive!({type:"snapshot",events:[{id:`${conversation.id}-bounds`,pubkey:"relay",kind:39006,created_at:1,
      tags:[["d",`${conversation.channelId}:head`]],content:JSON.stringify({has_more:false,next_cursor:null})}]});state.receive!({type:"live"});});
    expect(state.memberReads).toContainEqual(["platform","conversation-members","same-workspace","human-a",
      {conversationId:conversation.id,participantPrincipalIds:conversation.participantPrincipalIds}]);
    return host.querySelector('[data-testid="message-dm-intro"]')?.textContent;
  }
  state.members.data=[{principalId:"human-a",pubkeys:[ownKey],displayName:"Me"},{principalId:"alice",pubkeys:[aliceKey],displayName:"Alice"}];
  expect(await open(first)).toContain("with Alice.");
  state.members.data=[{principalId:"human-a",pubkeys:[ownKey],displayName:"Me"},{principalId:"bob",pubkeys:[bobKey],displayName:"Bob"},
    {principalId:"carol",pubkeys:[carolKey],displayName:"Carol"}];
  expect(await open(second)).toContain("with Bob.");
  expect(await open(changed)).toContain("with Bob, Carol.");
  state.members.data.push({principalId:"dave",pubkeys:["55".repeat(32)],displayName:"Dave"},
    {principalId:"eve",pubkeys:["66".repeat(32)],displayName:"Eve"});
  expect(await open({...second,participantPrincipalIds:["human-a","bob","carol","dave","eve"]})).toContain("with Bob, Carol, Dave, +1 more.");
  await act(async()=>setLocale("zh-CN"));
  expect(host.querySelector('[data-testid="message-dm-intro"]')?.textContent).toContain("这是你与Bob, Carol, Dave, +1 人的私聊开始。");
});

it("copies the actual message link through the HTTP host and preserves clipboard refusal", async () => {
  const success = vi.spyOn(toast, "success"), error = vi.spyOn(toast, "error");
  const previousExec = Object.getOwnPropertyDescriptor(document, "execCommand");
  const copied: string[] = [];
  const exec = vi.fn(() => { copied.push((document.activeElement as HTMLTextAreaElement).value); return true; });
  Object.defineProperty(document, "execCommand", {configurable: true, value: exec});
  vi.stubGlobal("navigator", Object.create(navigator, {clipboard: {value: undefined}}));
  try {
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Copy link"]')!;
    expect(button).not.toBeNull();
    await act(async () => button.click());
    expect(copied).toEqual(["buzz://message?channel=channel-a&id=event-a"]);
    expect(success).toHaveBeenCalledWith("buzz.copiedLink");
    expect(error).not.toHaveBeenCalled();
    expect(document.querySelector('textarea[aria-hidden="true"]')).toBeNull();
    success.mockClear();
    exec.mockReturnValue(false);
    await act(async () => button.click());
    expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("buzz.copyFailed");
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", Object.create(navigator, {clipboard: {value: {writeText}}}));
    const fallbackCalls = exec.mock.calls.length;
    await act(async () => button.click());
    expect(writeText).toHaveBeenCalledWith("buzz://message?channel=channel-a&id=event-a");
    expect(exec).toHaveBeenCalledTimes(fallbackCalls);
    expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(2);
  } finally {
    if (previousExec) Object.defineProperty(document, "execCommand", previousExec);
    else Reflect.deleteProperty(document, "execCommand");
  }
});

it("copies the actual row's edited reference mention with its exact second-device identity", async () => {
  const firstKey = "11".repeat(32), secondKey = "22".repeat(32), ownKey = "33".repeat(32);
  state.members.data = [{principalId:"human-b",pubkeys:[firstKey,secondKey],displayName:"Alice"},
    {principalId:"human-a",pubkeys:[ownKey],displayName:"Me"}];
  const write = vi.fn();
  vi.stubGlobal("navigator", Object.create(navigator, {platform:{value:navigator.platform},clipboard:{value:{write,writeText:vi.fn()}}}));
  vi.stubGlobal("ClipboardItem", class { constructor(public readonly data: Record<string, Blob>) {} });
  await act(async () => { root.render(<TooltipProvider><ChannelPane key="copy-channel" workspaceId="workspace-a" channelId="channel-a" myPrincipalId="human-a" /></TooltipProvider>); });
  await act(async () => {
    state.receive!({type:"snapshot",events:[{id:"copy-mention",pubkey:ownKey,kind:9,created_at:2,
      content:"Hello @Alice",tags:[["h","channel-a"],["p",firstKey],["buzz:mention-snapshot"],["mention",secondKey]]},
      {id:"copy-bounds",pubkey:"relay",kind:39006,created_at:2,tags:[["d","channel-a:head"]],content:JSON.stringify({has_more:false,next_cursor:null})}]});
    state.receive!({type:"live"});
  });
  const trigger = host.querySelector<HTMLElement>('[data-testid="more-actions-copy-mention"]');
  expect(host.textContent).toContain("Hello @Alice");
  expect(trigger).not.toBeNull();
  await act(async () => { trigger!.focus(); trigger!.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true})); });
  const copy = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === "Copy message");
  expect(copy).toBeDefined();
  await act(async () => copy!.click());
  expect(write).toHaveBeenCalledTimes(1);
  const data = write.mock.calls[0]![0][0].data as Record<string,Blob>;
  const read = (blob: Blob) => new Promise<string>((resolve,reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob);
  });
  expect(await read(data["text/plain"]!)).toBe("Hello @Alice");
  expect(parseMentionClipboardRecords(await read(data["text/html"]!))).toEqual([{label:"Alice",pubkey:secondKey}]);
});

it.each(["session-revoked", "scope-revoked", "identity-revoked"])(
  "removes message and write controls after %s and cannot be revived by a late frame",
  async (reason) => {
    expect(render()).toContain("existing message");
    expect(render()).toContain('data-testid="message-composer"');
    await act(async () => {
    state.receive!({ type: "closed", reason });
    state.receive!({ type: "live" });
    state.receive!({
      type: "snapshot",
      events: [
        {
          id: "late",
          pubkey: "author-a",
          kind: 9,
          created_at: 2,
          tags: [],
          content: "late message",
        },
      ],
    });
    });
    const markup = render();
    expect(markup).not.toContain("existing message");
    expect(markup).not.toContain("late message");
    expect(markup).not.toContain('data-testid="message-composer"');
    expect(markup).not.toContain('data-testid="attach-input"');
    expect(markup).toContain(
      reason === "session-revoked" ? "SESSION_NOT_ACTIVE" : "PERMISSION_DENIED",
    );
    expect(markup).not.toContain("platform.stream.synced");
  },
);

it("keeps an uncertain connection distinct from a denial", async () => {
  await act(async () => state.receive!({ type: "closed", reason: "readmission-unavailable" }));
  const markup = render();
  expect(markup).toContain("platform.stream.reconnecting");
  expect(markup).toContain("existing message");
  expect(markup).toContain('data-testid="message-composer"');
  expect(markup).not.toContain("PERMISSION_DENIED");
});

it("keeps the existing reply mounted while an author profile opens and closes", async () => {
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="reply-message-event-a"]')!.click());
  const thread = host.querySelector('[data-testid="thread-lifetime"]')!;
  await act(async () => thread.querySelector<HTMLButtonElement>('button')!.click());
  await act(async () => [...thread.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === "thread author")!.click());
  expect(host.querySelector('[data-testid="thread-lifetime"]')).toBe(thread);
  expect(thread.textContent).toContain("reply pending");
  expect(thread.closest(".hidden")).not.toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="close-author"]')!.click());
  expect(thread.closest(".hidden")).toBeNull();
  expect(thread.textContent).toContain("reply pending");
  const author = host.querySelector<HTMLElement>('[data-event-id="event-a"] [role="button"][aria-label="Profile"]')!;
  await act(async () => author.click());
  expect(host.querySelector('[data-testid="thread-lifetime"]')).toBe(thread);
  await act(async () => [...thread.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === "thread unavailable")!.click());
  expect(host.querySelector('[data-testid="close-author"]')).toBeNull();
  expect(thread.textContent).toContain("reply pending");
});

it("opens an off-window thread search target only from the freshly admitted original context",async()=>{
  const rootId="a".repeat(64),replyId="b".repeat(64),pubkey="c".repeat(64);
  const rootEvent={id:rootId,pubkey,kind:9,created_at:1,createdAt:1,channelId:"workspace-a",category:"activity" as const,tags:[["h","workspace-a"]],content:"Original thread root"};
  const reply={...rootEvent,id:replyId,createdAt:2,created_at:2,content:"Original thread target",tags:[["h","workspace-a"],["e",rootId,"","root"],["e",rootId,"","reply"]]};
  state.route.thread.isFetching=true;
  const mount=(activationId="first")=>act(async()=>root.render(<TooltipProvider><ChannelPane workspaceId="workspace-a" channelId="channel-a" myPrincipalId="human-a" targetMessageId={replyId} targetThreadRootId={rootId} targetSearchMessageId={replyId} targetSearchQuery="target" targetSearchActivationId={activationId}/></TooltipProvider>));
  state.route.messages=[rootEvent,reply];
  await mount();
  expect(host.querySelector('[data-testid="thread-lifetime"]')).toBeNull();
  state.route.thread.isFetching=false;
  await mount();
  expect(state.routeRead).toHaveBeenLastCalledWith("human-a","workspace-a",rootId,undefined,undefined,true,undefined);
  const thread=host.querySelector<HTMLElement>('[data-testid="thread-lifetime"]');
  expect(thread?.dataset.selectedId).toBe(replyId);expect(thread?.dataset.routeTarget).toBe(replyId);
  await act(async()=>[...thread!.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==="close thread")!.click());
  await vi.waitFor(()=>expect(host.querySelector('[data-testid="thread-lifetime"]')).toBeNull());
  await mount("second");
  expect(host.querySelector<HTMLElement>('[data-testid="thread-lifetime"]')?.dataset.routeTarget).toBe(replyId);
  // The original timeline holds older prepends until its quiet-window and
  // stable-frame conditions agree; do not mistake that real admission delay
  // for a missing root or replace the gate in this consumer check.
  await act(async()=>{
    await new Promise(resolve=>setTimeout(resolve,SETTLE_MOTION_WINDOW_MS));
    for(let frame=0;frame<SETTLE_FRAME_COUNT;frame++) await new Promise(requestAnimationFrame);
  });
  expect(host.querySelector(`[data-message-id="${rootId}"]`)).not.toBeNull();
  expect(host.querySelector(`[data-message-id="${replyId}"]`)).toBeNull();
  expect(host.textContent).not.toContain("platform.linkMessageOutsideHistory");
  await act(async()=>state.receive!({type:"closed",reason:"scope-revoked"}));
  expect(state.routeRead).toHaveBeenLastCalledWith("human-a","workspace-a",rootId,undefined,undefined,false,undefined);
  expect(host.querySelector(`[data-message-id="${rootId}"]`)).toBeNull();
});

it("does not accept denied or incomplete route ancestry as a usable thread",async()=>{
  const rootId="d".repeat(64),replyId="e".repeat(64);
  state.route.messages=[{id:replyId,pubkey:"f".repeat(64),kind:9,created_at:2,createdAt:2,channelId:"workspace-a",category:"activity",content:"Unresolved reply",tags:[["h","workspace-a"],["e",rootId,"","root"],["e",rootId,"","reply"]]}];
  const mount=()=>act(async()=>root.render(<TooltipProvider><ChannelPane workspaceId="workspace-a" channelId="channel-a" myPrincipalId="human-a" targetMessageId={replyId} targetThreadRootId={rootId}/></TooltipProvider>));
  await mount();expect(host.querySelector('[data-testid="thread-lifetime"]')).toBeNull();
  state.route.denied=true;
  await mount();expect(host.querySelector('[data-testid="thread-lifetime"]')).toBeNull();
  expect(host.textContent).not.toContain("Unresolved reply");
});

it("opens an off-window DM link using the admitted conversation root and the original thread panel",async()=>{
  const rootId="a".repeat(64),replyId="b".repeat(64),pubkey="c".repeat(64);
  const conversation={id:"dm",channelId:"channel-a",state:ConversationViewState.Active,participantPrincipalIds:["human-a","human-b"],operationId:"op",version:1};
  const rootEvent={id:rootId,pubkey,kind:9,created_at:1,createdAt:1,channelId:"channel-a",category:"activity" as const,tags:[["h","channel-a"]],content:"Original DM root"};
  state.route.messages=[rootEvent,{...rootEvent,id:replyId,created_at:2,createdAt:2,content:"Original DM reply",tags:[["h","channel-a"],["e",rootId,"","root"],["e",rootId,"","reply"]]}];
  await act(async()=>root.render(<TooltipProvider><ChannelPane workspaceId="workspace-a" channelId="channel-a" myPrincipalId="human-a" conversation={conversation} targetMessageId={replyId} targetThreadRootId={rootId}/></TooltipProvider>));
  await act(async()=>{
    state.receive!({type:"snapshot",events:[{id:"bounds",pubkey:"relay",kind:39006,created_at:1,tags:[["d","channel-a:head"]],content:JSON.stringify({has_more:false,next_cursor:null})}]});
    state.receive!({type:"live"});
  });
  expect(state.routeRead).toHaveBeenLastCalledWith("human-a","workspace-a",rootId,"dm",undefined,true,conversation.channelId);
  const pane=host.querySelector<HTMLElement>('[data-testid="thread-lifetime"]');
  expect(pane?.dataset.conversationId).toBe("dm");
  expect(pane?.dataset.selectedId).toBe(replyId);expect(pane?.dataset.routeTarget).toBe(replyId);
  await act(async()=>state.receive!({type:"closed",reason:"scope-revoked"}));
  expect(state.routeRead).toHaveBeenLastCalledWith("human-a","workspace-a",rootId,"dm",undefined,false,conversation.channelId);
});

it("shows a working Agent in the original composer activity row from its 20002, not as a person typing (DD-125(6))", async () => {
  state.channelAgents.data=[{resourceId:"inst-scout",workspaceId:"workspace-a",agentPubkey:"agent",agentDisplayName:"Scout",canAudit:false}];
  await act(async () => root.render(<TooltipProvider><ChannelPane workspaceId="workspace-a" channelId="channel-a" myPrincipalId="human-a" /></TooltipProvider>));
  const now = Math.floor(Date.now() / 1000);
  await act(async () => state.receive!({type:"event",event:{id:"typing-agent",pubkey:"agent",created_at:now,kind:20002,
    tags:[["h","channel-a"],["e","root-a","","reply"]],content:""}}));
  await vi.waitFor(() => expect(host.querySelector('[data-testid="bot-activity-composer-trigger"]')).not.toBeNull());
  const row = host.querySelector<HTMLElement>('[data-testid="channel-composer-activity-row"]')!;
  expect(row.textContent).toContain("Scout");
  expect(row.querySelector('[data-testid="message-typing-indicator"]')).toBeNull();
  expect(host.querySelector('[data-testid="bot-activity-composer-trigger"]')!.getAttribute("aria-label")).toContain("Scout");
});
