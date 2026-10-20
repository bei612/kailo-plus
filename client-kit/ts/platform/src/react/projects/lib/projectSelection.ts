// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/lib/projectSelection.ts. The consumed Task/Review
// discussion projection plus the original kind nouns and Task/Review selection-item
// builders that the project Agent chat context serializes (DD-130). The overview
// multi-select state and its count menu remain with the multi-select restoration.
export type ProjectSelectionKind =
  | "channel"
  | "commit"
  | "project"
  | "repository"
  | "review"
  | "task";

export type ProjectSelectionItem = {
  channelId?: string | null;
  id: string;
  kind: ProjectSelectionKind;
  people?: string[];
  shareLink?: string | null;
  title: string;
};

// Original KIND_NOUNS: Agent-facing payload wording, identical in every UI locale.
const KIND_NOUNS: Record<ProjectSelectionKind, [string, string]> = {
  channel: ["channel", "channels"],
  commit: ["commit", "commits"],
  project: ["project", "projects"],
  repository: ["repository", "repositories"],
  review: ["review", "reviews"],
  task: ["task", "tasks"],
};

export function projectSelectionNoun(kind: ProjectSelectionKind, count: number) {
  const [singular, plural] = KIND_NOUNS[kind];
  return count === 1 ? singular : plural;
}

export function projectSelectionChannelCandidates(items: ProjectSelectionItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const channelId = item.channelId?.trim() ?? "";
    if (!channelId) continue;
    counts.set(channelId, (counts.get(channelId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([channelId, count]) => ({ channelId, count }))
    .sort((left, right) => right.count - left.count || left.channelId.localeCompare(right.channelId));
}

export function projectSelectionDiscussContent(items: ProjectSelectionItem[], heading: string) {
  if (items.length === 0) return "";
  const links = [...new Set(items.map(item => item.shareLink?.trim() ?? "").filter(link => link.length > 0))];
  const lines = links.length > 0 ? links : items.map(item => item.title);
  return `${heading}\n\n${lines.join("\n")}`;
}

export function mergeSelectionDiscussDraft(existing: string | undefined, next: string) {
  const current = existing?.trim() ?? "";
  if (!current) return next;
  if (current.includes(next.trim())) return existing ?? next;
  return `${current}\n\n${next}`;
}

export function selectionItemFromTask(input: {
  author?: string | null;
  channelId?: string | null;
  id: string;
  shareLink?: string | null;
  title: string;
}): ProjectSelectionItem {
  return {
    channelId: input.channelId ?? null,
    id: `task:${input.id}`,
    kind: "task",
    people: input.author ? [input.author] : [],
    shareLink: input.shareLink ?? null,
    title: input.title,
  };
}

export function selectionItemFromReview(input: {
  author?: string | null;
  channelId?: string | null;
  id: string;
  shareLink?: string | null;
  title: string;
}): ProjectSelectionItem {
  return {
    channelId: input.channelId ?? null,
    id: `review:${input.id}`,
    kind: "review",
    people: input.author ? [input.author] : [],
    shareLink: input.shareLink ?? null,
    title: input.title,
  };
}
