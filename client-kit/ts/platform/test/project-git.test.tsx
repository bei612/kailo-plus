// DD-118 / V-SCN-89, V-SCN-93: the restored Buzz 779af8886caae1317b4de962082429867ab61503 repository
// reads (ProjectReadmePanel, ProjectRepositoryPanel, ProjectCommitsPanel, ProjectCommitDetailPanel,
// ProjectPullRequestFilesChangedPanel) through the Projects host `git` capability.
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {act,useState} from "react";
import {toast} from "sonner";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {ErrorClass,ProjectsGitQueryRequestView,ReasonCode,type ProjectsGitQueryRequest,type ProjectsGitQueryResponse} from "@client-kit/contracts";
import {createBffClient} from "../src/client";
import {setLocale} from "../src/i18n";
import {PlatformProvider} from "../src/react/context";
import {PulseHostProvider,type PulseHost,type PulseEvent} from "../src/react/pulse/host";
import {TooltipProvider} from "../src/react/sidebar/tooltip";
import {ProjectsView,EntityLinkAnchor,createProjectsGitHost,createNativeProjectsGitHost,type ProjectsHost} from "../src/react/projects";
import type {ProjectWorkItemTarget} from "../src/react/projects/projectWorkItems";
import {BffError} from "../src/transport";
import {projectTagTarget} from "../src/react/projects/projectGit";
import {render,click} from "./render";

const viewer="a".repeat(64),owner="b".repeat(64),repository=`30617:${owner}:repo`,head="f".repeat(40);
const event=(id:string,kind:number,tags:string[][],content="",time=20):PulseEvent=>({id:id.repeat(64),kind,pubkey:owner,tags,content,created_at:time});
const commit={hash:"1".repeat(40),shortHash:"1111111",authorName:"Ada",authorEmail:"ada@example.test",timestamp:1_700_000_000,subject:"Initial import"};
const snapshot:ProjectsGitQueryResponse={view:ProjectsGitQueryRequestView.Snapshot,snapshot:{
  latestCommit:commit,commits:[commit],contributors:[{name:"Ada",email:"ada@example.test",commitCount:1,lastCommitAt:commit.timestamp}],
  files:[
    {path:"README.md",kind:"file",size:24,previewContent:"# Hello\n\nReadme body text",lastChangedAt:commit.timestamp,latestCommit:commit},
    {path:"notes/plan.txt",kind:"file",size:4096,previewContent:null,lastChangedAt:commit.timestamp},
  ]}};
const diff:ProjectsGitQueryResponse={view:ProjectsGitQueryRequestView.Diff,diff:{additions:3,deletions:1,commitBody:null,files:[
  {path:"src/app.ts",additions:2,deletions:1,truncated:false,patch:"@@ -1,2 +1,3 @@\n line\n-old line\n+new line\n+added line"},
  {path:"docs/huge.md",additions:1,deletions:0,truncated:true,patch:"@@ -0,0 +1 @@\n+first of many"},
]}};

function fixture(git=true){
  const review=event("2",1618,[["a",repository],["subject","Original review"],["p",viewer],["c",head],["branch-name","feature"],["target-branch","release"]],"Review body");
  const rows=[event("8",30617,[["d","repo"],["name","Original repo"],["clone","https://example.test/repo.git"]]),
    event("9",30621,[["d","project"],["name","Original project"],["a",repository]]),review,
    event("7",30618,[["d","repo"],["HEAD","ref: refs/heads/main"],["refs/heads/main",commit.hash],["refs/tags/main",head]])];
  const kinds:Record<string,number[]>={PROJECTS:[30621],REPOSITORIES:[30617],DELETIONS:[5],WORK_ITEMS:[1618,1621],WORK_ITEM_ACTIVITY:[1,1619,1630,1631,1632,1633],REPOSITORY_STATES:[30618]};
  const query=vi.fn<ProjectsHost["query"]>(async request=>({pubkey:viewer,limit:20,bindingVersion:3,
    events:rows.filter(row=>kinds[request.view]?.includes(row.kind)&&(!request.coordinates||request.coordinates.includes(row.kind===30618?repository:row.tags.find(tag=>tag[0]==="a")?.[1]??""))
      &&(request.since===undefined||row.created_at>=request.since)&&(request.until===undefined||row.created_at<=request.until))}));
  const gitQuery=vi.fn(async(request:ProjectsGitQueryRequest):Promise<ProjectsGitQueryResponse>=>
    request.view===ProjectsGitQueryRequestView.Snapshot?snapshot:request.view===ProjectsGitQueryRequestView.Diff?diff
      :{view:ProjectsGitQueryRequestView.FileContent,content:"Plan line one"});
  const host:ProjectsHost={scopeKey:"tenant:human",query,...(git?{git:createProjectsGitHost(gitQuery)}:{})};
  return {host,gitQuery,review,rows,projectId:`30621:${owner}:project`,repositoryId:`${owner}:repo`};
}

