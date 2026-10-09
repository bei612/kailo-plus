import { act, startTransition, useCallback, useRef, useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { MessageTimelineSurface } from "../src/react/messages/timeline/MessageTimelineSurface";
import type { TimelineMessage } from "../src/react/messages/types";
import { render, click } from "./render";
import { useAnchoredScroll } from "../src/react/messages/thread/useAnchoredScroll";
import { getRouteMainTimelineTargetId, getThreadRouteTarget } from "../src/react/messages/thread/channelRouteTarget";
import { useChannelMessageEdit } from "../src/react/messages/thread/useChannelMessageEdit";
import { useRoutedMessageEdit } from "../src/react/messages/thread/useRoutedMessageEdit";
import { useFocusDrawerPresence } from "../src/react/messages/thread/useFocusDrawerPresence";
import { toast } from "sonner";
import { MessageActionBarSurface } from "../src/react/messages/MessageActionBarSurface";
import { useMessageDeleteDialog } from "../src/react/messages/DeleteMessageConfirmDialog";
import { TooltipProvider } from "../src/react/sidebar/tooltip";
import { setLocale } from "../src/i18n";
import { TransportError } from "../src/transport";

const messages: TimelineMessage[] = [{ id: "message", author: "Alice", time: "", createdAt: 1, depth: 0, body: "Body" }];

beforeEach(() => {
  setLocale("en");
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
});

it("restores the original empty DM introduction and overlapping three-person preview in both languages", async () => {
  const participants = ["Alice", "Bob", "Carol", "Dave", "Eve"].map((displayName, index) => ({id:String(index),displayName,avatarUrl:null}));
  const renderParticipant = vi.fn((participant, className) => <button className={className}>{participant.displayName}</button>);
  const intro = {displayName:"Alice, Bob, Carol, +2 more",participants,renderParticipant};
  const host = await render(<MessageTimelineSurface channelId="dm-intro" messages={[]} directMessageIntro={intro} renderList={() => null}/>);
  const surface = host.querySelector('[data-testid="message-dm-intro"]')!;
  expect(surface.className).toBe("mt-auto flex w-full flex-col items-start px-3 py-2 text-left");
  expect(surface.textContent).toContain("This is the beginning of your direct message with Alice, Bob, Carol, +2 more.");
  expect(surface.querySelectorAll('[data-testid="message-dm-intro-avatar-stack-participant"]')).toHaveLength(3);
  expect(surface.querySelector('[data-testid="message-dm-intro-avatar-stack-more"]')?.textContent).toBe("+2");
  expect(surface.querySelectorAll("button")[0]?.className).toBe("h-[60px] w-[60px] text-base ring-2 ring-background");
  expect(surface.querySelectorAll("button")[2]?.className).toContain("ring-2 ring-background");
  expect(host.querySelector('[data-testid="message-empty"]')).toBeNull();
  await act(async()=>setLocale("zh-CN"));
  expect(surface.textContent).toContain("这是你与Alice, Bob, Carol, +2 more的私聊开始。");
});

it("keeps the original DM intro as the first actual list row and suppresses it during loading or terminal empty error", async () => {
  const intro = {displayName:"Alice",participants:[{id:"alice",displayName:"Alice",avatarUrl:null}],
    renderParticipant: (_participant: unknown,className:string) => <span className={className}>avatar</span>};
  function IntroHost() {
    const [mode,setMode] = useState("list");
    return <><button onClick={()=>setMode("loading")}>Load</button><button onClick={()=>setMode("error")}>Error</button>
      <MessageTimelineSurface channelId="dm-intro" messages={mode==="list"?messages:[]} directMessageIntro={intro}
        isLoading={mode==="loading"} isError={mode==="error"} hasOlderMessages
        renderList={props=><section data-testid="real-list">{props.leadingContent}<p>message row</p></section>}/></>;
  }
  const host = await render(<IntroHost/>);
  const list=host.querySelector('[data-testid="real-list"]')!;
  expect(list.firstElementChild?.getAttribute("data-testid")).toBe("message-dm-intro");
  expect(list.firstElementChild?.className).toBe("mb-2 flex w-full flex-col items-start px-3 pb-2 pt-2 text-left");
  expect(list.querySelector('[data-testid="message-dm-intro-avatar-stack-participant"] span')?.className).toBe("h-[60px] w-[60px] text-base");
  await click(host.querySelectorAll("button")[0]!);
  expect(host.querySelector('[data-testid="message-dm-intro"]')).toBeNull();
  await click(host.querySelectorAll("button")[1]!);
  expect(host.querySelector('[data-testid="message-dm-intro"]')).toBeNull();
});

it("restores the original destructive menu, confirmation and UNKNOWN retry without optimistic deletion", async () => {
  const target={...messages[0]!,id:"delete-target"};
  const remove=vi.fn().mockRejectedValueOnce(new TransportError("Lost receipt")).mockResolvedValueOnce(undefined);
  const deleted=vi.fn();
  function DeleteHost() {
    const deletion=useMessageDeleteDialog("actor/channel",true,remove,deleted);
    return <TooltipProvider><MessageActionBarSurface message={target} onCopyMessage={()=>{}} onDelete={deletion.requestDelete}/>{deletion.dialog}</TooltipProvider>;
  }
  const host=await render(<DeleteHost/>);
  await act(async()=>{host.querySelector<HTMLButtonElement>('[data-testid="more-actions-delete-target"]')!.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));});
  const item=document.querySelector<HTMLElement>('[data-testid="delete-message-delete-target"]')!;
  expect(item.className).toContain("text-destructive focus:text-destructive");
  await click(item);
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Delete message?");
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("This will permanently delete this message and cannot be undone.");
  expect(remove).not.toHaveBeenCalled();
  await click([...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button=>button.textContent==="Delete")!);
  expect(remove).toHaveBeenCalledExactlyOnceWith(target);
  expect(deleted).not.toHaveBeenCalled();
  expect(document.querySelector('[role="status"]')?.textContent).toContain("Deletion outcome unknown");
  await click([...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button=>button.textContent==="Check deletion")!);
  expect(remove.mock.calls).toEqual([[target],[target]]);
  expect(deleted).toHaveBeenCalledExactlyOnceWith(target);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});

