// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { setLocale } from "@client-kit/platform/i18n";
import { PlatformProvider } from "@client-kit/platform/react/context";
import type { BffClient } from "@client-kit/platform/client";
import type { ConversationView } from "@client-kit/contracts";
import { ConversationVisibilityProvider } from "@client-kit/platform/react/new-message";
import { describe, expect, it, vi } from "vitest";
import { InboxPane, inboxEvents } from "./InboxPane";
import { inboxWindowEvents } from "./inbox-events";

const api=vi.hoisted(()=>({workspaces:vi.fn(),members:vi.fn(),workspaceMessages:vi.fn(),agentInstallations:vi.fn(),conversations:vi.fn().mockResolvedValue({items:[]}),conversationParticipants:vi.fn(),conversationMessages:vi.fn(),messageAuthorProfile:vi.fn(),conversationMessageAuthorProfile:vi.fn(),write:vi.fn(),privateChannels:[] as ConversationView[],readFailed:false,readUnknown:false}));
const readAt=()=>null;
vi.mock("@client-kit/platform/react/use-inbox-state",async(importOriginal)=>({...await importOriginal<typeof import("@client-kit/platform/react/use-inbox-state")>(),useInboxState:()=>({state:{},failed:api.readFailed,unknown:api.readUnknown,pending:false,visibleChannels:new Set(["workspace-a",...api.privateChannels.map(item=>item.channelId)]),conversations:api.privateChannels,workspaceChannels:new Set(["workspace-a"]),readAt,write:api.write,refresh:vi.fn()})}));
vi.mock("@/platform/bff-client",async(importOriginal)=>({...await importOriginal<typeof import("@/platform/bff-client")>(),bff:api,openStream:()=>()=>{}}));
vi.mock("./ChannelPane",async(importOriginal)=>({...await importOriginal<typeof import("./ChannelPane")>(),Composer:()=>null,ChannelPane:()=>null}));

const event = {
  id: "a".repeat(64),
  pubkey: "b".repeat(64),
  kind: 9,
  created_at: 1,
  content: "message",
  tags: [["h", "workspace-a"]],
};

describe("Inbox uses the original shared HomeLoadingState at the real read boundary", () => {
  it.each(["empty", "message", "failure", "read-failure", "unknown"] as const)(
    "replaces the full original loading surface with %s, never a false loading terminal",
    async (outcome) => {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      setLocale("en"); localStorage.clear(); sessionStorage.clear();
      vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
      vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
      const workspaces = outcome === "message" ? [{ id: "workspace-a", name: "Channel", isMember: true }] : [];
      let finish!: (value: typeof workspaces) => void;
      let fail!: (reason: Error) => void;
      api.workspaces.mockReset().mockResolvedValue(workspaces).mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
      api.privateChannels = []; api.conversations.mockResolvedValue({ items: [] });
      api.readFailed = false; api.readUnknown = false;
      const self = "c".repeat(64);
      api.members.mockResolvedValue([{ principalId: "human", displayName: "Me", pubkeys: [self], state: "ACTIVE" }]);
      api.agentInstallations.mockResolvedValue({ installations: [] });
      api.workspaceMessages.mockResolvedValue({ events: [
        { ...event, tags: [...event.tags, ["p", self]] },
        { ...event, id: "d".repeat(64), kind: 39006, tags: [...event.tags, ["d", "workspace-a:head"]], content: JSON.stringify({ has_more: false, next_cursor: null }) },
      ] });
      const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
      const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
      const render = () => act(async () => root.render(<PlatformProvider client={api as unknown as BffClient} locale="en"><QueryClientProvider client={cache}><TooltipProvider><InboxPane principalId="human" onOpen={vi.fn()} /></TooltipProvider></QueryClientProvider></PlatformProvider>));
      try {
        await render();
        const columns = host.querySelector('[class*="lg:grid-cols-"]');
        expect(columns?.children).toHaveLength(2);
        expect(columns?.children[0]?.querySelectorAll(".h-9.w-9.rounded-full")).toHaveLength(5);
        expect(columns?.children[1]?.querySelectorAll("article")).toHaveLength(3);
        expect(columns?.children[1]?.querySelector(".backdrop-blur-md")).not.toBeNull();
        expect(host.querySelectorAll(".t-skel-bar").length).toBeGreaterThan(0);
        expect(host.querySelector("input,textarea,button")).toBeNull();
        if (outcome === "failure") await act(async () => fail(new Error("Directory unavailable")));
        else if (outcome === "read-failure" || outcome === "unknown") {
          api.readFailed = outcome === "read-failure"; api.readUnknown = outcome === "unknown";
          await render();
        } else await act(async () => finish(workspaces));
        await vi.waitFor(() => expect(host.querySelector(".t-skel-bar")).toBeNull());
        if (outcome === "message") expect(host.querySelector(`[data-testid="home-inbox-item-${event.id}"]`)).not.toBeNull();
        else if (outcome === "empty") expect(host.querySelector('[data-testid="home-inbox"]')).not.toBeNull();
        else {
          expect(host.querySelector('[role="status"]')).not.toBeNull();
          expect(host.querySelector("button")).not.toBeNull();
          expect(host.querySelector('[data-testid="home-inbox"]')).toBeNull();
        }
      } finally {
        await act(async () => root.unmount()); cache.clear(); host.remove();
        api.readFailed = false; api.readUnknown = false; vi.unstubAllGlobals();
      }
    },
  );
});

