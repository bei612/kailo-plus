// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { BffError, TransportError } from "@client-kit/platform/transport";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { frameData, frameSteps, MotionGlobalConfig } from "motion/react";
import { ItemState, type ConversationView, type ReadMarkRequest } from "@client-kit/contracts";
import type { StreamFrame, UserState } from "../bff-client";
import { ChannelPane } from "./ChannelPane";
import { platformQueries } from "./queries";
import { setLocale } from "@client-kit/platform/i18n";
import { setThreadViewMode } from "@client-kit/platform/react/thread/threadViewModePreference";
import { clearAllDrafts, loadDraftEntry, saveDraftEntry } from "@client-kit/platform/react/composer/features/messages/lib/useDrafts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({
  receive: null as null | ((frame: StreamFrame) => void),
  fetch: vi.fn(),
  mark: vi.fn(),
  notify: vi.fn(),
  publish: vi.fn(),
  delete: vi.fn(),
  members: vi.fn(),
  stream: vi.fn(),
  history: vi.fn(),
  reaction: vi.fn(),
  authorProfile:vi.fn(),dmAuthorProfile:vi.fn(),
  reason: (value: string) => value,
}));
vi.mock("@client-kit/platform/react/context", async (original) => ({
  ...await original<typeof import("@client-kit/platform/react/context")>(), useReasonText: () => state.reason,
  useLocale: () => "en", useT: () => state.reason,
}));
vi.mock("./BrowserNotifications", () => ({ useBrowserNotifications: () => ({ notify: state.notify, settings: { homeBadgeEnabled: true } }) }));
vi.mock("./useWorkspaceThread", () => ({ useWorkspaceThread: () => ({
  messages: threadMessages, denied: false, interrupted: false, refresh: vi.fn(),
  thread: {isSuccess: true, isPending: false, isError: false, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn(), refetch: vi.fn()},
}) }));
vi.mock("@/platform/bff-client", async () => ({
  BffError: (await import("@client-kit/platform/transport")).BffError,
  bff: {
    members: () => state.members(),
    conversationParticipants:async()=>({items:[],nextCursor:null}),
    workspaces: async () => [],
    agentInstallations: async () => ({ installations: [] }),
    profile: async () => ({pubkey:"mine"}),
    customEmoji: async () => ({events:[],mediaPaths:{}}),
    workspaceMessages: (...args: unknown[]) => state.history(...args),
    conversationMessages:(...args:unknown[])=>state.history(...args),
    messageAuthorProfile:(...args:unknown[])=>state.authorProfile(...args),
    conversationMessageAuthorProfile:(...args:unknown[])=>state.dmAuthorProfile(...args),
  },
  fetchUserState: () => state.fetch(),
  markRead: (request: ReadMarkRequest) => state.mark(request),
  publishMessage: (...args: unknown[]) => state.publish(...args),
  deleteMessage: (...args: unknown[]) => state.delete(...args),
  publishMessageReaction:(...args:unknown[])=>state.reaction(...args),
  uploadMedia: vi.fn(),
  openStream: (_workspace: string, receive: (frame: StreamFrame) => void) => {
    state.stream(_workspace);
    state.receive = receive;
    return () => {};
  },
}));
vi.mock("@/features/chat/ui/MessageContent", () => ({ MessageContent: () => null }));
vi.mock("@/shared/i18n", () => ({ t: (key: string) => key, getLocale: () => "en" }));

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
let projection: UserState;
const event = (seconds: number) => ({
  id: `event-${seconds}`,
  kind: 9,
  pubkey: "other",
  created_at: seconds,
  tags: [["h", "channel-a"]],
  content: "",
});
const threadMessages = [{...event(10), createdAt: 10}];
const windowEvents = (events: ReturnType<typeof event>[]) => [...events, {
  ...event(0), id: "bounds", kind: 39006, tags: [["d", "channel-a:head"]],
  content: JSON.stringify({ has_more: false, next_cursor: null }),
}];
async function flush() {
  // Exercise real React effects and Query's notification queue repeatedly.
  for (let i = 0; i < 20; i++)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
      // Advance the real Motion frame steps on this deterministic test clock.
      // jsdom's rAF scheduler was captured before Vitest installed fake timers.
      frameData.delta = 10;
      frameData.timestamp += 10;
      frameData.isProcessing = true;
      try {
        for (const step of Object.values(frameSteps)) step.process(frameData);
      } finally {
        frameData.isProcessing = false;
      }
    });
}
async function renderChannel(props: { archived?: boolean; metadataPending?: boolean;conversation?:ConversationView } = {}) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <TooltipProvider><ChannelPane workspaceId="workspace-a" channelId="channel-a" channelName="Original channel" myPrincipalId="human-a" {...props} /></TooltipProvider>
      </QueryClientProvider>,
    );
  });
}
async function open() {
  await renderChannel();
  await act(async () => {
    state.receive!({ type: "snapshot", events: windowEvents([event(10)]) });
    state.receive!({ type: "live" });
  });
  await flush();
}
function retry() {
  const button = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "platform.retry",
  );
  if (!button) throw new Error("Missing retry");
  return button;
}

it("applies a live same-author edit to one existing row without counting or notifying a new message", async () => {
  await open();
  state.notify.mockClear();
  const edited = {...event(11),kind:40003,content:"edited",tags:[["h","channel-a"],["e","event-10"]]};
  await act(async () => state.receive!({type:"event",event:edited}));
  await flush();
  expect(host.querySelectorAll('[data-testid="message-row"]')).toHaveLength(1);
  expect(host.querySelectorAll('[data-event-id="event-10"]')).toHaveLength(1);
  expect(host.querySelector('[data-event-id="event-11"]')).toBeNull();
  expect(state.notify).not.toHaveBeenCalled();
});

it("renders admitted V2 and orphan window rows but does not promote a live thread reply", async () => {
  await renderChannel();
  const orphan = {...event(10), kind:40002, tags:[["h","channel-a"],["e","missing","","root"],["e","missing","","reply"]]};
  await act(async()=>{
    state.receive!({type:"snapshot",events:windowEvents([orphan])});
    state.receive!({type:"live"});
  });
  await flush();
  expect(host.querySelector('[data-event-id="event-10"]')).not.toBeNull();
  await act(async()=>state.receive!({type:"event",event:{...orphan,id:"new-thread-reply",created_at:20}}));
  await flush();
  expect(host.querySelector('[data-event-id="new-thread-reply"]')).toBeNull();
  await act(async()=>state.receive!({type:"event",event:{...event(30),kind:40002}}));
  await flush();
  expect(host.querySelector('[data-event-id="event-30"]')).not.toBeNull();
  await act(async()=>state.receive!({type:"event",event:{...event(40),kind:9005,tags:[["e","event-10"]]}}));
  await flush();
  expect(host.querySelector('[data-event-id="event-10"]')).toBeNull();
  expect(host.querySelector('[data-event-id="event-30"]')).not.toBeNull();
});

