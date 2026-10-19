// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/moderation/ui/MessageModerationMenuItems.tsx::MessageModerationMenuItems
// The five original moderator items on a message: time out author (1h/24h/7d), lift timeout,
// kick from channel, ban author, lift ban. DD-125(2): shown only to Tenant manage holders
// (original Community owner/admin); every click is a governed action re-admitted by Core.
// Actions target the raw signer, never a display author. An Agent author is not banned or
// timed out (its Installation is the authority, agent.installation.disable), and the
// original "kick" is the governed workspace.member.revoke of the author's membership.
import { Ban, CircleSlash, Clock, ShieldCheck, UserMinus } from "lucide-react";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { WorkspaceMembershipState } from "@client-kit/contracts";
import { TIMEOUT_PRESETS, kickCommand, memberCommand, memberRestrictionState, type ReportScope } from "../../moderation";
import { useBffClient, useHasPlatform, useT } from "../context";
import type { TimelineMessage } from "../messages/types";
import {
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
} from "../sidebar/dropdown-menu";
import { useCanModerate, useModerationRestrictionsQuery, useModerationRunner } from "./hooks";

type MessageModerationMenuItemsProps = {
  message: TimelineMessage;
  /** Where the message lives; kick is offered only in a Workspace channel. */
  scope: ReportScope;
  /** The viewer's signing key: a moderator does not act on their own messages. */
  selfPubkey?: string;
};

/** Moderator items need the host's platform session; without one nothing renders. */
export function MessageModerationMenuItems(props: MessageModerationMenuItemsProps) {
  return useHasPlatform() ? <ModeratorItems {...props} /> : null;
}

function ModeratorItems({ message, scope, selfPubkey }: MessageModerationMenuItemsProps) {
  const t = useT();
  const client = useBffClient();
  const queryClient = useQueryClient();
  const canModerate = useCanModerate();
  const targetPubkey = message.signerPubkey?.toLowerCase() ?? null;
  const isSelf = targetPubkey !== null && selfPubkey !== undefined && targetPubkey === selfPubkey.toLowerCase();
  const enabled = canModerate && targetPubkey !== null && !isSelf && message.isAgent !== true;
  const workspaceId = "workspaceId" in scope ? scope.workspaceId : null;
  const restrictionsQuery = useModerationRestrictionsQuery(enabled);
  // The same cached roster as the channel member list (channel-members rosterQueryKey).
  const rosterQuery = useQuery({
    queryKey: ["platform", "channel-members", workspaceId],
    queryFn: () => client.members(workspaceId ?? ""),
    enabled: enabled && workspaceId !== null,
  });
  const { run, isPending } = useModerationRunner();

  const author = React.useMemo(() => rosterQuery.data?.find((member) =>
    member.state === WorkspaceMembershipState.Active && member.pubkeys.some((key) => key.toLowerCase() === targetPubkey)),
  [rosterQuery.data, targetPubkey]);
  const state = memberRestrictionState(restrictionsQuery.data?.items, author?.pubkeys ?? (targetPubkey ? [targetPubkey] : []));

  if (!enabled || targetPubkey === null) return null;

  const kick = () => {
    if (!workspaceId || !author) return;
    void run({ intent: `kick:${workspaceId}:${author.principalId}`, build: (key) => kickCommand(workspaceId, author.principalId, key) },
      "moderation.toast.authorKicked").then((done) => {
      if (done) void queryClient.invalidateQueries({ queryKey: ["platform", "channel-members", workspaceId] });
    });
  };

  return (
    <>
      <DropdownMenuSeparator />
      {state.timedOut ? (
        <DropdownMenuItem
          data-testid={`message-untimeout-${message.id}`}
          disabled={isPending}
          onClick={() => void run({ intent: `untimeout:${targetPubkey}`, build: (key) => memberCommand("untimeout", targetPubkey, key) },
            "moderation.toast.timeoutLifted")}
        >
          <ShieldCheck className="h-4 w-4" />
          {t("moderation.liftTimeout")}
        </DropdownMenuItem>
      ) : (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-testid={`message-timeout-${message.id}`} disabled={isPending}>
            <Clock className="h-4 w-4" />
            {t("moderation.timeoutAuthor")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {TIMEOUT_PRESETS.map((preset) => (
              <DropdownMenuItem
                data-testid={`message-timeout-${preset.seconds}-${message.id}`}
                disabled={isPending}
                key={preset.seconds}
                onClick={() => void run({
                  intent: `timeout:${targetPubkey}:${preset.duration}`,
                  build: (key) => memberCommand("timeout", targetPubkey, key, preset.duration),
                }, "moderation.toast.authorTimedOut")}
              >
                {t(preset.label)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}

      {workspaceId && author ? (
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          data-testid={`message-kick-${message.id}`}
          disabled={isPending}
          onClick={kick}
        >
          <UserMinus className="h-4 w-4" />
          {t("moderation.kickFromChannel")}
        </DropdownMenuItem>
      ) : null}

      {state.banned ? (
        <DropdownMenuItem
          data-testid={`message-unban-${message.id}`}
          disabled={isPending}
          onClick={() => void run({ intent: `unban:${targetPubkey}`, build: (key) => memberCommand("unban", targetPubkey, key) },
            "moderation.toast.banLifted")}
        >
          <CircleSlash className="h-4 w-4" />
          {t("moderation.liftBan")}
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          data-testid={`message-ban-${message.id}`}
          disabled={isPending}
          onClick={() => void run({ intent: `ban:${targetPubkey}`, build: (key) => memberCommand("ban", targetPubkey, key) },
            "moderation.toast.authorBanned")}
        >
          <Ban className="h-4 w-4" />
          {t("moderation.banAuthor")}
        </DropdownMenuItem>
      )}
    </>
  );
}
