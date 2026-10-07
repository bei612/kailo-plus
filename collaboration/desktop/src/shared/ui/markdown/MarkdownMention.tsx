import type * as React from "react";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import { MarkdownMentionChip } from "@client-kit/platform/react/messages/MarkdownMentionChip";
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
    // Only chips that actually open a profile get the clickable affordance.
    // A mention whose pubkey didn't resolve stays a plain chip — a pointer
    // cursor there promises a click that does nothing.
    const opensProfile = interactive && pubkey !== undefined;
    const mentionNode = (
      <MarkdownMentionChip label={mentionLabel} pubkey={pubkey} interactive={opensProfile} />
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
