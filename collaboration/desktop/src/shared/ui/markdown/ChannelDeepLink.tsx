import { createChannelDeepLinks } from "@client-kit/platform/react/messages/channel-link";
import {
  isChannelReferenceOpenable,
  useChannelReference,
} from "@/features/channels/channelReference";
import { useChannelsQuery } from "@/features/channels/hooks";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { translateCurrent as t } from "@client-kit/platform/i18n";
import { MessageLinkPill } from "./MessageLinkPill";
import { useMarkdownRuntime } from "./runtimeContext";

export { channelTooltipFooter } from "@client-kit/platform/react/messages/channel-link";
export const {
  AuthoredDeepLinkAnchor,
  ChannelDeepLinkAnchor,
  MarkdownChannelDeepLink,
  MarkdownChannelReference,
} = createChannelDeepLinks({
  useMarkdownRuntime,
  useChannelReference,
  useResolvedChannelDirectory: () => ({
    channels: useChannelsQuery().data ?? [],
  }),
  isChannelReferenceOpenable,
  MessageLinkPill,
  copyLink: (href) => {
    copyTextToClipboard(href, t("video.linkCopied"));
  },
});
