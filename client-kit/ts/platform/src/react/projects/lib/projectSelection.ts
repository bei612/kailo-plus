// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/lib/projectSelection.ts: the clustered overview/detail selection
// that drives the context pod (state transitions, shift-range and group toggles, presentation,
// share links and the Task/Review/Project/Repository/Channel/Commit item builders), plus the
// discussion projection the project Agent chat context serializes (DD-130). User-facing labels
// are i18n keys resolved by the count menu; the Agent payload nouns stay English (KIND_NOUNS).
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

export type ProjectSelectionState = {
  anchorId: string | null;
  items: ProjectSelectionItem[];
};

export const EMPTY_PROJECT_SELECTION: ProjectSelectionState = { anchorId: null, items: [] };

export type ProjectSelectionActionId = "chat-agent" | "copy" | "create-review" | "discuss";

export type ProjectSelectionAction = {
  id: ProjectSelectionActionId;
  /** Catalog key of the original label (the menu translates it). */
  labelKey: "projects.agentChat.chatWithAgent" | "projects.discuss.channel" | "projects.selection.createReview"
    | "projects.selection.createReviews" | "buzz.copyLink" | "projects.selection.copyLinks";
  testId: string;
};

export type ProjectSelectionPresentation = {
  actions: ProjectSelectionAction[];
  people: string[];
  kind: ProjectSelectionKind;
  count: number;
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

/** Agent-facing title (original projectSelectionTitle); the UI title is translated by the menu. */
export function projectSelectionTitle(items: ProjectSelectionItem[]) {
  const kind = items[0]?.kind;
  if (items.length === 0 || !kind) return "";
  return `${items.length} ${projectSelectionNoun(kind, items.length)}`;
}

export function nextProjectSelection(
  current: ProjectSelectionState,
  item: ProjectSelectionItem,
  options?: { rangeItems?: ProjectSelectionItem[]; shiftKey?: boolean },
): ProjectSelectionState {
  const currentKind = current.items[0]?.kind;
  if (currentKind && currentKind !== item.kind) return { anchorId: item.id, items: [item] };
  if (options?.shiftKey && current.anchorId && options.rangeItems) {
    const ordered = options.rangeItems.filter(candidate => candidate.kind === item.kind);
    const from = ordered.findIndex(candidate => candidate.id === current.anchorId);
    const to = ordered.findIndex(candidate => candidate.id === item.id);
    if (from >= 0 && to >= 0) {
      return { anchorId: current.anchorId, items: ordered.slice(Math.min(from, to), Math.max(from, to) + 1) };
    }
  }
  if (current.items.some(candidate => candidate.id === item.id)) {
    const items = current.items.filter(candidate => candidate.id !== item.id);
    return { anchorId: items.at(-1)?.id ?? null, items };
  }
  return { anchorId: item.id, items: [...current.items, item] };
}

export function nextProjectGroupSelection(current: ProjectSelectionState, groupItems: ProjectSelectionItem[]): ProjectSelectionState {
  const kind = groupItems[0]?.kind;
  if (!kind) return current;
  const items = groupItems.filter(item => item.kind === kind);
  if (items.length === 0) return current;
  const currentItems = current.items[0]?.kind === kind ? current.items : [];
  const groupIds = new Set(items.map(item => item.id));
  const allSelected = items.every(item => currentItems.some(candidate => candidate.id === item.id));
  const nextItems = allSelected
    ? currentItems.filter(item => !groupIds.has(item.id))
    : [...currentItems, ...items.filter(item => !currentItems.some(candidate => candidate.id === item.id))];
  return { anchorId: nextItems.at(-1)?.id ?? null, items: nextItems };
}

export function projectSelectionPeople(items: ProjectSelectionItem[]) {
  return [...new Set(items.flatMap(item => (item.people ?? []).filter(pubkey => pubkey.trim().length > 0)))];
}

export function projectSelectionShareLinks(items: ProjectSelectionItem[]) {
  return [...new Set(items.map(item => item.shareLink?.trim() ?? "").filter(link => link.length > 0))];
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

export function projectSelectionPresentation(items: ProjectSelectionItem[]): ProjectSelectionPresentation | null {
  const kind = items[0]?.kind;
  if (items.length === 0 || !kind) return null;
  const actions: ProjectSelectionAction[] = [
    { id: "chat-agent", labelKey: "projects.agentChat.chatWithAgent", testId: "projects-selection-chat-agent" },
    { id: "discuss", labelKey: "projects.discuss.channel", testId: "projects-selection-discuss" },
  ];
  if (kind === "commit") {
    actions.push({ id: "create-review", labelKey: items.length === 1 ? "projects.selection.createReview" : "projects.selection.createReviews",
      testId: "projects-selection-create-review" });
  }
  if (projectSelectionShareLinks(items).length > 0) {
    actions.push({ id: "copy", labelKey: items.length === 1 ? "buzz.copyLink" : "projects.selection.copyLinks", testId: "projects-selection-copy" });
  }
  return { actions, people: projectSelectionPeople(items), kind, count: items.length };
}

export function selectionItemFromProject(input: {
  channelId?: string | null; id: string; owner?: string | null; shareLink?: string | null; title: string;
}): ProjectSelectionItem {
  return { channelId: input.channelId ?? null, id: `project:${input.id}`, kind: "project",
    people: input.owner ? [input.owner] : [], shareLink: input.shareLink ?? null, title: input.title };
}

export function selectionItemFromRepository(input: {
  channelId?: string | null; id: string; owner?: string | null; shareLink?: string | null; title: string;
}): ProjectSelectionItem {
  return { channelId: input.channelId ?? null, id: `repository:${input.id}`, kind: "repository",
    people: input.owner ? [input.owner] : [], shareLink: input.shareLink ?? null, title: input.title };
}

export function selectionItemFromChannel(input: { channelId: string; people?: string[]; title: string }): ProjectSelectionItem {
  return { channelId: input.channelId, id: `channel:${input.channelId}`, kind: "channel", people: input.people ?? [], shareLink: null, title: input.title };
}

export function selectionItemFromCommit(input: {
  author?: string | null; channelId?: string | null; commitHash: string; projectId: string; shareLink?: string | null; title: string;
}): ProjectSelectionItem {
  return { channelId: input.channelId ?? null, id: `commit:${input.projectId}:${input.commitHash}`, kind: "commit",
    people: input.author ? [input.author] : [], shareLink: input.shareLink ?? null, title: input.title };
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
