import type { ParsedEntityLink } from "./entityLink";
import type { ProjectsHost } from "./projectEnumeration";
import { loadProjectWorkItems, projectWorkItemTarget, type ProjectWorkItemTarget } from "./projectWorkItems";

/** The original coordinate is a reference, never an authorization context. */
export async function readProjectEntity(host: ProjectsHost, link: ParsedEntityLink, signal: AbortSignal) {
  if (link.type !== "issue" && link.type !== "pr") throw new Error("Project link target unavailable");
  const snapshot = await loadProjectWorkItems(host, signal);
  signal.throwIfAborted();
  const item = snapshot.items.find(item => item.repository.repoAddress === `30617:${link.owner}:${link.dtag}` &&
    (item.type === "issue" ? link.type === "issue" && item.issue.id === link.id : link.type === "pr" && item.pullRequest.id === link.id));
  if (!item) throw new Error("Project link target unavailable");
  return item;
}

export async function openProjectEntity(host: ProjectsHost, link: ParsedEntityLink, signal: AbortSignal,
  onOpen: (projectId: string, target: ProjectWorkItemTarget) => Promise<unknown>) {
  const item = await readProjectEntity(host, link, signal);
  signal.throwIfAborted();
  await onOpen(item.project.id, projectWorkItemTarget(item));
  signal.throwIfAborted();
}
