// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/lib/projectBranches.ts. Same branch-name rules, default-branch
// resolution and management state; messages come from the shared catalog. The local-checkout
// inputs stay optional because this host has no local repository (DD-118).
import { translateCurrent as t } from "../../../i18n";

const BRANCH_CHARACTERS = /^[A-Za-z0-9/_.-]+$/;

/** Normalize a branch name using the native command's conservative rules. */
export function normalizeProjectBranchName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("refs/") && !trimmed.startsWith("refs/heads/")) {
    return null;
  }
  const branch = trimmed.replace(/^refs\/heads\//, "");
  if (
    !branch ||
    branch.startsWith("-") ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.endsWith(".lock") ||
    branch.includes("..") ||
    branch.includes("//") ||
    !BRANCH_CHARACTERS.test(branch) ||
    branch.split("/").some((component) => component.startsWith("."))
  ) {
    return null;
  }
  return branch;
}

export function projectBranchNameError(
  value: string,
  existingBranches: string[],
): string | null {
  const branch = normalizeProjectBranchName(value);
  if (!branch) return t("projects.branch.invalidName");
  if (existingBranches.includes(branch)) {
    return t("projects.branch.exists");
  }
  return null;
}

export function projectBranchOptions(
  remoteBranches: string[],
  localBranches: string[] = [],
): string[] {
  return [...new Set([...remoteBranches, ...localBranches].filter(Boolean))];
}

export function projectBranchCreationReason(input: {
  activeBranch: string | null;
  activeBranchCommit: string | null;
  localHead?: string | null;
}): string | null {
  if (!input.activeBranch) return t("projects.branch.chooseFirst");
  if (input.activeBranchCommit) return null;
  // Original local-head branch ("Push the first local commit…") needs a local checkout.
  return t("projects.branch.firstCommit");
}

/** Resolve a usable default branch when a repository advertises a stale HEAD. */
export function resolveProjectDefaultBranch(
  announcedBranch: string,
  repoState?: {
    branches: Array<{ name: string }>;
    head: string | null;
  } | null,
): string {
  if (!repoState || repoState.branches.length === 0) {
    return repoState?.head ?? announcedBranch;
  }
  const published = new Set(repoState.branches.map((branch) => branch.name));
  if (repoState.head && published.has(repoState.head)) return repoState.head;
  if (published.has(announcedBranch)) return announcedBranch;
  if (published.has("main")) return "main";
  if (published.has("master")) return "master";
  return repoState.branches[0]?.name ?? announcedBranch;
}

export function projectBranchManagementState(input: {
  activeBranch: string | null;
  defaultBranch: string | null;
  branches: Array<{ name: string; commit: string }>;
  remoteBranch?: string | null;
  remoteHead?: string | null;
  snapshotCommit?: string | null;
  hasOpenPullRequest: boolean;
}) {
  const activeRemoteBranch =
    input.branches.find((branch) => branch.name === input.activeBranch) ?? null;
  const activeBranchCommit =
    activeRemoteBranch?.commit ??
    (input.remoteBranch === input.activeBranch ? input.remoteHead : null) ??
    input.snapshotCommit ??
    null;
  const deleteBranchReason = !input.activeBranch
    ? t("projects.branch.chooseFirst")
    : input.activeBranch === input.defaultBranch
      ? t("projects.branch.defaultUndeletable")
      : !activeRemoteBranch
        ? t("projects.branch.remoteOnly")
        : input.hasOpenPullRequest
          ? t("projects.branch.closeReviewFirst")
          : null;
  return { activeBranchCommit, activeRemoteBranch, deleteBranchReason };
}
