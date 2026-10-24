// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ProjectConversationPanel.tsx::ProjectConversationPanel on Web: the
// "Discussed in" hit's channel thread beside project detail. It is the same governed channel thread
// the Web channel page opens (ChannelThreadPane over the BFF thread read and publish routes),
// resolved from the admitted channel directory; a channel the viewer cannot read shows the
// original "could not be loaded" state rather than any content.
import { WorkspaceMembershipState } from "@client-kit/contracts";
import { useBffClient, useLocale, useT } from "@client-kit/platform/react/context";
import { loadChannelDirectory } from "@client-kit/platform/react/channel-browser/loadChannelDirectory";
import { getThreadReference, type TimelineMessage } from "@client-kit/platform/react/messages";
import type { ProjectConversationRenderProps } from "@client-kit/platform/react/projects";
import { MessageThreadPanelSkeleton, RightAuxiliaryPane } from "@client-kit/platform/react/thread";
import { Button } from "@client-kit/platform/react/button";
import { relativeTime } from "@client-kit/platform/format";
import { inboxThread } from "@client-kit/platform/inbox";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { buildMessageLink } from "@client-kit/platform/react/composer/features/messages/lib/messageLink";
import { ChannelThreadPane } from "./ChannelThreadPane";
import { useWorkspaceThread } from "./useWorkspaceThread";
import { unknownMemberLabel } from "@client-kit/platform/react/messages/system/identity";

export function ProjectConversationPane({ hit, onClose, widthPx, canResetWidth, onResetWidth, onResizeStart, principalId }:
  ProjectConversationRenderProps & { principalId: string }) {
  const client = useBffClient(); const t = useT(); const locale = useLocale();
  const directory = useQuery({ queryKey: ["platform", "project-conversation-directory", principalId, hit.channelId],
    queryFn: ({ signal }) => loadChannelDirectory(client, () => !signal.aborted), retry: false });
  const row = directory.data?.find(item => item.channel.channelId === hit.channelId && item.isMember
    && item.membershipState === WorkspaceMembershipState.Active);
  const workspaceId = row?.id ?? "";
  const rootId = hit.threadRootId ?? hit.eventId;
  const thread = useWorkspaceThread(principalId, workspaceId, rootId, undefined, undefined, Boolean(row), hit.channelId ?? undefined);
  const members = useQuery({ queryKey: ["platform", "channel-members", workspaceId], enabled: Boolean(row),
    queryFn: () => client.members(workspaceId), retry: false });
  const root = thread.messages.find(event => event.id === rootId);
  const loading = directory.isPending || (Boolean(row) && (thread.thread.isPending || members.isPending));
  const pane = (body: React.ReactNode) => <RightAuxiliaryPane canResetWidth={canResetWidth} onResetWidth={onResetWidth}
    onResizeStart={onResizeStart} testId="project-conversation-panel" widthPx={widthPx}>
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{body}</div>
  </RightAuxiliaryPane>;
  if (loading) return pane(<MessageThreadPanelSkeleton isFocusMode={false} onClose={onClose} widthPx={widthPx} />);
  if (!row || !root || thread.denied || thread.thread.isError || members.isError || !members.data) return pane(
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-6 text-center">
      <p className="text-sm text-muted-foreground">{t("projects.conversation.loadFailed")}</p>
      <Button onClick={onClose} size="sm" variant="outline">{t("projects.conversation.close")}</Button>
    </div>);
  const author = members.data.find(member => member.pubkeys.includes(root.pubkey))?.displayName ?? unknownMemberLabel();
  const selected: TimelineMessage = { id: root.id, pubkey: root.pubkey, signerPubkey: root.pubkey, kind: root.kind, body: root.content,
    tags: root.tags, createdAt: root.createdAt, depth: 0, edited: root.edited, author,
    time: relativeTime(locale, new Date(root.createdAt * 1000).toISOString()), ...inboxThread(root.tags) };
  return <ChannelThreadPane key={`${principalId}:${workspaceId}:${rootId}`} workspaceId={workspaceId} principalId={principalId}
    selected={selected} members={members.data} nonMemberMentionWorkspaceId={workspaceId} channelName={row.channel.name}
    channelId={row.channel.channelId} routeTargetMessageId={hit.eventId !== rootId ? hit.eventId : undefined}
    useSplitAuxiliaryPane disabled={row.channel.archived} onClose={onClose}
    onCopyMessage={message => { void writeTextToClipboard(message.body).then(() => toast.success(t("buzz.copiedMessage")), () => toast.error(t("buzz.copyFailed"))); }}
    onCopyLink={message => {
      const { rootId: threadRootId } = getThreadReference(message.tags ?? []);
      void writeTextToClipboard(buildMessageLink({ channelId: row.channel.channelId, messageId: message.id, threadRootId }))
        .then(() => toast.success(t("buzz.copiedLink")), () => toast.error(t("buzz.copyFailed")));
    }} />;
}
