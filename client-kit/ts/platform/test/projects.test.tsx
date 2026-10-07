import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { beforeEach,describe,expect,it,vi } from "vitest";
import {setLocale} from "../src/i18n";
import {ProjectsView,loadProjects,type ProjectsHost} from "../src/react/projects";
import type {PulseEvent} from "../src/react/pulse/host";
import {buildProjectReadModels} from "../src/react/projects/projectModels";
import {render,button,click} from "./render";
import {ProjectDeleteAction} from "../src/react/projects/ProjectDeleteAction";
import {BffError,TransportError} from "../src/transport";
import {SidebarProjectsSection,type SidebarProjectMembership} from "../src/react/sidebar/SidebarProjectsSection";
import {SidebarProvider} from "../src/react/sidebar/sidebar";
import {AppSidebarPrimaryMenu} from "../src/react/sidebar/app-sidebar-primary-menu";
import {listSidebarProjects,writeSidebarProjectsFilter} from "../src/react/sidebar/listSidebarProjects";
import {act,useState} from "react";

const owner="a".repeat(64),other="b".repeat(64);
function project(name="Real project",id="p",time=10):PulseEvent{return {id,pubkey:owner,kind:30621,created_at:time,content:"",tags:[["d",id],["name",name],["description","Signed announcement"],["a",`30617:${other}:missing`]]};}
function host(rows:PulseEvent[]=[project()]):ProjectsHost{return {scopeKey:"tenant:owner",query:async req=>({events:req.view==="PROJECTS"?rows:[],pubkey:owner,limit:3})};}
const signal=()=>new AbortController().signal;
const deleteTrigger=({onOpen,pending}:{onOpen:()=>void;pending:boolean})=><button aria-label="Delete project" disabled={pending} onClick={onOpen}>Open deletion</button>;
beforeEach(()=>{setLocale("en");sessionStorage.clear();});

