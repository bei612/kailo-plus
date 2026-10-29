// DD-118 batch 2a: the restored Buzz 779af8886caae1317b4de962082429867ab61503 repository state
// (hooks.ts::eventToRepoState over REPOSITORY_STATES), branch create/delete (branchMutations.ts,
// ProjectBranchDialogs.tsx) and Create review (CreatePullRequestDialog.tsx,
// pullRequestMutations.ts::publishProjectPullRequest) through the Projects host seams.
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {act,useState} from "react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {toast} from "sonner";
import {ErrorClass,ProjectGitRefOperation,ProjectsGitQueryRequestView,ReasonCode,
  type ProjectsGitQueryRequest,type ProjectsGitQueryResponse,type ProjectsGitRefRequest,type ProjectsGitRefResponse} from "@client-kit/contracts";
import {createBffClient} from "../src/client";
import {setLocale} from "../src/i18n";
import {PlatformProvider} from "../src/react/context";
import {PulseHostProvider,type PulseHost,type PulseEvent} from "../src/react/pulse/host";
import {TooltipProvider} from "../src/react/sidebar/tooltip";
import {ProjectsView,createProjectsGitHost,createNativeProjectsGitHost,type ProjectsHost} from "../src/react/projects";
import {publishProjectPullRequestUpdate,readProjectPullRequestUpdateIntent,buildProjectPullRequestUpdate} from "../src/react/projects/pullRequestUpdates";
import {loadProjectWorkItems} from "../src/react/projects/projectWorkItems";
import {loadProjectDirectory} from "../src/react/projects/projectEnumeration";
import type {ProjectWorkItemTarget} from "../src/react/projects/projectWorkItems";
import {eventToRepoState,fetchRepoState} from "../src/react/projects/projectRepoState";
import {changeProjectRemoteBranch,readProjectGitRefIntent,useProjectBranchActions} from "../src/react/projects/branchMutations";
import {projectBranchErrorMessage} from "../src/react/projects/lib/projectBranchErrors";
import {publishProjectPullRequest} from "../src/react/projects/pullRequestMutations";
import {BffError,TransportError} from "../src/transport";
import {render,click,type} from "./render";

const viewer="a".repeat(64),owner="b".repeat(64),repository=`30617:${owner}:repo`;
const mainHead="1".repeat(40),featureHead="2".repeat(40),olderHead="3".repeat(40);
const KEY=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const event=(id:string,kind:number,tags:string[][],content="",time=20,pubkey=owner):PulseEvent=>({id:id.repeat(64),kind,pubkey,tags,content,created_at:time});
const snapshot:ProjectsGitQueryResponse={view:ProjectsGitQueryRequestView.Snapshot,snapshot:{
  latestCommit:{hash:mainHead,shortHash:"1111111",authorName:"Ada",authorEmail:"ada@example.test",timestamp:1_700_000_000,subject:"Initial import"},
  commits:[],contributors:[],files:[{path:"README.md",kind:"file",size:4,previewContent:"# Hi",lastChangedAt:null}]}};

