// Reused from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/ui/TeamIdentityCard.tsx.
// Members are the Definitions the reader can discover (DD-131(1)); hidden members only add to
// the "+N" overflow. The original footer model label (Auto / Mixed models) is the member count:
// a Definition carries no model (the route is per AgentVersion). The original symlink/version
// badges belong to local team files and are not rendered (DD-24).
import type { ReactNode } from "react";
import { Info, Users } from "lucide-react";

import type { AgentDefinitionView } from "@client-kit/contracts";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../sidebar/tooltip";
import { useUiT } from "../context";
import { IdentityInitialsAvatar } from "./IdentityInitialsAvatar";

type TeamIdentityCardProps = {
  actions: ReactNode;
  children?: ReactNode;
  className?: string;
  dataTestId: string;
  description?: string | null;
  memberCount: number;
  members: AgentDefinitionView[];
  teamName: string;
};

const MAX_VISIBLE_MEMBER_AVATARS = 4;

export function TeamIdentityCard({
  actions,
  children,
  className,
  dataTestId,
  description,
  memberCount,
  members,
  teamName,
}: TeamIdentityCardProps) {
  const t = useUiT();
  const trimmedDescription = description?.trim();

  return (
    <div
      className={cn("min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-card p-0 text-card-foreground shadow-xs transition-colors hover:border-border hover:bg-muted/65", className)}
      data-testid={dataTestId}
    >
      <div className="relative aspect-[4/5] min-w-0 overflow-hidden bg-muted/50">
        <div className="absolute top-3 left-3 z-30 flex max-w-[calc(100%-4rem)] flex-wrap items-center gap-1.5">
          {trimmedDescription ? (
            <TooltipProvider><Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label={t("agentTeams.descriptionLabel", { name: teamName })}
                  className="flex h-6 w-6 items-center justify-center rounded-full border border-border/65 bg-background/90 text-muted-foreground shadow-xs"
                  type="button"
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p>{trimmedDescription}</p>
              </TooltipContent>
            </Tooltip></TooltipProvider>
          ) : null}
        </div>

        <div className="absolute top-3 right-3 z-40">{actions}</div>

        <TeamAvatarRow memberCount={memberCount} members={members} teamName={teamName} />

        <div className="absolute right-3 bottom-3 left-3 z-30 flex min-w-0 flex-col gap-0.5 text-left text-sm leading-5">
          <span className="min-w-0 truncate font-semibold tracking-normal text-foreground">{teamName}</span>
          <span className="min-w-0 truncate font-normal text-secondary-foreground/75">
            {t(memberCount === 1 ? "agentTeams.memberCount.one" : "agentTeams.memberCount.other", { count: memberCount })}
          </span>
        </div>
      </div>
      {children}
    </div>
  );
}

function TeamAvatarRow({ memberCount, members, teamName }: {
  memberCount: number;
  members: AgentDefinitionView[];
  teamName: string;
}) {
  const t = useUiT();
  const visibleMembers = members.slice(0, MAX_VISIBLE_MEMBER_AVATARS);
  const overflowCount = Math.max(0, memberCount - visibleMembers.length);
  const stackItemCount = visibleMembers.length + (overflowCount > 0 ? 1 : 0);

  if (visibleMembers.length === 0 && overflowCount === 0) {
    return (
      <div className="absolute inset-x-4 top-0 bottom-12 flex items-center justify-center">
        <div className="relative h-24 w-24 before:rounded-squircle before:absolute before:-inset-px before:bg-border/65 before:content-['']">
          <div className="relative z-10 flex h-full w-full items-center justify-center rounded-squircle bg-background/80 text-muted-foreground shadow-xs"
            data-team-empty-avatar="avatar">
            <Users className="h-9 w-9" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-x-0 top-0 bottom-12 flex items-center justify-center">
      <div aria-label={t("agentTeams.memberAvatars", { name: teamName })} className="flex max-w-full items-center justify-center px-4" role="img">
        {visibleMembers.map((member, index) => (
          <div
            className={`relative h-14 w-14 before:rounded-squircle before:absolute before:-inset-0.5 before:bg-card before:content-[''] ${index > 0 ? "-ml-5" : ""}`}
            data-team-member-avatar="avatar"
            key={member.resourceId}
            style={{ zIndex: index + 1 }}
          >
            <div className="relative z-10 h-full w-full">
              <IdentityInitialsAvatar className="border-0 shadow-none" colorIndex={index} label={member.displayName} size={56} />
            </div>
          </div>
        ))}
        {overflowCount > 0 ? (
          <div className={visibleMembers.length > 0 ? "-ml-5" : ""} style={{ zIndex: stackItemCount }}>
            <span className="flex h-14 w-14 items-center justify-center rounded-squircle bg-card text-sm font-semibold text-muted-foreground ring-2 ring-card">
              +{overflowCount}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
