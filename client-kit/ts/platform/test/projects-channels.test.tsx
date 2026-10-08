import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelType, WorkspaceMembershipState, WorkspaceVisibility, type DiscoverableWorkspace, type WorkspaceMemberView } from "@client-kit/contracts";
import { createBffClient } from "../src/client";
import { setLocale, translate } from "../src/i18n";
import { PlatformProvider } from "../src/react/context";
import { loadChannelDirectory } from "../src/react/channel-browser/loadChannelDirectory";
import { ProjectsChannelsList } from "../src/react/projects/ProjectsChannelsList";
import { ProjectsView, type ProjectsHost } from "../src/react/projects";
import { buildProjectReadModels } from "../src/react/projects/projectModels";
import { relativeTime } from "../src/react/projects/lib/projectsViewHelpers";
import type { BffRequest } from "../src/transport";
import { button, click, render, settle, type } from "./render";

const pubkey="a".repeat(64),deviceKey="b".repeat(64),owner="c".repeat(64);
const stream="12345678-1234-4234-8234-123456789012",discussion="22345678-1234-4234-8234-123456789012",unavailable="32345678-1234-4234-8234-123456789012";
const event={id:"4".repeat(64),pubkey:owner,kind:30621,created_at:10,content:"",tags:[
  ["d","project"],["name","Original project"],["buzz-channel",stream],["buzz-related-channel",discussion],["buzz-related-channel",unavailable],
]};
const projects=buildProjectReadModels({projectEvents:[event],repositoryEvents:[]});
const channel=(channelId=stream,name="Development"):DiscoverableWorkspace=>({id:`workspace-${channelId}`,visibility:WorkspaceVisibility.Open,
  channel:{channelId,channelType:ChannelType.Stream,name,description:"Original **channel** description",archived:false},
  isMember:true,membershipState:WorkspaceMembershipState.Active,memberCount:9,createdAt:new Date("2026-10-07T00:00:00Z")});
const member:WorkspaceMemberView={principalId:"human-principal",displayName:"Real human",pubkeys:[pubkey,deviceKey],state:WorkspaceMembershipState.Active};
const profile={pubkey,displayName:"Real profile",avatarUrl:"original-avatar",avatarMediaPaths:{"original-avatar":"/authorized-avatar"},about:"Actual profile",nip05Handle:null};
const cache=()=>new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
beforeEach(()=>{localStorage.clear();setLocale("en");
  vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});
  HTMLElement.prototype.scrollIntoView=vi.fn();
  Object.defineProperty(window,"matchMedia",{configurable:true,value:vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn(),addListener:vi.fn(),removeListener:vi.fn()}))});
});

function fixture(route?:(request:BffRequest)=>unknown){
  const send=vi.fn(async(request:BffRequest)=>({status:200,body:route?route(request):request.path.startsWith("/api/v1/discoverable-workspaces")?
    {items:[channel(),channel(discussion,"Discussion")]}:request.path.endsWith("/members")?[member]:request.path.includes("/profiles/")?profile:{workspaces:[]}}));
  const client=createBffClient({send});
  const open=vi.fn();
  async function mount(searchQuery="",renderMember?:Parameters<typeof ProjectsChannelsList>[0]["renderMember"]){
    return render(<PlatformProvider client={client} locale="en"><QueryClientProvider client={cache()}><ProjectsChannelsList
      projects={projects} scopeKey="real-session" searchQuery={searchQuery} onOpenChannel={open} renderMember={renderMember}
      lastMessageAtByChannelId={new Map([[stream,"2026-10-07T00:00:00Z"],[discussion,"2026-10-08T00:00:00Z"]])}/></QueryClientProvider></PlatformProvider>);
  }
  return {send,client,open,mount};
}

