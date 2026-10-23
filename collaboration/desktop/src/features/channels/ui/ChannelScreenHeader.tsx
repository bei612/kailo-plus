import { ChatHeader } from "@client-kit/platform/react/messages/chat-header";
// DD-125(5): the original header update indicator, before the channel actions.
import { UpdateIndicator } from "@/features/settings/UpdateIndicator";
import { DmHeaderParticipants } from "@client-kit/platform/react/messages/dm-header-participants";
import { translate } from "@client-kit/platform/i18n";
import { useDeviceLocale } from "@client-kit/platform/react/context";
import * as React from "react";
import { ChannelMembersBar, ChannelMembersDialog, type MemberRoster } from "@client-kit/platform/react/channel-members";
import { useConversations } from "@client-kit/platform/react/new-message";
import { ChannelManagementSheet } from "@client-kit/platform/react/channel-management-sheet";
import { toast } from "sonner";

import { getChannelDescription } from "@/features/channels/lib/channelDescription";
import type { EphemeralChannelDisplay } from "@client-kit/platform/react/ephemeral-channel";
import { ChannelHeaderStatusBadge } from "@/features/channels/ui/ChannelHeaderStatusBadge";
import { ChannelGlyph } from "@/features/channels/ui/ChannelGlyph";
import { useActiveChannelHeader } from "@/features/channels/useActiveChannelHeader";
import { channelsQueryKey, nativeApplicationWorkspace, useWorkspaceChannelDirectory, workspaceVisibilityQueryKey } from "@/features/channels/hooks";
import { useProfilePanel } from "@/shared/context/ProfilePanelContext";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import type { Channel } from "@/shared/api/types";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { AvatarHostProvider } from "@client-kit/platform/react/profile/avatar-host";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";
import { Markdown } from "@/shared/ui/markdown";
import { UserNameIndicators } from "@client-kit/platform/react/user-status";

type ChannelScreenHeaderProps = {
  activeChannel: Channel;
  activeChannelEphemeralDisplay: EphemeralChannelDisplay | null;
  /** Original ChannelScreen shouldCompactHeaderActions: the members bar collapses into one menu. */
  actionsVariant?: "inline" | "compact";
  chromeWrapperRef?: React.Ref<HTMLDivElement>;
  currentPubkey?: string;
};

