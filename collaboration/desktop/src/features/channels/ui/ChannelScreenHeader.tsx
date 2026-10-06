import { ChatHeader } from "@client-kit/platform/react/messages/chat-header";
import { translate } from "@client-kit/platform/i18n";
import { useDeviceLocale } from "@client-kit/platform/react/context";
import type * as React from "react";
import { toast } from "sonner";

import { getChannelDescription } from "@/features/channels/lib/channelDescription";
import type { EphemeralChannelDisplay } from "@/features/channels/lib/ephemeralChannel";
import { ChannelGlyph } from "@/features/channels/ui/ChannelGlyph";
import { ChannelHeaderStatusBadge } from "@/features/channels/ui/ChannelHeaderStatusBadge";
import type { Channel } from "@/shared/api/types";
import { channelChrome } from "@/shared/layout/chromeLayout";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { cn } from "@/shared/lib/cn";

type ChannelScreenHeaderProps = {
  activeChannel: Channel;
  activeChannelEphemeralDisplay: EphemeralChannelDisplay | null;
  chromeWrapperRef?: React.Ref<HTMLDivElement>;
};

export function ChannelScreenHeader({
  activeChannel,
  activeChannelEphemeralDisplay,
  chromeWrapperRef,
}: ChannelScreenHeaderProps) {
  const title = activeChannel.name;
  const locale = useDeviceLocale();
  const trimmedDescription = getChannelDescription(activeChannel)?.trim() ?? "";

  async function handleCopyTitle(value: string) {
    try {
      await writeTextToClipboard(value);
      toast.success(translate(locale, "platform.profile.copied"));
    } catch {
      toast.error(translate(locale, "platform.profile.copyFailed"));
    }
  }

  return (
    <div
      ref={chromeWrapperRef}
      className={cn(
        "pointer-events-none relative z-40 overflow-visible rounded-tl-xl bg-transparent",
        channelChrome.negativeMargin,
      )}
    >
      <ChatHeader title={title} description={trimmedDescription} onCopyTitle={handleCopyTitle}
        leadingContent={<ChannelGlyph channel={activeChannel} className="h-4 w-4 translate-y-px text-muted-foreground" />}
        statusBadge={activeChannelEphemeralDisplay ? <ChannelHeaderStatusBadge ephemeralDisplay={activeChannelEphemeralDisplay} /> : undefined} />
    </div>
  );
}
