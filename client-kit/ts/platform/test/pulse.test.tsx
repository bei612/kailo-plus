import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../src/i18n";
import { PulseHostProvider, usePulseHost, usePulsePublisher, type PulseHost } from "../src/react/pulse/host";
import { extractMentionPubkeys, selectedMentionLabel } from "../src/react/pulse/extractMentionPubkeys";
import { canonicalNpub } from "../src/react/conversations/pubkey";
import { PulseView } from "../src/react/pulse/ui/PulseView";
import { NoteCard } from "../src/react/pulse/ui/NoteCard";
import { AgentActivityCard } from "../src/react/pulse/ui/AgentActivityCard";
import { buildAnimatedAvatarUrl } from "../src/react/profile/buzz/shared/lib/animatedAvatar";
import { Operation } from "@client-kit/contracts";
import { BffError, isOutcomeUnknown, TransportError } from "../src/transport";
import { usePulseNoteActions } from "../src/react/pulse/lib/useNoteActions";
import { pulseQueryKeys } from "../src/react/pulse/hooks";
import { toast } from "sonner";
import { button, click, render } from "./render";
import { TooltipProvider } from "../src/react/sidebar/tooltip";

const author="a".repeat(64), viewer="b".repeat(64), eventId="c".repeat(64);
beforeEach(()=>{
  setLocale("en");
  vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));
  vi.stubGlobal("ResizeObserver",class {observe(){} disconnect(){} unobserve(){}});
});
afterEach(()=>vi.unstubAllGlobals());
function host(overrides:Partial<PulseHost>={}):PulseHost {
  return {scopeKey:"tenant:viewer",pubkey:viewer,query:async()=>[],publish:async()=>({eventId}),
    copy:async()=>{},startDm:async()=>{},mediaUrl:url=>url,renderContent:content=><p>{content}</p>,
    renderComposer:props=><button onClick={()=>void props.onSubmit("reply",[])}>{props.placeholder}</button>,...overrides};
}
function wrap(value:PulseHost,children:React.ReactNode) {
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}});
  return <QueryClientProvider client={cache}><TooltipProvider><PulseHostProvider host={value}>{children}</PulseHostProvider></TooltipProvider></QueryClientProvider>;
}

function loadedImages() {
  vi.stubGlobal("Image", function () {
    const image = document.createElement("img");
    let source = "";
    Object.defineProperties(image, {complete: {value: true}, naturalWidth: {value: 1}});
    Object.defineProperty(image, "src", {get: () => source, set: (value: string) => {
      source = value;
      queueMicrotask(() => image.dispatchEvent(new Event("load")));
    }});
    return image;
  });
}