export function ChannelScreenHeader({
  activeChannel,
  activeChannelEphemeralDisplay,
  actionsVariant = "inline",
  chromeWrapperRef,
  currentPubkey,
}: ChannelScreenHeaderProps) {
  const { activeChannelTitle: title, activeDmHeaderParticipants } = useActiveChannelHeader(activeChannel, currentPubkey);
  const locale = useDeviceLocale();
  const trimmedDescription = getChannelDescription(activeChannel, locale).trim();
  // The member roster and its governed changes are Workspace management: resolve the
  // admitted Workspace for this signed Relay channel through the same BFF directory.
  const directory = useWorkspaceChannelDirectory({ enabled: activeChannel.channelType !== "dm" });
  const workspace = activeChannel.channelType === "dm" ? undefined
    : nativeApplicationWorkspace(directory.data, { channelId: activeChannel.id });
  // A native DM is the governed conversation whose Relay channel this is; its participants
  // are the roster (membership is fixed at creation, as in the original).
  const conversations = useConversations();
  const conversation = activeChannel.channelType === "dm"
    ? conversations.items.find((item) => item.channelId === activeChannel.id && item.state === "ACTIVE") : undefined;
  const roster: MemberRoster | undefined = workspace ? { kind: "workspace", workspaceId: workspace.id }
    : conversation ? { kind: "conversation", conversation } : undefined;
  const rosterId = workspace?.id ?? conversation?.id;
  const [membersOpenFor, setMembersOpenFor] = React.useState<string | null>(null);
  const [manageOpenFor, setManageOpenFor] = React.useState<string | null>(null);
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { openProfilePanel } = useProfilePanel();

  async function handleCopyTitle(value: string) {
    try {
      await writeTextToClipboard(value);
      toast.success(translate(locale, "platform.profile.copied"));
    } catch {
      toast.error(translate(locale, "platform.profile.copyFailed"));
    }
  }

  return (
    <AvatarHostProvider value={{ locale, rewriteMediaUrl: rewriteRelayUrl }}>
      <ChatHeader belowSystemChrome transparentChrome chromeWrapperRef={chromeWrapperRef}
        title={title} description={trimmedDescription} channelType={activeChannel.channelType} visibility={activeChannel.visibility}
        onCopyTitle={handleCopyTitle}
        leadingContent={activeChannel.channelType === "dm" && activeDmHeaderParticipants.length > 0
          ? <DmHeaderParticipants participants={activeDmHeaderParticipants} title={title}
              renderIdentity={(participant, avatar) => participant.profilePubkey ? <UserProfilePopover pubkey={participant.profilePubkey}
                role={participant.isAgent ? "bot" : undefined} triggerElement="span"
                triggerAriaLabel={translate(locale, "platform.settings.profile")}>{avatar}</UserProfilePopover> : avatar} />
          : activeChannel.channelType !== "dm" ? <ChannelGlyph channel={activeChannel} className="h-4 w-4 translate-y-px text-muted-foreground" /> : undefined}
        // Original titleAdornment: a 1:1 DM shows the other person's status next to the title.
        titleAdornment={activeChannel.channelType === "dm" && activeDmHeaderParticipants.length === 1
          ? <UserNameIndicators className="ml-1" pubkey={activeDmHeaderParticipants[0]?.profilePubkey}
              pubkeys={activeDmHeaderParticipants[0]?.presencePubkeys} size="dm" /> : null}
        statusBadge={activeChannelEphemeralDisplay ? <ChannelHeaderStatusBadge ephemeralDisplay={activeChannelEphemeralDisplay} /> : undefined}
        actions={<div className="flex items-center gap-1"><UpdateIndicator />{roster && rosterId ? <ChannelMembersBar roster={roster}
          onToggleMembers={() => setMembersOpenFor(membersOpenFor === rosterId ? null : rosterId)}
          onManageChannel={() => setManageOpenFor(rosterId)} variant={actionsVariant}
          fallbackMemberCount={activeChannel.memberCount} /> : null}</div>} />
      {roster && rosterId ? <ChannelManagementSheet key={`manage:${rosterId}`} roster={roster}
        open={manageOpenFor === rosterId} onOpenChange={(open) => setManageOpenFor(open ? rosterId : null)} isDark={isDark}
        channel={activeChannel.channelType === "dm"
          ? { channelId: activeChannel.id, name: title, description: "", channelType: "dm", ttlSeconds: null }
          : { channelId: activeChannel.id, name: activeChannel.name, description: activeChannel.description,
            channelType: activeChannel.channelType, visibility: activeChannel.visibility, ttlSeconds: activeChannel.ttlSeconds,
            topic: activeChannel.topic ?? undefined, archived: Boolean(activeChannel.archivedAt) }}
        // DD-119 governed edits go through the shared BFF client; readback re-reads the native
        // channel list and the admitted directory. The member topic is native-signed (DD-119 (9))
        // and has no Desktop host path yet, so it stays read-only here.
        management={workspace ? { refresh: () => {
          void queryClient.invalidateQueries({ queryKey: channelsQueryKey });
          void queryClient.invalidateQueries({ queryKey: workspaceVisibilityQueryKey });
        },
        // DD-125(4) original Canvas view: the adopted CONTROL-authored body in the Desktop Markdown renderer.
        renderCanvas: (content) => <Markdown content={content} /> } : undefined}
        onOpenMembers={() => { window.requestAnimationFrame(() => setMembersOpenFor(rosterId)); }}
        workflows={workspace ? {
          onOpenWorkflow: (workflowId) => { setManageOpenFor(null); void navigate({ to: "/platform/workflows/$workflowId", params: { workflowId }, search: { workspaceId: workspace.id } }); },
          onCreateWorkflow: () => { setManageOpenFor(null); void navigate({ to: "/platform/$section", params: { section: "workflows" }, search: { workspaceId: workspace.id } }); },
        } : undefined}
        onCopy={(value) => writeTextToClipboard(value)} /> : null}
      {roster && rosterId ? <ChannelMembersDialog key={rosterId} roster={roster} open={membersOpenFor === rosterId}
        onOpenChange={(open) => setMembersOpenFor(open ? rosterId : null)} archived={Boolean(activeChannel.archivedAt)}
        currentPubkey={currentPubkey} workspaceName={roster.kind === "workspace" ? activeChannel.name : undefined}
        onOpenProfile={openProfilePanel ? (target) => { setMembersOpenFor(null); openProfilePanel(target.pubkey); } : undefined} /> : null}
    </AvatarHostProvider>
  );
}
