import { useUiT } from "../../context";
// Upstream Buzz 779af8886caae1317b4de962082429867ab61503: desktop/src/features/messages/ui/MessageAgentOwner.tsx
import { Bot } from "lucide-react";

import type { AgentOwnerRenderer } from "../agentAuthorFacts";
import { UserProfilePopover, useHasSystemMessageHost } from "./host";

// DD-141 §2.4: owner name in the text-secondary role, text on hover; muted chip stays AA readable.
// Defect 7d: the label and icon never shrink, so a header squeeze used to collapse the name to
// zero width ("managed by" followed by nothing). The name slot keeps a floor of a few characters
// and truncates inside it; host triggers (an unsized inline-flex profile popover) are made
// shrinkable by the slot so the ellipsis lands on the name rather than the name disappearing.
const ownerSlotClass = "inline-flex min-w-[3ch] max-w-full items-baseline [&>*]:min-w-0 [&>*]:max-w-full";
const ownerNameClass = "min-w-0 truncate rounded font-semibold text-[var(--k-text-secondary)] transition-colors duration-100 hover:text-foreground hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

export function MessageAgentOwner({
  ownerLabel,
  ownerPubkey: ownerKey,
  ownerPrincipalId,
  renderOwner,
}: {
  ownerLabel?: string | null;
  ownerPubkey?: string | null;
  ownerPrincipalId?: string | null;
  /** DD-147(1): the host's member profile card for the owner (Web MemberHover, Desktop popover). */
  renderOwner?: AgentOwnerRenderer;
}) {
  const t = useUiT();
  const hasSystemHost = useHasSystemMessageHost();
  const memberOwner = renderOwner && ownerKey && ownerPrincipalId && ownerLabel
    ? { principalId: ownerPrincipalId, pubkey: ownerKey, label: ownerLabel } : null;
  const ownerPubkey = hasSystemHost && !memberOwner ? ownerKey : null;
  return (
    <span
      className="inline-flex min-w-0 max-w-56 items-baseline gap-1 text-xs leading-4 text-muted-foreground"
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
      {memberOwner && renderOwner ? (
        <>
          <span aria-hidden="true" className="shrink-0">{t("messages.system.managedBy")}</span>
          <span className={ownerSlotClass} data-testid="message-agent-owner-slot">
            {renderOwner(memberOwner, <span className={ownerNameClass} data-testid="message-agent-owner-name">{ownerLabel}</span>)}
          </span>
        </>
      ) : ownerLabel && !ownerPubkey ? (
        // DD-147(1): the owner's Tenant name without a Workspace key to open a profile for.
        <>
          <span aria-hidden="true" className="shrink-0">{t("messages.system.managedBy")}</span>
          <span className="min-w-[3ch] truncate font-semibold text-[var(--k-text-secondary)]" data-testid="message-agent-owner-name">{ownerLabel}</span>
        </>
      ) : ownerPubkey && ownerLabel ? (
        <>
          <span aria-hidden="true" className="shrink-0">
            {t("messages.system.managedBy")}
          </span>
          <span className={ownerSlotClass} data-testid="message-agent-owner-slot">
            <UserProfilePopover
              pubkey={ownerPubkey}
              triggerAriaLabel={ownerLabel}
              triggerElement="span"
            >
              <span className={ownerNameClass} data-testid="message-agent-owner-name">{ownerLabel}</span>
            </UserProfilePopover>
          </span>
        </>
      ) : (
        <span aria-hidden="true" className="min-w-0 truncate">
          {t("messages.system.ownerUnavailable")}
        </span>
      )}
    </span>
  );
}
