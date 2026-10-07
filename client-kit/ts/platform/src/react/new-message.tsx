import { useUiT } from "./context";
// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/messages/ui/NewMessageScreen.tsx.
// Original compose surface and keyboard interactions; BFF resolves people, hosts retain their real composer.
import * as React from "react";
import type { ConversationParticipant, ConversationView } from "@client-kit/contracts";
import { SelectedRecipientChip } from "./conversations/selected-recipient-chip";
import { Popover, PopoverAnchor, PopoverContent } from "./conversations/popover";
import { NewMessageResultRow } from "./conversations/new-message-result-row";
import { formatRecipientName, useConversationDirectory, useConversationOpen } from "./conversations/use-conversations";
export { useConversations, useConversationDirectory } from "./conversations/use-conversations";
export { ConversationPreparationPending } from "./conversations/use-conversations";
export { ConversationList } from "./conversations/conversation-list";
export { ConversationVisibilityProvider, useConversationInvalidation, useConversationVisibilityHost, type ConversationVisibilityHost } from "./conversations/use-conversation-state";
export { DM_VISIBILITY_KIND, hiddenConversationChannels } from "./conversations/visibility";
export { useHiddenDmInboxNavigation, type InboxNavigationTarget } from "./conversations/use-hidden-dm-inbox-navigation";
export { loadInboxConversations } from "./conversations/hidden-dm-inbox-action";
export type NewMessageComposerHost = {
  disabled: boolean;
  isSending: boolean;
  placeholder: string;
  recipients: readonly ConversationParticipant[];
  prepareConversation: () => Promise<ConversationView>;
};
function Skeleton({className}: {className: string}) { return <div className={`animate-pulse rounded-md bg-primary/10 ${className}`} />; }
function getKeyboardSearchSelection<T>({currentQuery, rankedQuery, results}: {currentQuery: string; rankedQuery: string; results: T[]}) {
  return currentQuery.trim().length > 0 && currentQuery.trim() === rankedQuery.trim() ? results[0] ?? null : null;
}
export function NewMessageScreen({currentPrincipalId, renderComposer, initialRecipientPubkey}: {
  currentPrincipalId: string;
  initialRecipientPubkey?: string;
  renderComposer: (host: NewMessageComposerHost) => React.ReactNode;
}) {
  const translateUi = useUiT();
  const [isRecipientPickerOpen, setIsRecipientPickerOpen] = React.useState(true);
  const [highlightedRecipientPubkey, setHighlightedRecipientPubkey] = React.useState<string | null>(null);
  const [inspectedRecipientPubkey, setInspectedRecipientPubkey] = React.useState<string | null>(null);
  const [submitErrorMessage, setSubmitErrorMessage] = React.useState<string | null>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const toFieldRef = React.useRef<HTMLDivElement>(null);
  const isMountedRef = React.useRef(false);
  const { deferredSearchQuery, handleDirectoryScroll, hasReachedRecipientLimit, isDirectoryLoading,
    maxParticipants, removeUser, searchError, searchQuery, searchResults, selectUser, selectedUsers,
    setSearchQuery } = useConversationDirectory(currentPrincipalId);
  const opening = useConversationOpen(currentPrincipalId, selectedUsers);
  const seededRecipient = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    if (!initialRecipientPubkey || seededRecipient.current === initialRecipientPubkey) return;
    setSearchQuery(initialRecipientPubkey);
    const recipient = searchResults.find((person) => person.pubkeys.includes(initialRecipientPubkey));
    if (recipient) {
      selectUser(recipient);
      seededRecipient.current = initialRecipientPubkey;
    }
  }, [initialRecipientPubkey, searchResults, selectUser, setSearchQuery]);
  const isPending = opening.busy;
  const isSearchTransitionPending = searchQuery.trim() !== deferredSearchQuery;
  const visibleSearchResults =
    isSearchTransitionPending || isDirectoryLoading ? [] : searchResults;
  const showRecipientPicker = isRecipientPickerOpen && !isPending && !opening.locked;
  const highlightedRecipientIndex = React.useMemo(() => {
    if (!showRecipientPicker || visibleSearchResults.length === 0) {
      return -1;
    }

    if (highlightedRecipientPubkey === null) {
      return 0;
    }

    return visibleSearchResults.findIndex(
      (user) => user.principalId === highlightedRecipientPubkey,
    );
  }, [highlightedRecipientPubkey, showRecipientPicker, visibleSearchResults]);
  const highlightedRecipient =
    highlightedRecipientIndex < 0
      ? null
      : (visibleSearchResults[highlightedRecipientIndex] ?? null);

  React.useEffect(() => {
    if (
      highlightedRecipientPubkey &&
      !isSearchTransitionPending &&
      highlightedRecipientIndex < 0
    ) {
      setHighlightedRecipientPubkey(null);
    }
  }, [
    highlightedRecipientIndex,
    highlightedRecipientPubkey,
    isSearchTransitionPending,
  ]);

  React.useEffect(() => {
    if (!highlightedRecipient || !showRecipientPicker) {
      return;
    }

    document
      .getElementById(`new-dm-option-${highlightedRecipient.principalId}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlightedRecipient, showRecipientPicker]);

  React.useEffect(() => {
    isMountedRef.current = true;
    searchInputRef.current?.focus({ preventScroll: true });

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleRemoveUser = React.useCallback(
    (pubkey: string) => {

      setInspectedRecipientPubkey((current) =>
        current === pubkey ? null : current,
      );
      removeUser(pubkey);
    },
    [removeUser],
  );

  const handleSelectUser = React.useCallback(
    (user: Parameters<typeof selectUser>[0]) => {

      selectUser(user);
      setHighlightedRecipientPubkey(null);
      setSubmitErrorMessage(null);
      setIsRecipientPickerOpen(true);
      searchInputRef.current?.focus({ preventScroll: true });
    },
    [selectUser],
  );

  const handleResultSelect = React.useCallback(
    (user: Parameters<typeof selectUser>[0]) => {
      const isSelected = selectedUsers.some(
        (selectedUser) => selectedUser.principalId === user.principalId,
      );
      if (isSelected) {
        setSearchQuery("");
        setHighlightedRecipientPubkey(null);
        setSubmitErrorMessage(null);
        setIsRecipientPickerOpen(true);
        searchInputRef.current?.focus({ preventScroll: true });
        return;
      }

      handleSelectUser(user);
    },
    [handleSelectUser, selectedUsers, setSearchQuery],
  );

  const composerPlaceholder =
    selectedUsers.length === 0
      ? translateUi("dm.chooseRecipient")
      : selectedUsers.length === 1
        ? translateUi("dm.messagePerson", { name: formatRecipientName(selectedUsers[0]!) })
        : translateUi("dm.messagePeople", { count: selectedUsers.length });

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      data-testid="new-message-page"
    >
      <header
        className="relative z-40 shrink-0 cursor-default select-none border-b border-border/35 bg-background/80 px-5 py-2 backdrop-blur-md supports-backdrop-filter:bg-background/70 dark:bg-background/70 dark:backdrop-blur-xl dark:supports-backdrop-filter:bg-background/55"
        data-testid="new-message-header"
        data-tauri-drag-region
      >
        <div className="flex min-h-9 min-w-0 items-center">
          <Popover
            onOpenChange={(open) => {
              setIsRecipientPickerOpen(
                open || inspectedRecipientPubkey !== null,
              );
            }}
            open={showRecipientPicker}
          >
            <PopoverAnchor asChild>
              {/* biome-ignore lint/a11y/noStaticElementInteractions: clicking anywhere in the recipient field focuses its input */}
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: the nested combobox is the keyboard-accessible focus target */}
              <div
                className="group/to-field flex min-h-9 min-w-0 flex-1 cursor-text flex-wrap items-center gap-1.5 py-1"
                data-testid="new-message-to-field"
                onClick={(event) => {
                  // Portaled popovers (recipient inspection and its nested key
                  // copy) still bubble through React's tree to this handler,
                  // but their event targets are not DOM descendants of the
                  // field. Those clicks belong to the popover's own controls
                  // — they must not steal focus into the search input (which
                  // dismisses the popover via focus-outside) or reopen the
                  // picker. Only clicks physically within the recipient field
                  // focus its input.
                  const { currentTarget, target } = event;
                  if (
                    !(target instanceof Node) ||
                    !currentTarget.contains(target)
                  ) {
                    return;
                  }
                  setIsRecipientPickerOpen(true);
                  searchInputRef.current?.focus({ preventScroll: true });
                }}
                ref={toFieldRef}
              >
                <span className="shrink-0 text-base font-semibold tracking-tight">
                  {translateUi("dm.toLabel")}
                </span>
                {selectedUsers.map((user) => (
                  <SelectedRecipientChip
                    disabled={isPending || opening.locked}
                    inspectionOpen={inspectedRecipientPubkey === user.principalId}
                    key={user.principalId}
                    label={formatRecipientName(user)}
                    onInspectionOpenChange={(inspectionOpen) => {
                      setInspectedRecipientPubkey(
                        inspectionOpen ? user.principalId : null,
                      );
                    }}
                    onRemove={() => handleRemoveUser(user.principalId)}
                    testIds={{
                      chip: `new-dm-selected-${user.principalId}`,
                      keyPopover: `new-dm-selected-key-popover-${user.principalId}`,
                      name: `new-dm-recipient-name-${user.principalId}`,
                      pubkey: `new-dm-selected-pubkey-${user.principalId}`,
                    }}
                    user={user}
                  />
                ))}
                <input
                  aria-activedescendant={
                    highlightedRecipient
                      ? `new-dm-option-${highlightedRecipient.principalId}`
                      : undefined
                  }
                  aria-controls="new-dm-results"
                  aria-expanded={showRecipientPicker}
                  aria-label={translateUi("dm.to")}
                  autoComplete="off"
                  autoCorrect="off"
                  className="h-7 min-w-32 flex-1 bg-transparent text-base outline-hidden placeholder:text-muted-foreground"
                  data-testid="new-dm-search"
                  disabled={isPending || opening.locked}
                  id="new-dm-search"
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setHighlightedRecipientPubkey(null);
                    setSubmitErrorMessage(null);
                    setIsRecipientPickerOpen(true);
                  }}
                  onFocus={() => setIsRecipientPickerOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      if (inspectedRecipientPubkey) {
                        setInspectedRecipientPubkey(null);
                        return;
                      }
                      setHighlightedRecipientPubkey(null);
                      setIsRecipientPickerOpen(false);
                      return;
                    }

                    if (
                      (event.key === "ArrowDown" || event.key === "ArrowUp") &&
                      visibleSearchResults.length > 0
                    ) {
                      event.preventDefault();
                      setIsRecipientPickerOpen(true);
                      setHighlightedRecipientPubkey(() => {
                        const current = highlightedRecipientIndex;
                        if (current < 0) {
                          const initialIndex =
                            event.key === "ArrowDown"
                              ? 0
                              : visibleSearchResults.length - 1;
                          return (
                            visibleSearchResults[initialIndex]?.principalId ?? null
                          );
                        }

                        const direction = event.key === "ArrowDown" ? 1 : -1;
                        const nextIndex =
                          (current + direction + visibleSearchResults.length) %
                          visibleSearchResults.length;
                        return visibleSearchResults[nextIndex]?.principalId ?? null;
                      });
                      return;
                    }

                    if (
                      event.key === "Backspace" &&
                      searchQuery.length === 0 &&
                      selectedUsers.length > 0
                    ) {
                      event.preventDefault();
                      const lastRecipient =
                        selectedUsers[selectedUsers.length - 1];
                      if (lastRecipient) {
                        document
                          .querySelector<HTMLElement>(
                            `[data-testid="new-dm-selected-${lastRecipient.principalId}"]`,
                          )
                          ?.dispatchEvent(
                            new MouseEvent("click", {
                              bubbles: true,
                              detail: 0,
                            }),
                          );
                      }
                      return;
                    }

                    if (event.key !== "Enter") {
                      return;
                    }

                    if (searchQuery.trim().length === 0) {
                      if (highlightedRecipient) {
                        event.preventDefault();
                        handleSelectUser(highlightedRecipient);
                      }
                      return;
                    }

                    const keyboardSelection =
                      highlightedRecipient ??
                      getKeyboardSearchSelection({
                        currentQuery: searchQuery,
                        rankedQuery: deferredSearchQuery,
                        results: visibleSearchResults,
                      });
                    if (!keyboardSelection) {
                      return;
                    }

                    event.preventDefault();
                    handleResultSelect(keyboardSelection);
                  }}
                  ref={searchInputRef}
                  role="combobox"
                  spellCheck={false}
                  type="text"
                  value={searchQuery}
                />
              </div>
            </PopoverAnchor>
            <PopoverContent
              align="start"
              className="w-[min(36rem,calc(100vw-3rem))] overflow-hidden p-0"
              data-testid="new-message-recipient-popover"
              onCloseAutoFocus={(event) => event.preventDefault()}
              onInteractOutside={(event) => {
                const target = event.detail.originalEvent.target;
                if (
                  target instanceof Element &&
                  (toFieldRef.current?.contains(target) ||
                    Boolean(target.closest("[data-recipient-key-popover]")))
                ) {
                  event.preventDefault();
                }
              }}
              onOpenAutoFocus={(event) => event.preventDefault()}
              side="bottom"
              sideOffset={6}
            >
              <div
                className="max-h-80 overflow-y-auto"
                data-testid="new-dm-results"
                id="new-dm-results"
                onScroll={handleDirectoryScroll}
                role="listbox"
              >
                {visibleSearchResults.length > 0 ? (
                  <div>
                    {visibleSearchResults.map((user) => {
                      const isSelected = selectedUsers.some(
                        (selectedUser) => selectedUser.principalId === user.principalId,
                      );
                      return (
                        <NewMessageResultRow

                          disabled={
                            isPending || opening.locked ||
                            (hasReachedRecipientLimit && !isSelected)
                          }
                          isAlreadySelected={isSelected}
                          isKeyboardHighlighted={
                            highlightedRecipient?.principalId === user.principalId
                          }
                          key={user.principalId}
                          onSelect={handleResultSelect}

                          user={user}
                        />
                      );
                    })}
                  </div>
                ) : isDirectoryLoading || isSearchTransitionPending ? (
                  <div
                    aria-busy="true"
                    aria-label={translateUi("dm.loadingPeople")}
                    className="space-y-3 px-4 py-3"
                    data-testid="new-dm-loading"
                    role="status"
                  >
                    {["w-40", "w-32", "w-48"].map((nameWidth) => (
                      <div className="flex items-center gap-3" key={nameWidth}>
                        <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
                        <div className="flex min-w-0 flex-1 flex-col gap-2">
                          <Skeleton className={`h-4 ${nameWidth}`} />
                          <Skeleton className="h-3 w-24" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p
                    className="px-4 py-3 text-sm text-muted-foreground"
                    data-testid="new-dm-empty"
                  >
                    {deferredSearchQuery.length === 0
                      ? translateUi("dm.empty")
                      : translateUi("dm.noMatch")}
                  </p>
                )}
              </div>
            </PopoverContent>
          </Popover>

          {isPending ? (
            <span
              className="shrink-0 pl-2 text-sm text-muted-foreground"
              data-testid="new-dm-opening"
            >
              {translateUi("dm.opening")}
            </span>
          ) : null}
        </div>
      </header>

      <div
        className="min-h-0 flex-1 bg-background"
        data-testid="new-message-body"
      />

      {hasReachedRecipientLimit ? (
        <p
          className="px-5 pb-2 text-sm text-muted-foreground"
          data-testid="new-dm-limit"
        >
          {translateUi("dm.limit", { count: maxParticipants ?? 0 })}
        </p>
      ) : null}
      {searchError ? (
        <p className="px-5 pb-2 text-sm text-destructive">
          {translateUi("dm.directoryUnavailable")}
        </p>
      ) : null}
      {opening.notice ? <p className="px-5 pb-2 text-sm text-muted-foreground" role="status">{opening.notice}<button type="button" disabled={isPending} onClick={() => void opening.checkStatus().then(() => setSubmitErrorMessage(null))}>{translateUi("dm.checkStatus")}</button></p> : null}
      {submitErrorMessage && !opening.notice ? (
        <p className="px-5 pb-2 text-sm text-destructive">
          {submitErrorMessage}
        </p>
      ) : null}

      {renderComposer({
        disabled: isPending || selectedUsers.length === 0,
        isSending: isPending,
        placeholder: composerPlaceholder,
        recipients: selectedUsers,
        prepareConversation: async () => {
          try { return await opening.prepareConversation(); }
          catch (error) { setSubmitErrorMessage(error instanceof Error ? error.message : translateUi("dm.unavailable")); throw error; }
        },
      })}
      <div aria-hidden="true" className="min-h-8 bg-background px-5 pb-1.5" />
    </div>
  );
}
