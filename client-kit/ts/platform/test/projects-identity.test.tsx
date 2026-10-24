// DD-157(8), .design/20 §1/§9/§13.6: Projects shows assignments from their t/p tags with Kailo
// names, and only vouched identities (Tenant member directory, Workspace Agent author directory)
// keep their kind:0 name and picture.
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {npubEncode} from "nostr-tools/nip19";
import {createBffClient} from "../src/client";
import {setLocale,translateCurrent,type PlatformLocale} from "../src/i18n";
import {PlatformProvider} from "../src/react/context";
import {PulseHostProvider,type PulseHost,type PulseEvent} from "../src/react/pulse/host";
import {TooltipProvider} from "../src/react/sidebar/tooltip";
import {ProjectsView,type ProjectsHost} from "../src/react/projects";
import {eventToProjectIssue} from "../src/react/projects/projectIssues.mjs";
import {ASSIGNMENT_UNKNOWN_LABEL,projectAssignmentText} from "../src/react/projects/projectAssignmentText";
import {trustedProjectProfiles} from "../src/react/projects/useProjectProfiles";
import {truncateNpub} from "../src/react/conversations/pubkey";
import {render} from "./render";

const viewer="a".repeat(64),member="c".repeat(64),agent="d".repeat(64),stranger="e".repeat(64),other="f".repeat(64);
const repository=`30617:${member}:repo`;
const ev=(id:string,kind:number,pubkey:string,tags:string[][],content="",time=20):PulseEvent=>({id:id.repeat(64),kind,pubkey,tags,content,created_at:time});
const issue=ev("1",1621,member,[["a",repository],["subject","Original task"]],"Task body");
const assigned=ev("2",1,member,[["e",issue.id,"","root"],["a",repository],["p",member],["t","assignment"]],`Assigned this task to ${truncateNpub(member)}`,21);
const legacy=ev("3",1,member,[["e",issue.id,"","root"],["a",repository]],`Unassigned ${truncateNpub(member)} from this task`,22);
const spoof=ev("4",1,stranger,[["e",issue.id,"","root"],["a",repository]],"Stranger note",23);
const agentNote=ev("5",1,agent,[["e",issue.id,"","root"],["a",repository]],"Agent note",24);
const t=(key:Parameters<typeof translateCurrent>[0],vars?:Record<string,string|number>)=>translateCurrent(key,vars);

afterEach(()=>vi.restoreAllMocks());
beforeEach(()=>{localStorage.clear();sessionStorage.clear();setLocale("en");
  vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener(){},removeEventListener(){}}));
  vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});
  HTMLElement.prototype.scrollIntoView=vi.fn();
});

describe("assignment comments read from their tags",()=>{
  it("keeps the t/p assignment facts on the parsed comment and none on a plain comment",()=>{
    const parsed=eventToProjectIssue(issue,[],[assigned,legacy,spoof]);
    expect(parsed.comments.map(comment=>comment.assignment)).toEqual([{operation:"assign",assignees:[member]},null,null]);
    expect(parsed.assignees).toEqual([member]);
  });
  it("names the tagged assignee with the Kailo label, never the stored npub text",()=>{
    setLocale("zh-CN");
    const [comment]=eventToProjectIssue(issue,[],[assigned]).comments;
    expect(projectAssignmentText(comment!,t,()=>"seam-verifier")).toBe("已将此任务分配给seam-verifier");
    setLocale("en");
    expect(projectAssignmentText(comment!,t,()=>"seam-verifier")).toBe("Assigned this task to seam-verifier");
  });
  it("reads an untagged legacy sentence only by the stated rule",()=>{
    const text=(content:string,candidates:string[]=[])=>projectAssignmentText({content,assignment:null},t,pubkey=>`name:${pubkey.slice(0,1)}`,candidates);
    // A shortened npub resolves only to exactly one person on the same task.
    expect(text(`Assigned this task to ${truncateNpub(member)}`,[member,viewer])).toBe("Assigned this task to name:c");
    expect(text(`Assigned this task to ${truncateNpub(member)}`,[viewer])).toBe("Assigned this task to Unknown member");
    // A whole npub or hex key decodes to its identity.
    expect(text(`Unassigned ${npubEncode(other)} from this task`)).toBe("Unassigned name:f from this task");
    expect(text(`Assigned this task to ${other}`)).toBe("Assigned this task to name:f");
    // Any other key-shaped label is never shown.
    expect(text("Assigned this task to npub1broken…zzzz")).toBe("Assigned this task to Unknown member");
    // A readable label the signer chose stays; the writer's unknown fallback is localized.
    expect(text("Assigned this task to Original Human")).toBe("Assigned this task to Original Human");
    setLocale("zh-CN");
    expect(text(`Assigned this task to ${ASSIGNMENT_UNKNOWN_LABEL}`)).toBe("已将此任务分配给未知成员");
    // Anything else is an ordinary comment.
    expect(text("Assigned this task to someone\nand more")).toBeNull();
    expect(text("Please assign this task")).toBeNull();
  });
});

