// Original Buzz public profile presentation; Pulse host supplies real Community data.
import * as React from "react";
import { translate } from "@client-kit/platform/i18n";
import { useUiLocale } from "@client-kit/platform/react/context";
import { ChevronDown, ChevronUp } from "lucide-react";

import { UserAvatar } from "../messages/UserAvatar";
import { usePulseHost } from "./host";
import {
  buildPublicFields,
  ProfileFieldGroup,
} from "./ProfileFields";
import type { UserProfileSummary as Profile } from "./host";
import { cn } from "../profile/buzz/shared/lib/cn";

export function ProfileSummaryView({
  displayName,
  profile,
  pubkey,
}: {
  displayName: string;
  profile: Profile | undefined;
  pubkey: string;
}) {
  const locale = useUiLocale();
  const host = usePulseHost();
  const fields = React.useMemo(
    () => buildPublicFields({ profile, pubkey, locale }),
    [profile, pubkey, locale],
  );

  return (
    <div className="flex flex-col gap-6 pt-2">
      <div className="flex flex-col items-center gap-3 text-center">
        <UserAvatar
          avatarUrl={profile?.avatarUrl ?? null}
          className="h-20 w-20 text-xl"
          accent
          resolveMediaUrl={host.mediaUrl}
          displayName={displayName}
          testId="user-profile-avatar"
        />

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
        </div>
      </div>

      <ProfileFieldGroup fields={fields} />
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