async function mount(f:ReturnType<typeof fixture>,target:ProjectWorkItemTarget,interactive=false){
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  const pulse:PulseHost={scopeKey:f.host.scopeKey,pubkey:viewer,query:async()=>[],publish:vi.fn(),copy:vi.fn(),startDm:vi.fn(),mediaUrl:url=>url,
    renderComposer:()=>null,renderContent:content=><p data-testid="rendered-content">{content}</p>};
  let showLink!:(href:string)=>void;
  let changeHost!:(host:ProjectsHost)=>void;
  let changeTarget!:(target:ProjectWorkItemTarget)=>void;
  const opened=vi.fn((_id:string|null,next?:ProjectWorkItemTarget)=>{if(interactive&&next)changeTarget(next);});
  const client=createBffClient({send:async()=>({status:200,body:{items:[]}})});
  function Surface(){
    const [host,setHost]=useState(f.host),[currentTarget,setTarget]=useState(target),[href,setHref]=useState<string|null>(null);
    showLink=setHref;
    changeHost=setHost;changeTarget=setTarget;
    return <><div id="app-top-chrome-content"/><PlatformProvider client={client} locale="en">
      <QueryClientProvider client={cache}><TooltipProvider>
        {href ? <EntityLinkAnchor href={href} runtime={{host,copyLink:vi.fn(),onError:vi.fn(),onOpen:async(id,next)=>{
          opened(id,next);setHref(null);setTarget(next);
        }}}/> : <ProjectsView host={host} selectedProjectId={f.projectId} workItemTarget={currentTarget} onSelectedProjectChange={opened}
          renderWorkItems={children=><PulseHostProvider host={{...pulse,scopeKey:host.scopeKey}}>{children}</PulseHostProvider>}/> }
      </TooltipProvider></QueryClientProvider></PlatformProvider></>;
  }
  const ui=await render(<Surface/>);
  return {ui,opened,cache,pulse,showLink:async(href:string)=>{await act(async()=>showLink(href));},switchHost:async(host:ProjectsHost)=>{await act(async()=>changeHost(host));}};
}

const requests=(f:ReturnType<typeof fixture>,view:ProjectsGitQueryRequestView)=>f.gitQuery.mock.calls.map(([request])=>request).filter(request=>request.view===view);

beforeEach(()=>{localStorage.clear();sessionStorage.clear();setLocale("en");
  vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener(){},removeEventListener(){}}));
  Object.defineProperty(document,"fonts",{configurable:true,value:{ready:Promise.resolve()}});
  vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});
  HTMLElement.prototype.scrollIntoView=vi.fn();
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("Projects Git host seam",()=>{
  it("sends only the coordinate, refs and path, and maps absent commits back to the original null",async()=>{
    const query=vi.fn(async(request:ProjectsGitQueryRequest):Promise<ProjectsGitQueryResponse>=>request.view===ProjectsGitQueryRequestView.Snapshot?snapshot
      :{view:ProjectsGitQueryRequestView.FileContent});
    const git=createProjectsGitHost(query);
    const result=await git.getProjectRepoSnapshot({repository,defaultBranch:"main",baseBranch:"main",targetRef:null,targetCommit:null});
    expect(query).toHaveBeenLastCalledWith({view:ProjectsGitQueryRequestView.Snapshot,repository,defaultBranch:"main",baseBranch:"main"});
    expect(result.latestCommit).toEqual(commit);
    expect(result.files[1]?.latestCommit).toBeNull();
    expect(result.files[1]?.previewContent).toBeNull();
    expect(await git.getProjectRepoFileContent({repository,defaultBranch:"main",targetRef:`refs/nostr/${"2".repeat(64)}`,targetCommit:head,path:"notes/plan.txt"})).toBeNull();
    expect(query).toHaveBeenLastCalledWith({view:ProjectsGitQueryRequestView.FileContent,repository,defaultBranch:"main",targetRef:`refs/nostr/${"2".repeat(64)}`,targetCommit:head,path:"notes/plan.txt"});
    query.mockResolvedValueOnce({view:ProjectsGitQueryRequestView.Snapshot,snapshot:{commits:[],contributors:[],files:[]}});
    expect((await git.getProjectRepoSnapshot({repository})).latestCommit).toBeNull();
  });

  it("never renders another view's answer as this view's content",async()=>{
    const git=createProjectsGitHost(async()=>diff);
    await expect(git.getProjectRepoSnapshot({repository})).rejects.toThrow("Invalid repository response");
    await expect(git.getProjectRepoFileContent({repository,path:"README.md"})).rejects.toThrow("Invalid repository response");
  });
});

