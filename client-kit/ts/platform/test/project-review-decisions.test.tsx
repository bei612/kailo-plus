// DD-118(5) review writes restored from Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/projects/ui/PullRequestReviewCard.tsx (Approve + summary dialog),
// pullRequestReviews.ts::submitProjectPullRequestReview, hooks.ts::createProjectPullRequestComment
// ("Request changes" secondary submit and line comments), ProjectPullRequestInlineComments.tsx and
// forum/ui/ForumComposer.tsx's secondary submit menu, all through the governed publication host.
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {act,type ReactNode} from "react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {toast} from "sonner";
import {ErrorClass,ReasonCode} from "@client-kit/contracts";
import {createBffClient} from "../src/client";
import {setLocale} from "../src/i18n";
import {PlatformProvider} from "../src/react/context";
import {PulseHostProvider,type PulseComposerProps,type PulseHost,type PulseEvent} from "../src/react/pulse/host";
import {useComposerSubmitMode} from "../src/react/pulse/ComposerSubmitMode";
import {TooltipProvider} from "../src/react/sidebar/tooltip";
import {loadProjectWorkItems,ProjectInboxDetail,type ProjectsHost} from "../src/react/projects";
import {ProjectPullRequestDetail} from "../src/react/projects/ProjectPullRequestDetail";
import {ProjectPullRequestFilesChangedPanel} from "../src/react/projects/ProjectPullRequestFilesChangedPanel";
import {buildProjectCommentTags,publishProjectPullRequestComment} from "../src/react/projects/issueMutations";
import {buildProjectPullRequestApproval,PR_APPROVAL_CONTENT,ProjectPullRequestHeadChangedError,
  publishProjectPullRequestApproval} from "../src/react/projects/pullRequestReviews";
import {BffError,TransportError} from "../src/transport";
import {render,click,type} from "./render";

const viewer="a".repeat(64),owner="b".repeat(64),author="d".repeat(64),head="f".repeat(40),moved="e".repeat(40);
const repository=`30617:${owner}:repo`;
const event=(id:string,kind:number,tags:string[][],content="",time=20,pubkey=owner):PulseEvent=>({id:id.repeat(64),kind,pubkey,tags,content,created_at:time});

