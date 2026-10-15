import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {createBffClient} from "../src/client";
import {setLocale,type PlatformLocale} from "../src/i18n";
import {PlatformProvider} from "../src/react/context";
import {PulseHostProvider,type PulseHost,type PulseEvent} from "../src/react/pulse/host";
import {TooltipProvider} from "../src/react/sidebar/tooltip";
import {ProjectsView,type ProjectsHost} from "../src/react/projects";
import {render,click} from "./render";

const viewer="a".repeat(64),author="b".repeat(64),repository=`30617:${author}:repo`;
const event=(id:string,kind:number,tags:string[][],content="",time=20):PulseEvent=>({id:id.repeat(64),kind,pubkey:author,tags,content,created_at:time});
function fixture(time=20){
  const issue=event("1",1621,[["a",repository],["subject","Original task"],["p",viewer]],"Complete task body",time);
  const review=event("2",1618,[["a",repository],["subject","Original review"],["p",viewer],["commit","f".repeat(40)]],"Complete review body",time);
  const rows=[
    event("8",30617,[["d","repo"],["name","Original repo"],["clone","https://example.test/repo.git"]]),
    event("9",30621,[["d","project"],["name","Original project"],["description","Project body"],["a",repository]]),
    issue,review,
    event("3",1,[["a",repository],["e",issue.id],["p",viewer]],"Original comment",time+1),
    event("e",1619,[["a",repository],["E",review.id],["c","e".repeat(40)]],"Original review update",time+2),
  ];
  const kinds:Record<string,number[]>={PROJECTS:[30621],REPOSITORIES:[30617],DELETIONS:[5],WORK_ITEMS:[1618,1621],WORK_ITEM_ACTIVITY:[1,1619,1630,1631,1632,1633]};
  let denied=false;
  const query=vi.fn<ProjectsHost["query"]>(async request=>{
    if(denied&&request.view==="WORK_ITEMS")throw new Error("Current scope refused");
    return {pubkey:viewer,limit:20,bindingVersion:3,
      events:rows.filter(row=>kinds[request.view]?.includes(row.kind)&&(!request.coordinates||request.coordinates.includes(row.tags.find(tag=>tag[0]==="a")?.[1]??""))&&
        (request.since===undefined||row.created_at>=request.since)&&(request.until===undefined||row.created_at<=request.until))};
  });
  return {issue,review,host:{scopeKey:"tenant:human",query} as ProjectsHost,query,deny:(value:boolean)=>{denied=value;}};
}
async function mount(f:ReturnType<typeof fixture>,locale:PlatformLocale="en"){
  setLocale(locale);
  const opened=vi.fn();
  const pulse:PulseHost={scopeKey:f.host.scopeKey,pubkey:viewer,query:async()=>[],publish:vi.fn(),copy:vi.fn(),startDm:vi.fn(),mediaUrl:url=>url,
    renderComposer:()=>null,renderContent:content=><p>{content}</p>};
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  const ui=await render(<PlatformProvider client={createBffClient({send:async()=>({status:200,body:{}})})} locale={locale}><QueryClientProvider client={cache}><TooltipProvider>
    <ProjectsView host={f.host} onSelectedProjectChange={opened}
      renderWorkItems={(children,pubkey)=>{expect(pubkey).toBe(viewer);return <PulseHostProvider host={pulse}>{children}</PulseHostProvider>;}}/>
  </TooltipProvider></QueryClientProvider></PlatformProvider>);
  return {ui,opened,pulse,cache};
}
const cards=(ui:HTMLElement)=>[...ui.querySelectorAll('[data-testid="projects-activity-card"]')].map(card=>card.textContent);

afterEach(()=>vi.restoreAllMocks());
beforeEach(()=>{localStorage.clear();sessionStorage.clear();
  vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener(){},removeEventListener(){}}));
  vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});
  HTMLElement.prototype.scrollIntoView=vi.fn();
});

