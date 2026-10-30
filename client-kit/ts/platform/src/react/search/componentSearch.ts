// DD-138(5), 07 §4.8.4 呈现与打开: component content in Kailo 「搜索全部」. Results are grouped
// and labelled by their source's presentation category (云盘/知识工程/数据建模), never a component or
// binding; an UNAVAILABLE source shows a short muted note. Opening loads that category's native
// page entry (bindingId resolved by Core) at the result's relative path.
import { ComponentSearchResultKind, ComponentSearchSourceState, NativePageCategory, type ComponentSearchPage } from "@client-kit/contracts";
import { File, FileText, Folder, LayoutDashboard, Library, MessageCircleQuestion, Search, type LucideIcon } from "lucide-react";

export type ComponentSearchHit = ComponentSearchPage["results"][number];
export type ComponentSearchSourceStatus = ComponentSearchPage["sources"][number];

/** Same order as the sidebar entries. */
export const COMPONENT_SEARCH_CATEGORY_ORDER: readonly string[] = [
  NativePageCategory.FileStorage, NativePageCategory.Knowledge, NativePageCategory.DataQuery,
];

export type ComponentSearchGroup = { category: string; results: ComponentSearchHit[] };

function categoryRank(category: string): number {
  const index = COMPONENT_SEARCH_CATEGORY_ORDER.indexOf(category);
  return index === -1 ? COMPONENT_SEARCH_CATEGORY_ORDER.length : index;
}

/** One group per presentation category in sidebar order; result order inside a group is Core's. */
export function groupComponentSearchResults(results: readonly ComponentSearchHit[]): ComponentSearchGroup[] {
  const groups = new Map<string, ComponentSearchHit[]>();
  for (const result of results) {
    const category = String(result.nativePageCategory);
    groups.set(category, [...(groups.get(category) ?? []), result]);
  }
  return [...groups.entries()].sort(([left], [right]) => categoryRank(left) - categoryRank(right))
    .map(([category, entries]) => ({ category, results: entries }));
}

/** Categories whose source answered UNAVAILABLE in this search, in sidebar order, once each. */
export function unavailableComponentSources(sources: readonly ComponentSearchSourceStatus[] | undefined): string[] {
  const categories = new Set((sources ?? []).filter((source) => source.state === ComponentSearchSourceState.Unavailable)
    .map((source) => String(source.nativePageCategory)));
  return [...categories].sort((left, right) => categoryRank(left) - categoryRank(right));
}

/** Shape check of a search page; malformed pages count as a failed (unavailable) search. */
export function validComponentSearchPage(value: unknown): value is ComponentSearchPage {
  if (typeof value !== "object" || value === null) return false;
  const page = value as Record<string, unknown>;
  return Array.isArray(page.results) && Array.isArray(page.sources)
    && page.results.every((entry: unknown) => {
      if (typeof entry !== "object" || entry === null) return false;
      const item = entry as Record<string, unknown>;
      return typeof item.bindingId === "string" && typeof item.nativePageCategory === "string" && typeof item.kind === "string"
        && typeof item.title === "string" && typeof item.path === "string"
        && (item.summary === undefined || typeof item.summary === "string")
        && (item.updatedAt === undefined || typeof item.updatedAt === "string");
    })
    && page.sources.every((entry: unknown) => typeof entry === "object" && entry !== null
      && typeof (entry as Record<string, unknown>).nativePageCategory === "string"
      && typeof (entry as Record<string, unknown>).state === "string");
}

export function componentSearchIcon(kind: string): LucideIcon {
  switch (kind) {
    case ComponentSearchResultKind.File: return File;
    case ComponentSearchResultKind.Folder: return Folder;
    case ComponentSearchResultKind.Document: return FileText;
    case ComponentSearchResultKind.KnowledgeBase: return Library;
    case ComponentSearchResultKind.Question: return MessageCircleQuestion;
    case ComponentSearchResultKind.Dashboard: return LayoutDashboard;
    default: return Search;
  }
}
