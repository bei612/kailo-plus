// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/profile/ui/ProfileAvatarWithStatus.tsx. Without a presence fact the
// avatar renders unmasked (DD-120 (5): missing presence is not painted offline).
import { useUiT } from "../../context";
import { cn } from "../../profile/buzz/shared/lib/cn";
import { ProfileAvatar } from "../../profile/buzz/features/profile/ui/ProfileAvatar";
import {
  MaskedAvatarBadgeFrame,
  STATUS_DOT_MASK_CURVE,
} from "../../messages/thread/MaskedAvatarBadgeFrame";
import { getPresenceLabelKey, type PresenceStatus } from "../lib/presence";
import { PresenceDot } from "./PresenceBadge";

export type ProfileAvatarStatusGeometry = {
  dotSize: number;
  cutoutSize: number;
  centerX: number;
  centerY: number;
};

type ProfileAvatarWithStatusProps = {
  avatarClassName?: string;
  avatarUrl: string | null;
  className?: string;
  geometry?: ProfileAvatarStatusGeometry;
  iconClassName?: string;
  label: string;
  shape?: "circle" | "squircle";
  size: number;
  status?: PresenceStatus;
  statusTestId?: string;
  testId?: string;
};

export const DEFAULT_HOVER_PROFILE_STATUS_GEOMETRY = {
  dotSize: 10,
  cutoutSize: 16,
  centerX: 34,
  centerY: 34,
} satisfies ProfileAvatarStatusGeometry;

export function scaleProfileAvatarStatusGeometry(
  geometry: ProfileAvatarStatusGeometry,
  size: number,
  baseSize = 40,
): ProfileAvatarStatusGeometry {
  const scale = size / baseSize;
  return {
    dotSize: geometry.dotSize * scale,
    cutoutSize: geometry.cutoutSize * scale,
    centerX: geometry.centerX * scale,
    centerY: geometry.centerY * scale,
  };
}

export function ProfileAvatarWithStatus({
  avatarClassName,
  avatarUrl,
  className,
  geometry = DEFAULT_HOVER_PROFILE_STATUS_GEOMETRY,
  iconClassName,
  label,
  shape = "circle",
  size,
  status,
  statusTestId,
  testId,
}: ProfileAvatarWithStatusProps) {
  const t = useUiT();
  const statusLabel = status ? t(getPresenceLabelKey(status)) : null;
  const cutout = status
    ? {
        cx: geometry.centerX,
        cy: geometry.centerY,
        r: geometry.cutoutSize / 2,
      }
    : undefined;
  const badgeBox = status
    ? {
        bottom: size - geometry.centerY - geometry.dotSize / 2,
        height: geometry.dotSize,
        right: size - geometry.centerX - geometry.dotSize / 2,
        width: geometry.dotSize,
      }
    : undefined;

  return (
    <MaskedAvatarBadgeFrame
      badge={
        status ? (
          <span
            aria-label={statusLabel ?? undefined}
            className="flex h-full w-full items-center justify-center rounded-full"
            data-presence-status={status}
            data-testid={statusTestId}
            role="img"
          >
            <PresenceDot className="h-full w-full" status={status} />
            {statusLabel ? (
              <span className="sr-only">{statusLabel}</span>
            ) : null}
          </span>
        ) : undefined
      }
      badgeBox={badgeBox}
      className={cn("inline-flex", className)}
      clipTestId={testId ? `${testId}-mask` : undefined}
      curve={STATUS_DOT_MASK_CURVE}
      cutout={cutout}
      shape={shape}
      size={size}
    >
      <ProfileAvatar
        avatarUrl={avatarUrl}
        className={cn("h-full w-full", avatarClassName)}
        iconClassName={iconClassName}
        label={label}
        shape={shape}
        testId={testId}
      />
    </MaskedAvatarBadgeFrame>
  );
}
