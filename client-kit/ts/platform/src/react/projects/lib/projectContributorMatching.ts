// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/lib/projectContributorMatching.ts::signedProjectContributorPubkeys,
// projectContributorActivityCounts and commitAuthorPubkeysFromPullRequests, unchanged.
// The Git author/profile matchers have no shared consumer yet and stay in the fixed source.

type SignedProjectContributorSources = {
  owner: string;
  contributors: readonly string[];
  pullRequests: readonly {
    author: string;
    initialCommit?: string | null;
    commit?: string | null;
    comments: readonly { author: string }[];
    approvals: readonly { author: string }[];
    updates: readonly { author: string; commit: string | null }[];
  }[];
  issues: readonly {
    author: string;
    comments: readonly { author: string }[];
  }[];
};

export type ProjectContributorActivityCounts = {
  commits: number;
  reviews: number;
  tasks: number;
};

/**
 * Collects identities tied to a repository by its announcement or by signed
 * project activity. Assignments and recipients are intentionally excluded:
 * being asked to review or own a task is not itself a contribution.
 */
export function signedProjectContributorPubkeys({
  owner,
  contributors,
  pullRequests,
  issues,
}: SignedProjectContributorSources): string[] {
  return [
    ...new Set(
      [
        owner,
        ...contributors,
        ...pullRequests.flatMap((pullRequest) => [
          pullRequest.author,
          ...pullRequest.comments.map((comment) => comment.author),
          ...pullRequest.approvals.map((approval) => approval.author),
          ...pullRequest.updates.map((update) => update.author),
        ]),
        ...issues.flatMap((issue) => [
          issue.author,
          ...issue.comments.map((comment) => comment.author),
        ]),
      ]
        .filter(Boolean)
        .map((pubkey) => pubkey.trim().toLowerCase()),
    ),
  ];
}

/** Counts signed repository activity by actor for contributor list columns. */
export function projectContributorActivityCounts({
  owner,
  contributors,
  pullRequests,
  issues,
}: SignedProjectContributorSources): Record<
  string,
  ProjectContributorActivityCounts
> {
  const counts = Object.fromEntries(
    signedProjectContributorPubkeys({
      owner,
      contributors,
      pullRequests,
      issues,
    }).map((pubkey) => [pubkey, { commits: 0, reviews: 0, tasks: 0 }]),
  );
  const ensureCounts = (rawPubkey: string) => {
    const pubkey = rawPubkey.trim().toLowerCase();
    const existing = counts[pubkey];
    if (existing) return existing;
    const created = { commits: 0, reviews: 0, tasks: 0 };
    counts[pubkey] = created;
    return created;
  };

  for (const pubkey of commitAuthorPubkeysFromPullRequests(
    pullRequests,
  ).values()) {
    ensureCounts(pubkey).commits += 1;
  }
  for (const pullRequest of pullRequests) {
    ensureCounts(pullRequest.author).reviews += 1;
  }
  for (const issue of issues) {
    ensureCounts(issue.author).tasks += 1;
  }
  return counts;
}


/**
 * Map commit hashes to the Nostr pubkey that published them through pull
 * request events. Unlike git author strings, this association is backed by a
 * signed relay event, so it is the preferred identity source for commits.
 */
export function commitAuthorPubkeysFromPullRequests(
  pullRequests: readonly {
    author: string;
    initialCommit?: string | null;
    commit?: string | null;
    updates?: readonly { author: string; commit: string | null }[];
  }[],
) {
  const byHash = new Map<string, string>();
  for (const pullRequest of pullRequests) {
    if (pullRequest.initialCommit) {
      byHash.set(pullRequest.initialCommit.toLowerCase(), pullRequest.author);
    }
    if (pullRequest.commit) {
      byHash.set(pullRequest.commit.toLowerCase(), pullRequest.author);
    }
    // Updates last: they carry the precise publisher for each pushed commit.
    for (const update of pullRequest.updates ?? []) {
      if (update.commit) {
        byHash.set(update.commit.toLowerCase(), update.author);
      }
    }
  }
  return byHash;
}
