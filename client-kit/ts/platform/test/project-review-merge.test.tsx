// DD-118 batch 2b: the restored Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/MergePullRequestButton.tsx in PullRequestReviewCard and
// pullRequestMutations.ts::useMergeProjectPullRequestMutation through the Projects Git host.
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {toast} from "sonner";
import {ErrorClass,ProjectsGitQueryRequestView,ReasonCode,
  type ProjectsGitMergeRequest,type ProjectsGitMergeResponse,type ProjectsGitQueryResponse} from "@client-kit/contracts";
import {createBffClient} from "../src/client";
import {setLocale} from "../src/i18n";
import {PlatformProvider} from "../src/react/context";
import {PulseHostProvider,type PulseHost,type PulseEvent} from "../src/react/pulse/host";
import {TooltipProvider} from "../src/react/sidebar/tooltip";
import {createProjectsGitHost,createNativeProjectsGitHost,loadProjectWorkItems,ProjectInboxDetail,type ProjectsHost} from "../src/react/projects";
import {canMergeProjectPullRequest,mergeProjectPullRequest,readProjectPullRequestMergeIntent} from "../src/react/projects/pullRequestMutations";
import {BffError,TransportError} from "../src/transport";
import {render,click} from "./render";

const viewer="a".repeat(64),other="d".repeat(64),head="f".repeat(40),mergeCommit="4".repeat(40);
const KEY=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const event=(id:string,kind:number,tags:string[][],pubkey:string,content="",time=20):PulseEvent=>({id:id.repeat(64),kind,pubkey,tags,content,created_at:time});
const empty:ProjectsGitQueryResponse={view:ProjectsGitQueryRequestView.Snapshot,snapshot:{commits:[],contributors:[],files:[]}};

function fixture({owner=viewer,mergeable=true,closed=false,native=false}:{owner?:string;mergeable?:boolean;closed?:boolean;native?:boolean}={}){
  const repository=`30617:${owner}:repo`;
  const review=event("2",1618,[["a",repository],["subject","Viewer review"],["c",head],["branch-name","feature"],["target-branch","main"]],viewer,"Review body");
  const rows=[event("8",30617,[["d","repo"],["name","Original repo"],["clone","https://example.test/repo.git"]],owner),
    event("9",30621,[["d","project"],["name","Original project"],["a",repository]],owner),review];
  if(closed)rows.push(event("3",1632,[["e",review.id,"","root"],["a",repository],["p",owner]],viewer,"",30));
  const kinds:Record<string,number[]>={PROJECTS:[30621],REPOSITORIES:[30617],DELETIONS:[5],WORK_ITEMS:[1618,1621],WORK_ITEM_ACTIVITY:[1,1619,1630,1631,1632,1633]};
  const query=vi.fn<ProjectsHost["query"]>(async request=>({pubkey:viewer,limit:20,bindingVersion:3,
    events:rows.filter(row=>kinds[request.view]?.includes(row.kind)&&(!request.coordinates||request.coordinates.includes(row.tags.find(tag=>tag[0]==="a")?.[1]??""))
      &&(request.since===undefined||row.created_at>=request.since)&&(request.until===undefined||row.created_at<=request.until))}));
  // Core's answer: the push landed and the owner-signed 1631 is published and readable.
  const merge=vi.fn(async(request:ProjectsGitMergeRequest,_key:string):Promise<ProjectsGitMergeResponse>=>{
    const status=event("5",1631,[["e",request.pullRequestEventId,"","root"],["a",request.repository],["p",owner],["p",viewer],["merge-commit",mergeCommit],["r",mergeCommit]],owner,"",40);
    rows.push(status);
    return {mergeCommit,statusEventId:status.id};
  });
  const host:ProjectsHost={scopeKey:"tenant:human",query,publish:vi.fn<NonNullable<ProjectsHost["publish"]>>(async()=>{throw new Error("unexpected publication");}),
    git:createProjectsGitHost(async()=>empty,undefined,mergeable?merge:undefined)};
  if(native){
    const nativeGit=createNativeProjectsGitHost(async(command,args)=>{
      expect(command).toBe("merge_project_pull_request");
      const input=args.input as {repository:string;pullRequestEventId:string;branch:string;sourceBranch:string;expectedCommit:string};
      try{
        const result=await merge({repository:input.repository,pullRequestEventId:input.pullRequestEventId,targetBranch:input.branch,sourceBranch:input.sourceBranch,expectedCommit:input.expectedCommit},args.idempotencyKey as string);
        return {...result,statusEventId:result.statusEventId??null};
      }catch(error){if(error instanceof BffError)throw {code:error.reason,operationId:error.operationId};throw error;}
    },{expectedRelayUrl:"wss://native.example",expectedSignerPubkey:viewer});
    host.git={...host.git!,mergeProjectPullRequest:mergeable?nativeGit.mergeProjectPullRequest:undefined};
  }
  return {host,rows,review,merge,repository};
}
async function item(f:ReturnType<typeof fixture>){
  const snapshot=await loadProjectWorkItems(f.host,new AbortController().signal);
  const found=snapshot.items.find(entry=>entry.type==="pull-request");
  if(!found||found.type!=="pull-request")throw new Error("Review fixture missing");
  return found;
}
const pulse=(scopeKey:string):PulseHost=>({scopeKey,pubkey:viewer,query:async()=>[],publish:vi.fn(),copy:vi.fn(),startDm:vi.fn(),mediaUrl:url=>url,
  renderComposer:()=>null,renderContent:content=><p>{content}</p>});
