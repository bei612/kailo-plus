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
beforeEach(()=>{setLocale("en");localStorage.clear();});
describe("original Inbox project read closure",()=>{
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