describe("restored repository workspace Git tabs",()=>{
  it("renders the original README overview from the SNAPSHOT preview without a file read",async()=>{
    const f=fixture();
    const {ui}=await mount(f,{repositoryId:f.repositoryId,tab:"overview"});
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="project-readme"]')?.textContent).toContain("Readme body text"));
    // Original tab order; Channels needs the discussion search this work-item host does not offer.
    expect([...ui.querySelectorAll('[role="tab"]')].map(tab=>tab.textContent)).toEqual(["Overview","Files","Commits","Tasks","Review","Contributors"]);
    expect(requests(f,ProjectsGitQueryRequestView.Snapshot)).toEqual([{view:ProjectsGitQueryRequestView.Snapshot,repository,defaultBranch:"main",baseBranch:"main"}]);
    expect(requests(f,ProjectsGitQueryRequestView.FileContent)).toEqual([]);
  });

  it("lists files, opens a folder and loads an unpreviewed file through FILE_CONTENT with its path",async()=>{
    const f=fixture();
    const {ui}=await mount(f,{repositoryId:f.repositoryId,tab:"files"});
    await vi.waitFor(()=>expect(ui.querySelectorAll('[data-testid="project-repository-entry-row"]')).toHaveLength(2));
    expect(ui.querySelector('[data-testid="project-repository-latest-commit-summary"]')?.textContent).toContain("Initial import");
    const rows=()=>[...ui.querySelectorAll<HTMLElement>('[data-testid="project-repository-entry-row"]')];
    expect(rows().map(row=>row.getAttribute("aria-label"))).toEqual(["Open directory notes","Open file README.md"]);
    await click(rows()[0]!);
    await click(rows().find(row=>row.textContent?.includes("plan.txt"))!);
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="project-repository-file"]')?.textContent).toContain("Plan line one"));
    expect(requests(f,ProjectsGitQueryRequestView.FileContent)).toEqual([{view:ProjectsGitQueryRequestView.FileContent,repository,defaultBranch:"main",path:"notes/plan.txt"}]);
  });

  it("opens a commit from the Commits tab and diffs it against its parent",async()=>{
    const f=fixture();
    const {ui,opened}=await mount(f,{repositoryId:f.repositoryId,tab:"commits"});
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="project-activity-feed-item"]')?.textContent).toContain("Initial import"));
    await click([...ui.querySelectorAll<HTMLButtonElement>('[data-testid="project-activity-feed-item"] button')].find(button=>button.textContent==="Initial import")!);
    expect(opened).toHaveBeenLastCalledWith(f.projectId,{repositoryId:f.repositoryId,tab:"commits",commitHash:commit.hash});
  });

  it("copies the original commit detail link and reopens that exact repository commit through the shared message consumer",async()=>{
    const f=fixture();
    const mounted=await mount(f,{repositoryId:f.repositoryId,tab:"commits",commitHash:commit.hash});
    const {ui,pulse,opened}=mounted;
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="project-commit-copy-link"]')).not.toBeNull());
    vi.mocked(pulse.copy).mockResolvedValue(undefined);
    await click(ui.querySelector<HTMLElement>('[data-testid="project-commit-copy-link"]')!);
    const href=`buzz://repo?owner=${owner}&d=repo&tab=commits&commit=${commit.hash}`;
    expect(pulse.copy).toHaveBeenCalledExactlyOnceWith(href);
    await mounted.showLink(href);
    await vi.waitFor(()=>expect(ui.querySelector('[data-buzz-link-kind="repo"]')?.getAttribute("aria-label")).toContain("Original repo"));
    f.gitQuery.mockClear();
    await click(ui.querySelector<HTMLElement>('[data-buzz-link-kind="repo"]')!);
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="project-diff-files"]')).not.toBeNull());
    expect(opened).toHaveBeenCalledExactlyOnceWith(f.projectId,{repositoryId:f.repositoryId,tab:"commits",commitHash:commit.hash});
    expect(requests(f,ProjectsGitQueryRequestView.Diff)).toContainEqual({view:ProjectsGitQueryRequestView.Diff,repository,defaultBranch:"main",targetCommit:commit.hash});
    expect(pulse.publish).not.toHaveBeenCalled();
  });

  it("renders a commit detail with the original diff UI",async()=>{
    const f=fixture();
    const {ui}=await mount(f,{repositoryId:f.repositoryId,tab:"commits",commitHash:commit.hash});
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="project-diff-files"]')).not.toBeNull());
    expect(ui.querySelector('[data-testid="project-workspace-tab-menu"]')).toBeNull();
    expect(requests(f,ProjectsGitQueryRequestView.Diff)).toEqual([{view:ProjectsGitQueryRequestView.Diff,repository,defaultBranch:"main",targetCommit:commit.hash}]);
  });
});

