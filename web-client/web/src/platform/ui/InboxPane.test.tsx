// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { setLocale } from "@client-kit/platform/i18n";
import { PlatformProvider } from "@client-kit/platform/react/context";
import type { BffClient } from "@client-kit/platform/client";
import { describe, expect, it, vi } from "vitest";
import { InboxPane, inboxEvents } from "./InboxPane";
import { inboxWindowEvents } from "./inbox-events";

const api=vi.hoisted(()=>({workspaces:vi.fn(),members:vi.fn(),workspaceMessages:vi.fn(),messageAuthorProfile:vi.fn(),write:vi.fn()}));
const readAt=()=>null;
vi.mock("@client-kit/platform/react/use-inbox-state",()=>({inboxReadContexts:()=>[],useInboxState:()=>({state:{},failed:false,unknown:false,pending:false,visibleChannels:new Set(["workspace-a"]),readAt,write:api.write,refresh:vi.fn()})}));
vi.mock("@/platform/bff-client",()=>({bff:api,openStream:()=>()=>{}}));
vi.mock("./ChannelPane",()=>({Composer:()=>null,ChannelPane:()=>null}));

const event = {
  id: "a".repeat(64),
  pubkey: "b".repeat(64),
  kind: 9,
  created_at: 1,
  content: "message",
  tags: [["h", "workspace-a"]],
};

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
  setLocale("en"); localStorage.clear(); sessionStorage.clear();
  vi.stubGlobal("ResizeObserver",class{constructor(private callback:ResizeObserverCallback){} observe(){this.callback([{contentRect:{width:1400}} as ResizeObserverEntry],this as unknown as ResizeObserver);} unobserve(){} disconnect(){}});
  vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener(){},removeEventListener(){}}));
  const self="c".repeat(64);
  api.workspaces.mockResolvedValue([{id:"workspace-a",name:"Admitted channel",isMember:true}]);
  api.members.mockResolvedValue([{principalId:"human",displayName:"Me",pubkeys:[self],state:"ACTIVE"},{principalId:"author",displayName:"Author",pubkeys:[event.pubkey],state:"ACTIVE"}]);
  api.workspaceMessages.mockResolvedValue({events:[{...event,tags:[...event.tags,["p",self]]},{...event,id:"d".repeat(64),kind:39006,tags:[...event.tags,["d","workspace-a:head"]],content:JSON.stringify({has_more:false,next_cursor:null})}]});
  api.messageAuthorProfile.mockResolvedValue({pubkey:event.pubkey,eventId:"profile",displayName:"Verified author",about:"Scoped biography",avatarUrl:null,nip05Handle:null,avatarMediaPaths:{}});
  api.messageAuthorProfile.mockClear(); api.write.mockClear();
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  const render=(principalId:string)=>act(async()=>root.render(<PlatformProvider client={api as unknown as BffClient} locale="en"><QueryClientProvider client={cache}><TooltipProvider><InboxPane principalId={principalId} onOpen={vi.fn()}/></TooltipProvider></QueryClientProvider></PlatformProvider>));
  try{
    await render("human");
    await vi.waitFor(()=>expect(host.querySelector(`[data-testid="home-inbox-item-${event.id}"]`)).not.toBeNull());
    expect(api.messageAuthorProfile).not.toHaveBeenCalled();
    const trigger=host.querySelector<HTMLElement>(`[data-testid="home-inbox-item-${event.id}"] [role="button"][aria-label="Profile"]`)!;
    await act(async()=>trigger.click());
    await vi.waitFor(()=>expect(host.textContent).toContain("Scoped biography"));
    expect(api.messageAuthorProfile).toHaveBeenCalledWith("workspace-a",event.id);
    expect(api.write).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="home-inbox"]')?.className).toContain("var(--home-auxiliary-width)");
    await render("other-human");
    expect(host.textContent).not.toContain("Scoped biography");
  }finally{await act(async()=>root.unmount());cache.clear();host.remove();vi.unstubAllGlobals();}
});
