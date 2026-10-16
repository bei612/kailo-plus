// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/hooks.ts::RepoState/eventToRepoState/fetchRepoState/useRepoStateQuery.
// DD-118: the trusted kind-30618 state (signed by the coordinate owner or the Relay itself) comes
// from the Projects host query view REPOSITORY_STATES; the BFF applies the original author filter.
// The original client-side parsing is unchanged. The query key is scoped to the host session.
import { useQuery } from "@tanstack/react-query";
import { ProjectsQueryRequestView } from "@client-kit/contracts";
import type { PulseEvent as RelayEvent } from "../pulse/host";
import type { ProjectsHost } from "./projectEnumeration";
import type { Repository } from "./projectModels";

export const KIND_REPO_STATE = 30618;

export type RepoState = {
  branches: Array<{ name: string; commit: string }>;
  tags: Array<{ name: string; commit: string }>;
  head: string | null;
  updatedAt: number;
};

export function eventToRepoState(event: RelayEvent): RepoState {
  const branches: RepoState["branches"] = [];
  const tags: RepoState["tags"] = [];
  let head: string | null = null;

  for (const tag of event.tags) {
    const [name, value] = tag;
    if (!name || !value) continue;

    if (name.startsWith("refs/heads/")) {
      branches.push({ name: name.slice("refs/heads/".length), commit: value });
    } else if (name.startsWith("refs/tags/")) {
      tags.push({ name: name.slice("refs/tags/".length), commit: value });
    } else if (name === "HEAD") {
      head = value.replace(/^ref:\s*/, "").replace(/^refs\/heads\//, "");
    }
  }

  return {
    branches,
    tags,
    head,
    updatedAt: event.created_at,
  };
}

/** The replaceable 30618 head for this repository: newest, then lowest event ID (the original `limit: 1`). */
export function selectRepoStateEvent(events: RelayEvent[], repository: Pick<Repository, "dtag">): RelayEvent | null {
  return events
    .filter(event => event.kind === KIND_REPO_STATE && event.tags.some(tag => tag[0] === "d" && tag[1] === repository.dtag))
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0] ?? null;
}

/** Load the trusted relay state used to resolve a repository's live refs. */
export async function fetchRepoState(host: ProjectsHost, project: Repository): Promise<RepoState | null> {
  const page = await host.query({ view: ProjectsQueryRequestView.RepositoryStates, coordinates: [project.repoAddress] });
  if (!page || !Array.isArray(page.events)) throw new Error("Invalid repository state");
  const event = selectRepoStateEvent(page.events, project);
  return event ? eventToRepoState(event) : null;
}

export function useRepoStateQuery(host: ProjectsHost, project: Repository | null | undefined) {
  return useQuery({
    enabled: Boolean(project),
    queryKey: ["project", host.scopeKey, project?.id ?? "none", "repo-state"],
    queryFn: () => {
      if (!project) throw new Error("No project selected.");
      return fetchRepoState(host, project);
    },
    staleTime: 30_000,
  });
}