describe("restored review Files changed",()=>{
  it("reads the review DIFF on its target branch and shows the original truncation notice",async()=>{
    const f=fixture();
    const {ui}=await mount(f,{repositoryId:f.repositoryId,tab:"prs",pullRequestId:f.review.id});
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="project-detail-section-files"]')).not.toBeNull());
    expect(requests(f,ProjectsGitQueryRequestView.Diff)).toEqual([{view:ProjectsGitQueryRequestView.Diff,repository,defaultBranch:"release",baseBranch:"main",
      targetRef:`refs/nostr/${f.review.id}`,targetCommit:head}]);
    await click(ui.querySelector<HTMLButtonElement>('[data-testid="project-detail-section-files"] button')!);
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="project-diff-files"]')?.textContent).toContain("2 files changed"));
    expect(ui.querySelector('[data-testid="project-diff-file"]')?.textContent).toContain("new line");
    await click([...ui.querySelectorAll<HTMLButtonElement>('[data-testid="project-diff-files"] nav button')].find(button=>button.textContent==="huge.md")!);
    expect(ui.querySelector('[data-testid="project-diff-truncated"]')?.textContent).toBe("Large diff truncated — showing the first 2 lines. Use a local checkout to review the full change.");
    // No line-comment authoring is offered in this read-only batch.
    expect(ui.querySelector('[data-testid="project-diff-add-comment"]')).toBeNull();
  });

  it("keeps the original unavailable copy when the BFF hides the repository",async()=>{
    const f=fixture();
    f.gitQuery.mockRejectedValue(new BffError(404,"POST /api/v1/projects/git/query → 404",{class:ErrorClass.Unknown,reason:ReasonCode.TargetNotFound}));
    const {ui}=await mount(f,{repositoryId:f.repositoryId,tab:"overview"});
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="project-repository-unavailable"]')?.textContent).toContain("Repository not initialized"),{timeout:3000});
  });
});

describe("hosts without the Git capability",()=>{
  it("keep the original Tasks/Reviews workspace and no Files changed section",async()=>{
    const f=fixture(false);
    const {ui}=await mount(f,{repositoryId:f.repositoryId,tab:"prs",pullRequestId:f.review.id});
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="project-pull-request-detail"]')).not.toBeNull());
    expect(ui.querySelector('[data-testid="project-detail-section-files"]')).toBeNull();
    expect(f.gitQuery).not.toHaveBeenCalled();
  });

  it("do not route Git tabs and show only the original Tasks/Reviews tabs",async()=>{
    const f=fixture(false);
    const files=await mount(f,{repositoryId:f.repositoryId,tab:"files"});
    await vi.waitFor(()=>expect(files.ui.textContent).toContain("Repository unavailable"));
    const tasks=await mount(f,{repositoryId:f.repositoryId,tab:"issues"});
    await vi.waitFor(()=>expect(tasks.ui.querySelectorAll('[role="tab"]')).toHaveLength(2));
    await act(async()=>{});
    expect(f.gitQuery).not.toHaveBeenCalled();
  });
});