it("fences an in-flight deletion from a different identity/channel and prevents double confirmation", async () => {
  let finish!:()=>void;
  const remove=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;})), deleted=vi.fn();
  function DeleteHost() {
    const [scope,setScope]=useState("first");
    const deletion=useMessageDeleteDialog(scope,true,remove,deleted);
    return <><button onClick={()=>deletion.requestDelete(messages[0]!)}>Delete target</button><button onClick={()=>setScope("second")}>Switch identity</button>{deletion.dialog}</>;
  }
  const host=await render(<DeleteHost/>);
  await click(host.querySelectorAll("button")[0]!);
  const confirm=[...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button=>button.textContent==="Delete")!;
  await click(confirm);
  await click(confirm);
  expect(remove).toHaveBeenCalledTimes(1);
  await click(host.querySelectorAll("button")[1]!);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  await act(async()=>{finish();});
  expect(deleted).not.toHaveBeenCalled();
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

it("preserves the original thread-edit leaving and cross-composer guards until save or cancel", async () => {
  const info = vi.spyOn(toast, "info").mockImplementation(() => 0);
  const rootMessage = { ...messages[0]!, id: "root" };
  const reply = { ...rootMessage, id: "reply", tags: [["e", "root", "", "reply"]] };
  function EditHost() {
    const edit = useChannelMessageEdit("identity/channel");
    const [opened, setOpened] = useState(false);
    return (
      <>
        <button onClick={() => edit.handleEdit(reply)}>Edit reply</button>
        <button onClick={() => edit.handleEdit(rootMessage)}>Edit root</button>
        <button
          onClick={() => {
            if (edit.requireThreadEditResolution()) {
              edit.handleCancelEdit();
              setOpened(true);
            }
          }}
        >
          Open target
        </button>
        <button onClick={edit.handleCancelEdit}>Cancel edit</button>
        <output>
          {edit.editTarget?.id ?? "none"}/{opened ? "opened" : "closed"}
        </output>
      </>
    );
  }
  const host = await render(<EditHost />);
  const buttons = host.querySelectorAll("button");
  await click(buttons[0]!);
  await click(buttons[2]!);
  expect(host.querySelector("output")?.textContent).toBe("reply/closed");
  await click(buttons[1]!);
  expect(host.querySelector("output")?.textContent).toBe("reply/closed");
  expect(info).toHaveBeenCalledTimes(2);
  await click(buttons[3]!);
  await click(buttons[2]!);
  expect(host.querySelector("output")?.textContent).toBe("none/opened");
  info.mockRestore();
});

