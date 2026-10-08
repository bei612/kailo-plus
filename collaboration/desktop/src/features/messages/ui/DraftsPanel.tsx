import { DraftListSurface, DraftSendConfirm, type DraftSurfaceItem } from "@client-kit/platform/react/draft-surfaces";
import { resolveLocale, translate } from "@client-kit/platform/i18n";
import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useChannelsQuery } from "@/features/channels/hooks";
import {
  getActiveDraftEntries,
  renameDraftEntry,
  useDraftsSnapshot,
  type DraftState,
} from "@/features/messages/lib/useDrafts";
import {
  useDraftRootStatus,
  type RootStatus,
} from "@/features/messages/lib/useDraftRootStatus";
import {
  migrateInboxReplyDraft,
  INBOX_REPLY_PREFIX,
} from "@/features/messages/lib/inboxReplyMigration";
import {
  getChannelIdFromTags,
  getThreadReference,
} from "@/features/messages/lib/threading";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { resolveChannelDisplayLabel } from "@/features/sidebar/lib/channelLabels";
import { useIdentityQuery } from "@/shared/api/hooks";
import { getEventById } from "@/shared/api/tauri";
import type { Channel } from "@/shared/api/types";
import { formatItemTimestamp } from "@/shared/lib/datetime";
import { Markdown } from "@/shared/ui/markdown";

const SENT_DRAFT_PREFIX = "sent:";
const THREAD_DRAFT_PREFIX = "thread:";
const UNKNOWN_CHANNEL_LABEL = "Unknown channel";

export type DraftListEntry = {
  draft: DraftState;
  key: string;
};

export type DraftSource = {
  channel: Channel | null;
  label: string;
};

export type DraftViewItem = {
  entry: DraftListEntry;
  rootStatus: RootStatus;
  source: DraftSource;
};

const UNKNOWN_DRAFT_SOURCE: DraftSource = {
  channel: null,
  label: UNKNOWN_CHANNEL_LABEL,
};

