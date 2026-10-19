// Buzz 779af8886caae1317b4de962082429867ab61503 UserProfilePanelSections:
// public HUMAN summary/hero; admitted hosts provide data and real actions.
import * as React from "react";
import { translate } from "@client-kit/platform/i18n";
import { useUiLocale } from "@client-kit/platform/react/context";
import { ChevronDown, ChevronUp } from "lucide-react";

import { ProfileAvatar } from "../profile/buzz/features/profile/ui/ProfileAvatar";
import { AvatarHostProvider } from "../profile/avatar-host";
import {
  buildPublicFields,
  ProfileFieldGroup,
} from "./ProfileFields";
import type { WebProfileView as Profile } from "@client-kit/contracts";
import { cn } from "../profile/buzz/shared/lib/cn";
import { MaskedAvatarBadgeFrame, STATUS_DOT_MASK_CURVE } from "../messages/thread/MaskedAvatarBadgeFrame";
import { ProfilePrimaryActions } from "./UserProfilePrimaryActions";
import { useProfileFollow } from "./useProfileFollow";
import { ProfileTabContentTransition } from "./ProfileTabContentTransition";
import { usePresenceHost } from "../presence/context";
import { usePresenceQuery } from "../presence/hooks";
import { aggregatePresence, getPresenceLabelKey } from "../presence/lib/presence";
import { PresenceDot } from "../presence/ui/PresenceBadge";
import { newestVisibleUserStatus, useUserStatusQuery } from "../user-status/hooks";
import { StatusEmoji } from "../user-status/ui/StatusEmoji";

const PROFILE_HERO_PRESENCE_BADGE = {
  cutout: { cx: 68, cy: 68, r: 15 },
  shell: { bottom: 0, height: 24, right: 0, width: 24 },
} as const;

/**
 * Fixed Buzz UserProfilePanelSections::ProfileHero presence badge. DD-120 (5): aggregated over the
 * person's admitted keys; no presence fact (or no presence host) leaves the avatar unbadged.
 */
function ProfileHeroPresenceFrame({ pubkeys, children }: { pubkeys: readonly string[]; children: React.ReactNode }) {
  const locale = useUiLocale();
  const presence = usePresenceQuery(pubkeys);
  const presenceStatus = aggregatePresence(presence.isSuccess ? presence.data : undefined, pubkeys);
  return <MaskedAvatarBadgeFrame className="h-20 w-20" shape="circle" size={80}
    badge={presenceStatus ? <span aria-label={translate(locale, getPresenceLabelKey(presenceStatus))}
      className="flex h-6 w-6 items-center justify-center rounded-full" data-testid="user-profile-presence-badge" role="img">
      <PresenceDot className="h-3.5 w-3.5" status={presenceStatus} />
    </span> : null}
    badgeBox={PROFILE_HERO_PRESENCE_BADGE.shell} curve={STATUS_DOT_MASK_CURVE} cutout={PROFILE_HERO_PRESENCE_BADGE.cutout}>
    {children}
  </MaskedAvatarBadgeFrame>;
}

/** Fixed Buzz ProfileHero user status line under the name. */
function ProfileHeroUserStatus({ pubkeys }: { pubkeys: readonly string[] }) {
  const userStatusQuery = useUserStatusQuery(pubkeys);
  const userStatus = newestVisibleUserStatus(userStatusQuery.data, pubkeys);
  if (!userStatus || (!userStatus.text && !userStatus.emoji)) return null;
  return <p className="text-sm text-muted-foreground" data-testid="user-profile-user-status">
    {userStatus.emoji ? <StatusEmoji className="mr-1 inline h-3.5 w-3.5" value={userStatus.emoji} /> : null}
    {userStatus.text}
  </p>;
}

