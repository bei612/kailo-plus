import * as React from "react";

import { useUiT } from "../context";
import { avatarSourceUrlForShape } from "../profile/buzz/features/profile/ui/ProfileAvatarEditor.utils";
import { parseAnimatedAvatarUrl } from "../profile/buzz/shared/lib/animatedAvatar";
import { cn } from "../profile/buzz/shared/lib/cn";
import { getInitials } from "../profile/buzz/shared/lib/initials";
import { Avatar, AvatarFallback, AvatarImage } from "../profile/buzz/shared/ui/avatar";

type UserAvatarSize = "xs" | "sm" | "md";

const sizeClasses: Record<UserAvatarSize, string> = {
  xs: "h-5 w-5 text-3xs",
  sm: "h-6 w-6 text-2xs",
  md: "h-9 w-9 text-xs",
};

// DD-141 §9: initials avatars use Kailo's soft identity tints (the same set as
// the Agent identity tiles), never saturated Material swatches.
const fallbackColorClasses = [
  "bg-brand-soft text-brand-soft-foreground",
  "bg-info-soft text-info-text",
  "bg-success-soft text-success-text",
  "bg-warning-soft text-warning-text",
  "bg-accent text-accent-foreground",
] as const;

function fallbackColorClass(displayName: string) {
  const hash = Array.from(displayName.trim().toLowerCase()).reduce(
    (value, character) => (value * 31 + (character.codePointAt(0) ?? 0)) >>> 0,
    0,
  );
  return fallbackColorClasses[hash % fallbackColorClasses.length];
}

export type UserAvatarProps = {
  resolveMediaUrl?: (url: string) => string | undefined;
  avatarUrl: string | null;
  displayName: string;
  /**
   * Label used to derive fallback initials; defaults to `displayName`.
   *
   * Callers whose `displayName` is a generated role-prefixed key fallback
   * ("Agent npub1abcd…wxyz") pass the unprefixed compact key here:
   * word-initials would collapse every unnamed identity onto "AN"/"PN",
   * while the compact key keeps distinct key-tail initials. Authored
   * display names keep their name initials. The fallback color keeps
   * hashing `displayName`, which still contains the key.
   */
  initialsLabel?: string;
  size?: UserAvatarSize;
  accent?: boolean;
  shape?: "circle" | "squircle";
  className?: string;
  fallbackDelayMs?: number;
  imageDraggable?: boolean;
  testId?: string;
};

export function UserAvatar({
  resolveMediaUrl = (url) => url,
  avatarUrl,
  displayName,
  initialsLabel,
  size = "md",
  accent = false,
  shape,
  className,
  fallbackDelayMs = 200,
  imageDraggable,
  testId,
}: UserAvatarProps) {
  const t = useUiT();
  const initials = getInitials(initialsLabel ?? displayName);
  const resolvedShape = shape ?? "circle";
  const shapedAvatarUrl = avatarSourceUrlForShape(avatarUrl, resolvedShape);
  // Animated avatars show their static poster frame until hovered, then play
  // the animation.
  const animated = parseAnimatedAvatarUrl(shapedAvatarUrl);
  const [isHovered, setIsHovered] = React.useState(false);
  const src = animated
    ? resolveMediaUrl(isHovered ? animated.animationUrl : animated.posterUrl)
    : shapedAvatarUrl
      ? resolveMediaUrl(shapedAvatarUrl)
      : null;
  const radiusClass =
    resolvedShape === "squircle" ? "rounded-squircle" : "rounded-[28%]";

  return (
    <Avatar
      // Animated avatars carry their own backdrop disc and transparent
      // surroundings — any container fill would flatten the pop-out.
      className={cn(
        sizeClasses[size],
        radiusClass,
        !animated && "shadow-xs",
        className,
      )}
      data-avatar-shape={resolvedShape}
      data-testid={testId}
      onMouseEnter={animated ? () => setIsHovered(true) : undefined}
      onMouseLeave={animated ? () => setIsHovered(false) : undefined}
    >
      {src ? (
        <AvatarImage
          alt={`${displayName} ${t("platform.profile.avatar")}`}
          className={cn("object-cover", !animated && "bg-secondary")}
          data-testid={testId ? `${testId}-image` : undefined}
          draggable={imageDraggable}
          referrerPolicy="no-referrer"
          src={src}
        />
      ) : null}
      <AvatarFallback
        className={cn(
          "font-semibold",
          accent
            ? "bg-primary text-primary-foreground"
            : fallbackColorClass(displayName),
        )}
        data-testid={testId ? `${testId}-fallback` : undefined}
        delayMs={fallbackDelayMs}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
