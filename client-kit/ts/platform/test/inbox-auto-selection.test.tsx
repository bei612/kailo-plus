import { act, useState } from "react";
import { describe, expect, it } from "vitest";
import { useHomeInboxAutoSelection } from "../src/react/use-inbox-auto-selection";
import { render } from "./render";

type Options = Parameters<typeof useHomeInboxAutoSelection>[0];
const items = [{ id: "channel-a:root", conversationId: "channel-a:root" }, { id: "channel-b:root", conversationId: "channel-b:root" }];

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