function fixture({reviewer=true,reviewAuthor=author}:{reviewer?:boolean;reviewAuthor?:string}={}){
  const review=event("2",1618,[["a",repository],["p",owner],...(reviewer?[["p",viewer]]:[]),["subject","Rename the parser"],["c",head],
    ["branch-name","feature"],["target-branch","main"]],"Review body",20,reviewAuthor);
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
// The host composer stands in for the Web/Desktop Forum composer: primary and secondary submit.
function StubComposer(props:PulseComposerProps){
  return <div data-testid="stub-composer">{props.header}
    <button type="button" onClick={()=>void props.onSubmit("Line note",[])?.catch(()=>{})}>stub-send</button>
    {props.onSecondarySubmit&&props.secondarySubmitLabel
      ?<button type="button" onClick={()=>void props.onSecondarySubmit?.("Please rename",[])?.catch(()=>{})}>{props.secondarySubmitLabel}</button>:null}
  </div>;
}
const pulse=(scopeKey:string):PulseHost=>({scopeKey,pubkey:viewer,query:async()=>[],publish:vi.fn(),copy:vi.fn(),startDm:vi.fn(),mediaUrl:url=>url,
  renderComposer:props=><StubComposer {...props}/>,renderContent:content=><p>{content}</p>});
function providers(scopeKey:string,children:ReactNode){
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  return <PlatformProvider client={createBffClient({send:vi.fn()})} locale="en"><QueryClientProvider client={cache}><TooltipProvider>
    <PulseHostProvider host={pulse(scopeKey)}>{children}</PulseHostProvider>
  </TooltipProvider></QueryClientProvider></PlatformProvider>;
}
async function mount(f:ReturnType<typeof fixture>){
  const workItem=await item(f);
  return render(providers(f.host.scopeKey,<ProjectInboxDetail host={f.host} workItem={workItem}/>));
}
const button=(root:ParentNode,label:string)=>Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(entry=>entry.textContent?.trim()===label||entry.getAttribute("aria-label")===label);
const intents=(prefix:string)=>[...Array(localStorage.length)].map((_,index)=>localStorage.key(index)).filter(key=>key?.startsWith(`["${prefix}"`));
const approveDialog=()=>document.querySelector<HTMLElement>('[data-testid="project-pull-request-approve-dialog"]');

beforeEach(()=>{localStorage.clear();sessionStorage.clear();setLocale("en");
  vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener(){},removeEventListener(){}}));
  Object.defineProperty(document,"fonts",{configurable:true,value:{ready:Promise.resolve()}});
  vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});
  HTMLElement.prototype.scrollIntoView=vi.fn();
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("original review decision and line comment events",()=>{
  it("builds the original approval and review comment tag order",()=>{
    const root=["e","2".repeat(64),"","root"];
    expect(buildProjectPullRequestApproval({owner,repoAddress:repository},{id:"2".repeat(64),author},head,"  ")).toEqual({kind:1,content:PR_APPROVAL_CONTENT,
      tags:[root,["a",repository],["p",owner],["p",author],["t","approval"],["c",head]]});
    expect(buildProjectPullRequestApproval({owner,repoAddress:repository},{id:"2".repeat(64),author:owner},head," Ship it ").content).toBe("Ship it");
    const issue={id:"2".repeat(64),author,recipients:[owner,viewer]};
    const base=[root,["a",repository],["p",owner],["p",author],["p",viewer]];
    const anchor={path:"src/lib.rs",side:"new" as const,line:12};
    expect(buildProjectCommentTags({owner,repoAddress:repository},issue,[],[],{commit:head,anchor,decision:"request-changes"})).toEqual([...base,
      ["t","inline-comment"],["c",head],["file","src/lib.rs"],["side","new"],["line","12"],["t","changes-requested"]]);
    expect(buildProjectCommentTags({owner,repoAddress:repository},issue,[],[],{commit:head,decision:"request-changes"}))
      .toEqual([...base,["t","changes-requested"],["c",head]]);
    expect(buildProjectCommentTags({owner,repoAddress:repository},issue,[],[])).toEqual(base);
  });
});

