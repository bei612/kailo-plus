import { act, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { useHomeInboxAutoSelection } from "../src/react/use-inbox-auto-selection";
import { useInboxSelectionAnchor } from "../src/react/use-inbox-selection-anchor";
import { render } from "./render";

type Options = Parameters<typeof useHomeInboxAutoSelection>[0];
const items = [{ id: "channel-a:root", conversationId: "channel-a:root" }, { id: "channel-b:root", conversationId: "channel-b:root" }];

describe("shared original Inbox selection anchor", () => {
  type Item = {id:string;channelId:string;content:string};
  const original:Item={id:"anchor",channelId:"channel-a",content:"original body"};
  type Props = Parameters<typeof useInboxSelectionAnchor<Item>>[0];
  async function mount(overrides:Partial<Props>={}) {
    let update!:(value:Partial<Props>)=>void;
    const firstPending:boolean[]=[];
    const recover=vi.fn<Props["recover"]>().mockResolvedValue(original);
    function Harness() {
      const [options,setOptions]=useState<Props>({feedItems:[],selectedEventId:original.id,scopeKey:"actor-a",
        membershipKey:"channel-a",isRetainedVisible:item=>item.channelId==="channel-a",recover,...overrides});
      update=value=>setOptions(previous=>({...previous,...value}));
      const result=useInboxSelectionAnchor(options);
      firstPending.push(result.coldResolutionPending);
      return <output data-pending={result.coldResolutionPending} data-failed={result.coldResolutionFailed}
        data-count={result.feedItems.length}>{result.activeLatchedItem?.content}</output>;
    }
    const view=await render(<Harness/>);
    return {view,recover,firstPending,update:async(value:Partial<Props>)=>act(async()=>update(value))};
  }
  it("keeps the original anchor when the representative advances but never makes a latch a visibility grant",async()=>{
    const f=await mount({feedItems:[original]});
    await f.update({feedItems:[{...original,id:"newer",content:"new representative"}]});
    expect(f.view.textContent).toBe(original.content);expect(f.recover).not.toHaveBeenCalled();
    await f.update({membershipKey:"",isRetainedVisible:()=>false});
    expect(f.view.textContent).toBe("");expect(f.recover).not.toHaveBeenCalled();
    await f.update({scopeKey:"actor-b",ready:false});
    expect(f.view.textContent).toBe("");expect(f.recover).not.toHaveBeenCalled();
  });
  it("protects the first cold render, keeps it out of the feed and retries only changed membership",async()=>{
    const f=await mount({membershipKey:"",isRetainedVisible:()=>false});
    expect(f.firstPending[0]).toBe(true);expect(f.view.textContent).toBe("");
    expect(f.view.querySelector("output")?.dataset.pending).toBe("false");
    await f.update({membershipKey:"channel-a",isRetainedVisible:()=>true});
    expect(f.recover).toHaveBeenCalledTimes(2);expect(f.view.textContent).toBe(original.content);
    expect(f.view.querySelector("output")?.dataset.count).toBe("0");
    await f.update({membershipKey:"",isRetainedVisible:()=>false});
    expect(f.view.textContent).toBe("");expect(f.recover).toHaveBeenCalledTimes(2);
    await f.update({membershipKey:"channel-a",isRetainedVisible:()=>true});
    expect(f.view.textContent).toBe(original.content);expect(f.recover).toHaveBeenCalledTimes(2);
  });
  it.each(["selection","snapshot","identity"] as const)("ignores a late cold response across %s changes",async change=>{
    let finish!:(value:Item)=>void;let signal!:AbortSignal;
    const recover=vi.fn<Props["recover"]>().mockImplementation((_id,value)=>{signal=value;return new Promise(resolve=>{finish=resolve;});});
    const f=await mount({recover});
    await f.update(change==="selection"?{selectedEventId:null}:change==="snapshot"?{recoveryKey:{},ready:false}:{scopeKey:"actor-b",ready:false});
    expect(signal.aborted).toBe(true);
    await act(async()=>finish(original));expect(f.view.textContent).toBe("");
    expect(recover).toHaveBeenCalledTimes(1);
  });
  it("retains terminal failure for the same attempt and admits a new Web snapshot without reusing old cold content",async()=>{
    const recover=vi.fn<Props["recover"]>().mockRejectedValueOnce(new Error("read denied")).mockResolvedValue(original);
    const f=await mount({recover});
    expect(f.view.querySelector("output")?.dataset.failed).toBe("true");
    await f.update({membershipKey:"channel-a,channel-b"});expect(recover).toHaveBeenCalledTimes(1);
    await f.update({recoveryKey:{}});expect(recover).toHaveBeenCalledTimes(2);expect(f.view.textContent).toBe(original.content);
    await f.update({ready:false});expect(f.view.textContent).toBe("");
  });
});

describe("original Buzz Inbox auto selection", () => {
  it("waits for actual data and measured width, preserves a visible selection and replaces a filtered selection", async () => {
    let update!: (options: Partial<Options>) => void;
    let select!: (id: string | null) => void;
    function Harness() {
      const [selected, setSelected] = useState<string | null>(null);
      const [options, setOptions] = useState<Partial<Options>>({ homeInboxWidthPx: 0, isLoading: true });
      update = value => setOptions(current => ({ ...current, ...value }));
      select = setSelected;
      useHomeInboxAutoSelection({ coldResolutionPending: false, filteredItems: items, hasFeed: true,
        hasPersonalSelection: false, homeInboxWidthPx: 1400, isLoading: false, isMessagesMode: true,
        isNarrowHomeViewport: false, selectedConversationId: selected, setAutoSelectedEventId: setSelected,
        urlSelectedItemId: null, ...options });
      return <output>{selected}</output>;
    }
    const view = await render(<Harness />);
    expect(view.textContent).toBe("");
    await act(async () => update({ isLoading: false }));
    expect(view.textContent).toBe("");
    await act(async () => update({ homeInboxWidthPx: 1400 }));
    expect(view.textContent).toBe("channel-a:root");
    await act(async () => select("channel-b:root"));
    expect(view.textContent).toBe("channel-b:root");
    await act(async () => update({ filteredItems: [items[0]!] }));
    expect(view.textContent).toBe("channel-a:root");
    await act(async () => update({ filteredItems: [] }));
    expect(view.textContent).toBe("");
  });

  it.each([
    { isNarrowHomeViewport: true },
    { coldResolutionPending: true },
    { hasFeed: false },
    { isLoading: true },
    { isMessagesMode: false },
    { hasPersonalSelection: true },
    { urlSelectedItemId: "explicit-event" },
  ])("does not invent an automatic selection while original conditions defer it: %j", async override => {
    function Harness() {
      const [selected, setSelected] = useState<string | null>(null);
      useHomeInboxAutoSelection({ coldResolutionPending: false, filteredItems: items, hasFeed: true,
        hasPersonalSelection: false, homeInboxWidthPx: 500, isLoading: false, isMessagesMode: true,
        isNarrowHomeViewport: false, selectedConversationId: selected, setAutoSelectedEventId: setSelected,
        urlSelectedItemId: null, ...override });
      return <output>{selected}</output>;
    }
    const view = await render(<Harness />);
    expect(view.textContent).toBe("");
  });
});