function fixture({refs=true,publish=true,native=false}:{refs?:boolean;publish?:boolean;native?:boolean}={}){
  const announcement=event("8",30617,[["d","repo"],["name","Original repo"],["clone","https://example.test/repo.git"]]);
  const rows=[announcement,event("9",30621,[["d","project"],["name","Original project"],["a",repository]]),
    // An older state must lose to the newest replaceable one.
    event("6",30618,[["d","repo"],["refs/heads/main",olderHead]],"",10),
    event("7",30618,[["d","repo"],["refs/heads/main",mainHead],["refs/heads/feature",featureHead],["refs/tags/v1",mainHead],["HEAD","ref: refs/heads/main"]],"",30)];
  const kinds:Record<string,number[]>={PROJECTS:[30621],REPOSITORIES:[30617],DELETIONS:[5],WORK_ITEMS:[1618,1621],WORK_ITEM_ACTIVITY:[1,1619,1630,1631,1632,1633],REPOSITORY_STATES:[30618]};
  const coordinate=(row:PulseEvent)=>row.kind===30618?`30617:${row.pubkey}:${row.tags.find(tag=>tag[0]==="d")?.[1]}`:row.tags.find(tag=>tag[0]==="a")?.[1]??"";
  const query=vi.fn<ProjectsHost["query"]>(async request=>({pubkey:viewer,limit:20,bindingVersion:3,
    events:rows.filter(row=>kinds[request.view]?.includes(row.kind)&&(!request.coordinates||request.coordinates.includes(coordinate(row)))
      &&(request.since===undefined||row.created_at>=request.since)&&(request.until===undefined||row.created_at<=request.until))}));
  const gitQuery=vi.fn(async(_request:ProjectsGitQueryRequest):Promise<ProjectsGitQueryResponse>=>snapshot);
  const ref=vi.fn(async(request:ProjectsGitRefRequest,_key:string):Promise<ProjectsGitRefResponse>=>({branch:request.branch,commit:request.expectedCommit}));
  const host:ProjectsHost={scopeKey:"tenant:human",query,git:createProjectsGitHost(gitQuery,refs?ref:undefined)};
  if(native){
    // Keep the original read fixture; branch writes now traverse the real
    // Desktop host decoder with only its native command boundary supplied.
    const nativeGit=createNativeProjectsGitHost(async(command,args)=>{
      expect(["create_project_remote_branch","delete_project_remote_branch"]).toContain(command);
      try{return await ref(args.input as ProjectsGitRefRequest,args.idempotencyKey as string);}
      catch(error){if(error instanceof BffError)throw {code:error.reason,operationId:error.operationId};throw error;}
    },{expectedRelayUrl:"wss://native.example",expectedSignerPubkey:viewer});
    host.git={...host.git!,createProjectRemoteBranch:nativeGit.createProjectRemoteBranch,deleteProjectRemoteBranch:nativeGit.deleteProjectRemoteBranch};
  }
  if(publish)host.publish=vi.fn<NonNullable<ProjectsHost["publish"]>>(async()=>{throw new Error("unexpected publication");});
  return {host,rows,ref,announcement,projectId:`30621:${owner}:project`,repositoryId:`${owner}:repo`};
}
async function currentRepository(f:ReturnType<typeof fixture>){
  const repo=(await loadProjectDirectory(f.host,new AbortController().signal)).projects[0]?.repositories[0];
  if(!repo)throw new Error("Repository fixture missing");
  return repo;
}
async function mount(f:ReturnType<typeof fixture>,target:ProjectWorkItemTarget){
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  const pulse:PulseHost={scopeKey:f.host.scopeKey,pubkey:viewer,query:async()=>[],publish:vi.fn(),copy:vi.fn(),startDm:vi.fn(),mediaUrl:url=>url,
    renderComposer:()=>null,renderContent:content=><p>{content}</p>};
  const opened=vi.fn();
  const content=<><div id="app-top-chrome-content"/><PlatformProvider client={createBffClient({send:async()=>({status:200,body:{items:[]}})})} locale="en">
    <QueryClientProvider client={cache}><TooltipProvider>
      <ProjectsView host={f.host} selectedProjectId={f.projectId} workItemTarget={target} onSelectedProjectChange={opened}
        renderWorkItems={children=><PulseHostProvider host={pulse}>{children}</PulseHostProvider>}/>
    </TooltipProvider></QueryClientProvider></PlatformProvider></>;
  let setVisible!:(visible:boolean)=>void;
  function Lifetime(){const [visible,set]=useState(true);setVisible=set;return visible?content:null;}
  const ui=await render(<Lifetime/>);
  return {ui,opened,unmount:async()=>{await act(async()=>setVisible(false));}};
}
const button=(root:ParentNode,label:string)=>Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(entry=>entry.textContent?.trim()===label||entry.getAttribute("aria-label")===label);
const menuEntry=(label:string)=>Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"],[role="menuitemradio"]')).find(entry=>entry.textContent?.trim()===label);
async function openBranchMenu(expected:string){
  await vi.waitFor(()=>expect(document.querySelector('[role="menu"]')).toBeNull());
  const trigger=document.querySelector<HTMLButtonElement>('[data-testid="project-repository-branch-trigger"]')!;
  await act(async()=>{trigger.focus();trigger.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));});
  await vi.waitFor(()=>expect(menuEntry(expected)).toBeDefined());
}
const refIntents=()=>[...Array(localStorage.length)].map((_,index)=>localStorage.key(index)).filter(key=>key?.startsWith('["project-git-ref"'));
const reviewIntents=()=>[...Array(localStorage.length)].map((_,index)=>localStorage.key(index)).filter(key=>key?.startsWith('["project-pull-request-publication"'));

