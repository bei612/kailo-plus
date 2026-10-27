import type { ParsedEntityLink } from "./entityLink";
import { loadProjectDirectory, type ProjectsHost } from "./projectEnumeration";
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

/** Resolve only against the current admitted directory, including its deletion fold.
 * A coordinate is a reference, never a tenant, signer or Git authorization. */
export async function readProjectLinkTarget(host: ProjectsHost, link: ParsedEntityLink, signal: AbortSignal) {
  if (link.type === "issue" || link.type === "pr") {
    const item = await readProjectEntity(host, link, signal);
    return { projectId: item.project.id, target: projectWorkItemTarget(item),
      title: item.type === "issue" ? item.issue.title : item.pullRequest.title };
  }
  const { projects } = await loadProjectDirectory(host, signal);
  signal.throwIfAborted();
  const address = `${link.type === "project" ? 30621 : 30617}:${link.owner}:${link.dtag}`;
  if (link.type === "project") {
    const project = projects.find(candidate => candidate.projectAddress === address);
    if (!project) throw new Error("Project link target unavailable");
    return { projectId: project.id, target: { ...(link.tab ? { tab: link.tab } : {}) } as ProjectWorkItemTarget,
      title: project.name };
  }
  const project = projects.find(candidate => candidate.repositories.some(repository => repository.repoAddress === address));
  const repository = project?.repositories.find(candidate => candidate.repoAddress === address);
  if (!project || !repository) throw new Error("Project link target unavailable");
  return { projectId: project.id, target: { repositoryId: repository.id,
    ...(link.tab ? { tab: link.tab } : {}), ...(link.commitHash ? { commitHash: link.commitHash } : {}) },
    title: repository.name };
}

export async function openProjectEntity(host: ProjectsHost, link: ParsedEntityLink, signal: AbortSignal,
  onOpen: (projectId: string, target: ProjectWorkItemTarget) => Promise<unknown>) {
  const destination = await readProjectLinkTarget(host, link, signal);
  signal.throwIfAborted();
  await onOpen(destination.projectId, destination.target);
  signal.throwIfAborted();
}