describe("original Pulse governed consumers",()=>{
  it("opens the original public profile fields for the actual author and copies the full identity",async()=>{
    const copy=vi.fn(async()=>{}),startDm=vi.fn(async()=>{});
    const query=vi.fn<PulseHost["query"]>(async(request)=>request.view==="PROFILES"?[{
      id:eventId,pubkey:author,created_at:1,kind:0,tags:[],
      content:JSON.stringify({display_name:"Actual author",about:"Original public biography",nip05:"author@example.org"}),
    }]:[]);
    function Open(){const host=usePulseHost();return <button onClick={()=>host.openProfile?.(author)}>Open author</button>;}
    const ui=await render(wrap(host({copy,startDm,query}),<Open/>));
    await click(button(ui,"Open author"));
    await vi.waitFor(()=>expect(ui.textContent).toContain("Original public biography"));
    expect(query).toHaveBeenCalledWith({view:"PROFILES",authors:[author]});
    expect(ui.textContent).toContain("Actual author");
    expect(ui.textContent).toContain("author@example.org");
    const summary=ui.querySelector('[data-testid="user-profile-summary-scroll-layout"]')!;
    expect(summary.className).toBe("flex flex-col gap-6 pt-4");
    expect(summary.querySelector('[data-testid="user-profile-info-section"] h2')?.textContent).toBe("Info");
    const actions=summary.querySelector('[data-testid="user-profile-primary-actions"]')!;
    expect(actions.className).toBe("grid grid-flow-col auto-cols-fr gap-2");
    expect([...summary.children].indexOf(actions)).toBe(1);
    expect(summary.querySelector('[data-testid="user-profile-name-row"]')?.parentElement?.querySelector(':scope > p.text-sm')?.textContent).toBe("author@example.org");
    await click(ui.querySelector('[data-testid="user-profile-public-key"]') as HTMLButtonElement);
    expect(copy).toHaveBeenCalledWith(canonicalNpub(author));
    await click(ui.querySelector('[data-testid="user-profile-nip05"]') as HTMLButtonElement);
    expect(copy).toHaveBeenCalledWith("author@example.org");
    await click(button(ui,"Message"));
    expect(startDm).toHaveBeenCalledWith(author);
    expect(ui.querySelector('[data-testid="user-profile-panel"]')).toBeNull();
  });

  it("keeps the original pending message tile and preserves the admitted panel on failure",async()=>{
    let reject!: (error:Error)=>void;
    const startDm=vi.fn(()=>new Promise<void>((_resolve,fail)=>{reject=fail;}));
    function Open(){const host=usePulseHost();return <button onClick={()=>host.openProfile?.(author)}>Open author</button>;}
    const query:PulseHost["query"]=async()=>[{id:eventId,pubkey:author,created_at:1,kind:0,tags:[],content:JSON.stringify({display_name:"Author"})}];
    const ui=await render(wrap(host({startDm,query}),<Open/>));
    await click(button(ui,"Open author"));
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="user-profile-message"]')).not.toBeNull());
    await click(ui.querySelector('[data-testid="user-profile-message"]') as HTMLButtonElement);
    expect(ui.querySelector<HTMLButtonElement>('[data-testid="user-profile-message"]')?.disabled).toBe(true);
    expect(ui.querySelector('[data-testid="user-profile-message"]')?.getAttribute("aria-busy")).toBe("true");
    await act(async()=>reject(new TransportError("Unconfirmed original request")));
    await vi.waitFor(()=>expect(ui.querySelector('[role="alert"]')?.textContent).toContain("Unconfirmed original request"));
    expect(ui.querySelector('[data-testid="user-profile-panel"]')).not.toBeNull();
    expect(startDm).toHaveBeenCalledTimes(1);
  });

  it("retains two explicit same-name selections without rebinding the first recipient",()=>{
    const selected=new Map<string,string>();
    selected.set(selectedMentionLabel("Alex",author,selected),author);
    const second=selectedMentionLabel("Alex",viewer,selected);
    selected.set(second,viewer);
    expect(extractMentionPubkeys({text:"@Alex and @"+second,selectedMentions:selected,memberCandidates:[]})).toEqual([author,viewer]);
    expect(extractMentionPubkeys({text:"@Alex",selectedMentions:selected,memberCandidates:[]})).toEqual([author]);
  });
  it("preserves original feed tabs and passes new posts to the host, not a Workspace",async()=>{
    const publish=vi.fn<PulseHost["publish"]>(async()=>({eventId}));const query=vi.fn<PulseHost["query"]>(async()=>[]);
    const ui=await render(wrap(host({publish,query}),<PulseView currentPubkey={viewer}/>));
    expect([...ui.querySelectorAll('[role="tab"]')].map(e=>e.getAttribute("aria-label")??e.textContent?.trim()))
      .toEqual(["Search Pulse","Everyone","Following","Liked","Agents","Mine"]);
    await click(button(ui,"What's on your mind?"));
    await vi.waitFor(()=>expect(publish).toHaveBeenCalledTimes(1));
    expect(publish.mock.calls[0]?.[0]).toMatchObject({operation:"NOTE",content:"reply"});
    expect(query).toHaveBeenCalledWith({view:"NOTES"});
    expect(JSON.stringify(publish.mock.calls)).not.toContain("workspaceId");
  });

  it("keeps original note reply/share/like/DM controls wired to the actual note and author",async()=>{
    const reply=vi.fn(async()=>{}),share=vi.fn(),startDm=vi.fn(),toggleUpvote=vi.fn(async()=>{});
    const note={id:eventId,pubkey:author,createdAt:1000,content:"Actual note",tags:[]};
    const ui=await render(wrap(host(),<NoteCard note={note} isOwnNote={false} profile={{displayName:"Author",avatarUrl:null,nip05Handle:null,ownerPubkey:null}}
      actions={{reply,share,startDm,toggleUpvote}}/>));
    await click(ui.querySelector('[aria-label="Like"]') as HTMLButtonElement);
    expect(toggleUpvote).toHaveBeenCalledWith(note,false);
    await click(ui.querySelector('[aria-label="Share"]') as HTMLButtonElement);expect(share).toHaveBeenCalledWith(note);
    await click(ui.querySelector('[aria-label="Start direct message"]') as HTMLButtonElement);expect(startDm).toHaveBeenCalledWith(author);
    await click(ui.querySelector('[aria-label="Reply"]') as HTMLButtonElement);
    await click(button(ui,"Post your reply"));expect(reply).toHaveBeenCalledWith(note,"reply",[],undefined);
  });

  it("resolves original note, parent and reply-author animated avatars after parsing each media source",async()=>{
    loadedImages();
    const parentId="d".repeat(64),parentAuthor="e".repeat(64);
    const poster=`https://community.example/media/${eventId}.png`;
    const animation=`https://community.example/media/${author}.png`;
    const avatarUrl=buildAnimatedAvatarUrl(poster,animation);
    const posterPath=`/api/v1/profile/media/${eventId}`,animationPath=`/api/v1/profile/media/${author}`;
    const mediaUrl=vi.fn((url:string)=>url===poster?posterPath:url===animation?animationPath:url);
    const profile={displayName:"Actual author",avatarUrl,nip05Handle:null,ownerPubkey:null};
    const note={id:eventId,pubkey:author,createdAt:1000,content:"Actual reply",tags:[["e",parentId,"","reply"]]};
    const query=vi.fn<PulseHost["query"]>(async request=>request.view==="NOTES"&&request.eventIds?.includes(parentId)
      ?[{id:parentId,pubkey:parentAuthor,created_at:900,kind:1,content:"Actual parent",tags:[]}]:[]);
    const publish=vi.fn<PulseHost["publish"]>();
    const ui=await render(wrap(host({query,publish,mediaUrl,renderComposer:props=><div>{props.header}</div>}),
      <NoteCard note={note} isOwnNote={false} profile={profile} currentUserDisplayName="Current author"
        currentUserProfile={profile} composerProfiles={{[parentAuthor]:profile}}/>));
    await vi.waitFor(()=>expect(ui.querySelectorAll("img")).toHaveLength(2));
    expect([...ui.querySelectorAll("img")].map(image=>image.getAttribute("src"))).toEqual([posterPath,posterPath]);
    await click(ui.querySelector('[aria-label="Reply"]') as HTMLButtonElement);
    await vi.waitFor(()=>expect(ui.querySelectorAll("img")).toHaveLength(3));
    for(const image of ui.querySelectorAll("img")) {
      expect(image.getAttribute("src")).toBe(posterPath);
      const avatar=image.closest('[data-avatar-shape]')!;
      await act(async()=>avatar.dispatchEvent(new MouseEvent("mouseover",{bubbles:true})));
      await vi.waitFor(()=>expect(avatar.querySelector("img")?.getAttribute("src")).toBe(animationPath));
      await act(async()=>avatar.dispatchEvent(new MouseEvent("mouseout",{bubbles:true})));
      await vi.waitFor(()=>expect(avatar.querySelector("img")?.getAttribute("src")).toBe(posterPath));
    }
    expect(query).toHaveBeenCalledWith({view:"NOTES",eventIds:[parentId]});
    expect(mediaUrl).toHaveBeenCalledWith(poster);expect(mediaUrl).toHaveBeenCalledWith(animation);
    expect(publish).not.toHaveBeenCalled();
  });

  it("keeps the original agent activity squircle and hover playback on the real host media resolver",async()=>{
    loadedImages();
    const poster=`https://community.example/media/${eventId}.png`,animation=`https://community.example/media/${author}.png`;
    const posterPath=`/api/v1/profile/media/${eventId}`,animationPath=`/api/v1/profile/media/${author}`;
    const mediaUrl=vi.fn((url:string)=>url===poster?posterPath:url===animation?animationPath:url);
    const publish=vi.fn<PulseHost["publish"]>();
    const ui=await render(wrap(host({mediaUrl,publish}),<AgentActivityCard
      group={{pubkey:author,latestAt:1000,earliestAt:1000,notes:[{id:eventId,pubkey:author,createdAt:1000,content:"Actual activity",tags:[]}]}}
      profile={{displayName:"Actual agent",avatarUrl:buildAnimatedAvatarUrl(poster,animation),nip05Handle:null,ownerPubkey:null}}/>));
    await vi.waitFor(()=>expect(ui.querySelector("img")?.getAttribute("src")).toBe(posterPath));
    const avatar=ui.querySelector('[data-avatar-shape="squircle"]')!;
    expect(avatar.className).toContain("h-9 w-9");
    await act(async()=>avatar.dispatchEvent(new MouseEvent("mouseover",{bubbles:true})));
    await vi.waitFor(()=>expect(avatar.querySelector("img")?.getAttribute("src")).toBe(animationPath));
    expect(ui.querySelector('[role="img"]')).toBeNull();
    expect(publish).not.toHaveBeenCalled();
  });

  it("routes the actual Pulse composer avatar through both authorized animated resources without publishing",async()=>{
    loadedImages();
    const poster=`https://community.example/media/${eventId}.png`,animation=`https://community.example/media/${author}.png`;
    const posterPath=`/api/v1/profile/media/${eventId}`,animationPath=`/api/v1/profile/media/${author}`;
    const avatarUrl=buildAnimatedAvatarUrl(poster,animation);
    const mediaUrl=vi.fn((url:string)=>url===poster?posterPath:url===animation?animationPath:url);
    const query=vi.fn<PulseHost["query"]>(async request=>request.view==="PROFILES"?[{id:eventId,pubkey:viewer,created_at:1,kind:0,tags:[],
      content:JSON.stringify({display_name:"Current author",picture:avatarUrl})}]:[]);
    const publish=vi.fn<PulseHost["publish"]>();
    const ui=await render(wrap(host({query,publish,mediaUrl,renderComposer:props=><div>{props.header}</div>}),<PulseView currentPubkey={viewer}/>));
    await vi.waitFor(()=>expect(ui.querySelector("img")?.getAttribute("src")).toBe(posterPath));
    const avatar=ui.querySelector('[data-avatar-shape="circle"]')!;
    expect(avatar.className).toContain("!h-7 !w-7");
    await act(async()=>avatar.dispatchEvent(new MouseEvent("mouseover",{bubbles:true})));
    await vi.waitFor(()=>expect(avatar.querySelector("img")?.getAttribute("src")).toBe(animationPath));
    expect(query).toHaveBeenCalledWith({view:"PROFILES",authors:[viewer]});
    expect(publish).not.toHaveBeenCalled();
  });

  it("retains the same original publish key after UNKNOWN instead of replaying a fresh write",async()=>{
    const publish=vi.fn<PulseHost["publish"]>(async()=>{throw new TransportError("Unknown");});
    function Retry(){const post=usePulsePublisher();return <button onClick={()=>void post({operation:Operation.Note,content:"one intent"}).catch(()=>{})}>Retry intent</button>;}
    const ui=await render(wrap(host({publish}),<Retry/>));
    await click(button(ui,"Retry intent"));await click(button(ui,"Retry intent"));
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[0]?.[1]).toEqual(publish.mock.calls[1]?.[1]);
  });

  it("does not unlock an unknown write after a refused observation, and releases only after confirmation",async()=>{
    const failures:unknown[]=[];
    const publish=vi.fn<PulseHost["publish"]>()
      .mockRejectedValueOnce(new TransportError("Unknown"))
      .mockRejectedValueOnce(new BffError(403,"refused observation"))
      .mockResolvedValue({eventId});
    function Retry(){const post=usePulsePublisher();return <button onClick={()=>void post({operation:Operation.Note,content:"one intent"}).catch(error=>{failures.push(error);})}>Retry intent</button>;}
    const ui=await render(wrap(host({publish}),<Retry/>));
    for(let attempt=0;attempt<4;attempt++)await click(button(ui,"Retry intent"));
    expect(publish.mock.calls[1]?.[1]).toEqual(publish.mock.calls[0]?.[1]);
    expect(publish.mock.calls[2]?.[1]).toEqual(publish.mock.calls[0]?.[1]);
    expect(publish.mock.calls[3]?.[1]).not.toEqual(publish.mock.calls[0]?.[1]);
    expect(failures).toHaveLength(2);
    expect(failures.every(isOutcomeUnknown)).toBe(true);
  });

  it("restores the original confirmed-copy feedback without treating rejected clipboard writes as success",async()=>{
    setLocale("zh-CN");
    const success=vi.spyOn(toast,"success"),failure=vi.spyOn(toast,"error");
    const copy=vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("clipboard private detail"));
    function Share(){const actions=usePulseNoteActions({currentPubkey:viewer,reactionQueryKey:pulseQueryKeys.reactions([]),reactions:new Map()});return <button onClick={()=>void actions.share({id:eventId,pubkey:author,createdAt:1,content:"note",tags:[]})}>Share note</button>;}
    const ui=await render(wrap(host({copy}),<Share/>));
    await click(button(ui,"Share note"));expect(success).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenLastCalledWith("链接已复制");
    await click(button(ui,"Share note"));expect(success).toHaveBeenCalledTimes(1);
    expect(failure).toHaveBeenLastCalledWith("复制失败");
    success.mockRestore();failure.mockRestore();
  });
});