describe("Web Inbox's actual BFF page scope consumer", () => {
  it("retains only the exact admitted Workspace identity", () => {
    expect(inboxEvents([event], "workspace-a")[0]?.channelId).toBe("workspace-a");
    expect(() => inboxEvents([event], "workspace-b")).toThrow();
  });
  it("rejects missing or conflicting scopes", () => {
    expect(() => inboxEvents([{ ...event, tags: [] }], "workspace-a")).toThrow();
    expect(() =>
      inboxEvents([{ ...event, tags: [...event.tags, ["h", "workspace-b"]] }], "workspace-a"),
    ).toThrow();
  });
  it("does not render malformed/native unknown event shapes as messages", () => {
    expect(() => inboxEvents([{ ...event, kind: 1 }], "workspace-a")).toThrow();
    expect(() => inboxEvents([{ ...event, pubkey: undefined }], "workspace-a")).toThrow();
    expect(() =>
      inboxEvents(
        [
          {
            ...event,
            tags: [
              ["h", "workspace-a"],
              ["p", null],
            ],
          },
        ],
        "workspace-a",
      ),
    ).toThrow();
    expect(() => inboxEvents({ events: [event] }, "workspace-a")).toThrow();
  });
  it("rejects unrepresentable timestamps instead of crashing a row", () => {
    expect(() => inboxEvents([{ ...event, created_at: -1 }], "workspace-a")).toThrow();
    expect(() =>
      inboxEvents([{ ...event, created_at: Number.MAX_SAFE_INTEGER }], "workspace-a"),
    ).toThrow();
  });
});

describe("Inbox and sidebar consume the original governed Relay window", () => {
  const bounds = {
    ...event, id: "c".repeat(64), kind: 39006,
    tags: [...event.tags, ["d", "workspace-a:head"]],
    content: JSON.stringify({ has_more: false, next_cursor: null }),
  };
  const summary = {
    ...event, id: "d".repeat(64), kind: 39005,
    tags: [...event.tags, ["e", event.id]],
    content: JSON.stringify({ reply_count: 0, descendant_count: 0, last_reply_at: null, participants: [] }),
  };
  it("partitions signed bounds and summaries before unread/activity row validation", () => {
    expect(inboxWindowEvents([event, summary, bounds], "workspace-a").map((row) => row.id)).toEqual([event.id]);
    expect(inboxWindowEvents([bounds], "workspace-a")).toEqual([]);
  });
  it("never turns native action overlays into phantom unread messages", () => {
    const edit = { ...event, id: "e".repeat(64), kind: 40003, tags: [...event.tags, ["e", event.id]] };
    const reaction = { ...event, id: "f".repeat(64), kind: 7, tags: [["e", event.id]] };
    expect(inboxWindowEvents([event, edit, reaction, bounds], "workspace-a").map((row) => row.id)).toEqual([event.id]);
  });
  it("retains V2 activity while excluding verified system rows from unread messages", () => {
    const v2={...event,kind:40002};
    const system={...event,id:"f".repeat(64),kind:40099,content:JSON.stringify({type:"channel_created"})};
    expect(inboxWindowEvents([v2,system,bounds],"workspace-a").map(row=>row.id)).toEqual([event.id]);
    expect(()=>inboxWindowEvents([v2,{...system,tags:[["h","workspace-b"]]},bounds],"workspace-a")).toThrow();
  });
  it("still rejects unknown kinds and foreign scope even when they would not render", () => {
    expect(() => inboxWindowEvents([event, { ...summary, kind: 1 }, bounds], "workspace-a")).toThrow();
    expect(() => inboxWindowEvents([event, { ...summary, tags: [["h", "workspace-b"]] }, bounds], "workspace-a")).toThrow();
    expect(() => inboxWindowEvents([event, { ...summary, tags: [["h", "workspace-a"], ["h", "workspace-b"]] }, bounds], "workspace-a")).toThrow();
    expect(() => inboxWindowEvents([event, { ...summary, created_at: -1 }, bounds], "workspace-a")).toThrow();
  });
  it("retains the original bounds proof rather than interpreting incomplete evidence as empty", () => {
    expect(() => inboxWindowEvents([event], "workspace-a")).toThrow();
    expect(() => inboxWindowEvents([event, { ...bounds, tags: [...event.tags, ["d", "workspace-b:head"]] }], "workspace-a")).toThrow();
    expect(() => inboxWindowEvents([event, bounds, bounds], "workspace-a")).toThrow();
  });
});

