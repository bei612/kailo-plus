import { BellOff } from "lucide-react";

import { useAppShell } from "@/app/AppShellContext";
import { ChannelGlyph } from "@/features/channels/ui/ChannelGlyph";
import { getEphemeralChannelDisplay } from "@/features/channels/lib/ephemeralChannel";
import { EphemeralChannelBadge } from "@/features/channels/ui/EphemeralChannelBadge";
import { ChannelActivityPopover } from "@/features/sidebar/ui/ChannelActivityPopover";
import type { Channel } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { SidebarMenuButton } from "@/shared/ui/sidebar";

function UnreadDotBadge({
  channelName,
  className,
}: {
  channelName: string;
  className?: string;
}) {
  return (
    <span
      className={cn("h-2 w-2 shrink-0 rounded-full bg-primary", className)}
      data-testid={`channel-unread-dot-${channelName}`}
    >
      <span className="sr-only">unread</span>
    </span>
  );
}

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
  const resolvedLabel = label ?? channel.name;
  const ephemeralDisplay = getEphemeralChannelDisplay(channel);
  const { hasSidebarUnreadProjections, unreadThreadChannelIds } = useAppShell();
  const hasThreadUnread = hasSidebarUnreadProjections
    ? unreadThreadChannelIds.has(channel.id)
    : hasUnread;
  const showsEphemeralBadge =
    Boolean(ephemeralDisplay) && !isMuted && !hasThreadUnread;
  const inactiveContentOpacity = cn(
    !isActive && !hasUnread && !isMuted && "opacity-80",
    !isActive &&
      isMuted &&
      !hasUnread &&
      !hasThreadUnread &&
      "sidebar-muted-content opacity-50 dark:opacity-45",
  );

  const button = (
    <SidebarMenuButton
      className={cn(
        "data-[active=true]:font-normal",
        isActive
          ? "group-hover/menu-item:bg-sidebar-active group-hover/menu-item:text-sidebar-active-foreground"
          : "group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-foreground",
        hasUnread &&
          "font-bold text-sidebar-foreground hover:text-sidebar-foreground data-[active=true]:font-bold",
      )}
      data-channel-id={channel.id}
      data-testid={`channel-${channel.name}`}
      isActive={isActive}
      onClick={() => onSelectChannel(channel.id)}
      tooltip={resolvedLabel}
      type="button"
    >
      <ChannelGlyph channel={channel} className={inactiveContentOpacity} />
      <span
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1",
          inactiveContentOpacity,
        )}
        data-sidebar-row-label
      >
        <span className="min-w-0 truncate">{resolvedLabel}</span>
      </span>
      {showsEphemeralBadge && ephemeralDisplay ? (
        <EphemeralChannelBadge
          display={ephemeralDisplay}
          testId={`channel-ephemeral-${channel.name}`}
          variant="sidebar"
        />
      ) : null}
      {isMuted ? (
        <BellOff
          className={cn(
            "ml-auto h-4 w-4 shrink-0",
            isActive
              ? "text-sidebar-active-foreground/60"
              : "text-sidebar-foreground/40",
          )}
        />
      ) : null}
      {hasThreadUnread ? (
        <UnreadDotBadge channelName={channel.name} className="ml-auto" />
      ) : null}
    </SidebarMenuButton>
  );

  if (!hasThreadUnread) {
    return button;
  }

  return (
    <ChannelActivityPopover channel={channel}>{button}</ChannelActivityPopover>
  );
}
