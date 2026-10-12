// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/lib/projectSelection.ts. Only the consumed Task
// discussion projection; Agent/chat and other selection actions remain absent.
export type ProjectSelectionItem = {
  channelId?: string | null;
  id: string;
  kind: "task";
  shareLink?: string | null;
  title: string;
};

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
