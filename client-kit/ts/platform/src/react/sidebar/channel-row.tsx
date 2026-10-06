// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/sidebar/ui/SidebarSection.tsx::ChannelMenuButton.
import { BellOff } from "lucide-react";
import { useT } from "../context";
import type { ComponentType, ComponentProps, ReactNode } from "react";
import { twMerge as cn } from "tailwind-merge";
import type { SidebarChannel } from "./channel-group";
import { SidebarMenuButton } from "./primitives";
function UnreadDotBadge({
  channelName,
  className,
}: {
  channelName: string;
  className?: string;
}) {
  const t = useT();
  return (
    <span
      className={cn("h-2 w-2 shrink-0 rounded-full bg-primary", className)}
      data-testid={`channel-unread-dot-${channelName}`}
    >
      <span className="sr-only">{t("sidebar.unread")}</span>
    </span>
  );
}


export function ChannelRow({ channel, label, isActive, hasUnread, hasThreadUnread, isMuted, onSelectChannel,
  glyph, ephemeralBadge, Button = SidebarMenuButton,
}: { channel: SidebarChannel; label?: string; isActive: boolean; hasUnread: boolean; hasThreadUnread: boolean;
  isMuted?: boolean; onSelectChannel: (id: string) => void; glyph: (className: string) => ReactNode;
  ephemeralBadge?: ReactNode; Button?: ComponentType<ComponentProps<typeof SidebarMenuButton>>;
}) {
  const resolvedLabel = label ?? channel.name;
  const showsEphemeralBadge = Boolean(ephemeralBadge) && !isMuted && !hasThreadUnread;
  const inactiveContentOpacity = cn(
    !isActive && !hasUnread && !isMuted && "opacity-80",
    !isActive && isMuted && !hasUnread && !hasThreadUnread && "sidebar-muted-content opacity-50 dark:opacity-45",
  );
  return (
    <Button
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
      {glyph(inactiveContentOpacity)}
      <span
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1",
          inactiveContentOpacity,
        )}
        data-sidebar-row-label
      >
        <span className="min-w-0 truncate">{resolvedLabel}</span>
      </span>
      {showsEphemeralBadge ? ephemeralBadge : null}
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
    </Button>
  );

}
