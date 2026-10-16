// DD-118 / V-SCN-89, V-SCN-93: the restored Buzz 779af8886caae1317b4de962082429867ab61503 repository
// reads (ProjectReadmePanel, ProjectRepositoryPanel, ProjectCommitsPanel, ProjectCommitDetailPanel,
// ProjectPullRequestFilesChangedPanel) through the Projects host `git` capability.
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {act} from "react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {ErrorClass,ProjectsGitQueryRequestView,ReasonCode,type ProjectsGitQueryRequest,type ProjectsGitQueryResponse} from "@client-kit/contracts";
import {createBffClient} from "../src/client";
import {setLocale} from "../src/i18n";
import {PlatformProvider} from "../src/react/context";
import {PulseHostProvider,type PulseHost,type PulseEvent} from "../src/react/pulse/host";
import {TooltipProvider} from "../src/react/sidebar/tooltip";
import {ProjectsView,createProjectsGitHost,type ProjectsHost} from "../src/react/projects";
import type {ProjectWorkItemTarget} from "../src/react/projects/projectWorkItems";
import {BffError} from "../src/transport";
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
    event("9",30621,[["d","project"],["name","Original project"],["a",repository]]),review];
  const kinds:Record<string,number[]>={PROJECTS:[30621],REPOSITORIES:[30617],DELETIONS:[5],WORK_ITEMS:[1618,1621],WORK_ITEM_ACTIVITY:[1,1619,1630,1631,1632,1633]};
  const query=vi.fn<ProjectsHost["query"]>(async request=>({pubkey:viewer,limit:20,bindingVersion:3,
    events:rows.filter(row=>kinds[request.view]?.includes(row.kind)&&(!request.coordinates||request.coordinates.includes(row.tags.find(tag=>tag[0]==="a")?.[1]??""))
      &&(request.since===undefined||row.created_at>=request.since)&&(request.until===undefined||row.created_at<=request.until))}));
  const gitQuery=vi.fn(async(request:ProjectsGitQueryRequest):Promise<ProjectsGitQueryResponse>=>
    request.view===ProjectsGitQueryRequestView.Snapshot?snapshot:request.view===ProjectsGitQueryRequestView.Diff?diff
      :{view:ProjectsGitQueryRequestView.FileContent,content:"Plan line one"});
  const host:ProjectsHost={scopeKey:"tenant:human",query,...(git?{git:createProjectsGitHost(gitQuery)}:{})};
  return {host,gitQuery,review,projectId:`30621:${owner}:project`,repositoryId:`${owner}:repo`};
}

async function mount(f:ReturnType<typeof fixture>,target:ProjectWorkItemTarget){
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  const pulse:PulseHost={scopeKey:f.host.scopeKey,pubkey:viewer,query:async()=>[],publish:vi.fn(),copy:vi.fn(),startDm:vi.fn(),mediaUrl:url=>url,
    renderComposer:()=>null,renderContent:content=><p data-testid="rendered-content">{content}</p>};
  const opened=vi.fn();
  const ui=await render(<><div id="app-top-chrome-content"/><PlatformProvider client={createBffClient({send:async()=>({status:200,body:{items:[]}})})} locale="en">
    <QueryClientProvider client={cache}><TooltipProvider>
      <ProjectsView host={f.host} selectedProjectId={f.projectId} workItemTarget={target} onSelectedProjectChange={opened}
        renderWorkItems={children=><PulseHostProvider host={pulse}>{children}</PulseHostProvider>}/>
    </TooltipProvider></QueryClientProvider></PlatformProvider></>);
  return {ui,opened};
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
    expect([...ui.querySelectorAll('[role="tab"]')].map(tab=>tab.textContent)).toEqual(["Overview","Files","Commits","Tasks","Review"]);
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
