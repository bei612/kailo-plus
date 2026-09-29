import * as React from "react";

import type { MentionSuggestion } from "@/features/messages/ui/MentionAutocomplete";

/** Highlighted row in the mention picker, clamped to the current suggestions. */
export function useMentionSelection(suggestions: MentionSuggestion[]) {
  const [mentionSelectedIndex, setMentionSelectedIndex] = React.useState(0);

  React.useEffect(() => {
    setMentionSelectedIndex((current) =>
      suggestions.length === 0 ? 0 : Math.min(current, suggestions.length - 1),
    );
  }, [suggestions]);

  return { mentionSelectedIndex, setMentionSelectedIndex };
}
