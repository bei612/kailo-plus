import {beforeEach,describe,expect,it,vi} from "vitest";
import {act,useState} from "react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {createBffClient} from "../src/client";
import {setLocale} from "../src/i18n";
import {PlatformProvider} from "../src/react/context";
import {PulseHostProvider,type PulseHost,type PulseEvent} from "../src/react/pulse/host";
import {TooltipProvider} from "../src/react/sidebar/tooltip";
import {loadProjectWorkItems,projectInboxMentions,resolveProjectInboxWorkItem,projectWorkItemTarget,ProjectInboxDetail,ProjectOriginReferenceContent,ProjectsView,type ProjectsHost} from "../src/react/projects";
import {aggregateInbox,inboxReadContext,matchesInbox} from "../src/inbox";
import {inboxReadContexts} from "../src/react/use-inbox-state";
import {render,click} from "./render";
import {EntityLinkAnchor,openProjectEntity,parseEntityLink} from "../src/react/projects";
import {issueShareLink} from "../src/react/projects/projectShareLinks";
import {ShareLinkButton} from "../src/react/projects/ShareLinkButton";
import {toast} from "sonner";
import {resolveExactLinkPaste} from "../src/react/composer/features/messages/lib/composerMessageLinkNode";
import {ProjectChannelHome} from "../src/react/projects/ProjectChannelHome";
import {IdleAuxiliarySurface,type IdleAuxiliaryProps} from "../src/react/messages/thread";
import {ChannelType,WorkspaceMembershipState,WorkspaceVisibility} from "@client-kit/contracts";

