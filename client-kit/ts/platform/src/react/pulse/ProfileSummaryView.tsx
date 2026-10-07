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
import type { UserProfileSummary as Profile } from "./host";
import { cn } from "../profile/buzz/shared/lib/cn";
import { MaskedAvatarBadgeFrame, STATUS_DOT_MASK_CURVE } from "../messages/thread/MaskedAvatarBadgeFrame";
import { ProfilePrimaryActions } from "./UserProfilePrimaryActions";
import { ProfileTabContentTransition } from "./ProfileTabContentTransition";

export function ProfileSummaryView({
  displayName,
  profile,
  pubkey,
  copy,
  mediaUrl,
  onMessage,
  messagePending,
}: {
  displayName: string;
  profile: Pick<Profile, "displayName" | "avatarUrl" | "about" | "nip05Handle"> | undefined;
  pubkey: string;
  copy: (value: string) => Promise<void>;
  mediaUrl: (url: string) => string;
  onMessage?:()=>void;
  messagePending?:boolean;
}) {
  const locale = useUiLocale();
  const fields = React.useMemo(
    () => buildPublicFields({ profile, pubkey, locale }),
    [profile, pubkey, locale],
  );

  return (
    <div className="flex flex-col gap-6 pt-4" data-testid="user-profile-summary-scroll-layout">
      <div>
        <div className="flex flex-col items-center gap-3 text-center">
          <AvatarHostProvider value={{ locale, rewriteMediaUrl: mediaUrl }}>
            <MaskedAvatarBadgeFrame className="h-20 w-20" shape="circle" size={80}
              badgeBox={{bottom:0,height:24,right:0,width:24}} curve={STATUS_DOT_MASK_CURVE} cutout={{cx:68,cy:68,r:15}}>
              <ProfileAvatar
                avatarUrl={profile?.avatarUrl ?? null}
                className="h-full w-full text-xl"
                iconClassName="h-8 w-8"
                label={displayName}
                plain
                shape="circle"
                testId="user-profile-avatar"
              />
            </MaskedAvatarBadgeFrame>
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
          </div>
        </div>
      </div>
      <ProfilePrimaryActions onMessage={onMessage} messagePending={messagePending}/>
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
