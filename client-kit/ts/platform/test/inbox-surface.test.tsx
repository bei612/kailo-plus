import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { getLocale, setLocale } from "../src/i18n";
import { InboxDetailHeader, InboxEmptyDetail, InboxEmptyList, InboxLayout, InboxListHeader, InboxRowActionButton, InboxReopenStatus, useInboxDraftSelection } from "../src/react/inbox-surface";
import { TooltipProvider } from "../src/react/sidebar/tooltip";
import { click, render, settle } from "./render";

let previousLocale = getLocale();
beforeEach(() => { previousLocale = getLocale(); setLocale("en"); });
afterEach(() => act(() => setLocale(previousLocale)));

describe("original shared Inbox presentation", () => {
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
