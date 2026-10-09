import { MessageLinkPillPresentation } from "@client-kit/platform/react/messages/message-link";
import { translateCurrent } from "@client-kit/platform/i18n";
import {
  isChannelReferenceOpenable,
  useChannelReference,
} from "@/features/channels/channelReference";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { useMessageLinkMetadata } from "./useMessageLinkMetadata";
import type { MessageLinkPillProps } from "./types";

function MessageLinkPillContents({
  channel,
  openable = true,
  ...props
}: MessageLinkPillProps & {
  channel?: NonNullable<MessageLinkPillProps["channels"]>[number];
  openable?: boolean;
}) {
  const metadata = useMessageLinkMetadata(props.link, openable && props.interactive && (props.variant ?? "default") === "default");
  return <MessageLinkPillPresentation {...props} channel={channel} channelLabel={channel?.name}
    openable={openable} metadata={metadata}
    copyLink={href => copyTextToClipboard(href, translateCurrent("video.linkCopied"))} />;
}

function ResolvedMessageLinkPill(props: MessageLinkPillProps) {
  const channel = useChannelReference(props.link.channelId);
  const openable = isChannelReferenceOpenable(channel);
  return <MessageLinkPillContents {...props} channel={openable ? channel : undefined} openable={openable} />;
}

export function MessageLinkPill(props: MessageLinkPillProps) {
  const knownChannel = props.channels?.find(channel => channel.id === props.link.channelId);
  if (knownChannel || !props.resolveChannelReference) {
    return <MessageLinkPillContents {...props} channel={knownChannel} />;
  }
  return <ResolvedMessageLinkPill {...props} />;
}
