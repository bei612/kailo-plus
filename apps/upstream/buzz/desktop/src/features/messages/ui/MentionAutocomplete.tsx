import * as React from "react";

import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
import {
  POPOVER_CUSTOM_ENTER_MOTION_CLASS,
  POPOVER_SHADOW_STYLE,
  POPOVER_SURFACE_CLASS,
} from "@/shared/ui/popoverSurface";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { safeNpub } from "@/shared/lib/nostrUtils";
import { truncateNpub } from "@/shared/lib/pubkey";

export type MentionSuggestion = {
  pubkey: string;
  displayName: string;
  avatarUrl?: string | null;
  role?: string | null;
};

type MentionAutocompleteProps = {
  suggestions: MentionSuggestion[];
  selectedIndex: number;
  /** Whether the owning composer currently owns document focus. */
  composerOwnsFocus: boolean;
  onSelect: (suggestion: MentionSuggestion) => void;
  onDismiss?: () => void;
  position?: "above" | "below";
};

export const MentionAutocomplete = React.memo(function MentionAutocomplete({
  suggestions,
  selectedIndex,
  composerOwnsFocus = true,
  onSelect,
  onDismiss,
  position = "above",
}: MentionAutocompleteProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const activeItem = listRef.current?.querySelector<HTMLElement>(
      `[data-mention-suggestion-index="${selectedIndex}"]`,
    );
    activeItem?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  React.useEffect(() => {
    if (!onDismiss) return;

    const handlePointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      const target = event.target;
      if (!root || !(target instanceof Node)) return;
      if (listRef.current?.contains(target)) {
        return;
      }

      const composer = root.closest("form");
      const mentionTrigger =
        target instanceof Element
          ? target.closest("[data-mention-picker-trigger]")
          : null;
      if (composer && mentionTrigger && composer.contains(mentionTrigger)) {
        return;
      }

      onDismiss();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [onDismiss]);

  const handleOverlayKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      rootRef.current
        ?.closest("form")
        ?.querySelector<HTMLElement>('[data-testid="message-input"]')
        ?.focus();
      onDismiss?.();
    },
    [onDismiss],
  );

  if (!composerOwnsFocus || suggestions.length === 0) {
    return null;
  }

  // Name collisions are the impersonation vector: a vanity-ground key can
  // wear any display name. When two suggestions share a name, surface each
  // one's npub (truncated; full key in the hover tooltip) to tell them apart.
  const nameCounts = new Map<string, number>();
  for (const suggestion of suggestions) {
    const name = suggestion.displayName.toLowerCase();
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the overlay's controls own keyboard interaction; Escape returns focus to the editor.
    <div
      className={cn(
        "absolute left-0 right-0 z-50 px-3 sm:px-4",
        position === "below" ? "top-full mt-1" : "bottom-full mb-1",
      )}
      data-testid="mention-autocomplete-layer"
      onKeyDown={handleOverlayKeyDown}
      ref={rootRef}
    >
      <div className="w-full max-w-2xl">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-only guard keeps padding and scrollbar presses from blurring the owning editor. */}
        <div
          className={cn(
            "max-h-48 w-full overflow-y-auto rounded-xl p-1",
            POPOVER_CUSTOM_ENTER_MOTION_CLASS,
            position === "below"
              ? "origin-top slide-in-from-top-1"
              : "origin-bottom slide-in-from-bottom-1",
            POPOVER_SURFACE_CLASS,
          )}
          data-testid="mention-autocomplete"
          onMouseDown={(event) => event.preventDefault()}
          ref={listRef}
          style={POPOVER_SHADOW_STYLE}
        >
          {suggestions.map((suggestion, index) => {
            const hasNameCollision =
              (nameCounts.get(suggestion.displayName.toLowerCase()) ?? 0) > 1;
            const collisionNpub = hasNameCollision
              ? safeNpub(suggestion.pubkey)
              : null;

            return (
              <div
                className={cn(
                  "relative flex w-full items-stretch rounded-lg text-left text-sm",
                  index === selectedIndex
                    ? "bg-accent text-accent-foreground"
                    : "text-popover-foreground hover:bg-accent/50",
                )}
                data-testid={`mention-suggestion-${suggestion.pubkey}`}
                data-mention-suggestion-index={index}
                key={suggestion.pubkey}
              >
                <button
                  aria-label={`Mention ${suggestion.displayName}`}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-1.5 text-left"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onSelect(suggestion);
                  }}
                  tabIndex={-1}
                  type="button"
                >
                  <UserAvatar
                    avatarUrl={suggestion.avatarUrl ?? null}
                    displayName={suggestion.displayName}
                    size="xs"
                    testId="mention-suggestion-avatar"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span
                      className="min-w-0 break-words font-medium leading-snug"
                      title={suggestion.displayName}
                    >
                      {suggestion.displayName}
                    </span>
                    {suggestion.role || collisionNpub ? (
                      <span
                        className={cn(
                          "flex min-h-3.5 min-w-0 items-center gap-1.5 text-2xs leading-none",
                          index === selectedIndex
                            ? "text-accent-foreground/60"
                            : "text-muted-foreground",
                        )}
                      >
                        {suggestion.role ? (
                          <Badge
                            className="max-w-24 shrink-0 truncate"
                            variant="secondary"
                          >
                            {suggestion.role}
                          </Badge>
                        ) : null}
                        {collisionNpub ? (
                          <span
                            className="-translate-y-0.5 shrink-0 font-mono leading-none"
                            data-testid="mention-collision-npub"
                            title={collisionNpub}
                          >
                            {truncateNpub(collisionNpub)}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
