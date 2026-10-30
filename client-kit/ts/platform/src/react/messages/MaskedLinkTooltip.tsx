// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/shared/ui/markdown/MaskedLinkTooltip.tsx, shared so Web message links
// reveal a masked destination the same way Desktop does.
import type * as React from "react";
import { useContext } from "react";

import { SpoilerHiddenContext } from "../composer/shared/ui/markdown/SpoilerInline";
import { Tooltip, TooltipContent, TooltipTrigger } from "../sidebar/tooltip";
import { isMaskedLink } from "./maskedLink";

/**
 * Masked link (`[text](url)` where the text hides the destination): reveal
 * the full URL on hover so readers can see where a "click here" actually
 * goes before clicking. Bare/autolinked URLs render children unchanged —
 * their label already is the destination.
 */
export function MaskedLinkTooltip({
  href,
  label,
  disabled = false,
  children,
}: {
  href: string | undefined;
  label: string;
  disabled?: boolean;
  children: React.ReactElement;
}) {
  // A masked link inside an unrevealed spoiler must not expose its URL via a
  // hover/focus tooltip — that would leak the spoiler's content early.
  const hiddenInSpoiler = useContext(SpoilerHiddenContext);
  if (disabled || hiddenInSpoiler || !href || !isMaskedLink(label, href)) {
    return children;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      {/* Informational only: never intercept the click; never truncate the destination. */}
      <TooltipContent className="pointer-events-none max-w-md [overflow-wrap:anywhere]">
        {href}
      </TooltipContent>
    </Tooltip>
  );
}