beforeEach(()=>{localStorage.clear();sessionStorage.clear();setLocale("en");
  vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener(){},removeEventListener(){}}));
  Object.defineProperty(document,"fonts",{configurable:true,value:{ready:Promise.resolve()}});
  vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});
  HTMLElement.prototype.scrollIntoView=vi.fn();
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("restored repository state",()=>{
  it("parses the original 30618 refs, tags and symbolic HEAD",()=>{
    expect(eventToRepoState(event("7",30618,[["d","repo"],["refs/heads/dev",featureHead],["refs/tags/v2",mainHead],["HEAD","ref: refs/heads/dev"],["refs/heads/empty"]],"",42)))
      .toEqual({branches:[{name:"dev",commit:featureHead}],tags:[{name:"v2",commit:mainHead}],head:"dev",updatedAt:42});
  });

  it("reads REPOSITORY_STATES for the 30617 coordinate and keeps the newest state",async()=>{
    const f=fixture();const repo=await currentRepository(f);
    const state=await fetchRepoState(f.host,repo);
    expect(f.host.query).toHaveBeenLastCalledWith({view:"REPOSITORY_STATES",coordinates:[repository]});
    expect(state).toEqual({branches:[{name:"main",commit:mainHead},{name:"feature",commit:featureHead}],tags:[{name:"v1",commit:mainHead}],head:"main",updatedAt:30});
  });
});

describe("Projects Git ref host seam",()=>{
  it("sends the original branch inputs as the typed ref request with the intent key",async()=>{
    const f=fixture();
    expect(await f.host.git!.createProjectRemoteBranch!({repository,sourceBranch:"main",expectedCommit:mainHead,newBranch:"feature/x"},"k1"))
      .toEqual({branch:"feature/x",commit:mainHead});
    expect(f.ref).toHaveBeenLastCalledWith({operation:ProjectGitRefOperation.CreateBranch,repository,branch:"feature/x",sourceBranch:"main",expectedCommit:mainHead},"k1");
    await f.host.git!.deleteProjectRemoteBranch!({repository,branch:"feature",expectedCommit:featureHead},"k2");
    expect(f.ref).toHaveBeenLastCalledWith({operation:ProjectGitRefOperation.DeleteBranch,repository,branch:"feature",expectedCommit:featureHead},"k2");
    // A 2xx naming another branch or head is not a confirmation.
    f.ref.mockResolvedValueOnce({branch:"feature",commit:mainHead});
    await expect(f.host.git!.deleteProjectRemoteBranch!({repository,branch:"feature",expectedCommit:featureHead},"k3")).rejects.toBeInstanceOf(TransportError);
    expect(fixture({refs:false}).host.git!.createProjectRemoteBranch).toBeUndefined();
  });

  it("keeps an UNKNOWN branch change on its exact intent and resends only that intent",async()=>{
    const f=fixture();const repo=await currentRepository(f);const signal=new AbortController().signal;
    const create:ProjectsGitRefRequest={operation:ProjectGitRefOperation.CreateBranch,repository,branch:"feature/x",sourceBranch:"main",expectedCommit:mainHead};
    f.ref.mockRejectedValueOnce(new TransportError("lost answer"));
    await expect(changeProjectRemoteBranch(f.host,repo,create,signal)).rejects.toThrow("not confirmed");
    expect(readProjectGitRefIntent(f.host,repo)?.request).toEqual(create);
    // No other change on this repository is sent while one is unconfirmed.
    await expect(changeProjectRemoteBranch(f.host,repo,{operation:ProjectGitRefOperation.DeleteBranch,repository,branch:"feature",expectedCommit:featureHead},signal))
      .rejects.toThrow("not confirmed");
    expect(f.ref).toHaveBeenCalledTimes(1);
    expect(await changeProjectRemoteBranch(f.host,repo,create,signal)).toEqual({branch:"feature/x",commit:mainHead});
    expect(f.ref).toHaveBeenCalledTimes(2);
    expect(f.ref.mock.calls[1]?.[0]).toEqual(f.ref.mock.calls[0]?.[0]);
    expect(f.ref.mock.calls[1]?.[1]).toBe(f.ref.mock.calls[0]?.[1]);expect(f.ref.mock.calls[0]?.[1]).toMatch(KEY);
    expect(refIntents()).toEqual([]);
  });

  it("settles a definite refusal and maps its reason, and treats PUBLISH_RESULT_UNKNOWN as unconfirmed",async()=>{
    const f=fixture();const repo=await currentRepository(f);const signal=new AbortController().signal;
    const remove:ProjectsGitRefRequest={operation:ProjectGitRefOperation.DeleteBranch,repository,branch:"feature",expectedCommit:featureHead};
    const conflict=new BffError(409,"POST /api/v1/projects/git/ref → 409",{class:ErrorClass.Conflict,reason:ReasonCode.TargetStateConflict});
    f.ref.mockRejectedValueOnce(conflict);
    const refused=await changeProjectRemoteBranch(f.host,repo,remove,signal).catch(error=>error);
    expect(refused).toBe(conflict);expect(refIntents()).toEqual([]);
    expect(projectBranchErrorMessage(refused,"fallback")).toBe("The branch changed since it was loaded. Refresh the repository and try again.");
    expect(projectBranchErrorMessage(new BffError(403,"x",{class:ErrorClass.Denied,reason:ReasonCode.PublishRejected}),"fallback")).toBe("The repository rejected this branch change.");
    f.ref.mockRejectedValueOnce(new BffError(502,"x",{class:ErrorClass.Blocked,reason:ReasonCode.PublishResultUnknown}));
    await expect(changeProjectRemoteBranch(f.host,repo,remove,signal)).rejects.toThrow("not confirmed");
    expect(refIntents()).toHaveLength(1);
  });
});

