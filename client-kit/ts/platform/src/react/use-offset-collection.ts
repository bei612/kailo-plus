// DD-168 (.design/20 §16.2): a list whose BFF read is offset-paged without a total is read to
// its end (bounded) so the table can state an exact total and page locally. When the bound is
// reached the set is marked partial: the footer says so and offers to load more; it never
// presents a prefix as the whole list.
import { useState } from "react";
import { type Loaded, useLoad } from "./use-load";

export type OffsetPage<T> = { items: readonly T[]; nextOffset?: number };
export type OffsetCollection<T> = { items: T[]; complete: boolean };

/** Bounded read of every page: at most `pages` requests per round. */
export function useOffsetCollection<T>(key: string, fetchPage: (offset: number) => Promise<OffsetPage<T>>, options: { pages?: number } = {}): {
  state: Loaded<OffsetCollection<T>>;
  reload: () => void;
  loadMore: () => void;
} {
  const step = options.pages ?? 10;
  const [budget, setBudget] = useState(step);
  const [state, reload] = useLoad(`${key}:pages=${budget}`, async () => {
    const items: T[] = [];
    let offset = 0;
    for (let i = 0; i < budget; i++) {
      const page = await fetchPage(offset);
      items.push(...page.items);
      const next = page.nextOffset;
      if (next === undefined) return { items, complete: true };
      if (!Number.isSafeInteger(next) || next <= offset) throw new Error("Invalid page offset");
      offset = next;
    }
    return { items, complete: false };
  }, { keepWhileRevalidating: true });
  return { state, reload, loadMore: () => setBudget((value) => value + step) };
}
