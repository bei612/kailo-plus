// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/workflows/ui/workflowReactionCondition.ts::reactionConditionValue.
import { needsConjunctionGrouping } from "./workflow-condition-expression";

/** Presents a legacy reaction emoji constraint alongside structured filters. */
export function reactionConditionValue(filter: string | undefined, emoji: string | undefined): string {
  const trimmedFilter = filter?.trim() ?? "";
  const trimmedEmoji = emoji?.trim();
  if (!trimmedEmoji) return trimmedFilter;
  const emojiCondition = `trigger_emoji == ${JSON.stringify(trimmedEmoji)}`;
  if (!trimmedFilter) return emojiCondition;
  // The emoji constraint and the filter are ANDed at runtime, so a filter with
  // top-level alternatives must be grouped to preserve its original meaning.
  const guarded = needsConjunctionGrouping(trimmedFilter) ? `(${trimmedFilter})` : trimmedFilter;
  return `${emojiCondition} && ${guarded}`;
}
