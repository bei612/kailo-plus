// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/buildProjectsViewAgentContext.ts
// (DD-130(4)): the visible items of the current Projects overview section, as the project Agent
// chat's overview context. Values are the viewer's already-read projections; the payload
// builder neutralizes and caps them.
import type { DiscoverableWorkspace } from "@client-kit/contracts";
import type { ProjectsOverviewAgentContextItem } from "./lib/projectDetailAgentContext";
import { collectProjectRelatedChannelRows } from "./lib/projectRelatedChannels";
import type { Project } from "./projectModels";
import type { ProjectInboxWorkItem } from "./projectWorkItems";
import type { ProjectsFilter } from "./ProjectsToolbar";

export type ProjectsViewAgentContextInput = {
  /** Activity overview items (filter "all"), from buildProjectsActivityAgentContextItems. */
  activityItems: ProjectsOverviewAgentContextItem[];
  /** The viewer's admitted channel directory rows (filter "channels"). */
  channels: readonly DiscoverableWorkspace[];
  filter: ProjectsFilter;
  projects: Project[];
  visibleIssues: Extract<ProjectInboxWorkItem, { type: "issue" }>[];
  visibleProjects: Project[];
  visiblePullRequests: Extract<ProjectInboxWorkItem, { type: "pull-request" }>[];
  visibleRepositories: Array<{ project: Project; repository: Project["repositories"][number] }>;
};

function detail(parts: Array<string | number | null | undefined>) {
  return parts.filter(part => part !== null && part !== undefined && part !== "").join(" · ");
}

export function buildProjectsViewAgentContextItems({
  activityItems,
  channels,
  filter,
  projects,
  visibleIssues,
  visibleProjects,
  visiblePullRequests,
  visibleRepositories,
}: ProjectsViewAgentContextInput): ProjectsOverviewAgentContextItem[] {
  if (filter === "all") return activityItems;
  if (filter === "projects") {
    return visibleProjects.map(project => ({
      detail: detail([project.description, `${project.repositories.length} repositories`]),
      kind: "project",
      reference: project.id,
      title: project.name,
    }));
  }
  if (filter === "repositories") {
    return visibleRepositories.map(({ project, repository }) => ({
      detail: detail([repository.description, `Project: ${project.name}`]),
      kind: "repository",
      reference: repository.repoAddress,
      title: repository.name,
    }));
  }
  if (filter === "issues") {
    return visibleIssues.map(({ issue, project, repository }) => ({
      detail: detail([`Project: ${project.name}`, `Repository: ${repository.name}`, issue.status, issue.content]),
      kind: "task",
      reference: issue.id,
      title: issue.title,
    }));
  }
  if (filter === "prs") {
    return visiblePullRequests.map(({ project, pullRequest, repository }) => ({
      detail: detail([`Project: ${project.name}`, `Repository: ${repository.name}`, pullRequest.status, pullRequest.content]),
      kind: "review",
      reference: pullRequest.id,
      title: pullRequest.title,
    }));
  }
  const channelsById = new Map(channels.map(row => [row.channel.channelId, row]));
  return collectProjectRelatedChannelRows(projects).map(row => {
    const channel = channelsById.get(row.channelId);
    return {
      detail: detail([
        `Project: ${row.projectName}`,
        row.repositoryName ? `Repository: ${row.repositoryName}` : null,
        channel?.channel.description,
        channel ? `${channel.memberCount} members` : null,
      ]),
      kind: "channel",
      reference: row.channelId,
      title: `#${channel?.channel.name ?? row.channelId.slice(0, 8)}`,
    };
  });
}
