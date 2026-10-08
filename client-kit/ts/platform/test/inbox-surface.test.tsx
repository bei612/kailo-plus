import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useState, type ReactNode } from "react";
import { getLocale, setLocale } from "../src/i18n";
import { InboxDetailHeader, InboxEmptyDetail, InboxEmptyList, InboxLayout, InboxListHeader, InboxMessageRowSurface, InboxRowActionButton, InboxReopenStatus, useInboxDraftSelection, useInboxFocusHighlight } from "../src/react/inbox-surface";
import { TooltipProvider } from "../src/react/sidebar/tooltip";
import { click, render, settle } from "./render";

let previousLocale = getLocale();
beforeEach(() => { previousLocale = getLocale(); setLocale("en"); });
afterEach(() => act(() => setLocale(previousLocale)));

describe("original shared Inbox presentation", () => {
  it("fades the original selection once per conversation and clears its timer on unmount", async () => {
    vi.useFakeTimers();
    function FocusHighlight({conversationId}: {conversationId: string}) {
      const visible=useInboxFocusHighlight(conversationId);
      return <output>{visible ? "visible" : "faded"}</output>;
    }
    function Selection() {
      const [conversationId,setConversationId]=useState("first"), [mounted,setMounted]=useState(true), [revision,setRevision]=useState(0);
      return <><button onClick={()=>setConversationId("second")}>select</button><button onClick={()=>setRevision(revision+1)}>live update</button><button onClick={()=>setMounted(false)}>close</button>
        {mounted ? <FocusHighlight conversationId={conversationId} /> : null}</>;
    }
    try {
      const host=await render(<Selection />);
      expect(host.querySelector("output")?.textContent).toBe("visible");
      expect(vi.getTimerCount()).toBe(1);
      await act(async()=>vi.advanceTimersByTime(1_199));
      expect(host.querySelector("output")?.textContent).toBe("visible");
      await act(async()=>vi.advanceTimersByTime(1));
      expect(host.querySelector("output")?.textContent).toBe("faded");
      await click([...host.querySelectorAll("button")].find(button=>button.textContent==="live update")!);
      expect(host.querySelector("output")?.textContent).toBe("faded");
      expect(vi.getTimerCount()).toBe(0);
      await click([...host.querySelectorAll("button")].find(button=>button.textContent==="select")!);
      expect(host.querySelector("output")?.textContent).toBe("visible");
      expect(vi.getTimerCount()).toBe(1);
      await click([...host.querySelectorAll("button")].find(button=>button.textContent==="close")!);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("uses only each Inbox message's actual custom-emoji tags for original emoji-only sizing", async () => {
    const tags=[["emoji","buzz",new URL("emoji.png",window.location.href).href]];
    const message={id:"inbox-shortcode",author:"Actual author",body:"😀 :BUZZ:",pubkey:"author",depth:0,createdAt:1,time:"absolute time",tags};
    const body=(className:string)=><p className={className}>{message.body}</p>;
    const host=await render(<InboxMessageRowSurface message={message} renderBody={body} />);
    expect(host.querySelector('[data-testid="message-body"] p')?.classList.contains("text-4xl")).toBe(true);
    expect(host.querySelector('[data-testid="message-body"] p')?.classList.contains("[&_img[data-custom-emoji]]:h-[1.45em]")).toBe(true);
    for (const invalid of [{...message,tags:[]},{...message,body:"hello :buzz:"},{...message,body:":missing:"},{...message,body:":buzz"},{...message,body:"  "}]) {
      const plain=await render(<InboxMessageRowSurface message={invalid} customEmoji={[{shortcode:"buzz",url:tags[0]![2]!}]} renderBody={body} />);
      expect(plain.querySelector('[data-testid="message-body"] p')?.classList.contains("text-4xl")).toBe(false);
    }
  });

  it.each(["en", "zh-CN"] as const)("preserves original detail row anatomy and date/continuation presentation in %s", async locale => {
    setLocale(locale);
    const message={id:"inbox-original-row",author:"Actual author",body:"admitted content",pubkey:"author",depth:0,createdAt:1,time:"absolute time"};
    const identity=vi.fn((node:ReactNode,kind:"avatar"|"author")=><span data-identity-kind={kind}>{node}</span>);
    const body=vi.fn((className:string)=><p className={className}>{message.body}</p>);
    const host=await render(<InboxMessageRowSurface message={message} isSelected isFocusHighlightVisible
      fullTimestampLabel="absolute original label" renderIdentity={identity} renderBody={body}
      renderActions={()=> <button>original action</button>} />);
    const article=host.querySelector<HTMLElement>('[data-testid="home-inbox-selected-message"]')!;
    expect(article.classList.contains("mx-1")).toBe(true);
    expect(article.classList.contains("py-conversation-row")).toBe(true);
    expect(article.parentElement?.className).toBe("relative px-2");
    expect(article.parentElement?.querySelector('[aria-hidden="true"]')?.classList.contains("inset-x-3")).toBe(true);
    expect(article.querySelector('[data-testid="inbox-message-timestamp"]')?.getAttribute("title")).toBe("absolute original label");
    expect(article.querySelector('[data-testid="inbox-message-timestamp"]')?.textContent).toContain("1970");
    expect(article.querySelector('[data-testid="message-avatar"]')?.classList.contains("h-9")).toBe(true);
    expect(article.querySelector('[data-identity-kind="author"]')?.textContent).toBe("Actual author");
    expect(body).toHaveBeenCalledWith("max-w-full text-left text-message text-foreground");
    const continuation=await render(<InboxMessageRowSurface message={{...message,id:"continuation"}} isContinuation isFirst renderBody={body} renderActions={()=> <button>original action</button>} />);
    expect(continuation.querySelector('article')?.classList.contains("items-center")).toBe(true);
    expect(continuation.querySelector('[data-testid="message-header"]')).toBeNull();
    expect(continuation.querySelector('[data-testid="message-avatar"]')).toBeNull();
    expect(continuation.querySelector('[class*="absolute right-2"]')?.classList.contains("sm:-translate-y-1/2")).toBe(false);
    expect(continuation.querySelector('[data-testid="message-body"]')?.className).toBe("mt-0");
    const emoji=await render(<InboxMessageRowSurface message={{...message,id:"emoji-only",body:"😀 😀"}}
      renderBody={className=><p className={className}>😀 😀</p>} />);
    expect(emoji.querySelector('[data-testid="message-body"] p')?.classList.contains("text-4xl")).toBe(true);
    expect(emoji.querySelector('[data-testid="message-body"] p')?.classList.contains("[&_img[data-custom-emoji]]:h-[1.45em]")).toBe(true);
  });

  it("retains original filter-specific empty states in both languages", async () => {
    const host = await render(<><InboxEmptyList filter="mention" unreadOnly={false} /><InboxEmptyList filter="thread" unreadOnly /><InboxEmptyList filter="all" unreadOnly={false} /></>);
    expect(host.textContent).toContain("No mentions found");
    expect(host.textContent).toContain("No unread threads");
    expect(host.textContent).toContain("Switch back to All to see other activity.");
    expect(host.textContent).toContain("New activity will appear here.");
    await act(async () => setLocale("zh-CN"));
    expect(host.textContent).toContain("未找到提及");
    expect(host.textContent).toContain("没有未读话题");
  });

  it.each([1, 2])("announces the original active-draft count %s without fabricating unsupported filters", async count => {
    const host = await render(<InboxListHeader filter="all" activeDraftCount={count} onFilterChange={vi.fn()} unreadOnly={false} onUnreadOnlyChange={vi.fn()} unreadCount={0} onMarkAllRead={vi.fn()} />);
    expect(host.querySelector('[data-testid="inbox-filter-trigger"]')?.getAttribute("aria-label")).toBe(`Filter inbox: All. ${count} active draft${count === 1 ? "" : "s"}`);
    await act(async () => setLocale("zh-CN"));
    expect(host.querySelector('[data-testid="inbox-filter-trigger"]')?.getAttribute("aria-label")).toContain(`${count} 份活跃草稿`);
  });

  it("shares original wide/narrow draft auto-selection and clears selection when leaving Drafts", async () => {
    function DraftSelection() {
      const [width, setWidth] = useState(0), [enabled, setEnabled] = useState(true);
      const [selectedKey, setSelectedKey] = useState<string | null>(null);
      const [items, setItems] = useState([{entry:{key:"first"}}, {entry:{key:"second"}}]);
      useInboxDraftSelection({items, selectedKey, setSelectedKey, autoSelect:true, selectionEnabled:enabled, viewportWidthPx:width, isNarrowHomeViewport:width<1000});
      return <><output>{selectedKey ?? "none"}</output><button onClick={()=>setWidth(500)}>narrow</button><button onClick={()=>setWidth(1400)}>wide</button><button onClick={()=>setItems(items.slice(1))}>delete first</button><button onClick={()=>setEnabled(false)}>leave</button></>;
    }
    const host = await render(<DraftSelection />);
    const press = (text: string) => click([...host.querySelectorAll("button")].find(button=>button.textContent===text)!);
    expect(host.querySelector("output")?.textContent).toBe("none");
    await press("narrow"); expect(host.querySelector("output")?.textContent).toBe("none");
    await press("wide"); expect(host.querySelector("output")?.textContent).toBe("first");
    await press("delete first"); expect(host.querySelector("output")?.textContent).toBe("second");
    await press("leave"); expect(host.querySelector("output")?.textContent).toBe("none");
  });
  it("keeps original reopen retry separate from row selection and does not label UNKNOWN a failure",async()=>{
    const retry=vi.fn(),select=vi.fn();
    const host=await render(<div onClick={select}><InboxReopenStatus id="dm" pending={false} error unknown onRetry={retry}/></div>);
    expect(host.querySelector('[role="status"]')?.className).toContain("text-muted-foreground");
    await click(host.querySelector("button")!);expect(retry).toHaveBeenCalledOnce();expect(select).not.toHaveBeenCalled();
  });
  it("retains both list/detail slots, original header backdrop and resettable resize handle", async () => {
    const reset = vi.fn();
    const host = await render(<InboxLayout listWidth={365} showList showDetail onResize={vi.fn()} onReset={reset}>
      <section>admitted list</section><InboxEmptyDetail />
    </InboxLayout>);
    expect(host.querySelector("[data-testid=home-inbox]")?.className).toContain("grid-cols-[var(--home-inbox-list-width)_minmax(0,1fr)]");
    expect(host.querySelector("[data-testid=home-inbox-shared-header-backdrop]")).not.toBeNull();
    expect(host.textContent).toContain("Select a message");
    const handle = host.querySelector<HTMLButtonElement>("[data-testid=home-inbox-list-resize-handle]")!;
    handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("keeps the original Agents filter identifier and reads its same-source bilingual label", async () => {
    const host = await render(<InboxListHeader filter="agent_activity" onFilterChange={vi.fn()} unreadOnly={false} onUnreadOnlyChange={vi.fn()} unreadCount={0} onMarkAllRead={vi.fn()} />);
    expect(host.querySelector('[data-testid="inbox-filter-trigger"]')?.textContent).toBe("Agents");
    await act(async () => setLocale("zh-CN"));
    expect(host.querySelector('[data-testid="inbox-filter-trigger"]')?.textContent).toBe("Agent");
  });

  it("shows original options and invokes the existing mark-all callback, without inventing Web drafts", async () => {
    const markAll = vi.fn();
    const host = await render(<InboxListHeader filter="all" onFilterChange={vi.fn()} unreadOnly={false} onUnreadOnlyChange={vi.fn()} unreadCount={2} onMarkAllRead={markAll} />);
    expect(host.querySelector("select")).toBeNull();
    await click(host.querySelector<HTMLButtonElement>("[data-testid=inbox-options-trigger]")!);
    await settle();
    expect(document.querySelector("[data-testid=inbox-unread-only-toggle]")).not.toBeNull();
    await click([...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.startsWith("Mark all as read"))!);
    expect(markAll).toHaveBeenCalledOnce();
  });

  it("keeps row actions separate from selection and wires detail back/open callbacks", async () => {
    const select = vi.fn(); const mark = vi.fn(); const back = vi.fn(); const open = vi.fn();
    const host = await render(<TooltipProvider><div onClick={select}><InboxRowActionButton label="mark" onClick={mark}>mark</InboxRowActionButton></div>
      <InboxDetailHeader title="Admitted channel" openLabel="open context" onOpen={open} onBack={back} /></TooltipProvider>);
    await click(host.querySelector<HTMLButtonElement>("button[aria-label=mark]")!);
    expect(mark).toHaveBeenCalledOnce(); expect(select).not.toHaveBeenCalled();
    await click(host.querySelector<HTMLButtonElement>('button[aria-label="Back to inbox list"]')!);
    await click(host.querySelector<HTMLButtonElement>("[data-testid=home-inbox-context-title]")!);
    expect(back).toHaveBeenCalledOnce(); expect(open).toHaveBeenCalledOnce();
  });
});