it("renders original system membership rows without advancing conversational read state", async () => {
  state.mark.mockResolvedValue({version:4});
  await open();
  const originalRead = state.mark.mock.calls[0]?.[0];
  const actor = "a".repeat(64);
  await act(async()=>state.receive!({type:"event",event:{...event(20),kind:40099,content:JSON.stringify({type:"member_joined",actor,target:actor})}}));
  await flush();
  expect(host.querySelector('[data-testid="system-message-row"]')?.textContent).toContain("joined the channel");
  expect(host.querySelectorAll('[data-testid="message-row"]')).toHaveLength(1);
  expect(state.mark).toHaveBeenCalledTimes(1);
  expect(originalRead.lastReadAt).toBe(new Date(10_000).toISOString());
  expect(state.notify).not.toHaveBeenCalled();
});

it("renders live reaction auxiliaries on the original channel row and removes their real event ID",async()=>{
  await renderChannel();
  const message={...event(10),id:"a".repeat(64)};
  const reaction={...event(11),id:"b".repeat(64),kind:7,pubkey:"mine",content:"👍",tags:[["e",message.id]]};
  await act(async()=>{state.receive!({type:"snapshot",events:windowEvents([message,reaction])});state.receive!({type:"live"});});
  await flush();
  const pill=[...host.querySelectorAll<HTMLButtonElement>('button[aria-label]')].find(button=>button.getAttribute("aria-label")==="Toggle 👍 reaction");
  expect(pill).toBeDefined();
  await act(async()=>pill!.click());await flush();
  expect(state.reaction).toHaveBeenCalledWith("workspace-a",undefined,{operation:"UNLIKE",content:"",targetEventId:reaction.id},expect.any(String));
});

it("renders the original live summary and opens its real admitted thread", async () => {
  await open();
  await act(async()=>state.receive!({type:"event",event:{...event(20),kind:39005,tags:[["e","event-10"]],content:JSON.stringify({reply_count:2,descendant_count:2,last_reply_at:20,participants:[]})}}));
  await flush();
  const summary = host.querySelector<HTMLElement>('[data-testid="message-thread-summary"]');
  expect(summary?.textContent).toContain("2 replies");
  await act(async()=>summary!.click());
  await flush();
  expect(host.querySelector('[data-testid="message-thread-panel"]')).not.toBeNull();
});

it("keeps snapshot and delayed history chronological, deduplicated and stable within one second", async () => {
  await renderChannel();
  const early = event(10);
  const sameSecond = { ...event(20), id: "event-20-a" };
  const latest = { ...event(20), id: "event-20-z" };
  await act(async () => {
    state.receive!({ type: "snapshot", events: windowEvents([sameSecond, latest, early]) });
    state.receive!({ type: "event", event: early });
    state.receive!({ type: "event", event: sameSecond });
    state.receive!({ type: "live" });
  });
  await flush();
  expect([...host.querySelectorAll("[data-event-id]")].map((row) => row.getAttribute("data-event-id")))
    .toEqual([early.id, latest.id, sameSecond.id]);
  expect(state.mark.mock.calls[0]?.[0].lastReadAt).toBe(new Date(20_000).toISOString());
  expect(state.notify).not.toHaveBeenCalled();
  await act(async () => state.receive!({ type: "event", event: { ...event(15), id: "late-arrival" } }));
  await flush();
  expect([...host.querySelectorAll("[data-event-id]")].map((row) => row.getAttribute("data-event-id")))
    .toEqual([early.id, "late-arrival", latest.id, sameSecond.id]);
});
beforeEach(() => {
  threadMessages.splice(0, threadMessages.length, { ...event(10), createdAt: 10 });
  // Virtua ignores ResizeObserver samples from display:none/detached rows.
  // jsdom has no layout and reports offsetParent=null even for our mounted
  // 800px viewport, so supply the same visible-parent fact as the browser.
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
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: () => [] },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
  });
  vi.useFakeTimers();
  MotionGlobalConfig.useManualTiming = true;
  vi.clearAllMocks();
  vi.stubGlobal("Image",function(){
    const image=document.createElement("img");let source="";
    Object.defineProperties(image,{complete:{value:true},naturalWidth:{value:1},src:{get:()=>source,set:(value:string)=>{
      source=value;queueMicrotask(()=>image.dispatchEvent(new Event("load")));
    }}});return image;
  });
  localStorage.clear();
  clearAllDrafts();
  setThreadViewMode("split");
  setLocale("en");
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  projection = { version: 3, readContexts: {}, workspacePreferences: {} };
  state.fetch.mockImplementation(async () => structuredClone(projection));
  state.members.mockResolvedValue([]);
  state.history.mockResolvedValue({events:windowEvents([event(10)])});
  state.publish.mockResolvedValue({ eventId: "published-event", operationId: "operation" });
  state.delete.mockResolvedValue({eventId:"deletion",operationId:"operation"});
  state.reaction.mockResolvedValue({eventId:"reaction",operationId:"operation"});
  const author={pubkey:"other",eventId:"profile",displayName:"Original author",about:null,avatarUrl:null,nip05Handle:null,avatarMediaPaths:{}};
  state.authorProfile.mockResolvedValue(author);state.dmAuthorProfile.mockResolvedValue(author);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

