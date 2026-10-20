// REQ-24, DD-80, DD-118 / V-SCN-89, V-SCN-93: the restored Buzz 779af8886caae1317b4de962082429867ab61503
// project detail screen (WorkspaceTabs Channels/Contributors, repository context rail, routing and
// unavailable states) and repository/channel management (useAttachProjectRepository,
// useAddProjectRepository, useBindProjectRepositoryChannel, useAddProjectChannel link step) over
// the Projects publication host.
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {ProjectsGitQueryRequestView,type ProjectsGitQueryResponse} from "@client-kit/contracts";
import {createBffClient} from "../src/client";
import {setLocale} from "../src/i18n";
import {PlatformProvider} from "../src/react/context";
import {PulseHostProvider,type PulseHost,type PulseEvent} from "../src/react/pulse/host";
import {TooltipProvider} from "../src/react/sidebar/tooltip";
import {ProjectsView,createProjectsGitHost,type ProjectsHost} from "../src/react/projects";
import {loadProjectDirectory} from "../src/react/projects/projectEnumeration";
import type {ProjectWorkItemTarget} from "../src/react/projects/projectWorkItems";
import {addProjectRepository,attachProjectRepository,bindProjectRepositoryChannel,linkProjectChannel,
  ProjectManagementError,ProjectManagementPending} from "../src/react/projects/projectRepositoryManagement";
import {TransportError} from "../src/transport";
import {render} from "./render";

const viewer="a".repeat(64),other="b".repeat(64);
const home="12345678-1234-4234-8234-123456789001",related="12345678-1234-4234-8234-123456789002";
const hex=(value:number)=>value.toString(16).padStart(64,"0");
const signal=()=>new AbortController().signal;
const KINDS:Record<string,number[]>={PROJECTS:[30621],REPOSITORIES:[30617],DELETIONS:[5],WORK_ITEMS:[1618,1621],WORK_ITEM_ACTIVITY:[1,1619,1630,1631,1632,1633],REPOSITORY_STATES:[30618]};
const dtag=(event:PulseEvent)=>event.tags.find(tag=>tag[0]==="d")?.[1];

/** A Relay-like store: replaceable announcements keep their newest version. */
function store(rows:PulseEvent[]){
  const current=()=>rows.filter(row=>!(row.kind>=30000&&row.kind<40000)||!rows.some(candidate=>candidate!==row&&candidate.kind===row.kind
    &&candidate.pubkey===row.pubkey&&dtag(candidate)===dtag(row)&&(candidate.created_at>row.created_at||candidate.created_at===row.created_at&&candidate.id<row.id)));
  const coordinate=(row:PulseEvent)=>row.kind===30618?`30617:${row.pubkey}:${dtag(row)}`:row.tags.find(tag=>tag[0]==="a")?.[1]??"";
  return vi.fn<ProjectsHost["query"]>(async request=>({pubkey:viewer,limit:20,bindingVersion:1,
    events:current().filter(row=>KINDS[request.view]?.includes(row.kind)&&(!request.coordinates||request.coordinates.includes(coordinate(row)))
      &&(request.since===undefined||row.created_at>=request.since)&&(request.until===undefined||row.created_at<=request.until))}));
}

