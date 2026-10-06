// Original Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/channels/ui/ChannelBrowserDialog.tsx::ChannelBrowserDialog.
// Only the typed data/command adapter changes; original browse/search/tabs/rows and keyboard interaction remain shared.
import * as React from "react";
import {
  ArrowLeft,
  Compass,
  Plus,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";

import type { DiscoverableWorkspace } from "@client-kit/contracts";
import { ChannelType, CreateActionKey } from "@client-kit/contracts";
import { useT, useLocale } from "../context";
import { enumLabel, workspaceMembershipStateMessages } from "../../i18n";
import { useWorkspaceCreate, WorkspaceCreateForm } from "../roles";
export type BrowserChannel = DiscoverableWorkspace & { name: string; description: string; channelType: ChannelType; archivedAt: boolean; lastMessageAt?: string | null };
type Channel = BrowserChannel;
import {
  canonicalChannelName,
  channelNamesMatch,
} from "./canonicalChannelName";
import { scoreChannelMatch } from "./channelSearchScore";
import {
  type ChannelSortMode,
  sortChannelsForSidebar,
} from "../sidebar/channelSortPreference";
import { ListSortDescending } from "./icons";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../composer/shared/ui/dialog";
import { Badge } from "./badge";
import { Button } from "../profile/buzz/shared/ui/button";
import {
  MODAL_SEARCH_INPUT_CLASS,
  MODAL_SEARCH_SHELL_CLASS,
} from "./modalSearchStyles";
import { Tabs, TabsList, TabsTrigger } from "../profile/buzz/shared/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../sidebar/dropdown-menu";


type BrowserTab = "all" | "joined" | "archived";
type ChannelSort = ChannelSortMode | "members";


function BrowseState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-4 text-base font-semibold tracking-tight">{title}</p>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

type ChannelBrowserDialogProps = {
  channels: Channel[];
  channelTypeFilter?: "stream" | "forum";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJoinChannel: (channelId: string) => Promise<boolean>;
  onSelectChannel: (channelId: string) => void;
  /**
   * Create a new channel/forum from within the browser. When provided, the
   * dialog surfaces a "Create …" affordance (Are.na style) so search and
   * create live behind a single entry point.
   */
  createActionKey?: CreateActionKey;
  busy?: boolean;
  status?: React.ReactNode;
};

export function ChannelBrowserDialog({
  channels,
  channelTypeFilter,
  open,
  onOpenChange,
  onJoinChannel,
  onSelectChannel,
  createActionKey,
  busy = false,
  status,
}: ChannelBrowserDialogProps) {
  const t = useT();
  const CHANNEL_SORT_OPTIONS: { label: string; value: ChannelSort }[] = [
    { label: t("channel.browser.alpha"), value: "alpha" },
    { label: t("channel.browser.recent"), value: "recent" },
    { label: t("channel.browser.membersSort"), value: "members" },
  ];
  const [query, setQuery] = React.useState("");
  const [activeTab, setActiveTab] = React.useState<BrowserTab>("all");
  const [sort, setSort] = React.useState<ChannelSort>("alpha");
  const [selectedIndex, setSelectedIndex] = React.useState<number | null>(null);
  const [joiningChannelId, setJoiningChannelId] = React.useState<string | null>(
    null,
  );
  const [mode, setMode] = React.useState<"browse" | "create">("browse");
  const [createInitialName, setCreateInitialName] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const tabListRef = React.useRef<HTMLDivElement>(null);
  const tabTriggerRefs = React.useRef<
    Record<BrowserTab, HTMLButtonElement | null>
  >({
    all: null,
    joined: null,
    archived: null,
  });
  const [tabIndicator, setTabIndicator] = React.useState({
    left: 0,
    width: 0,
  });
  const canonicalQuery = canonicalChannelName(query);
  const deferredQuery = React.useDeferredValue(canonicalQuery.toLowerCase());
  const trimmedQuery = canonicalQuery;
  // Immediate (non-deferred) lowercased query. The create row's visibility
  // (via hasExactMatch) and its label both read from the live query so they
  // can never disagree for a frame while the fuzzy filter catches up.
  const normalizedQuery = trimmedQuery.toLowerCase();

  const isForumMode = channelTypeFilter === "forum";
  const canCreate = Boolean(createActionKey);
  const createKind = isForumMode ? ChannelType.Forum : ChannelType.Stream;
  const browseTitle = t(isForumMode ? "channel.browser.forumTitle" : "channel.browser.title");
  const searchPlaceholder = canCreate
    ? isForumMode
      ? t("channel.browser.searchCreateForum")
      : t("channel.browser.searchCreate")
    : isForumMode
      ? t("channel.browser.searchForum")
      : t("channel.browser.search");
  const entityLabel = t(isForumMode ? "channel.browser.forum" : "channel.browser.channel");

  const createForm = useWorkspaceCreate(createActionKey, createKind);
  React.useEffect(() => { if (mode === "create") createForm.setName(createInitialName); }, [mode, createInitialName]);

  // Fuzzy match score per channel id for the current query, so both filtering
  // and relevance-ordering share one source of truth. Empty when no query.
  const matchScoreById = React.useMemo(() => {
    const scores = new Map<string, number>();
    if (deferredQuery.length === 0) return scores;
    for (const channel of channels) {
      const score = scoreChannelMatch(channel, deferredQuery);
      if (score !== null) scores.set(channel.id, score);
    }
    return scores;
  }, [channels, deferredQuery]);

  const matchingChannels = React.useMemo(() => {
    const filtered = channels.filter(
      (channel) =>

        (channel.archivedAt
          ? channel.isMember
          : channel.visibility === "open" || channel.isMember) &&
        (channelTypeFilter ? channel.channelType === channelTypeFilter : true),
    );

    if (deferredQuery.length === 0) {
      return filtered;
    }

    return filtered.filter((channel) => matchScoreById.has(channel.id));
  }, [channels, channelTypeFilter, deferredQuery, matchScoreById]);

  const currentChannels = React.useMemo(
    () => matchingChannels.filter((channel) => !channel.archivedAt),
    [matchingChannels],
  );

  const joinedChannels = React.useMemo(
    () => currentChannels.filter((channel) => channel.isMember),
    [currentChannels],
  );

  const archivedChannels = React.useMemo(
    () => matchingChannels.filter((channel) => channel.archivedAt),
    [matchingChannels],
  );

  const visibleChannels =
    activeTab === "archived"
      ? archivedChannels
      : activeTab === "joined"
        ? joinedChannels
        : matchingChannels;

  const isSearching = deferredQuery.length > 0;

  const orderedVisibleChannels = React.useMemo(() => {
    const sorted =
      sort === "members"
        ? [...visibleChannels].sort(
            (a, b) =>
              b.memberCount - a.memberCount ||
              a.name.localeCompare(b.name, undefined, {
                sensitivity: "base",
              }),
          )
        : sortChannelsForSidebar(visibleChannels, sort);

    if (!isSearching) return sorted;

    return sorted.sort(
      (a, b) =>
        (matchScoreById.get(a.id) ?? Number.POSITIVE_INFINITY) -
        (matchScoreById.get(b.id) ?? Number.POSITIVE_INFINITY),
    );
  }, [isSearching, matchScoreById, sort, visibleChannels]);

  const selectedSortLabel =
    CHANNEL_SORT_OPTIONS.find((option) => option.value === sort)?.label ??
    t("channel.browser.alpha");

  const allTabLabel = t(isForumMode ? "channel.browser.allForums" : "channel.browser.all");

  // Whether an exact name match already exists — if so we don't offer to
  // create a duplicate, mirroring how you'd never make two "#general"s.
  const hasExactMatch = React.useMemo(
    () =>
      channels.some(
        (channel) =>
          channelNamesMatch(channel.name, normalizedQuery) &&
          (channelTypeFilter
            ? channel.channelType === channelTypeFilter
            : true),
      ),
    [channels, channelTypeFilter, normalizedQuery],
  );

  // The pinned create row (Are.na style) appears for any non-empty query that
  // isn't already an exact channel name — covering both partial-match and
  // no-match cases, so a dedicated empty-state button would be redundant.
  // The create row is present from the moment the dialog opens (so it's clear
  // you can browse *or* create), then specializes to "Create «query»" as you
  // type. It only hides when the query is an exact match for an existing name
  // — creating a duplicate "#general" makes no sense.
  const showCreateRow = canCreate && !hasExactMatch;

  // The create row participates in keyboard navigation as a virtual item so
  // arrow keys reach it and Enter activates it — not just Tab. It's rendered
  // pinned at the top, so it takes nav index 0 and channels shift down by one,
  // keeping keyboard order identical to visual order.
  const channelNavOffset = showCreateRow ? 1 : 0;
  const createRowIndex = showCreateRow ? 0 : null;
  const navItemCount = orderedVisibleChannels.length + channelNavOffset;
  const isCreateRowSelected =
    createRowIndex !== null && selectedIndex === createRowIndex;

  const updateTabIndicator = React.useCallback(() => {
    const list = tabListRef.current;
    const trigger = tabTriggerRefs.current[activeTab];

    if (!open || mode !== "browse" || !list || !trigger) {
      return;
    }

    const nextIndicator = {
      left: trigger.offsetLeft,
      width: trigger.offsetWidth,
    };

    setTabIndicator((current) =>
      Math.abs(current.left - nextIndicator.left) < 0.5 &&
      Math.abs(current.width - nextIndicator.width) < 0.5
        ? current
        : nextIndicator,
    );
  }, [activeTab, mode, open]);

  React.useLayoutEffect(() => {
    updateTabIndicator();

    if (!open || mode !== "browse") {
      return;
    }

    let isCancelled = false;
    const updateIfActive = () => {
      if (!isCancelled) {
        updateTabIndicator();
      }
    };
    const frameId = window.requestAnimationFrame(updateIfActive);
    const observer = new ResizeObserver(updateTabIndicator);
    const list = tabListRef.current;

    void document.fonts.ready.then(updateIfActive);

    if (list) {
      observer.observe(list);
    }

    for (const trigger of Object.values(tabTriggerRefs.current)) {
      if (trigger) {
        observer.observe(trigger);
      }
    }

    return () => {
      isCancelled = true;
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [mode, open, updateTabIndicator]);

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveTab("all");
      setSort("alpha");
      setSelectedIndex(null);
      setJoiningChannelId(null);
      setMode("browse");
      setCreateInitialName("");
      return;
    }
  }, [open]);

  React.useEffect(() => {
    setSelectedIndex((current) => {
      if (current === null || navItemCount === 0) {
        return null;
      }

      return Math.min(current, navItemCount - 1);
    });
  }, [navItemCount]);

  async function handleJoin(channelId: string) {
    setJoiningChannelId(channelId);

    try {
      if (await onJoinChannel(channelId)) {
        onOpenChange(false);
        onSelectChannel(channelId);
      } else { setJoiningChannelId(null); }
    } catch {
      setJoiningChannelId(null);
    }
  }

  function handleSelect(channel: Channel) {
    if (busy) return;
    if (!channel.isMember) { void handleJoin(channel.id); return; }
    onOpenChange(false);
    onSelectChannel(channel.id);
  }

  function enterCreateMode(prefillName: string) {
    setCreateInitialName(prefillName);
    setMode("create");
  }

  function exitCreateMode() {
    setMode("browse");
    // Return focus to the search field so keyboard users stay oriented.
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }

  // Map the flat nav index back to a channel, accounting for the create row
  // occupying index 0 when present.
  const selectedItem =
    selectedIndex !== null && !isCreateRowSelected
      ? orderedVisibleChannels[selectedIndex - channelNavOffset]
      : undefined;
  const emptyTitle = t(deferredQuery.length > 0 ? "channel.browser.noMatch" : activeTab === "archived" ? "channel.browser.noArchived" : activeTab === "joined" ? "channel.browser.noJoined" : "channel.browser.noBrowse", { entity: entityLabel });
  const emptyDescription = t(deferredQuery.length > 0 ? (canCreate ? "channel.browser.createHint" : "channel.browser.searchHint") : activeTab === "archived" ? "channel.browser.archivedHint" : activeTab === "joined" ? "channel.browser.joinedHint" : "channel.browser.browseHint", { entity: entityLabel });

  return (
    <Dialog onOpenChange={(next) => { if (!busy && !createForm.busy && !createForm.command) onOpenChange(next); }} open={open}>
      <DialogContent
        aria-describedby={undefined}
        className="gap-0 overflow-hidden border-0 px-6 pb-0 pt-6"
        data-testid={
          isForumMode ? "forum-browser-dialog" : "channel-browser-dialog"
        }
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (mode === "browse") {
            inputRef.current?.focus({ preventScroll: true });
          }
        }}
        showCloseButton={false}
      >
        {mode === "create" ? (
          <ChannelCreateView
            entityLabel={entityLabel}
            form={createForm}
            onBack={exitCreateMode}
            onClose={() => { if (!createForm.busy && !createForm.command) onOpenChange(false); }}
          />
        ) : (
          <>
            <DialogHeader className="space-y-0 pb-5">
              {status}
            <div className="flex items-center justify-between gap-4">
                <DialogTitle>{browseTitle}</DialogTitle>
                <DialogClose className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 ease-out hover:bg-accent hover:text-accent-foreground focus:outline-hidden focus:ring-1 focus:ring-ring">
                  <X className="h-4 w-4" />
                  <span className="sr-only">{t("channel.browser.close")}</span>
                </DialogClose>
              </div>
              <div className={MODAL_SEARCH_SHELL_CLASS}>
                <label
                  className="flex min-w-0 flex-1 cursor-text items-center gap-3"
                  htmlFor="channel-browser-search"
                >
                  <Search className="h-4 w-4 shrink-0 text-muted-foreground/55 transition-colors duration-150 ease-out group-hover/search:text-muted-foreground group-focus-within/search:text-foreground" />
                  <input
                    autoCapitalize="none"
                    autoCorrect="off"
                    className={MODAL_SEARCH_INPUT_CLASS}
                    data-testid="channel-browser-search"
                    id="channel-browser-search"
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setSelectedIndex(null);
                    }}
                    onKeyDown={(event) => {
                      // Arrow keys traverse the pinned create row (index 0)
                      // and the channel list beneath it, in visual order.
                      if (event.key === "ArrowDown" && navItemCount > 0) {
                        event.preventDefault();
                        setSelectedIndex((current) =>
                          current === null
                            ? 0
                            : Math.min(current + 1, navItemCount - 1),
                        );
                        return;
                      }

                      if (event.key === "ArrowUp" && navItemCount > 0) {
                        event.preventDefault();
                        setSelectedIndex((current) =>
                          current === null
                            ? navItemCount - 1
                            : Math.max(current - 1, 0),
                        );
                        return;
                      }

                      if (
                        event.key === "Enter" &&
                        !event.nativeEvent.isComposing
                      ) {
                        // If the create row is highlighted — or it's the only
                        // actionable item (no channel matches) — Enter creates.
                        if (
                          showCreateRow &&
                          (isCreateRowSelected ||
                            orderedVisibleChannels.length === 0)
                        ) {
                          event.preventDefault();
                          enterCreateMode(trimmedQuery);
                          return;
                        }

                        if (orderedVisibleChannels.length > 0) {
                          event.preventDefault();
                          handleSelect(
                            selectedItem ?? orderedVisibleChannels[0]!,
                          );
                        }
                      }
                    }}
                    placeholder={searchPlaceholder}
                    ref={inputRef}
                    spellCheck={false}
                    type="text"
                    value={query}
                  />
                </label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      aria-label={t("channel.browser.sort", { entity: entityLabel, sort: selectedSortLabel })}
                      data-testid="channel-browser-sort"
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    >
                      <ListSortDescending />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>{t("channel.browser.sortBy")}</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      onValueChange={(value) => {
                        setSort(value as ChannelSort);
                        setSelectedIndex(null);
                      }}
                      value={sort}
                    >
                      {CHANNEL_SORT_OPTIONS.map((option) => (
                        <DropdownMenuRadioItem
                          data-testid={`channel-browser-sort-${option.value}`}
                          key={option.value}
                          value={option.value}
                        >
                          {option.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </DialogHeader>

            <div className="h-[min(60vh,30rem)] overflow-hidden">
              <div className="flex h-full flex-col">
                <Tabs
                  className="shrink-0"
                  onValueChange={(value) => {
                    setActiveTab(value as BrowserTab);
                    setSelectedIndex(null);
                  }}
                  value={activeTab}
                >
                  <TabsList
                    className="relative h-auto w-full justify-start gap-6 rounded-none border-b border-border/70 bg-transparent p-0 text-muted-foreground"
                    ref={tabListRef}
                  >
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute bottom-[-1px] left-0 h-0.5 w-px origin-left rounded-full bg-foreground opacity-0 transition-[transform,opacity] duration-[180ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none data-[ready=true]:opacity-100"
                      data-ready={tabIndicator.width > 0}
                      data-testid="channel-browser-tab-indicator"
                      style={{
                        transform: `translate3d(${tabIndicator.left}px, 0, 0) scaleX(${tabIndicator.width})`,
                      }}
                    />
                    <TabsTrigger
                      className="rounded-none border-b-2 border-transparent bg-transparent px-0 py-2 text-sm font-medium shadow-none transition-colors duration-150 ease-out data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
                      ref={(element) => {
                        tabTriggerRefs.current.all = element;
                      }}
                      value="all"
                    >
                      {allTabLabel}
                    </TabsTrigger>
                    <TabsTrigger
                      className="rounded-none border-b-2 border-transparent bg-transparent px-0 py-2 text-sm font-medium shadow-none transition-colors duration-150 ease-out data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
                      ref={(element) => {
                        tabTriggerRefs.current.joined = element;
                      }}
                      value="joined"
                    >
                      {t("channel.browser.joined")}
                    </TabsTrigger>
                    <TabsTrigger
                      className="rounded-none border-b-2 border-transparent bg-transparent px-0 py-2 text-sm font-medium shadow-none transition-colors duration-150 ease-out data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
                      ref={(element) => {
                        tabTriggerRefs.current.archived = element;
                      }}
                      value="archived"
                    >
                      {t("channel.browser.archived")}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                <div className="min-h-0 flex-1 overflow-y-auto pb-6 pt-4">
                  {showCreateRow ? (
                    <div className="mb-3">
                      <CreateChannelRow
                        entityLabel={entityLabel}
                        isSelected={isCreateRowSelected}
                        onClick={() => enterCreateMode(trimmedQuery)}
                        query={trimmedQuery}
                      />
                    </div>
                  ) : null}

                  {orderedVisibleChannels.length === 0 ? (
                    <BrowseState
                      description={emptyDescription}
                      icon={deferredQuery.length > 0 ? Search : Compass}
                      title={emptyTitle}
                    />
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-border/70 bg-background/70 shadow-xs divide-y divide-border/55">
                      {orderedVisibleChannels.map((channel, index) => (
                        <ChannelCard
                          channel={channel}
                          isJoining={joiningChannelId === channel.id || busy}
                          isSelected={
                            index + channelNavOffset === selectedIndex
                          }
                          key={channel.id}
                          onJoin={
                            !channel.isMember && channel.joinActionKey
                              ? () => {
                                  void handleJoin(channel.id);
                                }
                              : undefined
                          }
                          onSelect={() => handleSelect(channel)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateChannelRow({
  entityLabel,
  isSelected,
  onClick,
  query,
}: {
  entityLabel: string;
  isSelected: boolean;
  onClick: () => void;
  query: string;
}) {
  const t = useT();
  const hasQuery = query.length > 0;
  return (
    <button
      className={
        isSelected
          ? "flex w-full items-center gap-3 rounded-xl border border-border/70 bg-muted/60 px-4 py-3 text-left transition-colors duration-150 ease-out focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          : "flex w-full items-center gap-3 rounded-xl border border-border/70 bg-muted/30 px-4 py-3 text-left transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
      }
      data-testid="channel-browser-create-row"
      data-selected={isSelected}
      onClick={onClick}
      type="button"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Plus className="h-4 w-4" />
      </span>
      {hasQuery ? (
        <span className="min-w-0 text-sm">
          <span className="font-medium text-foreground">
            {t("channel.browser.create", { entity: entityLabel })}{" "}
          </span>
          <span className="font-semibold text-foreground">“{query}”</span>
        </span>
      ) : (
        <span className="min-w-0 text-sm font-medium text-foreground">
          {t("channel.browser.new", { entity: entityLabel })}
        </span>
      )}
    </button>
  );
}

function ChannelCreateView({
  entityLabel,
  form,
  onBack,
  onClose,
}: {
  entityLabel: string;
  form: ReturnType<typeof useWorkspaceCreate>;
  onBack: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <div className="flex h-[min(72vh,38rem)] flex-col">
      <DialogHeader className="space-y-0 pb-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              aria-label={t("channel.browser.back")}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 ease-out hover:bg-accent hover:text-accent-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
              data-testid="channel-browser-create-back"
              onClick={onBack}
              type="button"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <DialogTitle className="truncate">
              {t("channel.browser.newTitle", { entity: entityLabel })}
            </DialogTitle>
          </div>
          <button
            aria-label={t("channel.browser.close")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 ease-out hover:bg-accent hover:text-accent-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">{t("channel.browser.close")}</span>
          </button>
        </div>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        <WorkspaceCreateForm state={form} channel />
      </div>


    </div>
  );
}

function ChannelCard({
  channel,
  isJoining,
  isSelected,
  onJoin,
  onSelect,
}: {
  channel: Channel;
  isJoining: boolean;
  isSelected: boolean;
  onJoin?: () => void;
  onSelect: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const memberLabel = t(channel.memberCount === 1 ? "channel.browser.members.one" : "channel.browser.members.other", { count: channel.memberCount });

  return (
    <div
      className={
        isSelected
          ? "group/channel-row flex min-h-16 items-center gap-4 bg-muted/40 px-4 py-3 transition-colors duration-150 ease-out"
          : "group/channel-row flex min-h-16 items-center gap-4 px-4 py-3 transition-colors duration-150 ease-out hover:bg-muted/40"
      }
      data-testid={`browse-channel-${channel.name}`}
    >
      <button
        className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left text-foreground outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        type="button"
      >
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-sm font-normal text-muted-foreground">
              #
            </span>
            <p className="min-w-0 truncate text-base font-medium tracking-tight">
              {channel.name}
            </p>
            {channel.archivedAt ? (
              <Badge className="ml-1 shrink-0" variant="warning">
                {t("channel.browser.archived")}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            <span>{memberLabel}</span>
            {channel.description ? (
              <>
                <span className="px-1.5">·</span>
                <span title={channel.description}>{channel.description}</span>
              </>
            ) : null}
          </p>
          {!channel.isMember && channel.membershipState ? <p role="status" className="mt-1 text-sm text-muted-foreground">
            {enumLabel(locale, workspaceMembershipStateMessages, channel.membershipState)}
          </p> : null}
        </div>
      </button>

      {!channel.isMember && onJoin ? (
        <Button
          className={
            isJoining
              ? "shrink-0"
              : "shrink-0 opacity-0 transition-opacity duration-150 ease-out group-hover/channel-row:opacity-100 group-focus-within/channel-row:opacity-100"
          }
          disabled={isJoining}
          onClick={(event) => {
            event.stopPropagation();
            onJoin();
          }}
          size="sm"
          type="button"
          variant="default"
        >
          {t(isJoining ? "channel.browser.joining" : "channel.browser.join")}
        </Button>
      ) : null}
    </div>
  );
}
