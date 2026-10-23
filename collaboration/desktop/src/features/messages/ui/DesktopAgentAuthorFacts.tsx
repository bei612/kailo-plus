// DD-147(1): the Desktop host of the shared Agent author facts. Every surface that renders
// Workspace-channel rows outside ChannelPane (Home Inbox, the project conversation's
// independent thread window) provides the same member-readable directory, so the original
// "managed by <owner>" line appears there too and the owner's name opens the profile card.
import * as React from "react";
import { useBffClient } from "@client-kit/platform/react/context";
import {
  AgentAuthorFactsProvider,
  useAgentAuthorFacts,
  type AgentOwnerRenderer,
} from "@client-kit/platform/react/messages";
import { nativeApplicationWorkspace, useWorkspaceChannelDirectory } from "@/features/channels/hooks";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";

/** The owner's name opens the original profile popover (panel on click). */
export const renderDesktopAgentOwner: AgentOwnerRenderer = (owner, name) => (
  <UserProfilePopover pubkey={owner.pubkey} triggerAriaLabel={owner.label} triggerElement="span">
    {name}
  </UserProfilePopover>
);

/** Facts for the Workspace whose channel is `channelId`; DMs and unknown channels read nothing. */
export function DesktopAgentAuthorFacts({ channelId, enabled = true, children }: {
  channelId: string | null | undefined;
  enabled?: boolean;
  children: React.ReactNode;
}) {
  const bff = useBffClient();
  const directory = useWorkspaceChannelDirectory({ enabled: enabled && Boolean(channelId) });
  const workspaceId = channelId
    ? nativeApplicationWorkspace(directory.data, { channelId })?.id ?? null
    : null;
  const facts = useAgentAuthorFacts(bff, enabled && workspaceId ? { workspaceId } : null);
  return (
    <AgentAuthorFactsProvider facts={facts} renderOwner={renderDesktopAgentOwner}>
      {children}
    </AgentAuthorFactsProvider>
  );
}
