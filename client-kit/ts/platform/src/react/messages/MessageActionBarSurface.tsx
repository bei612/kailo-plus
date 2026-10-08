import { useUiT } from "../context";
import {
  BellOff,
  BellRing,
  Copy,
  CornerUpLeft,
  EllipsisVertical,
  Link2,
  MailCheck,
  MailOpen,
  Pencil,
  SmilePlus,
  Trash2,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import type { TimelineMessage, TimelineReaction } from "./types";
import { EmojiPicker } from "../custom-emoji/EmojiPicker";
import { reactionEmojiUrl, type CustomEmoji } from "../custom-emoji/emoji";
import { recordQuickReactionEmoji, useQuickReactionEmojis } from "./reactions/useQuickReactionEmojis";
import { emojiDisplayName } from "./reactions/emojiName";
import { isPositiveEmojiParticle } from "../profile/buzz/shared/ui/EmojiBurstProvider";
import { Popover, PopoverContent, PopoverTrigger } from "../conversations/popover";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Button } from "../profile/buzz/shared/ui/button";
import { HashArrowIn } from "./icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../sidebar/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../sidebar/tooltip";

const ACTION_BUTTON_CLASS = "h-8 w-8 rounded-full p-0";
const ACTION_ICON_CLASS = "!h-4 !w-4";

function QuickReactionButton({customEmojiUrl, emoji, onSelect, resolveMediaUrl}: {
  customEmojiUrl?: string; emoji: string; onSelect: (emoji: string) => void;
  resolveMediaUrl?: (url: string) => string | undefined;
}) {
  const t = useUiT();
  const displayName = emojiDisplayName(emoji);
  const mediaUrl = customEmojiUrl ? resolveMediaUrl?.(customEmojiUrl) : null;
  return <Tooltip><TooltipTrigger asChild>
    <button aria-label={t("messages.reactions.with", {emoji: displayName})}
      className="flex h-8 w-8 items-center justify-center rounded-full text-base leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
      onClick={() => onSelect(emoji)} title={displayName} type="button">
      {mediaUrl ? <img alt={emoji} className="h-5 w-5 object-contain" draggable={false} src={mediaUrl} />
        : <span aria-hidden="true" className="translate-y-px">{emoji}</span>}
    </button>
  </TooltipTrigger><TooltipContent>{displayName}</TooltipContent></Tooltip>;
}

