// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/agents/ui/agentSessionTranscriptPresentation.ts.
import { translateCurrent } from "../../i18n";
import type { TranscriptItem } from "./agentSessionTypes";
import { buildCompactToolSummary } from "./agentSessionToolSummary";

/**
 * Whether a polished activity row should render the opt-in timestamp footer.
 * User message bubbles already render their own timestamp footer, so they are
 * excluded to avoid doubling up. Compact previews stay dense regardless of
 * the preference.
 */
export function shouldShowTranscriptRowTimestamp(
  item: TranscriptItem,
  options: { enabled: boolean; variant: string },
): boolean {
  if (!options.enabled || options.variant === "compactPreview") {
    return false;
  }
  if (item.type === "message" && item.role !== "assistant") {
    return false;
  }
  return true;
}

const LIFECYCLE_NOISE = new Set([
  "turn started",
  "session ready",
  "wire parse error",
]);

/** Human-readable headline for a single transcript item. */
export function getActivityHeadline(item: TranscriptItem): string | null {
  if (item.type === "tool") {
    const summary = buildCompactToolSummary(item);
    return [summary.label, summary.preview].filter(Boolean).join(" · ");
  }

  if (item.type === "message") {
    if (item.role === "assistant") {
      const trimmed = item.text.trim();
      if (trimmed.length > 0) {
        const firstLine = trimmed.split("\n")[0]?.trim() ?? "";
        if (firstLine.length > 0) {
          return firstLine.length > 72
            ? `${firstLine.slice(0, 69)}…`
            : firstLine;
        }
      }
      return translateCurrent("agentTranscript.headline.responding");
    }
    return item.title || translateCurrent("agentTranscript.headline.userPrompt");
  }

  if (item.type === "thought") {
    return item.title;
  }

  return item.title;
}

function isLifecycleNoise(
  item: Extract<TranscriptItem, { type: "lifecycle" }>,
) {
  return LIFECYCLE_NOISE.has(item.title.toLowerCase());
}

/** Whether an item should contribute to the headline scan (noise gate). */
export function isMeaningfulItem(item: TranscriptItem): boolean {
  if (item.type === "tool" && item.renderClass === "suppressed") {
    return false;
  }
  if (item.type === "lifecycle") {
    return !isLifecycleNoise(item);
  }
  if (item.type === "metadata") {
    return item.acpSource !== "raw_json_rpc";
  }
  return true;
}

/**
 * Whether an item is "spine" work — eligible to headline over setup/context.
 * Tools, messages, thoughts, plans, and meaningful lifecycle events qualify;
 * metadata items recede when real work is present.
 */
export function isSpineItem(item: TranscriptItem): boolean {
  if (!isMeaningfulItem(item)) return false;
  return item.type !== "metadata";
}