it.each(["main", "thread", "dm"])("restores the actual %s row deletion menu and retains UNKNOWN until the same target is confirmed", async(surface)=>{
  state.members.mockResolvedValue([{principalId:"human-a",displayName:"Me",pubkeys:["mine"],state:"ACTIVE"}]);
  const target={...event(20),pubkey:"mine",content:"Original own message",tags:surface==="thread"?[["h","channel-a"],["e","event-10","","root"],["e","event-10","","reply"]]:[["h","channel-a"]]};
  // Relay head pages are newest-first, unlike the chronological UI rows.
  state.history.mockResolvedValue({events:windowEvents([target,event(10)])});
  if(surface==="thread") threadMessages.splice(0,threadMessages.length,{...event(10),createdAt:10},{...target,createdAt:20});
  await renderChannel(surface==="dm"?{conversation:{id:"private-binding",channelId:"channel-a",participantPrincipalIds:["human-a","peer"],state:ItemState.Active,version:1,operationId:"op"}}:{});
  await act(async()=>{state.receive!({type:"snapshot",events:windowEvents([target,event(10)])});state.receive!({type:"live"});});
  await flush();
  expect(host.querySelector('[data-testid="more-actions-event-10"]'),host.textContent??"").not.toBeNull();
  if(surface==="thread") {await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="reply-message-event-10"]')!.click());await flush();}
  const rowHost=surface==="thread"?host.querySelector<HTMLElement>('[data-testid="message-thread-panel"]')!:host;
  expect(rowHost.querySelector('[data-testid="more-actions-event-20"]'),rowHost.textContent??"").not.toBeNull();
  await act(async()=>rowHost.querySelector<HTMLButtonElement>('[data-testid="more-actions-event-20"]')!.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})));
  await flush();
  const item=document.querySelector<HTMLElement>('[data-testid="delete-message-event-20"]')!;
  expect(item).not.toBeNull();
  await act(async()=>item.click());await flush();
  expect(state.delete).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Delete message?");
  state.delete.mockRejectedValueOnce(new TransportError("lost deletion receipt"));
  const confirm=()=>[...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button=>button.textContent==="Delete"||button.textContent==="Check deletion")!;
  await act(async()=>confirm().click());await flush();
  expect(state.delete).toHaveBeenCalledExactlyOnceWith("workspace-a",target.id,"STREAM",surface==="dm"?"private-binding":undefined);
  expect(document.querySelector('[role="alertdialog"] [role="status"]')?.textContent).toContain("Deletion outcome unknown");
  expect(rowHost.querySelector('[data-testid="more-actions-event-20"]')).not.toBeNull();
  await act(async()=>confirm().click());await flush();
  expect(state.delete.mock.calls[1]).toEqual(state.delete.mock.calls[0]);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(rowHost.querySelector('[data-testid="more-actions-event-20"]')).not.toBeNull();
});

it.each(["main","thread"])("clearing the actual %s editor requests the original confirmation without publishing or losing edit state",async(surface)=>{
  state.members.mockResolvedValue([{principalId:"human-a",displayName:"Me",pubkeys:["mine"],state:"ACTIVE"}]);
  const target={...event(20),pubkey:"mine",content:"Original own message",tags:surface==="thread"?[["h","channel-a"],["e","event-10","","root"],["e","event-10","","reply"]]:[["h","channel-a"]]};
  state.history.mockResolvedValue({events:windowEvents([target,event(10)])});
  if(surface==="thread") threadMessages.splice(0,threadMessages.length,{...event(10),createdAt:10},{...target,createdAt:20});
  await renderChannel();
  await act(async()=>{state.receive!({type:"snapshot",events:windowEvents([target,event(10)])});state.receive!({type:"live"});});await flush();
  if(surface==="thread"){await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="reply-message-event-10"]')!.click());await flush();}
  const rowHost=surface==="thread"?host.querySelector<HTMLElement>('[data-testid="message-thread-panel"]')!:host;
  await act(async()=>rowHost.querySelector<HTMLButtonElement>('[data-testid="more-actions-event-20"]')!.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})));await flush();
  await act(async()=>document.querySelector<HTMLElement>('[data-testid="edit-message-event-20"]')!.click());await flush();
  await act(async()=>{
    const input=[...rowHost.querySelectorAll<HTMLElement>('[data-testid="message-input"]')].find(input=>input.textContent==="Original own message")!;
    input.replaceChildren(document.createElement("p"));input.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"deleteContentBackward"}));
  });await flush();
  const submit=rowHost.querySelector<HTMLButtonElement>('[data-testid="send-message"]')!;
  expect(submit.disabled).toBe(false);
  await act(async()=>submit.click());await flush();
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Delete message?");
  expect(rowHost.textContent).toContain("Editing message");
  expect(state.publish).not.toHaveBeenCalled();expect(state.delete).not.toHaveBeenCalled();
  await act(async()=>[...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button=>button.textContent==="Cancel")!.click());await flush();
  expect(rowHost.textContent).toContain("Editing message");
});

