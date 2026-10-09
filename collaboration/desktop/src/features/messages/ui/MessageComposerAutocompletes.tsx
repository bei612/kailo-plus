import type {
  ChannelSuggestion,
  UseChannelLinksResult,
} from "@/features/messages/lib/useChannelLinks";
import type {
  EmojiSuggestion,
  UseEmojiAutocompleteResult,
} from "@/features/messages/lib/useEmojiAutocomplete";
import type { UseMentionsResult } from "@/features/messages/lib/useMentions";
import { ChannelAutocomplete } from "./ChannelAutocomplete";
import { EmojiAutocomplete } from "./EmojiAutocomplete";
import {
  MentionAutocomplete,
  type MentionSuggestion,
} from "./MentionAutocomplete";

type MessageComposerAutocompletesProps = {
  position?: "above" | "below";
  channelLinks: UseChannelLinksResult;
  composerOwnsFocus: boolean;
  emojiAutocomplete: UseEmojiAutocompleteResult;
  mentions: UseMentionsResult;
  onChannelSelect: (suggestion: ChannelSuggestion) => void;
  onEmojiSelect: (suggestion: EmojiSuggestion) => void;
  onMentionSelect: (suggestion: MentionSuggestion) => void;
  audienceControlsEnabled?: boolean;
  lockedAgentPubkeys?: ReadonlySet<string>;
  onToggleAlwaysAddressAgent?: (suggestion: MentionSuggestion) => void;
  keepMentionedAgentsPinned?: boolean;
  onKeepMentionedAgentsPinnedChange?: (enabled: boolean) => void;
  openOptionsRequest?: number;
  onOptionsRevealComplete?: (request: number) => void;
};

/**
 * The message composer's three suggestion overlays. Each one gates its own
 * rendering on `composerOwnsFocus`, so a background composer replaying a
 * stale update cannot resurrect a suggestion menu over the focused composer,
 * while keyboard focus moving into an overlay's own controls keeps that
 * overlay mounted.
 */
export function MessageComposerAutocompletes({
  position = "above",
  channelLinks,
  composerOwnsFocus,
  emojiAutocomplete,
  mentions,
  onChannelSelect,
  onEmojiSelect,
  onMentionSelect,
  audienceControlsEnabled,
  lockedAgentPubkeys,
  onToggleAlwaysAddressAgent,
  keepMentionedAgentsPinned,
  onKeepMentionedAgentsPinnedChange,
  openOptionsRequest,
  onOptionsRevealComplete,
}: MessageComposerAutocompletesProps) {
  return (
    <>
      <EmojiAutocomplete
        position={position}
        composerOwnsFocus={composerOwnsFocus}
        onSelect={onEmojiSelect}
        selectedIndex={emojiAutocomplete.emojiSelectedIndex}
        suggestions={
          emojiAutocomplete.isEmojiAutocompleteOpen
            ? emojiAutocomplete.emojiSuggestions
            : []
        }
      />
      <ChannelAutocomplete
        position={position}
        composerOwnsFocus={composerOwnsFocus}
        onSelect={onChannelSelect}
        selectedIndex={channelLinks.channelSelectedIndex}
        suggestions={
          channelLinks.isChannelOpen ? channelLinks.channelSuggestions : []
        }
      />
      <MentionAutocomplete
        lockedAgentPubkeys={audienceControlsEnabled ? lockedAgentPubkeys : undefined}
        onToggleAlwaysAddressAgent={audienceControlsEnabled ? onToggleAlwaysAddressAgent : undefined}
        keepMentionedAgentsPinned={keepMentionedAgentsPinned}
        onKeepMentionedAgentsPinnedChange={audienceControlsEnabled ? onKeepMentionedAgentsPinnedChange : undefined}
        openOptionsRequest={openOptionsRequest}
        onOptionsRevealComplete={onOptionsRevealComplete}
        position={position}
        composerOwnsFocus={composerOwnsFocus}
        onDismiss={mentions.cancelMentionAutocomplete}
        onSelect={onMentionSelect}
        selectedIndex={mentions.mentionSelectedIndex}
        suggestions={mentions.isMentionOpen ? mentions.suggestions : []}
      />
    </>
  );
}
