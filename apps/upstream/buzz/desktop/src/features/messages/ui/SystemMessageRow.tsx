import * as React from "react";

import type { TimelineMessage } from "@/features/messages/types";
import {
  resolveUserLabel,
  type UserProfileLookup,
} from "@/features/profile/lib/identity";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import { cn } from "@/shared/lib/cn";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { InlineChip } from "@/shared/ui/InlineChip";
import { MESSAGE_MARKDOWN_CLASS } from "@/shared/ui/mentionChip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import {
  buildGroupedMembershipPayload,
  parseSystemMessagePayload,
  type SystemMessagePayload,
} from "../lib/membershipGroupPayload";
import {
  addedActionPrefix,
  addedByActionPrefix,
  describeChannelTextFieldChange,
  toInlineName,
} from "../lib/systemEventCopy";
import { MessageAuthorText, MessageHeaderRow } from "./MessageHeader";
import { MessageTimestamp } from "./MessageTimestamp";
import {
  MembershipAvatarStack,
  SystemMessageAvatar,
} from "./SystemMessageAvatars";

type SystemMessageDescription = {
  action: React.ReactNode;
  title: React.ReactNode;
};

const MAX_VISIBLE_ADDITIONAL_MEMBER_NAMES = 3;

function resolveLabel(
  pubkey: string | undefined,
  currentPubkey: string | undefined,
  profiles: UserProfileLookup | undefined,
): string {
  if (!pubkey) {
    return "Someone";
  }
  return resolveUserLabel({ pubkey, currentPubkey, profiles });
}

function resolveAvatarUrl(
  pubkey: string | undefined,
  profiles: UserProfileLookup | undefined,
): string | null {
  if (!pubkey || !profiles) return null;
  return profiles[pubkey.toLowerCase()]?.avatarUrl ?? null;
}

function resolveDisplayLabel(
  pubkey: string | undefined,
  currentPubkey: string | undefined,
  profiles: UserProfileLookup | undefined,
): string {
  return resolveLabel(pubkey, currentPubkey, profiles);
}

function isSelfPubkey(
  pubkey: string | undefined,
  currentPubkey: string | undefined,
): boolean {
  return Boolean(
    pubkey &&
      currentPubkey &&
      normalizePubkey(pubkey) === normalizePubkey(currentPubkey),
  );
}

/** Same label as `resolveDisplayLabel`, adjusted for mid-sentence use. */
function resolveInlineDisplayLabel(
  pubkey: string | undefined,
  currentPubkey: string | undefined,
  profiles: UserProfileLookup | undefined,
): string {
  return toInlineName(
    resolveLabel(pubkey, currentPubkey, profiles),
    isSelfPubkey(pubkey, currentPubkey),
  );
}

function ProfileName({
  children,
  highlight = false,
  pubkey,
  underlineOnHover = false,
}: {
  children: React.ReactNode;
  highlight?: boolean;
  pubkey: string | undefined;
  underlineOnHover?: boolean;
}) {
  const node = highlight ? (
    <InlineChip
      data-mention=""
      className={cn(underlineOnHover && "hover:underline")}
      icon="human"
      interactive={Boolean(pubkey)}
    >
      {children}
    </InlineChip>
  ) : (
    <span
      className={cn(
        pubkey && "cursor-pointer",
        "rounded-xs transition-colors hover:text-foreground",
        underlineOnHover && "hover:underline",
      )}
    >
      {children}
    </span>
  );

  return pubkey ? (
    <UserProfilePopover pubkey={pubkey} triggerElement="span">
      {node}
    </UserProfilePopover>
  ) : (
    node
  );
}

function membershipActivityPubkeys(payload: SystemMessagePayload): string[] {
  const pubkeys =
    payload.type === "members_arrived"
      ? (payload.targets ?? [])
      : payload.type === "member_removed"
        ? [payload.target ?? payload.actor]
        : [payload.target ?? payload.actor];

  return [
    ...new Set(pubkeys.filter((pubkey): pubkey is string => Boolean(pubkey))),
  ];
}

