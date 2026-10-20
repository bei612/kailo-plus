// DD-125(10), SF-BUZ-58(3): the original Agent memory panel order, not a graph view.
// Ported from Buzz desktop/src/features/agent-memory/lib/buildMemoryGraph.ts and
// MemorySection::flattenTreeDescendants. Core extracts `[[slug]]` refs with the original
// `extract_refs` inside the same `agent.memory.entry.list` admission and returns only the
// refs (never bodies); this module only orders the COMPLETE listing the client already holds.
import type { AgentMemoryEntryPage } from "@client-kit/contracts";

export type MemoryListEntry = AgentMemoryEntryPage["entries"][number];
export type MemoryReferences = NonNullable<AgentMemoryEntryPage["references"]>;

/** A ref target that no loaded live entry (nor an existing core) answers. */
export type MemoryDanglingRef = { slug: string; referencedBy: string[] };

/** Node of the reachability tree rooted at `core`; `slug === "core"` only for the root. */
export type MemoryTreeNode = { slug: string; entry: MemoryListEntry | null; children: MemoryTreeNode[] };

export type MemoryGraph = {
  /** Tree rooted at `core`; null when the agent has no core memory. */
  rootedTree: MemoryTreeNode | null;
  /** Live memories not reachable from `core`, sorted by slug. */
  orphans: MemoryListEntry[];
  /** Refs that did not resolve to a loaded live entry, sorted by slug. */
  dangling: MemoryDanglingRef[];
};

const refsOf = (entry: MemoryListEntry): readonly string[] => entry.outgoingRefs ?? [];

/**
 * Original buildMemoryGraph: preorder DFS from `core`; the visited set skips cycles and
 * self-refs, so a child shared by two parents lives under the first one reached. Tombstones
 * never take part — a ref to a tombstoned slug is dangling, as in the original.
 */
export function buildMemoryGraph(entries: readonly MemoryListEntry[], references: MemoryReferences): MemoryGraph {
  const live = entries.filter((entry) => !entry.tombstone);
  const bySlug = new Map<string, MemoryListEntry | null>();
  // `core` is in the index too, so a `[[core]]` back-reference resolves (rare but possible).
  if (references.coreExists) bySlug.set("core", null);
  for (const entry of live) bySlug.set(entry.slug, entry);

  const visited = new Set<string>();
  const danglingMap = new Map<string, string[]>();
  const recordDangling = (slug: string, referencedBy: string) => {
    const list = danglingMap.get(slug);
    if (!list) danglingMap.set(slug, [referencedBy]);
    else if (!list.includes(referencedBy)) list.push(referencedBy);
  };

  const buildNode = (slug: string, entry: MemoryListEntry | null, refs: readonly string[]): MemoryTreeNode => {
    visited.add(slug);
    const children: MemoryTreeNode[] = [];
    for (const ref of refs) {
      if (!bySlug.has(ref)) { recordDangling(ref, slug); continue; }
      if (visited.has(ref)) continue;
      const target = bySlug.get(ref) ?? null;
      children.push(buildNode(ref, target, ref === "core" ? references.coreRefs : target ? refsOf(target) : []));
    }
    return { slug, entry, children };
  };

  const rootedTree = references.coreExists ? buildNode("core", null, references.coreRefs) : null;
  const orphans = live.filter((entry) => !visited.has(entry.slug)).sort((a, b) => a.slug.localeCompare(b.slug));
  // Orphans can cite refs too; walk them (no tree) so the dangling list is complete.
  for (const orphan of orphans) for (const ref of refsOf(orphan)) if (!bySlug.has(ref)) recordDangling(ref, orphan.slug);
  const dangling = [...danglingMap.entries()].map(([slug, referencedBy]) => ({ slug, referencedBy }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  return { rootedTree, orphans, dangling };
}

function flattenTreeDescendants(node: MemoryTreeNode): MemoryListEntry[] {
  const out: MemoryListEntry[] = [];
  for (const child of node.children) {
    if (child.entry) out.push(child.entry);
    out.push(...flattenTreeDescendants(child));
  }
  return out;
}

export type MemoryOrder = {
  coreExists: boolean;
  /** Cold-list order: core's ref tree in preorder, then orphans by slug, then tombstones by slug. */
  entries: MemoryListEntry[];
  /** Per live entry (and `core`): its refs that are missing, in the entry's ref order. */
  missingLinks: ReadonlyMap<string, string[]>;
  dangling: MemoryDanglingRef[];
};

/**
 * Panel order for a COMPLETE listing. Core is rendered on its own above the cold list, so
 * only its descendants appear here. Kailo keeps showing tombstone heads (the original drops
 * them before ordering); they do not take part and follow the ordered entries by slug.
 */
export function orderMemoryEntries(entries: readonly MemoryListEntry[], references: MemoryReferences): MemoryOrder {
  const graph = buildMemoryGraph(entries, references);
  // Core's own dangling list and the local resolution answer the same question over the
  // same snapshot; either one marks the link as missing.
  const danglingSlugs = new Set([...graph.dangling, ...references.dangling].map((ref) => ref.slug));
  const missingLinks = new Map<string, string[]>();
  const mark = (slug: string, refs: readonly string[]) => {
    const missing = [...new Set(refs.filter((ref) => danglingSlugs.has(ref)))];
    if (missing.length) missingLinks.set(slug, missing);
  };
  if (references.coreExists) mark("core", references.coreRefs);
  for (const entry of entries) if (!entry.tombstone) mark(entry.slug, refsOf(entry));
  const tombstones = entries.filter((entry) => entry.tombstone).sort((a, b) => a.slug.localeCompare(b.slug));
  return {
    coreExists: references.coreExists,
    entries: [...(graph.rootedTree ? flattenTreeDescendants(graph.rootedTree) : []), ...graph.orphans, ...tombstones],
    missingLinks,
    dangling: graph.dangling,
  };
}