function MoreActionsMenu({
  onCopyLink,
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
  onCopyMessage,
  onEdit,
  onDelete,
}: {
  /** Channel UUID for the Copy link action. When null/undefined, the
   *  Copy link entry is hidden (e.g. inbox preview rows that don't have it). */
  onCopyLink?: (message: TimelineMessage) => void;
  message: TimelineMessage;
  /** Resolves the mention identities carried by Copy message. */
  onCopyMessage: (message: TimelineMessage) => void;
  onEdit?: (message: TimelineMessage) => void;
  onDelete?: (message: TimelineMessage) => void;
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
  const translateUi = useUiT();
  const hasCopyActions = !message.pending;
  // Original Buzz menu-to-editor focus transfer: wait for Radix to close,
  // otherwise its exit focus restoration steals the editor's first keys.
  const pendingEditRef = React.useRef<(() => void) | null>(null);
  // "Copy message" copies the Markdown body verbatim, so its plain flavor is
  // already readable anywhere. The HTML sidecar adds only identity, letting a
  // paste back into Buzz re-light each chip with the pubkey the author tagged.


  return (
    <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={translateUi("buzz.moreActions")}
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
        <TooltipContent>{translateUi("buzz.moreActions")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" side="top" sideOffset={6}
        onCloseAutoFocus={(event) => {
          const startEdit = pendingEditRef.current;
          if (startEdit) { event.preventDefault(); pendingEditRef.current = null; startEdit(); }
        }}>
        {!message.pending && onEdit ? <DropdownMenuItem data-testid={`edit-message-${message.id}`}
          onSelect={() => { pendingEditRef.current = () => onEdit(message); }}>
          <Pencil className="h-4 w-4" />{translateUi("buzz.editMessage")}
        </DropdownMenuItem> : null}
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
            {isUnread ? translateUi("buzz.markRead") : translateUi("buzz.markUnread")}
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
            {isFollowingThread ? translateUi("buzz.unfollowThread") : translateUi("buzz.followThread")}
          </DropdownMenuItem>
        ) : null}

        {hasCopyActions ? (
          <DropdownMenuItem
            onClick={() => {
              onCopyMessage(message);
            }}
          >
            <Copy className="h-4 w-4" />
            {translateUi("buzz.copyMessage")}
          </DropdownMenuItem>
        ) : null}

        {onSendToChannel ? (
          <DropdownMenuItem
            aria-label={translateUi("buzz.sendToChannel")}
            data-testid={`send-to-channel-${message.id}`}
            onClick={() => {
              void onSendToChannel(message)
                .then(() => toast.success(translateUi("buzz.sentToChannel")))
                .catch((error) => {
                  console.error(
                    "Failed to send thread message to channel",
                    error,
                  );
                  toast.error(translateUi("buzz.sendToChannelFailed"));
                });
            }}
          >
            <HashArrowIn
              aria-hidden="true"
              className="h-4 w-4"
              data-testid="send-to-channel-icon"
            />
            {translateUi("buzz.sendToChannel")}
          </DropdownMenuItem>
        ) : null}

        {!message.pending && onCopyLink ? (
          <DropdownMenuItem
            data-testid={`copy-message-link-${message.id}`}
            onClick={() => {
              onCopyLink(message);
            }}
          >
            <Link2 className="h-4 w-4" />
            {translateUi("buzz.copyLink")}
          </DropdownMenuItem>
        ) : null}
        {!message.pending && onDelete ? <><DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:text-destructive"
            data-testid={`delete-message-${message.id}`} onClick={() => onDelete(message)}>
            <Trash2 className="h-4 w-4" />{translateUi("buzz.deleteMessage")}
          </DropdownMenuItem></> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const MessageActionBarSurface = React.memo(function MessageActionBarSurface({
  onCopyLink,
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
  onCopyMessage,
  onEdit,
  onDelete,
  onReactionSelect, onReactionBadgeBurstRequest, reactionErrorMessage = null,
  reactions = [], customEmoji = [], reactionScope = null, resolveMediaUrl,
}: {
  /** Channel UUID — required for the Copy link action; when omitted the
   *  action is hidden (callers like the home inbox that lack the context). */
  onCopyLink?: (message: TimelineMessage) => void;
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
  /** Resolves the mention identities carried by Copy message. */
  onCopyMessage: (message: TimelineMessage) => void;
  onEdit?: (message: TimelineMessage) => void;
  onDelete?: (message: TimelineMessage) => void;
  onReactionSelect?: (emoji: string) => Promise<void>;
  onReactionBadgeBurstRequest?: (emoji: string) => void;
  reactionErrorMessage?: string | null;
  reactions?: TimelineReaction[];
  customEmoji?: CustomEmoji[];
  reactionScope?: string | null;
  resolveMediaUrl?: (url: string) => string | undefined;
}) {
  const [isReactionPickerOpen, setIsReactionPickerOpen] = React.useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = React.useState(false);
  const translateUi = useUiT();
  const hasReplyAction = Boolean(onReply);
  const hasReactionAction = Boolean(onReactionSelect);
  const quickReactionEmojis = useQuickReactionEmojis(3, customEmoji, reactionScope);
  const quickReactionItems = React.useMemo(() => quickReactionEmojis
    .map(emoji => ({emoji, customEmojiUrl: reactionEmojiUrl(emoji, customEmoji)}))
    .filter(item => !(item.emoji.startsWith(":") && item.emoji.endsWith(":")) || item.customEmojiUrl), [customEmoji, quickReactionEmojis]);
  const handleReactionSelection = React.useCallback((emoji: string, closePicker = false) => {
    if (!onReactionSelect) return;
    if (!reactions.some(reaction => reaction.emoji === emoji && reaction.reactedByCurrentUser) && isPositiveEmojiParticle(emoji)) {
      onReactionBadgeBurstRequest?.(emoji);
    }
    void onReactionSelect(emoji).then(() => recordQuickReactionEmoji(emoji, reactionScope))
      .catch(() => {}).finally(() => { if (closePicker) setIsReactionPickerOpen(false); });
  }, [onReactionSelect, reactions, onReactionBadgeBurstRequest, reactionScope]);

  const hasMoreMenuActions =
    Boolean(onEdit) ||
    Boolean(onDelete) ||
    Boolean(onMarkUnread) ||
    Boolean(onMarkRead) ||
    Boolean(onFollowThread) ||
    Boolean(onUnfollowThread) ||
    Boolean(onSendToChannel) ||
    !message.pending;

  if (!hasReplyAction && !hasReactionAction && !hasMoreMenuActions) {
    return null;
  }

  return (
    <div
      className={cn(
        "-m-1 p-1 transition-opacity duration-150 ease-out",
        "opacity-100 sm:pointer-events-none sm:opacity-0",
        "sm:group-hover/message:pointer-events-auto sm:group-hover/message:opacity-100",
        "sm:group-focus-within/message:pointer-events-auto sm:group-focus-within/message:opacity-100",
        isReactionPickerOpen || isDropdownOpen ? "sm:pointer-events-auto sm:opacity-100" : "",
      )}
      data-testid={`message-action-bar-${message.id}`}
      ref={ref}
    >
      <div className="overflow-hidden rounded-full border border-border/70 bg-background/95 shadow-xs backdrop-blur-sm supports-[backdrop-filter]:bg-background/85">
        <div className="flex items-center gap-0.5 p-1">
          {hasReactionAction && quickReactionItems.length > 0 ? <div className="hidden items-center gap-0.5 sm:flex">
            {quickReactionItems.map(({customEmojiUrl, emoji}) => <QuickReactionButton key={emoji}
              customEmojiUrl={customEmojiUrl} emoji={emoji} onSelect={handleReactionSelection} resolveMediaUrl={resolveMediaUrl} />)}
          </div> : null}
          {hasReactionAction ? <Popover onOpenChange={setIsReactionPickerOpen} open={isReactionPickerOpen}>
            <Tooltip><TooltipTrigger asChild><PopoverTrigger asChild>
              <Button aria-label={translateUi("messages.reactions.open")} className={ACTION_BUTTON_CLASS}
                data-testid={`react-message-${message.id}`} size="sm" type="button" variant={isReactionPickerOpen ? "secondary" : "ghost"}>
                <SmilePlus className={ACTION_ICON_CLASS} />
              </Button>
            </PopoverTrigger></TooltipTrigger><TooltipContent>{translateUi("messages.reactions.react")}</TooltipContent></Tooltip>
            <PopoverContent align="end" className="w-auto p-0 rounded-2xl overflow-hidden border-0 bg-transparent shadow-none" side="top" sideOffset={10}>
              {reactionErrorMessage ? <div className="px-3 pt-3 pb-0"><p className="text-xs text-muted-foreground">{reactionErrorMessage}</p></div> : null}
              <EmojiPicker autoFocus customEmoji={customEmoji} onSelect={value => handleReactionSelection(value, true)} />
            </PopoverContent>
          </Popover> : null}
          {hasReactionAction && quickReactionItems.length > 0 ? <div aria-hidden="true" className="mx-0.5 hidden h-4 w-px bg-border/70 sm:block" data-testid="message-action-divider" /> : null}
          {hasReplyAction ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={translateUi("buzz.reply")}
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
              <TooltipContent>{translateUi("buzz.reply")}</TooltipContent>
            </Tooltip>
          ) : null}

          {!message.pending && onCopyLink ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={translateUi("buzz.copyLink")}
                  className={ACTION_BUTTON_CLASS}
                  data-testid={`copy-link-message-${message.id}`}
                  onClick={() => {
                    onCopyLink(message);
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Link2 className={ACTION_ICON_CLASS} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{translateUi("buzz.copyLink")}</TooltipContent>
            </Tooltip>
          ) : null}

          {hasMoreMenuActions ? (
            <MoreActionsMenu
              onEdit={onEdit}
              onDelete={onDelete}
              onCopyLink={onCopyLink}
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
              onCopyMessage={onCopyMessage}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
});

MessageActionBarSurface.displayName = "MessageActionBarSurface";
