// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/user-status/ui/UserNameIndicators.tsx. Huddles are not offered on governed
// channels (SS-BUZ-GOVERNANCE), so only the status indicator is restored. Without a presence host
// (no admitted transport) nothing renders; a status is never inferred.
import * as React from "react";

import { useUiT } from "../../context";
import { normalizePubkey } from "../../conversations/pubkey";
import { usePresenceHost } from "../../presence/context";
import { cn } from "../../profile/buzz/shared/lib/cn";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../sidebar/tooltip";
import { newestVisibleUserStatus, useUserStatusQuery } from "../hooks";
import { useUserStatusLookupContext } from "../UserStatusLookupContext";
import { DEFAULT_USER_STATUS_EMOJI, StatusEmoji } from "./StatusEmoji";

type UserNameIndicatorsProps = {
  className?: string;
  pubkey: string | undefined;
  /** Every admitted key of the person (DD-120 (5)); the newest visible status wins. */
  pubkeys?: readonly string[];
  size?: "chat" | "dm";
};

export function UserNameIndicators(props: UserNameIndicatorsProps) {
  const host = usePresenceHost();
  const hasKey = Boolean(props.pubkey) || (props.pubkeys?.length ?? 0) > 0;
  return host && hasKey ? <HostedUserNameIndicators {...props} /> : null;
}

function HostedUserNameIndicators({
  className,
  pubkey,
  pubkeys,
  size = "chat",
}: UserNameIndicatorsProps) {
  const t = useUiT();
  const keysId = [...new Set((pubkeys?.length ? pubkeys : [pubkey ?? ""])
    .map((key) => normalizePubkey(key)).filter(Boolean))].sort().join(":");
  const normalizedPubkeys = React.useMemo(() => (keysId ? keysId.split(":") : []), [keysId]);
  const sharedStatus = useUserStatusLookupContext();
  const registerStatus = sharedStatus?.register;
  React.useEffect(() => {
    if (!registerStatus) return;
    const releases = normalizedPubkeys.map((key) => registerStatus(key));
    return () => { for (const release of releases) release(); };
  }, [normalizedPubkeys, registerStatus]);
  const fallbackStatusQuery = useUserStatusQuery(
    !sharedStatus ? normalizedPubkeys : [],
  );
  const lookup = sharedStatus?.lookup ?? fallbackStatusQuery.data;
  const status = newestVisibleUserStatus(lookup, normalizedPubkeys);
  const statusEmoji = status?.emoji || DEFAULT_USER_STATUS_EMOJI;
  const indicatorTextClass =
    size === "dm" ? "text-status-indicator" : "text-sm";
  const statusEmojiClass = size === "dm" ? "size-status-indicator" : "size-3.5";

  if (!status) return null;

  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-0.5", className)}
      data-testid="user-name-indicators"
    >
      <TooltipProvider>
        <Tooltip disableHoverableContent>
          <TooltipTrigger asChild>
            <span
              aria-label={`${statusEmoji} ${status.text || t("userStatus.fallbackLabel")}`}
              className={cn(
                "inline-flex cursor-default items-center justify-center leading-none",
                indicatorTextClass,
              )}
              data-testid="user-status-indicator"
              role="img"
            >
              <StatusEmoji
                className={statusEmojiClass}
                decorative
                value={statusEmoji}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>{status.text || t("userStatus.statusSet")}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  );
}