function managementFixture(){
  let next=500;
  const rows:PulseEvent[]=[
    {id:hex(100),pubkey:viewer,kind:30621,created_at:10,content:"",tags:[["d","garden"],["name","Garden"],["buzz-channel",home],["a",`30617:${viewer}:garden`]]},
    {id:hex(101),pubkey:viewer,kind:30617,created_at:10,content:"",tags:[["d","garden"],["name","Garden"],["buzz-channel",home]]},
    {id:hex(102),pubkey:other,kind:30617,created_at:10,content:"",tags:[["d","shared"],["name","Shared"],["buzz-channel",home]]},
    {id:hex(103),pubkey:viewer,kind:30617,created_at:10,content:"",tags:[["d","solo"],["name","Solo"]]},
  ];
  // Core's patch of the verified current head (collab-bridge projects.rs::announcement_patch_builder).
  const publish=vi.fn<NonNullable<ProjectsHost["publish"]>>(async(request,_key,_observe,observation)=>{
    const head=request.targetEventId?rows.find(row=>row.id===request.targetEventId):undefined;
    const created_at=Math.max(20,(head?.created_at??0)+1);
    let tags:string[][];let kind:number;let content=head?.content??"";
    if(request.operation==="ATTACH_REPOSITORY"){
      kind=30621;
      const members=[...head!.tags.filter(tag=>tag[0]==="a").map(tag=>tag[1]!),request.repositoryAddress!].sort();
      tags=[...head!.tags.filter(tag=>tag[0]!=="a"),...members.map(address=>["a",address])];
    }else if(request.operation==="BIND_REPOSITORY_CHANNEL"){
      kind=30617;tags=[...head!.tags.filter(tag=>tag[0]!=="buzz-channel"),["buzz-channel",request.workspaceId!]];
    }else if(request.operation==="ADD_PROJECT_CHANNEL"){
      kind=30621;tags=[...head!.tags,["buzz-related-channel",request.workspaceId!]];
    }else if(request.operation==="CREATE_REPOSITORY"){
      kind=30617;content="";
      tags=[["d",request.name!.toLowerCase().replace(/[^a-z0-9]+/g,"-")],["name",request.name!],["buzz-channel",request.workspaceId!],
        ...(request.cloneUrl?[["clone",request.cloneUrl]]:[])];
    }else throw new Error(`unexpected ${request.operation}`);
    const event={id:hex(next++),pubkey:viewer,kind,created_at,content,tags};
    observation?.onPrepared(event.id);rows.push(event);return {eventId:event.id};
  });
  const completePublication=vi.fn();
  const host:ProjectsHost={scopeKey:"tenant:viewer",query:store(rows),publish,completePublication};
  return {host,publish,rows,completePublication};
}