describe("original SidebarProjectsSection governed hosts",()=>{
  beforeEach(()=>Object.defineProperty(window,"matchMedia",{configurable:true,value:vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}))}));
  const childId="12345678-1234-1234-8234-123456789012";
  const membership=():SidebarProjectMembership=>({projectAddresses:[`30621:${owner}:p`],pending:false,addProject:vi.fn().mockResolvedValue(undefined),removeProject:vi.fn().mockResolvedValue(undefined),refresh:vi.fn().mockResolvedValue(undefined)});
  it("places the original project region after the primary header and does not select overview for a project",async()=>{
    const ui=await render(<SidebarProvider><AppSidebarPrimaryMenu selectedView="platform" selectedPlatformSection="projects" projectsOverviewActive={false}
      onNewMessage={vi.fn()} onSelectHome={vi.fn()} onSelectPlatformSection={vi.fn()} projectsSection={<div data-testid="project-region"/>}/></SidebarProvider>);
    expect(ui.querySelector('[data-testid="sidebar-platform-projects"]')?.getAttribute("data-active")).toBe("false");
    expect(ui.querySelector('[data-testid="sidebar-primary-menu"]')?.contains(ui.querySelector('[data-testid="project-region"]'))).toBe(false);
    expect(ui.querySelector('[data-testid="project-region"]')).not.toBeNull();
  });
  async function sidebar(h=host(),m=membership(),onSelectProject=vi.fn(),onSelectChannel=vi.fn()){
    writeSidebarProjectsFilter("added",h.scopeKey);
    const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
    const ui=await render(<QueryClientProvider client={cache}><SidebarProvider><SidebarProjectsSection host={h} membership={m}
      channels={[{id:childId,name:"Real channel",visibility:"private"}]} selectedProjectId={null} selectedChannelId={null}
      onSelectProject={onSelectProject} onSelectChannel={onSelectChannel}/></SidebarProvider></QueryClientProvider>);
    return {ui,cache};
  }
  it("keeps Added distinct from Owned and preserves original ordering without local membership",()=>{
    const a=buildProjectReadModels({projectEvents:[project("Zulu","a",20),{...project("Alpha","b",10),pubkey:other}],repositoryEvents:[]});
    expect(listSidebarProjects({projects:a,currentPubkey:owner,filter:"owned",sort:"name",addedProjectAddresses:new Set()}).map(p=>p.name)).toEqual(["Zulu"]);
    expect(listSidebarProjects({projects:a,currentPubkey:owner,filter:"added",sort:"name",addedProjectAddresses:new Set([`30621:${other}:b`])}).map(p=>p.name)).toEqual(["Alpha"]);
  });
  it("renders the original section, opens a real project and expands only admitted child channels",async()=>{
    const source=project();source.tags.push(["buzz-related-channel",childId],["buzz-related-channel","22345678-1234-1234-8234-123456789012"]);
    const onProject=vi.fn(),onChannel=vi.fn();const {ui}=await sidebar(host([source]),membership(),onProject,onChannel);
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="sidebar-project-p"]')).not.toBeNull());
    await click(ui.querySelector<HTMLButtonElement>('[data-testid="sidebar-project-p"]')!);expect(onProject).toHaveBeenCalledWith(`30621:${owner}:p`);
    await click(ui.querySelector<HTMLButtonElement>('[data-testid="sidebar-project-expand-p"]')!);
    expect(ui.querySelectorAll('[data-testid^="sidebar-project-channel-"]')).toHaveLength(1);
    expect(ui.textContent).not.toContain("not-admitted");
    await click(ui.querySelector<HTMLButtonElement>('[data-testid="sidebar-project-channel-p-Real channel"]')!);expect(onChannel).toHaveBeenCalledWith(childId);
    await click(ui.querySelector<HTMLButtonElement>('[data-testid="sidebar-projects-section-label"]')!);expect(ui.querySelector('[data-testid="sidebar-project-p"]')).toBeNull();
  });
  it("does not retain a project after the authoritative directory refresh fails",async()=>{
    const h=host();const {ui,cache}=await sidebar(h);
    await vi.waitFor(()=>expect(ui.textContent).toContain("Real project"));
    h.query=async()=>{throw new Error("scope revoked");};
    await act(async()=>{await cache.invalidateQueries({queryKey:["sidebar-projects",h.scopeKey]});});
    await vi.waitFor(()=>expect(ui.querySelector('[role="alert"]')).not.toBeNull());
    expect(ui.querySelector('[data-testid="sidebar-project-p"]')).toBeNull();
  });
  it("uses the actual controlled project route and clears it on the original detail close",async()=>{
    const h=host();const cache=new QueryClient();const changed=vi.fn();
    function Host(){const [selected,setSelected]=useState<string|null>(`30621:${owner}:p`);return <ProjectsView host={h} selectedProjectId={selected} onSelectedProjectChange={id=>{changed(id);setSelected(id);}}/>;}
    const ui=await render(<QueryClientProvider client={cache}><Host/></QueryClientProvider>);
    await vi.waitFor(()=>expect(ui.querySelector("aside")).not.toBeNull());
    await click(ui.querySelector<HTMLButtonElement>('button[aria-label="Close project announcement"]')!);
    expect(changed).toHaveBeenCalledWith(null);expect(ui.querySelector("aside")).toBeNull();
  });
  it("uses the Chinese catalog for the original section and Add control",async()=>{
    setLocale("zh-CN");const {ui}=await sidebar(host([]));
    await vi.waitFor(()=>expect(ui.textContent).toContain("暂无项目"));
    expect(ui.querySelector('[data-testid="sidebar-projects-create"]')?.getAttribute("aria-label")).toBe("添加项目");
  });
  it("uses the real Add preference callback and never navigates on an unknown result",async()=>{
    const m=membership();m.projectAddresses=[];m.addProject=vi.fn().mockRejectedValue(new TransportError("lost confirmation"));
    const navigate=vi.fn();const {ui}=await sidebar(host(),m,navigate);
    await vi.waitFor(()=>expect(ui.querySelector<HTMLButtonElement>('[data-testid="sidebar-projects-create"]')?.disabled).toBe(false));
    await click(ui.querySelector<HTMLButtonElement>('[data-testid="sidebar-projects-create"]')!);
    await click(document.querySelector<HTMLButtonElement>('[data-testid="project-browser-result-p"]')!);
    expect(m.addProject).toHaveBeenCalledWith(`30621:${owner}:p`);expect(navigate).not.toHaveBeenCalled();
    m.addProject=vi.fn().mockResolvedValue(undefined);
    await click(ui.querySelector<HTMLButtonElement>('[data-testid="sidebar-projects-create"]')!);
    await click(document.querySelector<HTMLButtonElement>('[data-testid="project-browser-result-p"]')!);
    expect(navigate).toHaveBeenCalledWith(`30621:${owner}:p`);
  });
  it("does not navigate when an old Add completes after the sidebar scope unmounts",async()=>{
    let resolve!:()=>void;const m=membership();m.addProject=()=>new Promise<void>(done=>{resolve=done;});
    const navigate=vi.fn(),h=host();const cache=new QueryClient();
    function Host(){const [active,setActive]=useState(true);return <><button onClick={()=>setActive(false)}>Leave scope</button>
      {active?<SidebarProvider><SidebarProjectsSection host={h} membership={m} channels={[]} onSelectProject={navigate} onSelectChannel={vi.fn()}/></SidebarProvider>:null}</>;}
    const ui=await render(<QueryClientProvider client={cache}><Host/></QueryClientProvider>);
    await vi.waitFor(()=>expect(ui.querySelector<HTMLButtonElement>('[data-testid="sidebar-projects-create"]')?.disabled).toBe(false));
    await click(ui.querySelector<HTMLButtonElement>('[data-testid="sidebar-projects-create"]')!);
    await click(document.querySelector<HTMLButtonElement>('[data-testid="project-browser-result-p"]')!);
    await click(button(ui,"Leave scope"));
    await act(async()=>resolve());expect(navigate).not.toHaveBeenCalled();
  });
});