// DD-160: exercise the real restored Projects view through the native host
// decoder. Only the native command boundary is supplied by this DOM fixture.
function nativeFixture(initial:"missing"|"ready"|"pending"="ready"){
  const f=fixture();
  const rawCommit={hash:commit.hash,short_hash:commit.shortHash,author_name:commit.authorName,author_email:commit.authorEmail,timestamp:commit.timestamp,subject:commit.subject};
  const remote={latest_commit:rawCommit,commits:[rawCommit],contributors:[],files:[{path:"README.md",kind:"blob",size:12,preview_content:"# Remote readme",last_changed_at:commit.timestamp,latest_commit:rawCommit}]};
  const local={latest_commit:rawCommit,commits:[rawCommit],contributors:[],files:Array.from({length:251},(_,index)=>({
    path:index===0?"README.md":`file-${String(index).padStart(4,"0")}.txt`,kind:"blob",size:20,
    preview_content:index===0?"# Local readme":index<250?`local ${index}`:null,last_changed_at:commit.timestamp,latest_commit:rawCommit}))};
  const ready={local_path:"/app/checkouts/repo",local_branch:"main",local_branches:["main"],local_head:commit.hash,
    remote_branch:"main",remote_head:commit.hash,ahead_count:0,behind_count:1,has_uncommitted_changes:false,has_untracked_files:false,
    can_push:false,can_pull:true,push_block_reason:null,pull_block_reason:null,pending_push:null as null|{branch:string;old_commit:string|null;new_commit:string;outcome:string}};
  let status:typeof ready|null=initial==="missing"?null:initial==="pending"?{...ready,local_head:"",local_branch:"main",can_push:true,can_pull:false,
    pending_push:{branch:"frozen-feature",old_commit:commit.hash,new_commit:head,outcome:"retry_same_intent"}}:ready;
  let content="Local file 251 before pull";
  const native=vi.fn(async(command:string,_args:Record<string,unknown>):Promise<unknown>=>{
    if(command==="get_project_repo_snapshot")return remote;
    if(command==="get_project_repo_file_content")return "REMOTE FILE MUST NOT BE USED";
    if(command==="get_project_repo_diff"||command==="get_project_local_repo_diff")return {files:[],additions:0,deletions:0,commit_body:null};
    if(command==="get_project_repo_sync_status")return status;
    if(command==="get_project_local_repo_snapshot")return {path:ready.local_path,snapshot:local};
    if(command==="get_project_local_repo_file_content")return content;
    if(command==="clone_project_repository"){status=ready;return {path:ready.local_path,cloned:true};}
    if(command==="pull_project_local_repository"){content="Local file 251 after pull";status={...ready,can_pull:false,behind_count:0};return {pulled:true};}
    if(command==="push_project_local_repository"){status={...ready,can_pull:false,behind_count:0};return {pushed:true,branch:"frozen-feature",commit:head};}
    if(command==="open_project_repository_folder")return null;
    throw new Error(`Unexpected native command ${command}`);
  });
  f.host.git=createNativeProjectsGitHost(native,{expectedRelayUrl:"wss://native.example",expectedSignerPubkey:viewer});
  return {...f,native,setStatus:(value:typeof ready|null)=>{status=value;},setContent:(value:string)=>{content=value;},ready};
}
const localControls=(ui:HTMLElement)=>ui.querySelector<HTMLElement>('[data-testid="project-local-checkout-controls"]')!;
const namedButton=(root:ParentNode,label:string)=>[...root.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent?.trim()===label)!;
async function checkoutMenu(ui:HTMLElement){
  await vi.waitFor(()=>expect(localControls(ui)).not.toBeNull());
  const trigger=localControls(ui).querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
  await act(async()=>{trigger.focus();trigger.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));});
  await vi.waitFor(()=>expect(document.querySelector('[role="menu"]')).not.toBeNull());
}
const menuChoice=(label:string)=>[...document.querySelectorAll<HTMLElement>('[role="menuitem"],[role="menuitemradio"]')].find(item=>item.textContent?.trim()===label)!;
async function selectLocal(ui:HTMLElement){await checkoutMenu(ui);await click(menuChoice("Local"));}
async function activateTab(ui:HTMLElement,label:string){
  const tab=[...ui.querySelectorAll<HTMLElement>('[role="tab"]')].find(tab=>tab.textContent===label)!;
  await act(async()=>{tab.focus();tab.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));});
}

