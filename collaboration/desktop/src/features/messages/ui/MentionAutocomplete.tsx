import * as React from "react";
import { MentionAutocomplete as SharedMentionAutocomplete } from "@client-kit/platform/react/mention-autocomplete";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
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

export const MentionAutocomplete = React.memo(function MentionAutocomplete(
  props: MentionAutocompleteProps,
) {
  const nameCounts = new Map<string, number>();
  for (const suggestion of props.suggestions) {
    const name = suggestion.displayName.toLowerCase();
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  return (
    <SharedMentionAutocomplete
      {...props}
      suggestionKey={(suggestion) => suggestion.pubkey}
      suggestionLabel={(suggestion) => `Mention ${suggestion.displayName}`}
      renderSuggestion={(suggestion, selected) => {
        const collisionNpub =
          (nameCounts.get(suggestion.displayName.toLowerCase()) ?? 0) > 1
            ? safeNpub(suggestion.pubkey)
            : null;
        return (
          <>
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
                    selected
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
          </>
        );
      }}
    />
  );
});
