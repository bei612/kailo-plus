// Reused from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src; only identity/transport seams adapt to Kailo.
import type { ConversationParticipant } from "@client-kit/contracts";
import { useUiT } from "../context";
import { Avatar, AvatarFallback } from "../profile/buzz/shared/ui/avatar";
import { getInitials } from "../profile/buzz/shared/lib/initials";
import { cn } from "../profile/buzz/shared/lib/cn";
import { truncateNpub } from "./pubkey";

import { formatRecipientName } from "./use-conversations";

const RESULT_ROW_INSET_DIVIDER_CLASS =
  "after:pointer-events-none after:absolute after:bottom-0 after:left-[3.75rem] after:right-0 after:h-px after:bg-border/60 after:content-[''] last:after:hidden";
const TEXT_SWAP_BASE_CLASS =
  "min-w-0 truncate transition-[opacity,filter] duration-[250ms] ease-in-out motion-reduce:transition-none";
const TEXT_SWAP_VISIBLE_CLASS = "opacity-100 blur-0";
const TEXT_SWAP_HIDDEN_CLASS = "opacity-0 blur-0";
const TEXT_SWAP_HOVER_VISIBLE_CLASS =
  "group-hover/name:opacity-100 group-hover/name:blur-0 group-focus-visible/dm-result:opacity-100 group-focus-visible/dm-result:blur-0";
const TEXT_SWAP_HOVER_HIDDEN_CLASS =
  "group-hover/name:opacity-0 group-hover/name:blur-[2px] group-focus-visible/dm-result:opacity-0 group-focus-visible/dm-result:blur-[2px]";

function HoverRecipientIdentity({
  displayName,
  pubkey,
}: {
  displayName: string;
  pubkey: string;
}) {
  const identityLabel = truncateNpub(pubkey);

  return (
    <span
      className="group/name relative inline-flex h-5 min-w-0 max-w-full self-start leading-5"
      data-testid={`new-dm-name-${pubkey}`}
    >
      <span
        className={cn(
          TEXT_SWAP_BASE_CLASS,
          TEXT_SWAP_VISIBLE_CLASS,
          TEXT_SWAP_HOVER_HIDDEN_CLASS,
          "w-fit max-w-full text-sm font-medium tracking-tight",
        )}
      >
        {displayName}
      </span>
      <span
        className={cn(
          TEXT_SWAP_BASE_CLASS,
          TEXT_SWAP_HIDDEN_CLASS,
          TEXT_SWAP_HOVER_VISIBLE_CLASS,
          "absolute inset-y-0 left-0 font-mono text-2xs text-muted-foreground",
        )}
        data-testid={`new-dm-npub-${pubkey}`}
      >
        {identityLabel}
      </span>
    </span>
  );
}

/**
 * A single selectable person/agent row in the new-message directory. Extracted
 * from the former NewDirectMessageDialog so the compose page renders identical
 * rows (avatar, agent badge, owner label, and a name-to-pubkey hover swap).
 */
export function NewMessageResultRow({
  disabled,
  isAlreadySelected = false,
  isKeyboardHighlighted = false,
  onSelect,
  user,
}: {
  disabled: boolean;
  isAlreadySelected?: boolean;
  isKeyboardHighlighted?: boolean;
  onSelect: (user: ConversationParticipant) => void;
  user: ConversationParticipant;
}) {
  const name = formatRecipientName(user);
  const translateUi = useUiT();

  return (
    <div
      className={cn("relative", RESULT_ROW_INSET_DIVIDER_CLASS)}
      data-keyboard-highlighted={isKeyboardHighlighted ? "true" : undefined}
    >
      <button
        aria-label={translateUi(isAlreadySelected ? "dm.addedPerson" : "dm.addPerson", { name })}
        aria-selected={isAlreadySelected || isKeyboardHighlighted}
        className={cn(
          "group/dm-result flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left transition-colors duration-150 ease-out hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
          isKeyboardHighlighted && "bg-muted/40",
        )}
        data-testid={`new-dm-result-${user.principalId}`}
        disabled={disabled}
        id={`new-dm-option-${user.principalId}`}
        onClick={() => onSelect(user)}
        role="option"
        tabIndex={-1}
        type="button"
      >
        <Avatar className="h-8 w-8 text-xs shadow-none"><AvatarFallback>{getInitials(name)}</AvatarFallback></Avatar>
        <div className="min-w-0 flex-1">
          <HoverRecipientIdentity displayName={name} pubkey={user.pubkeys[0] ?? ""} />
        </div>
      </button>
    </div>
  );
}