describe("restored branch dialogs",()=>{
  it.each([false,true])("creates a branch from the active branch head and selects it (native=%s)",async(native)=>{
    const f=fixture({native});const success=vi.spyOn(toast,"success").mockImplementation(()=>"ok");
    f.ref.mockImplementation(async request=>{
      f.rows.push(event("5",30618,[["d","repo"],["refs/heads/main",mainHead],["refs/heads/feature",featureHead],[`refs/heads/${request.branch}`,request.expectedCommit]],"",40));
      return {branch:request.branch,commit:request.expectedCommit};
    });
    await mount(f,{repositoryId:f.repositoryId,tab:"files"});
    await vi.waitFor(()=>expect(document.querySelector('[data-testid="project-repository-branch-trigger"]')?.textContent).toBe("main"));
    await openBranchMenu("Create branch…");
    expect(menuEntry("feature")).toBeDefined();
    await act(async()=>{menuEntry("Create branch…")!.click();});
    await vi.waitFor(()=>expect(document.querySelector('[data-testid="project-create-branch-dialog"]')).not.toBeNull());
    expect(document.querySelector('[data-testid="project-create-branch-dialog"]')?.textContent).toContain("Create a remote branch from main at 1111111.");
    await type(document.querySelector<HTMLInputElement>('[data-testid="project-create-branch-name"]')!,"feature");
    expect(document.querySelector('[data-testid="project-create-branch-dialog"]')?.textContent).toContain("A branch with this name already exists.");
    await type(document.querySelector<HTMLInputElement>('[data-testid="project-create-branch-name"]')!,"refs/heads/feature/x");
    await click(document.querySelector<HTMLButtonElement>('[data-testid="project-create-branch-submit"]')!);
    await vi.waitFor(()=>expect(success).toHaveBeenCalledWith("Created branch feature/x."));
    expect(f.ref).toHaveBeenCalledTimes(1);
    expect(f.ref.mock.calls[0]?.[0]).toEqual({operation:"CREATE_BRANCH",repository,branch:"feature/x",sourceBranch:"main",expectedCommit:mainHead});
    expect(f.ref.mock.calls[0]?.[1]).toMatch(KEY);
    await vi.waitFor(()=>expect(document.querySelector('[data-testid="project-repository-branch-trigger"]')?.textContent).toBe("feature/x"));
    expect(document.querySelector('[data-testid="project-create-branch-dialog"]')).toBeNull();
  });

  it.each([false,true])("deletes the selected branch, keeps an UNKNOWN deletion and re-checks only it (native=%s)",async(native)=>{
    const f=fixture({native});const success=vi.spyOn(toast,"success").mockImplementation(()=>"ok");
    f.ref.mockRejectedValueOnce(new TransportError("lost answer"));
    await mount(f,{repositoryId:f.repositoryId,tab:"files"});
    await vi.waitFor(()=>expect(document.querySelector('[data-testid="project-repository-branch-trigger"]')?.textContent).toBe("main"));
    await openBranchMenu("Delete main");
    // The default branch is not deletable.
    expect(menuEntry("Delete main")?.getAttribute("data-disabled")).not.toBeNull();
    await act(async()=>{menuEntry("feature")!.click();});
    await vi.waitFor(()=>expect(document.querySelector('[data-testid="project-repository-branch-trigger"]')?.textContent).toBe("feature"));
    await openBranchMenu("Delete feature");
    await act(async()=>{menuEntry("Delete feature")!.click();});
    await vi.waitFor(()=>expect(document.querySelector('[data-testid="project-delete-branch-dialog"]')).not.toBeNull());
    await click(document.querySelector<HTMLButtonElement>('[data-testid="project-delete-branch-submit"]')!);
    await vi.waitFor(()=>expect(document.querySelector('[data-testid="project-delete-branch-dialog"]')?.textContent).toContain("not confirmed"));
    await vi.waitFor(()=>expect(document.querySelector('[data-testid="project-delete-branch-submit"]')?.textContent).toBe("Re-check branch change"));
    expect(refIntents()).toHaveLength(1);
    await click(document.querySelector<HTMLButtonElement>('[data-testid="project-delete-branch-submit"]')!);
    await vi.waitFor(()=>expect(success).toHaveBeenCalledWith("Deleted branch feature."));
    expect(f.ref).toHaveBeenCalledTimes(2);
    expect(f.ref.mock.calls[0]?.[0]).toEqual({operation:"DELETE_BRANCH",repository,branch:"feature",expectedCommit:featureHead});
    expect(f.ref.mock.calls[1]?.[0]).toEqual(f.ref.mock.calls[0]?.[0]);
    expect(f.ref.mock.calls[1]?.[1]).toBe(f.ref.mock.calls[0]?.[1]);
    expect(refIntents()).toEqual([]);
  });

  it("offers no branch writes when the host has no ref capability",async()=>{
    const f=fixture({refs:false});
    await mount(f,{repositoryId:f.repositoryId,tab:"files"});
    await vi.waitFor(()=>expect(document.querySelector('[data-testid="project-repository-branch-trigger"]')?.textContent).toBe("main"));
    await openBranchMenu("feature");
    expect(menuEntry("Create branch…")).toBeUndefined();
    expect(menuEntry("Delete main")).toBeUndefined();
  });
});

