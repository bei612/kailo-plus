import * as React from "react";
import {
  POPOVER_CUSTOM_ENTER_MOTION_CLASS,
  POPOVER_SHADOW_STYLE,
  POPOVER_SURFACE_CLASS,
} from "./popover-surface";

// The original Buzz picker surface; each host supplies its own authoritative identity presentation.

type MentionAutocompleteProps<Suggestion> = {
  suggestions: Suggestion[];
  suggestionKey: (suggestion: Suggestion) => string;
  suggestionLabel: (suggestion: Suggestion) => string;
  renderSuggestion: (
    suggestion: Suggestion,
    selected: boolean,
  ) => React.ReactNode;
  selectedIndex: number;
  /** Whether the owning composer currently owns document focus. */
  composerOwnsFocus: boolean;
  onSelect: (suggestion: Suggestion) => void;
  onDismiss?: () => void;
  position?: "above" | "below";
};

export function MentionAutocomplete<Suggestion>({
  suggestionKey,
  suggestionLabel,
  renderSuggestion,
  suggestions,
  selectedIndex,
  composerOwnsFocus = true,
  onSelect,
  onDismiss,
  position = "above",
}: MentionAutocompleteProps<Suggestion>) {
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

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the overlay's controls own keyboard interaction; Escape returns focus to the editor.
    <div
      className={[
        "absolute left-0 right-0 z-50 px-3 sm:px-4",
        position === "below" ? "top-full mt-1" : "bottom-full mb-1",
      ].join(" ")}
      data-testid="mention-autocomplete-layer"
      onKeyDown={handleOverlayKeyDown}
      ref={rootRef}
    >
      <div className="w-full max-w-2xl">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-only guard keeps padding and scrollbar presses from blurring the owning editor. */}
        <div
          className={[
            "max-h-48 w-full overflow-y-auto rounded-xl p-1",
            POPOVER_CUSTOM_ENTER_MOTION_CLASS,
            position === "below"
              ? "origin-top slide-in-from-top-1"
              : "origin-bottom slide-in-from-bottom-1",
            POPOVER_SURFACE_CLASS,
          ].join(" ")}
          data-testid="mention-autocomplete"
          onMouseDown={(event) => event.preventDefault()}
          ref={listRef}
          style={POPOVER_SHADOW_STYLE}
        >
          {suggestions.map((suggestion, index) => {
            return (
              <div
                className={[
                  "relative flex w-full items-stretch rounded-lg text-left text-sm",
                  index === selectedIndex
                    ? "bg-accent text-accent-foreground"
                    : "text-popover-foreground hover:bg-accent/50",
                ].join(" ")}
                data-testid={`mention-suggestion-${suggestionKey(suggestion)}`}
                data-mention-suggestion-index={index}
                key={suggestionKey(suggestion)}
              >
                <button
                  aria-label={suggestionLabel(suggestion)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-1.5 text-left"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onSelect(suggestion);
                  }}
                  tabIndex={-1}
                  type="button"
                >
                  {renderSuggestion(suggestion, index === selectedIndex)}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
