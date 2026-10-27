// Fixed Buzz ProjectDetailScreen::handleUpdatePullRequest and repoSyncHooks::usePushProjectLocalRepositoryMutation.
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useUiT } from "../context";
import { isOutcomeUnknown } from "../../transport";
import type { ProjectsHost } from "./projectEnumeration";
import type { Repository } from "./projectModels";
import type { ProjectPullRequest } from "./projectPullRequests.mjs";
import { canPublishProjectPullRequestUpdate, publishProjectPullRequestUpdate, readProjectPullRequestUpdateIntent } from "./pullRequestUpdates";

function normalizeRepositoryUrl(url: string) {
  try { const parsed = new URL(url); return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${parsed.pathname.replace(/\/+$/, "").replace(/\.git$/i, "").toLowerCase()}`; }
  catch { return url.trim().replace(/\/+$/, "").replace(/\.git$/i, "").toLowerCase(); }
}
/** Original exact branch + clone association; ambiguous reviews do not choose one arbitrarily. */
function projectBranchReview(repository: Repository, reviews: ProjectPullRequest[], branch: string) {
  const clones = new Set(repository.cloneUrls.map(normalizeRepositoryUrl));
  const matches = reviews.filter(review => review.repoAddress === repository.repoAddress && review.branchName === branch
    && review.cloneUrls.some(url => clones.has(normalizeRepositoryUrl(url))));
  return matches.length === 1 ? matches[0]! : null;
}
export function openProjectBranchReview(repository: Repository, reviews: ProjectPullRequest[], branch: string) {
  const review = projectBranchReview(repository, reviews, branch);
  return review?.status === "Open" || review?.status === "Draft" ? review : null;
}

export function useProjectPullRequestUpdate({ host, projectId, repository, reviews, viewer, branch, readOnly }: {
  host: ProjectsHost; projectId?: string; repository: Repository; reviews: ProjectPullRequest[];
  viewer?: string; branch: string; readOnly: boolean;
}) {
  const t = useUiT(), cache = useQueryClient();
  const owner = React.useMemo(() => ({ controller: new AbortController(), busy: false }), [host, projectId, repository.repoAddress, viewer, branch, readOnly]);
  React.useEffect(() => { if (owner.controller.signal.aborted) owner.controller = new AbortController(); setPending(false); return () => owner.controller.abort(); }, [owner]);
  const readOnlyRef = React.useRef(readOnly); readOnlyRef.current = readOnly;
  const [pending, setPending] = React.useState(false);
  const [, refresh] = React.useReducer(value => value + 1, 0);
  const review = projectBranchReview(repository, reviews, branch);
  const enabled = Boolean(host.publish && projectId && viewer);
  const run = async (target: ProjectPullRequest, input: { commit: string; mergeBase: string | null }) => {
    if (!enabled || !projectId || !viewer || owner.busy || owner.controller.signal.aborted || readOnlyRef.current) return;
    owner.busy = true; setPending(true);
    try {
      const result = await publishProjectPullRequestUpdate(host, projectId, repository, target, viewer, input, owner.controller.signal);
      owner.controller.signal.throwIfAborted();
      if (result) { cache.setQueryData(["project-home-work-items", host.scopeKey, projectId], result.snapshot); result.complete(); }
      toast.success(t(result ? "projects.review.updated" : "projects.review.current"));
    } catch (error) {
      if (!owner.controller.signal.aborted) toast.error(t(isOutcomeUnknown(error) ? "projects.review.unknown" : "projects.review.updateFailed"));
    } finally { owner.busy = false; if (!owner.controller.signal.aborted) { setPending(false); refresh(); } }
  };
  // Captured owner and branch stay attached to this push, never the next rendered identity/repository.
  const afterPush = async (result: { branch: string; commit: string; mergeBase?: string | null }) => {
    if (owner.controller.signal.aborted || readOnlyRef.current) return;
    const target = openProjectBranchReview(repository, reviews, result.branch);
    if (target) await run(target, { commit: result.commit, mergeBase: result.mergeBase ?? null });
  };
  const action = (remoteHead: string | null, mergeBase: string | null) => {
    if (!enabled || !projectId || !viewer || !review || readOnly || !canPublishProjectPullRequestUpdate(viewer, repository, review)) return undefined;
    let retained: ReturnType<typeof readProjectPullRequestUpdateIntent> = null, invalid = false;
    try { retained = readProjectPullRequestUpdateIntent(host, projectId, repository, review, viewer); } catch { invalid = true; }
    if (!retained && !invalid && (review.status !== "Open" && review.status !== "Draft" || !remoteHead || remoteHead === review.commit)) return undefined;
    return { pending, onClick: () => { if (invalid) { toast.error(t("projects.review.unknown")); return; }
      const commit = retained?.commit ?? remoteHead;
      if (commit) void run(review, { commit, mergeBase: retained?.mergeBase ?? mergeBase }); } };
  };
  return { afterPush: enabled ? afterPush : undefined, action };
}
