import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VirtualizedList } from "../src/react/forum/VirtualizedList";
import { click, render } from "./render";

const notes = [{ id: "first" }, { id: "second" }];
const listProps = {
  items: notes,
  estimateSize: 140,
  getItemKey: (note: (typeof notes)[number]) => note.id,
  renderItem: (note: (typeof notes)[number]) => <article>{note.id}</article>,
};

function CachedPulse() {
  const scrollRef = useRef<HTMLDivElement>(null);
  return <div data-scroll ref={scrollRef}>
    <VirtualizedList {...listProps} scrollRef={scrollRef} />
  </div>;
}

beforeEach(() => {
  // jsdom has no layout. Keep the real TanStack hook, ref attachment order,
  // range calculation and DOM measurement; supply only browser dimensions.
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-index") ? 140 : 420;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return new DOMRect(0, 0, 800, this.offsetHeight);
  });
});
afterEach(() => vi.restoreAllMocks());

describe("original virtualized list scroll-container attachment", () => {
  it("renders cached Pulse rows when the external ancestor ref attaches in the same commit, without resize", async () => {
    const host = await render(<CachedPulse />);
    expect([...host.querySelectorAll("article")].map((row) => row.textContent)).toEqual(["first", "second"]);
  });

  it("subscribes to the new external container after leaving and returning to cached Pulse", async () => {
    function Page() {
      const [visible, setVisible] = useState(true);
      return <><button onClick={() => setVisible((value) => !value)}>switch</button>
        {visible ? <CachedPulse /> : <p>another page</p>}</>;
    }
    const host = await render(<Page />);
    const previousScroll = host.querySelector("[data-scroll]");
    await click(host.querySelector("button")!);
    expect(host.querySelectorAll("article")).toHaveLength(0);
    await click(host.querySelector("button")!);
    expect(host.querySelector("[data-scroll]")).not.toBe(previousScroll);
    expect(host.querySelectorAll("article")).toHaveLength(2);
  });

  it("retains rows and floating-header rendering with its own scrolling container", async () => {
    function InternalList() {
      const headerRef = useRef<HTMLDivElement>(null);
      return <><div ref={headerRef} data-header />
        <VirtualizedList {...listProps} headerOverlayRef={headerRef}
          stickyHeader={(index) => <span>row {index}</span>} /></>;
    }
    const host = await render(<InternalList />);
    expect(host.querySelectorAll("article")).toHaveLength(2);
    expect(host.querySelector("[data-header]")?.textContent).toBe("row 0");
  });
});
