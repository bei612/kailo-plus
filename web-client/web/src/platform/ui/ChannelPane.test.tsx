// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StreamFrame } from "../bff-client";
import { ChannelPane } from "./ChannelPane";
import { setLocale } from "@client-kit/platform/i18n";
import type { TimelineMessage } from "@client-kit/platform/react/messages";
import { ItemState } from "@client-kit/contracts";
import type { MessageAuthor } from "./MessageAuthorProfile";
import { parseMentionClipboardRecords } from "@client-kit/platform/react/composer/features/messages/lib/mentionClipboard";
import { SETTLE_FRAME_COUNT, SETTLE_MOTION_WINDOW_MS } from "@client-kit/platform/react/messages/timeline/useSettleGatedPrependMessages";

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
  emoji: { isSuccess: true, data: { events: [] } },
  infinite: { data: { pages: [] }, isSuccess: true },
  queryClient: { invalidateQueries: vi.fn() },
  mutation: { isPending: false, mutate: vi.fn() },
  route: {messages:[] as import("./inbox-events").Event[],denied:false,interrupted:false,
    thread:{isSuccess:true,isError:false,isFetching:false,hasNextPage:false,isFetchingNextPage:false,fetchNextPage:vi.fn()}},
  routeRead:vi.fn(),
}));
vi.mock("./useWorkspaceThread",()=>({useWorkspaceThread:(...args:unknown[])=>{state.routeRead(...args);return state.route;}}));
vi.mock("@client-kit/platform/react/context", async (original) => ({
  ...await original<typeof import("@client-kit/platform/react/context")>(),
  useReasonText: () => state.reason,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: readonly unknown[] }) => {
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
  return { ChannelThreadPane: ({selected, routeTargetMessageId, onOpenAuthor, onAuthorScopeUnavailable}: {
    selected: TimelineMessage; onOpenAuthor: (message: TimelineMessage) => void; onAuthorScopeUnavailable: () => void;
    routeTargetMessageId?:string;
  }) => {
    const [pending, setPending] = useState(false);
    return <section data-testid="thread-lifetime" data-selected-id={selected.id} data-route-target={routeTargetMessageId}>
      <button onClick={() => setPending(true)}>pending reply</button>
      <output>{pending ? "reply pending" : "reply idle"}</output>
      <button onClick={() => onOpenAuthor(selected)}>thread author</button>
      <button onClick={onAuthorScopeUnavailable}>thread unavailable</button>
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
  state.stop.mockClear();
  state.notify.mockClear();
  state.richContent = false;
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

it("routes ordinary live DM messages through the DM slot while honoring self, mute and revocation", async () => {
  const conversation = { id: "dm", channelId: "channel-a", state: ItemState.Active, participantPrincipalIds: ["human-a", "human-b"], operationId: "op", version: 1 };
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

it("opens a DM mention against the admitted second-device author event and drops it on revocation", async () => {
  const firstKey = "11".repeat(32);
  const secondKey = "22".repeat(32);
  const ownKey = "33".repeat(32);
  const authorEventId = "44".repeat(32);
  const mentionEventId = "55".repeat(32);
  const conversation = { id: "dm-multiple-keys", channelId: "dm-channel", state: ItemState.Active, participantPrincipalIds: ["human-a", "human-b"], operationId: "op", version: 1 };
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
  const conversation={id:"dm-intro",channelId:"dm-channel",state:ItemState.Active,
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
  const conversation={id:"dm-untrusted-intro",channelId:"dm-channel",state:boundary==="inactive-conversation"?ItemState.Disabled:ItemState.Active,
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
  const first={id:"dm-first",channelId:"channel-first",state:ItemState.Active,
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

it("copies the actual row's edited reference mention with its exact second-device identity", async () => {
  const firstKey = "11".repeat(32), secondKey = "22".repeat(32), ownKey = "33".repeat(32);
  state.members.data = [{principalId:"human-b",pubkeys:[firstKey,secondKey],displayName:"Alice"},
    {principalId:"human-a",pubkeys:[ownKey],displayName:"Me"}];
  const write = vi.fn();
  vi.stubGlobal("navigator", Object.create(navigator, {clipboard:{value:{write,writeText:vi.fn()}}}));
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
  const mount=()=>act(async()=>root.render(<TooltipProvider><ChannelPane workspaceId="workspace-a" channelId="channel-a" myPrincipalId="human-a" targetMessageId={replyId} targetThreadRootId={rootId}/></TooltipProvider>));
  state.route.messages=[rootEvent,reply];
  await mount();
  expect(host.querySelector('[data-testid="thread-lifetime"]')).toBeNull();
  state.route.thread.isFetching=false;
  await mount();
  expect(state.routeRead).toHaveBeenLastCalledWith("human-a","workspace-a",rootId,undefined,undefined,true);
  const thread=host.querySelector<HTMLElement>('[data-testid="thread-lifetime"]');
  expect(thread?.dataset.selectedId).toBe(replyId);expect(thread?.dataset.routeTarget).toBe(replyId);
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
  expect(state.routeRead).toHaveBeenLastCalledWith("human-a","workspace-a",rootId,undefined,undefined,false);
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