it.each(["confirmed", "missing-receipt", "unknown", "denied"])(
  "restores the original owned thread editor, leaving guard and real BFF edit receipt: %s",
  async (outcome) => {
    state.members.mockResolvedValue([
      { principalId: "human-a", displayName: "Me", pubkeys: ["mine"], state: "ACTIVE" },
    ]);
    const reply = {
      ...event(20),
      pubkey: "mine",
      content: "Original reply",
      tags: [
        ["h", "channel-a"],
        ["e", "event-10", "", "root"],
        ["e", "event-10", "", "reply"],
      ],
    };
    threadMessages.splice(
      0,
      threadMessages.length,
      { ...event(10), createdAt: 10 },
      { ...reply, createdAt: 20 },
    );
    if (outcome === "missing-receipt")
      state.publish.mockResolvedValue({ operationId: "operation" });
    else if (outcome === "unknown")
      state.publish.mockRejectedValue(new TransportError("lost edit receipt"));
    else if (outcome === "denied")
      state.publish.mockRejectedValue(new BffError(403, "edit revoked"));
    await open();
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-testid="reply-message-event-10"]')!.click(),
    );
    await flush();
    const panel = () => host.querySelector<HTMLElement>('[data-testid="message-thread-panel"]')!;
    const menu = panel().querySelector<HTMLButtonElement>('[data-testid="more-actions-event-20"]');
    expect(menu).not.toBeNull();
    await act(async () =>
      menu!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    await flush();
    const edit = document.querySelector<HTMLElement>('[data-testid="edit-message-event-20"]');
    expect(edit).not.toBeNull();
    await act(async () => edit!.click());
    await flush();
    expect(panel().textContent).toContain("Editing message");
    expect(panel().querySelector('[data-testid="message-input"]')?.textContent).toContain(
      "Original reply",
    );
    await act(async () =>
      panel().querySelector<HTMLButtonElement>('[data-testid="auxiliary-panel-close"]')!.click(),
    );
    await flush();
    expect(panel()).not.toBeNull();
    await act(async () => {
      const input = panel().querySelector<HTMLElement>('[data-testid="message-input"]')!;
      const paragraph = document.createElement("p");
      paragraph.textContent = "Updated reply";
      input.replaceChildren(paragraph);
      input.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertText", data: "Updated reply" }),
      );
    });
    await flush();
    await act(async () =>
      panel().querySelector<HTMLButtonElement>('[data-testid="send-message"]')!.click(),
    );
    await flush();
    expect(state.publish).toHaveBeenCalledExactlyOnceWith(
      "workspace-a",
      "Updated reply",
      [],
      expect.any(String),
      [],
      { editEventId: reply.id, mentionPubkeys: [] },
    );
    if (outcome === "confirmed") {
      expect(panel().textContent).not.toContain("Editing message");
      await act(async () =>
        panel().querySelector<HTMLButtonElement>('[data-testid="auxiliary-panel-close"]')!.click(),
      );
      await flush();
      expect(panel()).toBeNull();
    } else {
      expect(panel().textContent).toContain("Editing message");
      expect(panel().querySelector('[data-testid="message-input"]')?.textContent).toContain(
        "Updated reply",
      );
      await act(async () =>
        panel().querySelector<HTMLButtonElement>('[data-testid="auxiliary-panel-close"]')!.click(),
      );
      await flush();
      expect(panel()).not.toBeNull();
      await act(async () =>
        panel().querySelector<HTMLButtonElement>('[aria-label="Cancel edit"]')!.click(),
      );
      await flush();
      await act(async () =>
        panel().querySelector<HTMLButtonElement>('[data-testid="auxiliary-panel-close"]')!.click(),
      );
      await flush();
      expect(panel()).toBeNull();
    }
  },
);
it("the actual empty main Composer ArrowUp edits only the latest own acknowledged message", async () => {
  state.members.mockResolvedValue([
    { principalId: "human-a", displayName: "Me", pubkeys: ["mine"], state: "ACTIVE" },
  ]);
  await renderChannel();
  await act(async () => {
    state.receive!({type: "snapshot", events: windowEvents([
      {...event(30), content: "Later other author"},
      {...event(20), pubkey: "mine", content: "Latest own message"},
      {...event(10), pubkey: "mine", content: "Older own message"},
    ])});
    state.receive!({type: "live"});
  });
  await flush();
  const input = host.querySelector<HTMLElement>('[data-testid="message-input"]')!;
  const key = new KeyboardEvent("keydown", {key: "ArrowUp", bubbles: true, cancelable: true});
  await act(async () => input.dispatchEvent(key));
  await flush();
  expect(key.defaultPrevented).toBe(true);
  expect(host.textContent).toContain("Editing message");
  expect([...host.querySelectorAll('[data-testid="message-input"]')].some(editor => editor.textContent === "Latest own message")).toBe(true);
  expect(state.publish).not.toHaveBeenCalled();
});

it("the actual thread Composer ArrowUp chooses the latest own reply and saves its original edit target", async () => {
  state.members.mockResolvedValue([
    { principalId: "human-a", displayName: "Me", pubkeys: ["mine"], state: "ACTIVE" },
  ]);
  const reply = {...event(20), pubkey: "mine", content: "Latest own reply", tags: [
    ["h", "channel-a"], ["e", "event-10", "", "root"], ["e", "event-10", "", "reply"],
  ]};
  threadMessages.splice(0, threadMessages.length,
    {...event(10), createdAt: 10}, {...reply, createdAt: 20},
    {...reply, id: "other-reply", pubkey: "other", content: "Later other reply", createdAt: 30},
  );
  await open();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="reply-message-event-10"]')!.click());
  await flush();
  const panel = () => host.querySelector<HTMLElement>('[data-testid="message-thread-panel"]')!;
  const input = panel().querySelector<HTMLElement>('[data-testid="message-input"]')!;
  const key = new KeyboardEvent("keydown", {key: "ArrowUp", bubbles: true, cancelable: true});
  await act(async () => input.dispatchEvent(key));
  await flush();
  expect(key.defaultPrevented).toBe(true);
  expect(panel().textContent).toContain("Editing message");
  expect(panel().querySelector('[data-testid="message-input"]')?.textContent).toBe(reply.content);
  await act(async () => panel().querySelector<HTMLButtonElement>('[data-testid="send-message"]')!.click());
  await flush();
  expect(state.publish).toHaveBeenCalledExactlyOnceWith("workspace-a", reply.content, [], expect.any(String), [],
    {editEventId: reply.id, mentionPubkeys: []});
  expect(panel().textContent).not.toContain("Editing message");
});

