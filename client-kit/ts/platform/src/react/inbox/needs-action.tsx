// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/home:
// ui/InboxFilterMenu.tsx ("Needs action"), lib/inbox.ts (needs_action category,
// isActionRequired, "Needs action" label), ui/InboxListPane.tsx (action-required
// label tone, empty copy) and useFeedItemState.ts (the per-device "done" set).
//
// DD-125(5): the original source, Buzz workflow approvals 46010–46012, is closed
// (DD-106). Kailo's Needs action reads the Temporal ApprovalProjection through the
// BFF: approvals waiting on my decision and approvals I initiated that reached a
// result. Deciding uses the existing approval decision; "done" stays local, as in
// the original. This module holds no approval state of its own.
import { ProjectChannelRequestDetails } from "../projects/ProjectChannelRequestDialog";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MailOpen, ShieldCheck } from "lucide-react";
import { ApprovalStatus, type ApprovalView } from "@client-kit/contracts";
import type { BffClient } from "../../client";
import { approvalOpen } from "../../governance";
import { approvalStatusMessages, enumLabel, platformMessages, type PlatformMessageKey } from "../../i18n";
import { useLocale, useUiT } from "../context";
import { ApprovalPanel } from "../governance";
import { formatItemTimestamp } from "../messages/datetime";
import { InboxDetailHeader, InboxRowActionButton } from "../inbox-surface";
import { InboxRow } from "../inbox-row";

export type NeedsActionItem = {
  /** Stable per approval and phase, so a later result is a new item. */
  key: string;
  workflowId: string;
  /** `approver`: waiting on my decision; `initiator`: my request has a result. */
  role: "approver" | "initiator";
  approval: ApprovalView;
  /** Latest decision time in Unix seconds, or null when the projection has none. */
  at: number | null;
};

export type NeedsActionSource = {
  items: readonly NeedsActionItem[];
  status: "loading" | "ready" | "unavailable";
  isDone: (item: NeedsActionItem) => boolean;
  setDone: (item: NeedsActionItem, done: boolean) => void;
  refresh: () => void;
};

const DONE_STORAGE_KEY = "kailo-inbox-needs-action-done.v1";
/** Original seen/done sets are bounded; keep the newest marks. */
const DONE_LIMIT = 500;

function latestDecision(approval: ApprovalView): number | null {
  const times = (approval.decisions ?? []).map((decision) => Date.parse(decision.decidedAt)).filter(Number.isFinite);
  if (times.length > 0) return Math.floor(Math.max(...times) / 1000);
  if (approval.status === ApprovalStatus.Expired) {
    const expired = Date.parse(approval.expiresAt);
    return Number.isFinite(expired) ? Math.floor(expired / 1000) : null;
  }
  return null;
}

/** Pending-for-me first in Core order, then my requests' results, newest first. */
export function needsActionItems(pending: readonly ApprovalView[], initiated: readonly ApprovalView[]): NeedsActionItem[] {
  const items: NeedsActionItem[] = [];
  const seen = new Set<string>();
  for (const approval of pending) {
    if (!approvalOpen(approval.status) || seen.has(approval.workflowId)) continue;
    seen.add(approval.workflowId);
    items.push({ key: `approval:${approval.workflowId}:decide`, workflowId: approval.workflowId, role: "approver", approval, at: latestDecision(approval) });
  }
  for (const approval of initiated) {
    if (approvalOpen(approval.status) || seen.has(approval.workflowId)) continue;
    seen.add(approval.workflowId);
    items.push({ key: `approval:${approval.workflowId}:${approval.status}`, workflowId: approval.workflowId, role: "initiator", approval, at: latestDecision(approval) });
  }
  return items;
}

/** Sort position among Inbox rows: open requests stay on top, results by their time. */
export function needsActionSortAt(item: NeedsActionItem): number {
  return item.role === "approver" ? Number.POSITIVE_INFINITY : (item.at ?? 0);
}

function readDone(storageKey: string): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Host adapter: `scopeKey` must be the trusted platform identity (the tenant
 * Principal), so a "done" mark never crosses people sharing a browser.
 */
