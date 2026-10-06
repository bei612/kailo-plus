import { ChannelRow } from "@client-kit/platform/react/sidebar/channel-row";

import { useAppShell } from "@/app/AppShellContext";
import { ChannelGlyph } from "@/features/channels/ui/ChannelGlyph";
import { getEphemeralChannelDisplay } from "@/features/channels/lib/ephemeralChannel";
import { EphemeralChannelBadge } from "@/features/channels/ui/EphemeralChannelBadge";
import { ChannelActivityPopover } from "@/features/sidebar/ui/ChannelActivityPopover";
import type { Channel } from "@/shared/api/types";
import { SidebarMenuButton } from "@/shared/ui/sidebar";

export function ChannelMenuButton({
  channel,
  label,
  isActive,
  hasUnread,
  isMuted,
  onSelectChannel,
}: {
  channel: Channel;
  label?: string;
  isActive: boolean;
  hasUnread: boolean;
  isMuted?: boolean;
  onSelectChannel: (channelId: string) => void;
}) {
  const ephemeralDisplay = getEphemeralChannelDisplay(channel);
  const { hasSidebarUnreadProjections, unreadThreadChannelIds } = useAppShell();
  const hasThreadUnread = hasSidebarUnreadProjections
    ? unreadThreadChannelIds.has(channel.id)
    : hasUnread;
  const button = <ChannelRow channel={channel} label={label} isActive={isActive}
    hasUnread={hasUnread} hasThreadUnread={hasThreadUnread} isMuted={isMuted}
    onSelectChannel={onSelectChannel} Button={SidebarMenuButton}
    glyph={(className) => <ChannelGlyph channel={channel} className={className} />}
    ephemeralBadge={ephemeralDisplay ? <EphemeralChannelBadge display={ephemeralDisplay}
      testId={`channel-ephemeral-${channel.name}`} variant="sidebar" /> : undefined} />;

  if (!hasThreadUnread) {
    return button;
  }

  return (
    <ChannelActivityPopover channel={channel}>{button}</ChannelActivityPopover>
  );
}
