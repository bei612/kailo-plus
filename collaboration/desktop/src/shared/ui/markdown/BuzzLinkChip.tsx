import type { ComponentProps } from "react";
import { BuzzLinkChip as SharedBuzzLinkChip, BuzzInlineLink as SharedBuzzInlineLink } from "@client-kit/platform/react/messages/message-link";
import { translateCurrent } from "@client-kit/platform/i18n";
import { copyTextToClipboard } from "@/shared/lib/clipboard";

function copyLink(href: string) {
  copyTextToClipboard(href, translateCurrent("video.linkCopied"));
}

export function BuzzLinkChip(props: Omit<ComponentProps<typeof SharedBuzzLinkChip>, "copyLink">) {
  return <SharedBuzzLinkChip {...props} copyLink={copyLink} />;
}
export function BuzzInlineLink(props: Omit<ComponentProps<typeof SharedBuzzInlineLink>, "copyLink">) {
  return <SharedBuzzInlineLink {...props} copyLink={copyLink} />;
}