it("the actual focused thread root edit waits for the original drawer exit before focusing the main editor", async () => {
  state.members.mockResolvedValue([
    { principalId: "human-a", displayName: "Me", pubkeys: ["mine"], state: "ACTIVE" },
  ]);
  const ownRoot = {...event(10), pubkey: "mine", content: "Original owned root", createdAt: 10};
  threadMessages.splice(0, threadMessages.length, ownRoot);
  await act(async () => setThreadViewMode("focus"));
  await renderChannel();
  await act(async () => {
    state.receive!({type: "snapshot", events: windowEvents([ownRoot])});
    state.receive!({type: "live"});
  });
  await flush();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="reply-message-event-10"]')!.click());
  await flush();
  const drawer = host.querySelector<HTMLElement>('[data-testid="focus-thread-drawer"]')!;
  expect(drawer).not.toBeNull();
  await act(async () => drawer.querySelector<HTMLButtonElement>('[data-testid="more-actions-event-10"]')!
    .dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true})));
  await flush();
  await act(async () => document.querySelector<HTMLElement>('[data-testid="edit-message-event-10"]')!.click());
  expect(host.textContent).not.toContain("Editing message");
  expect(host.querySelector("[inert]")).not.toBeNull();
  await flush();
  expect(host.querySelector('[data-testid="message-thread-panel"]')).toBeNull();
  expect(host.querySelector("[inert]")).toBeNull();
  expect(host.textContent).toContain("Editing message");
  expect([...host.querySelectorAll('[data-testid="message-input"]')].some(editor => editor.textContent === ownRoot.content)).toBe(true);
  expect(state.publish).not.toHaveBeenCalled();
});
it("the original thread row Reply leaves editing and publishes to the selected reply, not the edit target", async () => {
	state.members.mockResolvedValue([
		{
			principalId: "human-a",
			displayName: "Me",
			pubkeys: ["mine"],
			state: "ACTIVE",
		},
	]);
	const reply = {
		...event(20),
		pubkey: "mine",
		content: "Original reply",
		tags: [
			["h", "channel-a"],
			["e", "event-10", "", "root"],
			["e", "event-10", "", "reply"],
		],
	};
  threadMessages.splice(
    0,
    threadMessages.length,
    { ...event(10), createdAt: 10 },
    { ...reply, createdAt: 20 },
  );
	await open();
	await act(async () =>
		host
			.querySelector<HTMLButtonElement>(
				'[data-testid="reply-message-event-10"]',
			)!
			.click(),
	);
	await flush();
	const panel = () =>
		host.querySelector<HTMLElement>('[data-testid="message-thread-panel"]')!;
	await act(async () =>
		panel()
			.querySelector<HTMLButtonElement>(
				'[data-testid="more-actions-event-20"]',
			)!
			.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			),
	);
	await flush();
	await act(async () =>
		document
			.querySelector<HTMLElement>('[data-testid="edit-message-event-20"]')!
			.click(),
	);
	await flush();
	expect(panel().textContent).toContain("Editing message");
	expect(
		panel().querySelector('[data-testid="message-input"]')?.textContent,
	).toContain("Original reply");

	await act(async () =>
		panel()
			.querySelector<HTMLButtonElement>(
				'[data-testid="reply-message-event-20"]',
			)!
			.click(),
	);
	await flush();
	expect(panel().textContent).not.toContain("Editing message");
	expect(
		panel().querySelector('[data-testid="message-input"]')?.textContent,
	).not.toContain("Original reply");
	expect(
		panel().querySelector('[data-testid="reply-target"]')?.textContent,
	).toContain("Original reply");
	await act(async () =>
		panel()
			.querySelector<HTMLButtonElement>(
				'[data-testid="reply-message-event-20"]',
			)!
			.click(),
	);
	await flush();
	expect(panel().querySelector('[data-testid="reply-target"]')).toBeNull();
	await act(async () =>
		panel()
			.querySelector<HTMLButtonElement>(
				'[data-testid="reply-message-event-20"]',
			)!
			.click(),
	);
	await flush();
	await act(async () => {
		const input = panel().querySelector<HTMLElement>(
			'[data-testid="message-input"]',
		)!;
		const paragraph = document.createElement("p");
		paragraph.textContent = "Reply after editing";
		input.replaceChildren(paragraph);
		input.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				inputType: "insertText",
				data: "Reply after editing",
			}),
		);
	});
	await flush();
	await act(async () =>
		panel()
			.querySelector<HTMLButtonElement>('[data-testid="send-message"]')!
			.click(),
	);
	await flush();
	expect(state.publish).toHaveBeenCalledExactlyOnceWith(
		"workspace-a",
		"Reply after editing",
		[],
		expect.any(String),
		[],
		{ messageType: "STREAM", parentEventId: reply.id, mentionPubkeys: [] },
	);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  MotionGlobalConfig.useManualTiming = false;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("notifies only a new admitted live mention, never a snapshot, duplicate, disconnected replay or revoked stream", async () => {
  state.members.mockResolvedValue([{ principalId: "human-a", displayName: "Me", pubkeys: ["mine"] }]);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  await open();
  const mention = (seconds: number) => ({ ...event(seconds), tags: [["h", "channel-a"], ["p", "mine"]] });
  await act(async () => { state.receive!({ type: "snapshot", events: windowEvents([mention(20)]) }); state.receive!({ type: "live" }); });
  expect(state.notify).not.toHaveBeenCalled();
  await act(async () => state.receive!({ type: "event", event: mention(30) }));
  expect(state.notify).toHaveBeenCalledTimes(1);
  expect(state.notify.mock.calls[0]?.[0]).toMatchObject({ eventId: "event-30", slot: "mention" });
  await act(async () => {
    state.receive!({ type: "event", event: mention(30) });
    state.receive!({ type: "interrupted" });
    state.receive!({ type: "event", event: mention(40) });
    state.receive!({ type: "live" });
    state.receive!({ type: "event", event: mention(40) });
    state.receive!({ type: "closed", reason: "scope-revoked" });
    state.receive!({ type: "event", event: mention(50) });
  });
  expect(state.notify).toHaveBeenCalledTimes(1);
});

it.each([new TransportError("lost ACK"), new BffError(403, "denied")])(
  "does not turn failed read marking into a mutation/readback loop: %s",
  async (error) => {
    state.mark.mockRejectedValue(error);
    await open();
    expect(state.mark).toHaveBeenCalledTimes(1);
    expect(
      client.getQueryData<UserState>(platformQueries.userState.queryKey)?.readContexts,
    ).toEqual({});
    expect(host.textContent).toContain(
      error instanceof TransportError ? "inbox.readUnknown" : "inbox.readUnavailable",
    );
    await act(async () => {
      state.receive!({ type: "event", event: event(20) });
      state.receive!({ type: "interrupted" });
      state.receive!({ type: "live" });
    });
    await flush();
    expect(state.mark).toHaveBeenCalledTimes(1);
  },
);

it("mounts the original rich composer in a real channel DOM and removes it on revocation", async () => {
  state.mark.mockRejectedValue(new BffError(403, "denied"));
  await open();
  expect(host.querySelector('[data-testid="message-input"]')?.getAttribute("contenteditable")).toBe("true");
  expect(host.querySelector('[aria-label="Toggle formatting"]')).not.toBeNull();
  await act(async () => state.receive!({ type: "closed", reason: "scope-revoked" }));
  expect(host.querySelector('[data-testid="message-composer"]')).toBeNull();
});

it("refreshes signed metadata only on closure and keeps archive transitions on the original stream lifecycle", async () => {
  state.mark.mockResolvedValue({ version: 4 });
  await open();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await act(async () => state.receive!({ type: "event", event: event(20) }));
  await flush();
  expect(invalidate.mock.calls.some(([options]) => options?.queryKey?.[1] === "channel-descriptor")).toBe(false);
  expect(state.stream).toHaveBeenCalledTimes(1);
  await act(async () => state.receive!({ type: "closed", reason: "restricted: channel access revoked" }));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["platform", "channel-descriptor", "human-a", "workspace-a"] });
  await renderChannel({ archived: true });
  await flush();
  expect(host.textContent).toContain("channel.archived");
  expect(host.querySelector('[data-testid="message-input"]')?.getAttribute("contenteditable")).toBe("false");
  expect(state.stream).toHaveBeenCalledTimes(1);
  await renderChannel({ archived: false });
  await flush();
  expect(state.stream).toHaveBeenCalledTimes(2);
});