export function useNeedsActionSource({ client, scopeKey, enabled = true }: {
  client: Pick<BffClient, "pendingApprovals" | "initiatedApprovals">;
  scopeKey: string;
  enabled?: boolean;
}): NeedsActionSource {
  const queryClient = useQueryClient();
  const queryKey = React.useMemo(() => ["platform", "inbox-needs-action", scopeKey] as const, [scopeKey]);
  const query = useQuery({
    queryKey,
    enabled,
    queryFn: async () => {
      const [pending, initiated] = await Promise.all([client.pendingApprovals(), client.initiatedApprovals()]);
      if (!Array.isArray(pending) || !Array.isArray(initiated)) throw new Error("Invalid approval page");
      return needsActionItems(pending, initiated);
    },
  });
  const storageKey = `${DONE_STORAGE_KEY}:${scopeKey}`;
  const [done, setDoneKeys] = React.useState<string[]>(() => readDone(storageKey));
  React.useEffect(() => { setDoneKeys(readDone(storageKey)); }, [storageKey]);
  const doneSet = React.useMemo(() => new Set(done), [done]);
  const setDone = React.useCallback((item: NeedsActionItem, value: boolean) => {
    setDoneKeys((previous) => {
      const next = value ? [...previous.filter((key) => key !== item.key), item.key].slice(-DONE_LIMIT) : previous.filter((key) => key !== item.key);
      try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Storage unavailable: the mark stays for this page only. */ }
      return next;
    });
  }, [storageKey]);
  const isDone = React.useCallback((item: NeedsActionItem) => doneSet.has(item.key), [doneSet]);
  const refresh = React.useCallback(() => { void queryClient.invalidateQueries({ queryKey }); }, [queryClient, queryKey]);
  return React.useMemo<NeedsActionSource>(() => ({
    items: query.data ?? [],
    status: query.isError ? "unavailable" : query.isSuccess ? "ready" : "loading",
    isDone, setDone, refresh,
  }), [query.data, query.isError, query.isSuccess, isDone, setDone, refresh]);
}

/** The governed action's catalog label, encoded exactly as the shared ActionLabel does. */
export function useApprovalActionLabel() {
  const t = useUiT();
  return React.useCallback((actionKey: string) => {
    const key = `actions.${actionKey.replaceAll("_", "-")}`;
    return key.slice("actions.".length).replaceAll("-", "_") === actionKey && Object.hasOwn(platformMessages, key)
      ? t(key as PlatformMessageKey)
      : actionKey.startsWith("task.cancel.") ? t("tasks.cancelRequest")
      : actionKey.startsWith("task.rerun.") ? t("tasks.rerunRequest") : t("actions.unknown");
  }, [t]);
}

export function NeedsActionInboxRow({ item, selected, done, onSelect, onToggleDone }: {
  item: NeedsActionItem; selected: boolean; done: boolean;
  onSelect: () => void; onToggleDone: () => void;
}) {
  const t = useUiT();
  const locale = useLocale();
  const actionLabel = useApprovalActionLabel()(item.approval.actionKey);
  const preview = item.role === "approver"
    ? t("inbox.previewApproval")
    : t("inbox.approvalResult", { status: enumLabel(locale, approvalStatusMessages, item.approval.status) });
  return <InboxRow id={item.key} selected={selected} read={done} actionRequired
    sender={<span className="block max-w-full truncate rounded text-sm font-semibold leading-4 text-foreground">{actionLabel}</span>}
    avatar={<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[28%] bg-muted text-muted-foreground"><ShieldCheck className="h-4 w-4" /></span>}
    timestamp={item.at === null ? "" : formatItemTimestamp(item.at)}
    label={t("inbox.needsActionLabel")} channel={null}
    openLabel={t("inbox.openItem", { sender: actionLabel })}
    onSelect={onSelect}
    preview={<span className="line-clamp-2">{preview}</span>}
    actions={<InboxRowActionButton label={t(done ? "inbox.markUnread" : "inbox.markRead")} onClick={onToggleDone}><MailOpen className="h-4 w-4" /></InboxRowActionButton>} />;
}

/** Detail: the existing approval facts and decision controls (05 §2, DD-47). */
export function NeedsActionDetailPane({ item, onBack, onChanged }: {
  item: NeedsActionItem | null; onBack?: () => void; onChanged: () => void;
}) {
  const t = useUiT();
  const actionLabel = useApprovalActionLabel();
  if (!item) return null;
  return <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background/60" data-testid="home-inbox-needs-action-detail">
    <InboxDetailHeader key={item.key} title={actionLabel(item.approval.actionKey)} onBack={onBack} openLabel={t("inbox.open")} />
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-2">
      {/* DD-140: the frozen project channel request this approval decides (original dialog details). */}
      {item.approval.projectChannelRequest ? <div className="mb-4"><ProjectChannelRequestDetails request={item.approval.projectChannelRequest.request} /></div> : null}
      <ApprovalPanel key={item.key} workflowId={item.workflowId} role={item.role} onChanged={onChanged} />
    </div>
  </section>;
}
