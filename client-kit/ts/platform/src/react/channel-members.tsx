// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/channels/ui/ChannelMembersBar.tsx::ChannelMembersBar
// desktop/src/features/channels/ui/MembersSidebar.tsx::MembersSidebar
// desktop/src/features/channels/ui/MembersSidebarMemberCard.tsx::MembersSidebarMemberCard
// desktop/src/features/channels/ui/AddMemberSearchResultRow.tsx::AddMemberSearchResultRow
// The original header trigger and channel member dialog are shared by Web and Desktop.
// Roster, roles and availability come from the BFF Workspace member and role projections;
// add, remove and role changes are the existing governed workspace.member.add/revoke and
// workspace.admin.grant/revoke actions (DD-41/46/82), re-admitted by Core on submit.
// Huddle is not offered on governed channels (SS-BUZ-GOVERNANCE), so the bar has no
// huddle control; Manage channel opens the shared channel-management-sheet. Channel roles are the platform admin relation only: no owner/guest.
// Agent rows (MembersSidebarMemberCard memberIsBot) are the Workspace's governed Agent
// installations, not memberships: name from the installation directory, the original
// AddChannelBotDialog is the governed agent.installation.create dialog, and a row opens the
// installation detail with its use authorization. DD-125(6): the original agent member menu (View
// activity for Installation audit holders, Stop/Start agent, Manage agent access..., Remove from
// channel) and the MembersSidebarAgentControls bulk menu map onto agent.installation.disable/enable,
// same-version agent.installation.upgrade and per-member agent.installation.use.grant/revoke.
// Member rows restore the original presence corner dot from the DD-120 snapshot, aggregated per
// person over all bound keys; a member without a presence fact shows no dot (never offline).
// DD-125(2): the original member-menu moderation items (time out, lift timeout, ban, lift ban;
// useMembersSidebarModeration) appear for Tenant manage holders on other HUMAN members who are
// not Tenant admins; Core re-admits each governed moderation.* action.
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Bot, CircleSlash, Clock, Ellipsis, EllipsisVertical, Settings2, Shield, ShieldCheck, Trash2, UserRoundPlus, Users, X } from "lucide-react";
import { AgentInstallationState, WorkspaceMembershipState, type AgentInstallationView, type ConversationParticipant, type ConversationView, type RoleMemberView, type WorkspaceMemberView } from "@client-kit/contracts";
import { useBffClient, useLocale, useT } from "./context";
import { enumLabel, workspaceMembershipStateMessages } from "../i18n";
import { truncatePubkey } from "../format";
import { BffError, TransportError } from "../transport";
import type { BffClient } from "../client";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "./composer/shared/ui/dialog";
import { Button } from "./profile/buzz/shared/ui/button";
import { cn } from "./profile/buzz/shared/lib/cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "./sidebar/tooltip";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "./sidebar/dropdown-menu";
import { MODAL_SEARCH_INPUT_CLASS, MODAL_SEARCH_SHELL_CLASS } from "./channel-browser/modalSearchStyles";
import { VirtualizedList } from "./forum/VirtualizedList";
import { ProfileAvatar } from "./profile/buzz/features/profile/ui/ProfileAvatar";
import { AvatarHostProvider } from "./profile/avatar-host";
import { MemberAvatar, type MemberTarget } from "./members";
import { loadRoleMemberDirectory, MemberActionFeedback, useMemberAction } from "./roles";
import { rankUserCandidatesBySearch } from "./search/userCandidateSearch";
import type { UserSearchResult } from "./search/types";
import { installationLabels, loadWorkspaceAgents } from "./agent-installation-view";
import { usePresenceQuery } from "./presence/hooks";
import { aggregatePresence } from "./presence/lib/presence";
import { PresenceCornerDot } from "./presence/ui/PresenceBadge";
import { TIMEOUT_PRESETS } from "../moderation";
import { useMembersSidebarModeration } from "./moderation/useMembersSidebarModeration";
import { useLifecycleRequest } from "./agent-activity/AgentLifecycleControls";
import { AgentMemberMenu, MembersSidebarAgentControls, bulkTargets } from "./agent-activity/MembersSidebarAgentControls";
import { EditRespondToDialog } from "./agent-activity/EditRespondToDialog";
import { useOpenAgentActivity } from "./agent-transcript";

// The governed installation dialogs live with the Agents page; load them on first use only.
const WorkspaceAgentDialogs = React.lazy(() => import("./agents").then((module) => ({ default: module.WorkspaceAgentDialogs })));

// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/presence/lib/presence.ts::getPresenceDotClassName.
// An installation is "online" only while it is Active with an active channel binding.
const PRESENCE_DOT_CLASS = { online: "bg-emerald-500", offline: "bg-muted-foreground/35" } as const;
const MEMBER_ADD_RESULT_LIMIT = 50;
const MEMBER_SEARCH_MIN_QUERY_LENGTH = 2;
const MEMBER_ROW_ESTIMATE_PX = 60;
const MEMBER_ROW_INSET_DIVIDER_CLASS =
  "after:pointer-events-none after:absolute after:bottom-0 after:left-[3.75rem] after:right-0 after:h-px after:bg-border/60 after:content-[''] last:after:hidden";

/** A channel roster is its Workspace membership; a DM roster is its admitted participants. */
export type MemberRoster =
  | { kind: "workspace"; workspaceId: string }
  | { kind: "conversation"; conversation: Pick<ConversationView, "id" | "participantPrincipalIds"> };

/** All pages of the caller's admitted DM directory, narrowed to this conversation. */
export async function loadConversationParticipants(client: BffClient,
  conversation: Pick<ConversationView, "participantPrincipalIds">): Promise<ConversationParticipant[]> {
  const items: ConversationParticipant[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await client.conversationParticipants(cursor);
    items.push(...page.items.filter((item) => conversation.participantPrincipalIds.includes(item.principalId)));
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new TransportError("Recipient cursor did not advance.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return items;
}

/** The profile proof for a roster key: its Workspace membership or its conversation. */
export function rosterMemberTarget(roster: MemberRoster,
  member: Pick<WorkspaceMemberView, "principalId" | "pubkeys" | "displayName">, pubkey: string): MemberTarget {
  const facts = { principalId: member.principalId, pubkey, alternatePubkeys: member.pubkeys, displayName: member.displayName };
  return roster.kind === "workspace"
    ? { ...facts, workspaceId: roster.workspaceId }
    : { ...facts, conversationId: roster.conversation.id };
}

/** One cached roster read for the header count, the dialog and the settings sheet. */
export function rosterQueryKey(roster: MemberRoster) {
  return roster.kind === "workspace"
    ? ["platform", "channel-members", roster.workspaceId] as const
    : ["platform", "conversation-roster", roster.conversation.id, roster.conversation.participantPrincipalIds.join(",")] as const;
}

export function useRosterMembers(roster: MemberRoster, enabled = true) {
  const client = useBffClient();
  return useQuery({
    queryKey: rosterQueryKey(roster),
    queryFn: async (): Promise<WorkspaceMemberView[]> => roster.kind === "workspace"
      ? client.members(roster.workspaceId)
      // Admitted participants carry no membership lifecycle; the conversation itself is open.
      : (await loadConversationParticipants(client, roster.conversation)).map((participant) => ({
        ...participant, state: WorkspaceMembershipState.Active })),
    enabled,
  });
}

export function ChannelMembersBar({ roster, onToggleMembers, onManageChannel, variant = "inline" }: {
  roster: MemberRoster;
  onToggleMembers: () => void;
  onManageChannel: () => void;
  /** Original ChannelScreen compacts the actions while an auxiliary panel leaves < 760px. */
  variant?: "inline" | "compact";
}) {
  const t = useT();
  const members = useRosterMembers(roster);
  const memberCount = members.isSuccess
    ? members.data.filter((member) => member.state === WorkspaceMembershipState.Active).length
    : null;
  if (variant === "compact") {
    return (
      <div className="flex items-center gap-[6px]">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button aria-label={t("channelMembers.channelActions")} data-testid="channel-actions-menu-trigger" size="icon" type="button" variant="outline">
              <EllipsisVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem data-testid="channel-members-trigger" onSelect={onToggleMembers}>
              <Users />
              <span>{t("channelMembers.members")}</span>
              <span className="ml-auto text-xs text-muted-foreground">{memberCount ?? ""}</span>
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="channel-management-trigger" onSelect={onManageChannel}>
              <Settings2 />
              <span>{t("channelManagement.manage")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-[6px]">
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <Button
            aria-label={t("channelMembers.view", { count: memberCount ?? "—" })}
            className="h-8 px-2.5"
            data-testid="channel-members-trigger"
            onClick={onToggleMembers}
            type="button"
            variant="outline"
          >
            <Users />
            <span className="min-w-[1ch] text-sm font-medium tabular-nums">{memberCount ?? ""}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("channelMembers.title")}</TooltipContent>
      </Tooltip>
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <Button
            aria-label={t("channelManagement.manage")}
            data-testid="channel-management-trigger"
            onClick={onManageChannel}
            size="icon"
            type="button"
            variant="outline"
          >
            <EllipsisVertical />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("channelManagement.settings")}</TooltipContent>
      </Tooltip>
    </div>
  );
}

/** A host opens the original profile panel for this exact admitted Workspace member key. */
export type MemberProfileRequest = MemberTarget & { nonce: number };

type Row = { member: WorkspaceMemberView; role: RoleMemberView | undefined; self: boolean; label: string };

function compareMembersForModal(left: Row, right: Row) {
  const rank = (row: Row) => (row.role?.workspaceAdmin ? 1 : 2);
  return rank(left) - rank(right)
    || Number(right.self) - Number(left.self)
    || left.member.displayName.localeCompare(right.member.displayName)
    || left.member.principalId.localeCompare(right.member.principalId);
}

export function ChannelMembersDialog({ roster, open, onOpenChange, archived = false, currentPrincipalId, currentPubkey, onOpenProfile, workspaceName }: {
  roster: MemberRoster;
  /** The channel's Workspace name, shown in the governed install review; omitted hides Add agent. */
  workspaceName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  archived?: boolean;
  currentPrincipalId?: string;
  currentPubkey?: string;
  onOpenProfile?: (target: { principalId: string; pubkey: string; alternatePubkeys: readonly string[]; displayName: string }) => void;
}) {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = React.useState("");
  // DM membership is fixed at creation (original canAddChannelMembers); only a channel
  // Workspace has a role projection and governed member actions.
  const workspaceId = roster.kind === "workspace" ? roster.workspaceId : undefined;
  const membersQuery = useRosterMembers(roster, open);
  const rolesQuery = useQuery({
    queryKey: ["platform", "channel-member-roles", workspaceId],
    queryFn: () => loadRoleMemberDirectory(client, workspaceId!),
    enabled: open && workspaceId !== undefined,
    retry: false,
    staleTime: 0,
  });
  const refresh = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: rosterQueryKey(roster) });
    void queryClient.invalidateQueries({ queryKey: ["platform", "channel-member-roles", workspaceId] });
  }, [queryClient, roster, workspaceId]);
  const action = useMemberAction(refresh);
  const moderation = useMembersSidebarModeration(open);
  const agentsQuery = useQuery({
    queryKey: ["platform", "channel-agents", workspaceId],
    queryFn: () => loadWorkspaceAgents(client, workspaceId!),
    enabled: open && workspaceId !== undefined,
    retry: false,
    staleTime: 0,
  });
  const lifecycle = useLifecycleRequest(() => {
    void queryClient.invalidateQueries({ queryKey: ["platform", "channel-agents", workspaceId] });
  });
  const lifecycleDisabled = archived || lifecycle.controller.busy || lifecycle.controller.pending.length > 0;
  const [accessTarget, setAccessTarget] = React.useState<{ installationId: string; name: string } | null>(null);
  const { openAgentActivity } = useOpenAgentActivity();
  const [agentDialogs, setAgentDialogs] = React.useState(false);
  const [agentCreateOpen, setAgentCreateOpen] = React.useState(false);
  const [selectedAgent, setSelectedAgent] = React.useState<string | null>(null);
  // Like the original Add-agent and View-activity entries, the member dialog yields to the
  // agent dialog instead of stacking two modal layers.
  const openAgentDialog = (resourceId: string | null) => {
    onOpenChange(false);
    setAgentDialogs(true);
    if (resourceId) setSelectedAgent(resourceId); else setAgentCreateOpen(true);
  };

  React.useEffect(() => {
    if (!open) {
      setSearchQuery("");
      return;
    }
    searchInputRef.current?.focus({ preventScroll: true });
  }, [open]);

  // A missing manage permission (403) only removes management affordances; other
  // read failures stay visible instead of looking like "no actions".
  const rolesForbidden = rolesQuery.isError && rolesQuery.error instanceof BffError && rolesQuery.error.status === 403;
  const roles = rolesQuery.isSuccess ? rolesQuery.data : undefined;
  const rows: Row[] = React.useMemo(() => (membersQuery.data ?? []).map((member) => {
    const self = member.principalId === currentPrincipalId || (currentPubkey !== undefined && member.pubkeys.includes(currentPubkey));
    return { member, role: roles?.get(member.principalId), self, label: self ? t("channelMembers.you") : member.displayName };
  }).sort(compareMembersForModal), [membersQuery.data, roles, currentPrincipalId, currentPubkey, t]);
  const activeRows = rows.filter((row) => row.member.state === WorkspaceMembershipState.Active);
  // DD-120 (5): one batched snapshot for the roster; a person is online if any bound key is.
  const presenceQuery = usePresenceQuery(activeRows.flatMap((row) => row.member.pubkeys), { enabled: open });
  const presenceLookup = presenceQuery.isSuccess ? presenceQuery.data : undefined;
  const selfActive = activeRows.some((row) => row.self);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const deferredSearchQuery = React.useDeferredValue(searchQuery.trim());
  const filteredRows = !normalizedSearchQuery ? rows : rows.filter((row) => [
    row.label, row.member.displayName, row.role?.workspaceAdmin ? "admin" : "member", ...row.member.pubkeys,
  ].some((label) => label.toLowerCase().includes(normalizedSearchQuery)));

  const candidates = React.useMemo(() => [...(roles?.values() ?? [])].filter((role) => role.canAddToWorkspace === true), [roles]);
  // Availability is per target and fails closed: no admitted candidate, no add affordance.
  const canAddMembers = candidates.length > 0;
  const showAddDeniedNotice = rolesForbidden && selfActive;
  const addSearchResults = React.useMemo(() => {
    if (deferredSearchQuery.length < MEMBER_SEARCH_MIN_QUERY_LENGTH) return [];
    const byUser = new Map<UserSearchResult, RoleMemberView>();
    const users = candidates.map((role) => {
      const user: UserSearchResult = { pubkey: role.pubkeys?.[0] ?? "", displayName: role.displayName, avatarUrl: null, nip05Handle: null, ownerPubkey: null, isAgent: false };
      byUser.set(user, role);
      return user;
    });
    return rankUserCandidatesBySearch({
      candidates: users,
      getLabel: (user) => user.displayName ?? "",
      limit: Math.max(MEMBER_ADD_RESULT_LIMIT, users.length),
      query: deferredSearchQuery,
    }).flatMap((user) => {
      const role = byUser.get(user);
      return role ? [role] : [];
    });
  }, [candidates, deferredSearchQuery]);
  const isAddSearchLoading = deferredSearchQuery.length >= MEMBER_SEARCH_MIN_QUERY_LENGTH && rolesQuery.isPending;
  const agents = agentsQuery.data ?? [];
  const agentName = (row: AgentInstallationView) => row.agentDisplayName?.trim() || t("agents.installation.id");
  const filteredAgents = !normalizedSearchQuery ? agents : agents.filter((row) => [
    agentName(row), "agent", row.agentPubkey ?? "",
  ].some((label) => label.toLowerCase().includes(normalizedSearchQuery)));
  const canOfferAgentAdd = workspaceId !== undefined && workspaceName !== undefined && !archived && selfActive;
  const disabled = action.busy || action.confirming !== null || archived;

  function addMember(role: RoleMemberView) {
    action.perform("workspace.member.add", role, t("actions.workspace.member.add"), workspaceId);
  }

  function renderMemberCard(row: Row) {
    const { member, role } = row;
    const pubkey = member.pubkeys[0];
    const active = member.state === WorkspaceMembershipState.Active;
    const canGrant = role?.canGrantWorkspaceAdmin === true;
    const canRevoke = role?.canRevokeWorkspaceAdmin === true;
    const showChangeRole = active && !row.self && (canGrant || canRevoke);
    const canRemoveMember = role?.canRemoveFromWorkspace === true;
    // Original canModerateMember: never self, never a Tenant admin (original owner/admin guard).
    const canModerateMember = moderation.canModerate && active && !row.self && role?.tenantAdmin !== true;
    const moderationState = moderation.moderationStateOf(member);
    const roleLabel = !active ? enumLabel(locale, workspaceMembershipStateMessages, member.state)
      : role?.workspaceAdmin ? t("communityMembers.admin") : null;
    const rowDisabled = disabled || action.submittedFor === member.principalId;
    const moderationDisabled = rowDisabled || moderation.isModerationPending;
    const openProfile = active && pubkey && onOpenProfile ? () => onOpenProfile({ principalId: member.principalId, pubkey, alternatePubkeys: member.pubkeys, displayName: member.displayName }) : undefined;
    return (
      <div
        className={cn(
          "group/member relative isolate flex min-h-14 items-center gap-3 px-4 py-3.5 text-left transition-colors duration-150 ease-out hover:bg-muted/40 focus-within:bg-muted/40",
          MEMBER_ROW_INSET_DIVIDER_CLASS,
        )}
        data-testid={`sidebar-member-${member.principalId}`}
      >
        {openProfile ? (
          <button
            aria-label={t("members.openProfile", { name: row.label })}
            className="absolute inset-0 z-0 cursor-pointer focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            data-testid={`sidebar-member-open-profile-${member.principalId}`}
            onClick={openProfile}
            type="button"
          />
        ) : (
          <span aria-hidden="true" className="absolute inset-0 z-0" />
        )}
        <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-3">
          <div className="relative shrink-0">
            {active && pubkey ? (
              <MemberAvatar className="h-8 w-8 text-xs shadow-none" label={member.displayName}
                target={rosterMemberTarget(roster, member, pubkey)} />
            ) : (
              <ProfileAvatar avatarUrl={null} className="h-8 w-8 text-xs shadow-none" iconClassName="h-4 w-4" label={member.displayName} shape="circle" />
            )}
            <PresenceCornerDot status={active ? aggregatePresence(presenceLookup, member.pubkeys) : undefined}
              testId={`sidebar-member-presence-${member.principalId}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium tracking-tight">{row.label}</span>
              {roleLabel ? <span className="inline-flex shrink-0 items-center text-xs text-muted-foreground">{roleLabel}</span> : null}
            </div>
          </div>
        </div>
        {showChangeRole || canRemoveMember || canModerateMember ? (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={t("members.actions", { name: member.displayName })}
                className="invisible relative z-20 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground group-hover/member:visible hover:bg-muted hover:text-foreground focus-visible:visible data-[state=open]:visible"
                data-testid={`sidebar-member-menu-${member.principalId}`}
                type="button"
              >
                <Ellipsis className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
              {showChangeRole ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger data-testid={`sidebar-change-role-${member.principalId}`} disabled={rowDisabled}>
                    <Shield className="h-4 w-4" />
                    {t("channelMembers.changeRole")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem data-testid={`sidebar-role-admin-${member.principalId}`} disabled={rowDisabled || !canGrant}
                      onClick={() => action.perform("workspace.admin.grant", member, t("actions.workspace.admin.grant"), workspaceId)}>
                      {role?.workspaceAdmin ? t("channelMembers.roleCurrent", { role: t("channelMembers.roleAdmin") }) : t("channelMembers.roleAdmin")}
                    </DropdownMenuItem>
                    <DropdownMenuItem data-testid={`sidebar-role-member-${member.principalId}`} disabled={rowDisabled || !canRevoke}
                      onClick={() => action.perform("workspace.admin.revoke", member, t("actions.workspace.admin.revoke"), workspaceId)}>
                      {role?.workspaceAdmin ? t("channelMembers.roleMember") : t("channelMembers.roleCurrent", { role: t("channelMembers.roleMember") })}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : null}
              {canRemoveMember ? (
                <>
                  {showChangeRole ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuItem className="text-destructive focus:text-destructive" data-testid={`sidebar-remove-member-${member.principalId}`}
                    disabled={rowDisabled}
                    onClick={() => action.perform("workspace.member.revoke", member, t("actions.workspace.member.revoke"), workspaceId)}>
                    <Trash2 className="h-4 w-4" />
                    {t("channelMembers.remove")}
                  </DropdownMenuItem>
                </>
              ) : null}
              {canModerateMember ? (
                <>
                  {canRemoveMember || showChangeRole ? <DropdownMenuSeparator /> : null}
                  {moderationState.timedOut ? (
                    <DropdownMenuItem data-testid={`sidebar-untimeout-${member.principalId}`} disabled={moderationDisabled}
                      onClick={() => moderation.onUntimeout(member)}>
                      <ShieldCheck className="h-4 w-4" />
                      {t("moderation.liftTimeout")}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger data-testid={`sidebar-timeout-${member.principalId}`} disabled={moderationDisabled}>
                        <Clock className="h-4 w-4" />
                        {t("moderation.member.timeout")}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {TIMEOUT_PRESETS.map((preset) => (
                          <DropdownMenuItem data-testid={`sidebar-timeout-${preset.seconds}-${member.principalId}`}
                            disabled={moderationDisabled} key={preset.seconds}
                            onClick={() => moderation.onTimeout(member, preset.duration)}>
                            {t(preset.label)}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                  {moderationState.banned ? (
                    <DropdownMenuItem data-testid={`sidebar-unban-${member.principalId}`} disabled={moderationDisabled}
                      onClick={() => moderation.onUnban(member)}>
                      <CircleSlash className="h-4 w-4" />
                      {t("moderation.liftBan")}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem className="text-destructive focus:text-destructive" data-testid={`sidebar-ban-${member.principalId}`}
                      disabled={moderationDisabled} onClick={() => moderation.onBan(member)}>
                      <Ban className="h-4 w-4" />
                      {t("moderation.member.ban")}
                    </DropdownMenuItem>
                  )}
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    );
  }

  function renderAgentCard(row: AgentInstallationView) {
    const name = agentName(row);
    const owner = membersQuery.data?.find((member) => member.principalId === row.ownerPrincipalId)?.displayName;
    const available = row.state === AgentInstallationState.Active && row.channelBinding?.status === "ACTIVE";
    return (
      <div
        className={cn(
          "group/member relative isolate flex min-h-14 items-center gap-3 px-4 py-3.5 text-left transition-colors duration-150 ease-out hover:bg-muted/40 focus-within:bg-muted/40",
          MEMBER_ROW_INSET_DIVIDER_CLASS,
        )}
        data-testid={`sidebar-agent-${row.resourceId}`}
        key={row.resourceId}
      >
        <button
          aria-label={t("channelMembers.openAgent", { name })}
          className="absolute inset-0 z-0 cursor-pointer focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          data-testid={`sidebar-agent-open-${row.resourceId}`}
          disabled={archived}
          onClick={() => openAgentDialog(row.resourceId)}
          type="button"
        />
        <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-3">
          <div className="relative shrink-0">
            <ProfileAvatar avatarUrl={null} className="h-8 w-8 text-xs shadow-none" iconClassName="h-4 w-4" label={name} shape="squircle" />
            <span
              className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-background"
              data-testid={`sidebar-agent-presence-${row.resourceId}`}
            >
              <span aria-hidden="true" className={cn("inline-flex h-2 w-2 shrink-0 rounded-full", PRESENCE_DOT_CLASS[available ? "online" : "offline"])} />
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium tracking-tight">{name}</span>
              <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><Bot className="h-3 w-3" />{t(installationLabels[row.state])}</span>
            </div>
            {owner ? <p className="truncate text-xs text-muted-foreground">{t("channelMembers.agentAddedBy", { name: owner })}</p> : null}
          </div>
        </div>
        <AgentMemberMenu installation={row} disabled={lifecycleDisabled}
          onManageAccess={() => setAccessTarget({ installationId: row.resourceId, name })}
          onRequest={(kind) => lifecycle.request(kind, [row])}
          onViewActivity={row.canAudit === true && row.agentPubkey ? () => {
            onOpenChange(false);
            openAgentActivity(row.agentPubkey!, { channelId: workspaceId ?? null });
          } : undefined} />
      </div>
    );
  }
  const bulk = bulkTargets(agents);

  return (
    <>
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        aria-describedby={undefined}
        className="max-w-xl gap-0 overflow-hidden border-0 px-6 pb-0 pt-6"
        data-testid="members-sidebar"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchInputRef.current?.focus({ preventScroll: true });
        }}
        showCloseButton={false}
      >
        <AvatarHostProvider value={{ locale, rewriteMediaUrl: (url) => url }}>
          <DialogHeader className="space-y-0 pb-5">
            <div className="flex items-center justify-between gap-4">
              <DialogTitle>{t("channelMembers.title")}</DialogTitle>
              <DialogClose className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 ease-out hover:bg-accent hover:text-accent-foreground focus:outline-hidden focus:ring-1 focus:ring-ring">
                <X className="h-4 w-4" />
                <span className="sr-only">{t("channel.create.close")}</span>
              </DialogClose>
            </div>
            <label className={MODAL_SEARCH_SHELL_CLASS} htmlFor="channel-management-search-users">
              <UserRoundPlus className="h-4 w-4 shrink-0 text-muted-foreground/55 transition-colors duration-150 ease-out group-hover/search:text-muted-foreground group-focus-within/search:text-foreground" />
              <input
                autoCapitalize="none"
                autoCorrect="off"
                className={MODAL_SEARCH_INPUT_CLASS}
                data-testid="channel-management-search-users"
                disabled={archived}
                id="channel-management-search-users"
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  const first = addSearchResults[0];
                  if (event.key !== "Enter" || !first || disabled) return;
                  event.preventDefault();
                  addMember(first);
                }}
                placeholder={t(canAddMembers ? "channelMembers.addPlaceholder" : "channelMembers.searchPlaceholder")}
                ref={searchInputRef}
                spellCheck={false}
                type="text"
                value={searchQuery}
              />
            </label>
            {showAddDeniedNotice ? (
              <p className="pt-2 text-sm text-muted-foreground" data-testid="members-sidebar-add-denied">{t("channelMembers.addDenied")}</p>
            ) : null}
          </DialogHeader>

          <div className="max-h-[calc(100vh-12rem)] overflow-y-auto pb-6">
            <section>
              <div className="h-[min(50vh,24rem)] overflow-y-auto rounded-xl border border-border/70 bg-background/70" data-testid="members-sidebar-people">
                <SearchResultSectionTitle>
                  {normalizedSearchQuery ? t("channelMembers.members") : t("channelMembers.membersCount", { count: activeRows.length })}
                </SearchResultSectionTitle>
                {membersQuery.isError ? (
                  <p className="px-4 py-3 text-sm text-destructive" role="alert">{t("platform.loadFailed")}</p>
                ) : normalizedSearchQuery ? (
                  <div>
                    {filteredRows.map((row) => <div className="content-visibility-auto-member-row" key={row.member.principalId}>{renderMemberCard(row)}</div>)}
                    {addSearchResults.length > 0 || isAddSearchLoading ? (
                      <SearchResultSectionTitle>{t("channelMembers.notInChannel")}</SearchResultSectionTitle>
                    ) : null}
                    {addSearchResults.map((role) => (
                      <AddMemberSearchResultRow disabled={disabled || action.submittedFor === role.principalId} key={role.principalId}
                        onSelect={addMember} role={role} />
                    ))}
                    {isAddSearchLoading ? <p className="px-4 py-3 text-sm text-muted-foreground">{t("channelMembers.searching")}</p> : null}
                    {filteredRows.length === 0 && addSearchResults.length === 0 && !isAddSearchLoading ? (
                      <p className="px-4 py-3 text-sm text-muted-foreground">{t("channelMembers.noMatch")}</p>
                    ) : null}
                  </div>
                ) : rows.length > 0 ? (
                  <VirtualizedList
                    className="h-[calc(100%_-_2.25rem)]"
                    estimateSize={MEMBER_ROW_ESTIMATE_PX}
                    getItemKey={(row) => row.member.principalId}
                    items={rows}
                    renderItem={renderMemberCard}
                  />
                ) : (
                  <p className="px-4 py-3 text-sm text-muted-foreground">
                    {membersQuery.isPending ? t("channelMembers.loading") : t("channelMembers.none")}
                  </p>
                )}
              </div>
            </section>
            {workspaceId !== undefined ? (
              <section className="mt-4 overflow-hidden rounded-xl border border-border/70 bg-background/70" data-testid="members-sidebar-agents">
                <SearchResultSectionTitle action={canOfferAgentAdd || bulk.stop.length + bulk.start.length + bulk.restart.length > 0 ? (
                  <span className="flex items-center gap-1">
                    {canOfferAgentAdd ? (
                      <Button className="h-7 px-2 text-xs" data-testid="members-sidebar-add-agent" onClick={() => openAgentDialog(null)} size="sm" type="button" variant="outline">
                        <Bot className="h-3.5 w-3.5" />{t("channelMembers.addAgent")}
                      </Button>
                    ) : null}
                    {bulk.stop.length + bulk.start.length + bulk.restart.length > 0 ? (
                      <MembersSidebarAgentControls canBulkRemove={bulk.stop.length > 0}
                        canBulkRespawn={bulk.start.length + bulk.restart.length > 0} canBulkStop={bulk.stop.length > 0}
                        disabled={lifecycleDisabled}
                        onRemoveAll={() => lifecycle.request("remove", bulk.stop)}
                        onRespawnAll={() => {
                          if (bulk.start.length > 0) lifecycle.request("start", bulk.start);
                          else lifecycle.request("restart", bulk.restart);
                        }}
                        onStopAll={() => lifecycle.request("stop", bulk.stop)} />
                    ) : null}
                  </span>
                ) : null}>
                  {normalizedSearchQuery ? t("channelMembers.agents") : t("channelMembers.agentsCount", { count: agents.length })}
                </SearchResultSectionTitle>
                {agentsQuery.isError ? (
                  <p className="px-4 py-3 text-sm text-destructive" role="alert">{t("platform.loadFailed")}</p>
                ) : agentsQuery.isPending ? (
                  <p className="px-4 py-3 text-sm text-muted-foreground">{t("channelMembers.agentsLoading")}</p>
                ) : filteredAgents.length > 0 ? (
                  <div className="max-h-[min(30vh,15rem)] overflow-y-auto">{filteredAgents.map(renderAgentCard)}</div>
                ) : (
                  <p className="px-4 py-3 text-sm text-muted-foreground">{normalizedSearchQuery ? t("channelMembers.noMatch") : t("channelMembers.noAgents")}</p>
                )}
                {lifecycle.feedback ? <div className="px-4 pb-3">{lifecycle.feedback}</div> : null}
              </section>
            ) : null}
            {rolesQuery.isError && !rolesForbidden ? (
              <p className="mt-4 text-sm text-destructive" role="alert">{t("platform.loadFailed")}</p>
            ) : null}
            <div className="mt-4 space-y-2 text-sm" data-testid="members-sidebar-action-feedback">
              <MemberActionFeedback action={action} />
            </div>
          </div>
        </AvatarHostProvider>
      </DialogContent>
    </Dialog>
    {lifecycle.dialog}
    <EditRespondToDialog agent={accessTarget} open={accessTarget !== null}
      onOpenChange={(next) => { if (!next) setAccessTarget(null); }}
      onRecorded={() => void queryClient.invalidateQueries({ queryKey: ["platform", "channel-agents", workspaceId] })} />
    {agentDialogs && workspaceId !== undefined && workspaceName !== undefined ? (
      <React.Suspense fallback={null}>
        <WorkspaceAgentDialogs createOpen={agentCreateOpen} onCreateOpenChange={setAgentCreateOpen}
          onRecorded={() => void queryClient.invalidateQueries({ queryKey: ["platform", "channel-agents", workspaceId] })}
          onSelectedChange={setSelectedAgent} selectedId={selectedAgent} workspaceId={workspaceId} workspaceName={workspaceName} />
      </React.Suspense>
    ) : null}
    </>
  );
}

function AddMemberSearchResultRow({ disabled, onSelect, role }: {
  disabled: boolean;
  onSelect: (role: RoleMemberView) => void;
  role: RoleMemberView;
}) {
  const t = useT();
  const name = role.displayName.trim() || (role.pubkeys?.[0] ? truncatePubkey(role.pubkeys[0]) : role.principalId);
  return (
    <div
      className={cn(
        "group/add-result relative isolate flex min-h-14 w-full items-center gap-3 px-4 py-3.5 text-left transition-colors duration-150 ease-out hover:bg-muted/40 focus-within:bg-muted/40",
        MEMBER_ROW_INSET_DIVIDER_CLASS,
      )}
      data-testid={`channel-user-search-result-${role.principalId}`}
    >
      <button
        aria-label={t("channelMembers.select", { name })}
        className="absolute inset-0 z-0 cursor-pointer focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
        disabled={disabled}
        onClick={() => onSelect(role)}
        type="button"
      />
      <ProfileAvatar avatarUrl={null} className="pointer-events-none relative z-10 h-8 w-8 text-xs shadow-none" label={name} shape="circle" />
      <div className="pointer-events-none relative z-10 min-w-0 flex-1">
        <span className="block truncate text-sm font-medium tracking-tight">{name}</span>
      </div>
      <Button
        className="relative z-20 shrink-0"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(role);
        }}
        size="sm"
        type="button"
      >
        {t("channelMembers.add")}
      </Button>
    </div>
  );
}

function SearchResultSectionTitle({ action, children }: { action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-10 mr-3 flex min-h-9 items-center gap-2 bg-background/95 px-4 pb-1.5 pt-3 text-xs font-medium text-muted-foreground/75 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <span>{children}</span>
      {action ? <span className="ml-auto">{action}</span> : null}
    </div>
  );
}
