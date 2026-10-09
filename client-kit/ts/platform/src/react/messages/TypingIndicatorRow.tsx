// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/messages/ui/TypingIndicatorRow.tsx.
// Original DOM and classes; shared profile/media host and bilingual labels only.
import * as React from "react";

import {
  resolveUserLabel,
  type UserProfileLookup,
} from "./system/identity";
import { ProfileAvatar } from "../profile/buzz/features/profile/ui/ProfileAvatar";
import type { Channel } from "../search/types";
import { useUiT, type Translate } from "../context";
type TypingChannel = Pick<Channel, "channelType" | "participants" | "participantPubkeys">;
import { cn } from "../profile/buzz/shared/lib/cn";
import { Shimmer } from "./Shimmer";
import { truncateNpub } from "../conversations/pubkey";

type TypingIndicatorRowProps = {
  channel: TypingChannel | null;
  className?: string;
  currentPubkey?: string;
  profiles?: UserProfileLookup;
  typingPubkeys: string[];
  variant?: "default" | "activity";
};

function resolveFallbackName(channel: TypingChannel | null, pubkey: string) {
  if (channel?.channelType !== "dm") {
    return null;
  }

  const participantIndex = channel.participantPubkeys.findIndex(
    (candidate) => candidate.toLowerCase() === pubkey.toLowerCase(),
  );

  if (participantIndex < 0) {
    return null;
  }

  return channel.participants[participantIndex] ?? null;
}

function formatTypingLabel(names: string[], t: Translate) {
  if (names.length === 1) {
    return t("messages.typing.one", { first: names[0] ?? "" });
  }

  if (names.length === 2) {
    return t("messages.typing.two", { first: names[0] ?? "", second: names[1] ?? "" });
  }

  if (names.length === 3) {
    return t("messages.typing.three", { first: names[0] ?? "", second: names[1] ?? "", third: names[2] ?? "" });
  }

  return t("messages.typing.many", { first: names[0] ?? "", second: names[1] ?? "", count: names.length - 2 });
}

export function TypingIndicatorRow({
  channel,
  className,
  currentPubkey,
  profiles,
  typingPubkeys,
  variant = "default",
}: TypingIndicatorRowProps) {
  const t = useUiT();
  const isActivityVariant = variant === "activity";
  const labels = React.useMemo(
    () =>
      typingPubkeys.map((pubkey) =>
        resolveUserLabel({
          pubkey,
          currentPubkey,
          fallbackName: resolveFallbackName(channel, pubkey),
          profiles,
          preferResolvedSelfLabel: true,
        }),
      ),
    [channel, currentPubkey, profiles, typingPubkeys],
  );

  return (
    <div
      aria-live="polite"
      className={cn(
        "shrink-0 bg-transparent",
        isActivityVariant ? "flex items-center px-0 py-0" : "px-4 py-2 sm:px-6",
        className,
      )}
      {...(labels.length > 0
        ? { "data-testid": "message-typing-indicator" }
        : {})}
    >
      {labels.length > 0 && (
        <div
          className={cn(
            "flex min-w-0 w-full items-center",
            isActivityVariant ? "h-full gap-1.5" : "gap-2",
          )}
        >
          <div className="flex shrink-0 items-center">
            {typingPubkeys.map((pubkey, index) => {
              const profile = profiles?.[pubkey.toLowerCase()];
              const label = labels[index] ?? truncateNpub(pubkey);
              return (
                <div
                  key={pubkey}
                  className={cn(
                    "relative shrink-0 ring-1 ring-background",
                    profile?.isAgent ? "rounded-squircle" : "rounded-full",
                    isActivityVariant ? "h-4 w-4" : "h-5 w-5",
                    index > 0 && "-ml-1.5",
                  )}
                  data-testid="message-typing-avatar"
                >
                  <ProfileAvatar
                    avatarUrl={profile?.avatarUrl ?? null}
                    label={label}
                    className={cn(
                      isActivityVariant
                        ? "h-4 w-4 text-3xs"
                        : "h-5 w-5 text-3xs",
                    )}
                    iconClassName={
                      isActivityVariant ? "h-2.5 w-2.5" : "h-4 w-4"
                    }
                    shape={profile?.isAgent ? "squircle" : "circle"}
                  />
                </div>
              );
            })}
          </div>
          <p
            className={cn(
              "min-w-0 translate-y-px truncate text-muted-foreground",
              isActivityVariant
                ? "text-2xs font-medium leading-3"
                : "text-xs font-medium leading-4",
            )}
            data-testid="message-typing-indicator-label"
          >
            <Shimmer>{formatTypingLabel(labels, t)}</Shimmer>
          </p>
        </div>
      )}
    </div>
  );
}
