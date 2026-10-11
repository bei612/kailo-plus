import { getLocale, translate } from "../../i18n";
// Shared from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/sidebar/ui/MoreUnreadButton.tsx.
import { topChromeInset } from "../messages/chromeLayout";
import { UnreadPill } from "../messages/timeline/UnreadPill";
import { UserAvatar, type UserAvatarProps } from "../messages/UserAvatar";
import type { ReactNode } from "react";

export type UnreadDmPreview = {
  accessibleLabel: string;
  avatarUrl: string | null;
  channelId: string;
  label: string;
  isAgent?: boolean;
  author?: { conversationId: string; eventId: string; pubkey: string };
};

export function canPreviewUnreadDm(participantPubkeyCount: number, resolvedParticipantCount: number) {
  return participantPubkeyCount === 2 && resolvedParticipantCount === 1;
}

export function visibleUnreadDmPreviews(dmPreviews: UnreadDmPreview[]) {
  return dmPreviews.slice(0, 3);
}

export function preferredUnreadTarget(unreadChannelIds: string[], dmChannelIds: ReadonlySet<string>) {
  return unreadChannelIds.find(channelId => dmChannelIds.has(channelId)) ?? unreadChannelIds[0];
}

export function unreadAccessibleLabel({
  count,
  label,
  position,
}: {
  count: number;
  label?: string;
  position: "top" | "bottom";
}) {
  return translate(getLocale(), position === "top" ? "sidebar.unreadAbove" : "sidebar.unreadBelow", {
    label: label ?? translate(getLocale(), "sidebar.unreadCount", { count }),
  });
}

export function unreadDmAccessibleLabel({ count, dmPreviews, label, position, targetChannelId }: {
  count: number;
  dmPreviews: UnreadDmPreview[];
  label?: string;
  position: "top" | "bottom";
  targetChannelId?: string;
}) {
  const target = dmPreviews.find(preview => preview.channelId === targetChannelId);
  const directionLabel = unreadAccessibleLabel({ count, label, position });
  return target ? translate(getLocale(), "sidebar.unreadDmTarget", {
    name: target.accessibleLabel, directionLabel,
  }) : directionLabel;
}

export function MoreUnreadButton({
  bottomClassName = "bottom-0",
  count,
  dmPreviews = [],
  renderAvatar,
  emphasis,
  label,
  onClick,
  position,
  targetChannelId,
  testId,
}: {
  bottomClassName?: string;
  count: number;
  dmPreviews?: UnreadDmPreview[];
  renderAvatar?: (preview: UnreadDmPreview, props: UserAvatarProps) => ReactNode;
  emphasis: "default" | "primary";
  label?: string;
  onClick: () => void;
  position: "top" | "bottom";
  targetChannelId?: string;
  testId: string;
}) {
  const positionClassName =
    position === "top" ? topChromeInset.top : bottomClassName;
  const resolvedLabel = label ?? translate(getLocale(), "sidebar.unreadCount", { count });
  const visibleDmPreviews = visibleUnreadDmPreviews(dmPreviews);

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 z-10 flex justify-center px-2 py-1 ${positionClassName}`}
    >
      <UnreadPill
        accessibleLabel={unreadDmAccessibleLabel({
          count,
          dmPreviews,
          label: resolvedLabel,
          position,
          targetChannelId,
        })}
        className="max-w-full overflow-hidden text-xs"
        direction={position === "top" ? "up" : "down"}
        emphasis={emphasis}
        label={resolvedLabel}
        leading={visibleDmPreviews.length > 0 ? (
          <span aria-hidden="true" className="flex shrink-0 items-center gap-1.5">
            <span className="flex -space-x-1.5">
              {visibleDmPreviews.map((preview, index) => {
                const avatarProps: UserAvatarProps = {
                  avatarUrl: preview.avatarUrl, className: "ring-2 ring-primary",
                  displayName: preview.label, shape: preview.isAgent ? "squircle" : "circle",
                  fallbackDelayMs: 0, size: "xs", testId: `sidebar-unread-dm-avatar-${preview.channelId}`,
                };
                return (
                <span className="relative" key={preview.channelId} style={{ zIndex: visibleDmPreviews.length - index }}>
                  {renderAvatar ? renderAvatar(preview, avatarProps) : <UserAvatar {...avatarProps} />}
                </span>
                );
              })}
            </span>
            <span>·</span>
          </span>
        ) : undefined}
        onClick={onClick}
        testId={testId}
      />
    </div>
  );
}