describe("restored Create review",()=>{
  const reviewTags=(title:string)=>[["a",repository],["p",owner],["subject",title],["c",featureHead],["clone","https://example.test/repo.git"],["branch-name","feature"],["target-branch","main"]];

  it("publishes the exact CREATE_PULL_REQUEST from the Reviews header and opens the review",async()=>{
    const f=fixture();const success=vi.spyOn(toast,"success").mockImplementation(()=>"ok");
    const publish=vi.fn<NonNullable<ProjectsHost["publish"]>>(async(_request,_key,_observe,observation)=>{
      const created=event("c",1618,reviewTags("Add feature"),"Context for reviewers",40,viewer);
      observation?.onPrepared(created.id);f.rows.push(created);return {eventId:created.id};
    });
    f.host.publish=publish;
    const {ui,opened}=await mount(f,{repositoryId:f.repositoryId,tab:"prs"});
    await vi.waitFor(()=>expect(button(ui,"Create review")).toBeDefined());
    await click(button(ui,"Create review")!);
    await vi.waitFor(()=>expect(document.querySelector<HTMLSelectElement>('[data-testid="create-pull-request-compare-branch"]')?.value).toBe("feature"));
    expect(document.querySelector<HTMLSelectElement>('[data-testid="create-pull-request-base-branch"]')?.value).toBe("main");
    expect([...document.querySelectorAll<HTMLOptionElement>('[data-testid="create-pull-request-compare-branch"] option')].map(option=>option.value)).toEqual(["","main","feature"]);
    await type(document.querySelector<HTMLInputElement>('[data-testid="create-pull-request-title"]')!,"Add feature");
    await type(document.querySelector<HTMLTextAreaElement>('[data-testid="create-pull-request-body"]')!,"Context for reviewers");
    await click(document.querySelector<HTMLButtonElement>('[data-testid="create-pull-request-submit"]')!);
    await vi.waitFor(()=>expect(success).toHaveBeenCalledWith("Review created."));
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]?.[0]).toEqual({operation:"CREATE_PULL_REQUEST",targetEventId:f.announcement.id,title:"Add feature",
      body:"Context for reviewers",branchName:"feature",targetBranch:"main",commit:featureHead});
    expect(publish.mock.calls[0]?.[1]).toMatch(KEY);expect(publish.mock.calls[0]?.[2]).toBe(false);
    await vi.waitFor(()=>expect(opened).toHaveBeenCalledWith(f.projectId,{repositoryId:f.repositoryId,tab:"prs",pullRequestId:"c".repeat(64)}));
    expect(reviewIntents()).toEqual([]);
  });

  it("blocks a second open review for the same branches and is absent without Git",async()=>{
    const f=fixture();
    f.rows.push(event("d",1618,reviewTags("Existing"),"",25,viewer));
    const {ui}=await mount(f,{repositoryId:f.repositoryId,tab:"prs"});
    await vi.waitFor(()=>expect(button(ui,"Create review")).toBeDefined());
    await click(button(ui,"Create review")!);
    await vi.waitFor(()=>expect(document.querySelector('[data-testid="create-pull-request-dialog"]')?.textContent).toContain("An open review already compares these branches."));
    expect(document.querySelector<HTMLButtonElement>('[data-testid="create-pull-request-submit"]')?.disabled).toBe(true);
    const plain=fixture();delete plain.host.git;
    const other=await mount(plain,{repositoryId:plain.repositoryId,tab:"prs"});
    await vi.waitFor(()=>expect(other.ui.querySelector('[data-testid="project-workspace-panel"]')).not.toBeNull());
    expect(button(other.ui,"Create review")).toBeUndefined();
  });

  it("keeps an UNKNOWN review publication on its exact intent and only re-observes it",async()=>{
    const f=fixture();const repo=await currentRepository(f);const signal=new AbortController().signal;
    const publish=vi.fn<NonNullable<ProjectsHost["publish"]>>(async(_request,_key,_observe,observation)=>{observation?.onPrepared("c".repeat(64));throw new TransportError("lost ACK");});
    f.host.publish=publish;
    const input={title:"Add feature",body:"Context for reviewers",branch:"feature",targetBranch:"main",commit:featureHead,mergeBase:null,reviewers:[]};
    await expect(publishProjectPullRequest(f.host,f.projectId,repo,input,signal)).rejects.toThrow();
    await expect(publishProjectPullRequest(f.host,f.projectId,repo,{...input,title:"Another"},signal)).rejects.toThrow("outcome unknown");
    expect(publish).toHaveBeenCalledTimes(1);
    f.rows.push(event("c",1618,reviewTags("Add feature"),"Context for reviewers",40,viewer));
    publish.mockImplementation(async()=>({eventId:"c".repeat(64)}));
    const result=await publishProjectPullRequest(f.host,f.projectId,repo,input,signal);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[1]?.[0]).toEqual(publish.mock.calls[0]?.[0]);
    expect(publish.mock.calls[1]?.[1]).toBe(publish.mock.calls[0]?.[1]);expect(publish.mock.calls[1]?.[2]).toBe(true);
    expect(publish.mock.calls[1]?.[3]?.eventId).toBe("c".repeat(64));
    expect(result.pullRequest.title).toBe("Add feature");
    result.complete();expect(reviewIntents()).toEqual([]);
  });
});


