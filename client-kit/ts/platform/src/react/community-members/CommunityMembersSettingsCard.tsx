// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/community-members/ui/CommunityMembersSettingsCard.tsx.
// Tenant HUMAN rows retain Principal identity. Active keys are presentation
// facts, not a current device, a profile read grant or Relay CONTROL ownership.
import type { RoleMemberView } from "@client-kit/contracts";
import { MoreHorizontal, Search, Shield, UserRound } from "lucide-react";
import * as React from "react";
import { BffError } from "../../transport";
import {
  useBffClient,
  useCurrentPrincipalId,
  useLocale,
  useT,
} from "../context";
import { canonicalNpub, truncateNpub } from "../conversations/pubkey";
import { VirtualizedList } from "../forum/VirtualizedList";
import { getInitials } from "../profile/buzz/shared/lib/initials";
import { Avatar, AvatarFallback } from "../profile/buzz/shared/ui/avatar";
import { Button } from "../profile/buzz/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../sidebar/dropdown-menu";
import {
  loadRoleMemberDirectory,
  MemberActionFeedback,
  useMemberAction,
} from "../roles";
import { SettingsOptionGroup } from "../settings-option-group";
import { SettingsSectionHeader } from "../settings-surface";
import { useLoad } from "../use-load";

function HoverMemberIdentity({
  displayName,
  pubkeys,
  principalId,
}: {
  displayName: string;
  pubkeys: string[];
  principalId: string;
}) {
  const npubs = pubkeys
    .map(canonicalNpub)
    .filter((value): value is string => value !== null);
  return (
    <span
      className="inline-grid min-w-0 max-w-full grid-cols-1"
      title={npubs.length ? npubs.join(", ") : undefined}
    >
      <span
        className={
          npubs.length
            ? "col-start-1 row-start-1 max-w-40 truncate opacity-100 blur-0 transition-[max-width,opacity,filter] duration-[250ms] ease-in-out group-hover/member:max-w-0 group-hover/member:opacity-0 group-hover/member:blur-[2px] group-focus-within/member:max-w-0 group-focus-within/member:opacity-0 group-focus-within/member:blur-[2px] motion-reduce:transition-none"
            : "col-start-1 row-start-1 max-w-40 truncate"
        }
        data-testid={`relay-member-name-${principalId}`}
      >
        {displayName}
      </span>
      {npubs.length ? (
        <span
          className="col-start-1 row-start-1 max-w-0 truncate font-mono text-2xs opacity-0 blur-0 transition-[max-width,opacity,filter] duration-[250ms] ease-in-out group-hover/member:max-w-40 group-hover/member:opacity-100 group-hover/member:blur-0 group-focus-within/member:max-w-40 group-focus-within/member:opacity-100 group-focus-within/member:blur-0 motion-reduce:transition-none"
          data-testid={`relay-member-npub-${principalId}`}
        >
          {npubs.map(truncateNpub).join(", ")}
        </span>
      ) : null}
    </span>
  );
}