it("cold-opens archived rows with the original timeline while all composer writes remain disabled",async()=>{
  await renderChannel({archived:true});await flush();
  expect(state.history).toHaveBeenCalledWith("workspace-a");
  expect(host.querySelector('[data-event-id="event-10"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="message-input"]')?.getAttribute("contenteditable")).toBe("false");
  expect(host.querySelector('[data-testid="reply-message-event-10"]')).toBeNull();
  expect(state.stream).not.toHaveBeenCalled();expect(state.publish).not.toHaveBeenCalled();
  expect(state.mark).not.toHaveBeenCalled();expect(state.notify).not.toHaveBeenCalled();
});

it("renders the original empty archive state rather than an endless loading skeleton",async()=>{
  state.history.mockResolvedValue({events:windowEvents([])});
  await renderChannel({archived:true});await flush();
  expect(host.querySelector('[data-testid="message-empty"]')).not.toBeNull();
  expect(host.textContent).toContain("channel.archived");
  expect(state.stream).not.toHaveBeenCalled();expect(state.publish).not.toHaveBeenCalled();
});

it("retains an UNKNOWN send key while native metadata is unavailable or archived", async () => {
  state.mark.mockResolvedValue({ version: 4 });
  state.publish.mockResolvedValue({ operationId: "unknown-operation" });
  await open();
  await act(async () => {
    const input = host.querySelector<HTMLElement>('[data-testid="message-input"]')!;
    const paragraph = document.createElement("p"); paragraph.textContent = "pending message";
    input.replaceChildren(paragraph);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "pending message" }));
  });
  await flush();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="send-message"]')!.click());
  await flush();
  expect(state.publish).toHaveBeenCalledTimes(1);
  const input = host.querySelector('[data-testid="message-input"]');
  for (const props of [{ metadataPending: true }, { archived: true }]) {
    await renderChannel(props);
    await flush();
    expect(host.querySelector('[data-testid="message-input"]')).toBe(input);
    expect(host.querySelector<HTMLButtonElement>('[data-testid="send-message"]')?.disabled).toBe(true);
    expect(state.publish).toHaveBeenCalledTimes(1);
  }
  await renderChannel();
  await flush();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="send-message"]')!.click());
  await flush();
  expect(state.publish).toHaveBeenCalledTimes(2);
  expect(state.publish.mock.calls[1]).toEqual(state.publish.mock.calls[0]);
});

async function sendChannel() {
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="send-message"]')!.click());
  await flush();
}
async function remountChannel() {
  await act(async () => root.render(null));
  client.removeQueries({ queryKey: platformQueries.members("workspace-a").queryKey });
  await open();
}
const humanMember = (pubkey: string, displayName: string) => ({ principalId: pubkey, displayName, pubkeys: [pubkey], state: "ACTIVE" });

it("sends the real human picker identity and reconciles the same UNKNOWN request after remount and a same-name rename", async () => {
  const selected="a".repeat(64), other="b".repeat(64);
  state.members.mockResolvedValue([humanMember(selected,"Alex"),humanMember(other,"Alex")]);
  state.publish.mockRejectedValue(new TransportError("lost acknowledgement"));
  await open();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Mention someone"]')!.click());
  const options=host.querySelectorAll('[aria-label="Mention someone Alex"]');
  expect(options).toHaveLength(2);
  await act(async () => options[0]!.dispatchEvent(new MouseEvent("mousedown",{bubbles:true})));
  await sendChannel();
  expect(state.publish).toHaveBeenCalledTimes(1);
  const original=state.publish.mock.calls[0]!;
  expect(original[1]).toBe("@Alex");
  expect(original[5]).toEqual({mentionPubkeys:[selected]});
  expect(host.textContent).toContain("platform.sendUnknown");
  state.members.mockResolvedValue([humanMember(other,"Alex"),humanMember(selected,"Renamed")]);
  await remountChannel();
  expect(state.publish).toHaveBeenCalledTimes(1);
  await sendChannel();
  expect(state.publish).toHaveBeenCalledTimes(2);
  expect(state.publish.mock.calls[1]).toEqual(original);
});

it("preserves typed human recipients and their original order across UNKNOWN remount and changed directory names", async () => {
  const first="c".repeat(64), second="d".repeat(64);
  state.members.mockResolvedValue([humanMember(second,"Blair"),humanMember(first,"Alex")]);
  state.publish.mockRejectedValue(new TransportError("lost acknowledgement"));
  await open();
  await act(async () => {
    const input=host.querySelector<HTMLElement>('[data-testid="message-input"]')!;
    const paragraph=document.createElement("p");paragraph.textContent="@Alex @Blair";
    input.replaceChildren(paragraph);
    input.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:"@Alex @Blair"}));
  });
  await flush();await sendChannel();
  const original=state.publish.mock.calls[0]!;
  expect(original[5]).toEqual({mentionPubkeys:[second,first]});
  state.members.mockResolvedValue([humanMember(first,"Blair"),humanMember(second,"Alex")]);
  await remountChannel();await sendChannel();
  expect(state.publish).toHaveBeenCalledTimes(2);
  expect(state.publish.mock.calls[1]).toEqual(original);
});

it("does not silently drop a revoked human recipient or replay its UNKNOWN request after remount", async () => {
  const selected="e".repeat(64);
  state.members.mockResolvedValue([humanMember(selected,"Alex")]);
  state.publish.mockRejectedValue(new TransportError("lost acknowledgement"));
  await open();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Mention someone"]')!.click());
  await act(async () => host.querySelector('[aria-label="Mention someone Alex"]')!.dispatchEvent(new MouseEvent("mousedown",{bubbles:true})));
  await sendChannel();
  state.members.mockResolvedValue([]);
  await remountChannel();await sendChannel();
  expect(state.publish).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("platform.loadFailed");
});