describe("Desktop local checkout in the restored Projects consumer",()=>{
  it("clones, retains Local across tab navigation, reads file 251 locally and refreshes it after pull",async()=>{
    const f=nativeFixture("missing");
    const {ui}=await mount(f,{repositoryId:f.repositoryId,tab:"overview"},true);
    await vi.waitFor(()=>expect(ui.textContent).toContain("Remote readme"));
    await checkoutMenu(ui);
    await vi.waitFor(()=>expect(menuChoice("Clone")).toBeDefined());
    await click(menuChoice("Clone"));
    await vi.waitFor(()=>expect(ui.textContent).toContain("Local readme"));
    await activateTab(ui,"Files");
    await vi.waitFor(()=>expect(ui.querySelector('[aria-label^="Show next "]')).not.toBeNull());
    // Traverse the original paginated list as the user does; file 251 is not
    // initially mounted, independently of the native eager-preview limit.
    while (!ui.querySelector('[aria-label="Open file file-0250.txt"]')) {
      const next=ui.querySelector<HTMLElement>('[aria-label^="Show next "]');
      expect(next).not.toBeNull();
      await click(next!);
    }
    expect(localControls(ui).textContent).toContain("Local");
    await click(ui.querySelector<HTMLElement>('[aria-label="Open file file-0250.txt"]')!);
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="project-repository-file"]')?.textContent).toContain("Local file 251 before pull"));
    expect(f.native.mock.calls.filter(([command])=>command==="get_project_repo_file_content")).toEqual([]);
    await click([...localControls(ui).querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent?.trim().startsWith("Pull"))!);
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="project-repository-file"]')?.textContent).toContain("Local file 251 after pull"));
    await vi.waitFor(()=>expect(namedButton(localControls(ui),"Open folder").disabled).toBe(false));
    await click(namedButton(localControls(ui),"Open folder"));
    expect(f.native.mock.calls.some(([command])=>command==="open_project_repository_folder")).toBe(true);
  });

  it("retries the persisted frozen branch even while the picker shows main",async()=>{
    const f=nativeFixture("pending");
    const {ui}=await mount(f,{repositoryId:f.repositoryId,tab:"overview"});
    await vi.waitFor(()=>expect(localControls(ui)?.textContent).toContain("frozen-feature"));
    expect(localControls(ui).textContent).toContain(head.slice(0,7));
    await click(namedButton(localControls(ui),"Reconcile and retry the same push"));
    await vi.waitFor(()=>expect(f.native.mock.calls.find(([command])=>command==="push_project_local_repository")?.[1]).toMatchObject({repository,branchName:"frozen-feature"}));
    expect(f.native.mock.calls.filter(([command])=>command==="push_project_local_repository")).toHaveLength(1);
  });

  it("never exposes local checkout controls to the Web host",async()=>{
    const f=fixture();
    const {ui}=await mount(f,{repositoryId:f.repositoryId,tab:"overview"});
    await vi.waitFor(()=>expect(ui.textContent).toContain("Readme body text"));
    expect(localControls(ui)).toBeNull();
    expect(ui.textContent).not.toContain("Open folder");
  });

  it("drops an old clone completion after switching identity without notifying or selecting Local",async()=>{
    const f=nativeFixture("missing");
    const original=f.native.getMockImplementation()!;
    let resolveClone!:(value:unknown)=>void;
    f.native.mockImplementation((command,args)=>command==="clone_project_repository"?new Promise(resolve=>{resolveClone=resolve;}):original(command,args));
    const success=vi.spyOn(toast,"success");
    const mounted=await mount(f,{repositoryId:f.repositoryId,tab:"overview"});
    await vi.waitFor(()=>expect(mounted.ui.textContent).toContain("Remote readme"));
    await checkoutMenu(mounted.ui);await click(menuChoice("Clone"));
    await vi.waitFor(()=>expect(resolveClone).toBeTypeOf("function"));
    const next=nativeFixture("ready");next.host.scopeKey="tenant:another-human";
    await mounted.switchHost(next.host);
    await vi.waitFor(()=>expect(localControls(mounted.ui)?.textContent).toContain("Open folder"));
    await act(async()=>resolveClone({path:"/old/identity/repo",cloned:true}));
    await act(async()=>{});
    expect(success).not.toHaveBeenCalled();
    expect(namedButton(localControls(mounted.ui),"Remote")).toBeDefined();
    expect(next.native.mock.calls.some(([command])=>command==="get_project_local_repo_snapshot")).toBe(false);
    expect(mounted.ui.textContent).not.toContain("/old/identity/repo");
  });

  it("keeps Local for commit details and sends the diff to the local command",async()=>{
    const f=nativeFixture("ready");
    const {ui}=await mount(f,{repositoryId:f.repositoryId,tab:"overview"},true);
    await vi.waitFor(()=>expect(localControls(ui)?.textContent).toContain("Open folder"));
    await selectLocal(ui);
    await vi.waitFor(()=>expect(ui.textContent).toContain("Local readme"));
    await activateTab(ui,"Commits");
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="project-activity-feed-item"]')?.textContent).toContain("Initial import"));
    await click([...ui.querySelectorAll<HTMLButtonElement>('[data-testid="project-activity-feed-item"] button')].find(button=>button.textContent==="Initial import")!);
    await vi.waitFor(()=>expect(f.native.mock.calls.some(([command])=>command==="get_project_local_repo_diff")).toBe(true));
    expect(f.native.mock.calls.some(([command])=>command==="get_project_repo_diff")).toBe(false);
  });
});