beforeEach(()=>{localStorage.clear();sessionStorage.clear();setLocale("en");
  vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener(){},removeEventListener(){}}));
  Object.defineProperty(document,"fonts",{configurable:true,value:{ready:Promise.resolve()}});
  vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});
  HTMLElement.prototype.scrollIntoView=vi.fn();
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("restored repository and project channel management",()=>{
  async function garden(f:ReturnType<typeof managementFixture>){
    const directory=await loadProjectDirectory(f.host,signal());
    return {directory,project:directory.projects.find(project=>project.dtag==="garden")!};
  }

  it("attaches an existing repository to the owned live head and reads back the original patch",async()=>{
    const f=managementFixture();const {directory,project}=await garden(f);
    const shared=directory.projects.flatMap(candidate=>candidate.repositories).find(repository=>repository.dtag==="shared")!;
    await attachProjectRepository(f.host,project,shared,signal());
    expect(f.publish).toHaveBeenCalledExactlyOnceWith({operation:"ATTACH_REPOSITORY",targetEventId:hex(100),repositoryAddress:`30617:${other}:shared`},
      expect.any(String),false,expect.objectContaining({onPrepared:expect.any(Function)}));
    const after=await garden(f);
    expect(after.project.repositoryAddresses).toEqual([`30617:${viewer}:garden`,`30617:${other}:shared`]);
    expect(f.completePublication).toHaveBeenCalledOnce();expect(sessionStorage.length).toBe(0);
    await expect(attachProjectRepository(f.host,after.project,shared,signal())).rejects.toBeInstanceOf(ProjectManagementError);
    expect(f.publish).toHaveBeenCalledOnce();
  });

  it("adds a new repository as the project member first, then its announcement on the access channel",async()=>{
    const f=managementFixture();const {project}=await garden(f);
    const result=await addProjectRepository(f.host,{access:{workspaceId:home,channelId:home},name:"Mobile App",cloneUrl:"https://relay.example/mobile.git",project},signal());
    expect(f.publish.mock.calls.map(call=>call[0])).toEqual([
      {operation:"ATTACH_REPOSITORY",targetEventId:hex(100),repositoryAddress:`30617:${viewer}:mobile-app`},
      {operation:"CREATE_REPOSITORY",workspaceId:home,name:"Mobile App",cloneUrl:"https://relay.example/mobile.git"},
    ]);
    expect(result.repositoryId).toBe(`${viewer}:mobile-app`);
    expect((await garden(f)).project.repositories.map(repository=>repository.dtag)).toContain("mobile-app");
    // The original cross-project clobber guard: an existing owned coordinate is never overwritten.
    await expect(addProjectRepository(f.host,{access:{workspaceId:home,channelId:home},name:"Solo",project:(await garden(f)).project},signal()))
      .rejects.toMatchObject({key:"projects.manage.repositoryExists"});
    await expect(addProjectRepository(f.host,{access:{workspaceId:home,channelId:home},name:"Other",cloneUrl:"http://relay.example/x.git",project},signal()))
      .rejects.toMatchObject({key:"projects.manage.cloneUrlInvalid"});
    expect(f.publish).toHaveBeenCalledTimes(2);
  });

  it("keeps an UNKNOWN attach on its exact request and key and only observes it again",async()=>{
    const f=managementFixture();const {directory,project}=await garden(f);
    const shared=directory.projects.flatMap(candidate=>candidate.repositories).find(repository=>repository.dtag==="shared")!;
    f.publish.mockRejectedValueOnce(new TransportError("lost ACK"));
    await expect(attachProjectRepository(f.host,project,shared,signal())).rejects.toBeInstanceOf(ProjectManagementPending);
    expect(sessionStorage.length).toBe(1);
    await attachProjectRepository(f.host,project,shared,signal());
    expect(f.publish).toHaveBeenCalledTimes(2);
    expect(f.publish.mock.calls[1]?.[0]).toEqual(f.publish.mock.calls[0]?.[0]);
    expect(f.publish.mock.calls[1]?.[1]).toBe(f.publish.mock.calls[0]?.[1]);
    expect(f.publish.mock.calls[1]?.[2]).toBe(true);
    expect(sessionStorage.length).toBe(0);
  });

  it("binds a repository to another access channel and links a project channel by its Workspace",async()=>{
    const f=managementFixture();const {project}=await garden(f);
    const repository=project.repositories.find(candidate=>candidate.dtag==="garden")!;
    await bindProjectRepositoryChannel(f.host,repository,{workspaceId:related,channelId:related},signal());
    expect(f.publish.mock.calls[0]?.[0]).toEqual({operation:"BIND_REPOSITORY_CHANNEL",targetEventId:hex(101),workspaceId:related});
    expect((await garden(f)).project.repositories.find(candidate=>candidate.dtag==="garden")?.channelId).toBe(related);
    await linkProjectChannel(f.host,(await garden(f)).project,{workspaceId:related,channelId:related},signal());
    expect(f.publish.mock.calls[1]?.[0]).toEqual({operation:"ADD_PROJECT_CHANNEL",targetEventId:hex(100),workspaceId:related});
    expect((await garden(f)).project.relatedChannelIds).toEqual([related]);
    expect(sessionStorage.length).toBe(0);
  });
});

const commit={hash:"1".repeat(40),shortHash:"1111111",authorName:"Ada",authorEmail:"ada@example.test",timestamp:1_700_000_000,subject:"Initial import"};
const snapshot:ProjectsGitQueryResponse={view:ProjectsGitQueryRequestView.Snapshot,snapshot:{
  latestCommit:commit,commits:[commit],contributors:[{name:"Ada",email:"ada@example.test",commitCount:1,lastCommitAt:commit.timestamp}],
  files:[{path:"README.md",kind:"file",size:24,previewContent:"# Hello\n\nReadme body text",lastChangedAt:commit.timestamp,latestCommit:commit}]}};

function detailFixture(){
  const repository=`30617:${other}:repo`;
  const rows:PulseEvent[]=[
    {id:hex(8),pubkey:other,kind:30617,created_at:20,content:"",tags:[["d","repo"],["name","Original repo"]]},
    {id:hex(9),pubkey:other,kind:30621,created_at:20,content:"",tags:[["d","project"],["name","Original project"],["a",repository]]},
    {id:hex(2),pubkey:other,kind:1618,created_at:20,content:"Review body",tags:[["a",repository],["subject","Original review"],["c","f".repeat(40)],["branch-name","feature"],["target-branch","main"]]},
  ];
  const gitQuery=vi.fn(async():Promise<ProjectsGitQueryResponse>=>snapshot);
  const host:ProjectsHost={scopeKey:"tenant:viewer",query:store(rows),git:createProjectsGitHost(gitQuery)};
  return {host,projectId:`30621:${other}:project`,repositoryId:`${other}:repo`};
}

