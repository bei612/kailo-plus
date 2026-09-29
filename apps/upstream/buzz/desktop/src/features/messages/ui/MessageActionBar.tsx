import {
  BellOff,
  BellRing,
  Copy,
  CornerUpLeft,
  EllipsisVertical,
  Link2,
  MailCheck,
  MailOpen,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { buildMessageLink } from "@/features/messages/lib/messageLink";
import { buildMentionClipboardHtml } from "@/features/messages/lib/mentionClipboard";
import { getThreadReference } from "@/features/messages/lib/threading";
import { useMessageMentionIdentities } from "@/features/messages/lib/useMessageMentionIdentities";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import type { TimelineMessage } from "@/features/messages/types";
import { cn } from "@/shared/lib/cn";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { Button } from "@/shared/ui/button";
import { HashArrowIn } from "@/shared/ui/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

const ACTION_BUTTON_CLASS = "h-8 w-8 rounded-full p-0";
const ACTION_ICON_CLASS = "!h-4 !w-4";

/** Copying a message link is offered from both the hover action bar and the
 *  More menu; both paths share this exact link-building + toast behavior. */
function copyMessageLink(channelId: string, message: TimelineMessage) {
  const { rootId } = getThreadReference(message.tags ?? []);
  const link = buildMessageLink({
    channelId,
    messageId: message.id,
    threadRootId: rootId,
  });
  copyTextToClipboard(link, "Link copied to clipboard");
}

/** Gate shared by every copy-link surface: pending sends have no delivered
 *  event to link to, and callers without a channelId (e.g. inbox preview
 *  rows) can't build the link. */
function canCopyMessageLink(
  message: TimelineMessage,
  channelId: string | null | undefined,
): channelId is string {
  return !message.pending && Boolean(channelId);
}

function MoreActionsMenu({
  channelId,
  message,
  onFollowThread,
  onMarkUnread,
  onMarkRead,
  onOpenChange,
  onSendToChannel,
  onUnfollowThread,
  open,
  isFollowingThread,
  isUnread,
  profiles,
}: {
  /** Channel UUID for the "Copy link" action. When null/undefined, the
   *  Copy link entry is hidden (e.g. inbox preview rows that don't have it). */
  channelId?: string | null;
  message: TimelineMessage;
  /** Resolves the mention identities carried by "Copy message". */
  profiles?: UserProfileLookup;
  onFollowThread?: (message: TimelineMessage) => void;
  onMarkUnread?: (message: TimelineMessage) => void;
  onMarkRead?: (message: TimelineMessage) => void;
  onOpenChange: (open: boolean) => void;
  onSendToChannel?: (message: TimelineMessage) => Promise<void>;
  onUnfollowThread?: (message: TimelineMessage) => void;
  open: boolean;
  isFollowingThread?: boolean;
  isUnread?: boolean;
}) {
  const hasCopyActions = !message.pending;
  // "Copy message" copies the Markdown body verbatim, so its plain flavor is
  // already readable anywhere. The HTML sidecar adds only identity, letting a
  // paste back into Buzz re-light each chip with the pubkey the author tagged.
  const mentionIdentities = useMessageMentionIdentities(message.tags, profiles);

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="More actions"
              className={ACTION_BUTTON_CLASS}
              data-testid={`more-actions-${message.id}`}
              size="sm"
              type="button"
              variant={open ? "secondary" : "ghost"}
            >
              <EllipsisVertical className={ACTION_ICON_CLASS} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>More actions</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" side="top" sideOffset={6}>
        {onMarkRead || onMarkUnread ? (
          <DropdownMenuItem
            data-testid={`mark-read-toggle-${message.id}`}
            onClick={() => {
              if (isUnread) {
                onMarkRead?.(message);
              } else {
                onMarkUnread?.(message);
              }
            }}
          >
            {isUnread ? (
              <MailCheck className="h-4 w-4" />
            ) : (
              <MailOpen className="h-4 w-4" />
            )}
            {isUnread ? "Mark read" : "Mark unread"}
          </DropdownMenuItem>
        ) : null}

        {onFollowThread || onUnfollowThread ? (
          <DropdownMenuItem
            onClick={() => {
              if (isFollowingThread) {
                onUnfollowThread?.(message);
              } else {
                onFollowThread?.(message);
              }
            }}
          >
            {isFollowingThread ? (
              <BellOff className="h-4 w-4" />
            ) : (
              <BellRing className="h-4 w-4" />
            )}
            {isFollowingThread ? "Unfollow thread" : "Follow thread"}
          </DropdownMenuItem>
        ) : null}

        {hasCopyActions ? (
          <DropdownMenuItem
            onClick={() => {
              copyTextToClipboard(
                message.body,
                "Message copied to clipboard",
                buildMentionClipboardHtml({
                  identities: mentionIdentities,
                  text: message.body,
                }) ?? undefined,
              );
            }}
          >
            <Copy className="h-4 w-4" />
            Copy message
          </DropdownMenuItem>
        ) : null}

        {onSendToChannel ? (
          <DropdownMenuItem
            aria-label="Send to channel"
            data-testid={`send-to-channel-${message.id}`}
            onClick={() => {
              void onSendToChannel(message)
                .then(() => toast.success("Sent to channel"))
                .catch((error) => {
                  console.error(
                    "Failed to send thread message to channel",
                    error,
                  );
                  toast.error("Couldn't send to channel");
                });
            }}
          >
            <HashArrowIn
              aria-hidden="true"
              className="h-4 w-4"
              data-testid="send-to-channel-icon"
            />
            Send to channel
          </DropdownMenuItem>
        ) : null}

        {canCopyMessageLink(message, channelId) ? (
          <DropdownMenuItem
            data-testid={`copy-message-link-${message.id}`}
            onClick={() => {
              copyMessageLink(channelId, message);
            }}
          >
            <Link2 className="h-4 w-4" />
            Copy link
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const MessageActionBar = React.memo(function MessageActionBar({
  channelId,
  message,
  ref,
  onFollowThread,
  onMarkUnread,
  onMarkRead,
  onReply,
  onSendToChannel,
  onUnfollowThread,
  isFollowingThread,
  isUnread,
  profiles,
}: {
  /** Channel UUID — required for the "Copy link" action; when omitted the
   *  action is hidden (callers like the home inbox that lack the context). */
  channelId?: string | null;
  message: TimelineMessage;
  /** Attached to the root element so hosts can measure the rail's rendered
   *  footprint (e.g. to reserve its width in the message-header layout). */
  ref?: React.Ref<HTMLDivElement>;
  onFollowThread?: (message: TimelineMessage) => void;
  onMarkUnread?: (message: TimelineMessage) => void;
  onMarkRead?: (message: TimelineMessage) => void;
  onReply?: (message: TimelineMessage) => void;
  onSendToChannel?: (message: TimelineMessage) => Promise<void>;
  onUnfollowThread?: (message: TimelineMessage) => void;
  isFollowingThread?: boolean;
  /** Current read state of the clicked message, from the same predicate the
   *  unread badge uses. Drives the single mark-read/unread toggle label. */
  isUnread?: boolean;
  /** Resolves the mention identities carried by "Copy message". */
  profiles?: UserProfileLookup;
}) {
  const [isDropdownOpen, setIsDropdownOpen] = React.useState(false);
  const hasReplyAction = Boolean(onReply);

  const hasMoreMenuActions =
    Boolean(onMarkUnread) ||
    Boolean(onMarkRead) ||
    Boolean(onFollowThread) ||
    Boolean(onUnfollowThread) ||
    Boolean(onSendToChannel) ||
    !message.pending;

  if (!hasReplyAction && !hasMoreMenuActions) {
    return null;
  }

  return (
    <div
      className={cn(
        "-m-1 p-1 transition-opacity duration-150 ease-out",
        "opacity-100 sm:pointer-events-none sm:opacity-0",
        "sm:group-hover/message:pointer-events-auto sm:group-hover/message:opacity-100",
        "sm:group-focus-within/message:pointer-events-auto sm:group-focus-within/message:opacity-100",
        isDropdownOpen ? "sm:pointer-events-auto sm:opacity-100" : "",
      )}
      data-testid={`message-action-bar-${message.id}`}
      ref={ref}
    >
      <div className="overflow-hidden rounded-full border border-border/70 bg-background/95 shadow-xs backdrop-blur-sm supports-[backdrop-filter]:bg-background/85">
        <div className="flex items-center gap-0.5 p-1">
          {hasReplyAction ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label="Reply"
                  className={ACTION_BUTTON_CLASS}
                  data-testid={`reply-message-${message.id}`}
                  onClick={() => {
                    onReply?.(message);
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <CornerUpLeft className={ACTION_ICON_CLASS} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reply</TooltipContent>
            </Tooltip>
          ) : null}

          {canCopyMessageLink(message, channelId) ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label="Copy link"
                  className={ACTION_BUTTON_CLASS}
                  data-testid={`copy-link-message-${message.id}`}
                  onClick={() => {
                    copyMessageLink(channelId, message);
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Link2 className={ACTION_ICON_CLASS} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy link</TooltipContent>
            </Tooltip>
          ) : null}

          {hasMoreMenuActions ? (
            <MoreActionsMenu
              channelId={channelId}
              message={message}
              onFollowThread={onFollowThread}
              onMarkUnread={onMarkUnread}
              onMarkRead={onMarkRead}
              onOpenChange={setIsDropdownOpen}
              onSendToChannel={onSendToChannel}
              onUnfollowThread={onUnfollowThread}
              open={isDropdownOpen}
              isFollowingThread={isFollowingThread}
              isUnread={isUnread}
              profiles={profiles}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
});

MessageActionBar.displayName = "MessageActionBar";
