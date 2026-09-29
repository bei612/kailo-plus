import type * as React from "react";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import { formatMentionDisplayLabel } from "@/shared/lib/mentionDisplay";
import {
  inlineChipIconClasses,
  inlineChipLeadingEnd,
  WRAPPING_INLINE_CHIP_CLASSES,
} from "@/shared/ui/mentionChip";
import { InlineChip } from "@/shared/ui/InlineChip";
import { useMarkdownRuntime } from "./runtimeContext";

/**
 * Bind interactivity once; names and identity resolution remain runtime inputs.
 * Inert identity attributes let timeline copy restore the sigil and carry the
 * resolved exact key in its HTML flavor without changing display or a11y output.
 */
export function createMarkdownMention(interactive: boolean) {
  return function MarkdownMention({
    children,
  }: {
    children?: React.ReactNode;
  }) {
    const { mentionPubkeysByName } = useMarkdownRuntime();
    const mentionText = String(children ?? "");
    const mentionName = mentionText.replace(/^@/, "").trim().toLowerCase();
    const pubkey = mentionPubkeysByName?.[mentionName];
    // Unbound literal competitors consume their full range, without a chip.
    if (mentionPubkeysByName && !pubkey) return mentionText;
    const mentionLabel = mentionText.replace(/^@/, "");
    const displayLabel = formatMentionDisplayLabel(mentionLabel, pubkey);
    const leadingEnd = inlineChipLeadingEnd(displayLabel);
    // Only chips that actually open a profile get the clickable affordance.
    // A mention whose pubkey didn't resolve stays a plain chip — a pointer
    // cursor there promises a click that does nothing.
    const opensProfile = interactive && pubkey !== undefined;
    const mentionNode = (
      <InlineChip
        data-mention=""
        data-mention-label={mentionLabel}
        data-mention-pubkey={pubkey}
        className={WRAPPING_INLINE_CHIP_CLASSES}
        title={mentionLabel}
        aria-label={mentionLabel}
        icon="human"
        interactive={opensProfile}
      >
        {/* Wrapping chips hide the outer icon; keep it with a bounded prefix. */}
        <span
          className={`inline-chip-leading-fragment ${inlineChipIconClasses("human")}`}
        >
          {displayLabel.slice(0, leadingEnd)}
        </span>
        {displayLabel.slice(leadingEnd)}
      </InlineChip>
    );

    return opensProfile ? (
      <UserProfilePopover
        pubkey={pubkey}
        triggerElement="span"
        triggerClassName="inline"
      >
        {mentionNode}
      </UserProfilePopover>
    ) : (
      mentionNode
    );
  };
}