describe("original Projects Activity overview",()=>{
  it("opens on the original Activity section with the digest, week groups and governed work-item targets",async()=>{
    const f=fixture();const {ui,opened,pulse,cache}=await mount(f);
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="projects-activity-timeline"]')).not.toBeNull());
    expect(ui.querySelector('[data-testid="projects-section-all"]')?.getAttribute("aria-pressed")).toBe("true");
    expect([...ui.querySelectorAll('[data-testid^="projects-section-"]')].map(node=>node.getAttribute("aria-label"))).toEqual(["Activity","Projects","Repositories","Tasks","Reviews"]);
    expect(ui.querySelector('[data-testid="projects-page-header"]')?.textContent).toBe("Projects Activity");
    expect(ui.querySelector('[data-testid="projects-activity-summary"]')?.textContent).toBe("Currently tracking 1 project, 1 task, and 1 review.");
    expect([...ui.querySelectorAll('[data-testid="projects-activity-group"] h3')].map(node=>node.textContent)).toEqual(["Earlier"]);
    const text=cards(ui);
    expect(text).toHaveLength(5);
    expect(text.some(value=>value?.includes("updated a review in")&&value.includes("eeeeeee"))).toBe(true);
    expect(text.some(value=>value?.includes("commented on a task in")&&value.includes("Original comment"))).toBe(true);
    expect(text.some(value=>value?.includes("created a task in")&&value.includes("Backlog"))).toBe(true);
    expect(text.some(value=>value?.includes("opened a review in")&&value.includes("Open"))).toBe(true);
    expect(text.some(value=>value?.includes("created the repository")&&value.includes("Project body"))).toBe(true);
    expect(text.join(" ")).not.toContain("pushed a commit");
    await click(ui.querySelector<HTMLButtonElement>('button[aria-label="Open Original task in Original project"]')!);
    expect(opened).toHaveBeenCalledExactlyOnceWith(`30621:${author}:project`,{repositoryId:`${author}:repo`,issueId:f.issue.id});
    expect(pulse.publish).not.toHaveBeenCalled();expect(f.host.publish).toBeUndefined();cache.clear();
  });
  it("restores the original detached context rail that follows the section and opens its stats",async()=>{
    const f=fixture();const {ui,cache}=await mount(f);
    const rail=()=>ui.querySelector<HTMLElement>('[data-testid="projects-overview-context-rail"]')!;
    const stats=()=>[...ui.querySelectorAll('[data-testid="projects-overview-stat"]')].map(node=>node.textContent);
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="projects-overview-context-panel"]')).not.toBeNull());
    expect(ui.querySelector('[data-testid="projects-overview-layout"]')?.getAttribute("data-project-context-detached")).toBe("true");
    expect(ui.querySelector('[data-testid="projects-overview-content-pod"]')).not.toBeNull();
    expect(rail().style.width).toBe("288px");
    expect(ui.querySelector('[data-testid="projects-overview-context-title"]')?.textContent).toBe("Activity");
    expect(stats()).toEqual(["Projects1","Repositories1","Channels0","Tasks1","Reviews1"]);
    expect(ui.querySelector('[data-testid="projects-overview-people"]')).not.toBeNull();
    await click([...ui.querySelectorAll<HTMLButtonElement>('[data-testid="projects-overview-stat"]')].find(node=>node.textContent==="Tasks1")!);
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="projects-section-issues"]')?.getAttribute("aria-pressed")).toBe("true"));
    expect(ui.querySelector('[data-testid="projects-overview-context-title"]')?.textContent).toBe("Tasks");
    expect(stats()).toEqual(["Tasks1","Active1","Completed0"]);
    // No governed task writer in this host: the original create action is absent, not disabled.
    expect(ui.querySelector('[data-testid="projects-overview-create-issue"]')).toBeNull();
    expect(ui.querySelector('[data-testid="projects-overview-chat-toggle"]')).toBeNull();
    cache.clear();
  });
  it("uses this week's original highlights and Chinese catalog wording",async()=>{
    const now=Math.floor(Date.now()/1_000)-120;
    const f=fixture(now);const {ui,cache}=await mount(f,"zh-CN");
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="projects-activity-timeline"]')).not.toBeNull());
    expect(ui.querySelector('[data-testid="projects-section-all"]')?.getAttribute("aria-label")).toBe("动态");
    expect(ui.querySelector('[data-testid="projects-page-header"]')?.textContent).toBe("项目动态");
    expect(ui.querySelector('[data-testid="projects-activity-summary"]')?.textContent).toBe("本周： 新开 1 个任务、新开 1 个审阅，以及1 个活跃项目。");
    expect([...ui.querySelectorAll('[data-testid="projects-activity-group"] h3')].map(node=>node.textContent)).toEqual(["本周","更早"]);
    expect(cards(ui).some(value=>value?.includes("创建了任务于")&&value.includes("待办"))).toBe(true);
    cache.clear();
  });
  it("groups the original project cards and shows their people and activity distribution from the same read",async()=>{
    localStorage.setItem("buzz.projects.filter","projects");
    const f=fixture();const {ui,cache}=await mount(f);
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="project-activity-bar"]')).not.toBeNull());
    expect([...ui.querySelectorAll('[data-testid="projects-collection-group-label"]')].map(node=>node.textContent)).toEqual(["Other projects"]);
    expect([...ui.querySelectorAll('[data-testid="project-activity-segment"]')].map(node=>node.getAttribute("aria-label"))).toEqual(["2 commits","1 review","1 task"]);
    expect(ui.querySelector('button[aria-label^="View "][aria-label$="profile"]')).not.toBeNull();
    await click(ui.querySelector<HTMLButtonElement>('[data-testid="projects-activity-search"]')!);
    await vi.waitFor(()=>expect(ui.querySelector('option[value="updated"]')).not.toBeNull());
    expect(ui.querySelector<HTMLSelectElement>("select")?.value).toBe("updated");
    cache.clear();
  });
  it("shows the original failure notice instead of an empty timeline and retries the same read",async()=>{
    const f=fixture();f.deny(true);const {ui,cache}=await mount(f);
    await vi.waitFor(()=>expect(ui.querySelector('[role="alert"]')?.textContent).toContain("Could not load project activity."));
    expect(ui.querySelector('[data-testid="projects-activity-timeline"]')).toBeNull();
    expect(ui.textContent).not.toContain("No project activity yet");
    f.deny(false);
    await click([...ui.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent==="Retry")!);
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="projects-activity-timeline"]')).not.toBeNull());
    cache.clear();
  });
});