describe("original Projects channels with real governed consumers",()=>{
  it("retains original grouping, description columns, activity ordering, counts and unavailable rows",async()=>{
    expect(projects[0]?.relatedChannelIds).toEqual([discussion,unavailable]);
    const f=fixture();const ui=await f.mount();
    await vi.waitFor(()=>expect(ui.querySelectorAll('[data-testid="project-channel-row"]')).toHaveLength(3));
    const rows=[...ui.querySelectorAll<HTMLElement>('[data-testid="project-channel-row"]')];
    expect(rows.map(row=>row.querySelector('[data-testid="project-entity-title"]')?.textContent)).toEqual(["#Discussion","#Development","Channel unavailable"]);
    expect(rows[0]?.querySelector('[data-testid="project-entity-description"]')?.textContent).toBe("Original channel description");
    expect(rows[0]?.querySelector('[data-testid="project-entity-description"]')?.className).toContain("lg:block");
    expect(rows[0]?.querySelector('[data-testid="project-channel-message-count"]')?.textContent).toBe("9");
    expect(rows[0]?.querySelector('[data-testid="project-channel-row-date"]')).not.toBeNull();
    expect(rows[2]?.querySelector("button")).toBeNull();
    expect(rows[2]?.querySelector('[data-testid="project-channel-message-count"]')?.textContent).toBe("");
    expect(rows[2]?.querySelector('[data-testid="project-channel-row-date"]')).toBeNull();
    const group=ui.querySelector('[data-testid="projects-channel-project-group-header"]')!;
    expect(group.className).toContain("mx-0");expect(group.className).toContain("px-4");
    await click(button(ui,"Original project"));expect(ui.querySelectorAll('[data-testid="project-channel-row"]')).toHaveLength(0);
    expect(group.textContent).toContain("3");
    await click(group.querySelector<HTMLButtonElement>("button")!);expect(ui.querySelectorAll('[data-testid="project-channel-row"]')).toHaveLength(3);
    expect(f.send.mock.calls.filter(([request])=>request.method!=="GET")).toHaveLength(0);
  });
  it("uses token-wise original search across project, channel and description instead of inventing a second filter",async()=>{
    const f=fixture();const ui=await f.mount("Development Original");
    await vi.waitFor(()=>expect(ui.querySelectorAll('[data-testid="project-channel-row"]')).toHaveLength(1));
    expect(ui.textContent).toContain("#Development");expect(ui.textContent).not.toContain("#Discussion");
  });
  it("resolves one human profile per Principal, not one person per active device key",async()=>{
    const f=fixture();const ui=await f.mount();
    await vi.waitFor(()=>expect(ui.querySelectorAll('[aria-label="Open profile for Real human"]')).toHaveLength(2));
    expect(f.send.mock.calls.some(([r])=>r.path.includes(`/members/${member.principalId}/profiles/${pubkey}`))).toBe(true);
    expect(f.send.mock.calls.some(([r])=>r.path.includes(`/profiles/${deviceKey}`))).toBe(false);
    const identities=ui.querySelectorAll('[data-testid="project-channel-participants"] [role="button"]');
    expect(identities).toHaveLength(2);expect(ui.querySelectorAll("button button")).toHaveLength(0);
    await click(identities[0] as HTMLElement);
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="member-profile-panel"]')?.textContent).toContain("Real profile"));
  });
  it("uses the native identity/media host without issuing Web avatar/profile reads",async()=>{
    const f=fixture();const renderer=vi.fn((row:WorkspaceMemberView,trigger:{className:string;label:string})=><span className={trigger.className} data-testid="native-identity">{row.principalId}</span>);
    const ui=await f.mount("",renderer);await vi.waitFor(()=>expect(ui.querySelectorAll('[data-testid="native-identity"]')).toHaveLength(2));
    expect(renderer.mock.calls[0]?.[0].pubkeys).toEqual([pubkey,deviceKey]);
    expect(f.send.mock.calls.some(([r])=>r.path.includes("/profiles/"))).toBe(false);
  });
  it("re-reads current membership before handing the exact trusted workspace/channel pair to its host",async()=>{
    const f=fixture();const ui=await f.mount();await vi.waitFor(()=>expect(ui.querySelector('[title="Open #Development"]')).not.toBeNull());
    const reads=f.send.mock.calls.filter(([r])=>r.path.includes("discoverable-workspaces")).length;
    await click(ui.querySelector<HTMLButtonElement>('[title="Open #Development"]')!);
    expect(f.open).toHaveBeenCalledWith(channel());
    expect(f.send.mock.calls.filter(([r])=>r.path.includes("discoverable-workspaces"))).toHaveLength(reads+1);
  });
  it("does not navigate after revocation and removes the old accessible details",async()=>{
    let active=true;const f=fixture(request=>request.path.includes("discoverable-workspaces")?{items:[{...channel(),isMember:active,membershipState:active?"ACTIVE":"REVOKED"}]}:request.path.endsWith("/members")?[member]:profile);
    const ui=await f.mount();await vi.waitFor(()=>expect(ui.querySelector('[title="Open #Development"]')).not.toBeNull());active=false;
    await click(ui.querySelector<HTMLButtonElement>('[title="Open #Development"]')!);
    await vi.waitFor(()=>expect(ui.querySelector('[title="Open #Development"]')).toBeNull());
    expect(f.open).not.toHaveBeenCalled();expect(ui.textContent).not.toContain("Original channel description");
    expect(ui.querySelector('[role="alert"]')).not.toBeNull();
  });
  it.each(["unknown-type","duplicate-channel","repeated-cursor"])("fails closed on %s directory facts",async kind=>{
    const f=fixture(()=>kind==="unknown-type"?{items:[{...channel(),channel:{...channel().channel,channelType:"future"}}]}:
      kind==="duplicate-channel"?{items:[channel(),{...channel(),id:"another-workspace"}]}:{items:[],nextCursor:"repeated"});
    const ui=await f.mount();await vi.waitFor(()=>expect(ui.textContent).toContain("Couldn't load this"));
    expect(ui.querySelector('[data-testid="projects-channels-list"]')).toBeNull();expect(f.open).not.toHaveBeenCalled();
  });
  it("does not finish an in-flight directory read after its owning scope leaves",async()=>{
    let current=true;let release!:(value:unknown)=>void;
    const client=createBffClient({send:async()=>({status:200,body:await new Promise(resolve=>{release=resolve;})})});
    const pending=loadChannelDirectory(client,()=>current);current=false;release({items:[channel()]});
    await expect(pending).rejects.toThrow("scope changed");
  });
  it("restores the actual original search close/Escape and Channels tab in the shared Projects page",async()=>{
    const f=fixture();const h:ProjectsHost={scopeKey:"page",query:async request=>({events:request.view==="PROJECTS"?[event]:[],limit:20,pubkey:owner})};
    const ui=await render(<PlatformProvider client={f.client} locale="en"><QueryClientProvider client={cache()}><ProjectsView host={h} onOpenChannel={f.open}/></QueryClientProvider></PlatformProvider>);
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="projects-section-channels"]')).not.toBeNull());
    await click(ui.querySelector<HTMLButtonElement>('[data-testid="projects-section-channels"]')!);
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="projects-channels-list"]')).not.toBeNull());
    expect(ui.querySelector('[aria-label="Grid layout"]')).toBeNull();
    await click(ui.querySelector<HTMLButtonElement>('[data-testid="projects-activity-search"]')!);
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="projects-section-search-input"]')).not.toBeNull());
    const input=ui.querySelector<HTMLInputElement>('[data-testid="projects-section-search-input"]')!;await type(input,"absent");
    await vi.waitFor(()=>expect(ui.textContent).toContain("No matching channels"));
    await act(async()=>{input.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}));});await settle();
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="projects-section-channels"]')).not.toBeNull());
    expect(ui.querySelector('[data-testid="projects-channels-list"]')).not.toBeNull();
  });
  it("keeps original floor/clamp/calendar timestamp rules and Chinese translations",()=>{
    expect(relativeTime(10,70.9,"en")).toBe("1 minute ago");
    expect(relativeTime(20,10,"en")).toBe("1 second ago");
    expect(relativeTime(10,86410,"en")).toBe("1 day ago");
    expect(relativeTime(10,86410,"zh-CN")).toBe("1 天前");
    expect(relativeTime(10,604810,"en")).toBe(new Date(10000).toLocaleDateString("en",{month:"short",day:"numeric"}));
    expect(translate("zh-CN","projects.channels.empty")).toBe("暂无项目频道");
  });
});
