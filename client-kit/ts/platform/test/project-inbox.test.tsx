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
import {render,click,type} from "./render";
import {publishProjectIssue,publishProjectIssueComment,buildProjectIssueCommentTags} from "../src/react/projects/issueMutations";
import {buildGitIssueTags} from "../src/react/projects/projectIssues.mjs";
import {BffError,TransportError} from "../src/transport";
import {EntityLinkAnchor,openProjectEntity,parseEntityLink} from "../src/react/projects";
import {issueShareLink} from "../src/react/projects/projectShareLinks";
import {ShareLinkButton} from "../src/react/projects/ShareLinkButton";
import {toast} from "sonner";
import {resolveExactLinkPaste} from "../src/react/composer/features/messages/lib/composerMessageLinkNode";
import {ProjectChannelHome} from "../src/react/projects/ProjectChannelHome";
import {IdleAuxiliarySurface,type IdleAuxiliaryProps} from "../src/react/messages/thread";
import {ChannelType,ErrorClass,WorkspaceMembershipState,WorkspaceVisibility} from "@client-kit/contracts";

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
  async function commentFixture(){
    const f=fixture();const snapshot=await loadProjectWorkItems(f.host,new AbortController().signal);
    const item=snapshot.items.find(item=>item.type==="issue")!;
    if(item.type!=="issue")throw new Error("Issue fixture missing");
    return {...f,item};
  }
  it("restores the original Inbox task ForumComposer and confirms a real comment before clearing intent or showing success",async()=>{
    const f=await commentFixture();const success=vi.spyOn(toast,"success").mockImplementation(()=>"test");
    const media={url:"/media/"+"a".repeat(64),sha256:"a".repeat(64),type:"image/png",size:12};
    let submit!:Parameters<PulseHost["renderComposer"]>[0]["onSubmit"];
    let complete!:(value:{eventId:string})=>void;
    f.host.publish=vi.fn<NonNullable<ProjectsHost["publish"]>>(async(request,_key,_observe,observation)=>{
      expect(localStorage.length).toBe(1);expect(localStorage.getItem(localStorage.key(0)!)).not.toContain("Original new comment");
      const created={...event("c",1,buildProjectIssueCommentTags(f.item.repository,f.item.issue,request.mentions??[],request.attachments??[]),request.body!,50),pubkey:viewer};
      observation?.onPrepared(created.id);f.rows.push(created);
      return new Promise(resolve=>{complete=resolve;});
    });
    const pulse:PulseHost={scopeKey:f.host.scopeKey,pubkey:viewer,query:async()=>[],publish:vi.fn(),copy:vi.fn(),startDm:vi.fn(),mediaUrl:url=>url,
      renderComposer:props=>{submit=props.onSubmit;return <div data-testid="actual-forum-host" className={props.className}>{props.placeholder}</div>;},renderContent:content=><p>{content}</p>};
    const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
    const ui=await render(<PlatformProvider client={createBffClient({send:vi.fn()})} locale="en"><QueryClientProvider client={cache}><TooltipProvider><PulseHostProvider host={pulse}>
      <ProjectInboxDetail host={f.host} workItem={f.item}/>
    </PulseHostProvider></TooltipProvider></QueryClientProvider></PlatformProvider>);
    expect(ui.querySelector('[data-testid="project-issue-comment-composer"]')?.className).toBe("px-6 pb-6 pt-4");
    expect(ui.querySelector('[data-testid="actual-forum-host"]')?.className).toBe("border border-border/60 bg-background/45");
    let pending!:Promise<unknown>;
    await act(async()=>{pending=Promise.resolve(submit("Original new comment",[viewer],[media]));});
    await vi.waitFor(()=>expect(f.host.publish).toHaveBeenCalledTimes(1));
    await expect(submit("Original new comment",[viewer],[media])).rejects.toThrow();
    expect(success).not.toHaveBeenCalled();expect(localStorage.length).toBe(1);
    await act(async()=>{complete({eventId:"c".repeat(64)});await pending;});
    expect(f.host.publish).toHaveBeenCalledTimes(1);expect(localStorage.length).toBe(0);
    expect(ui.textContent).toContain("Original new comment");expect(success).toHaveBeenCalledWith("Comment posted.");
    success.mockRestore();
  });
  it("retains comment UNKNOWN across restart, rejects edited retry, and verifies the exact Relay comment before completion",async()=>{
    const f=await commentFixture();
    const publish=vi.fn<NonNullable<ProjectsHost["publish"]>>(async(_request,_key,_observe,observation)=>{observation?.onPrepared("c".repeat(64));throw new TransportError("lost ACK");});f.host.publish=publish;
    const send=(body="Secret comment")=>publishProjectIssueComment(f.host,f.item.project.id,f.item.repository,f.item.issue,body,[viewer],[],new AbortController().signal);
    await expect(send()).rejects.toThrow();expect(localStorage.length).toBe(1);
    expect(localStorage.getItem(localStorage.key(0)!)).not.toContain("Secret comment");
    await expect(send("Edited comment")).rejects.toThrow("outcome unknown");expect(publish).toHaveBeenCalledTimes(1);
    publish.mockResolvedValue({eventId:"c".repeat(64)});
    await expect(send()).rejects.toThrow("outcome unknown");expect(localStorage.length).toBe(1);
    f.rows.push({...event("c",1,buildProjectIssueCommentTags(f.item.repository,f.item.issue,[viewer],[]),"Secret comment",50),pubkey:viewer});
    const result=await send();expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[1]?.[1]).toBe(publish.mock.calls[0]?.[1]);expect(publish.mock.calls[1]?.[2]).toBe(true);
    result.complete();expect(localStorage.length).toBe(0);
  });
  it("does not dispatch a comment for revoked reads or corrupt recovery, and never cleans an accepted intent after scope loss",async()=>{
    const f=await commentFixture();const denied=vi.fn();f.host.publish=vi.fn();
    const slot=JSON.stringify(["project-issue-comment-publication",f.host.scopeKey,f.item.project.id,f.item.repository.repoAddress,f.item.issue.id]);
    const send=(signal=new AbortController().signal)=>publishProjectIssueComment(f.host,f.item.project.id,f.item.repository,f.item.issue,"Comment",[],[],signal,denied);
    localStorage.setItem(slot,"broken");await expect(send()).rejects.toThrow("outcome unknown");expect(f.host.publish).not.toHaveBeenCalled();
    localStorage.removeItem(slot);f.query.mockRejectedValueOnce(new BffError(403,"revoked",{class:ErrorClass.Denied}));
    await expect(send()).rejects.toThrow();expect(denied).toHaveBeenCalledOnce();expect(f.host.publish).not.toHaveBeenCalled();
    const controller=new AbortController();f.host.publish=vi.fn(async()=>{controller.abort();return {eventId:"c".repeat(64)};});
    await expect(send(controller.signal)).rejects.toThrow();expect(localStorage.length).toBe(1);
  });
  async function homeSheetFixture(writer?: (f:ReturnType<typeof fixture>)=>void){
    vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener(){},removeEventListener(){}}));
    const f=fixture();const channelId="12345678-1234-4234-8234-123456789001";
    writer?.(f);
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
  const attachWriter=(f:ReturnType<typeof fixture>)=>{
    f.host.publish=vi.fn(async(request,_key,_observe,observation)=>{
      const created={...event("c",1621,buildGitIssueTags({repoAddress:repository,repoOwner:author,title:request.title!,labels:[request.category!]}),request.body!),pubkey:viewer};
      observation?.onPrepared(created.id);f.rows.push(created);return {eventId:created.id};
    });
  };
  it("creates a task through the original home dialog, reads the exact publication and opens its shared detail",async()=>{
    const success=vi.spyOn(toast,"success").mockImplementation(()=>"test");
    const f=await homeSheetFixture(attachWriter);
    await click(f.ui.querySelector<HTMLButtonElement>('[data-testid="project-home-context-tasks"]')!);
    await vi.waitFor(()=>expect(f.ui.querySelector('[data-testid="project-home-workspace-sheet-create"]')).not.toBeNull());
    await click(f.ui.querySelector<HTMLButtonElement>('[data-testid="project-home-workspace-sheet-create"]')!);
    await vi.waitFor(()=>expect(document.querySelector('[data-testid="create-issue-dialog"]')).not.toBeNull());
    await type(document.querySelector<HTMLInputElement>('[data-testid="create-issue-title"]')!,"  New real task  ");
    await type(document.querySelector<HTMLTextAreaElement>('[data-testid="create-issue-body"]')!,"  Full task description  ");
    const category=document.querySelector<HTMLSelectElement>('[data-testid="create-issue-category"]')!;
    await act(async()=>{category.value="improvement";category.dispatchEvent(new Event("change",{bubbles:true}));});
    const submit=document.querySelector<HTMLButtonElement>('[data-testid="create-issue-submit"]')!;
    await act(async()=>{submit.click();submit.click();});
    await vi.waitFor(()=>expect(f.ui.textContent).toContain("Full task description"));
    expect(f.host.publish).toHaveBeenCalledTimes(1);
    expect(vi.mocked(f.host.publish!).mock.calls[0]?.[0]).toEqual({operation:"CREATE_ISSUE",targetEventId:"8".repeat(64),title:"New real task",body:"Full task description",category:"improvement"});
    expect(success).toHaveBeenCalledWith("Task created.");
    expect(document.querySelector('[data-testid="create-issue-dialog"]')).toBeNull();
    expect(localStorage.length).toBe(0);success.mockRestore();
  });
  it.each(["bff-unknown","transport-unknown","admission-refused","recovered-unknown"] as const)("preserves original task dialog outcome classification for %s",async mode=>{
    const success=vi.spyOn(toast,"success").mockImplementation(()=>"test");
    try {
      const f=await homeSheetFixture(f=>{f.host.publish=vi.fn(async()=>{
        if(mode==="transport-unknown")throw new TransportError("lost response");
        throw new BffError(503,"publication response",{class:mode==="admission-refused"?ErrorClass.Denied:ErrorClass.Unknown});
      });});
      await click(f.ui.querySelector<HTMLButtonElement>('[data-testid="project-home-context-tasks"]')!);
      await vi.waitFor(()=>expect(f.ui.querySelector('[data-testid="project-home-workspace-sheet-create"]')).not.toBeNull());
      await click(f.ui.querySelector<HTMLButtonElement>('[data-testid="project-home-workspace-sheet-create"]')!);
      await vi.waitFor(()=>expect(document.querySelector('[data-testid="create-issue-dialog"]')).not.toBeNull());
      await type(document.querySelector<HTMLInputElement>('[data-testid="create-issue-title"]')!,"Pending task");
      const submit=document.querySelector<HTMLButtonElement>('[data-testid="create-issue-submit"]')!;
      await click(submit);
      const unknown="Task creation outcome unknown. Retry checks the same publication.";
      await vi.waitFor(()=>expect(document.querySelector('[data-testid="create-issue-dialog"]')?.textContent).toContain(mode==="admission-refused"?"Failed to create task.":unknown));
      expect(success).not.toHaveBeenCalled();
      expect(localStorage.length).toBe(mode==="admission-refused"?0:1);
      expect(document.querySelector('[data-testid="create-issue-dialog"]')).not.toBeNull();
      expect(f.host.publish).toHaveBeenCalledTimes(1);
      if(mode==="recovered-unknown"){
        const originalKey=vi.mocked(f.host.publish!).mock.calls[0]?.[1];
        vi.mocked(f.host.publish!).mockRejectedValue(new BffError(403,"recovery refused",{class:ErrorClass.Denied}));
        await click(submit);
        await vi.waitFor(()=>expect(f.host.publish).toHaveBeenCalledTimes(2));
        await vi.waitFor(()=>expect(document.querySelector('[data-testid="create-issue-dialog"]')?.textContent).toContain(unknown));
        expect(vi.mocked(f.host.publish!).mock.calls[1]?.[1]).toBe(originalKey);
        expect(vi.mocked(f.host.publish!).mock.calls[1]?.[2]).toBe(true);
        expect(localStorage.length).toBe(1);expect(success).not.toHaveBeenCalled();
      }
    } finally {success.mockRestore();}
  });
  it("holds UNKNOWN task intent across retry, rejects changed input, and observes rather than signs another event",async()=>{
    const f=fixture();const snapshot=await loadProjectWorkItems(f.host,new AbortController().signal);
    const p=snapshot.projects[0]!,repo=p.repositories[0]!,input={title:"Pending task",body:"Secret body",category:"issue" as const};
    const publish=vi.fn<NonNullable<ProjectsHost["publish"]>>(async(_request,_key,_observe,observation)=>{observation?.onPrepared("c".repeat(64));throw new TransportError("lost ACK");});f.host.publish=publish;
    await expect(publishProjectIssue(f.host,p.id,repo,input,new AbortController().signal)).rejects.toThrow();
    expect(localStorage.getItem(localStorage.key(0)!)).not.toContain("Secret body");
    await expect(publishProjectIssue(f.host,p.id,repo,{...input,title:"Different task"},new AbortController().signal)).rejects.toThrow("outcome unknown");
    expect(publish).toHaveBeenCalledTimes(1);
    f.rows.push({...event("c",1621,buildGitIssueTags({repoAddress:repository,repoOwner:author,title:input.title,labels:["issue"]}),input.body),pubkey:viewer});
    publish.mockResolvedValue({eventId:"c".repeat(64)});
    const result=await publishProjectIssue(f.host,p.id,repo,input,new AbortController().signal);
    expect(publish.mock.calls[1]?.[1]).toBe(publish.mock.calls[0]?.[1]);expect(publish.mock.calls[1]?.[2]).toBe(true);
    expect(publish.mock.calls[1]?.[3]?.eventId).toBe("c".repeat(64));result.complete();expect(localStorage.length).toBe(0);
  });
  it.each(["absent","wrong-author","wrong-body"])("does not complete task creation with %s readback",async mode=>{
    const f=fixture();const snapshot=await loadProjectWorkItems(f.host,new AbortController().signal);const p=snapshot.projects[0]!,repo=p.repositories[0]!;
    attachWriter(f);const original=f.host.publish!;f.host.publish=vi.fn<NonNullable<ProjectsHost["publish"]>>(async(...args)=>{const result=await original(...args);const created=f.rows.at(-1)!;
      if(mode==="absent")f.rows.pop();else if(mode==="wrong-author")created.pubkey=author;else created.content="different";return result;});
    await expect(publishProjectIssue(f.host,p.id,repo,{title:"new",body:"body"},new AbortController().signal)).rejects.toThrow("outcome unknown");
    expect(localStorage.length).toBe(1);
  });
  it("denies changed repository before publishing and keeps late scope results from opening a task",async()=>{
    const f=fixture();const snapshot=await loadProjectWorkItems(f.host,new AbortController().signal);const p=snapshot.projects[0]!,repo=p.repositories[0]!;
    attachWriter(f);const originalRepo=f.rows.shift()!;
    await expect(publishProjectIssue(f.host,p.id,repo,{title:"new",body:"body"},new AbortController().signal)).rejects.toThrow("repository changed");
    expect(f.host.publish).not.toHaveBeenCalled();f.rows.unshift(originalRepo);
    const controller=new AbortController(),original=f.host.publish!;
    f.host.publish=vi.fn<NonNullable<ProjectsHost["publish"]>>(async(...args)=>{const receipt=await original(...args);controller.abort();return receipt;});
    await expect(publishProjectIssue(f.host,p.id,repo,{title:"new",body:"body"},controller.signal)).rejects.toThrow();
    expect(localStorage.length).toBe(1);
  });
  it("refuses corrupt or inaccessible task intent storage without dispatching a new event",async()=>{
    const f=fixture();const snapshot=await loadProjectWorkItems(f.host,new AbortController().signal);const p=snapshot.projects[0]!,repo=p.repositories[0]!;attachWriter(f);
    const slot=JSON.stringify(["project-issue-publication",f.host.scopeKey,p.id,repo.repoAddress]);
    localStorage.setItem(slot,"broken JSON");
    await expect(publishProjectIssue(f.host,p.id,repo,{title:"new",body:"body"},new AbortController().signal)).rejects.toThrow("outcome unknown");
    localStorage.removeItem(slot);const read=vi.spyOn(Storage.prototype,"getItem").mockImplementationOnce(()=>{throw new Error("storage refused");});
    await expect(publishProjectIssue(f.host,p.id,repo,{title:"new",body:"body"},new AbortController().signal)).rejects.toThrow("outcome unknown");
    read.mockRestore();expect(f.host.publish).not.toHaveBeenCalled();
  });
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
  it.each([false,true])("keeps the original PR commit-copy feedback when the host rejects=%s",async rejected=>{
    setLocale("en");
    const f=fixture();const snapshot=await loadProjectWorkItems(f.host,new AbortController().signal);
    const workItem=snapshot.items.find(item=>item.type==="pull-request")!;
    const copied=vi.fn(async(_text:string)=>{if(rejected)throw new Error("clipboard denied");});
    const opened=vi.fn();
    const host:PulseHost={scopeKey:f.host.scopeKey,pubkey:viewer,query:async()=>[],publish:vi.fn(),copy:copied,startDm:vi.fn(),mediaUrl:url=>url,
      renderComposer:()=>null,renderContent:content=><p>{content}</p>};
    const error=vi.spyOn(toast,"error").mockImplementation(()=>"copy-error");
    const success=vi.spyOn(toast,"success").mockImplementation(()=>"copy-success");
    const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
    try{
      const view=await render(<PlatformProvider client={createBffClient({send:vi.fn()})} locale="en"><QueryClientProvider client={cache}><TooltipProvider><PulseHostProvider host={host}>
        <div onClick={opened}><ProjectInboxDetail host={f.host} workItem={workItem}/></div>
      </PulseHostProvider></TooltipProvider></QueryClientProvider></PlatformProvider>);
      const commits=[...view.querySelectorAll<HTMLButtonElement>('[data-testid="project-detail-section"] > button')].find(button=>button.textContent==="Commits");
      expect(commits?.getAttribute("aria-expanded")).toBe("false");
      await click(commits!);
      const row=view.querySelector('[data-testid="project-pull-request-commit-row"]')!;
      const button=row.querySelector<HTMLButtonElement>('button[aria-label="Copy commit hash"]')!;
      expect(button).not.toBeNull();expect(button.querySelector(".lucide-copy")).not.toBeNull();
      opened.mockClear();
      vi.useFakeTimers();
      await click(button);
      expect(copied).toHaveBeenCalledExactlyOnceWith("e".repeat(40));
      expect(opened).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();expect(success).not.toHaveBeenCalled();
      expect(button.querySelector(".lucide-check")!==null).toBe(!rejected);
      expect(button.querySelector(".lucide-copy")!==null).toBe(rejected);
      await act(async()=>vi.advanceTimersByTime(2_000));
      expect(button.querySelector(".lucide-copy")).not.toBeNull();
      expect(button.querySelector(".lucide-check")).toBeNull();
    }finally{vi.useRealTimers();error.mockRestore();success.mockRestore();cache.clear();}
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
  it.each([["issues","issue","en"],["prs","review","en"],["issues","issue","zh-CN"],["prs","review","zh-CN"]] as const)("restores original recent activity sorting for %s/%s in %s without fabricating directory activity",async(section,kind,locale)=>{
    setLocale(locale);localStorage.setItem("buzz.projects.viewMode","list");localStorage.setItem("buzz.projects.filter",section);
    const f=fixture(),opened=vi.fn();
    const newer=event("d",kind==="issue"?1621:1618,[["a",repository],["subject","A newer work item"]],"No activity yet",25);
    f.rows.push(newer);
    const pulse:PulseHost={scopeKey:f.host.scopeKey,pubkey:viewer,query:async()=>[],publish:vi.fn(),copy:vi.fn(),startDm:vi.fn(),mediaUrl:url=>url,
      renderComposer:()=>null,renderContent:content=><p>{content}</p>};
    const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
    const ui=await render(<PlatformProvider client={createBffClient({send:async()=>({status:200,body:{}})})} locale={locale}><QueryClientProvider client={cache}><TooltipProvider><PulseHostProvider host={pulse}>
      <ProjectsView host={f.host} onSelectedProjectChange={opened}/>
    </PulseHostProvider></TooltipProvider></QueryClientProvider></PlatformProvider>);
    const prefix=`projects-${kind==="issue"?"issue":"pr"}-row-`;
    const order=()=>Array.from(ui.querySelectorAll(`[data-testid^="${prefix}"]`)).map(row=>row.getAttribute("data-testid"));
    const originalId=prefix+f[kind].id,newerId=prefix+newer.id;
    await vi.waitFor(()=>expect(order()).toEqual([originalId,newerId]));
    await click(ui.querySelector<HTMLButtonElement>('[data-testid="projects-activity-search"]')!);
    await vi.waitFor(()=>expect(ui.querySelector('option[value="updated"]')).not.toBeNull());
    const select=ui.querySelector<HTMLSelectElement>("select")!;
    expect(select.value).toBe("updated");
    expect(select.querySelector('option[value="updated"]')?.textContent).toBe(locale==="en"?"Recent activity":"最近活动");
    const queryCount=f.query.mock.calls.length;
    const sort=async(value:string)=>act(async()=>{select.value=value;select.dispatchEvent(new Event("change",{bubbles:true}));});
    await sort("created");expect(order()).toEqual([newerId,originalId]);
    await sort("name");expect(order()).toEqual([newerId,originalId]);
    await sort("updated");expect(order()).toEqual([originalId,newerId]);expect(f.query).toHaveBeenCalledTimes(queryCount);
    f.rows.push(event("f",1631,[["a",repository],["e",newer.id]],"",45));
    await act(async()=>{await cache.invalidateQueries({queryKey:["projects-work-items",f.host.scopeKey]});});
    await vi.waitFor(()=>expect(order()).toEqual([newerId,originalId]));
    const first=ui.querySelector(`[data-testid="${newerId}"]`)!;
    await click(first.querySelector<HTMLButtonElement>("button[title]")!);
    expect(opened).toHaveBeenCalledExactlyOnceWith("30621:"+author+":project",{repositoryId:author+":repo",...(kind==="issue"?{issueId:newer.id}:{pullRequestId:newer.id})});
    f.host.query=async()=>{throw new Error("Revoked work item access");};
    await act(async()=>{await cache.invalidateQueries({queryKey:["projects-work-items",f.host.scopeKey]});});
    await vi.waitFor(()=>expect(order()).toEqual([]));
    await click(ui.querySelector<HTMLButtonElement>('[data-testid="projects-section-search-close"]')!);
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="projects-section-projects"]')).not.toBeNull());
    await click(ui.querySelector<HTMLButtonElement>('[data-testid="projects-section-projects"]')!);
    await click(ui.querySelector<HTMLButtonElement>('[data-testid="projects-activity-search"]')!);
    await vi.waitFor(()=>expect(ui.querySelector("select")).not.toBeNull());
    expect(ui.querySelector<HTMLSelectElement>("select")?.value).toBe("created");expect(ui.querySelector('option[value="updated"]')).toBeNull();
    expect(pulse.publish).not.toHaveBeenCalled();cache.clear();
  });
  it.each(["available","blocked"] as const)("restores original sort persistence across sections and remount with storage %s",async storage=>{
    setLocale("en");localStorage.setItem("buzz.projects.viewMode","list");localStorage.setItem("buzz.projects.filter","issues");
    localStorage.setItem("buzz.projects.sort","name");
    const originalGet=Storage.prototype.getItem,originalSet=Storage.prototype.setItem;
    const get=vi.spyOn(Storage.prototype,"getItem").mockImplementation(function(this:Storage,key){
      if(storage==="blocked"&&key==="buzz.projects.sort")throw new Error("Storage denied");
      return originalGet.call(this,key);
    });
    const set=vi.spyOn(Storage.prototype,"setItem").mockImplementation(function(this:Storage,key,value){
      if(storage==="blocked"&&key==="buzz.projects.sort")throw new Error("Storage denied");
      originalSet.call(this,key,value);
    });
    try{
      const f=fixture();f.rows.push(event("d",1621,[["a",repository],["subject","A newer task"]],"No activity yet",25));
      const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
      const pulse:PulseHost={scopeKey:f.host.scopeKey,pubkey:viewer,query:async()=>[],publish:vi.fn(),copy:vi.fn(),startDm:vi.fn(),mediaUrl:url=>url,renderComposer:()=>null,renderContent:content=><p>{content}</p>};
      let reload=()=>{};
      function Page(){const [generation,setGeneration]=useState(0);reload=()=>setGeneration(value=>value+1);return <ProjectsView key={generation} host={f.host} onSelectedProjectChange={vi.fn()}/>;}
      const ui=await render(<PlatformProvider client={createBffClient({send:async()=>({status:200,body:{}})})} locale="en"><QueryClientProvider client={cache}><TooltipProvider><PulseHostProvider host={pulse}><Page/></PulseHostProvider></TooltipProvider></QueryClientProvider></PlatformProvider>);
      const first=()=>ui.querySelector('[data-testid^="projects-issue-row-"]')?.getAttribute("data-testid");
      const id=(value:string)=>"projects-issue-row-"+value.repeat(64);
      await vi.waitFor(()=>expect(first()).toBe(id(storage==="available"?"d":"1")));
      const openSearch=async()=>{await click(ui.querySelector<HTMLButtonElement>('[data-testid="projects-activity-search"]')!);await vi.waitFor(()=>expect(ui.querySelector("select")).not.toBeNull());};
      const closeSearch=async()=>{await click(ui.querySelector<HTMLButtonElement>('[data-testid="projects-section-search-close"]')!);await vi.waitFor(()=>expect(ui.querySelector('[data-testid="projects-section-projects"]')).not.toBeNull());};
      const choose=async(value:string)=>act(async()=>{const select=ui.querySelector<HTMLSelectElement>("select")!;select.value=value;select.dispatchEvent(new Event("change",{bubbles:true}));});
      await openSearch();expect(ui.querySelector<HTMLSelectElement>("select")?.value).toBe(storage==="available"?"name":"updated");
      await choose("created");expect(first()).toBe(id("d"));
      expect(originalGet.call(localStorage,"buzz.projects.sort")).toBe(storage==="available"?"created":"name");
      await act(async()=>reload());await vi.waitFor(()=>expect(first()).toBe(id(storage==="available"?"d":"1")));
      await openSearch();await choose("name");expect(first()).toBe(id("d"));
      await act(async()=>reload());await vi.waitFor(()=>expect(first()).toBe(id(storage==="available"?"d":"1")));
      await openSearch();expect(ui.querySelector<HTMLSelectElement>("select")?.value).toBe(storage==="available"?"name":"updated");
      await choose("updated");expect(first()).toBe(id("1"));
      await closeSearch();await click(ui.querySelector<HTMLButtonElement>('[data-testid="projects-section-projects"]')!);
      await openSearch();expect(ui.querySelector<HTMLSelectElement>("select")?.value).toBe("created");expect(ui.querySelector('option[value="updated"]')).toBeNull();
      expect(originalGet.call(localStorage,"buzz.projects.sort")).toBe(storage==="available"?"updated":"name");
      await act(async()=>reload());await openSearch();expect(ui.querySelector<HTMLSelectElement>("select")?.value).toBe("created");
      await closeSearch();await click(ui.querySelector<HTMLButtonElement>('[data-testid="projects-section-issues"]')!);
      await vi.waitFor(()=>expect(first()).toBe(id("1")));await openSearch();expect(ui.querySelector<HTMLSelectElement>("select")?.value).toBe("updated");
      if(storage==="available"){
        originalSet.call(localStorage,"buzz.projects.sort","unsupported");
        await act(async()=>reload());await vi.waitFor(()=>expect(first()).toBe(id("1")));
        await openSearch();expect(ui.querySelector<HTMLSelectElement>("select")?.value).toBe("updated");
      }
      expect(pulse.publish).not.toHaveBeenCalled();cache.clear();
    }finally{get.mockRestore();set.mockRestore();}
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