describe("original Approve on the review card",()=>{
  it("lets a requested reviewer approve with a summary and confirms only the exact readback",async()=>{
    const f=fixture();const success=vi.spyOn(toast,"success").mockImplementation(()=>"ok");
    f.host.publish=vi.fn<NonNullable<ProjectsHost["publish"]>>(async(request,_key,observeOnly,observation)=>{
      expect(request).toEqual({operation:"APPROVE_PULL_REQUEST",targetEventId:f.review.id,commit:head,body:"Ship it"});
      expect(observeOnly).toBe(false);
      const template=buildProjectPullRequestApproval({owner,repoAddress:repository},{id:f.review.id,author},head,"Ship it");
      const created=event("c",1,template.tags,template.content,40,viewer);
      observation?.onPrepared(created.id);f.rows.push(created);return {eventId:created.id};
    });
    const ui=await mount(f);
    await vi.waitFor(()=>expect(button(ui,"Approve")).toBeDefined());
    // A reviewer cannot change the lifecycle; only the decision is offered.
    expect(button(ui,"More review actions")).toBeUndefined();
    await click(button(ui,"Approve")!);
    await vi.waitFor(()=>expect(approveDialog()).not.toBeNull());
    expect(approveDialog()!.textContent).toContain("Add an optional summary for the author and other reviewers.");
    await type(approveDialog()!.querySelector("textarea")!,"Ship it");
    await click(button(approveDialog()!,"Approve")!);
    await vi.waitFor(()=>expect(success).toHaveBeenCalledWith("Review approved."));
    expect(f.host.publish).toHaveBeenCalledTimes(1);
    await vi.waitFor(()=>expect(approveDialog()).toBeNull());
    await vi.waitFor(()=>expect(button(ui,"Approve")).toBeUndefined());
    expect(ui.textContent).toContain("approved these changes");
    expect(intents("project-pull-request-approval")).toEqual([]);
  });

  it("offers no decision to the review author or a non-reviewer and refuses before publishing",async()=>{
    const own=fixture({reviewAuthor:viewer});own.host.publish=vi.fn();
    const ui=await mount(own);
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="project-pull-request-detail"]')).not.toBeNull());
    expect(button(ui,"Approve")).toBeUndefined();
    const stranger=fixture({reviewer:false});stranger.host.publish=vi.fn();
    const workItem=await item(stranger);
    await expect(publishProjectPullRequestApproval(stranger.host,workItem.project.id,workItem.repository,workItem.pullRequest,viewer,"",
      new AbortController().signal,()=>{})).rejects.toThrow("Failed to approve.");
    expect(stranger.host.publish).not.toHaveBeenCalled();
  });

  it("refuses a moved review head before publishing and clears a definite refusal",async()=>{
    const f=fixture();const workItem=await item(f);
    f.rows.push(event("7",1619,[["a",repository],["E",f.review.id],["c",moved]],"",30,author));
    f.host.publish=vi.fn();
    const approve=()=>publishProjectPullRequestApproval(f.host,workItem.project.id,workItem.repository,workItem.pullRequest,viewer,"",
      new AbortController().signal,()=>{});
    await expect(approve()).rejects.toBeInstanceOf(ProjectPullRequestHeadChangedError);
    expect(f.host.publish).not.toHaveBeenCalled();
    // Core's TARGET_STATE_CONFLICT is definite: nothing was published under the key.
    const current=await item(f);
    f.host.publish=vi.fn(async()=>{throw new BffError(409,"conflict",{class:ErrorClass.Conflict,reason:ReasonCode.TargetStateConflict});});
    await expect(publishProjectPullRequestApproval(f.host,current.project.id,current.repository,current.pullRequest,viewer,"",
      new AbortController().signal,()=>{})).rejects.toBeInstanceOf(BffError);
    expect(intents("project-pull-request-approval")).toEqual([]);
  });

  it("keeps an UNKNOWN approval on its exact intent and re-checks only that intent",async()=>{
    const f=fixture();const workItem=await item(f);
    const publish=vi.fn<NonNullable<ProjectsHost["publish"]>>(async(_request,_key,_observe,observation)=>{observation?.onPrepared("c".repeat(64));throw new TransportError("lost ACK");});
    f.host.publish=publish;
    const approve=(summary:string)=>publishProjectPullRequestApproval(f.host,workItem.project.id,workItem.repository,workItem.pullRequest,viewer,summary,
      new AbortController().signal,()=>{});
    await expect(approve("Ship it")).rejects.toThrow();
    await expect(approve("Other summary")).rejects.toThrow("not confirmed");expect(publish).toHaveBeenCalledTimes(1);
    const ui=await mount(f);
    await vi.waitFor(()=>expect(button(ui,"Re-check approval")).toBeDefined());
    const template=buildProjectPullRequestApproval({owner,repoAddress:repository},{id:f.review.id,author},head,"Ship it");
    f.rows.push(event("c",1,template.tags,template.content,40,viewer));
    publish.mockImplementation(async()=>({eventId:"c".repeat(64)}));
    await click(button(ui,"Re-check approval")!);
    await vi.waitFor(()=>expect(approveDialog()).not.toBeNull());
    await type(approveDialog()!.querySelector("textarea")!,"Ship it");
    await click(button(approveDialog()!,"Approve")!);
    await vi.waitFor(()=>expect(publish).toHaveBeenCalledTimes(2));
    expect(publish.mock.calls[1]?.[0]).toEqual(publish.mock.calls[0]?.[0]);
    expect(publish.mock.calls[1]?.[1]).toBe(publish.mock.calls[0]?.[1]);expect(publish.mock.calls[1]?.[2]).toBe(true);
    await vi.waitFor(()=>expect(intents("project-pull-request-approval")).toEqual([]));
  });
});

