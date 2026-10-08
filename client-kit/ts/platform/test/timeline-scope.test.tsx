import { startTransition, useCallback, useRef, useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { MessageTimelineSurface } from "../src/react/messages/timeline/MessageTimelineSurface";
import type { TimelineMessage } from "../src/react/messages/types";
import { render, click } from "./render";
import { useAnchoredScroll } from "../src/react/messages/thread/useAnchoredScroll";
import { getRouteMainTimelineTargetId, getThreadRouteTarget } from "../src/react/messages/thread/channelRouteTarget";

const messages: TimelineMessage[] = [{ id: "message", author: "Alice", time: "", createdAt: 1, depth: 0, body: "Body" }];

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
});

function StatefulHostList() {
  return <input data-testid="host-list-state" defaultValue="fresh" />;
}

function Harness() {
  const [channel, setChannel] = useState("first");
  const [name, setName] = useState("Original");
  return <>
    <button onClick={() => startTransition(() => setChannel("second"))}>Change channel</button>
    <button onClick={() => setName("Renamed")}>Rename channel</button>
    <MessageTimelineSurface channelId={channel} channelName={name} messages={messages}
      historyExhausted hasOlderMessages={false} renderList={() => <StatefulHostList />} />
  </>;
}

it("preserves the original channel-keyed list lifetime, including transition navigation", async () => {
  const host = await render(<Harness />);
  const initial = host.querySelector<HTMLInputElement>('[data-testid="host-list-state"]')!;
  expect(initial).not.toBeNull();
  initial.value = "previous channel virtualizer state";
  await click(host.querySelectorAll("button")[1]!);
  expect(host.querySelector('[data-testid="host-list-state"]')).toBe(initial);
  await click(host.querySelectorAll("button")[0]!);
  const next = host.querySelector<HTMLInputElement>('[data-testid="host-list-state"]')!;
  expect(next).not.toBe(initial);
  expect(next.value).toBe("fresh");
});

it("accepts a cold target only after the original virtualizer realizes and centers the row", async () => {
  const reached = vi.fn(), jump = vi.fn(() => true), bottom = vi.fn(), scroll = vi.fn();
  const targetMessages = [{id:"cold-target"}];
  function TargetHarness() {
    const [version,setVersion] = useState(0);
    const container = useRef<HTMLDivElement|null>(null), content = useRef<HTMLDivElement|null>(null);
    useAnchoredScroll({channelId:"cold-channel",messages:targetMessages,isLoading:false,
      scrollContainerRef:container,contentRef:content,targetMessageId:"cold-target",onTargetReached:reached,
      virtualizerOwnsPrependAnchoring:true,virtualizerRenderVersion:version,virtualScrollToMessage:jump,virtualScrollToBottom:bottom});
    const setContainer = useCallback((node:HTMLDivElement|null) => {
      container.current=node;
      if(node) Object.defineProperties(node,{clientHeight:{configurable:true,value:400},scrollHeight:{configurable:true,value:1000},
        getBoundingClientRect:{configurable:true,value:()=>({top:0,bottom:400})},scrollTo:{configurable:true,value:scroll}});
    },[]);
    return <><button onClick={()=>setVersion(value=>value+1)}>Realize target</button>
      <div ref={setContainer}><div ref={content}><div data-message-id="cold-target" ref={node=>{
        if(node) node.getBoundingClientRect=()=>({top:version?200:-500,bottom:version?240:-460,height:40} as DOMRect);
      }}/></div></div></>;
  }
  const host = await render(<TargetHarness/>);
  expect(jump).toHaveBeenCalled(); expect(reached).not.toHaveBeenCalled();
  expect(bottom).not.toHaveBeenCalled();
  await click(host.querySelector("button")!);
  expect(scroll).toHaveBeenCalledWith({top:20,behavior:"auto"});
  expect(reached).toHaveBeenCalledExactlyOnceWith("cold-target");
});

it("retains the official root/reply/broadcast projection and refuses missing or cyclic ancestry", () => {
  const root={...messages[0]!,id:"root"};
  const parent={...root,id:"parent",parentId:"root",rootId:"root"};
  const reply={...root,id:"reply",parentId:"parent",rootId:"root"};
  const byId=new Map([root,parent,reply].map(message=>[message.id,message]));
  expect(getRouteMainTimelineTargetId(reply.id,reply)).toBe(root.id);
  expect(getThreadRouteTarget(reply,byId)).toEqual({threadHeadId:"root",expandedReplyIds:new Set(["parent"])});
  expect(getThreadRouteTarget(reply,new Map([["reply",reply],["root",root]]))).toBeNull();
  const cycle={...parent,parentId:"reply"};
  expect(getThreadRouteTarget(reply,new Map([["reply",reply],["parent",cycle],["root",root]]))).toBeNull();
  expect(getRouteMainTimelineTargetId(null,reply)).toBeNull();
  expect(getRouteMainTimelineTargetId(root.id,root)).toBe(root.id);
  expect(getRouteMainTimelineTargetId(reply.id,{...reply,tags:[["broadcast","1"]]})).toBe(reply.id);
});
