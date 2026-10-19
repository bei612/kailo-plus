// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/settings/ui/ModerationQueueCard.tsx::{ModerationQueueCard,QueueTab,AuditTab}
// DD-125(2), V-SCN-130: Settings → Moderation. The section is visible to everyone and the card
// tells non-moderators it is for moderators only (original); the queue and audit log are
// Core's audited Tenant-manage reads of the Relay tables. Resolving keeps the original order:
// enforce first through its own governed action (moderation.message.delete, moderation.ban
// or workspace.member.revoke), then resolve every open report of the target with one
// moderation.report.resolve (9044 per report, decision only). The queue offers no timeout.
// The original amber accents are the host's semantic warning colour.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ModerationReportTargetKind, ModerationResolutionAction, ModerationResolutionStatus, type RoleMemberView,
} from "@client-kit/contracts";
import {
  buildModerationQueue, deleteMessageCommand, groupTopReportType, isOpenReport, kickCommand, memberCommand,
  reportTypeLabel, resolvableActions, resolveCommand, severityTier, statusForAction,
  type ModerationAuditAction, type ModerationOutcome, type ModerationQueueGroup, type ModerationReport, type SeverityTier,
} from "../../moderation";
import type { PlatformMessageKey } from "../../i18n";
import { BffError, isOutcomeUnknown } from "../../transport";
import { useBffClient, useLocale, useReasonText, useT } from "../context";
import { truncateNpub, truncatePubkey } from "../conversations/pubkey";
import { Button } from "../profile/buzz/shared/ui/button";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../profile/buzz/shared/ui/tabs";
import { loadRoleMemberDirectory } from "../roles";
import { SettingsSectionHeader } from "../settings-surface";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "../sidebar/dropdown-menu";
import {
  useModerationAccessQuery, useModerationAction, useModerationAuditQuery, useModerationReportsQuery,
} from "./hooks";

const EMPTY_ACTIONS: readonly ModerationAuditAction[] = [];

const RESOLUTION_OPTIONS: ReadonlyArray<{ action: ModerationResolutionAction; label: PlatformMessageKey; description: PlatformMessageKey }> = [
  { action: ModerationResolutionAction.Delete, label: "moderation.resolution.delete", description: "moderation.resolution.deleteDescription" },
  { action: ModerationResolutionAction.Kick, label: "moderation.resolution.kick", description: "moderation.resolution.kickDescription" },
  { action: ModerationResolutionAction.Ban, label: "moderation.resolution.ban", description: "moderation.resolution.banDescription" },
  { action: ModerationResolutionAction.Escalate, label: "moderation.resolution.escalate", description: "moderation.resolution.escalateDescription" },
  { action: ModerationResolutionAction.Dismiss, label: "moderation.resolution.dismiss", description: "moderation.resolution.dismissDescription" },
];

const SEVERITY_BADGE: Record<SeverityTier, string> = {
  critical: "bg-destructive/15 text-destructive",
  high: "bg-warning-bg text-warning",
  normal: "bg-muted text-muted-foreground",
};

function useTimestamp() {
  const locale = useLocale();
  return (iso: string) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };
}