describe("original Request changes and line comments",()=>{
  it("requests changes from the conversation composer with the reviewed head",async()=>{
    const f=fixture();const success=vi.spyOn(toast,"success").mockImplementation(()=>"ok");
    f.host.publish=vi.fn<NonNullable<ProjectsHost["publish"]>>(async(request,_key,_observe,observation)=>{
      expect(request).toEqual({operation:"CREATE_PULL_REQUEST_COMMENT",targetEventId:f.review.id,body:"Please rename",mentions:[],attachments:[],
        commit:head,reviewDecision:"request-changes"});
      const tags=buildProjectCommentTags({owner,repoAddress:repository},{id:f.review.id,author,recipients:[owner,viewer]},[],[],{commit:head,decision:"request-changes"});
      const created=event("c",1,tags,"Please rename",40,viewer);
      observation?.onPrepared(created.id);f.rows.push(created);return {eventId:created.id};
    });
    const ui=await mount(f);
    const composer=()=>ui.querySelector<HTMLElement>('[data-testid="project-pull-request-comment-composer"]');
    await vi.waitFor(()=>expect(button(composer()!,"Request changes")).toBeDefined());
    await click(button(composer()!,"Request changes")!);
    await vi.waitFor(()=>expect(success).toHaveBeenCalledWith("Changes requested."));
    await vi.waitFor(()=>expect(ui.textContent).toContain("requested changes"));
  });

  it("offers no change request to the review author",async()=>{
    const f=fixture({reviewAuthor:viewer});f.host.publish=vi.fn();
    const ui=await mount(f);
    const composer=()=>ui.querySelector<HTMLElement>('[data-testid="project-pull-request-comment-composer"]');
    await vi.waitFor(()=>expect(composer()).not.toBeNull());
    expect(button(composer()!,"Request changes")).toBeUndefined();
  });

  it("posts a line comment from Files changed and shows it on its line",async()=>{
    const f=fixture();const success=vi.spyOn(toast,"success").mockImplementation(()=>"ok");
    const anchor={path:"src/lib.rs",side:"new" as const,line:1};
    f.host.publish=vi.fn<NonNullable<ProjectsHost["publish"]>>(async(request,_key,_observe,observation)=>{
      expect(request).toEqual({operation:"CREATE_PULL_REQUEST_COMMENT",targetEventId:f.review.id,body:"Line note",mentions:[],attachments:[],
        commit:head,anchorPath:"src/lib.rs",anchorSide:"new",anchorLine:1});
      const tags=buildProjectCommentTags({owner,repoAddress:repository},{id:f.review.id,author,recipients:[owner,viewer]},[],[],{commit:head,anchor});
      const created=event("c",1,tags,"Line note",40,viewer);
      observation?.onPrepared(created.id);f.rows.push(created);return {eventId:created.id};
    });
    const workItem=await item(f);
    const diff={additions:1,deletions:1,commitBody:null,files:[{path:"src/lib.rs",additions:1,deletions:1,truncated:false,
      patch:"@@ -1,2 +1,2 @@\n-old line\n+new line\n context\n"}]};
    const ui=await render(providers(f.host.scopeKey,<ProjectPullRequestDetail project={workItem.repository} pullRequest={workItem.pullRequest}
      publication={{host:f.host,projectId:workItem.project.id}} filesCount={1}
      filesChanged={controls=><ProjectPullRequestFilesChangedPanel diff={diff} error={null} isLoading={false} pullRequest={controls.pullRequest}
        focusedAnchor={controls.focusedAnchor} inlineComments={controls.inlineComments}/>}/>));
    const files=()=>ui.querySelector<HTMLElement>('[data-testid="project-detail-section-files"]')!;
    await click(files().querySelector("button")!);
    const line=()=>files().querySelector<HTMLElement>('[data-side="new"][data-line="1"]')!;
    await vi.waitFor(()=>expect(line()).not.toBeNull());
    const add=line().querySelector<HTMLButtonElement>('[data-testid="project-diff-add-comment"]')!;
    expect(add.getAttribute("aria-label")).toBe("Comment on src/lib.rs new line 1");
    await click(add);
    const thread=()=>files().querySelector<HTMLElement>('[data-testid="project-inline-comment-thread"]');
    await vi.waitFor(()=>expect(thread()?.textContent).toContain("src/lib.rs"));
    expect(button(thread()!,"Request changes")).toBeDefined();
    await click(button(thread()!,"stub-send")!);
    await vi.waitFor(()=>expect(success).toHaveBeenCalledWith("Line comment posted."));
    await vi.waitFor(()=>expect(thread()?.querySelector('[data-testid="project-inline-comment"]')?.textContent).toContain("Line note"));
    expect(thread()!.querySelector('[data-testid="stub-composer"]')).toBeNull();
    expect(intents("project-pull-request-comment-publication")).toEqual([]);
  });

  it("refuses a review comment without a reviewed head before publishing",async()=>{
    const f=fixture();const workItem=await item(f);f.host.publish=vi.fn();
    await expect(publishProjectPullRequestComment(f.host,workItem.project.id,workItem.repository,{...workItem.pullRequest,commit:null},"x",[],[],
      new AbortController().signal,undefined,{decision:"request-changes"})).rejects.toThrow("A review commit is required");
    expect(f.host.publish).not.toHaveBeenCalled();
  });
});

