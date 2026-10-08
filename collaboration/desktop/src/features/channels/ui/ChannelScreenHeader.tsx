import { ChatHeader } from "@client-kit/platform/react/messages/chat-header";
import { DmHeaderParticipants } from "@client-kit/platform/react/messages/dm-header-participants";
import { translate } from "@client-kit/platform/i18n";
import { useDeviceLocale } from "@client-kit/platform/react/context";
import type * as React from "react";
import { toast } from "sonner";

import { getChannelDescription } from "@/features/channels/lib/channelDescription";
import type { EphemeralChannelDisplay } from "@/features/channels/lib/ephemeralChannel";
import { ChannelHeaderStatusBadge } from "@/features/channels/ui/ChannelHeaderStatusBadge";
import { ChannelGlyph } from "@/features/channels/ui/ChannelGlyph";
import { useActiveChannelHeader } from "@/features/channels/useActiveChannelHeader";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import type { Channel } from "@/shared/api/types";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { AvatarHostProvider } from "@client-kit/platform/react/profile/avatar-host";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";

type ChannelScreenHeaderProps = {
  activeChannel: Channel;
  activeChannelEphemeralDisplay: EphemeralChannelDisplay | null;
  chromeWrapperRef?: React.Ref<HTMLDivElement>;
  currentPubkey?: string;
};

export function ChannelScreenHeader({
  activeChannel,
  activeChannelEphemeralDisplay,
  chromeWrapperRef,
  currentPubkey,
}: ChannelScreenHeaderProps) {
  const { activeChannelTitle: title, activeDmHeaderParticipants } = useActiveChannelHeader(activeChannel, currentPubkey);
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
    <AvatarHostProvider value={{ locale, rewriteMediaUrl: rewriteRelayUrl }}>
      <ChatHeader belowSystemChrome transparentChrome chromeWrapperRef={chromeWrapperRef}
        title={title} description={trimmedDescription} channelType={activeChannel.channelType} visibility={activeChannel.visibility}
        onCopyTitle={handleCopyTitle}
        leadingContent={activeChannel.channelType === "dm" && activeDmHeaderParticipants.length > 0
          ? <DmHeaderParticipants participants={activeDmHeaderParticipants} title={title}
              renderIdentity={(participant, avatar) => participant.profilePubkey ? <UserProfilePopover pubkey={participant.profilePubkey}
                role={participant.isAgent ? "bot" : undefined} triggerElement="span"
                triggerAriaLabel={translate(locale, "platform.settings.profile")}>{avatar}</UserProfilePopover> : avatar} />
          : activeChannel.channelType !== "dm" ? <ChannelGlyph channel={activeChannel} className="h-4 w-4 translate-y-px text-muted-foreground" /> : undefined}
        statusBadge={activeChannelEphemeralDisplay ? <ChannelHeaderStatusBadge ephemeralDisplay={activeChannelEphemeralDisplay} /> : undefined} />
    </AvatarHostProvider>
  );
}