describe("original branch continuation in a tag selection",()=>{
  it.each(["create","delete"] as const)("retires a deferred %s callback before the host write and preserves old intent storage",async operation=>{
    const f=fixture();const repo=await currentRepository(f);let actions!:ReturnType<typeof useProjectBranchActions>;
    let selectTag!:(value:boolean)=>void;let release!:()=>void;let entered=false;
    const cache=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{onMutate:async()=>{entered=true;await new Promise<void>(resolve=>{release=resolve;});}}}});
    function Consumer(){const [tag,setTag]=useState(false);selectTag=setTag;
      actions=useProjectBranchActions({host:f.host,project:repo,readOnly:tag,activeBranch:"feature",activeBranchCommit:featureHead,
        activeRemoteBranch:{name:"feature",commit:featureHead},defaultBranch:"main",deleteBranchReason:null,refetchRepoState:async()=>{},
        rememberBranch:vi.fn(),forgetBranch:vi.fn(),selectBranch:vi.fn()});return null;}
    await render(<QueryClientProvider client={cache}><Consumer/></QueryClientProvider>);
    const old=operation==="create"?()=>actions.handleCreate("new-branch"):actions.handleDelete;
    // Capture the actual old closure before the controlled selection changes.
    const captured=operation==="create"?actions.handleCreate:()=>old();
    const pending=operation==="create"?captured("new-branch"):old();
    const rejected=expect(pending).rejects.toThrow();
    await vi.waitFor(()=>expect(entered).toBe(true));
    await act(async()=>selectTag(true));
    await act(async()=>release());await rejected;
    expect(f.ref).not.toHaveBeenCalled();expect(refIntents()).toEqual([]);
    expect(actions.available).toBe(false);
    await act(async()=>selectTag(false));
    await expect(captured("new-branch")).rejects.toThrow();
    expect(f.ref).not.toHaveBeenCalled();
  });
});


