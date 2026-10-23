// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/DiscussionChannels.tsx::DiscussedInChannels.
// Inside project detail a hit opens the original ProjectConversationPanel beside the detail when
// the host renders governed channel threads; elsewhere existing host navigation is the original
// fallback. DiscussionChannelsPanel is the original repository Channels tab over the same read,
// with the original channel-row selection (shift range over the listed channels).
import * as React from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { resolveUserLabel, type UserProfileLookup } from "../messages/system/identity";
import { usePulseHost, useUsersBatchQuery, UserProfilePopover } from "../pulse/host";
import { discussionSnippet, groupDiscussionChannels, mergeOriginDiscussionChannel } from "./discussionChannels";
import { relativeTime } from "./lib/projectsViewHelpers";
import type { SearchHit, SearchChannel, SearchMessagesResponse } from "../search/types";
import { cn } from "../profile/buzz/shared/lib/cn";
import { ProjectEntityFacepile } from "./ProjectEntityFacepile";
import { useUiT } from "../context";
import { Hash } from "lucide-react";
import { BuzzLoadingState } from "./BuzzLoadingState";
import { ProjectEntityListRow } from "./ProjectEntityListRow";
import { selectionItemFromChannel } from "./lib/projectSelection";
import { ProjectPanelState } from "./ProjectPanelState";
import { openDiscussionHit, useProjectConversationPanel } from "./ProjectConversationPanelContext";

export type ProjectConversationRenderProps = {
  hit: SearchHit;
  onClose: () => void;
  widthPx: number;
  canResetWidth: boolean;
  onResetWidth: () => void;
  onResizeStart: (event: React.PointerEvent<HTMLButtonElement>) => void;
};

export type ProjectDiscussionHost = {
  read: (
    query: string,
    originChannelId: string | null,
    signal: AbortSignal,
  ) => Promise<SearchMessagesResponse & { channels: readonly SearchChannel[] }>;
  openHit: (hit: SearchHit) => void | Promise<unknown>;
  /** Original ProjectConversationPanel body: the host's governed channel thread for this hit. */
  renderConversation?: (props: ProjectConversationRenderProps) => React.ReactNode;
  openChannel: (channelId: string) => void | Promise<unknown>;
  renderPreview: (content: string) => React.ReactNode;
};
const COLLAPSED_MENTION_ROWS = 3;

/**
 * "Related Conversations" card for PR, issue, and commit detail views: a
 * bordered block under the body. Each channel gets a name line plus a
 * compact markdown preview of the latest message (same `inbox-preview-markdown`
 * treatment as inbox rows). Tasks and reviews also include the origin
 * channel (`h` tag) as a channel-only row — the tag proves only which
 * channel the entity came from, so no message is quoted or attributed for
 * it. Renders nothing when search and origin are both empty.
 */