it("opens the Inbox row's actual author without marking it read and clears the panel on identity change",async()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  const scrollDescriptor=Object.getOwnPropertyDescriptor(Element.prototype,"scrollIntoView");
  const scrollIntoView=vi.fn();
  Object.defineProperty(Element.prototype,"scrollIntoView",{configurable:true,value:scrollIntoView});
  setLocale("en"); localStorage.clear(); sessionStorage.clear();
  vi.stubGlobal("ResizeObserver",class{constructor(private callback:ResizeObserverCallback){} observe(){this.callback([{contentRect:{width:1400}} as ResizeObserverEntry],this as unknown as ResizeObserver);} unobserve(){} disconnect(){}});
  vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener(){},removeEventListener(){}}));
  vi.stubGlobal("Image",function(){
    const image=document.createElement("img");let source="";
    Object.defineProperties(image,{complete:{value:true},naturalWidth:{value:1},src:{get:()=>source,set:(value:string)=>{
      source=value;queueMicrotask(()=>image.dispatchEvent(new Event("load")));
    }}});return image;
  });
  const self="c".repeat(64);
  api.workspaces.mockResolvedValue([{id:"workspace-a",name:"Admitted channel",isMember:true}]);
  api.agentInstallations.mockResolvedValue({ installations: [] });
  api.members.mockResolvedValue([{principalId:"human",displayName:"Me",pubkeys:[self],state:"ACTIVE"},{principalId:"author",displayName:"Author",pubkeys:[event.pubkey],state:"ACTIVE"}]);
  api.workspaceMessages.mockResolvedValue({events:[{...event,tags:[...event.tags,["p",self]]},{...event,id:"d".repeat(64),kind:39006,tags:[...event.tags,["d","workspace-a:head"]],content:JSON.stringify({has_more:false,next_cursor:null})}]});
  const avatarUrl=`https://community.example/media/${event.id}.png`,mediaPath=`/api/v1/workspaces/workspace-a/media/${event.id}`;
  api.messageAuthorProfile.mockResolvedValue({pubkey:event.pubkey,eventId:"profile",displayName:"Verified author",about:"Scoped biography",avatarUrl,nip05Handle:null,avatarMediaPaths:{[avatarUrl]:mediaPath}});
  api.messageAuthorProfile.mockClear(); api.write.mockClear();
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  const render=(principalId:string)=>act(async()=>root.render(<PlatformProvider client={api as unknown as BffClient} locale="en"><QueryClientProvider client={cache}><TooltipProvider><InboxPane principalId={principalId} onOpen={vi.fn()}/></TooltipProvider></QueryClientProvider></PlatformProvider>));
  try{
    await render("human");
    await vi.waitFor(()=>expect(host.querySelector(`[data-testid="home-inbox-item-${event.id}"]`)).not.toBeNull());
    await vi.waitFor(()=>expect(host.querySelector(`[data-testid="home-inbox-item-${event.id}"]`)?.getAttribute("aria-current")).toBe("true"));
    const avatar = host.querySelector<HTMLElement>(`[data-testid="home-inbox-item-${event.id}"] [data-avatar-shape]`)!;
    expect(avatar.getAttribute("data-avatar-shape")).toBe("circle");
    expect(avatar.classList.contains("h-9")).toBe(true);
    expect(avatar.classList.contains("w-9")).toBe(true);
    await vi.waitFor(()=>expect(avatar.querySelector("img")?.getAttribute("src")).toBe(mediaPath));
    expect(host.querySelector('[data-testid="home-inbox-detail"]')).not.toBeNull();
    await vi.waitFor(()=>expect(scrollIntoView).toHaveBeenCalledWith({block:"center"}));
    expect(api.messageAuthorProfile).toHaveBeenCalledWith("workspace-a",event.id);
    expect(host.querySelector('[data-testid="user-profile-panel"]')).toBeNull();
    const trigger=host.querySelector<HTMLElement>(`[data-testid="home-inbox-item-${event.id}"] [role="button"][aria-label="Profile"]`)!;
    await act(async()=>trigger.click());
    await vi.waitFor(()=>expect(host.textContent).toContain("Scoped biography"));
    expect(api.messageAuthorProfile).toHaveBeenCalledWith("workspace-a",event.id);
    expect(api.write).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="home-inbox"]')?.className).toContain("var(--home-auxiliary-width)");
    await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="inbox-filter-trigger"]')!.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})));
    const threads=[...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(item=>item.textContent==="Threads");
    expect(threads).toBeDefined();
    await act(async()=>threads!.click());
    expect(host.querySelector('[data-testid="home-inbox-detail"]')).toBeNull();
    expect(host.querySelector('[data-testid="home-inbox-detail-empty"]')).not.toBeNull();
    await render("other-human");
    expect(host.textContent).not.toContain("Scoped biography");
  }finally{await act(async()=>root.unmount());cache.clear();host.remove();vi.unstubAllGlobals();if(scrollDescriptor)Object.defineProperty(Element.prototype,"scrollIntoView",scrollDescriptor);else Reflect.deleteProperty(Element.prototype,"scrollIntoView");}
});