describe("Projects identities are vouched by Kailo directories",()=>{
  const claimed={
    [member]:{displayName:"",avatarUrl:"/api/v1/profile/media/member",nip05Handle:null,ownerPubkey:null},
    [agent]:{displayName:null,avatarUrl:"/api/v1/profile/media/agent",nip05Handle:null,ownerPubkey:null},
    [stranger]:{displayName:"Spoofed",avatarUrl:"/api/v1/profile/media/bee",nip05Handle:"spoof@example.test",ownerPubkey:null},
  };
  const directory={members:new Map([[member,{displayName:"seam-verifier"}]]),agents:new Map([[agent,{displayName:"Research Agent"}]])};
  it("keeps a member's own picture with the directory name, an Agent's persona and nothing for a stranger",()=>{
    const profiles=trustedProjectProfiles([member,agent,stranger],claimed,directory);
    expect(profiles[member]).toMatchObject({displayName:"seam-verifier",avatarUrl:"/api/v1/profile/media/member",isAgent:false});
    expect(profiles[agent]).toMatchObject({displayName:"Research Agent",avatarUrl:"/api/v1/profile/media/agent",isAgent:true});
    expect(profiles[stranger]).toBeUndefined();
  });
  it("vouches for no one when the directories could not be read",()=>{
    expect(trustedProjectProfiles([member,stranger],claimed,{members:new Map(),agents:new Map()})).toEqual({});
  });
});

async function mount(locale:PlatformLocale){
  setLocale(locale);
  const rows=[ev("8",30617,member,[["d","repo"],["name","Original repo"]]),ev("9",30621,member,[["d","project"],["name","Original project"],["description","Project body"],["a",repository]]),
    issue,assigned,legacy,spoof,agentNote];
  const kinds:Record<string,number[]>={PROJECTS:[30621],REPOSITORIES:[30617],DELETIONS:[5],WORK_ITEMS:[1618,1621],WORK_ITEM_ACTIVITY:[1,1619,1630,1631,1632,1633]};
  const host={scopeKey:"tenant:human",query:vi.fn<ProjectsHost["query"]>(async request=>({pubkey:viewer,limit:20,bindingVersion:3,
    events:rows.filter(row=>kinds[request.view]?.includes(row.kind)&&(!request.coordinates||request.coordinates.includes(row.tags.find(tag=>tag[0]==="a")?.[1]??"")))}))} as ProjectsHost;
  const profileRows=[ev("6",0,member,[],JSON.stringify({display_name:"",picture:"https://relay.test/media/bee.png"})),
    ev("7",0,stranger,[],JSON.stringify({display_name:"Spoofed",picture:"https://relay.test/media/bee.png"}))];
  const pulse:PulseHost={scopeKey:host.scopeKey,pubkey:viewer,query:async request=>profileRows.filter(row=>(request as {authors?:string[]}).authors?.includes(row.pubkey)),
    publish:vi.fn(),copy:vi.fn(),startDm:vi.fn(),mediaUrl:url=>url,renderComposer:()=>null,renderContent:content=><p>{content}</p>};
  const send=vi.fn(async (request:{path:string})=>({status:200,body:
    request.path.startsWith("/api/v1/conversation-participants")?{items:[{principalId:"seam",displayName:"seam-verifier",pubkeys:[member]}],maxParticipants:50}
    :request.path==="/api/v1/workspaces"?[{id:"w1",name:"Workspace",isMember:true}]
    :request.path==="/api/v1/workspaces/w1/agent-authors"?{agents:[{agentPubkey:agent,installationResourceId:"i1",ownerPrincipalId:"seam",agentDisplayName:"Research Agent"}]}
    :{}}));
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  const ui=await render(<PlatformProvider client={createBffClient({send})} locale={locale}><QueryClientProvider client={cache}><TooltipProvider>
    <ProjectsView host={host} onSelectedProjectChange={vi.fn()} renderWorkItems={children=><PulseHostProvider host={pulse}>{children}</PulseHostProvider>}/>
  </TooltipProvider></QueryClientProvider></PlatformProvider>);
  return {ui,send,cache};
}
const cards=(ui:HTMLElement)=>[...ui.querySelectorAll('[data-testid="projects-activity-card"]')].map(card=>card.textContent??"");

describe("Projects Activity names people the Kailo way",()=>{
  it.each(["zh-CN","en"] as const)("shows assignments and authors with Kailo names and never a key (%s)",async locale=>{
    const {ui,send,cache}=await mount(locale);
    await vi.waitFor(()=>expect(cards(ui).some(text=>text.includes("Research Agent"))).toBe(true));
    const text=cards(ui);
    const zh=locale==="zh-CN";
    expect(text.find(card=>card.includes(zh?"已将此任务分配给seam-verifier":"Assigned this task to seam-verifier"))).toContain("seam-verifier");
    expect(text.some(card=>card.includes(zh?"已取消seam-verifier对此任务的分配":"Unassigned seam-verifier from this task"))).toBe(true);
    const strangerCard=text.find(card=>card.includes("Stranger note"))!;
    expect(strangerCard).toContain(zh?"未知成员":"Unknown member");
    expect(strangerCard).not.toContain("Spoofed");
    expect(text.join(" ")).not.toMatch(/npub1|Assigned this task to npub/);
    expect(send.mock.calls.map(([request])=>request.path)).toEqual(expect.arrayContaining(["/api/v1/conversation-participants","/api/v1/workspaces","/api/v1/workspaces/w1/agent-authors"]));
    cache.clear();
  });
});
