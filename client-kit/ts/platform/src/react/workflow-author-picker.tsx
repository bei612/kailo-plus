// Original WorkflowAuthorPicker, Buzz 779af8886caae1317b4de962082429867ab61503.
// Queries are supplied by the existing authorized BFF directory; DOM/keyboard behavior retained.
import { Check, LoaderCircle, Search } from "lucide-react";
import * as React from "react";

import { useT } from "./context";
import { useWorkflowAuthorProfiles, type WorkflowAuthorDirectory } from "./workflow-author-directory";
import { resolveUserLabel } from "./messages/system/identity";
import { cn } from "./profile/buzz/shared/lib/cn";
import { truncateNpub } from "./conversations/pubkey";
import { Input } from "./composer/shared/ui/input";
import { UserAvatar } from "./messages/UserAvatar";
import {
  enrichAuthorCandidates,
  filterAuthorCandidatePage,
  mergeAuthorCandidateSources,
  nextWorkflowAuthorIndex,
  parseDirectAuthorInput,
  type WorkflowAuthorCandidate,
} from "./workflow-author-candidates";

const PAGE_SIZE = 50;

export function WorkflowAuthorPicker({
  channelId,
  directory,
  disabled,
  id,
  onChange,
  onEscape,
  value,
}: {
  channelId?: string | null;
  directory: WorkflowAuthorDirectory;
  disabled?: boolean;
  id: string;
  onChange: (pubkey: string) => void;
  onEscape?: () => void;
  value: string;
}) {
  const t = useT();
  const pickerRef = React.useRef<HTMLDivElement>(null);
  const optionRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null);
  const [columnCount, setColumnCount] = React.useState(2);
  const trimmedQuery = query.trim();
  const deferredQuery = React.useDeferredValue(trimmedQuery);
  const normalizedValue = parseDirectAuthorInput(value);
  const directPubkey = parseDirectAuthorInput(deferredQuery);

  const baseCandidates = React.useMemo(
    () =>
      mergeAuthorCandidateSources([
        normalizedValue ? [{ pubkey: normalizedValue }] : [],
        directPubkey ? [{ pubkey: directPubkey }] : [],
        directory.rows,
      ]),
    [
      directPubkey,
      directory.rows,
      normalizedValue,
    ],
  );
  const [visibleLimit, setVisibleLimit] = React.useState(PAGE_SIZE);
  const candidatePage = React.useMemo(
    () =>
      filterAuthorCandidatePage(
        baseCandidates,
        deferredQuery,
        directPubkey,
        visibleLimit,
      ),
    [baseCandidates, deferredQuery, directPubkey, visibleLimit],
  );
  const profileQuery = useWorkflowAuthorProfiles(channelId ?? undefined,
    candidatePage.map(({ pubkey }) => pubkey), directory);
  React.useEffect(() => { setVisibleLimit(PAGE_SIZE); }, [deferredQuery]);
  React.useEffect(() => {
    if (deferredQuery && directory.hasNextPage && !directory.isLoading && !directory.isError) {
      void directory.fetchNextPage();
    }
  }, [deferredQuery, directory]);

  const candidates = React.useMemo(
    () =>
      enrichAuthorCandidates(candidatePage, profileQuery.profiles),
    [candidatePage, profileQuery.profiles],
  );
  const visibleCandidates = candidates;
  const hasMore = filterAuthorCandidatePage(baseCandidates, deferredQuery, directPubkey, visibleLimit + 1).length > visibleLimit || directory.hasNextPage;
  const loadMore = () => { setVisibleLimit((limit) => limit + PAGE_SIZE); if (directory.hasNextPage) void directory.fetchNextPage(); };
  const listId = `${id}-list`;

  React.useEffect(() => {
    if (activeIndex !== null && activeIndex >= visibleCandidates.length) {
      setActiveIndex(
        visibleCandidates.length > 0 ? visibleCandidates.length - 1 : null,
      );
    }
  }, [activeIndex, visibleCandidates.length]);

  React.useEffect(() => {
    const picker = pickerRef.current;
    if (!picker) return;
    const updateColumnCount = () =>
      setColumnCount(picker.clientWidth >= 544 ? 3 : 2);
    updateColumnCount();
    const observer = new ResizeObserver(updateColumnCount);
    observer.observe(picker);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (activeIndex === null) return;
    const candidate = visibleCandidates[activeIndex];
    if (!candidate) return;
    optionRefs.current
      .get(candidate.pubkey)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeIndex, visibleCandidates]);

  const loading = directory.isLoading && visibleCandidates.length === 0;
  const failed = directory.isError;

  function moveActive(delta: number) {
    setActiveIndex((current) =>
      nextWorkflowAuthorIndex(current, delta, visibleCandidates.length),
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/70 bg-background/35"
      data-testid="workflow-author-picker"
      ref={pickerRef}
    >
      <div className="relative shrink-0 border-b border-border/70">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-activedescendant={
            activeIndex !== null && visibleCandidates[activeIndex]
              ? `${listId}-${visibleCandidates[activeIndex].pubkey}`
              : undefined
          }
          aria-controls={listId}
          aria-label={t("workflows.condition.searchAuthors")}
          aria-expanded="true"
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          className="h-11 rounded-none border-0 bg-transparent pl-9 focus-visible:ring-0"
          data-workflow-filter-picker-search="true"
          disabled={disabled}
          id={id}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(null);
          }}
          onKeyDown={(event) => {
            const currentQuery = event.currentTarget.value.trim();
            const delta =
              event.key === "ArrowDown"
                ? columnCount
                : event.key === "ArrowUp"
                  ? -columnCount
                  : event.key === "ArrowRight"
                    ? 1
                    : event.key === "ArrowLeft"
                      ? -1
                      : 0;
            if (delta) {
              event.preventDefault();
              moveActive(delta);
            } else if (
              event.key === "Enter" &&
              currentQuery === deferredQuery &&
              visibleCandidates[activeIndex ?? 0]
            ) {
              event.preventDefault();
              const candidate = visibleCandidates[activeIndex ?? 0]!;
              onChange(
                candidate.pubkey === normalizedValue ? "" : candidate.pubkey,
              );
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              if (query) {
                setQuery("");
                setActiveIndex(null);
              } else {
                onEscape?.();
              }
            }
          }}
          placeholder={t("workflows.condition.searchPlaceholder")}
          role="combobox"
          spellCheck={false}
          value={query}
        />
      </div>

      <div
        aria-label={t("workflows.condition.authors")}
        className={cn(
          "grid min-h-0 flex-1 gap-2 overflow-y-auto overscroll-contain p-2",
          columnCount === 3 ? "grid-cols-3" : "grid-cols-2",
        )}
        data-testid="workflow-author-picker-results"
        id={listId}
        onScroll={(event) => {
          const list = event.currentTarget;
          if (
            list.scrollHeight - list.scrollTop - list.clientHeight < 64 &&
            hasMore &&
            !directory.isFetchingNextPage
          ) {
            loadMore();
          }
        }}
        role="listbox"
      >
        {visibleCandidates.map((candidate, index) => (
          <AuthorOption
            active={activeIndex !== null && index === activeIndex}
            candidate={candidate}
            resolveMediaUrl={profileQuery.resolveMediaUrl}
            disabled={disabled}
            id={`${listId}-${candidate.pubkey}`}
            key={candidate.pubkey}
            onSelect={() => {
              setActiveIndex(null);
              onChange(
                candidate.pubkey === normalizedValue ? "" : candidate.pubkey,
              );
            }}
            optionRef={(node) => {
              if (node) optionRefs.current.set(candidate.pubkey, node);
              else optionRefs.current.delete(candidate.pubkey);
            }}
            selected={candidate.pubkey === normalizedValue}
          />
        ))}
        {loading ? (
          <p
            className="col-span-full flex items-center justify-center gap-2 px-3 py-8 text-sm text-muted-foreground"
            role="status"
          >
            <LoaderCircle className="h-4 w-4 animate-spin" /> {t("workflows.condition.loadingAuthors")}
          </p>
        ) : visibleCandidates.length === 0 ? (
          <p className="col-span-full px-3 py-8 text-center text-sm text-muted-foreground">
            {t(failed ? "workflows.condition.authorsFailed" : "workflows.condition.noAuthors")}
          </p>
        ) : null}
        {failed ? (
          <button
            className="col-span-full rounded-md px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/45 hover:text-foreground"
            onClick={() => {
              directory.refetch();
            }}
            type="button"
          >
            {t("workflows.condition.retryAuthors")}
          </button>
        ) : null}
        {hasMore ? (
          <button
            className="col-span-full rounded-md px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/45 hover:text-foreground"
            disabled={disabled || directory.isFetchingNextPage}
            onClick={() => loadMore()}
            type="button"
          >
            {directory.isFetchingNextPage
              ? t("workflows.condition.loadingMore")
              : t("workflows.condition.moreAuthors")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function AuthorOption({
  active,
  candidate,
  disabled,
  id,
  onSelect,
  optionRef,
  selected,
  resolveMediaUrl,
}: {
  active: boolean;
  candidate: WorkflowAuthorCandidate;
  disabled?: boolean;
  id: string;
  onSelect: () => void;
  optionRef: (node: HTMLButtonElement | null) => void;
  selected: boolean;
  resolveMediaUrl: (url: string) => string | undefined;
}) {
  const label = resolveUserLabel({
    fallbackName: candidate.displayName,
    profiles: {
      [candidate.pubkey]: {
        displayName: candidate.displayName,
        avatarUrl: candidate.avatarUrl,
        nip05Handle: candidate.nip05Handle,
        ownerPubkey: candidate.ownerPubkey,
        isAgent: candidate.isAgent,
      },
    },
    pubkey: candidate.pubkey,
  });
  return (
    <button
      aria-selected={selected}
      className={cn(
        "relative flex min-h-24 min-w-0 flex-col items-center justify-center gap-2 rounded-lg border bg-muted/20 p-3 text-center transition-colors",
        selected
          ? "border-primary bg-primary/10"
          : "border-border hover:bg-accent",
        active && "ring-1 ring-ring",
      )}
      disabled={disabled}
      id={id}
      onClick={onSelect}
      ref={optionRef}
      role="option"
      tabIndex={-1}
      type="button"
    >
      <UserAvatar
        resolveMediaUrl={resolveMediaUrl}
        avatarUrl={candidate.avatarUrl}
        displayName={label}
        shape={candidate.isAgent ? "squircle" : "circle"}
        size="md"
      />
      <span className="min-w-0 max-w-full">
        <span className="block truncate text-sm font-medium">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {truncateNpub(candidate.pubkey)}
        </span>
      </span>
      <Check
        className={cn(
          "absolute right-2 top-2 h-4 w-4",
          !selected && "opacity-0",
        )}
      />
    </button>
  );
}