export function ProfileSummaryView({
  displayName,
  profile,
  pubkey,
  copy,
  mediaUrl,
  onMessage,
  messagePending,
  onWave,
  wavePending,
  presencePubkeys,
  canFollow,
}: {
  displayName: string;
  profile: Pick<Profile, "displayName" | "avatarUrl" | "about" | "nip05Handle"> | undefined;
  pubkey: string;
  copy: (value: string) => Promise<void>;
  mediaUrl: (url: string) => string;
  onMessage?:()=>void;
  messagePending?:boolean;
  /** DD-125(3) original Wave tile (useProfileWave or the host's own DM publication). */
  onWave?:()=>void;
  wavePending?:boolean;
  /** Every admitted key of this person for DD-120 presence and status; defaults to `pubkey`. */
  presencePubkeys?: readonly string[];
  /** Another person's profile (original Follow tile). Defaults to whether the host offers Message. */
  canFollow?: boolean;
}) {
  const locale = useUiLocale();
  const presenceHost = usePresenceHost();
  const identityKeys = presencePubkeys && presencePubkeys.length > 0 ? presencePubkeys : [pubkey];
  const follow = useProfileFollow(pubkey, canFollow ?? onMessage !== undefined);
  const fields = React.useMemo(
    () => buildPublicFields({ profile, pubkey, locale }),
    [profile, pubkey, locale],
  );

  return (
    <div className="flex flex-col gap-6 pt-4" data-testid="user-profile-summary-scroll-layout">
      <div>
        <div className="flex flex-col items-center gap-3 text-center">
          <AvatarHostProvider value={{ locale, rewriteMediaUrl: mediaUrl }}>
            {(() => {
              const avatar = <ProfileAvatar
                avatarUrl={profile?.avatarUrl ?? null}
                className="h-full w-full text-xl"
                iconClassName="h-8 w-8"
                label={displayName}
                plain
                shape="circle"
                testId="user-profile-avatar"
              />;
              return presenceHost ? <ProfileHeroPresenceFrame pubkeys={identityKeys}>{avatar}</ProfileHeroPresenceFrame>
                : <MaskedAvatarBadgeFrame className="h-20 w-20" shape="circle" size={80}
                  badgeBox={PROFILE_HERO_PRESENCE_BADGE.shell} curve={STATUS_DOT_MASK_CURVE} cutout={PROFILE_HERO_PRESENCE_BADGE.cutout}>
                  {avatar}
                </MaskedAvatarBadgeFrame>;
            })()}
          </AvatarHostProvider>

          <div className="flex flex-col items-center gap-1">
            <h3
              className="flex max-w-full items-center justify-center gap-2 text-xl font-semibold tracking-tight"
              data-testid="user-profile-name-row"
            >
              <span className="truncate">{displayName}</span>
            </h3>

            {profile?.about?.trim() ? (
              <ProfileHeroDescription
                about={profile.about.trim()}
                key={profile.about.trim()}
              />
            ) : null}
            {profile?.nip05Handle ? <p className="text-sm text-muted-foreground">{profile.nip05Handle}</p> : null}
            {presenceHost ? <ProfileHeroUserStatus pubkeys={identityKeys} /> : null}
          </div>
        </div>
      </div>
      <ProfilePrimaryActions onMessage={onMessage} messagePending={messagePending} onWave={onWave} wavePending={wavePending} follow={follow}/>
      <section className="space-y-3">
        <ProfileTabContentTransition activeTab="info" tabs={["info"]}>
          <div className="space-y-4" data-testid="user-profile-info-sections">
            <ProfileFieldGroup fields={fields} copy={copy} title={translate(locale,"platform.profile.panelInfo")} testId="user-profile-info-section"/>
          </div>
        </ProfileTabContentTransition>
      </section>
    </div>
  );
}

function ProfileHeroDescription({ about }: { about: string }) {
  const locale = useUiLocale();
  const [expanded, setExpanded] = React.useState(false);
  const [isTruncated, setIsTruncated] = React.useState(false);
  const textRef = React.useRef<HTMLParagraphElement>(null);

  const measureTruncation = React.useCallback(() => {
    const element = textRef.current;
    if (!element || expanded) {
      return;
    }
    setIsTruncated(element.scrollHeight > element.clientHeight + 1);
  }, [expanded]);

  React.useLayoutEffect(() => {
    measureTruncation();
  }, [measureTruncation]);

  React.useEffect(() => {
    const element = textRef.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver(() => {
      measureTruncation();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [measureTruncation]);

  const toggleClassName =
    "inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground opacity-60 transition-opacity hover:text-foreground hover:opacity-100";

  return (
    <div className="flex w-full flex-col items-center gap-0.5">
      <div className="w-fit max-w-full px-2">
        <p
          className={cn(
            "text-center whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground",
            !expanded && "line-clamp-3",
          )}
          data-testid="user-profile-description"
          ref={textRef}
        >
          {about}
        </p>
      </div>
      {!expanded && isTruncated ? (
        <button
          className={toggleClassName}
          data-testid="user-profile-description-toggle"
          onClick={() => setExpanded(true)}
          type="button"
        >
          {translate(locale, "platform.profile.more")}
          <ChevronDown className="h-4 w-4" />
        </button>
      ) : null}
      {expanded ? (
        <button
          className={toggleClassName}
          data-testid="user-profile-description-toggle"
          onClick={() => setExpanded(false)}
          type="button"
        >
          {translate(locale, "platform.profile.less")}
          <ChevronUp className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
