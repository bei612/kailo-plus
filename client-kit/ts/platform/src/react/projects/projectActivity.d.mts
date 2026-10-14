import type { PulseEvent as RelayEvent } from "../pulse/host";
import type { Repository } from "./projectModels";

export type ProjectActivitySummary = {
  repoAddress: string;
  issueCount: number;
  prCount: number;
  commitCount: number;
  activityCount: number;
  updatedAt: number;
  participantPubkeys: string[];
  latestCommit: {
    author: string | null;
    commit: string;
    createdAt: number;
    title: string;
  } | null;
  /** Activity event counts bucketed by local-time day key ("YYYY-MM-DD"). */
  activityByDay: Record<string, number>;
};

export function summarizeProjectActivityEvents(
  events: RelayEvent[],
  projects: Pick<Repository, "repoAddress">[],
): Record<string, ProjectActivitySummary>;
