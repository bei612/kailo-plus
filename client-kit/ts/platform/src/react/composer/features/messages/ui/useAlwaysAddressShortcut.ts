// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/messages/ui/useAlwaysAddressShortcut.ts.
import * as React from "react";
import { hasPrimaryShortcutModifier } from "../../../../../keyboard-platform";
import type { MentionSuggestion } from "./MentionAutocomplete";

export function useAlwaysAddressShortcut({
  enabled,
  lockedAgent,
  mentions,
  onOpenPicker,
  onToggle,
}: {
  enabled: boolean;
  lockedAgent?: Pick<MentionSuggestion, "avatarUrl" | "displayName" | "pubkey">;
  mentions: {
    getDefaultAgentSuggestion: () => MentionSuggestion | undefined;
    isMentionOpen: boolean;
    mentionSelectedIndex: number;
    suggestions: MentionSuggestion[];
  };
  onOpenPicker: (insertTrigger?: boolean) => void;
  onToggle: (suggestion: MentionSuggestion) => void;
}) {
  const {
    getDefaultAgentSuggestion,
    isMentionOpen,
    mentionSelectedIndex,
    suggestions,
  } = mentions;
  return React.useCallback(
    (event: React.KeyboardEvent): boolean => {
      if (
        !enabled ||
        event.code !== "KeyM" ||
        !hasPrimaryShortcutModifier(event) ||
        event.altKey ||
        !event.shiftKey
      )
        return false;
      event.preventDefault();
      if (event.repeat) return true;
      const suggestion = isMentionOpen
        ? suggestions[mentionSelectedIndex]
        : lockedAgent
          ? { ...lockedAgent, isAgent: true }
          : getDefaultAgentSuggestion();
      if (!suggestion?.isAgent || !suggestion.pubkey) {
        if (!isMentionOpen) onOpenPicker(false);
        return true;
      }
      onToggle(suggestion);
      return true;
    },
    [
      enabled,
      getDefaultAgentSuggestion,
      isMentionOpen,
      lockedAgent,
      mentionSelectedIndex,
      onOpenPicker,
      onToggle,
      suggestions,
    ],
  );
}
