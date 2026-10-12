// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/lib/projectShareLinks.ts: original Issue/PR builders.
import { buildIssueLink, buildPullRequestLink, isLinkableCoordinate } from "./entityLink";
import type { ProjectIssue } from "./projectIssues.mjs";
import type { ProjectPullRequest } from "./projectPullRequests.mjs";

const HEX64_RE = /^[a-fA-F0-9]{64}$/;

function repositoryCoordinate(address: string | null | undefined) {
  if (!address) return null;
  const kindEnd = address.indexOf(":");
  if (kindEnd < 1) return null;
  const ownerEnd = address.indexOf(":", kindEnd + 1);
  if (ownerEnd < 0) return null;
  const kind = Number(address.slice(0, kindEnd));
  const owner = address.slice(kindEnd + 1, ownerEnd);
  const dtag = address.slice(ownerEnd + 1);
  if (kind !== 30617 || !HEX64_RE.test(owner) || !dtag) return null;
  return { owner: owner.toLowerCase(), dtag };
}

export function issueShareLink(issue: ProjectIssue): string | null {
  const coordinate = repositoryCoordinate(issue.repoAddress);
  return coordinate && HEX64_RE.test(issue.id) && isLinkableCoordinate(coordinate.owner, coordinate.dtag)
    ? buildIssueLink({ ...coordinate, id: issue.id }) : null;
}

export function pullRequestShareLink(pullRequest: ProjectPullRequest): string | null {
  const coordinate = repositoryCoordinate(pullRequest.repoAddress);
  return coordinate && HEX64_RE.test(pullRequest.id) && isLinkableCoordinate(coordinate.owner, coordinate.dtag)
    ? buildPullRequestLink({ ...coordinate, id: pullRequest.id }) : null;
}