/** Display names from the Tenant member directory; a key without one shows its npub. */
function useDirectoryNames(enabled: boolean) {
  const client = useBffClient();
  const directory = useQuery({
    queryKey: ["platform", "moderation", "directory"],
    queryFn: () => loadRoleMemberDirectory(client),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
  return useMemo(() => {
    const names = new Map<string, string>();
    for (const member of directory.data?.values() ?? ([] as RoleMemberView[])) {
      for (const pubkey of member.pubkeys ?? []) names.set(pubkey.toLowerCase(), member.displayName);
    }
    return (pubkey: string) => names.get(pubkey.toLowerCase())?.trim() || truncateNpub(pubkey);
  }, [directory.data]);
}

function targetLabel(group: ModerationQueueGroup): { key: PlatformMessageKey; id: string } {
  switch (group.targetKind) {
    case ModerationReportTargetKind.Event:
      // An event id is not a pubkey identity: keep the generic hex form.
      return { key: "moderation.target.message", id: truncatePubkey(group.target) };
    case ModerationReportTargetKind.Pubkey:
      return { key: "moderation.target.member", id: truncateNpub(group.target) };
    default:
      return { key: "moderation.target.attachment", id: truncatePubkey(group.target) };
  }
}

function ReporterLine({ report, name }: { report: ModerationReport; name: (pubkey: string) => string }) {
  const t = useT();
  const timestamp = useTimestamp();
  return (
    <div className="rounded-md border border-border/50 bg-background/50 px-2.5 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-medium">{t(reportTypeLabel(report.reportType))}</span>
        <span className="text-muted-foreground">
          {t("moderation.queue.reportedBy", { who: name(report.reporterPubkey), time: timestamp(report.createdAt) })}
        </span>
      </div>
      {report.note ? (
        <p className="mt-1 text-xs text-muted-foreground/70" data-settings-subcopy>{report.note}</p>
      ) : null}
    </div>
  );
}

function ResolveMenu({ allowed, disabled, onResolve }: {
  allowed: readonly ModerationResolutionAction[];
  disabled: boolean;
  onResolve: (action: ModerationResolutionAction) => void;
}) {
  const t = useT();
  const options = RESOLUTION_OPTIONS.filter((option) => allowed.includes(option.action));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button data-testid="moderation-resolve-trigger" disabled={disabled} size="sm" type="button">
          {t("moderation.resolve")}
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{t("moderation.resolution")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuItem data-testid={`moderation-resolve-${option.action}`} key={option.action}
            onSelect={() => onResolve(option.action)}>
            <div className="flex flex-col">
              <span className="text-sm font-medium">{t(option.label)}</span>
              <span className="text-xs text-muted-foreground/70" data-settings-subcopy>{t(option.description)}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function QueueGroupCard({ group, name, onResolve, disabled }: {
  group: ModerationQueueGroup;
  name: (pubkey: string) => string;
  onResolve: (group: ModerationQueueGroup, action: ModerationResolutionAction) => void;
  disabled: boolean;
}) {
  const t = useT();
  const topType = groupTopReportType(group);
  const tier = severityTier(topType);
  const target = targetLabel(group);
  const count = group.reports.length;
  return (
    <div className="space-y-2.5 rounded-lg border border-border/60 bg-background/60 p-3"
      data-testid={`moderation-group-${group.targetKey}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", SEVERITY_BADGE[tier])}>
              {tier === "critical" ? <ShieldAlert className="mr-1 h-3 w-3" /> : null}
              {t(reportTypeLabel(topType))}
            </span>
            <span className="truncate font-mono text-xs text-muted-foreground">{t(target.key, { id: target.id })}</span>
            <span className="text-xs text-muted-foreground">
              · {t(count === 1 ? "moderation.queue.reportCount.one" : "moderation.queue.reportCount.other", { count })}
            </span>
          </div>
        </div>
        <div className="shrink-0">
          <ResolveMenu allowed={resolvableActions(group)} disabled={disabled} onResolve={(action) => onResolve(group, action)} />
        </div>
      </div>
      <div className="space-y-1.5">
        {group.reports.map((report) => <ReporterLine key={report.id} name={name} report={report} />)}
      </div>
      {group.priorActions.length > 0 ? (
        <div className="flex items-start gap-1.5 rounded-md bg-warning-bg px-2.5 py-1.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {t(group.priorActions.length === 1 ? "moderation.queue.priorActions.one" : "moderation.queue.priorActions.other", {
              count: group.priorActions.length,
              actions: group.priorActions.slice(0, 3).map((action) => action.action).join(", "),
            })}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** The enforcement paired with a resolution, by its own governed action; none for escalate/dismiss. */
function enforcement(group: ModerationQueueGroup, action: ModerationResolutionAction) {
  switch (action) {
    case ModerationResolutionAction.Delete:
      return group.workspaceId
        ? { intent: `delete:${group.target}`, build: (key: string) => deleteMessageCommand(group.workspaceId!, group.target, key) }
        : null;
    case ModerationResolutionAction.Ban:
      return group.authorPubkey
        ? { intent: `ban:${group.authorPubkey}`, build: (key: string) => memberCommand("ban", group.authorPubkey!, key) }
        : null;
    case ModerationResolutionAction.Kick:
      return group.workspaceId && group.authorPrincipalId
        ? {
          intent: `kick:${group.workspaceId}:${group.authorPrincipalId}`,
          build: (key: string) => kickCommand(group.workspaceId!, group.authorPrincipalId!, key),
        }
        : null;
    default:
      return undefined;
  }
}

function QueueTab({ name }: { name: (pubkey: string) => string }) {
  const t = useT();
  const reasonText = useReasonText();
  const queryClient = useQueryClient();
  const reportsQuery = useModerationReportsQuery();
  const auditQuery = useModerationAuditQuery();
  const action = useModerationAction();
  const [busy, setBusy] = useState(false);
  const groups = useMemo(
    () => buildModerationQueue(reportsQuery.data?.items ?? [], auditQuery.data?.items ?? EMPTY_ACTIONS),
    [reportsQuery.data, auditQuery.data],
  );

  const settled = (outcome: ModerationOutcome): boolean => {
    if (outcome.kind === "done") return true;
    if (outcome.kind === "unknown") toast(t("moderation.toast.unknown", { operation: outcome.operationId }));
    else toast.error(outcome.reason ? reasonText(outcome.reason) : t("moderation.queue.resolveFailed"));
    return false;
  };

  async function handleResolve(group: ModerationQueueGroup, resolution: ModerationResolutionAction) {
    const open = group.reports.filter(isOpenReport).map((report) => report.reportEventId);
    if (open.length === 0) return;
    const enforce = enforcement(group, resolution);
    if (enforce === null) {
      toast.error(t("moderation.queue.authorUnknown"));
      return;
    }
    setBusy(true);
    try {
      // Enforce FIRST: the 9044 tells the reporter it was acted on, so it must not precede
      // the paired action. A failed or unknown enforcement leaves the reports open.
      if (enforce && !settled(await action.mutateAsync(enforce))) return;
      if (resolution === ModerationResolutionAction.Kick && group.workspaceId) {
        await queryClient.invalidateQueries({ queryKey: ["platform", "channel-members", group.workspaceId] });
      }
      const resolved = await action.mutateAsync({
        intent: `resolve:${group.targetKey}:${resolution}:${open.join(",")}`,
        build: (key) => resolveCommand(open, resolution, key),
      });
      if (!settled(resolved)) return;
      const dismissed = statusForAction(resolution) === ModerationResolutionStatus.Dismissed;
      toast.success(t(dismissed ? "moderation.queue.dismissed" : "moderation.queue.resolved"));
    } catch (error) {
      if (isOutcomeUnknown(error)) {
        toast(t("moderation.toast.unknown", { operation: error instanceof BffError ? error.operationId ?? "" : "" }));
      } else {
        toast.error(error instanceof BffError && error.reason ? reasonText(error.reason) : t("moderation.queue.resolveFailed"));
      }
    } finally {
      setBusy(false);
    }
  }

  if (reportsQuery.error) {
    const error = reportsQuery.error;
    return (
      <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
        {error instanceof BffError && error.reason ? reasonText(error.reason) : t("platform.loadFailed")}
      </p>
    );
  }
  if (reportsQuery.isLoading) return <p className="text-sm text-muted-foreground">{t("moderation.queue.loading")}</p>;
  if (groups.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border/70 bg-background/40 px-3 py-6 text-center text-sm text-muted-foreground">
        {t("moderation.queue.empty")}
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {reportsQuery.data?.truncated ? <p className="text-xs text-muted-foreground" role="status">{t("moderation.queue.truncated")}</p> : null}
      {groups.map((group) => (
        <QueueGroupCard disabled={busy || action.isPending} group={group} key={group.targetKey} name={name}
          onResolve={(target, resolution) => void handleResolve(target, resolution)} />
      ))}
    </div>
  );
}

function AuditRow({ action, name }: { action: ModerationAuditAction; name: (pubkey: string) => string }) {
  const t = useT();
  const timestamp = useTimestamp();
  // Actor and member targets are pubkey identities; a targeted event keeps the hex form.
  const targetShort = action.targetPubkey
    ? truncateNpub(action.targetPubkey)
    : action.targetEventId ? truncatePubkey(action.targetEventId) : null;
  return (
    <div className="space-y-1 rounded-lg border border-border/60 bg-background/60 px-3 py-2"
      data-testid={`moderation-audit-${action.id}`}>
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="font-medium capitalize">{action.action.replace(/_/g, " ")}</span>
        {targetShort ? <span className="font-mono text-xs text-muted-foreground">→ {targetShort}</span> : null}
        <span className="text-xs text-muted-foreground">
          {t("moderation.audit.by", { who: name(action.actorPubkey), time: timestamp(action.createdAt) })}
        </span>
      </div>
      {action.publicReason ? (
        <p className="text-xs text-muted-foreground/70" data-settings-subcopy>{action.publicReason}</p>
      ) : null}
    </div>
  );
}

function AuditTab({ name }: { name: (pubkey: string) => string }) {
  const t = useT();
  const reasonText = useReasonText();
  const auditQuery = useModerationAuditQuery();
  const actions = auditQuery.data?.items ?? EMPTY_ACTIONS;
  if (auditQuery.error) {
    const error = auditQuery.error;
    return (
      <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
        {error instanceof BffError && error.reason ? reasonText(error.reason) : t("platform.loadFailed")}
      </p>
    );
  }
  if (auditQuery.isLoading) return <p className="text-sm text-muted-foreground">{t("moderation.audit.loading")}</p>;
  if (actions.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border/70 bg-background/40 px-3 py-6 text-center text-sm text-muted-foreground">
        {t("moderation.audit.empty")}
      </p>
    );
  }
  return <div className="space-y-2">{actions.map((action) => <AuditRow action={action} key={action.id} name={name} />)}</div>;
}

export function ModerationQueueCard() {
  const t = useT();
  const access = useModerationAccessQuery();
  const isModerator = access.data?.canModerate === true;
  const name = useDirectoryNames(isModerator);
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="settings-moderation">
      <SettingsSectionHeader title={t("moderation.settings.title")} description={t("moderation.settings.description")} />
      {!isModerator ? (
        access.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("moderation.settings.checking")}</p>
        ) : (
          <p className="rounded-lg border border-dashed border-border/70 bg-background/40 px-3 py-6 text-center text-sm text-muted-foreground">
            {t("moderation.settings.moderatorsOnly")}
          </p>
        )
      ) : (
        <Tabs defaultValue="queue">
          <TabsList>
            <TabsTrigger data-testid="moderation-tab-queue" value="queue">{t("moderation.tab.queue")}</TabsTrigger>
            <TabsTrigger data-testid="moderation-tab-audit" value="audit">{t("moderation.tab.audit")}</TabsTrigger>
          </TabsList>
          <TabsContent value="queue"><QueueTab name={name} /></TabsContent>
          <TabsContent value="audit"><AuditTab name={name} /></TabsContent>
        </Tabs>
      )}
    </section>
  );
}
