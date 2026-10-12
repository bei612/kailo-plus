// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/IssueAssigneesRow.tsx::IssueAssigneesRow.
// Only the original self-service branch is admitted here. Author/owner assignment
// of other people and managed-agent signing remain separate un-restored consumers.
import { X } from "lucide-react";
import { useUiT } from "../context";
import { normalizePubkey, truncateNpub } from "../conversations/pubkey";
import type { UserProfileLookup } from "../messages/system/identity";
import { UserAvatar } from "../messages/UserAvatar";
import { Button } from "../profile/buzz/shared/ui/button";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "../sidebar/tooltip";
import type { ProjectIssue } from "./projectIssues.mjs";

export function IssueAssigneesRow({ issue, profiles, viewerPubkey, pending, recoveryOperation, onAssign, onUnassign }: {
  issue: ProjectIssue;
  profiles?: UserProfileLookup;
  viewerPubkey: string | null;
  pending: boolean;
  recoveryOperation?: "assign" | "unassign";
  onAssign: () => void;
  onUnassign: () => void;
}) {
  const t = useUiT();
  const viewer = viewerPubkey ? normalizePubkey(viewerPubkey) : null;
  // Preserve only this operation's pre-confirmation control until its original
  // event is proven. Other assignees still come directly from the fresh reducer.
  const displayedAssignees = viewer && recoveryOperation ? [
    ...issue.assignees.filter(pubkey=>normalizePubkey(pubkey)!==viewer),
    ...(recoveryOperation==="unassign"?[viewer]:[]),
  ] : issue.assignees;
  const canSelfAssign = viewer !== null && !displayedAssignees.some(pubkey => normalizePubkey(pubkey) === viewer);
  if (displayedAssignees.length === 0 && !canSelfAssign) return null;
  return <div className="min-w-0 text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
    {displayedAssignees.map(pubkey => {
      const profile = profiles?.[normalizePubkey(pubkey)];
      const label = profile?.displayName?.trim() || profile?.nip05Handle?.trim() || truncateNpub(pubkey);
      const canUnassign = viewer !== null && normalizePubkey(pubkey) === viewer;
      const avatar = <UserAvatar accent={profile?.isAgent === true} avatarUrl={profile?.avatarUrl ?? null}
        displayName={label} shape={profile?.isAgent ? "squircle" : "circle"} size="xs"/>;
      return <Tooltip key={pubkey}>
        <TooltipTrigger asChild>
          {canUnassign ? <button
            aria-label={t("projects.assignment.unassignPerson", { name: label })}
            className={cn("group relative inline-flex rounded-full focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring")}
            data-testid={`project-issue-unassign-${normalizePubkey(pubkey)}`} disabled={pending}
            onClick={onUnassign} type="button">
            {avatar}
            <span className={cn("absolute inset-0 flex items-center justify-center bg-background/80 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100",
              profile?.isAgent ? "rounded-squircle" : "rounded-full")}><X className="h-3 w-3 text-foreground"/></span>
          </button> : <span className="inline-flex">{avatar}</span>}
        </TooltipTrigger>
        <TooltipContent>{t(canUnassign ? "projects.assignment.unassignPerson" : "projects.task.assigned", { name: label })}</TooltipContent>
      </Tooltip>;
    })}
    {canSelfAssign ? <Button
      className="h-5 px-0 text-xs text-primary hover:bg-transparent hover:text-primary hover:underline"
      data-testid="project-issue-self-assign" disabled={pending} onClick={onAssign}
      size="xs" type="button" variant="ghost">{t("projects.assignment.self")}</Button> : null}
  </div>;
}