it("does not mint a different request for a legacy UNKNOWN draft whose human refs were not persisted", async () => {
  const selected="a".repeat(64), other="b".repeat(64);
  state.members.mockResolvedValue([humanMember(selected,"Alex")]);
  state.publish.mockRejectedValue(new TransportError("lost acknowledgement"));
  await open();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Mention someone"]')!.click());
  await act(async () => host.querySelector('[aria-label="Mention someone Alex"]')!.dispatchEvent(new MouseEvent("mousedown",{bubbles:true})));
  await sendChannel();
  const saved=loadDraftEntry("workspace-a")!;
  expect(saved.sendIntent).toBeDefined();
  await act(async () => root.render(null));
  saveDraftEntry("workspace-a",{...saved,mentionRefs:[]});
  state.members.mockResolvedValue([humanMember(selected,"Renamed"),humanMember(other,"Alex")]);
  client.removeQueries({queryKey:platformQueries.members("workspace-a").queryKey});
  await open();await sendChannel();
  expect(state.publish).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("platform.sendUnknown");
  expect(loadDraftEntry("workspace-a")?.sendIntent?.key).toBe(saved.sendIntent!.key);
});

it("the original Reply action sends to the exact event and cancellation restores the channel draft", async () => {
  state.mark.mockRejectedValue(new BffError(403, "denied"));
  state.members.mockResolvedValue([{principalId: "human-a", displayName: "Alice", pubkeys: ["mine"], state: "ACTIVE"}]);
  await open();
  const type = async (value: string) => {
    await act(async () => {
      const input = host.querySelector<HTMLElement>('[data-testid="message-thread-panel"] [data-testid="message-input"]')!;
      const paragraph = document.createElement("p"); paragraph.textContent = value;
      input.replaceChildren(paragraph);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    });
    await flush();
  };
  await act(async () => {
    const input = host.querySelector<HTMLElement>('[data-testid="message-input"]')!;
    const paragraph = document.createElement("p"); paragraph.textContent = "channel draft";
    input.replaceChildren(paragraph);
    input.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertText", data: "channel draft"}));
  });
  await flush();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="reply-message-event-10"]')!.click());
  await flush();
  expect(host.querySelector('[data-testid="message-thread-panel"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="message-thread-panel"] [data-testid="message-input"]')?.textContent).not.toContain("channel draft");
  await type("actual reply");
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="message-thread-panel"] [data-testid="send-message"]')!.click());
  await flush();
  expect(state.publish).toHaveBeenCalledTimes(1);
  expect(state.publish.mock.calls[0]).toEqual(["workspace-a", "actual reply", [], expect.any(String), [], { messageType: "STREAM", parentEventId: "event-10", mentionPubkeys: [] }]);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close panel"]')!.click());
  await flush();
  expect(host.querySelector('[data-testid="message-thread-panel"]')).toBeNull();
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("channel draft");
});

it("a reply without confirmed evidence stays UNKNOWN and keeps its original intent across target switches", async () => {
  state.mark.mockRejectedValue(new BffError(403, "denied"));
  state.publish.mockResolvedValue({ operationId: "operation" });
  state.members.mockResolvedValue([{principalId: "human-a", displayName: "Alice", pubkeys: ["mine"], state: "ACTIVE"}]);
  await open();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="reply-message-event-10"]')!.click());
  await flush();
  await act(async () => {
    const input = host.querySelector<HTMLElement>('[data-testid="message-thread-panel"] [data-testid="message-input"]')!;
    const paragraph = document.createElement("p"); paragraph.textContent = "retained reply";
    input.replaceChildren(paragraph);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "retained reply" }));
  });
  await flush();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="message-thread-panel"] [data-testid="send-message"]')!.click());
  await flush();
  expect(host.textContent).toContain("platform.sendUnknown");
  const key = state.publish.mock.calls[0]?.[3];
  const originalInput=host.querySelector('[data-testid="message-thread-panel"] [data-testid="message-input"]');
  const originalPanel=host.querySelector<HTMLElement>('[data-testid="message-thread-panel"]')!;
  const beforeResize=sessionStorage.getItem("buzz.desktop.thread-panel-width");
  const resizeHandle=originalPanel.querySelector<HTMLButtonElement>('[aria-label="Resize panel"]')!;
  expect(resizeHandle).not.toBeNull();
  await act(async()=>{
    resizeHandle.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,clientX:500}));
    window.dispatchEvent(new MouseEvent("pointermove",{clientX:450}));
    window.dispatchEvent(new MouseEvent("pointerup"));
  });
  expect(sessionStorage.getItem("buzz.desktop.thread-panel-width")).not.toBe(beforeResize);
  expect(document.body.style.cursor).not.toBe("col-resize");
  const originalWidth=sessionStorage.getItem("buzz.desktop.thread-panel-width");
  expect(Number(originalWidth)).toBeGreaterThan(0);
  const panelParent=originalPanel.parentElement!;
  expect(panelParent.className).toBe("contents");
  await act(async()=>setThreadViewMode("focus")); await flush();
  expect(host.querySelector('[data-testid="focus-thread-drawer"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="focus-thread-drawer-scrim"]')?.getAttribute("aria-label")).toContain("Original channel");
  expect(originalPanel.style.width).toBe("100%");
  expect(host.querySelector('[data-testid="message-thread-panel"] [data-testid="message-input"]')).toBe(originalInput);
  expect(host.textContent).toContain("platform.sendUnknown");
  await act(async()=>setThreadViewMode("split")); await flush();
  expect(host.querySelector('[data-testid="focus-thread-drawer"]')).toBeNull();
  // jsdom does not parse CSS min(px, calc(...)); the authoritative preference
  // must survive focus/split transitions rather than comparing its CSSOM.
  expect(sessionStorage.getItem("buzz.desktop.thread-panel-width")).toBe(originalWidth);
  expect(panelParent.className).toBe("contents");
  expect(host.querySelector('[data-testid="message-thread-panel"] [data-testid="message-input"]')).toBe(originalInput);
  expect(state.publish).toHaveBeenCalledTimes(1);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close panel"]')!.click());
  await flush();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="reply-message-event-10"]')!.click());
  await flush();
  expect(state.publish).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[data-testid="message-thread-panel"] [data-testid="message-input"]')?.textContent).toBe("retained reply");
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="message-thread-panel"] [data-testid="send-message"]')!.click());
  await flush();
  expect(state.publish.mock.calls[1]?.[3]).toBe(key);
  expect(state.publish.mock.calls[1]?.[5]).toEqual({ messageType: "STREAM", parentEventId: "event-10", mentionPubkeys: [] });
});