function parseDraftTime(value: string): number {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function formatDraftCreatedAt(draft: DraftState): string {
  const time = parseDraftTime(draft.createdAt);
  return time === 0
    ? translate(resolveLocale(), "platform.time.unavailable")
    : formatItemTimestamp(time / 1_000, { withTime: true });
}

function getOriginalDraftKey(draftKey: string): string {
  if (!draftKey.startsWith(SENT_DRAFT_PREFIX)) {
    return draftKey;
  }

  const sentPayload = draftKey.slice(SENT_DRAFT_PREFIX.length);
  const timestampSeparatorIndex = sentPayload.lastIndexOf(":");
  return timestampSeparatorIndex > 0
    ? sentPayload.slice(0, timestampSeparatorIndex)
    : sentPayload;
}

export function getThreadRootId(draftKey: string): string | null {
  const originalDraftKey = getOriginalDraftKey(draftKey);
  if (!originalDraftKey.startsWith(THREAD_DRAFT_PREFIX)) {
    return null;
  }

  const id = originalDraftKey.slice(THREAD_DRAFT_PREFIX.length).trim();
  return id.length > 0 ? id : null;
}

function isVisibleDraft(entry: DraftListEntry): boolean {
  const content = entry.draft.content.trim();
  const attachmentCount = entry.draft.pendingImeta.length;
  return content.length > 0 || attachmentCount > 0;
}

export function getDraftPreview(draft: DraftState): string {
  const content = draft.content.trim();
  if (content.length > 0) {
    return content;
  }

  const attachmentCount = draft.pendingImeta.length;
  if (attachmentCount === 1) {
    return "1 attachment";
  }
  if (attachmentCount > 1) {
    return `${attachmentCount} attachments`;
  }
  return "Empty draft";
}

function resolveDraftSources({
  channels,
  currentPubkey,
  drafts,
  profiles,
}: {
  channels: Channel[] | undefined;
  currentPubkey: string | undefined;
  drafts: DraftListEntry[];
  profiles: UserProfileLookup | undefined;
}): Map<string, DraftSource> {
  const channelsById = new Map(
    (channels ?? []).map((channel) => [channel.id, channel]),
  );
  const sources = new Map<string, DraftSource>();

  for (const entry of drafts) {
    const channel = channelsById.get(entry.draft.channelId);
    sources.set(entry.key, {
      channel: channel ?? null,
      label: channel
        ? resolveChannelDisplayLabel(channel, currentPubkey, profiles)
        : UNKNOWN_CHANNEL_LABEL,
    });
  }

  return sources;
}

export function canOpenDraft(draft: DraftState, source: DraftSource): boolean {
  return (
    draft.status !== "sent" &&
    source.channel !== null &&
    draft.channelId.length > 0
  );
}

/** True when a draft is sendable: same conditions as openable, plus root not deleted. */
export function canSendDraft(
  draft: DraftState,
  source: DraftSource,
  rootStatus: RootStatus,
): boolean {
  if (!canOpenDraft(draft, source)) return false;
  if (rootStatus === "deleted") return false;
  // Mirror the destination composer's stable disabled states so we never
  // offer a Send that will silently no-op:
  //   - not a member: the composer rejects sends
  //   - archived: read-only
  //   - forum: forum posting is not wired
  // `isSending` is transient runtime state not visible from the panel — omit.
  const ch = source.channel;
  if (ch === null) return false;
  if (!ch.isMember) return false;
  if (ch.archivedAt !== null) return false;
  if (ch.channelType === "forum") return false;
  return true;
}

type GoChannel = ReturnType<typeof useAppNavigation>["goChannel"];

export async function openDraftEntry(
  entry: DraftListEntry,
  goChannel: GoChannel,
): Promise<void> {
  if (!entry.draft.channelId) return;

  if (entry.key.startsWith(INBOX_REPLY_PREFIX)) {
    const migrated = await migrateInboxReplyDraft(entry.key, entry.draft, {
      getEventById,
      getChannelIdFromTags,
      getThreadReference,
      renameDraftEntry,
    });
    if (!migrated) return;
    await goChannel(migrated.channelId, {
      messageId: migrated.conversationId,
      threadRootId: migrated.conversationId,
    });
    return;
  }

  const threadRootId = getThreadRootId(entry.key);
  await goChannel(
    entry.draft.channelId,
    threadRootId ? { messageId: threadRootId, threadRootId } : undefined,
  );
}

export async function sendDraftEntry(
  entry: DraftListEntry,
  goChannel: GoChannel,
): Promise<void> {
  if (!entry.draft.channelId) return;

  if (entry.key.startsWith(INBOX_REPLY_PREFIX)) {
    const migrated = await migrateInboxReplyDraft(entry.key, entry.draft, {
      getEventById,
      getChannelIdFromTags,
      getThreadReference,
      renameDraftEntry,
    });
    if (!migrated) return;
    await goChannel(migrated.channelId, {
      autoSend: migrated.newDraftKey,
      messageId: migrated.conversationId,
      threadRootId: migrated.conversationId,
    });
    return;
  }

  const threadRootId = getThreadRootId(entry.key);
  await goChannel(entry.draft.channelId, {
    ...(threadRootId ? { messageId: threadRootId, threadRootId } : {}),
    autoSend: entry.key,
  });
}

export function toDraftSurfaceItem({ entry, rootStatus, source }: DraftViewItem): DraftSurfaceItem {
  return { entry, channelLabel: source.channel ? source.channel.channelType === "dm" ? source.label : `#${source.label}` : UNKNOWN_CHANNEL_LABEL,
    createdAt: formatDraftCreatedAt(entry.draft), isPrivate: source.channel?.visibility === "private",
    isOrphaned: rootStatus === "deleted", canOpen: canOpenDraft(entry.draft, source) && rootStatus !== "deleted",
    canSend: canSendDraft(entry.draft, source, rootStatus) };
}

export function SendConfirmDialog({ channelLabel, isDm, onCancel, onConfirm, open }: {
  channelLabel: string; isDm: boolean; onCancel: () => void; onConfirm: () => void; open: boolean;
}) {
  return open ? <DraftSendConfirm destination={isDm ? channelLabel : `#${channelLabel}`} onCancel={onCancel} onConfirm={onConfirm} /> : null;
}

// ── Shared derivation: active draft count ────────────────────────────────────
// The badge (InboxListPane/HomeView) and the panel both call
// `deriveActiveDraftCount` with the same arguments so the derivation logic
// cannot diverge. Note: the badge call-site feeds an empty rootStatusMap
// (panel closed → queries disabled), so orphaned thread drafts count
// optimistically until the panel opens and the relay confirms deletion.
// This bounded eventual-consistency is the sanctioned design (Will, 2026-07-07).

/**
 * Derives the active (non-orphaned) draft count from the draft store snapshot
 * and root-status map. A draft is excluded from the count when its thread root
 * is definitively deleted (`"deleted"` status).
 *
 * @param activeDrafts  Active draft entries from `getActiveDraftEntries()`.
 * @param rootStatusMap Root-status map from `useDraftRootStatus()`.
 * @returns             Count of active drafts whose root is NOT deleted.
 */
export function deriveActiveDraftCount(
  activeDrafts: Array<{ key: string; draft: DraftState }>,
  rootStatusMap: Map<string, RootStatus>,
): number {
  return activeDrafts.filter((entry) => {
    const threadRootId = getThreadRootId(entry.key);
    if (threadRootId === null) {
      // Channel-root draft — cannot be orphaned.
      return true;
    }
    const status = rootStatusMap.get(threadRootId) ?? "checking";
    // Exclude only on definitive `deleted`; `checking`/`error` are optimistic.
    return status !== "deleted";
  }).length;
}

/**
 * Reactive hook for the active (non-orphaned) draft count.
 *
 * Used by `HomeView` to thread the count to `InboxListPane` for the badge.
 * Uses the same `deriveActiveDraftCount` function as the panel so the
 * derivation logic cannot diverge.
 *
 * When the panel is closed, `rootStatusMap` is empty (queries disabled), so
 * thread-reply drafts are counted optimistically — orphaned roots only drop
 * out of the count once the panel opens and the relay lookups complete.
 * This bounded eventual-consistency is product-approved (Will, 2026-07-07).
 */
export function useActiveDraftCount(
  rootStatusMap: Map<string, RootStatus>,
): number {
  // Re-render on every draft write via useDraftsSnapshot.
  useDraftsSnapshot();
  const activeDrafts = getActiveDraftEntries().filter(isVisibleDraft);
  return deriveActiveDraftCount(activeDrafts, rootStatusMap);
}

// ── Shared draft view model ──────────────────────────────────────────────────

export function useDraftViewItems(enabled: boolean): DraftViewItem[] {
  const identityQuery = useIdentityQuery();
  const currentPubkey = identityQuery.data?.pubkey;
  const channelsQuery = useChannelsQuery();

  useDraftsSnapshot();
  const drafts = getActiveDraftEntries().filter(isVisibleDraft);

  const threadRootIds = React.useMemo(() => {
    const ids = new Set<string>();
    for (const entry of drafts) {
      const rootId = getThreadRootId(entry.key);
      if (rootId) {
        ids.add(rootId);
      }
    }
    return [...ids];
  }, [drafts]);

  const rootStatusMap = useDraftRootStatus(threadRootIds, enabled);

  const profilePubkeys = React.useMemo(
    () => [
      ...new Set(
        (channelsQuery.data ?? [])
          .filter((channel) =>
            drafts.some((entry) => entry.draft.channelId === channel.id),
          )
          .flatMap((channel) => channel.participantPubkeys),
      ),
    ],
    [channelsQuery.data, drafts],
  );
  const usersBatchQuery = useUsersBatchQuery(profilePubkeys, {
    enabled: profilePubkeys.length > 0,
  });
  const profiles = usersBatchQuery.data?.profiles;

  const sources = React.useMemo(
    () =>
      resolveDraftSources({
        channels: channelsQuery.data,
        currentPubkey,
        drafts,
        profiles,
      }),
    [channelsQuery.data, currentPubkey, drafts, profiles],
  );

  return drafts.map((entry) => {
    const threadRootId = getThreadRootId(entry.key);
    return {
      entry,
      rootStatus:
        threadRootId !== null
          ? (rootStatusMap.get(threadRootId) ?? "checking")
          : "available",
      source: sources.get(entry.key) ?? UNKNOWN_DRAFT_SOURCE,
    };
  });
}

// ── DraftsPanel ──────────────────────────────────────────────────────────────

type DraftsPanelProps = {
  items: DraftViewItem[];
  onDeleteDraft: (draftKey: string) => void;
  onSelectDraft: (draftKey: string) => void;
  selectedDraftKey: string | null;
};

export function DraftsPanel({ items, onDeleteDraft, onSelectDraft, selectedDraftKey }: DraftsPanelProps) {
  const { goChannel } = useAppNavigation();
  return <DraftListSurface items={items.map(toDraftSurfaceItem)} selectedKey={selectedDraftKey}
    onDelete={onDeleteDraft} onSelect={onSelectDraft}
    onOpen={(entry) => { void openDraftEntry(entry, goChannel); }}
    onSend={(entry) => { void sendDraftEntry(entry, goChannel); }}
    renderPreview={(draft, className) => <Markdown className={className} content={getDraftPreview(draft)} interactive={false} />} />;
}
