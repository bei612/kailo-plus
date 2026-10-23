// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/home/ui/InboxDetailPane.tsx::InboxDetailPane L668-681 (ChannelMembersBar in the
// detail header) and L887-897 (MembersSidebar), desktop/src/features/home/ui/HomeView.tsx
// onManageChannel → the channel's ChannelManagementSheet. Web and Desktop share this body; the
// roster, the admitted channel view and the governed management seam come from the host, and every
// change is still re-admitted by Core (DD-41/DD-119).
import * as React from "react";
import { ChannelManagementSheet, type ChannelManagementChannel } from "../channel-management-sheet";
import type { ChannelManagementHost } from "../channel-management-actions";
import { ChannelMembersBar, ChannelMembersDialog, type MemberRoster } from "../channel-members";

export function InboxDetailChannelMembers({ roster, channel, isDark, management, onCopy, currentPrincipalId, currentPubkey, fallbackMemberCount }: {
  roster: MemberRoster;
  channel: ChannelManagementChannel;
  isDark: boolean;
  /** DD-119 governed management of a Workspace channel; omitted keeps the read-only summary. */
  management?: ChannelManagementHost;
  onCopy: (value: string) => Promise<void>;
  currentPrincipalId?: string;
  currentPubkey?: string;
  fallbackMemberCount?: number;
}) {
  const [membersOpen, setMembersOpen] = React.useState(false);
  const [manageOpen, setManageOpen] = React.useState(false);
  // Mounted on first open and kept mounted afterwards, so an UNKNOWN governed intent keeps its
  // idempotency key across closing (no resend under a new key); unopened details cost no reads.
  const [membersMounted, setMembersMounted] = React.useState(false);
  const [manageMounted, setManageMounted] = React.useState(false);
  const openMembers = (open: boolean) => { if (open) setMembersMounted(true); setMembersOpen(open); };
  const archived = channel.archived === true;
  return <>
    <ChannelMembersBar roster={roster} fallbackMemberCount={fallbackMemberCount}
      onToggleMembers={() => openMembers(!membersOpen)} onManageChannel={() => { setManageMounted(true); setManageOpen(true); }} />
    {membersMounted ? <ChannelMembersDialog roster={roster} open={membersOpen} onOpenChange={openMembers} archived={archived}
      currentPrincipalId={currentPrincipalId} currentPubkey={currentPubkey}
      workspaceName={roster.kind === "workspace" ? channel.name : undefined} /> : null}
    {manageMounted ? <ChannelManagementSheet roster={roster} channel={channel} open={manageOpen} onOpenChange={setManageOpen} isDark={isDark}
      management={management} onCopy={onCopy}
      onOpenMembers={() => { window.requestAnimationFrame(() => openMembers(true)); }} /> : null}
  </>;
}