it("renders real stream events through the original shared message row and groups adjacent authors", async () => {
  state.mark.mockImplementation(async () => ({ version: 4 }));
  await open();
  await act(async () => state.receive!({ type: "event", event: event(20) }));
  await flush();
  expect(host.querySelectorAll('[data-testid="message-row"]')).toHaveLength(2);
  expect(host.querySelectorAll('[data-testid="message-avatar"]')).toHaveLength(1);
  expect(host.querySelectorAll('[data-testid="message-author"]')).toHaveLength(1);
  expect(host.querySelectorAll('[data-testid="message-timestamp"]')).toHaveLength(2);
  // The signed window explicitly proves exhaustion, including its first day.
  expect(host.querySelectorAll('[data-testid="message-timeline-day-divider"]')).toHaveLength(1);
  expect(host.querySelector('[data-testid="copy-link-message-event-20"]')).not.toBeNull();
  await act(async () => state.receive!({ type: "event", event: event(90_000) }));
  await flush();
  expect(host.querySelectorAll('[data-testid="message-row"]')).toHaveLength(3);
  expect(host.querySelectorAll('[data-testid="message-timeline-day-divider"]')).toHaveLength(2);
  await act(async () => state.receive!({ type: "closed", reason: "scope-revoked" }));
  await flush();
  expect(host.querySelectorAll('[data-testid="message-row"]')).toHaveLength(0);
});

it("explicit recovery reads first and retries only the frozen request, not a newer event", async () => {
  state.mark.mockRejectedValue(new TransportError("lost ACK"));
  await open();
  const original = state.mark.mock.calls[0][0];
  await act(async () => {
    state.receive!({ type: "event", event: event(20) });
  });
  let release!: (value: UserState) => void;
  state.fetch.mockImplementationOnce(
    () =>
      new Promise<UserState>((resolve) => {
        release = resolve;
      }),
  );
  await act(async () => {
    retry().click();
    retry().click();
  });
  expect(retry().disabled).toBe(true);
  expect(state.mark).toHaveBeenCalledTimes(1);
  await act(async () => release(structuredClone(projection)));
  await flush();
  expect(state.mark).toHaveBeenCalledTimes(2);
  expect(state.mark.mock.calls[1][0]).toEqual(original);
  expect(original.lastReadAt).toBe(new Date(10_000).toISOString());
});

it("a real CAS conflict can resume after higher-version readback without a retry storm", async () => {
  state.mark.mockImplementation(async (request: ReadMarkRequest) => {
    if (request.version === 3) {
      projection.version = 4;
      throw new BffError(409, "conflict");
    }
    projection = {
      ...projection,
      version: request.version + 1,
      readContexts: { [request.contextKey]: request.lastReadAt },
    };
    return { version: projection.version };
  });
  await open();
  expect(state.mark.mock.calls.map((call) => call[0].version)).toEqual([3, 4]);
  expect(client.getQueryData<UserState>(platformQueries.userState.queryKey)?.version).toBe(5);
  await flush();
  expect(state.mark).toHaveBeenCalledTimes(2);
});

it("failed readback or revoked scope cannot turn explicit retry into a write", async () => {
  state.mark.mockRejectedValue(new TransportError("lost ACK"));
  await open();
  state.fetch.mockRejectedValueOnce(new TransportError("read unavailable"));
  await act(async () => retry().click());
  await flush();
  expect(state.mark).toHaveBeenCalledTimes(1);
  let release!: (value: UserState) => void;
  state.fetch.mockImplementationOnce(
    () =>
      new Promise<UserState>((resolve) => {
        release = resolve;
      }),
  );
  await act(async () => retry().click());
  await act(async () => state.receive!({ type: "closed", reason: "scope-revoked" }));
  await act(async () => release(structuredClone(projection)));
  await flush();
  expect(state.mark).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("PERMISSION_DENIED");
});

it("restores the original channel avatar without adding one to continuation rows and withdraws media on interruption",async()=>{
  const avatarUrl="https://community.example/media/channel-author.png",mediaPath="/api/v1/workspaces/workspace-a/media/channel-author";
  state.authorProfile.mockResolvedValue({pubkey:"other",eventId:"profile",displayName:"Original author",about:null,avatarUrl,nip05Handle:null,avatarMediaPaths:{[avatarUrl]:mediaPath}});
  state.mark.mockResolvedValue({version:4});
  await open();
  const image=()=>host.querySelector('[data-testid="message-avatar-image"]');
  expect(image()?.getAttribute("src")).toBe(mediaPath);
  expect(state.authorProfile).toHaveBeenCalledWith("workspace-a","event-10");
  expect(state.dmAuthorProfile).not.toHaveBeenCalled();
  await act(async()=>state.receive!({type:"event",event:event(20)}));await flush();
  expect(host.querySelectorAll('[data-testid="message-avatar"]')).toHaveLength(1);
  expect(state.authorProfile).not.toHaveBeenCalledWith("workspace-a","event-20");
  expect(state.publish).not.toHaveBeenCalled();
  await act(async()=>state.receive!({type:"interrupted"}));await flush();
  expect(image()).toBeNull();expect(host.querySelector('[aria-label="Profile"]')).toBeNull();
});

it("loads the original DM channel avatar through its own conversation instead of the workspace author route",async()=>{
  const avatarUrl="https://community.example/media/dm-channel-author.png",mediaPath="/api/v1/conversations/private-binding/media/author";
  state.dmAuthorProfile.mockResolvedValue({pubkey:"other",eventId:"profile",displayName:"Original author",about:null,avatarUrl,nip05Handle:null,avatarMediaPaths:{[avatarUrl]:mediaPath}});
  state.mark.mockResolvedValue({version:4});
  await renderChannel({conversation:{id:"private-binding",channelId:"channel-a",participantPrincipalIds:["human-a","peer"],state:ItemState.Active,version:1,operationId:"op"}});
  await act(async()=>{state.receive!({type:"snapshot",events:windowEvents([event(10)])});state.receive!({type:"live"});});await flush();
  expect(state.dmAuthorProfile).toHaveBeenCalledWith("private-binding","event-10");
  expect(state.authorProfile).not.toHaveBeenCalled();
  expect(host.querySelector('[data-testid="message-avatar-image"]')?.getAttribute("src")).toBe(mediaPath);
  expect(state.publish).not.toHaveBeenCalled();
  await act(async()=>state.receive!({type:"closed",reason:"binding-not-active"}));await flush();
  expect(host.querySelector("img")).toBeNull();
});