describe("original ForumComposer secondary submit",()=>{
  function Harness({onSubmit,onSecondarySubmit,label}:{onSubmit:PulseComposerProps["onSubmit"];onSecondarySubmit?:PulseComposerProps["onSubmit"];label?:string}){
    const mode=useComposerSubmitMode({onSubmit,onSecondarySubmit,secondarySubmitLabel:label});
    return <div>{mode.action}<button type="button" onClick={()=>void mode.submit("x",[])}>send</button></div>;
  }
  it("submits through the selected callback and needs both callback and label",async()=>{
    const primary=vi.fn<PulseComposerProps["onSubmit"]>(async()=>undefined),secondary=vi.fn<PulseComposerProps["onSubmit"]>(async()=>undefined);
    const ui=await render(<PlatformProvider client={createBffClient({send:vi.fn()})} locale="en">
      <Harness onSubmit={primary} onSecondarySubmit={secondary} label="Request changes"/></PlatformProvider>);
    await click(button(ui,"send")!);expect(primary).toHaveBeenCalledTimes(1);expect(secondary).not.toHaveBeenCalled();
    const trigger=ui.querySelector<HTMLButtonElement>('[data-testid="composer-submit-mode"]')!;
    expect(trigger.textContent).toBe("Comment");
    await act(async()=>{trigger.focus();trigger.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));});
    await vi.waitFor(()=>expect(document.querySelector('[role="menu"]')).not.toBeNull());
    const item=Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')).find(entry=>entry.textContent?.trim()==="Request changes")!;
    await act(async()=>{item.click();});
    await vi.waitFor(()=>expect(trigger.textContent).toBe("Request changes"));
    await click(button(ui,"send")!);expect(secondary).toHaveBeenCalledWith("x",[],undefined,undefined);expect(primary).toHaveBeenCalledTimes(1);
    const bare=await render(<PlatformProvider client={createBffClient({send:vi.fn()})} locale="en">
      <Harness onSubmit={primary} onSecondarySubmit={secondary}/></PlatformProvider>);
    expect(bare.querySelector('[data-testid="composer-submit-mode"]')).toBeNull();
  });
});