it("loads owned Agent activity through the admitted author query, never foreign installations or fabricated mentions",async()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});
  vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener(){},removeEventListener(){}}));
  const self="c".repeat(64), agent="d".repeat(64);
  api.workspaces.mockResolvedValue([{id:"workspace-a",name:"Channel",isMember:true}]);
  api.members.mockResolvedValue([{principalId:"human",displayName:"Me",pubkeys:[self],state:"ACTIVE"}]);
  const install={resourceId:"own-agent",workspaceId:"workspace-a",ownerPrincipalId:"human",state:"ACTIVE",resourceState:"ACTIVE",agentPrincipalState:"ACTIVE",channelBinding:{status:"ACTIVE"},projection:{state:"ACTIVE",generation:1},activeProjectionGeneration:1,agentPubkey:agent};
  api.agentInstallations.mockResolvedValue({installations:[install,{...install,resourceId:"foreign-agent",ownerPrincipalId:"other-human"}]});
  api.workspaceMessages.mockReset();
  api.workspaceMessages.mockImplementation(async (_id:string,query?:{agentInstallationId?:string})=>query?.agentInstallationId
    ? {events:[{...event,pubkey:agent,content:"Real owned Agent result"}]}
    : {events:[{...event,id:"e".repeat(64),kind:39006,tags:[...event.tags,["d","workspace-a:head"]],content:JSON.stringify({has_more:false,next_cursor:null})}]});
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  try {
    await act(async()=>root.render(<PlatformProvider client={api as unknown as BffClient} locale="en"><QueryClientProvider client={cache}><TooltipProvider><InboxPane principalId="human" onOpen={vi.fn()}/></TooltipProvider></QueryClientProvider></PlatformProvider>));
    await vi.waitFor(()=>expect(host.textContent).toContain("Real owned Agent result"));
    const avatar = host.querySelector<HTMLElement>(`[data-testid="home-inbox-item-${event.id}"] [data-avatar-shape]`)!;
    expect(avatar.getAttribute("data-avatar-shape")).toBe("squircle");
    expect(avatar.classList.contains("h-9")).toBe(true);
    expect(avatar.classList.contains("w-9")).toBe(true);
    expect(api.workspaceMessages.mock.calls.map(call=>call[1])).toEqual([undefined,{agentInstallationId:"own-agent"}]);
    expect(api.write).not.toHaveBeenCalled();
    api.agentInstallations.mockResolvedValue({installations:[{...install,agentPubkey:undefined}]});
    await act(async()=>window.dispatchEvent(new Event("focus")));
    await vi.waitFor(()=>expect(host.textContent).not.toContain("Real owned Agent result"));
    expect(host.querySelector('[role="status"]')).not.toBeNull();
  } finally {await act(async()=>root.unmount());cache.clear();host.remove();vi.unstubAllGlobals();}
});

