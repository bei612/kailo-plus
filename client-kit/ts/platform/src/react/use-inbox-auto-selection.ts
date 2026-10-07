// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/home/useHomeInboxAutoSelection.ts.
import * as React from "react";


type UseHomeInboxAutoSelectionOptions = {
  coldResolutionPending: boolean;
  filteredItems: readonly { conversationId: string; id: string }[];
  hasFeed: boolean;
  hasPersonalSelection: boolean;
  homeInboxWidthPx: number;
  isLoading: boolean;
  isMessagesMode: boolean;
  isNarrowHomeViewport: boolean;
  selectedConversationId: string | null;
  setAutoSelectedEventId: React.Dispatch<React.SetStateAction<string | null>>;
  urlSelectedItemId: string | null;
};

export function useHomeInboxAutoSelection({
  coldResolutionPending,
  filteredItems,
  hasFeed,
  hasPersonalSelection,
  homeInboxWidthPx,
  isLoading,
  isMessagesMode,
  isNarrowHomeViewport,
  selectedConversationId,
  setAutoSelectedEventId,
  urlSelectedItemId,
}: UseHomeInboxAutoSelectionOptions) {
  React.useEffect(() => {
    if (!isMessagesMode) return;

    if (hasPersonalSelection || urlSelectedItemId !== null) {
      setAutoSelectedEventId(null);
      return;
    }

    if (isLoading || !hasFeed) return;

    if (filteredItems.length === 0) {
      setAutoSelectedEventId(null);
      return;
    }

    // Wait for the width measurement so narrow Home does not cold-load detail.
    if (homeInboxWidthPx === 0) return;

    const selectedConversationIsVisible =
      selectedConversationId !== null &&
      filteredItems.some(
        (item) => item.conversationId === selectedConversationId,
      );
    if (selectedConversationIsVisible || coldResolutionPending) return;

    setAutoSelectedEventId(
      isNarrowHomeViewport ? null : (filteredItems[0]?.id ?? null),
    );
  }, [
    coldResolutionPending,
    filteredItems,
    hasFeed,
    hasPersonalSelection,
    homeInboxWidthPx,
    isLoading,
    isMessagesMode,
    isNarrowHomeViewport,
    selectedConversationId,
    setAutoSelectedEventId,
    urlSelectedItemId,
  ]);
}