const viewer="a".repeat(64),author="b".repeat(64),repository=`30617:${author}:repo`;
const event=(id:string,kind:number,tags:string[][],content="",time=20):PulseEvent=>({id:id.repeat(64),kind,pubkey:author,tags,content,created_at:time});
function fixture(){
  const issue=event("1",1621,[["a",repository],["subject","Original task"],["p",viewer]],"Complete task body");
  const review=event("2",1618,[["a",repository],["subject","Original review"],["p",viewer],["commit","f".repeat(40)],["branch","feature"],["branch-name","feature"],["target-branch","main"]],"Complete review body");
  const comments=Array.from({length:4},(_,index)=>event(String(index+3),1,[["a",repository],["e",issue.id],["p",viewer]],`Original comment ${index}`,30+index));
  const rows=[
    event("8",30617,[["d","repo"],["name","Original repo"],["clone","https://example.test/repo.git"]]),
    event("9",30621,[["d","project"],["name","Original project"],["a",repository]]),
    issue,review,...comments,
    event("e",1619,[["a",repository],["E",review.id],["c","e".repeat(40)]],"Original review update",35),
  ];
  const kinds:Record<string,number[]>={PROJECTS:[30621],REPOSITORIES:[30617],DELETIONS:[5],WORK_ITEMS:[1618,1621],WORK_ITEM_ACTIVITY:[1,1619,1630,1631,1632,1633]};
  const query=vi.fn<ProjectsHost["query"]>(async request=>({
    pubkey:viewer,limit:20,bindingVersion:3,
    events:rows.filter(row=>kinds[request.view]?.includes(row.kind)&&(!request.coordinates||request.coordinates.includes(row.tags.find(tag=>tag[0]==="a")?.[1]??""))&&
      (request.since===undefined||row.created_at>=request.since)&&(request.until===undefined||row.created_at<=request.until)),
  }));
  const host:ProjectsHost={scopeKey:"tenant:human",query};
  return {issue,review,rows,host,query};
}
beforeEach(()=>{setLocale("en");localStorage.clear();
  vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});
  HTMLElement.prototype.scrollIntoView=vi.fn();
});
describe("original Inbox project read closure",()=>{
  async function homeSheetFixture(){
    vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener(){},removeEventListener(){}}));
    const f=fixture();const channelId="12345678-1234-4234-8234-123456789001";
    f.rows.find(row=>row.kind===30621)!.tags.push(["buzz-channel",channelId]);
    const initial=await loadProjectWorkItems(f.host,new AbortController().signal);
    const workspace={id:"home-workspace",createdAt:new Date(0),isMember:true,membershipState:WorkspaceMembershipState.Active,visibility:WorkspaceVisibility.Open,memberCount:1,
      channel:{channelId,name:"Home channel",channelType:ChannelType.Stream,archived:false}};
    const bff=createBffClient({send:async()=>({status:200,body:{items:[workspace]}})});
    const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
    const pulse:PulseHost={scopeKey:f.host.scopeKey,pubkey:viewer,query:async()=>[],publish:vi.fn(),copy:vi.fn(),startDm:vi.fn(),mediaUrl:url=>url,
      renderComposer:()=>null,renderContent:content=><p>{content}</p>};
    const renderWorkItems=vi.fn((children:React.ReactNode,pubkey:string)=>{expect(pubkey).toBe(viewer);return <PulseHostProvider host={pulse}>{children}</PulseHostProvider>;});
    const renderChannel=(_workspace:unknown,auxiliary?:IdleAuxiliaryProps)=><div data-testid="home-channel-consumer">
      <p>Original channel timeline</p>
      {auxiliary?.idleAuxiliaryPanel?<IdleAuxiliarySurface {...auxiliary} channelName="Home channel" isFocusDrawer={false} isSinglePanelView={false}
        useSplitAuxiliaryPane widthPx={400} canResetWidth={false} onResizeStart={vi.fn()} onResetWidth={vi.fn()} restoreFocusTarget={()=>null}/>:null}
    </div>;
    const ui=await render(<><div id="app-top-chrome-content"/><PlatformProvider client={bff} locale="en"><QueryClientProvider client={cache}><TooltipProvider>
      <ProjectChannelHome project={initial.projects[0]!} scopeKey={f.host.scopeKey} host={f.host} renderChannel={renderChannel}
        renderWorkItems={renderWorkItems} onOpenChannel={vi.fn()} onGoProjects={vi.fn()}/>
    </TooltipProvider></QueryClientProvider></PlatformProvider></>);
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="home-channel-consumer"]')).not.toBeNull());
    return {...f,ui,cache,renderWorkItems};
  }
  it.each(["tasks","reviews"] as const)("opens original project-home %s sheet, its real detail, back and close without global navigation",async kind=>{
    const f=await homeSheetFixture();
    await click(f.ui.querySelector<HTMLButtonElement>(`[data-testid="project-home-context-${kind}"]`)!);
    const rowId=kind==="tasks"?"project-issue-row":"project-pull-request-row";
    await vi.waitFor(()=>expect(f.ui.querySelector(`[data-testid="${rowId}"]`)).not.toBeNull());
    expect(f.ui.querySelector('[data-testid="project-home-summary-rail"]')?.getAttribute("aria-hidden")).toBe("true");
    const row=f.ui.querySelector(`[data-testid="${rowId}"]`)!;
    await click([...row.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent===`Original ${kind==="tasks"?"task":"review"}`)!);
    await vi.waitFor(()=>expect(f.ui.textContent).toContain(`Complete ${kind==="tasks"?"task":"review"} body`));
    await click(f.ui.querySelector<HTMLButtonElement>('[data-testid="idle-auxiliary-back"]')!);
    await vi.waitFor(()=>expect(f.ui.querySelector(`[data-testid="${rowId}"]`)).not.toBeNull());
    await click(f.ui.querySelector<HTMLButtonElement>('[data-testid="idle-auxiliary-panel"] [data-testid="auxiliary-panel-close"]')!);
    await vi.waitFor(()=>expect(f.ui.querySelector('[data-testid="project-home-workspace-sheet"]')).toBeNull());
    expect(f.ui.querySelector('[data-testid="project-home-context-tasks"]')).not.toBeNull();
    expect(f.ui.querySelector('[data-testid="project-home-context-commits"]')).toBeNull();
    expect(f.ui.querySelector('[data-testid="project-home-workspace-sheet-create"]')).toBeNull();
  });
  it.each(["tasks","reviews"] as const)("hides project-home %s content during fresh authorization and keeps denied content absent",async kind=>{
    const f=await homeSheetFixture();await click(f.ui.querySelector<HTMLButtonElement>(`[data-testid="project-home-context-${kind}"]`)!);
    const rowId=kind==="tasks"?"project-issue-row":"project-pull-request-row";
    await vi.waitFor(()=>expect(f.ui.querySelector(`[data-testid="${rowId}"]`)).not.toBeNull());
    let reject!:(error:Error)=>void;f.query.mockImplementation(()=>new Promise((_resolve,deny)=>{reject=deny;}));
    let pending!:Promise<void>;await act(async()=>{pending=f.cache.invalidateQueries({queryKey:["project-home-work-items"]});});
    await vi.waitFor(()=>expect(f.ui.querySelector(`[data-testid="${rowId}"]`)).toBeNull());
    const loading=f.ui.querySelector('[data-testid="buzz-loading-state"]');
    expect(loading?.closest('[data-testid="project-home-workspace-sheet"]')?.getAttribute("data-tab")).toBe(kind==="tasks"?"issues":"prs");
    expect(loading?.closest('[data-testid="project-home-workspace-sheet"]')?.classList.contains("-mx-4")).toBe(true);
    expect(loading?.parentElement?.hasAttribute("data-project-detail-panel")).toBe(true);
    expect(loading?.parentElement?.className).toBe("overflow-hidden rounded-xl border border-border/60 bg-transparent");
    expect(loading?.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(`Loading ${kind}`);
    expect(loading?.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 466 309");
    expect(loading?.querySelector(".buzz-logo--background, filter")).toBeNull();
    await act(async()=>{reject(new Error("revoked"));await pending;});
    await vi.waitFor(()=>expect(f.ui.textContent).toContain("Couldn't load this — the result is unknown."));
    expect(f.ui.textContent).not.toContain("Original task");
  });
  it("reads a repository shared by projects in the specifically selected project rather than the first global dedup owner",async()=>{
    const f=fixture();const second=event("f",30621,[["d","second"],["name","Second project"],["a",repository]],"",21);f.rows.push(second);
    const selected=await loadProjectWorkItems(f.host,new AbortController().signal,`30621:${author}:second`);
    expect(selected.projects).toHaveLength(1);expect(selected.items).toHaveLength(2);
    expect(selected.items.every(item=>item.project.dtag==="second")).toBe(true);
    await expect(loadProjectWorkItems(f.host,new AbortController().signal,`30621:${author}:missing`)).rejects.toThrow("Project scope changed");
  });
  it.each(["issue","review"] as const)("copies the original %s share menu and opens its exact authorized detail",async kind=>{
    const f=fixture();localStorage.setItem("buzz.projects.filter",kind==="issue"?"issues":"prs");localStorage.setItem("buzz.projects.viewMode","list");
    const copied=vi.fn(async(_value:string)=>{}),opened=vi.fn(),failed=vi.fn();
    const host:PulseHost={scopeKey:f.host.scopeKey,pubkey:viewer,query:async()=>[],publish:vi.fn(),copy:copied,startDm:vi.fn(),mediaUrl:url=>url,
      renderComposer:()=>{throw new Error("No project writer");},renderContent:content=><p>{content}</p>};
    const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
    let showSharedLink=(_href:string)=>{};
    function Page(){const[href,setHref]=useState<string>();const[target,setTarget]=useState<{id:string;target:ReturnType<typeof projectWorkItemTarget>}>();showSharedLink=setHref;
      if(href&&!target)return <EntityLinkAnchor href={href} runtime={{host:f.host,copyLink:copied,onError:failed,onOpen:async(id,target)=>{opened(id,target);setTarget({id,target});}}}/>;
      return <ProjectsView host={f.host} selectedProjectId={target?.id} workItemTarget={target?.target}
        onSelectedProjectChange={async(id,target)=>{if(id&&target)setTarget({id,target});}}/>;}
    const view=await render(<PlatformProvider client={createBffClient({send:async()=>({status:200,body:{}})})} locale="en"><QueryClientProvider client={cache}><TooltipProvider><PulseHostProvider host={host}><Page/></PulseHostProvider></TooltipProvider></QueryClientProvider></PlatformProvider>);
    const title=kind==="issue"?"Original task":"Original review";
    await vi.waitFor(()=>expect(view.querySelector(`button[aria-label="More options for ${title}"]`)).not.toBeNull());
    const menu=view.querySelector<HTMLButtonElement>(`button[aria-label="More options for ${title}"]`)!;
    await act(async()=>{menu.focus();menu.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));});
    const selector=`[data-testid="projects-${kind==="issue"?"issue":"pull-request"}-copy-link-${f[kind].id}"]`;
    await vi.waitFor(()=>expect(document.querySelector(selector)).not.toBeNull());
    await click(document.querySelector<HTMLElement>(selector)!);
    const href=`buzz://${kind==="issue"?"issue":"pr"}?id=${f[kind].id}&owner=${author}&d=repo`;
    expect(copied).toHaveBeenCalledExactlyOnceWith(href);
    expect(resolveExactLinkPaste(href,()=>undefined)).toEqual({href});
    await act(async()=>showSharedLink(href));
    await vi.waitFor(()=>expect(view.querySelector('[data-buzz-link-kind]')?.getAttribute("aria-label")).toContain(title));
    f.query.mockClear();
    await click(view.querySelector<HTMLElement>('[data-buzz-link-kind]')!);
    await vi.waitFor(()=>expect(view.querySelector(kind==="issue"?'[data-testid="project-issue-detail"]':'[data-testid="project-pull-request-detail"]')).not.toBeNull());
    expect(opened).toHaveBeenCalledExactlyOnceWith(`30621:${author}:project`,{repositoryId:`${author}:repo`,...(kind==="issue"?{issueId:f.issue.id}:{pullRequestId:f.review.id})});
    expect(f.query.mock.calls.some(([request])=>request.view==="WORK_ITEMS")).toBe(true);expect(failed).not.toHaveBeenCalled();expect(host.publish).not.toHaveBeenCalled();cache.clear();
    const detailCopy=view.querySelector<HTMLButtonElement>(`[data-testid="project-${kind==="issue"?"issue":"pull-request"}-copy-link"]`)!;
    expect(detailCopy.closest("h3")).not.toBeNull();
    expect(detailCopy.classList.contains("inline-flex")).toBe(true);
    expect(detailCopy.classList.contains("align-text-bottom")).toBe(true);
    expect(detailCopy.querySelector(".lucide-link-2")).not.toBeNull();
    copied.mockClear();
    vi.useFakeTimers();
    try {
      await click(detailCopy);
      expect(copied).toHaveBeenCalledExactlyOnceWith(href);
      expect(detailCopy.querySelector(".lucide-check")).not.toBeNull();
      await act(async()=>vi.advanceTimersByTime(2_000));
      expect(detailCopy.querySelector(".lucide-link-2")).not.toBeNull();
    } finally {vi.useRealTimers();}
  });
  it("keeps the original detail share control absent for an invalid coordinate and does not confirm a rejected copy",async()=>{
    const rejected=vi.fn(async()=>{throw new Error("clipboard denied");});
    const host:PulseHost={scopeKey:"tenant:human",pubkey:viewer,query:async()=>[],publish:vi.fn(),copy:rejected,startDm:vi.fn(),mediaUrl:url=>url,
      renderComposer:()=>null,renderContent:content=><p>{content}</p>};
    const error=vi.spyOn(toast,"error").mockImplementation(()=>"copy-failure");
    const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
    try {
      const view=await render(<PlatformProvider client={createBffClient({send:async()=>({status:200,body:{}})})} locale="zh-CN"><QueryClientProvider client={cache}><TooltipProvider><PulseHostProvider host={host}>
        <ShareLinkButton link={null} testId="unshareable"/>
        <ShareLinkButton link={`buzz://issue?id=${"1".repeat(64)}&owner=${author}&d=repo`} testId="refused-copy"/>
      </PulseHostProvider></TooltipProvider></QueryClientProvider></PlatformProvider>);
      expect(view.querySelector('[data-testid="unshareable"]')).toBeNull();
      const button=view.querySelector<HTMLButtonElement>('[data-testid="refused-copy"]')!;
      expect(button.getAttribute("aria-label")).toBe("复制链接");
      await click(button);
      expect(rejected).toHaveBeenCalledTimes(1);
      expect(error).not.toHaveBeenCalled();
      expect(button.querySelector(".lucide-check")).toBeNull();
      expect(button.querySelector(".lucide-link-2")).not.toBeNull();
    } finally {error.mockRestore();cache.clear();}
  });
  it("does not authorize from warm metadata, wrong kind, missing event or a different repository",async()=>{
    const f=fixture(),snapshot=await loadProjectWorkItems(f.host,new AbortController().signal);
    const item=snapshot.items.find(item=>item.type==="issue")!;
    const href=issueShareLink(item.issue)!;
    const parsed=parseEntityLink(href);expect(parsed.ok).toBe(true);if(!parsed.ok)throw new Error("fixture");
    const opened=vi.fn(async()=>{});
    for(const link of [{...parsed.value,dtag:"unrelated"},{...parsed.value,type:"pr",id:f.issue.id} as const,{...parsed.value,id:"f".repeat(64)}]){
      await expect(openProjectEntity(f.host,link,new AbortController().signal,opened)).rejects.toThrow("unavailable");
    }
    f.host.query=async()=>{throw new Error("revoked");};
    await expect(openProjectEntity(f.host,parsed.value,new AbortController().signal,opened)).rejects.toThrow("revoked");
    expect(opened).not.toHaveBeenCalled();
  });
  it("reports actual chip navigation refusal after metadata access is revoked without retrying",async()=>{
    const f=fixture(),opened=vi.fn(async()=>{}),failed=vi.fn();
    const href=`buzz://issue?id=${f.issue.id}&owner=${author}&d=repo`;
    const view=await render(<PlatformProvider client={createBffClient({send:async()=>({status:200,body:{}})})} locale="en">
      <EntityLinkAnchor href={href} runtime={{host:f.host,onOpen:opened,copyLink:vi.fn(),onError:failed}}/>
    </PlatformProvider>);
    await vi.waitFor(()=>expect(view.querySelector('[data-buzz-link-kind]')?.getAttribute("aria-label")).toContain("Original task"));
    const rejected=vi.fn(async()=>{throw new Error("Revoked current scope");});f.host.query=rejected;
    await click(view.querySelector<HTMLElement>('[data-buzz-link-kind]')!);
    await vi.waitFor(()=>expect(failed).toHaveBeenCalledTimes(1));
    expect(rejected).toHaveBeenCalledTimes(1);expect(opened).not.toHaveBeenCalled();
    expect(view.querySelector('[data-buzz-link-kind]')?.getAttribute("aria-label")).not.toContain("Original task");
  });
  it.each([["issues","issue","en"],["prs","review","en"],["issues","issue","zh-CN"],["prs","review","zh-CN"]] as const)("opens original %s list and exact detail, restoring the stored section in %s/%s",async(section,kind,locale)=>{
    setLocale(locale);localStorage.setItem("buzz.projects.viewMode","list");
    const f=fixture(),opened=vi.fn(),openProfile=vi.fn();
    const host:PulseHost={scopeKey:f.host.scopeKey,pubkey:viewer,query:async()=>[],publish:vi.fn(),copy:vi.fn(),startDm:vi.fn(),openProfile,
      mediaUrl:url=>url,renderComposer:()=>{throw new Error("No project write consumer");},renderContent:content=><p>{content}</p>};
    const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
    const bff=createBffClient({send:async()=>({status:200,body:{}})});
    let back=()=>{};
    function Page(){const [selection,setSelection]=useState<{id:string;target:ReturnType<typeof projectWorkItemTarget>}>();
      back=()=>setSelection(undefined);
      return <ProjectsView host={f.host} selectedProjectId={selection?.id} workItemTarget={selection?.target}
        onSelectedProjectChange={(id,target)=>{opened(id,target);if(id&&target)setSelection({id,target});}}/>;}
    const view=await render(<PlatformProvider client={bff} locale={locale}><QueryClientProvider client={cache}><TooltipProvider><PulseHostProvider host={host}><Page/></PulseHostProvider></TooltipProvider></QueryClientProvider></PlatformProvider>);
    await click(view.querySelector<HTMLElement>(`[data-testid="projects-section-${section}"]`)!);
    const rowSelector=`[data-testid="projects-${kind==="issue"?"issue":"pr"}-row-${f[kind].id}"]`;
    await vi.waitFor(()=>expect(view.querySelector(rowSelector)).not.toBeNull());
    expect(localStorage.getItem("buzz.projects.filter")).toBe(section);
    const row=view.querySelector(rowSelector)!;
    expect(row.tagName).toBe("DIV");expect(row.querySelector("button button")).toBeNull();
    const profileButton=row.querySelector<HTMLButtonElement>('[data-testid$="-author"]')!;
    await click(profileButton);expect(openProfile).toHaveBeenCalledExactlyOnceWith(author);expect(opened).not.toHaveBeenCalled();
    await click(row.querySelector<HTMLButtonElement>('button[title]')!);
    expect(opened).toHaveBeenCalledExactlyOnceWith("30621:"+author+":project",{repositoryId:author+":repo",...(kind==="issue"?{issueId:f.issue.id}:{pullRequestId:f.review.id})});
    const detailSelector=kind==="issue"?'[data-testid="project-issue-detail"]':'[data-testid="project-pull-request-detail"]';
    await vi.waitFor(()=>expect(view.querySelector(detailSelector)).not.toBeNull());
    await act(async()=>back());
    await vi.waitFor(()=>expect(view.querySelector(rowSelector)).not.toBeNull());
    expect(view.querySelector(`[data-testid="projects-section-${section}"]`)?.getAttribute("aria-pressed")).toBe("true");
    f.host.query=async()=>{throw new Error("Revoked work item access");};
    await act(async()=>{await cache.invalidateQueries({queryKey:["projects-work-items",f.host.scopeKey]});});
    await vi.waitFor(()=>expect(view.querySelector(rowSelector)).toBeNull());
    expect(view.textContent).not.toContain(f[kind].content);expect(host.publish).not.toHaveBeenCalled();cache.clear();
  });
  it("keeps an asynchronous rejected list navigation on the same read-only list without retrying",async()=>{
    const f=fixture(),opened=vi.fn(async()=>{throw new Error("Navigation refused");});
    localStorage.setItem("buzz.projects.filter","issues");
    const host:PulseHost={scopeKey:f.host.scopeKey,pubkey:viewer,query:async()=>[],publish:vi.fn(),copy:vi.fn(),startDm:vi.fn(),mediaUrl:url=>url,
      renderComposer:()=>{throw new Error("No writer");},renderContent:content=><p>{content}</p>};
    const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
    const view=await render(<PlatformProvider client={createBffClient({send:async()=>({status:200,body:{}})})} locale="en"><QueryClientProvider client={cache}><TooltipProvider><PulseHostProvider host={host}>
      <ProjectsView host={f.host} onSelectedProjectChange={opened}/>
    </PulseHostProvider></TooltipProvider></QueryClientProvider></PlatformProvider>);
    await vi.waitFor(()=>expect(view.querySelector('[data-projects-grid-card]')).not.toBeNull());
    await click(view.querySelector<HTMLButtonElement>('[data-projects-grid-card] > button')!);
    await vi.waitFor(()=>expect(view.querySelector('[role="alert"]')).not.toBeNull());
    expect(opened).toHaveBeenCalledTimes(1);expect(view.querySelector('[data-projects-grid-card]')).not.toBeNull();
    expect(view.querySelector('[data-testid="project-issue-detail"]')).toBeNull();expect(host.publish).not.toHaveBeenCalled();cache.clear();
  });
  it.each(["issue","review"] as const)("opens the exact original %s target through a fresh project read",async kind=>{
    const f=fixture(),data=await loadProjectWorkItems(f.host,new AbortController().signal);
    const workItem=resolveProjectInboxWorkItem(data.items,f[kind])!;
    const opened=vi.fn();
    const host:PulseHost={scopeKey:f.host.scopeKey,pubkey:viewer,query:async()=>[],publish:vi.fn(),copy:vi.fn(),startDm:vi.fn(),
      mediaUrl:url=>url,renderComposer:()=>{throw new Error("No project write consumer");},renderContent:content=><p>{content}</p>};
    const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
    const bff=createBffClient({send:async()=>({status:200,body:{}})});
    function Page(){const [target,setTarget]=useState<ReturnType<typeof projectWorkItemTarget>>();return target?
      <ProjectsView host={f.host} selectedProjectId={workItem.project.id} workItemTarget={target}/>:
      <ProjectInboxDetail workItem={workItem} onOpenProject={()=>{const next=projectWorkItemTarget(workItem);opened(workItem.project.id,next);setTarget(next);}}/>;}
    const view=await render(<PlatformProvider client={bff} locale="en"><QueryClientProvider client={cache}><TooltipProvider><PulseHostProvider host={host}><Page/></PulseHostProvider></TooltipProvider></QueryClientProvider></PlatformProvider>);
    f.query.mockClear();
    await click(view.querySelector<HTMLButtonElement>(`[aria-label="Open ${kind==="issue"?"task":"review"}"]`)!);
    expect(opened).toHaveBeenCalledExactlyOnceWith(workItem.project.id,{repositoryId:workItem.repository.id,...(kind==="issue"?{issueId:f.issue.id}:{pullRequestId:f.review.id})});
    const detailSelector=kind==="issue"?'[data-testid="project-issue-detail"]':'[data-testid="project-pull-request-detail"]';
    await vi.waitFor(()=>expect(view.querySelector(detailSelector)).not.toBeNull());
    expect(view.textContent).toContain(kind==="issue"?"Complete task body":"Complete review body");
    expect(view.querySelector('aside')).toBeNull();
    expect(f.query.mock.calls.some(([request])=>request.view==="PROJECTS")).toBe(true);
    expect(f.query.mock.calls.some(([request])=>request.view==="WORK_ITEM_ACTIVITY")).toBe(true);
    expect(host.publish).not.toHaveBeenCalled();
    f.host.query=async()=>{throw new Error("revoked");};
    await act(async()=>{await cache.invalidateQueries({queryKey:["project-work-item-target",f.host.scopeKey]});});
    await vi.waitFor(()=>expect(view.querySelector(detailSelector)).toBeNull());
    expect(view.textContent).not.toContain(kind==="issue"?"Complete task body":"Complete review body");
    cache.clear();
  });
  it.each(["project","repository","ambiguous"] as const)("does not resolve a %s-mismatched URL target to an unrelated announcement or work item",async mismatch=>{
    const f=fixture(),data=await loadProjectWorkItems(f.host,new AbortController().signal);
    const workItem=resolveProjectInboxWorkItem(data.items,f.issue)!;
    const host:PulseHost={scopeKey:f.host.scopeKey,pubkey:viewer,query:async()=>[],publish:vi.fn(),copy:vi.fn(),startDm:vi.fn(),
      mediaUrl:url=>url,renderComposer:()=>{throw new Error("No project write consumer");},renderContent:content=><p>{content}</p>};
    const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
    const bff=createBffClient({send:async()=>({status:200,body:{}})});
    const target={...projectWorkItemTarget(workItem),...(mismatch==="repository"?{repositoryId:"another-repository"}:{}),...(mismatch==="ambiguous"?{pullRequestId:f.review.id}:{})};
    const view=await render(<PlatformProvider client={bff} locale="en"><QueryClientProvider client={cache}><TooltipProvider><PulseHostProvider host={host}>
      <ProjectsView host={f.host} selectedProjectId={mismatch==="project"?"another-project":workItem.project.id} workItemTarget={target}/>
    </PulseHostProvider></TooltipProvider></QueryClientProvider></PlatformProvider>);
    await vi.waitFor(()=>expect(view.textContent).toContain("Repository unavailable"));
    expect(view.querySelector('[data-testid="project-issue-detail"]')).toBeNull();
    expect(view.querySelector('[data-testid="project-pull-request-detail"]')).toBeNull();expect(view.querySelector('aside')).toBeNull();
    expect(view.textContent).not.toContain("Complete task body");cache.clear();
  });
  it.each(["issue","review"] as const)("renders the original author-claimed origin through the actual %s detail consumer",async kind=>{
    const f=fixture(),channelId="12345678-1234-4234-8234-123456789012";
    f[kind].tags.push(["h",channelId]);
    const data=await loadProjectWorkItems(f.host,new AbortController().signal);
    const workItem=resolveProjectInboxWorkItem(data.items,f[kind])!;
    const open=vi.fn();
    const host:PulseHost={scopeKey:"tenant:human",pubkey:viewer,query:async()=>[],publish:vi.fn(),copy:vi.fn(),startDm:vi.fn(),
      mediaUrl:url=>url,renderComposer:()=>{throw new Error("No project write consumer");},renderContent:content=><p>{content}</p>,
      OriginReference:props=><ProjectOriginReferenceContent {...props} ready channel={{id:channelId,name:"Original origin",isMember:false,visibility:"open"}} onOpenChannel={open}/>};
    const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
    const bff=createBffClient({send:async()=>({status:200,body:{}})});
    const view=await render(<PlatformProvider client={bff} locale="en"><QueryClientProvider client={cache}><TooltipProvider><PulseHostProvider host={host}><ProjectInboxDetail workItem={workItem}/></PulseHostProvider></TooltipProvider></QueryClientProvider></PlatformProvider>);
    const link=view.querySelector<HTMLButtonElement>('[aria-label="Open author-claimed origin channel #Original origin"]');
    expect(link?.parentElement?.getAttribute("title")).toBe("Origin is claimed by the event author and is not relay-verified.");
    expect(link?.parentElement?.textContent).toBe("started from#Original origin(author-claimed)");
    await click(link!);expect(open).toHaveBeenCalledWith(channelId);
    expect(host.publish).not.toHaveBeenCalled();cache.clear();
  });
  it.each([true,false])("retains original private-channel membership rule: member=%s",async isMember=>{
    const open=vi.fn();const bff=createBffClient({send:async()=>({status:200,body:{}})});
    const view=await render(<PlatformProvider client={bff} locale="en"><ProjectOriginReferenceContent channelId="origin" ready
      channel={{id:"origin",name:"Private source",visibility:"private",isMember}} onOpenChannel={open}/></PlatformProvider>);
    expect(view.querySelector("button")!==null).toBe(isMember);
    if(!isMember){expect(view.textContent).toContain("a private channel");expect(view.textContent).not.toContain("Private source");}
  });
  it("does not mislabel a failed/pending lookup as private, and keeps the original private agent attribution",async()=>{
    const bff=createBffClient({send:async()=>({status:200,body:{}})});
    const view=await render(<PlatformProvider client={bff} locale="en"><ProjectOriginReferenceContent channelId="unresolved" ready={false} onOpenChannel={vi.fn()}/>
      <ProjectOriginReferenceContent agentName="Original agent" ready={false} onOpenChannel={vi.fn()}/></PlatformProvider>);
    expect(view.textContent).toBe("started privately withOriginal agent");
    expect(view.querySelector("button")).toBeNull();
    expect(view.querySelector("[title]")?.getAttribute("title")).toBe("The private conversation identifier is intentionally omitted.");
  });
  it("hydrates canonical Issue and PR bodies, updates and comment history from only bounded coordinate reads",async()=>{
    const f=fixture();const data=await loadProjectWorkItems(f.host,new AbortController().signal);
    expect(data.items).toHaveLength(2);
    const issue=resolveProjectInboxWorkItem(data.items,f.issue);expect(issue?.type).toBe("issue");
    if(issue?.type!=="issue")throw new Error("Missing task");
    expect(issue.issue.content).toBe("Complete task body");expect(issue.issue.comments).toHaveLength(4);
    const pr=resolveProjectInboxWorkItem(data.items,f.review);if(pr?.type!=="pull-request")throw new Error("Missing review");
    expect(pr.pullRequest.updates[0]?.content).toBe("Original review update");
    for(const [request]of f.query.mock.calls.filter(([request])=>request.view==="WORK_ITEMS"||request.view==="WORK_ITEM_ACTIVITY"))expect(request.coordinates).toEqual([repository]);
    const mentions=projectInboxMentions(data);
    expect(mentions).toHaveLength(6);expect(mentions.every(item=>item.channelId===null)).toBe(true);
    const rows=aggregateInbox({mentions,activity:[]},()=>null);
    expect(rows).toHaveLength(2);expect(rows.reduce((sum,row)=>sum+row.unreadCount,0)).toBe(6);
    expect(rows.every(row=>matchesInbox({categories:row.categories,groupItems:row.items,item:row.item},"project"))).toBe(true);
    expect(rows.every(row=>!matchesInbox({categories:row.categories,groupItems:row.items,item:row.item},"thread"))).toBe(true);
    expect(inboxReadContext(mentions[0]!)).toBe(`msg:${mentions[0]!.id}`);
    expect(inboxReadContexts(mentions,true).every(mark=>mark.key.startsWith("msg:"))).toBe(true);
  });
  it.each(["identity","generation","coordinate","activity"] as const)("refuses %s changes instead of rendering partial history",async(fault)=>{
    const f=fixture();const original=f.host.query;
    f.host.query=async request=>{
      const page=await original(request);
      if(request.view==="WORK_ITEM_ACTIVITY"){
        if(fault==="activity")throw new Error("Unavailable activity");
        if(fault==="identity")return {...page,pubkey:"c".repeat(64)};
        if(fault==="generation")return {...page,bindingVersion:4};
        return {...page,events:[{...f.issue,tags:[["a",`30617:${author}:other`]]}]};
      }
      return page;
    };
    await expect(loadProjectWorkItems(f.host,new AbortController().signal)).rejects.toThrow();
  });
  it("does not continue the old project identity after an awaited root read is aborted",async()=>{
    const f=fixture(),controller=new AbortController(),original=f.host.query;
    f.host.query=async request=>{const page=await original(request);if(request.view==="WORK_ITEMS")controller.abort();return page;};
    await expect(loadProjectWorkItems(f.host,controller.signal)).rejects.toThrow();
    expect(f.query.mock.calls.some(([request])=>request.view==="WORK_ITEM_ACTIVITY")).toBe(false);
  });
  it("uses the original full task body and expandable history without exposing ungoverned writers",async()=>{
    const f=fixture();const data=await loadProjectWorkItems(f.host,new AbortController().signal);
    const workItem=resolveProjectInboxWorkItem(data.items,f.issue)!;
    const host:PulseHost={scopeKey:"tenant:human",pubkey:viewer,query:async()=>[],publish:vi.fn(),copy:vi.fn(),startDm:vi.fn(),
      mediaUrl:url=>url,renderComposer:()=>{throw new Error("No project write consumer");},renderContent:(content)=><p>{content}</p>};
    const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
    const bff=createBffClient({send:async()=>({status:200,body:{}})});
    const view=await render(<PlatformProvider client={bff} locale="en"><QueryClientProvider client={cache}><TooltipProvider><PulseHostProvider host={host}><ProjectInboxDetail workItem={workItem}/></PulseHostProvider></TooltipProvider></QueryClientProvider></PlatformProvider>);
    expect(view.querySelector('[data-testid="project-issue-detail"]')).not.toBeNull();
    expect(view.textContent).toContain("Complete task body");
    expect(view.querySelectorAll('[data-testid="project-issue-comment-timeline-row"]')).toHaveLength(3);
    await click(view.querySelector<HTMLElement>('[data-testid="project-issue-earlier-comments"]')!);
    expect(view.querySelectorAll('[data-testid="project-issue-comment-timeline-row"]')).toHaveLength(4);
    await click(view.querySelector<HTMLElement>('[data-testid="project-issue-comment-history-toggle"]')!);
    expect(view.querySelectorAll('[data-testid="project-issue-comment-timeline-row"]')).toHaveLength(0);
    expect(view.querySelector('[data-testid="project-issue-comment-composer"]')).toBeNull();
    expect(host.publish).not.toHaveBeenCalled();
    cache.clear();
  });
  it.each(["en","zh-CN"] as const)("keeps the original PR commit attribution and exact timestamp formatting in %s",async locale=>{
    setLocale(locale);
    const f=fixture();const data=await loadProjectWorkItems(f.host,new AbortController().signal);
    const workItem=resolveProjectInboxWorkItem(data.items,f.review)!;
    const host:PulseHost={scopeKey:"tenant:human",pubkey:viewer,query:async()=>[],publish:vi.fn(),copy:vi.fn(),startDm:vi.fn(),
      mediaUrl:url=>url,renderComposer:()=>{throw new Error("No project write consumer");},renderContent:content=><p>{content}</p>};
    const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
    const bff=createBffClient({send:async()=>({status:200,body:{}})});
    const view=await render(<PlatformProvider client={bff} locale={locale}><QueryClientProvider client={cache}><TooltipProvider><PulseHostProvider host={host}><ProjectInboxDetail workItem={workItem}/></PulseHostProvider></TooltipProvider></QueryClientProvider></PlatformProvider>);
    const commits=[...view.querySelectorAll<HTMLButtonElement>('[data-testid="project-detail-section"] > button')].find(button=>button.textContent===(locale==="en"?"Commits":"提交"));
    expect(commits?.getAttribute("aria-expanded")).toBe("false");
    await click(commits!);
    const row=view.querySelector('[data-testid="project-pull-request-commit-row"]');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain(locale==="en"?"authored":"提交");
    if(locale==="zh-CN")expect(row?.textContent).not.toContain("authored");
    expect(row?.querySelector('[data-testid="project-pull-request-commit-row-date"]')?.getAttribute("title")).toBe(
      new Date(f.review.created_at*1_000).toLocaleString(locale,{year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit"}));
    expect(host.publish).not.toHaveBeenCalled();
    cache.clear();
  });
});
