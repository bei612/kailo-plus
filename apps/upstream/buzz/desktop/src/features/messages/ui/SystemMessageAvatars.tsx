import {
  resolveUserLabel,
  type UserProfileLookup,
} from "@/features/profile/lib/identity";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import { cn } from "@/shared/lib/cn";
import { UserAvatar } from "@/shared/ui/UserAvatar";

const MAX_MEMBERSHIP_AVATARS = 5;

function resolveAvatarUrl(
  pubkey: string | undefined,
  profiles: UserProfileLookup | undefined,
): string | null {
  if (!pubkey || !profiles) return null;
  return profiles[pubkey.toLowerCase()]?.avatarUrl ?? null;
}

export function SystemMessageAvatar({
  actorPubkey,
  currentPubkey,
  profiles,
  targetPubkey,
}: {
  actorPubkey: string | undefined;
  currentPubkey: string | undefined;
  profiles: UserProfileLookup | undefined;
  targetPubkey: string | undefined;
}) {
  const hasActorAndTarget =
    actorPubkey && targetPubkey && actorPubkey !== targetPubkey;
  const actorLabel = actorPubkey
    ? resolveUserLabel({
        pubkey: actorPubkey,
        currentPubkey,
        profiles,
        preferResolvedSelfLabel: true,
      })
    : "Someone";
  const singlePubkey = actorPubkey ?? targetPubkey;

  if (!hasActorAndTarget) {
    const avatar = (
      <UserAvatar
        avatarUrl={resolveAvatarUrl(singlePubkey, profiles)}
        className="!h-9 !w-9 shrink-0 text-2xs"
        displayName={actorLabel}
        testId="system-message-avatar"
      />
    );
    if (singlePubkey) {
      return (
        <UserProfilePopover pubkey={singlePubkey}>
          <button
            className="shrink-0 rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="system-message-avatar"
            type="button"
          >
            {avatar}
          </button>
        </UserProfilePopover>
      );
    }
    return avatar;
  }

  const targetLabel = resolveUserLabel({
    pubkey: targetPubkey,
    currentPubkey,
    profiles,
    preferResolvedSelfLabel: true,
  });
  const dualAvatar = (
    <div
      className="relative h-9 w-9 shrink-0"
      data-testid="system-message-avatar"
    >
      <UserAvatar
        avatarUrl={resolveAvatarUrl(actorPubkey, profiles)}
        className="!h-7 !w-7 border-2 border-background text-2xs"
        displayName={actorLabel}
      />
      <UserAvatar
        avatarUrl={resolveAvatarUrl(targetPubkey, profiles)}
        className="!absolute !bottom-0 !right-0 !h-7 !w-7 border-2 border-background text-2xs"
        displayName={targetLabel}
      />
    </div>
  );
  return (
    <UserProfilePopover pubkey={actorPubkey}>
      <button
        className="shrink-0 rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        type="button"
      >
        {dualAvatar}
      </button>
    </UserProfilePopover>
  );
}

export function MembershipAvatarStack({
  currentPubkey,
  profiles,
  pubkeys,
}: {
  currentPubkey: string | undefined;
  profiles: UserProfileLookup | undefined;
  pubkeys: readonly string[];
}) {
  const visiblePubkeys = pubkeys.slice(0, MAX_MEMBERSHIP_AVATARS);
  if (visiblePubkeys.length === 0) return null;
  return (
    <div
      aria-label={`${visiblePubkeys.length} channel member${visiblePubkeys.length === 1 ? "" : "s"}`}
      className="relative z-10 flex shrink-0 items-center justify-center"
      data-testid="system-message-avatar-stack"
      role="img"
    >
      {visiblePubkeys.map((pubkey, index) => {
        const label = resolveUserLabel({
          pubkey,
          currentPubkey,
          profiles,
          preferResolvedSelfLabel: true,
        });
        return (
          <div
            className={cn("relative", index > 0 && "-ml-1")}
            data-testid="system-message-avatar"
            key={pubkey}
            style={{ zIndex: index + 1 }}
          >
            <span className="block">
              <UserAvatar
                avatarUrl={resolveAvatarUrl(pubkey, profiles)}
                className={cn(
                  "h-6 w-6 text-2xs",
                  index < visiblePubkeys.length - 1 && "ring-2 ring-background",
                )}
                displayName={label}
                size="sm"
              />
            </span>
          </div>
        );
      })}
    </div>
  );
}