async function mount(f:ReturnType<typeof fixture>){
  const workItem=await item(f);
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  return render(<PlatformProvider client={createBffClient({send:vi.fn()})} locale="en"><QueryClientProvider client={cache}><TooltipProvider>
    <PulseHostProvider host={pulse(f.host.scopeKey)}><ProjectInboxDetail host={f.host} workItem={workItem}/></PulseHostProvider>
  </TooltipProvider></QueryClientProvider></PlatformProvider>);
}
const button=(root:ParentNode,label:string)=>Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(entry=>entry.textContent?.trim()===label||entry.getAttribute("aria-label")===label);
const mergeIntents=()=>[...Array(localStorage.length)].map((_,index)=>localStorage.key(index)).filter(key=>key?.startsWith('["project-pull-request-merge"'));
async function confirmMerge(ui:HTMLElement){
  await vi.waitFor(()=>expect(button(ui,"Merge")).toBeDefined());
  await click(button(ui,"Merge")!);
  await vi.waitFor(()=>expect(document.querySelector('[data-testid="merge-pull-request-confirm"]')?.textContent).toContain("Merge feature into main"));
  await click(document.querySelector<HTMLButtonElement>('[data-testid="merge-pull-request-confirm-button"]')!);
}

beforeEach(()=>{localStorage.clear();sessionStorage.clear();setLocale("en");
  vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener(){},removeEventListener(){}}));
  Object.defineProperty(document,"fonts",{configurable:true,value:{ready:Promise.resolve()}});
  vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});
  HTMLElement.prototype.scrollIntoView=vi.fn();
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("restored review merge",()=>{
  it("offers Merge only to the repository coordinate owner of an open review on a merge-capable host",async()=>{
    const owned=await mount(fixture());
    await vi.waitFor(()=>expect(owned.querySelector('[data-testid="project-pull-request-actions"]')).not.toBeNull());
    expect(button(owned,"Merge")).toBeDefined();
    // The viewer authored the review but another key owns the repository: lifecycle actions only.
    const foreign=await mount(fixture({owner:other}));
    await vi.waitFor(()=>expect(foreign.querySelector('[data-testid="project-pull-request-actions"]')).not.toBeNull());
    expect(button(foreign,"Merge")).toBeUndefined();
    const incapable=await mount(fixture({mergeable:false}));
    await vi.waitFor(()=>expect(incapable.querySelector('[data-testid="project-pull-request-actions"]')).not.toBeNull());
    expect(button(incapable,"Merge")).toBeUndefined();
    const closed=await mount(fixture({closed:true}));
    await vi.waitFor(()=>expect(button(closed,"Reopen review")).toBeDefined());
    expect(button(closed,"Merge")).toBeUndefined();
    const repository={repoAddress:`30617:${viewer}:repo`};
    expect(canMergeProjectPullRequest(repository,{status:"Open",branchName:"feature",commit:head},viewer)).toBe(true);
    expect(canMergeProjectPullRequest(repository,{status:"Open",branchName:null,commit:head},viewer)).toBe(false);
    expect(canMergeProjectPullRequest(repository,{status:"Open",branchName:"feature",commit:null},viewer)).toBe(false);
    expect(canMergeProjectPullRequest(repository,{status:"Draft",branchName:"feature",commit:head},viewer)).toBe(false);
    expect(canMergeProjectPullRequest(repository,{status:"Open",branchName:"feature",commit:head},other)).toBe(false);
  });

  it.each([false,true])("sends the exact typed merge request with the intent key and shows Merged from the 1631 readback (native=%s)",async(native)=>{
    const f=fixture({native});const success=vi.spyOn(toast,"success").mockImplementation(()=>"ok");
    const ui=await mount(f);
    await confirmMerge(ui);
    await vi.waitFor(()=>expect(success).toHaveBeenCalledWith("Merged feature into main."));
    expect(f.merge).toHaveBeenCalledTimes(1);
    expect(f.merge.mock.calls[0]?.[0]).toEqual({repository:f.repository,pullRequestEventId:f.review.id,targetBranch:"main",sourceBranch:"feature",expectedCommit:head});
    expect(f.merge.mock.calls[0]?.[1]).toMatch(KEY);
    expect(JSON.stringify(f.merge.mock.calls[0]?.[0])).not.toMatch(/https?:|wss?:/);
    await vi.waitFor(()=>expect(button(ui,"Merge")).toBeUndefined());
    expect(button(ui,"Re-check merge")).toBeUndefined();
    expect(f.host.publish).not.toHaveBeenCalled();
    expect(mergeIntents()).toEqual([]);
  });

  it.each([false,true])("keeps an UNKNOWN merge on its exact intent and resends only that intent with the same key (native=%s)",async(native)=>{
    const f=fixture({native});const message=vi.spyOn(toast,"message").mockImplementation(()=>"ok");
    const success=vi.spyOn(toast,"success").mockImplementation(()=>"ok");
    const answer=f.merge.getMockImplementation()!;
    f.merge.mockImplementationOnce(async()=>{throw new TransportError("lost answer");});
    const ui=await mount(f);
    await confirmMerge(ui);
    await vi.waitFor(()=>expect(message).toHaveBeenCalledWith("The merge is not confirmed yet. Re-check the same merge."));
    expect(mergeIntents()).toHaveLength(1);
    const workItem=await item(f);
    expect(readProjectPullRequestMergeIntent(f.host,workItem.repository,workItem.pullRequest,viewer)?.request).toEqual(f.merge.mock.calls[0]?.[0]);
    // The retained merge is re-checked directly, never replaced by a new one.
    await vi.waitFor(()=>expect(button(ui,"Re-check merge")).toBeDefined());
    f.merge.mockImplementation(answer);
    await click(button(ui,"Re-check merge")!);
    await vi.waitFor(()=>expect(success).toHaveBeenCalledWith("Merged feature into main."));
    expect(f.merge).toHaveBeenCalledTimes(2);
    expect(f.merge.mock.calls[1]?.[0]).toEqual(f.merge.mock.calls[0]?.[0]);
    expect(f.merge.mock.calls[1]?.[1]).toBe(f.merge.mock.calls[0]?.[1]);
    expect(mergeIntents()).toEqual([]);
  });

  it("shows the original conflict copy without the terminal action and settles the refused intent",async()=>{
    const f=fixture();const error=vi.spyOn(toast,"error").mockImplementation(()=>"ok");
    f.merge.mockImplementationOnce(async()=>{throw new BffError(409,"POST /api/v1/projects/git/merge → 409",{class:ErrorClass.Conflict,reason:ReasonCode.TargetStateConflict});});
    const ui=await mount(f);
    await confirmMerge(ui);
    await vi.waitFor(()=>expect(error).toHaveBeenCalledWith("Pull request has merge conflicts."));
    const panel=ui.querySelector('[data-testid="merge-conflict-recovery"]');
    expect(panel?.textContent).toContain("Resolve conflicts in your local checkout");
    expect(panel?.textContent).toContain("Merge main into the review branch");
    expect(button(ui,"Resolve in Terminal")).toBeUndefined();
    expect(mergeIntents()).toEqual([]);
    // A definite refusal is no retained intent: Merge is offered again, not a re-check.
    expect(button(ui,"Merge")).toBeDefined();
  });

  it("refuses a non-owner before anything is sent",async()=>{
    const f=fixture({owner:other});const workItem=await item(f);
    await expect(mergeProjectPullRequest(f.host,workItem.project.id,workItem.repository,workItem.pullRequest,viewer,new AbortController().signal,()=>{}))
      .rejects.toThrow("Failed to merge review.");
    expect(f.merge).not.toHaveBeenCalled();
    expect(mergeIntents()).toEqual([]);
  });
});
