// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/shared/ui/markdown/MarkdownMention.tsx::createMarkdownMention.
// Identity resolution and authorized profile reads remain host responsibilities.
import { InlineChip } from "./system/InlineChip";
import { cn } from "../profile/buzz/shared/lib/cn";
import { formatMentionDisplayLabel } from "../composer/shared/lib/mentionDisplay";
import { inlineChipIconClasses, inlineChipLeadingEnd, WRAPPING_INLINE_CHIP_CLASSES } from "../composer/shared/ui/mentionChip";

export function MarkdownMentionChip({ label, pubkey, isAgent = false, interactive = false }: {
  label: string; pubkey?: string; isAgent?: boolean; interactive?: boolean;
}) {
  const displayLabel = formatMentionDisplayLabel(label, pubkey);
  const icon = isAgent ? "agent" : "human";
  const leadingEnd = inlineChipLeadingEnd(displayLabel);
  return <InlineChip data-mention="" data-mention-kind={pubkey === undefined ? undefined : icon}
    data-mention-label={label} data-mention-pubkey={pubkey}
    className={cn(WRAPPING_INLINE_CHIP_CLASSES, isAgent && "agent-mention-highlight")}
    title={label} aria-label={label} icon={icon} interactive={interactive}>
    <span className={cn("inline-chip-leading-fragment", inlineChipIconClasses(icon))}>
      {displayLabel.slice(0, leadingEnd)}
    </span>
    {displayLabel.slice(leadingEnd)}
  </InlineChip>;
}