describe("original review update",()=>{
  const updateIntents=()=>[...Array(localStorage.length)].map((_,i)=>localStorage.key(i)).filter(key=>key?.startsWith('["project-pull-request-update"'));
  function reviewFixture(){
    const f=fixture();
    const root={...event("2",1618,[["a",repository],["subject","Original branch review"],["branch-name","main"],
      ["target-branch","release"],["c",olderHead],["clone","https://example.test/repo.git"]]),pubkey:viewer};
    f.rows.push(root);return {...f,root};
  }
  function accept(f:ReturnType<typeof reviewFixture>){
    f.host.publish=vi.fn(async(request,_key,_observe,observation)=>{
      expect(request.operation).toBe("UPDATE_PULL_REQUEST");
      const repo=await currentRepository(f);
      const before=await loadProjectWorkItems(f.host,new AbortController().signal,f.projectId);
      const item=before.items.find(item=>item.type==="pull-request"&&item.pullRequest.id===f.root.id)!;
      if(item.type!=="pull-request")throw new Error("Missing review");
      const update={...event("3",1619,buildProjectPullRequestUpdate(repo,item.pullRequest,request.commit!,request.mergeBase??null).tags,"",60),pubkey:viewer};
      observation?.onPrepared?.(update.id);f.rows.push(update);return {eventId:update.id};
    });
  }
  it("publishes the original Update review button and confirms the new head before clearing its key",async()=>{
    const f=reviewFixture();accept(f);const mounted=await mount(f,{repositoryId:f.repositoryId,tab:"overview"});
    await vi.waitFor(()=>expect(button(document,"Update review")).toBeDefined());
    await click(button(document,"Update review")!);
    await vi.waitFor(()=>expect(button(document,"Update review")).toBeUndefined());
    expect(f.host.publish).toHaveBeenCalledTimes(1);
    expect(vi.mocked(f.host.publish!).mock.calls[0]?.[0]).toEqual({operation:"UPDATE_PULL_REQUEST",targetEventId:f.root.id,commit:mainHead});
    expect(updateIntents()).toEqual([]);await mounted.unmount();
  });
  it("retains UNKNOWN commit and original key across a changed remote head without signing a new intent",async()=>{
    const f=reviewFixture(),repo=await currentRepository(f),signal=new AbortController().signal;
    const before=await loadProjectWorkItems(f.host,signal,f.projectId),item=before.items.find(item=>item.type==="pull-request")!;
    if(item.type!=="pull-request")throw new Error("Missing review");
    f.host.publish=vi.fn(async()=>{throw new TransportError("lost ACK");});
    await expect(publishProjectPullRequestUpdate(f.host,f.projectId,repo,item.pullRequest,viewer,{commit:mainHead,mergeBase:olderHead},signal)).rejects.toThrow();
    const first=vi.mocked(f.host.publish).mock.calls[0]!;
    expect(readProjectPullRequestUpdateIntent(f.host,f.projectId,repo,item.pullRequest,viewer)?.commit).toBe(mainHead);
    accept(f);
    const result=await publishProjectPullRequestUpdate(f.host,f.projectId,repo,item.pullRequest,viewer,{commit:featureHead,mergeBase:null},signal);
    expect(vi.mocked(f.host.publish!).mock.calls[0]?.slice(0,3)).toEqual([first[0],first[1],true]);
    expect(result?.pullRequest.commit).toBe(mainHead);result?.complete();expect(updateIntents()).toEqual([]);
  });
  it("keeps the original update recovery action when its review closes after a lost ACK",async()=>{
    const f=reviewFixture();accept(f);const publish=f.host.publish!;
    f.host.publish=vi.fn(async(...args:Parameters<typeof publish>)=>{await publish(...args);throw new TransportError("lost ACK");});
    const first=await mount(f,{repositoryId:f.repositoryId,tab:"overview"});
    await vi.waitFor(()=>expect(button(document,"Update review")).toBeDefined());
    await click(button(document,"Update review")!);
    await vi.waitFor(()=>expect(button(document,"Update review")?.disabled).toBe(false));
    expect(f.host.publish).toHaveBeenCalledTimes(1);const key=vi.mocked(f.host.publish).mock.calls[0]![1];
    await first.unmount();
    f.rows.push(event("4",1632,[["e",f.root.id,"","root"],["a",repository]],"",80));
    f.host.publish=vi.fn(async(_request,retryKey,observe)=>{expect(retryKey).toBe(key);expect(observe).toBe(true);return {eventId:"3".repeat(64)};});
    const next=await mount(f,{repositoryId:f.repositoryId,tab:"overview"});
    await vi.waitFor(()=>expect(button(document,"Update review")).toBeDefined());
    await click(button(document,"Update review")!);
    await vi.waitFor(()=>expect(updateIntents()).toEqual([]));
    expect(f.host.publish).toHaveBeenCalledTimes(1);expect(button(document,"Update review")).toBeUndefined();
    await next.unmount();
  });
  it("pushes once and uses the original pushed branch, commit and merge base for its review continuation",async()=>{
    const f=reviewFixture();accept(f);
    const push=vi.fn(async()=>({branch:"main",commit:mainHead,mergeBase:olderHead}));
    f.host.git!.checkout={pushProjectLocalRepository:push,cloneProjectRepository:vi.fn(),pullProjectLocalRepository:vi.fn(),openProjectRepositoryFolder:vi.fn(),
      getProjectLocalRepoSnapshot:vi.fn(),getProjectLocalRepoDiff:vi.fn(),getProjectLocalRepoFileContent:vi.fn(),
      getProjectRepoSyncStatus:async()=>({localPath:"/local/repo",localBranch:"main",localBranches:["main"],localHead:mainHead,remoteBranch:"main",remoteHead:olderHead,
        mergeBase:olderHead,aheadCount:1,behindCount:0,hasUncommittedChanges:false,hasUntrackedFiles:false,canPush:true,canPull:false,pushBlockReason:null,pullBlockReason:null,pendingPush:null})};
    const mounted=await mount(f,{repositoryId:f.repositoryId,tab:"overview"});
    await vi.waitFor(()=>expect(Array.from(document.querySelectorAll("button")).some(node=>node.textContent?.startsWith("Push"))).toBe(true));
    await click(Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(node=>node.textContent?.startsWith("Push"))!);
    await vi.waitFor(()=>expect(updateIntents()).toEqual([]));
    await vi.waitFor(()=>expect(f.host.publish).toHaveBeenCalledTimes(1));
    expect(push).toHaveBeenCalledTimes(1);
    expect(vi.mocked(f.host.publish!).mock.calls[0]?.[0]).toEqual({operation:"UPDATE_PULL_REQUEST",targetEventId:f.root.id,commit:mainHead,mergeBase:olderHead});
    await mounted.unmount();
  });
  it("does not dispatch an update after its repository owner is unmounted during the fresh read",async()=>{
    const f=reviewFixture();accept(f);const mounted=await mount(f,{repositoryId:f.repositoryId,tab:"overview"});
    await vi.waitFor(()=>expect(button(document,"Update review")).toBeDefined());
    let release!:(value:Awaited<ReturnType<ProjectsHost["query"]>>)=>void;
    const original=f.host.query;let paused=false;
    f.host.query=vi.fn<ProjectsHost["query"]>(async request=>{const result=await original(request);if(!paused&&request.view==="PROJECTS"){paused=true;return new Promise<Awaited<ReturnType<ProjectsHost["query"]>>>(resolve=>{release=resolve;});}return result;});
    await click(button(document,"Update review")!);await vi.waitFor(()=>expect(release).toBeDefined());
    await mounted.unmount();await act(async()=>release(await original({view:"PROJECTS"} as Parameters<ProjectsHost["query"]>[0])));
    expect(f.host.publish).not.toHaveBeenCalled();expect(updateIntents()).toEqual([]);
  });
});
