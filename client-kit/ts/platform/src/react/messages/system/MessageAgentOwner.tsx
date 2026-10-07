import { useUiT } from "../../context";
// Upstream Buzz 779af8886caae1317b4de962082429867ab61503: desktop/src/features/messages/ui/MessageAgentOwner.tsx
import { Bot } from "lucide-react";

import { UserProfilePopover } from "./host";

export function MessageAgentOwner({
  ownerLabel,
  ownerPubkey,
}: {
  ownerLabel?: string | null;
  ownerPubkey?: string | null;
}) {
  const t = useUiT();
  return (
    <span
      className="inline-flex min-w-0 max-w-56 items-baseline gap-1 text-xs leading-4 text-muted-foreground/65"
      data-testid="message-agent-owner"
    >
      <span className="sr-only">
        {ownerLabel ? t("messages.system.agentManaged") : t("messages.system.agentOwnerUnavailable")}
      </span>
      {/*
       * Icon and label sit directly in this baseline row rather than in a nested
       * flex wrapper, so the label's own baseline is what aligns with the author
       * name beside it. Both branches share the icon for the same reason: two
       * wrappers meant two alignment rules and the "owner unavailable" variant
       * had drifted a pixel off the other one.
       *
       * `self-center` keeps the icon out of baseline alignment, so the label —
       * not the icon's box — sets this chip's baseline. Centred on the line box
       * the glyph's ink still rides ~1.6px above the text's cap band, reading as
       * a couple of pixels too high; 0.125em drops its optical centre onto that
       * band. In em so it holds under Cmd +/- zoom, and as a transform so it
       * shifts nothing else in the row.
       */}
      <Bot
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0 translate-y-[0.125em] self-center"
      />
      {ownerPubkey && ownerLabel ? (
        <>
          <span aria-hidden="true" className="shrink-0">
            {t("messages.system.managedBy")}
          </span>
          <UserProfilePopover
            pubkey={ownerPubkey}
            triggerAriaLabel={ownerLabel}
            triggerElement="span"
          >
            <span className="min-w-0 truncate rounded font-semibold text-foreground/85 hover:text-foreground hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
              {ownerLabel}
            </span>
          </UserProfilePopover>
        </>
      ) : (
        <span aria-hidden="true" className="min-w-0 truncate">
          {t("messages.system.ownerUnavailable")}
        </span>
      )}
    </span>
  );
}
