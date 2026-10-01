import * as React from "react";
import { UserRound } from "lucide-react";

import { avatarSourceUrlForShape } from "@/features/profile/ui/ProfileAvatarEditor.utils";
import { parseAnimatedAvatarUrl } from "@/shared/lib/animatedAvatar";
import { cn } from "@/shared/lib/cn";
import { getInitials } from "@/shared/lib/initials";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";
import { Avatar, AvatarFallback, AvatarImage } from "@/shared/ui/avatar";

type ProfileAvatarProps = {
  avatarUrl: string | null;
  avatarDataUrl?: string | null;
  label: string;
  /**
   * Label used to derive fallback initials; defaults to `label`.
   *
   * `label` stays the full visible/alt identity, but some callers build it
   * as a generated role-prefixed key fallback ("Agent npub1abcd…wxyz"),
   * which `getInitials` reads as ordinary words — collapsing every unnamed
   * identity onto the same "AN"/"PN" initials. Identity-aware callers pass
   * the unprefixed compact key here so key-fallback avatars keep distinct
   * key-tail initials; authored display names keep their name initials.
   */
  initialsLabel?: string;
  className?: string;
  iconClassName?: string;
  imageClassName?: string;
  plain?: boolean;
  shape?: "circle" | "squircle";
  testId?: string;
};

export function ProfileAvatar({
  avatarUrl,
  avatarDataUrl,
  label,
  initialsLabel,
  className,
  iconClassName,
  imageClassName,
  plain = false,
  shape = "circle",
  testId,
}: ProfileAvatarProps) {
  const initials = getInitials(initialsLabel ?? label);
  const shapedAvatarUrl = avatarSourceUrlForShape(avatarUrl, shape);

  // Animated avatars show their static poster frame until hovered, then play
  // the animation.
  const animated = parseAnimatedAvatarUrl(shapedAvatarUrl);
  const [isHovered, setIsHovered] = React.useState(false);
  const baseUrl = animated
    ? isHovered
      ? animated.animationUrl
      : animated.posterUrl
    : shapedAvatarUrl;

  // Compute the live (proxied) source. Failures are tracked per resolved URL so
  // the poster and hover animation can recover independently.
  const liveSrc = baseUrl ? rewriteRelayUrl(baseUrl) : null;
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const liveFailed = liveSrc !== null && failedSrc === liveSrc;

  // When the relay is unreachable the proxied avatar URL 404s/times out; fall
  // back to the locally cached data URL instead of dropping to initials.
  const src = liveFailed
    ? (avatarDataUrl ?? undefined)
    : (liveSrc ?? avatarDataUrl ?? undefined);
  const shouldShowFallback = src === undefined || (!animated && liveFailed);

  return (
    <Avatar
      className={cn(
        "shrink-0 text-primary shadow-xs",
        shape === "squircle" && "rounded-squircle",
        // Animated avatars carry their own backdrop disc and transparent
        // surroundings — any container fill would flatten the pop-out.
        plain || animated ? "bg-transparent shadow-none" : "bg-primary/20",
        className,
      )}
      data-testid={testId}
      onMouseEnter={animated ? () => setIsHovered(true) : undefined}
      onMouseLeave={animated ? () => setIsHovered(false) : undefined}
    >
      {src !== undefined ? (
        <AvatarImage
          alt={`${label} avatar`}
          className={cn("object-cover", imageClassName)}
          data-testid={testId ? `${testId}-image` : undefined}
          onLoadingStatusChange={(status) => {
            if (status === "error") setFailedSrc(liveSrc);
            if (status === "loaded" && src === liveSrc) {
              setFailedSrc(null);
            }
          }}
          referrerPolicy="no-referrer"
          src={src}
        />
      ) : null}
      {shouldShowFallback ? (
        <AvatarFallback
          className={cn(
            "font-semibold text-primary",
            plain || animated ? "bg-transparent" : "bg-primary/20",
          )}
          data-testid={testId ? `${testId}-fallback` : undefined}
          delayMs={src === undefined ? undefined : 200}
        >
          {initials.length > 0 ? (
            initials
          ) : (
            <UserRound className={iconClassName} />
          )}
        </AvatarFallback>
      ) : null}
    </Avatar>
  );
}
