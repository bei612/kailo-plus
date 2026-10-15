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
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ellipsis, EllipsisVertical, Shield, Trash2, UserRoundPlus, Users, X } from "lucide-react";
import { WorkspaceMembershipState, type RoleMemberView, type WorkspaceMemberView } from "@client-kit/contracts";
import { useBffClient, useLocale, useT } from "./context";
import { enumLabel, workspaceMembershipStateMessages } from "../i18n";
import { truncatePubkey } from "../format";
import { BffError } from "../transport";
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
import { MemberAvatar } from "./members";
import { loadRoleMemberDirectory, MemberActionFeedback, useMemberAction } from "./roles";
import { rankUserCandidatesBySearch } from "./search/userCandidateSearch";
import type { UserSearchResult } from "./search/types";

const MEMBER_ADD_RESULT_LIMIT = 50;
const MEMBER_SEARCH_MIN_QUERY_LENGTH = 2;
const MEMBER_ROW_ESTIMATE_PX = 60;
const MEMBER_ROW_INSET_DIVIDER_CLASS =
  "after:pointer-events-none after:absolute after:bottom-0 after:left-[3.75rem] after:right-0 after:h-px after:bg-border/60 after:content-[''] last:after:hidden";

/** One cached Workspace roster read for the header count and the dialog. */
export function channelMembersQueryKey(workspaceId: string) {
  return ["platform", "channel-members", workspaceId] as const;
}

export function useChannelMembers(workspaceId: string, enabled = true) {
  const client = useBffClient();
  return useQuery({ queryKey: channelMembersQueryKey(workspaceId), queryFn: () => client.members(workspaceId), enabled });
}

export function ChannelMembersBar({ workspaceId, onToggleMembers, onManageChannel }: {
  workspaceId: string;
  onToggleMembers: () => void;
  onManageChannel: () => void;
}) {
  const t = useT();
  const members = useChannelMembers(workspaceId);
  const memberCount = members.isSuccess
    ? members.data.filter((member) => member.state === WorkspaceMembershipState.Active).length
    : null;
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
export type MemberProfileRequest = { workspaceId: string; principalId: string; pubkey: string; nonce: number };

type Row = { member: WorkspaceMemberView; role: RoleMemberView | undefined; self: boolean; label: string };

function compareMembersForModal(left: Row, right: Row) {
  const rank = (row: Row) => (row.role?.workspaceAdmin ? 1 : 2);
  return rank(left) - rank(right)
    || Number(right.self) - Number(left.self)
    || left.member.displayName.localeCompare(right.member.displayName)
    || left.member.principalId.localeCompare(right.member.principalId);
}

export function ChannelMembersDialog({ workspaceId, open, onOpenChange, archived = false, currentPrincipalId, currentPubkey, onOpenProfile }: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  archived?: boolean;
  currentPrincipalId?: string;
  currentPubkey?: string;
  onOpenProfile?: (target: { principalId: string; pubkey: string }) => void;
}) {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = React.useState("");
  const membersQuery = useChannelMembers(workspaceId, open);
  const rolesQuery = useQuery({
    queryKey: ["platform", "channel-member-roles", workspaceId],
    queryFn: () => loadRoleMemberDirectory(client, workspaceId),
    enabled: open,
    retry: false,
    staleTime: 0,
  });
  const refresh = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: channelMembersQueryKey(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: ["platform", "channel-member-roles", workspaceId] });
  }, [queryClient, workspaceId]);
  const action = useMemberAction(refresh);

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
    const roleLabel = !active ? enumLabel(locale, workspaceMembershipStateMessages, member.state)
      : role?.workspaceAdmin ? t("communityMembers.admin") : null;
    const rowDisabled = disabled || action.submittedFor === member.principalId;
    const openProfile = active && pubkey && onOpenProfile ? () => onOpenProfile({ principalId: member.principalId, pubkey }) : undefined;
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
                target={{ workspaceId, principalId: member.principalId, pubkey }} />
            ) : (
              <ProfileAvatar avatarUrl={null} className="h-8 w-8 text-xs shadow-none" iconClassName="h-4 w-4" label={member.displayName} shape="circle" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium tracking-tight">{row.label}</span>
              {roleLabel ? <span className="inline-flex shrink-0 items-center text-xs text-muted-foreground">{roleLabel}</span> : null}
            </div>
          </div>
        </div>
        {showChangeRole || canRemoveMember ? (
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
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    );
  }

  return (
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

function SearchResultSectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-10 mr-3 flex min-h-9 items-center gap-2 bg-background/95 px-4 pb-1.5 pt-3 text-xs font-medium text-muted-foreground/75 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <span>{children}</span>
    </div>
  );
}
