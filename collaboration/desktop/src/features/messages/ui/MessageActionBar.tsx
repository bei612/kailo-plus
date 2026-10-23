import * as React from "react";
import { MessageActionBarSurface } from "@client-kit/platform/react/messages";
import { buildMessageLink } from "@/features/messages/lib/messageLink";
import { buildMentionClipboardHtml } from "@/features/messages/lib/mentionClipboard";
import { getThreadReference } from "@/features/messages/lib/threading";
import { useMessageMentionClipboard } from "@/features/messages/lib/useMessageMentionClipboard";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { useMessageModerationScope } from "./messageModerationScope";
type Props = Omit<React.ComponentProps<typeof MessageActionBarSurface>, "onCopyMessage" | "onCopyLink"> & {channelId?: string | null; profiles?: UserProfileLookup};
export const MessageActionBar = React.memo(function MessageActionBar({channelId,profiles,...props}:Props) {
 const clipboard=useMessageMentionClipboard(props.message.tags,profiles,props.message.body);
 // DD-125(2): the original Report and moderator items in the channel's admitted scope.
 const moderation=useMessageModerationScope();
 return <MessageActionBarSurface moderation={moderation} {...props}
 onCopyMessage={(message)=>copyTextToClipboard(message.body,"Message copied to clipboard",buildMentionClipboardHtml(clipboard) ?? undefined)}
 onCopyLink={channelId ? (message)=>{const {rootId}=getThreadReference(message.tags ?? []);copyTextToClipboard(buildMessageLink({channelId,messageId:message.id,threadRootId:rootId}),"Link copied to clipboard");} : undefined} />;
});
MessageActionBar.displayName="MessageActionBar";