async function mountDetail(f:ReturnType<typeof detailFixture>,target?:ProjectWorkItemTarget){
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  const hit={eventId:hex(77),content:`buzz://pr?owner=${other}&d=repo`,kind:9,pubkey:other,channelId:home,channelName:"design",createdAt:1_700_000_100,score:1};
  const pulse:PulseHost={scopeKey:f.host.scopeKey,pubkey:viewer,query:async()=>[],publish:vi.fn(),copy:vi.fn(),startDm:vi.fn(),mediaUrl:url=>url,
    renderComposer:()=>null,renderContent:content=><p>{content}</p>,
    discussions:{read:async()=>({hits:[hit],found:1,channels:[]}),openHit:vi.fn(),openChannel:vi.fn(),renderPreview:content=><span>{content}</span>}};
  const opened=vi.fn();
  const ui=await render(<><div id="app-top-chrome-content"/><PlatformProvider client={createBffClient({send:async()=>({status:200,body:{items:[]}})})} locale="en">
    <QueryClientProvider client={cache}><TooltipProvider><PulseHostProvider host={pulse}>
      <ProjectsView host={f.host} selectedProjectId={f.projectId} workItemTarget={target} onSelectedProjectChange={opened}
        renderWorkItems={children=><PulseHostProvider host={pulse}>{children}</PulseHostProvider>}/>
    </PulseHostProvider></TooltipProvider></QueryClientProvider></PlatformProvider></>);
  return {ui,opened};
}

describe("restored project detail screen",()=>{
  it("opens the repository surface for a project without a home binding, with the original rail",async()=>{
    const f=detailFixture();
    const {ui}=await mountDetail(f);
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="project-readme"]')?.textContent).toContain("Readme body text"));
    expect([...ui.querySelectorAll('[role="tab"]')].map(tab=>tab.textContent)).toEqual(["Overview","Files","Commits","Tasks","Review","Channels","Contributors"]);
    const rail=ui.querySelector('[data-testid="project-repository-actions-panel"]')!;
    expect(rail.querySelector("h2")?.textContent).toBe("Original repo");
    expect(rail.querySelector('[data-testid="project-repository-branch-trigger"]')?.textContent).toBe("main");
    expect([...rail.querySelectorAll("button")].some(button=>button.textContent==="Fetch")).toBe(true);
    // Only the project owner can add repositories; the viewer is not this project's signer.
    expect(rail.querySelector<HTMLButtonElement>('[data-testid="add-project-repository"]')?.disabled).toBe(true);
    expect(rail.querySelector('[data-testid="manage-project-repository-access"]')).toBeNull();
    expect(rail.querySelector('[data-testid="project-repository-file-count"]')?.textContent).toBe("1");
  });

  it("restores the Contributors and Channels tabs over the snapshot and the discussion search",async()=>{
    const f=detailFixture();
    const contributors=await mountDetail(f,{repositoryId:f.repositoryId,tab:"contributors"});
    await vi.waitFor(()=>expect(contributors.ui.querySelectorAll('[data-testid="project-contributor-row"]')).toHaveLength(2));
    expect([...contributors.ui.querySelectorAll('[data-testid="project-contributor-commit-count"]')].map(node=>node.textContent)).toContain("1");
    const channels=await mountDetail(f,{repositoryId:f.repositoryId,tab:"channels"});
    await vi.waitFor(()=>expect(channels.ui.querySelector('[data-testid="project-channel-row"]')?.textContent).toContain("#design"));
  });

  it("shows the original unavailable state for a project without readable repositories",async()=>{
    const rows:PulseEvent[]=[{id:hex(9),pubkey:other,kind:30621,created_at:20,content:"",tags:[["d","project"],["name","Empty project"],["a",`30617:${other}:missing`]]}];
    const f={host:{scopeKey:"tenant:viewer",query:store(rows)} as ProjectsHost,projectId:`30621:${other}:project`,repositoryId:""};
    const {ui}=await mountDetail(f);
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="project-detail-unavailable"]')?.textContent).toContain("This project does not have any available repositories yet."));
    expect(ui.querySelector('[data-testid="project-unavailable-repository"]')?.textContent).toContain("missing");
  });
});
