// DD-125(10), SF-BUZ-58(3): Buzz desktop/src/features/agent-memory/lib/buildMemoryGraph.ts order.
import { describe, expect, it } from "vitest";
import { buildMemoryGraph, orderMemoryEntries, type MemoryListEntry, type MemoryReferences } from "../src/react/memory-order";

let serial = 0;
const entry = (slug: string, outgoingRefs: string[] = [], tombstone = false): MemoryListEntry => ({
  slug, eventId: (++serial).toString(16).padStart(64, "0"), createdAt: serial, tombstone,
  ...(tombstone ? {} : { outgoingRefs }),
});
const refs = (coreRefs: string[], dangling: MemoryReferences["dangling"] = [], coreExists = true): MemoryReferences =>
  ({ coreExists, coreRefs, dangling });
const slugs = (list: readonly MemoryListEntry[]) => list.map((item) => item.slug);

describe("Agent memory reference order", () => {
  it("orders core's ref tree in preorder, then unreferenced memories by slug", () => {
    const list = [entry("mem/z-orphan"), entry("mem/b", ["mem/b/child"]), entry("mem/a-orphan"),
      entry("mem/b/child"), entry("mem/a")];
    const order = orderMemoryEntries(list, refs(["mem/b", "mem/a"]));
    expect(slugs(order.entries)).toEqual(["mem/b", "mem/b/child", "mem/a", "mem/a-orphan", "mem/z-orphan"]);
    expect(order.coreExists).toBe(true);
    expect(order.missingLinks.size).toBe(0);
  });

  it("skips cycles and self refs, and hangs a shared child under the first parent reached", () => {
    const list = [entry("mem/a", ["mem/a", "mem/shared", "mem/b"]), entry("mem/b", ["mem/shared", "mem/a", "core"]),
      entry("mem/shared", ["mem/b"])];
    const graph = buildMemoryGraph(list, refs(["mem/a", "mem/b"]));
    expect(graph.rootedTree?.children.map((child) => child.slug)).toEqual(["mem/a"]);
    expect(graph.rootedTree?.children[0]?.children.map((child) => child.slug)).toEqual(["mem/shared"]);
    expect(graph.rootedTree?.children[0]?.children[0]?.children.map((child) => child.slug)).toEqual(["mem/b"]);
    expect(graph.orphans).toEqual([]);
    expect(graph.dangling).toEqual([]);
    expect(slugs(orderMemoryEntries(list, refs(["mem/a", "mem/b"])).entries)).toEqual(["mem/a", "mem/shared", "mem/b"]);
  });

  it("without core, every live memory is an orphan sorted by slug and [[core]] is missing", () => {
    const list = [entry("mem/c"), entry("mem/a", ["core"]), entry("mem/b")];
    const order = orderMemoryEntries(list, refs([], [{ slug: "core", referencedBy: ["mem/a"] }], false));
    expect(order.coreExists).toBe(false);
    expect(slugs(order.entries)).toEqual(["mem/a", "mem/b", "mem/c"]);
    expect(order.missingLinks.get("mem/a")).toEqual(["core"]);
    expect(buildMemoryGraph(list, refs([], [], false)).rootedTree).toBeNull();
  });

  it("marks dangling refs (absent or tombstoned targets) per entry and keeps tombstones last by slug", () => {
    const list = [entry("mem/gone", [], true), entry("mem/a", ["mem/missing", "mem/gone", "mem/b"]),
      entry("mem/b", ["mem/missing"]), entry("mem/orphan", ["mem/elsewhere"]), entry("mem/archived", [], true)];
    const order = orderMemoryEntries(list, refs(["mem/a", "mem/nowhere"]));
    expect(slugs(order.entries)).toEqual(["mem/a", "mem/b", "mem/orphan", "mem/archived", "mem/gone"]);
    expect(order.dangling).toEqual([
      { slug: "mem/elsewhere", referencedBy: ["mem/orphan"] },
      { slug: "mem/gone", referencedBy: ["mem/a"] },
      { slug: "mem/missing", referencedBy: ["mem/a", "mem/b"] },
      { slug: "mem/nowhere", referencedBy: ["core"] },
    ]);
    expect(order.missingLinks.get("core")).toEqual(["mem/nowhere"]);
    expect(order.missingLinks.get("mem/a")).toEqual(["mem/missing", "mem/gone"]);
    expect(order.missingLinks.get("mem/b")).toEqual(["mem/missing"]);
    expect(order.missingLinks.get("mem/orphan")).toEqual(["mem/elsewhere"]);
    expect(order.missingLinks.has("mem/gone")).toBe(false);
  });
});
