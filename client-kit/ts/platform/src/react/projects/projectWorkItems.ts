// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/projectWorkItems.ts::fetchProjectsWorkItems.
// Same canonical reducers and (repository, root) deduplication. Kailo reads the
// complete bounded history through the existing Projects host; a failed page
// cannot become an empty comments/status/assignment history.
import type { ProjectsQueryRequest } from "@client-kit/contracts";
import {getProjectInboxReference} from "../../inbox";
import type { PulseEvent } from "../pulse/host";
import { enumerateProjectEvents, loadProjectDirectory, type ProjectsHost } from "./projectEnumeration";
import type { Project, Repository } from "./projectModels";
import { getTag, projectIssueEventsToIssues, type ProjectIssue } from "./projectIssues.mjs";
import { projectPullRequestEventsToPullRequests, type ProjectPullRequest } from "./projectPullRequests.mjs";

export type ProjectInboxWorkItem =
  | {type: "issue"; project: Project; repository: Repository; issue: ProjectIssue}
  | {type: "pull-request"; project: Project; repository: Repository; pullRequest: ProjectPullRequest};

export function resolveProjectInboxWorkItem(items: readonly ProjectInboxWorkItem[], event: Pick<PulseEvent,"id"|"kind"|"tags">) {
  const reference=getProjectInboxReference(event);
  return reference?items.find(item=>item.repository.repoAddress===reference.repoAddress&&(item.type==="issue"?item.issue.id:item.pullRequest.id)===reference.rootId):undefined;
}

export function projectInboxMentions(snapshot: Awaited<ReturnType<typeof loadProjectWorkItems>>) {
  return snapshot.events.filter(event=>event.pubkey!==snapshot.viewerPubkey&&
    event.tags.some(tag=>tag[0]==="p"&&tag[1]===snapshot.viewerPubkey)&&
    resolveProjectInboxWorkItem(snapshot.items,event)).map(event=>({
      ...event,createdAt:event.created_at,channelId:null,channelName:"",category:"mention" as const,
    }));
}

export async function loadProjectWorkItems(host: ProjectsHost, signal: AbortSignal) {
  const directory = await loadProjectDirectory(host, signal);
  const addresses = [...new Set(directory.projects.flatMap(project => project.repositories.map(repository => repository.repoAddress)))];
  const fetchPage = async (request: ProjectsQueryRequest) => {
    signal.throwIfAborted();
    const page = await host.query(request);
    signal.throwIfAborted();
    if (page.limit !== directory.limit || page.pubkey !== directory.viewerPubkey || page.bindingVersion !== directory.bindingVersion) {
      throw new Error("Project scope changed");
    }
    const kinds = request.view === "WORK_ITEMS" ? [1618, 1621] : [1, 1619, 1630, 1631, 1632, 1633];
    if (page.events.some(event => !kinds.includes(event.kind) || !request.coordinates?.includes(getTag(event, "a") ?? ""))) {
      throw new Error("Project event scope changed");
    }
    return page.events;
  };
  const roots: PulseEvent[] = [], activity: PulseEvent[] = [];
  for (let index = 0; index < addresses.length; index += directory.limit) {
    const coordinates = addresses.slice(index, index + directory.limit);
    roots.push(...await enumerateProjectEvents(fetchPage, "WORK_ITEMS" as ProjectsQueryRequest["view"], directory.limit, signal, coordinates));
    activity.push(...await enumerateProjectEvents(fetchPage, "WORK_ITEM_ACTIVITY" as ProjectsQueryRequest["view"], directory.limit, signal, coordinates));
  }
  const items: ProjectInboxWorkItem[] = [];
  const seen = new Set<string>();
  for (const project of directory.projects) for (const repository of project.repositories) {
    const rootEvents = roots.filter(event => getTag(event, "a") === repository.repoAddress);
    const events = activity.filter(event => getTag(event, "a") === repository.repoAddress);
    const comments = events.filter(event => event.kind === 1);
    const statuses = events.filter(event => [1630, 1631, 1632, 1633].includes(event.kind));
    const issues = projectIssueEventsToIssues(rootEvents.filter(event => event.kind === 1621), statuses, comments);
    const pullRequests = projectPullRequestEventsToPullRequests(rootEvents.filter(event => event.kind === 1618), events.filter(event => event.kind === 1619), comments, statuses);
    for (const issue of issues) {
      const key = `${repository.repoAddress}:${issue.id}`;
      if (seen.has(key)) continue;
      seen.add(key); items.push({type: "issue", project, repository, issue});
    }
    for (const pullRequest of pullRequests) {
      const key = `${repository.repoAddress}:${pullRequest.id}`;
      if (seen.has(key)) continue;
      seen.add(key); items.push({type: "pull-request", project, repository, pullRequest});
    }
  }
  signal.throwIfAborted();
  return {items, events: [...roots, ...activity], viewerPubkey: directory.viewerPubkey};
}