it("does not continue the old aggregation after an awaited private page outlives its Inbox",async()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});
  vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener(){},removeEventListener(){}}));
  const conversation={id:"existing-dm",channelId:"native-dm",participantPrincipalIds:["human","peer"],state:"ACTIVE",version:1,operationId:"op"} as ConversationView;
  api.privateChannels=[conversation];api.workspaces.mockReset().mockResolvedValue([]);
  api.conversations.mockResolvedValue({items:[conversation]});
  api.conversationParticipants.mockResolvedValue({items:[{principalId:"human",displayName:"Me",pubkeys:["c".repeat(64)]}]});
  let finish!:(page:{events:unknown[]})=>void;
  api.conversationMessages.mockReset().mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});let mounted=true;
  try{
    await act(async()=>root.render(<PlatformProvider client={api as unknown as BffClient} locale="en"><ConversationVisibilityProvider value={{read:async()=>new Set(),prepare:async()=>async()=>{}}}><QueryClientProvider client={cache}><TooltipProvider><InboxPane principalId="human" onOpen={vi.fn()}/></TooltipProvider></QueryClientProvider></ConversationVisibilityProvider></PlatformProvider>));
    await vi.waitFor(()=>expect(api.conversationMessages).toHaveBeenCalledOnce());
    await act(async()=>root.unmount());mounted=false;
    await act(async()=>finish({events:[{...event,id:"e".repeat(64),kind:39006,tags:[["h","native-dm"],["d","native-dm:head"]],content:JSON.stringify({has_more:false,next_cursor:null})}]}));
    expect(api.workspaces).toHaveBeenCalledOnce();
  }finally{if(mounted)await act(async()=>root.unmount());cache.clear();host.remove();api.privateChannels=[];api.conversations.mockResolvedValue({items:[]});vi.unstubAllGlobals();}
});

it.each([true,false])("groups admitted hidden DMs (mention=%s), marks their channel and reopens the existing binding",async(mention)=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  setLocale("en");
  vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});
  vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener(){},removeEventListener(){}}));
  const self="c".repeat(64),channel="native-dm";
  const conversation={id:"existing-dm",channelId:channel,participantPrincipalIds:["human","peer"],state:"ACTIVE",version:1,operationId:"op"} as ConversationView;
  api.privateChannels=[conversation];api.workspaces.mockResolvedValue([]);
  api.conversations.mockResolvedValue({items:[conversation]});
  api.conversationParticipants.mockResolvedValue({items:[{principalId:"human",displayName:"Me",pubkeys:[self]},{principalId:"peer",displayName:"Peer",pubkeys:[event.pubkey]}]});
  api.write.mockClear();
  api.conversationMessages.mockResolvedValue({events:[{...event,content:"Existing hidden conversation",tags:[["h",channel],...(mention?[["p",self]]:[])]},{...event,id:"f".repeat(64),created_at:2,content:"Another incoming message",tags:[["h",channel]]},{...event,id:"e".repeat(64),kind:39006,tags:[["h",channel],["d",`${channel}:head`]],content:JSON.stringify({has_more:false,next_cursor:null})}]});
  let finish!:()=>void; const receipt=new Promise<void>(resolve=>{finish=resolve;});
  const publish=vi.fn(()=>receipt),prepare=vi.fn(async()=>publish),open=vi.fn();
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  try{
    await act(async()=>root.render(<PlatformProvider client={api as unknown as BffClient} locale="en"><ConversationVisibilityProvider value={{read:async()=>new Set([channel]),prepare}}><QueryClientProvider client={cache}><TooltipProvider><InboxPane principalId="human" onOpen={open}/></TooltipProvider></QueryClientProvider></ConversationVisibilityProvider></PlatformProvider>));
    await vi.waitFor(()=>expect(host.textContent).toContain("Existing hidden conversation"));
    expect(host.querySelectorAll('[data-testid="home-inbox-list"] [data-testid^="home-inbox-item-"]')).toHaveLength(1);
    expect(host.textContent).toContain("DM from Peer");
    const mark=host.querySelector<HTMLButtonElement>('button[aria-label="Mark as read"]');expect(mark).not.toBeNull();
    await act(async()=>mark!.click());
    expect(api.write).toHaveBeenCalledWith([{key:channel,seconds:2}]);
    const trigger=host.querySelector<HTMLButtonElement>('button[aria-label="Open in channel"]');expect(trigger).not.toBeNull();
    await act(async()=>trigger!.click());
    expect(open).not.toHaveBeenCalled();expect(prepare).toHaveBeenCalledWith(conversation,false);
    await act(async()=>finish());
    await vi.waitFor(()=>expect(open).toHaveBeenCalledWith(channel,{channelId:channel,messageId:event.id,threadRootId:null,conversation}));
    expect(publish).toHaveBeenCalledOnce();
  }finally{await act(async()=>root.unmount());cache.clear();host.remove();api.privateChannels=[];api.conversations.mockResolvedValue({items:[]});vi.unstubAllGlobals();}
});