describe("original Projects announcements",()=>{
  it("reads actual NIP-MP names and retains unresolved repository coordinates without guessing access",async()=>{
    const read=await loadProjects(host(),signal());
    expect(read[0]?.name).toBe("Real project");expect(read[0]?.owner).toBe(owner);
    expect(read[0]?.repositories).toEqual([]);
    expect(read[0]?.unavailableRepositoryAddresses).toEqual([`30617:${other}:missing`]);
  });
  it("only enumerates scoped tombstones and fails closed rather than resurrecting deleted projects",async()=>{
    const h=host();const fetch=h.query;h.query=vi.fn(async req=>{if(req.view==="DELETIONS")throw new Error("Relay unreachable");return fetch(req);});
    await expect(loadProjects(h,signal())).rejects.toThrow("Relay unreachable");
    expect(h.query).toHaveBeenCalledWith(expect.objectContaining({view:"DELETIONS",coordinates:[`30621:${owner}:p`]}));
    const deleted=buildProjectReadModels({projectEvents:[project()],repositoryEvents:[],deletionEvents:[{id:"d",pubkey:owner,kind:5,created_at:11,content:"",tags:[["a",`30621:${owner}:p`]]}]});
    expect(deleted).toEqual([]);
  });
  it("retains the upstream unlisted owner boundary and canonical NIP-MP membership checks",()=>{
    const hidden=project();hidden.tags.push(["buzz-visibility","unlisted"]);
    expect(buildProjectReadModels({projectEvents:[hidden],repositoryEvents:[],viewerPubkey:other})).toEqual([]);
    expect(buildProjectReadModels({projectEvents:[hidden],repositoryEvents:[],viewerPubkey:owner})).toHaveLength(1);
    const invalid=project();invalid.tags.push(["a",`30617:${other}:missing`]);
    expect(buildProjectReadModels({projectEvents:[invalid],repositoryEvents:[]})).toEqual([]);
  });
  it("drains the full oldest second before advancing and refuses an uncompletable bucket",async()=>{
    const query=vi.fn<ProjectsHost["query"]>(async req=>({pubkey:owner,limit:2,events:req.view!=="PROJECTS"?[]:req.since!==undefined?[project("boundary","b",8)]:req.until===7?[project("older","c",7)]:[project("new","a",10),project("boundary","b",8)]}));
    expect(await loadProjects({scopeKey:"scope",query},signal())).toHaveLength(3);
    expect(query).toHaveBeenCalledWith({view:"PROJECTS",coordinates:undefined,since:8,until:8});
    const saturated:ProjectsHost={scopeKey:"scope",query:async req=>({pubkey:owner,limit:2,events:req.view==="PROJECTS"?[project("a","a",8),project("b","b",8)]:[]})};
    await expect(loadProjects(saturated,signal())).rejects.toThrow("timestamp bucket");
  });
  it("refuses a changed signing identity during enumeration",async()=>{
    let n=0;const h:ProjectsHost={scopeKey:"scope",query:async()=>({pubkey:n++===0?owner:other,limit:3,events:[]})};
    await expect(loadProjects(h,signal())).rejects.toThrow("scope changed");
  });
  it("cancels further enumeration when leaving the scope",async()=>{
    const abort=new AbortController();const h=host();const query=h.query;h.query=async r=>{abort.abort();return query(r);};
    await expect(loadProjects(h,abort.signal)).rejects.toThrow();
  });
  it("opens the original announcement card, switches layout and removes old detail on failed fresh read",async()=>{
    const h=host();const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
    const ui=await render(<QueryClientProvider client={cache}><ProjectsView host={h}/></QueryClientProvider>);
    await vi.waitFor(()=>expect(ui.textContent).toContain("Real project"));
    await click(button(ui,"View Real project"));
    expect(ui.querySelector("aside")?.textContent).toContain(`30617:${other}:missing`);
    expect(ui.querySelector("aside")?.textContent).toContain("does not grant access");
    await click(ui.querySelector<HTMLButtonElement>('button[aria-label="List layout"]')!);expect(ui.querySelectorAll("[data-projects-grid-card]")).toHaveLength(0);
    h.query=async()=>{throw new Error("revoked");};await click(ui.querySelector<HTMLButtonElement>('button[aria-label="Try again"]')!);
    await vi.waitFor(()=>expect(ui.querySelector('[role="alert"]')).not.toBeNull());
    expect(ui.querySelector("aside")).toBeNull();expect(ui.textContent).not.toContain("Real project");
  });
  it("uses the same Chinese catalog without fabricating create or Git actions",async()=>{
    setLocale("zh-CN");const cache=new QueryClient();
    const ui=await render(<QueryClientProvider client={cache}><ProjectsView host={host([])}/></QueryClientProvider>);
    await vi.waitFor(()=>expect(ui.textContent).toContain("暂无项目"));
    expect(ui.querySelector('button[aria-label="网格布局"]')).not.toBeNull();
    expect(ui.textContent).not.toMatch(/Create project|Delete project|terminal/);
  });
  it("retains the original project deletion dialog and clears only after its accepted tombstone is read back",async()=>{
    const source=project("Owned", "c".repeat(64));const model=buildProjectReadModels({projectEvents:[source],repositoryEvents:[]})[0]!;
    const publish=vi.fn().mockResolvedValue({eventId:"d".repeat(64)});const removed=vi.fn();
    const h={...host([]),publish};
    const ui=await render(<ProjectDeleteAction renderTrigger={deleteTrigger} project={model} headId={source.id} viewerPubkey={owner} host={h} onDeleted={removed}/>);
    await click(ui.querySelector<HTMLButtonElement>('button[aria-label="Delete project"]')!);
    expect(document.body.textContent).toContain("Delete Owned from Projects for everyone");
    await click(button(document.body,"Delete project"));
    expect(publish).toHaveBeenCalledWith({operation:"DELETE",targetEventId:source.id},expect.any(String),false,expect.objectContaining({onPrepared:expect.any(Function)}));
    expect(removed).toHaveBeenCalledOnce();expect(sessionStorage.length).toBe(0);
  });
  it("does not discard an UNKNOWN intent after a later denied observation or modal close",async()=>{
    const source=project("Owned", "c".repeat(64));const model=buildProjectReadModels({projectEvents:[source],repositoryEvents:[]})[0]!;
    const publish=vi.fn().mockRejectedValueOnce(new TransportError("lost ACK"))
      .mockRejectedValueOnce(new BffError(403,"Revoked")).mockResolvedValueOnce({eventId:"d".repeat(64)});
    const removed=vi.fn();const h={...host([]),publish};
    const ui=await render(<ProjectDeleteAction renderTrigger={deleteTrigger} project={model} headId={source.id} viewerPubkey={owner} host={h} onDeleted={removed}/>);
    await click(ui.querySelector<HTMLButtonElement>('button[aria-label="Delete project"]')!);
    await click(button(document.body,"Delete project"));
    expect(document.body.textContent).toContain("Could not confirm");
    await click(button(document.body,"Cancel"));await click(ui.querySelector<HTMLButtonElement>('button[aria-label="Delete project"]')!);
    await click(button(document.body,"Delete project"));
    expect(document.body.textContent).toContain("Could not confirm");expect(removed).not.toHaveBeenCalled();
    await click(button(document.body,"Delete project"));
    const first=publish.mock.calls[0]!;
    expect(publish.mock.calls[1]?.slice(0,3)).toEqual([first[0],first[1],true]);expect(publish.mock.calls[2]?.slice(0,3)).toEqual([first[0],first[1],true]);
    expect(removed).toHaveBeenCalledOnce();
  });
  it("does not grant another device key project ownership or remove a concurrent newer head",async()=>{
    const source=project("Owned", "c".repeat(64));const model=buildProjectReadModels({projectEvents:[source],repositoryEvents:[]})[0]!;
    const publish=vi.fn().mockResolvedValue({eventId:"d".repeat(64)});const removed=vi.fn();const h={...host([source]),publish};
    const foreign=await render(<ProjectDeleteAction renderTrigger={deleteTrigger} project={model} headId={source.id} viewerPubkey={other} host={h} onDeleted={removed}/>);
    expect(foreign.querySelector("button")).toBeNull();
    const ui=await render(<ProjectDeleteAction renderTrigger={deleteTrigger} project={model} headId={source.id} viewerPubkey={owner} host={h} onDeleted={removed}/>);
    await click(ui.querySelector<HTMLButtonElement>('button[aria-label="Delete project"]')!);await click(button(document.body,"Delete project"));
    expect(document.body.textContent).toContain("updated while it was being deleted");expect(removed).not.toHaveBeenCalled();
  });
  it("retains an ACK through failed readback and remount without another publication",async()=>{
    const source=project("Owned","c".repeat(64));const model=buildProjectReadModels({projectEvents:[source],repositoryEvents:[]})[0]!;
    const publish=vi.fn().mockResolvedValue({eventId:"d".repeat(64)}),completePublication=vi.fn(),removed=vi.fn();
    const h={...host([]),publish,completePublication};const fresh=h.query;
    h.query=vi.fn().mockRejectedValueOnce(new Error("directory offline")).mockImplementation(fresh);
    function Host(){const [generation,next]=useState(0);return <><button onClick={()=>next(generation+1)}>Restart view</button><ProjectDeleteAction key={generation} renderTrigger={deleteTrigger} project={model} headId={source.id} viewerPubkey={owner} host={h} onDeleted={removed}/></>;}
    const ui=await render(<Host/>);
    await click(ui.querySelector<HTMLButtonElement>('[aria-label="Delete project"]')!);await click(button(document.body,"Delete project"));
    expect(removed).not.toHaveBeenCalled();expect(completePublication).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!).acceptedEventId).toBe("d".repeat(64));
    await click(button(ui,"Restart view"));await click(ui.querySelector<HTMLButtonElement>('[aria-label="Delete project"]')!);await click(button(document.body,"Delete project"));
    expect(publish).toHaveBeenCalledTimes(1);expect(removed).toHaveBeenCalledOnce();
    expect(completePublication).toHaveBeenCalledWith(publish.mock.calls[0]![1],"d".repeat(64));expect(sessionStorage.length).toBe(0);
  });
  it("persists the prepared event reference before Native publication and observes it after remount",async()=>{
    const source=project("Owned","c".repeat(64));const model=buildProjectReadModels({projectEvents:[source],repositoryEvents:[]})[0]!;
    const eventId="d".repeat(64);const removed=vi.fn();
    const publish=vi.fn<NonNullable<ProjectsHost["publish"]>>().mockImplementationOnce(async(_request,_key,_observe,observation)=>{
      observation!.onPrepared(eventId);
      expect(JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!).eventId).toBe(eventId);
      throw new TransportError("lost ACK");
    }).mockResolvedValueOnce({eventId});
    const h={...host([]),publish};
    function Host(){const [generation,next]=useState(0);return <><button onClick={()=>next(generation+1)}>Restart view</button><ProjectDeleteAction key={generation} renderTrigger={deleteTrigger} project={model} headId={source.id} viewerPubkey={owner} host={h} onDeleted={removed}/></>;}
    const ui=await render(<Host/>);
    await click(ui.querySelector<HTMLButtonElement>('[aria-label="Delete project"]')!);await click(button(document.body,"Delete project"));
    await click(button(ui,"Restart view"));await click(ui.querySelector<HTMLButtonElement>('[aria-label="Delete project"]')!);await click(button(document.body,"Delete project"));
    expect(publish.mock.calls[1]?.slice(0,3)).toEqual([publish.mock.calls[0]![0],publish.mock.calls[0]![1],true]);
    expect(publish.mock.calls[1]?.[3]?.eventId).toBe(eventId);expect(removed).toHaveBeenCalledOnce();
  });
});