export function DiscussedInChannels({
  className,
  entityLabel,
  originChannelId,
  originCreatedAt,
  originPubkey,
  query,
  testId,
}: {
  /** Extra spacing/alignment classes from the call site. */
  className?: string;
  /** How the sentence names the entity, e.g. "this issue". */
  entityLabel: string;
  originChannelId?: string | null;
  originCreatedAt?: number;
  originPubkey?: string;
  query: string;
  testId?: string;
}) {
  const host = usePulseHost();
  const cache = useQueryClient();
  const lifetime = React.useMemo(() => ({ active: true }), [host.scopeKey]);
  React.useEffect(() => {
    lifetime.active = true;
    return () => { lifetime.active = false; };
  }, [lifetime]);
  const key = React.useMemo(
    () => ["project-discussions", host.scopeKey, query, originChannelId],
    [host.scopeKey, query, originChannelId],
  );
  const search = useQuery({
    queryKey: key,
    enabled: Boolean(host.discussions),
    retry: false,
    refetchOnWindowFocus: "always",
    queryFn: ({ signal }) => {
      if (!host.discussions) throw new Error("Discussion host unavailable");
      return host.discussions.read(query, originChannelId ?? null, signal);
    },
  });
  React.useEffect(() => () => {
    void cache.cancelQueries({ queryKey: key });
    cache.removeQueries({ queryKey: key });
  }, [cache, key]);
  const ready = search.isSuccess && !search.isFetching;
  const snapshot = ready ? search.data : undefined;
  const hits = React.useMemo(
    () => [...(snapshot?.hits ?? [])].sort((a, b) => b.createdAt - a.createdAt),
    [snapshot],
  );
  const discussed = React.useMemo(() => groupDiscussionChannels(hits), [hits]);
  const isTruncated = hits.length >= 500;
  const origin = React.useMemo(
    () =>
      snapshot?.channels.some(channel => channel.id === originChannelId && (channel.isMember || channel.visibility === "open")) && originChannelId && originPubkey && originCreatedAt != null
        ? {
            channelId: originChannelId,
            createdAt: originCreatedAt,
            pubkey: originPubkey,
          }
        : null,
    [snapshot, originChannelId, originCreatedAt, originPubkey],
  );
  const channels = React.useMemo(
    () => mergeOriginDiscussionChannel(discussed, origin),
    [discussed, origin],
  );
  const t = useUiT();
  const conversationPanel = useProjectConversationPanel();
  const open = (channelId: string, hit?: SearchHit) => {
    void (async () => {
      // Reauthorize the existing reference at click time; a displayed origin
      // or cached search result is not permission to read channel messages.
      const fresh = await search.refetch();
      if (!lifetime.active) return;
      if (fresh.isError || !fresh.data) throw new Error("Discussion unavailable");
      if (hit) {
        const current = fresh.data.hits.find(item => item.eventId === hit.eventId && item.channelId === channelId);
        if (!current) throw new Error("Discussion unavailable");
        await openDiscussionHit({ channelId, latestHit: current, panel: host.discussions!.renderConversation ? conversationPanel : null,
          openChannel: host.discussions!.openChannel, openHit: host.discussions!.openHit });
      } else {
        const channel = fresh.data.channels.find(item => item.id === channelId);
        if (!channel || !(channel.isMember || channel.visibility === "open")) throw new Error("Discussion unavailable");
        await host.discussions!.openChannel(channelId);
      }
    })().catch(() => {
      if (lifetime.active) toast.error(t("platform.linkChannelUnavailable"));
    });
  };
  const [expanded, setExpanded] = React.useState(false);
  const channelName = (id: string, name: string | null) => name ?? snapshot?.channels.find(channel => channel.id === id)?.name ?? id.slice(0, 8);
  const visible = expanded
    ? channels
    : channels.slice(0, COLLAPSED_MENTION_ROWS);
  const profilesQuery = useUsersBatchQuery(
    visible.flatMap((channel) => channel.participants),
    { enabled: ready && visible.length > 0 },
  );
  const profiles = profilesQuery.isSuccess && !profilesQuery.isFetching ? profilesQuery.data?.profiles : undefined;
  // The origin channel has no quotable hit: the `h` tag proves only the
  // channel, so its row navigates to the channel without claiming any
  // particular message.
  const latestHitByChannel = new Map<string, SearchHit>();
  for (const hit of hits) {
    if (hit.channelId && !latestHitByChannel.has(hit.channelId)) {
      latestHitByChannel.set(hit.channelId, hit);
    }
  }
  if (!ready || channels.length === 0) return null;

  const hiddenCount = channels.length - visible.length;

  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-lg border border-border/60 bg-muted/20",
        className,
      )}
      data-testid={testId}
    >
      <h4 className="border-b border-border/40 px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("projects.discussion.title")}
      </h4>
      <div className="divide-y divide-border/40">
        {visible.map((channel) => {
          const latestHit = latestHitByChannel.get(channel.id);
          const name = channelName(channel.id, channel.name);
          const openConversation = () => open(channel.id,latestHit);
          return (
            <div
              className="group relative flex w-full min-w-0 items-start gap-2.5 px-3 py-2 transition-colors hover:bg-muted/30"
              data-testid="discussion-mention-row"
              key={channel.id}
            >
              <button
                aria-label={
                  latestHit
                    ? t("projects.discussion.openConversation",{name})
                    : t("projects.discussion.openChannel",{name})
                }
                className="absolute inset-0"
                onClick={openConversation}
                title={
                  latestHit
                    ? t("projects.discussion.openLatest",{name})
                    : t("projects.discussion.openNamed",{name})
                }
                type="button"
              />
              <span className="relative z-10 pt-0.5">
                <ProjectEntityFacepile
                  interactive
                  participants={channel.participants}
                  profiles={profiles}
                />
              </span>
              <span className="pointer-events-none relative z-10 min-w-0 flex-1 text-sm">
                <span className="block truncate">
                  <DiscussionNameList
                    participants={channel.participants}
                    profiles={profiles}
                  />
                  <span className="text-muted-foreground">
                    {" "}
                    {latestHit
                      ? t("projects.discussion.discussed",{entity:entityLabel})
                      : t("projects.discussion.created",{entity:entityLabel})}{" "}
                  </span>
                  <button
                    className="pointer-events-auto font-medium text-foreground hover:underline"
                    onClick={() => open(channel.id)}
                    title={t("projects.discussion.openNamed",{name})}
                    type="button"
                  >
                    #{name}
                  </button>
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    · {relativeTime(channel.lastActivityAt)}
                  </span>
                </span>
                {latestHit ? (
                  <span className="block text-xs text-muted-foreground">
                    <DiscussionMessagePreview content={latestHit.content} />
                  </span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
      {hiddenCount > 0 ? (
        <button
          className="w-full border-t border-border/40 px-3 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setExpanded(true)}
          type="button"
        >
          {t(hiddenCount === 1 ? "projects.discussion.moreOne" : "projects.discussion.moreMany",{count:hiddenCount})}
        </button>
      ) : null}
      {isTruncated ? (
        <p className="border-t border-border/40 px-3 py-1.5 text-xs text-muted-foreground">
          {t("projects.discussion.truncated")}
        </p>
      ) : null}
    </div>
  );
}

const NAME_LIST_MAX = 3;

/** Compact markdown preview matching inbox list rows: first block only,
 * clamped, non-interactive so the overlay click still opens the thread. */
function DiscussionMessagePreview({ content }: { content: string }) {
  return (
    <>{usePulseHost().discussions!.renderPreview(discussionSnippet(content))}</>
  );
}

/**
 * The "Alice, Bob and Carol" (or "Alice, Bob and 2 others") part of the
 * sentence, with each name opening that person's profile popover. Mirrors
 * the wording of `formatNameList` in `discussionChannels.ts`.
 */
function DiscussionNameList({
  participants,
  profiles,
}: {
  participants: string[];
  profiles: UserProfileLookup | undefined;
}) {
  const t = useUiT();
  const showAll = participants.length <= NAME_LIST_MAX;
  const shown = showAll
    ? participants
    : participants.slice(0, NAME_LIST_MAX - 1);
  const others = participants.length - shown.length;
  return (
    <>
      {shown.map((pubkey, index) => {
        const isLast = index === shown.length - 1;
        const separator =
          index === 0 ? null : isLast && others === 0 ? t("projects.discussion.and") : t("projects.discussion.separator");
        return (
          <React.Fragment key={pubkey}>
            {separator ? (
              <span className="text-muted-foreground">{separator}</span>
            ) : null}
            <UserProfilePopover pubkey={pubkey} triggerElement="span">
              <button
                className="pointer-events-auto font-medium text-foreground hover:underline"
                type="button"
              >
                {resolveUserLabel({ profiles, pubkey })}
              </button>
            </UserProfilePopover>
          </React.Fragment>
        );
      })}
      {others > 0 ? (
        <span className="font-medium text-foreground">
          {" "}
          {t("projects.discussion.others",{count:others})}
        </span>
      ) : null}
    </>
  );
}

/** The original "Showing the latest … mentions" cap of the discussion search. */
const DISCUSSION_SEARCH_LIMIT = 500;

/** Buzz 779af8886caae1317b4de962082429867ab61503 DiscussionChannels.tsx::DiscussionChannelsPanel. */
export function DiscussionChannelsPanel({
  query,
  repositoryName,
}: {
  query: string;
  repositoryName: string;
}) {
  const host = usePulseHost();
  const cache = useQueryClient();
  const t = useUiT();
  const lifetime = React.useMemo(() => ({ active: true }), [host.scopeKey]);
  React.useEffect(() => {
    lifetime.active = true;
    return () => { lifetime.active = false; };
  }, [lifetime]);
  const key = React.useMemo(() => ["project-discussions", host.scopeKey, query, null], [host.scopeKey, query]);
  const search = useQuery({
    queryKey: key,
    enabled: Boolean(host.discussions),
    retry: false,
    refetchOnWindowFocus: "always",
    queryFn: ({ signal }) => {
      if (!host.discussions) throw new Error("Discussion host unavailable");
      return host.discussions.read(query, null, signal);
    },
  });
  React.useEffect(() => () => {
    void cache.cancelQueries({ queryKey: key });
    cache.removeQueries({ queryKey: key });
  }, [cache, key]);
  const ready = search.isSuccess && !search.isFetching;
  const snapshot = ready ? search.data : undefined;
  const hits = React.useMemo(
    () => [...(snapshot?.hits ?? [])].sort((a, b) => b.createdAt - a.createdAt),
    [snapshot],
  );
  const channels = React.useMemo(() => groupDiscussionChannels(hits), [hits]);
  const isTruncated = hits.length >= DISCUSSION_SEARCH_LIMIT;
  const profilesQuery = useUsersBatchQuery(
    channels.flatMap((channel) => channel.participants),
    { enabled: channels.length > 0 },
  );
  const profiles = profilesQuery.data?.profiles;
  const latestHitByChannel = new Map<string, SearchHit>();
  for (const hit of hits) {
    if (hit.channelId && !latestHitByChannel.has(hit.channelId)) latestHitByChannel.set(hit.channelId, hit);
  }
  const channelName = (id: string, name: string | null) => name ?? snapshot?.channels.find(channel => channel.id === id)?.name ?? id.slice(0, 8);
  const conversationPanel = useProjectConversationPanel();
  const open = (channelId: string, hit?: SearchHit) => {
    void (async () => {
      // Reauthorize at click time; a listed row is not permission to read the channel.
      const fresh = await search.refetch();
      if (!lifetime.active) return;
      if (fresh.isError || !fresh.data) throw new Error("Discussion unavailable");
      if (hit) {
        const current = fresh.data.hits.find(item => item.eventId === hit.eventId && item.channelId === channelId);
        if (!current) throw new Error("Discussion unavailable");
        await openDiscussionHit({ channelId, latestHit: current, panel: host.discussions!.renderConversation ? conversationPanel : null,
          openChannel: host.discussions!.openChannel, openHit: host.discussions!.openHit });
      } else {
        const channel = fresh.data.channels.find(item => item.id === channelId);
        if (!channel || !(channel.isMember || channel.visibility === "open")) throw new Error("Discussion unavailable");
        await host.discussions!.openChannel(channelId);
      }
    })().catch(() => {
      if (lifetime.active) toast.error(t("platform.linkChannelUnavailable"));
    });
  };

  if (!host.discussions || search.isError) {
    return <ProjectPanelState className="px-4" error testId="project-discussion-channels-panel" title={t("platform.loadFailed")} />;
  }
  if (!ready) {
    return <BuzzLoadingState label={t("projects.discussion.loadingChannels")} />;
  }
  if (channels.length === 0) {
    return (
      <ProjectPanelState
        className="px-4"
        description={t("projects.discussion.noChannelsHint")}
        testId="project-discussion-channels-panel"
        title={t("projects.discussion.noChannels")}
      />
    );
  }

  // Original DiscussionChannelsPanel selection: each channel row is a selectable item whose range
  // runs over the listed channels (shift-select) in the repository Channels tab.
  const rangeItems = channels.map((channel) => selectionItemFromChannel({
    channelId: channel.id, people: channel.participants, title: `#${channelName(channel.id, channel.name)}` }));

  return (
    <div className="px-4" data-testid="project-discussion-channels-panel">
      <ul data-testid="discussion-channels">
        {channels.map((channel) => {
          const name = channelName(channel.id, channel.name);
          const latestHit = latestHitByChannel.get(channel.id);
          const count = `${channel.messageCount}${isTruncated ? "+" : ""}`;
          return (
            <li className="relative" key={channel.id}>
              <ProjectEntityListRow
                affiliation={repositoryName}
                affiliationTestId="project-channel-repository"
                count={channel.messageCount}
                countSuffix={isTruncated ? "+" : undefined}
                countTestId="project-channel-message-count"
                countTitle={t(channel.messageCount === 1 ? "projects.discussion.messageOne" : "projects.discussion.messageMany", { count })}
                dateSeconds={channel.lastActivityAt}
                dateTestId="project-channel-row-date"
                icon={<Hash className="h-3.5 w-3.5 text-muted-foreground/70" />}
                onClick={() => open(channel.id, latestHit)}
                peopleSlot={<ProjectEntityFacepile participants={channel.participants} profiles={profiles} />}
                peopleTestId="project-channel-participants"
                selection={{ item: selectionItemFromChannel({ channelId: channel.id, people: channel.participants, title: `#${name}` }), rangeItems }}
                testId="project-channel-row"
                title={`#${name}`}
                titleAttr={latestHit ? t("projects.discussion.openLatest", { name }) : t("projects.discussion.openNamed", { name })}
              />
            </li>
          );
        })}
      </ul>
      {isTruncated ? (
        <p className="border-t border-border/50 px-4 py-2 text-xs text-muted-foreground">
          {t("projects.discussion.showingLatest", { count: DISCUSSION_SEARCH_LIMIT })}
        </p>
      ) : null}
    </div>
  );
}