// Original tag menu -> remote snapshot / lazy file reader, through the actual shared ProjectsView.
async function pickRepositoryRef(value: string) {
  const trigger=document.querySelector<HTMLButtonElement>('[data-testid="project-repository-branch-trigger"]')!;
  await act(async()=>{trigger.focus();trigger.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));});
  await vi.waitFor(()=>expect(document.querySelector('[role="menu"]')).not.toBeNull());
  const choice=[...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(item=>item.textContent?.trim()===value)!;
  expect(choice).toBeDefined();await click(choice);
}

describe("original repository tag snapshot consumer",()=>{
  it("separates a tag from its same-named branch and reads the selected tag's lazy file",async()=>{
    const f=fixture();
    f.gitQuery.mockImplementation(async request=>request.view===ProjectsGitQueryRequestView.FileContent
      ? {view:ProjectsGitQueryRequestView.FileContent,content:request.targetRef?"Frozen tag file":"Current branch file"}
      : {...snapshot,snapshot:{...snapshot.snapshot!,files:[{path:"README.md",kind:"file",size:24,previewContent:null,lastChangedAt:null}]}});
    const {ui}=await mount(f,{repositoryId:f.repositoryId,tab:"files"});
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="project-repository-branch-trigger"]')).not.toBeNull());
    await pickRepositoryRef("mainfffffff");
    await vi.waitFor(()=>expect(requests(f,ProjectsGitQueryRequestView.Snapshot).some(request=>request.targetRef==="refs/tags/main"&&request.targetCommit===head)).toBe(true));
    const openReadme=async()=>{await vi.waitFor(()=>expect(ui.querySelector('[data-testid="project-repository-entry-row"]')).not.toBeNull());const row=[...ui.querySelectorAll<HTMLTableRowElement>('[data-testid="project-repository-entry-row"]')].find(row=>row.textContent?.includes("README.md"))!;expect(row).toBeDefined();await click(row);};
    await openReadme();
    await vi.waitFor(()=>expect(ui.textContent).toContain("Frozen tag file"));
    expect(requests(f,ProjectsGitQueryRequestView.FileContent).at(-1)).toMatchObject({repository,targetRef:"refs/tags/main",targetCommit:head,path:"README.md"});
    await click(namedButton(ui.querySelector('[data-testid="project-repository-file"]')!,"Files"));
    await pickRepositoryRef("main");
    await openReadme();
    await vi.waitFor(()=>expect(ui.textContent).toContain("Current branch file"));
    expect(requests(f,ProjectsGitQueryRequestView.FileContent).at(-1)).not.toHaveProperty("targetRef");
  });

  it("updates an already-open file preview when tag and branch have the same paths",async()=>{
    const f=fixture();f.gitQuery.mockImplementation(async request=>({...snapshot,snapshot:{...snapshot.snapshot!,files:[
      {path:"README.md",kind:"file",size:24,previewContent:request.targetRef?"Tag inline preview":"Branch inline preview",lastChangedAt:null}]}}));
    const {ui,cache}=await mount(f,{repositoryId:f.repositoryId,tab:"files"});
    // Both production hosts retain inactive queries for five minutes.
    cache.setQueryDefaults(["project"],{gcTime:5*60*1_000});
    try {
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="project-repository-entry-row"]')).not.toBeNull());
    // First visit loads the tag through the original menu. A later cached switch
    // keeps the Files panel mounted; an uncached switch originally returns to its list.
    await pickRepositoryRef("mainfffffff");
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="project-repository-entry-row"]')).not.toBeNull());
    await vi.waitFor(()=>expect(cache.getQueryData<{files:Array<{previewContent:string|null}>}>(["project",f.host.scopeKey,f.repositoryId,"repo-snapshot","main","none","none","main",head])?.files[0]?.previewContent).toBe("Tag inline preview"));
    await pickRepositoryRef("main");
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="project-repository-entry-row"]')).not.toBeNull());
    await click(ui.querySelector<HTMLTableRowElement>('[data-testid="project-repository-entry-row"]')!);
    await vi.waitFor(()=>expect(ui.textContent).toContain("Branch inline preview"));
    await pickRepositoryRef("mainfffffff");
    await vi.waitFor(()=>expect(ui.textContent).toContain("Tag inline preview"));
    expect(ui.textContent).not.toContain("Branch inline preview");
    } finally { cache.clear(); }
  });

  it("keeps a selected tag remote and hides local writes in the real Desktop host consumer",async()=>{
    const f=nativeFixture("ready");const {ui}=await mount(f,{repositoryId:f.repositoryId,tab:"overview"},true);
    await vi.waitFor(()=>expect(ui.textContent).toContain("Remote readme"));
    await selectLocal(ui);await vi.waitFor(()=>expect(ui.textContent).toContain("Local readme"));
    await pickRepositoryRef("mainfffffff");
    await vi.waitFor(()=>expect(f.native.mock.calls.some(([command,args])=>command==="get_project_repo_snapshot"&&args.targetRef==="refs/tags/main"&&args.targetCommit===head)).toBe(true));
    await vi.waitFor(()=>expect(ui.textContent).toContain("Remote readme"));
    expect(ui.textContent).not.toContain("Local readme");
    expect([...localControls(ui).querySelectorAll("button")].some(button=>/^(Pull|Push)/.test(button.textContent?.trim()??""))).toBe(false);
    await checkoutMenu(ui);expect(menuChoice("Local").hasAttribute("data-disabled")).toBe(true);
    expect(menuChoice("Clone")).toBeUndefined();
    await act(async()=>document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));
    expect(f.native.mock.calls.some(([command])=>["clone_project_repository","push_project_local_repository","pull_project_local_repository"].includes(command))).toBe(false);
  });

  it("does not dispatch a malformed published tag as HEAD",async()=>{
    const f=fixture();f.rows.find(row=>row.kind===30618)!.tags.push(["refs/tags/broken", "not-a-commit"]);
    const {ui}=await mount(f,{repositoryId:f.repositoryId,tab:"files"});
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="project-repository-branch-trigger"]')).not.toBeNull());
    const before=f.gitQuery.mock.calls.length;
    await pickRepositoryRef("brokennot-a-c");
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="project-repository-unavailable"]')).not.toBeNull(),{timeout:3000});
    expect(f.gitQuery).toHaveBeenCalledTimes(before);
    expect(ui.textContent).not.toContain("Readme body text");
  });

  it("does not carry a chosen tag into another host identity",async()=>{
    const f=fixture();let finishOld!:(value:ProjectsGitQueryResponse)=>void;
    f.gitQuery.mockImplementation(async request=>request.targetRef?new Promise(resolve=>{finishOld=resolve;}):snapshot);
    const mounted=await mount(f,{repositoryId:f.repositoryId,tab:"files"});
    await vi.waitFor(()=>expect(mounted.ui.querySelector('[data-testid="project-repository-branch-trigger"]')).not.toBeNull());
    await pickRepositoryRef("mainfffffff");
    await vi.waitFor(()=>expect(requests(f,ProjectsGitQueryRequestView.Snapshot).some(request=>request.targetRef)).toBe(true));
    const next=fixture();next.host.scopeKey="tenant:other-human";
    await mounted.switchHost(next.host);
    await vi.waitFor(()=>expect(next.gitQuery).toHaveBeenCalled());
    expect(requests(next,ProjectsGitQueryRequestView.Snapshot).every(request=>!request.targetRef&&!request.targetCommit)).toBe(true);
    await act(async()=>finishOld({...snapshot,snapshot:{...snapshot.snapshot!,files:[{path:"OLD-IDENTITY.txt",kind:"file",size:1,previewContent:"old",lastChangedAt:null}]}}));
    expect(mounted.ui.textContent).not.toContain("OLD-IDENTITY.txt");
    expect(mounted.ui.querySelector('[data-testid="project-repository-branch-trigger"]')?.textContent).toBe("main");
  });

  it("rejects refs that the original git normalizer would silently discard",()=>{
    for(const name of ["../main"," refs/tags/main","refs/heads/main","bad name","-option","/absolute","trailing/","x".repeat(256)])
      expect(()=>projectTagTarget({name,commit:head})).toThrow();
    expect(projectTagTarget({name:"release/v1.0",commit:head})).toEqual({targetRef:"refs/tags/release/v1.0",targetCommit:head});
  });
});