it("fences old-owner edit completion and clears the original edit selection on identity or channel change", async () => {
  let previousOwnerCancel: (() => void) | undefined;
  function EditHost() {
    const [scope, setScope] = useState("first");
    const edit = useChannelMessageEdit(scope);
    if (!previousOwnerCancel) previousOwnerCancel = edit.handleCancelEdit;
    return (
      <>
        <button onClick={() => edit.handleEdit({ ...messages[0]!, id: scope })}>Edit</button>
        <button onClick={() => setScope("second")}>Switch owner</button>
        <button onClick={() => previousOwnerCancel!()}>Old completion</button>
        <output>{edit.editTarget?.id ?? "none"}</output>
      </>
    );
  }
  const host = await render(<EditHost />),
    buttons = host.querySelectorAll("button");
  await click(buttons[0]!);
  expect(host.querySelector("output")?.textContent).toBe("first");
  await click(buttons[1]!);
  expect(host.querySelector("output")?.textContent).toBe("none");
  await click(buttons[0]!);
  await click(buttons[2]!);
  expect(host.querySelector("output")?.textContent).toBe("second");
});

it("defers the original main edit until the real focus drawer exit and drops it on identity changes", async () => {
  const selected = vi.fn();
  const own = {...messages[0]!, id:"own", pubkey:"me", kind:9};
  function FocusHost() {
    const [open,setOpen] = useState(true);
    const [owner,setOwner] = useState("me");
    const [admission,setAdmission] = useState(0);
    const onEdit = useCallback((message:TimelineMessage)=>{selected(message);},[admission]);
    const close = useCallback(() => setOpen(false),[]);
    const presence = useFocusDrawerPresence(open,close);
    const edit = useRoutedMessageEdit({activeChannelId:"channel",currentPubkey:owner,
      channelIsCovered:presence.channelIsCovered,isSinglePanelView:false,mainMessages:[own],
      editTarget:null,onCloseThread:close,onEdit,useFocusThreadDrawer:open});
    return <><button onClick={()=>edit.routeEdit(own)}>Edit main</button>
      <button onClick={presence.markExitComplete}>Exit complete</button>
      <button onClick={()=>{setOpen(true);setOwner("me");}}>Reopen</button>
      <button onClick={()=>setOwner("other")}>Change owner</button>
      <button onClick={()=>setAdmission(value=>value+1)}>Refresh actual editor admission</button>
      <output>{open?"open":"closing"}/{presence.channelIsCovered?"covered":"ready"}</output></>;
  }
  const host = await render(<FocusHost/>);
  const buttons=host.querySelectorAll("button");
  await click(buttons[0]!);
  expect(host.querySelector("output")?.textContent).toBe("closing/covered");
  expect(selected).not.toHaveBeenCalled();
  await click(buttons[4]!);
  expect(selected).not.toHaveBeenCalled();
  await click(buttons[1]!);
  expect(selected).toHaveBeenCalledExactlyOnceWith(own);
  await click(buttons[2]!);
  await click(buttons[0]!);
  await click(buttons[3]!);
  await click(buttons[1]!);
  expect(selected).toHaveBeenCalledTimes(1);
});

it("selects the original latest own non-system acknowledged message separately for main and thread", async () => {
  const selected=vi.fn();
  const own={...messages[0]!,id:"own",pubkey:"me",kind:9,createdAt:2};
  const reply={...own,id:"reply",createdAt:3,tags:[["e","root","","reply"]]};
  function LastOwnHost() {
    const edit=useRoutedMessageEdit({activeChannelId:"channel",currentPubkey:"me",channelIsCovered:false,
      isSinglePanelView:false,editTarget:null,onCloseThread:()=>{},onEdit:selected,useFocusThreadDrawer:false,
      mainMessages:[own,{...own,id:"other",pubkey:"other",createdAt:9},{...own,id:"pending",pending:true,createdAt:8},
        {...own,id:"system",kind:40099,createdAt:7}],threadHeadMessage:own,threadMessages:[reply]});
    return <><button onClick={edit.handleEditLastOwnMainMessage}>Last main</button>
      <button onClick={edit.handleEditLastOwnThreadMessage}>Last thread</button></>;
  }
  const host=await render(<LastOwnHost/>);
  await click(host.querySelectorAll("button")[0]!);
  await click(host.querySelectorAll("button")[1]!);
  expect(selected.mock.calls).toEqual([[own],[reply]]);
});