function MembershipPersonName({
  currentPubkey,
  profiles,
  pubkey,
}: {
  currentPubkey: string | undefined;
  profiles: UserProfileLookup | undefined;
  pubkey: string;
}) {
  return (
    <ProfileName pubkey={pubkey} underlineOnHover>
      {resolveInlineDisplayLabel(pubkey, currentPubkey, profiles)}
    </ProfileName>
  );
}

function MemberNamesInlineList({
  currentPubkey,
  profiles,
  targets,
}: {
  currentPubkey: string | undefined;
  profiles: UserProfileLookup | undefined;
  targets: string[];
}) {
  const visibleTargets = targets.slice(0, MAX_VISIBLE_ADDITIONAL_MEMBER_NAMES);
  const hiddenTargets = targets.slice(MAX_VISIBLE_ADDITIONAL_MEMBER_NAMES);
  const renderName = (pubkey: string) => (
    <MembershipPersonName
      currentPubkey={currentPubkey}
      profiles={profiles}
      pubkey={pubkey}
    />
  );

  return (
    <>
      {visibleTargets.map((pubkey, index) => {
        const isLast = index === visibleTargets.length - 1;
        const separator =
          index === 0
            ? null
            : isLast && hiddenTargets.length === 0
              ? visibleTargets.length === 2
                ? " and "
                : ", and "
              : ", ";
        return (
          <React.Fragment key={pubkey}>
            {separator}
            {renderName(pubkey)}
          </React.Fragment>
        );
      })}
      {hiddenTargets.length > 0 ? (
        <>
          , and{" "}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="cursor-help rounded-xs hover:underline focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                type="button"
              >
                {hiddenTargets.length} others
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-72 p-2 text-left" side="top">
              <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                {hiddenTargets.map((pubkey) => (
                  <div className="flex items-center gap-2" key={pubkey}>
                    <UserAvatar
                      avatarUrl={resolveAvatarUrl(pubkey, profiles)}
                      className="!h-5 !w-5 shrink-0 text-3xs"
                      displayName={resolveDisplayLabel(
                        pubkey,
                        currentPubkey,
                        profiles,
                      )}
                    />
                    <span className="min-w-0 truncate">
                      {resolveDisplayLabel(pubkey, currentPubkey, profiles)}
                    </span>
                  </div>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        </>
      ) : null}
    </>
  );
}

function describeGroupedArrivals({
  currentPubkey,
  isTargetCurrentUser,
  membershipTitle,
  payload,
  profiles,
}: {
  currentPubkey: string | undefined;
  isTargetCurrentUser: boolean;
  membershipTitle: React.ReactNode;
  payload: SystemMessagePayload;
  profiles: UserProfileLookup | undefined;
}): SystemMessageDescription | null {
  const arrivals = payload.arrivals;
  if (!arrivals?.length || !payload.targets?.length) return null;

  const sharedActor = arrivals[0].actor;
  const hasSelfJoins = arrivals.some(({ actor, target }) => actor === target);
  const hasAdditions = arrivals.some(({ actor, target }) => actor !== target);
  const isSameAdderGroup =
    hasAdditions &&
    arrivals.every(
      ({ actor, target }) => actor === sharedActor && actor !== target,
    );
  const isAllAdditionGroup = hasAdditions && !hasSelfJoins;
  const isAllSelfJoinGroup = hasSelfJoins && !hasAdditions;
  const additionalTargets = payload.targets.slice(1);

  if (payload.targets.length === 1) {
    if (isSameAdderGroup) {
      return {
        title: membershipTitle,
        action: (
          <>
            {addedByActionPrefix(isTargetCurrentUser)}{" "}
            <ProfileName pubkey={sharedActor} underlineOnHover>
              {resolveInlineDisplayLabel(sharedActor, currentPubkey, profiles)}
            </ProfileName>
          </>
        ),
      };
    }

    if (isAllAdditionGroup) {
      return {
        title: membershipTitle,
        action: addedActionPrefix(isTargetCurrentUser),
      };
    }

    if (isAllSelfJoinGroup) {
      return {
        title: membershipTitle,
        action: "joined",
      };
    }

    return {
      title: membershipTitle,
      action: "arrived",
    };
  }

  if (isSameAdderGroup) {
    return {
      title: membershipTitle,
      action: (
        <>
          {addedByActionPrefix(isTargetCurrentUser)}{" "}
          <ProfileName pubkey={sharedActor} underlineOnHover>
            {resolveInlineDisplayLabel(sharedActor, currentPubkey, profiles)}
          </ProfileName>
          , along with{" "}
          <MemberNamesInlineList
            currentPubkey={currentPubkey}
            profiles={profiles}
            targets={additionalTargets}
          />
        </>
      ),
    };
  }

  if (isAllAdditionGroup) {
    return {
      title: membershipTitle,
      action: (
        <>
          {addedActionPrefix(isTargetCurrentUser)} along with{" "}
          <MemberNamesInlineList
            currentPubkey={currentPubkey}
            profiles={profiles}
            targets={additionalTargets}
          />
        </>
      ),
    };
  }

  if (isAllSelfJoinGroup) {
    return {
      title: membershipTitle,
      action: (
        <>
          joined along with{" "}
          <MemberNamesInlineList
            currentPubkey={currentPubkey}
            profiles={profiles}
            targets={additionalTargets}
          />
        </>
      ),
    };
  }

  return {
    title: membershipTitle,
    action: (
      <>
        arrived along with{" "}
        <MemberNamesInlineList
          currentPubkey={currentPubkey}
          profiles={profiles}
          targets={additionalTargets}
        />
      </>
    ),
  };
}

function describeSystemEvent(
  payload: SystemMessagePayload,
  currentPubkey: string | undefined,
  profiles: UserProfileLookup | undefined,
): SystemMessageDescription | null {
  const isTargetCurrentUser =
    currentPubkey !== undefined &&
    payload.target !== undefined &&
    normalizePubkey(payload.target) === normalizePubkey(currentPubkey);
  const actorLabel = resolveDisplayLabel(
    payload.actor,
    currentPubkey,
    profiles,
  );
  const targetLabel = resolveDisplayLabel(
    payload.target,
    currentPubkey,
    profiles,
  );
  const inlineTargetLabel = resolveInlineDisplayLabel(
    payload.target,
    currentPubkey,
    profiles,
  );
  const actorName = (
    <ProfileName pubkey={payload.actor}>{actorLabel}</ProfileName>
  );
  const targetName = (
    <ProfileName highlight pubkey={payload.target}>
      {inlineTargetLabel}
    </ProfileName>
  );
  const membershipTitle = (
    <ProfileName pubkey={payload.target} underlineOnHover>
      {targetLabel}
    </ProfileName>
  );

  switch (payload.type) {
    case "members_arrived":
      return describeGroupedArrivals({
        currentPubkey,
        isTargetCurrentUser,
        membershipTitle,
        payload,
        profiles,
      });
    case "member_joined_then_left":
      if (!payload.target) return null;
      return {
        title: membershipTitle,
        action: "joined, then left the channel",
      };
    case "member_joined": {
      if (!payload.actor || !payload.target) return null;
      if (normalizePubkey(payload.actor) === normalizePubkey(payload.target)) {
        return {
          title: membershipTitle,
          action: "joined the channel",
        };
      }
      return {
        title: membershipTitle,
        action: (
          <>
            {addedByActionPrefix(isTargetCurrentUser)}{" "}
            <ProfileName pubkey={payload.actor} underlineOnHover>
              {resolveInlineDisplayLabel(
                payload.actor,
                currentPubkey,
                profiles,
              )}
            </ProfileName>
          </>
        ),
      };
    }
    case "member_left":
      return {
        title: actorName,
        action: "left the channel",
      };
    case "member_removed":
      return {
        title: actorName,
        action: <>removed {targetName} from the channel</>,
      };
    case "topic_changed":
      return {
        title: actorName,
        action: describeChannelTextFieldChange("topic", payload.topic),
      };
    case "purpose_changed":
      return {
        title: actorName,
        action: describeChannelTextFieldChange("purpose", payload.purpose),
      };
    case "channel_created":
      return {
        title: actorName,
        action: "created this channel",
      };
    case "channel_archived":
      return {
        title: actorName,
        action: "archived this channel",
      };
    case "channel_unarchived":
      return {
        title: actorName,
        action: "unarchived this channel",
      };
    case "message_deleted": {
      // Room-facing tombstone. When a moderator removed the message, the relay
      // stamps a sanitized public_reason; a plain self-delete carries none. The
      // content and the reporter are never disclosed here.
      if (payload.public_reason) {
        return {
          title: "Removed by community moderators",
          action: payload.public_reason,
        };
      }
      return {
        title: actorName,
        action: "removed a message",
      };
    }
    default:
      return null;
  }
}

export const SystemMessageRow = React.memo(function SystemMessageRow({
  message,
  groupedMessages,
  currentPubkey,
  profiles,
}: {
  message: TimelineMessage;
  groupedMessages?: TimelineMessage[];
  currentPubkey?: string;
  profiles?: UserProfileLookup;
}) {
  const sourceMessages = React.useMemo(
    () => groupedMessages ?? [message],
    [groupedMessages, message],
  );
  const groupedPayload = React.useMemo(
    () => buildGroupedMembershipPayload(sourceMessages),
    [sourceMessages],
  );

  const payload = groupedPayload ?? parseSystemMessagePayload(message);
  if (!payload) return null;

  const description = describeSystemEvent(payload, currentPubkey, profiles);
  if (!description) {
    return null;
  }
  const isMembershipArrival =
    payload.type === "member_joined" || payload.type === "members_arrived";
  const isMembershipActivity =
    isMembershipArrival ||
    payload.type === "member_joined_then_left" ||
    payload.type === "member_left" ||
    payload.type === "member_removed";
  const membershipPubkeys = isMembershipActivity
    ? membershipActivityPubkeys(payload)
    : [];

  return (
    <div
      className={cn(
        "group/message relative mx-1 transition-colors",
        isMembershipActivity
          ? "pb-2 pt-4"
          : "rounded-2xl px-2 py-1 hover:bg-muted/50 focus-within:bg-muted/50",
      )}
      data-testid="system-message-row"
    >
      {isMembershipActivity ? (
        <div className={cn(MESSAGE_MARKDOWN_CLASS, "flex flex-col gap-1.5")}>
          <div className="flex justify-center">
            <div className="flex min-w-0 max-w-[min(40rem,80%)] items-center gap-2">
              <MembershipAvatarStack
                currentPubkey={currentPubkey}
                profiles={profiles}
                pubkeys={membershipPubkeys}
              />
              <p className="min-w-0 text-left text-xs font-normal leading-4 text-muted-foreground/70">
                {description.title} {description.action}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2.5">
          <SystemMessageAvatar
            actorPubkey={isMembershipArrival ? payload.target : payload.actor}
            currentPubkey={currentPubkey}
            profiles={profiles}
            targetPubkey={isMembershipArrival ? undefined : payload.target}
          />
          <div
            className={cn(
              MESSAGE_MARKDOWN_CLASS,
              "flex min-w-0 flex-1 flex-col gap-0.5",
            )}
          >
            <MessageHeaderRow>
              <MessageAuthorText as="div" className="text-foreground">
                {description.title}
              </MessageAuthorText>
              <MessageTimestamp createdAt={message.createdAt} />
            </MessageHeaderRow>
            <p className="-mt-0.5 text-sm leading-snug text-foreground">
              {description.action}
            </p>
          </div>
        </div>
      )}
    </div>
  );
});
