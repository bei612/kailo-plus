// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/PullRequestReviewCard.tsx lifecycle actions and
// pullRequestReviews.ts::updateProjectPullRequestStatus through the governed host.
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {act} from "react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {toast} from "sonner";
import {createBffClient} from "../src/client";
import {setLocale} from "../src/i18n";
import {PlatformProvider} from "../src/react/context";
import {PulseHostProvider,type PulseHost,type PulseEvent} from "../src/react/pulse/host";
import {TooltipProvider} from "../src/react/sidebar/tooltip";
import {loadProjectWorkItems,ProjectInboxDetail,type ProjectsHost} from "../src/react/projects";
import {buildProjectPullRequestStatus,publishProjectPullRequestStatus} from "../src/react/projects/pullRequestStatus";
import {TransportError} from "../src/transport";
import {render,click} from "./render";

const viewer="a".repeat(64),owner="b".repeat(64),other="d".repeat(64),repository=`30617:${owner}:repo`;
const event=(id:string,kind:number,tags:string[][],content="",time=20,pubkey=owner):PulseEvent=>({id:id.repeat(64),kind,pubkey,tags,content,created_at:time});

function fixture(reviewAuthor=viewer){
  const review=event("2",1618,[["a",repository],["subject","Viewer review"],["c","f".repeat(40)],["branch-name","feature"],["target-branch","main"]],"Review body",20,reviewAuthor);
  const rows=[event("8",30617,[["d","repo"],["name","Original repo"],["clone","https://example.test/repo.git"]]),
    event("9",30621,[["d","project"],["name","Original project"],["a",repository]]),review];
  const kinds:Record<string,number[]>={PROJECTS:[30621],REPOSITORIES:[30617],DELETIONS:[5],WORK_ITEMS:[1618,1621],WORK_ITEM_ACTIVITY:[1,1619,1630,1631,1632,1633]};
  const query=vi.fn<ProjectsHost["query"]>(async request=>({pubkey:viewer,limit:20,bindingVersion:3,
    events:rows.filter(row=>kinds[request.view]?.includes(row.kind)&&(!request.coordinates||request.coordinates.includes(row.tags.find(tag=>tag[0]==="a")?.[1]??""))
      &&(request.since===undefined||row.created_at>=request.since)&&(request.until===undefined||row.created_at<=request.until))}));
  const host:ProjectsHost={scopeKey:"tenant:human",query};
  return {review,rows,host};
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
const menuItem=(label:string)=>Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(entry=>entry.textContent?.trim()===label);
async function openMenu(root:ParentNode){
  const trigger=button(root,"More review actions")!;
  await act(async()=>{trigger.focus();trigger.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));});
  await vi.waitFor(()=>expect(document.querySelector('[role="menu"]')).not.toBeNull());
}

beforeEach(()=>{setLocale("en");localStorage.clear();sessionStorage.clear();
  vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener(){},removeEventListener(){}}));
  Object.defineProperty(document,"fonts",{configurable:true,value:{ready:Promise.resolve()}});
  vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});
  HTMLElement.prototype.scrollIntoView=vi.fn();
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("original review lifecycle actions",()=>{
  it("builds the original lifecycle event shape for open, draft and closed",()=>{
    for(const [status,kind] of [["open",1630],["draft",1633],["closed",1632]] as const)
      expect(buildProjectPullRequestStatus({owner,repoAddress:repository},{id:"2".repeat(64),author:viewer},status)).toEqual({kind,content:"",
        tags:[["e","2".repeat(64),"","root"],["a",repository],["p",owner],["p",viewer]]});
    // Owner reviewing their own repository is one recipient, as with the original Set.
    expect(buildProjectPullRequestStatus({owner,repoAddress:repository},{id:"2".repeat(64),author:owner},"closed").tags)
      .toEqual([["e","2".repeat(64),"","root"],["a",repository],["p",owner]]);
  });

  it("lets the review author close it through the typed host and confirms only the exact readback",async()=>{
    const f=fixture();const success=vi.spyOn(toast,"success").mockImplementation(()=>"ok");
    f.host.publish=vi.fn<NonNullable<ProjectsHost["publish"]>>(async(request,_key,observeOnly,observation)=>{
      expect(request).toEqual({operation:"SET_PULL_REQUEST_STATUS",targetEventId:f.review.id,pullRequestStatus:"closed"});
      expect(observeOnly).toBe(false);
      const template=buildProjectPullRequestStatus({owner,repoAddress:repository},{id:f.review.id,author:viewer},"closed");
      const created=event("c",template.kind,template.tags,template.content,40,viewer);
      observation?.onPrepared(created.id);f.rows.push(created);return {eventId:created.id};
    });
    const ui=await mount(f);
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="project-pull-request-actions"]')).not.toBeNull());
    expect(button(ui,"Ready for review")).toBeUndefined();expect(button(ui,"Reopen review")).toBeUndefined();
    await openMenu(ui);
    expect(menuItem("Convert to draft")).toBeDefined();
    await act(async()=>{menuItem("Close review")!.click();});
    await vi.waitFor(()=>expect(success).toHaveBeenCalledWith("Review closed."));
    expect(f.host.publish).toHaveBeenCalledTimes(1);
    await vi.waitFor(()=>expect(button(ui,"Reopen review")).toBeDefined());
    expect(localStorage.length).toBe(0);
  });

  it("hides lifecycle actions from anyone but the review author or repository owner",async()=>{
    const f=fixture(other);f.host.publish=vi.fn();
    const ui=await mount(f);
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="project-pull-request-detail"]')).not.toBeNull());
    expect(ui.querySelector('[data-testid="project-pull-request-actions"]')).toBeNull();
    const workItem=await item(f);
    await expect(publishProjectPullRequestStatus(f.host,workItem.project.id,workItem.repository,workItem.pullRequest,viewer,"closed",new AbortController().signal,()=>{}))
      .rejects.toThrow("Failed to update status.");
    expect(f.host.publish).not.toHaveBeenCalled();
  });

  it("keeps an UNKNOWN lifecycle write on its exact intent and resends only that intent",async()=>{
    const f=fixture();const workItem=await item(f);
    const publish=vi.fn<NonNullable<ProjectsHost["publish"]>>(async(_request,_key,_observe,observation)=>{observation?.onPrepared("c".repeat(64));throw new TransportError("lost ACK");});
    f.host.publish=publish;
    const send=(status:"closed"|"draft")=>publishProjectPullRequestStatus(f.host,workItem.project.id,workItem.repository,workItem.pullRequest,viewer,status,new AbortController().signal,()=>{});
    await expect(send("closed")).rejects.toThrow();
    await expect(send("draft")).rejects.toThrow("not confirmed");expect(publish).toHaveBeenCalledTimes(1);
    const ui=await mount(f);
    await vi.waitFor(()=>expect(button(ui,"Re-check status change")).toBeDefined());
    const template=buildProjectPullRequestStatus({owner,repoAddress:repository},{id:f.review.id,author:viewer},"closed");
    f.rows.push(event("c",template.kind,template.tags,"",40,viewer));
    publish.mockImplementation(async()=>({eventId:"c".repeat(64)}));
    await click(button(ui,"Re-check status change")!);
    await vi.waitFor(()=>expect(publish).toHaveBeenCalledTimes(2));
    expect(publish.mock.calls[1]?.[0]).toEqual(publish.mock.calls[0]?.[0]);
    expect(publish.mock.calls[1]?.[1]).toBe(publish.mock.calls[0]?.[1]);expect(publish.mock.calls[1]?.[2]).toBe(true);
    await vi.waitFor(()=>expect(localStorage.length).toBe(0));
  });
});