function RelayMemberRow({
  member,
  action,
}: {
  member: RoleMemberView;
  action: ReturnType<typeof useMemberAction>;
}) {
  const t = useT();
  const locale = useLocale();
  const currentPrincipalId = useCurrentPrincipalId();
  const trimmedName = member.displayName.trim();
  const displayName =
    trimmedName && !trimmedName.toLowerCase().startsWith("npub1")
      ? trimmedName
      : t("communityMembers.unnamed");
  const initials = getInitials(displayName);
  const canPromote = member.canGrantTenantAdmin;
  const canDemote = member.canRevokeTenantAdmin;
  const canRemove = member.canRemoveFromTenant === true;
  const hasActions = canRemove || canPromote || canDemote;
  const isBusy =
    action.busy ||
    action.confirming !== null ||
    action.submittedFor === member.principalId;
  const choose = (key: string, label: string) =>
    action.choose(key, member, label);
  return (
    <div
      className="group/member flex min-h-14 items-center gap-3 px-1 py-2.5"
      data-testid={`relay-member-row-${member.principalId}`}
    >
      {/* The original ProfileAvatar fallback; no ungranted Tenant profile/media request. */}
      <Avatar className="shrink-0 bg-primary/20 text-primary h-9 w-9 text-xs shadow-none">
        <AvatarFallback className="font-semibold text-primary bg-primary/20">
          {initials.length ? initials : <UserRound />}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
          <HoverMemberIdentity
            displayName={displayName}
            pubkeys={member.pubkeys ?? []}
            principalId={member.principalId}
          />
          {member.tenantAdmin ? (
            <Shield className="h-4 w-4 text-blue-500" />
          ) : null}
        </div>
        <div
          className="flex items-center gap-1.5 text-xs text-muted-foreground/70"
          data-settings-subcopy
        >
          <span className="shrink-0 capitalize">
            {t(
              member.tenantAdmin
                ? "communityMembers.admin"
                : "communityMembers.member",
            )}
          </span>
          {member.createdAt ? (
            <>
              <span aria-hidden="true" className="shrink-0">
                ·
              </span>
              <span className="shrink-0">
                {t("communityMembers.added", {
                  date: new Date(member.createdAt).toLocaleDateString(locale, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  }),
                })}
              </span>
            </>
          ) : null}
          {currentPrincipalId === member.principalId ? (
            <>
              <span aria-hidden="true" className="shrink-0">
                ·
              </span>
              <span className="shrink-0">{t("pulse.you")}</span>
            </>
          ) : null}
        </div>
      </div>
      {hasActions ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={t("members.actions", { name: displayName })}
              data-testid={`relay-member-actions-${member.principalId}`}
              disabled={isBusy}
              size="icon"
              variant="ghost"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canPromote ? (
              <DropdownMenuItem
                onSelect={() =>
                  choose("tenant.admin.grant", t("communityMembers.makeAdmin"))
                }
              >
                {t("communityMembers.makeAdmin")}
              </DropdownMenuItem>
            ) : null}
            {canDemote ? (
              <DropdownMenuItem
                onSelect={() =>
                  choose(
                    "tenant.admin.revoke",
                    t("communityMembers.makeMember"),
                  )
                }
              >
                {t("communityMembers.makeMember")}
              </DropdownMenuItem>
            ) : null}
            {canRemove && (canPromote || canDemote) ? (
              <DropdownMenuSeparator />
            ) : null}
            {canRemove ? (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() =>
                  choose("tenant.member.revoke", t("communityMembers.remove"))
                }
              >
                {t("communityMembers.remove")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

export function CommunityMembersSettingsCard({
  inviteAction,
  children,
}: {
  inviteAction: React.ReactNode;
  children: React.ReactNode;
}) {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad("community-role-members", () =>
    loadRoleMemberDirectory(client),
  );
  const action = useMemberAction(reload);
  const [search, setSearch] = React.useState("");
  React.useEffect(() => {
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [reload]);
  const members = React.useMemo(
    () => (state.status === "ok" ? [...state.data.values()] : []),
    [state],
  );
  const filteredMembers = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (member) =>
        member.displayName.toLowerCase().includes(q) ||
        (member.tenantAdmin ? "admin" : "member").includes(q) ||
        t(
          member.tenantAdmin
            ? "communityMembers.admin"
            : "communityMembers.member",
        )
          .toLowerCase()
          .includes(q) ||
        (member.pubkeys ?? []).some(
          (key) =>
            key.includes(q) || canonicalNpub(key)?.toLowerCase().includes(q),
        ),
    );
  }, [members, search, t]);
  if (
    state.status === "error" &&
    state.error instanceof BffError &&
    state.error.status === 403
  )
    return null;
  return (
    <section className="min-w-0" data-testid="settings-community-members">
      <SettingsSectionHeader
        action={inviteAction}
        title={t("communityMembers.title")}
        description={t("communityMembers.description")}
      />
      <MemberActionFeedback action={action} />
      <SettingsOptionGroup
        title={
          <>
            {t("platform.tab.members")}
            {members.length ? (
              <span className="ml-1.5 font-normal">{members.length}</span>
            ) : null}
          </>
        }
      >
        <div className="space-y-3 p-4 sm:p-5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full rounded-lg border border-border/70 bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="community-members-search"
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("members.search")}
              spellCheck={false}
              type="text"
              value={search}
            />
          </div>
          {state.status === "error" ? (
            <p
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {t("platform.loadFailed")}{" "}
              <Button onClick={reload}>{t("platform.retry")}</Button>
            </p>
          ) : null}
          {state.status === "pending" ? (
            <p className="py-3 text-sm text-muted-foreground">
              {t("communityMembers.loading")}
            </p>
          ) : state.status === "ok" ? (
            members.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/70 px-3 py-6 text-center text-sm text-muted-foreground">
                {t("communityMembers.none")}
              </p>
            ) : filteredMembers.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/70 px-3 py-6 text-center text-sm text-muted-foreground">
                {t("members.noMatch")}
              </p>
            ) : (
              <VirtualizedList
                className="max-h-[28rem] divide-y divide-border/60"
                estimateSize={60}
                getItemKey={(member) => member.principalId}
                items={filteredMembers}
                renderItem={(member) => (
                  <RelayMemberRow member={member} action={action} />
                )}
              />
            )
          ) : null}
        </div>
      </SettingsOptionGroup>
      {children}
    </section>
  );
}
