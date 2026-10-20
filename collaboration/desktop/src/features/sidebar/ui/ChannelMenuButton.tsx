import { ChannelRow } from "@client-kit/platform/react/sidebar/channel-row";
import { ChannelWorkingBadge, type WorkingChannelSummary } from "@client-kit/platform/react/agent-activity";

import { useAppShell } from "@/app/AppShellContext";
import { ChannelGlyph } from "@/features/channels/ui/ChannelGlyph";
// Original TTL badge, the same localized client-kit body as the Web sidebar.
import { ChannelEphemeralBadge, isEphemeralChannel } from "@client-kit/platform/react/ephemeral-channel";
import { ChannelActivityPopover } from "@/features/sidebar/ui/ChannelActivityPopover";
import type { Channel } from "@/shared/api/types";
import { SidebarMenuButton } from "@/shared/ui/sidebar";

/**
 * DD-125(6): an Agent working in this native channel, from the shared working signal. The signal is
 * keyed by the channel's Workspace (`scopeId`), the identity Core reports audited turns under.
 */
export type DesktopWorkingChannel = {
  scopeId: string;
  summary: WorkingChannelSummary;
};

export function ChannelMenuButton({
  channel,
  label,
  isActive,
  hasUnread,
  isMuted,
  onSelectChannel,
  working,
}: {
  channel: Channel;
  label?: string;
  isActive: boolean;
  hasUnread: boolean;
  isMuted?: boolean;
  onSelectChannel: (channelId: string) => void;
  working?: DesktopWorkingChannel;
}) {
  const { hasSidebarUnreadProjections, unreadThreadChannelIds } = useAppShell();
  const hasThreadUnread = hasSidebarUnreadProjections
    ? unreadThreadChannelIds.has(channel.id)
    : hasUnread;
  const button = <ChannelRow channel={channel} label={label} isActive={isActive}
    hasUnread={hasUnread} hasThreadUnread={hasThreadUnread} isMuted={isMuted}
    onSelectChannel={onSelectChannel} Button={SidebarMenuButton}
    glyph={(className) => <ChannelGlyph channel={channel} className={className} />}
    // Original SidebarSection ChannelWorkingBadge while an Agent works here.
    workingBadge={working ? <ChannelWorkingBadge channelName={channel.name} isActive={isActive}
      summary={working.summary} /> : undefined}
    ephemeralBadge={isEphemeralChannel(channel) ? <ChannelEphemeralBadge channel={channel}
      testId={`channel-ephemeral-${channel.name}`} variant="sidebar" /> : undefined} />;

  if (!hasThreadUnread && !working) {
    return button;
  }

  return (
    <ChannelActivityPopover activeWorking={working} channel={channel}>{button}</ChannelActivityPopover>
  );
}
