// Reused from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/ui/PersonaShareRecipients.tsx.
// DD-131(7): recipients are same-Tenant people from the BFF conversation directory (the one the
// New Message screen uses), never Agents or a Relay-wide user search; the original 8-person limit
// is kept and further bounded by the directory's conversation size.
import { Search } from "lucide-react";
import * as React from "react";

import type { ConversationParticipant } from "@client-kit/contracts";
import { useUiT } from "../context";
import { Popover, PopoverAnchor, PopoverContent } from "../conversations/popover";
import { SelectedRecipientChip } from "../conversations/selected-recipient-chip";
import { useConversationDirectory } from "../conversations/use-conversations";
import { IdentityInitialsAvatar } from "./IdentityInitialsAvatar";

const RECIPIENT_LIMIT = 8;

export function formatShareRecipientName(user: ConversationParticipant) {
  return user.displayName.trim() || user.principalId;
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-md bg-primary/10 ${className}`} />;
}

export function PersonaShareRecipients({
  currentPrincipalId,
  disabled,
  onSelectionChange,
  open,
  testIdPrefix = "persona-share",
}: {
  currentPrincipalId: string;
  disabled: boolean;
  onSelectionChange: (users: ConversationParticipant[]) => void;
  open: boolean;
  testIdPrefix?: string;
}) {
  const t = useUiT();
  const directory = useConversationDirectory(currentPrincipalId);
  const [isPickerOpen, setIsPickerOpen] = React.useState(false);
  const recipientFieldRef = React.useRef<HTMLDivElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const { selectedUsers, searchQuery, setSearchQuery, deferredSearchQuery, removeUser } = directory;
  const limit = Math.min(RECIPIENT_LIMIT, directory.maxParticipants !== undefined ? directory.maxParticipants - 1 : RECIPIENT_LIMIT);
  const atLimit = directory.hasReachedRecipientLimit || selectedUsers.length >= limit;

  const selectionRef = React.useRef(onSelectionChange);
  selectionRef.current = onSelectionChange;
  React.useEffect(() => { selectionRef.current(selectedUsers); }, [selectedUsers]);
  React.useEffect(() => {
    if (!open) { setSearchQuery(""); setIsPickerOpen(false); }
  }, [open, setSearchQuery]);

  const selected = React.useMemo(() => new Set(selectedUsers.map((user) => user.principalId)), [selectedUsers]);
  const isSearchSettling = directory.isDirectoryLoading || searchQuery.trim() !== deferredSearchQuery;
  const visibleSearchResults = isSearchSettling ? [] : directory.searchResults.filter((user) => !selected.has(user.principalId));

  function selectUser(user: ConversationParticipant) {
    if (atLimit) return;
    directory.selectUser(user);
    setIsPickerOpen(true);
    searchInputRef.current?.focus({ preventScroll: true });
  }

  function remove(principalId: string) {
    removeUser(principalId);
    searchInputRef.current?.focus({ preventScroll: true });
  }

  return (
    <div className="min-w-0 flex-1">
      <Popover modal={false} onOpenChange={setIsPickerOpen} open={isPickerOpen && !disabled}>
        <PopoverAnchor asChild>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: the nested input is the keyboard-accessible focus target */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: clicking the shell focuses the nested search input */}
          <div
            className="grid min-h-10 min-w-0 cursor-text grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 rounded-md border border-input bg-background px-2 py-1.5 focus-within:ring-1 focus-within:ring-ring"
            data-testid={`${testIdPrefix}-recipient-field`}
            onClick={() => {
              if (disabled) return;
              setIsPickerOpen(true);
              searchInputRef.current?.focus({ preventScroll: true });
            }}
            ref={recipientFieldRef}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-1.5" data-testid={`${testIdPrefix}-recipient-input-region`}>
              {selectedUsers.length === 0 ? <Search className="h-4 w-4 shrink-0 text-muted-foreground/55" /> : null}
              {selectedUsers.map((user) => (
                <SelectedRecipientChip
                  disabled={disabled}
                  inspectable={false}
                  key={user.principalId}
                  label={formatShareRecipientName(user)}
                  onRemove={() => remove(user.principalId)}
                  testIds={{ chip: `${testIdPrefix}-recipient-chip-${user.principalId}` }}
                  user={user}
                />
              ))}
              <input
                aria-autocomplete="list"
                aria-controls={`${testIdPrefix}-recipient-results`}
                aria-expanded={isPickerOpen && !disabled}
                aria-label={t("agentSnapshots.shareWith")}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                className="h-7 min-w-16 flex-1 border-0 bg-transparent p-0 text-sm outline-hidden placeholder:text-muted-foreground/55"
                data-testid={`${testIdPrefix}-recipient-search`}
                disabled={disabled || atLimit}
                onChange={(event) => { setSearchQuery(event.target.value); setIsPickerOpen(true); }}
                onFocus={() => setIsPickerOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") { event.preventDefault(); setIsPickerOpen(false); return; }
                  if (event.key === "Backspace" && searchQuery.length === 0 && selectedUsers.length > 0) {
                    event.preventDefault();
                    const lastUser = selectedUsers[selectedUsers.length - 1];
                    if (lastUser) remove(lastUser.principalId);
                    return;
                  }
                  if (event.key !== "Enter") return;
                  const first = searchQuery.trim() && searchQuery.trim() === deferredSearchQuery ? visibleSearchResults[0] : undefined;
                  if (!first) return;
                  event.preventDefault();
                  selectUser(first);
                }}
                placeholder={atLimit ? t("agentSnapshots.recipientLimit") : selectedUsers.length === 0 ? t("agentSnapshots.searchPeople") : ""}
                ref={searchInputRef}
                role="combobox"
                spellCheck={false}
                type="text"
                value={searchQuery}
              />
            </div>
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) overflow-hidden p-0"
          data-testid={`${testIdPrefix}-recipient-popover`}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            const target = event.detail.originalEvent.target;
            if (target instanceof Element && recipientFieldRef.current?.contains(target)) event.preventDefault();
          }}
          onOpenAutoFocus={(event) => event.preventDefault()}
          sideOffset={6}
        >
          <div
            className="max-h-64 overflow-y-auto overscroll-contain py-1"
            data-testid={`${testIdPrefix}-recipient-results`}
            id={`${testIdPrefix}-recipient-results`}
            onScroll={directory.handleDirectoryScroll}
            onTouchMoveCapture={(event) => event.stopPropagation()}
            onWheelCapture={(event) => event.stopPropagation()}
            role="listbox"
          >
            {isSearchSettling ? (
              <div aria-label={t("agentSnapshots.loadingPeople")} className="space-y-3 px-3 py-3" role="status">
                {["w-36", "w-28", "w-40"].map((width) => (
                  <div className="flex items-center gap-3" key={width}>
                    <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                    <Skeleton className={`h-4 ${width}`} />
                  </div>
                ))}
              </div>
            ) : directory.searchError ? (
              <p className="px-3 py-3 text-sm text-destructive" role="alert">{directory.searchError.message}</p>
            ) : visibleSearchResults.length > 0 ? (
              visibleSearchResults.map((user, index) => (
                <button
                  aria-label={t("agentSnapshots.addRecipient", { name: formatShareRecipientName(user) })}
                  className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-hidden"
                  data-testid={`${testIdPrefix}-recipient-option-${user.principalId}`}
                  key={user.principalId}
                  onClick={() => selectUser(user)}
                  role="option"
                  aria-selected={false}
                  type="button"
                >
                  <span className="h-8 w-8 shrink-0"><IdentityInitialsAvatar className="border-0 text-xs shadow-none" colorIndex={index} label={formatShareRecipientName(user)} size={32} /></span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{formatShareRecipientName(user)}</span>
                </button>
              ))
            ) : (
              <p className="px-3 py-3 text-sm text-muted-foreground">{t("agentSnapshots.noPeople")}</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
