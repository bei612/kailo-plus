import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../src/i18n";
import { PulseHostProvider, usePulsePublisher, type PulseHost } from "../src/react/pulse/host";
import { PulseView } from "../src/react/pulse/ui/PulseView";
import { NoteCard } from "../src/react/pulse/ui/NoteCard";
import { Operation } from "@client-kit/contracts";
import { TransportError } from "../src/transport";
import { button, click, render } from "./render";
import { TooltipProvider } from "../src/react/sidebar/tooltip";

const author="a".repeat(64), viewer="b".repeat(64), eventId="c".repeat(64);
beforeEach(()=>setLocale("en"));
function host(overrides:Partial<PulseHost>={}):PulseHost {
  return {scopeKey:"tenant:viewer",pubkey:viewer,query:async()=>[],publish:async()=>({eventId}),
    copy:async()=>{},startDm:async()=>{},mediaUrl:url=>url,renderContent:content=><p>{content}</p>,
    renderComposer:props=><button onClick={()=>void props.onSubmit("reply",[])}>{props.placeholder}</button>,...overrides};
}
function wrap(value:PulseHost,children:React.ReactNode) {
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}});
  return <QueryClientProvider client={cache}><TooltipProvider><PulseHostProvider host={value}>{children}</PulseHostProvider></TooltipProvider></QueryClientProvider>;
}

describe("original Pulse governed consumers",()=>{
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

  it("retains the same original publish key after UNKNOWN instead of replaying a fresh write",async()=>{
    const publish=vi.fn<PulseHost["publish"]>(async()=>{throw new TransportError("Unknown");});
    function Retry(){const post=usePulsePublisher();return <button onClick={()=>void post({operation:Operation.Note,content:"one intent"}).catch(()=>{})}>Retry intent</button>;}
    const ui=await render(wrap(host({publish}),<Retry/>));
    await click(button(ui,"Retry intent"));await click(button(ui,"Retry intent"));
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[0]?.[1]).toEqual(publish.mock.calls[1]?.[1]);
  });
});
