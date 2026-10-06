import { useUiT } from "../context";
// Reused from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src; only identity/transport seams adapt to Kailo.

import { X } from "lucide-react";
import type { ConversationParticipant } from "@client-kit/contracts";
import { cn } from "../profile/buzz/shared/lib/cn";
import { PubKey } from "./pubkey-view";
import { Popover, PopoverAnchor, PopoverContent } from "./popover";

import { Avatar, AvatarFallback } from "../profile/buzz/shared/ui/avatar";
import { getInitials } from "../profile/buzz/shared/lib/initials";

type SelectedRecipientChipTestIds = {
  chip?: string;
  keyPopover?: string;
  name?: string;
  pubkey?: string;
};

/**
 * The selected-recipient pill shared by recipient pickers. Its avatar becomes
 * the remove affordance on hover/focus. Surfaces that need identity
 * verification can also make the name open the recipient's full key.
 */
export function SelectedRecipientChip({
  disabled,
  inspectable = true,
  inspectionOpen = false,
  label,
  onInspectionOpenChange,
  onRemove,
  testIds,
  user,
}: {
  disabled: boolean;
  inspectable?: boolean;
  inspectionOpen?: boolean;
  label: string;
  onInspectionOpenChange?: (open: boolean) => void;
  onRemove: () => void;
  testIds?: SelectedRecipientChipTestIds;
  user: ConversationParticipant;
}) {
  const translateUi = useUiT();
  return (
    <div className="inline-flex h-7 max-w-56 items-center gap-1.5 rounded-full bg-muted px-1 pr-2.5 text-sm transition-colors hover:bg-muted/80">
      <button
        aria-label={translateUi("dm.removePerson", { name: label })}
        className={cn(
          "group/remove-recipient relative h-5 w-5 shrink-0 rounded-full focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
        )}
        data-testid={testIds?.chip}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          event.stopPropagation();
          onRemove();
        }}
        type="button"
      >
        <Avatar className="h-5 w-5 text-3xs shadow-none transition-opacity group-hover/remove-recipient:opacity-0 group-focus-visible/remove-recipient:opacity-0"><AvatarFallback>{getInitials(label)}</AvatarFallback></Avatar>
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center bg-foreground text-background opacity-0 transition-opacity group-hover/remove-recipient:opacity-100 group-focus-visible/remove-recipient:opacity-100",
            "rounded-full",
          )}
          data-avatar-shape={"circle"}
        >
          <X aria-hidden="true" className="h-3 w-3" />
        </span>
      </button>
      {inspectable ? (
        <Popover onOpenChange={onInspectionOpenChange} open={inspectionOpen}>
          <PopoverAnchor asChild>
            <button
              aria-expanded={inspectionOpen}
              aria-haspopup="dialog"
              aria-label={`Verify ${label} public key`}
              className="min-w-0 cursor-pointer truncate rounded font-medium hover:underline focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
              data-testid={testIds?.name}
              onClick={(event) => {
                event.stopPropagation();
                onInspectionOpenChange?.(!inspectionOpen);
              }}
              type="button"
            >
              {label}
            </button>
          </PopoverAnchor>
          <PopoverContent
            align="start"
            className="w-96 max-w-[90vw] space-y-2"
            data-recipient-key-popover=""
            data-testid={testIds?.keyPopover}
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <p className="text-sm font-medium">{translateUi("dm.verifyPerson", { name: label })}</p>
            {user.pubkeys.map((pubkey) => <PubKey key={pubkey} pubkey={pubkey} testId={testIds?.pubkey} variant="full" />)}
          </PopoverContent>
        </Popover>
      ) : (
        <span className="min-w-0 truncate font-medium">{label}</span>
      )}

    </div>
  );
}
