import { useUiT, type Translate } from "../../context";
import { isOutcomeUnknown } from "../../../transport";
import { ArrowLeft, Bell, Check, Clock, ExternalLink, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { useQuery } from "@tanstack/react-query";
import { useRemindersQuery, useReminderMutations } from "../hooks";
import { groupReminders } from "../lib/reminderFilters";
import type { Reminder, ReminderTarget } from "../lib/reminderTypes";
import { useReminderHost, type ReminderSource } from "../host";
import { SnoozeMenu } from "./SnoozeMenu";
import { TopChromeInsetHeader } from "../../messages/TopChromeInsetHeader";
import { cn } from "../../profile/buzz/shared/lib/cn";
import { Button } from "../../profile/buzz/shared/ui/button";
import { UserAvatar } from "../../messages/UserAvatar";

export function hasNavigableTarget(target:ReminderTarget|undefined):target is ReminderTarget {
  return target!==undefined&&target.channelId!==""&&target.eventId!==""&&target.authorPubkey!=="";
}
export function useReminderSources(reminders:readonly Reminder[]) {
  const host=useReminderHost();
  const targets=reminders.filter(r=>hasNavigableTarget(r.content.target));
  const query=useQuery({queryKey:["reminders",host.scopeKey,host.pubkey,"sources",targets.map(r=>r.eventId)],
    enabled:targets.length>0,retry:false,
    queryFn:async()=>new Map(await Promise.all(targets.map(async r=>[r.id,await host.source(r.content.target!)] as const)))});
  return query.data??new Map<string,ReminderSource>();
}

function formatRelativeTime(timestamp: number, t: Translate): string {
  const now = Math.floor(Date.now() / 1_000);
  const diff = timestamp - now;

  if (diff < 0) {
    const absDiff = Math.abs(diff);
    if (absDiff < 60) return t("reminders.justNow");
    if (absDiff < 3600) return t("reminders.overdueMinutes", { count: Math.floor(absDiff / 60) });
    if (absDiff < 86400) return t("reminders.overdueHours", { count: Math.floor(absDiff / 3600) });
    return t("reminders.overdueDays", { count: Math.floor(absDiff / 86400) });
  }

  if (diff < 60) return t("reminders.lessMinute");
  if (diff < 3600) return t("reminders.inMinutes", { count: Math.floor(diff / 60) });
  if (diff < 86400) return t("reminders.inHours", { count: Math.floor(diff / 3600) });
  return t("reminders.inDays", { count: Math.floor(diff / 86400) });
}

function formatReminderSourceLocation(source: ReminderSource, t: Translate): string {
  if (!source.channel) return source.channelLabel;
  return source.channel.channelType === "dm"
    ? t("reminders.dm", { name: source.channelLabel })
    : `#${source.channelLabel}`;
}

function ReminderRow({
  isSelected = false,
  presentation = "card",
  reminder,
  pubkey,
  source,
  onNavigate,
  onSelect,
}: {
  isSelected?: boolean;
  presentation?: "inbox-list" | "card";
  reminder: Reminder;
  pubkey: string;
  source: ReminderSource | null;
  onNavigate: (reminder: Reminder) => void;
  onSelect?: (reminder: Reminder) => void;
}) {
  const t = useUiT();
  const { complete, snooze, cancel } = useReminderMutations(pubkey);
  const isDone = reminder.content.status === "done";
  const isActing = complete.isPending || snooze.isPending || cancel.isPending;
  const isNavigable = hasNavigableTarget(reminder.content.target);

  const handleComplete = () => {
    complete.mutate(reminder, {
      onSuccess: () => toast.success(t("reminders.completed")),
      onError: (error) => toast.error(t(isOutcomeUnknown(error) ? "native.status.outcomeUnknown" : "reminders.completeFailed")),
    });
  };

  const handleSnooze = (notBefore: number) => {
    snooze.mutate(
      { reminder, notBefore },
      {
        onSuccess: () => toast.success(t("reminders.snoozed")),
        onError: (error) => toast.error(t(isOutcomeUnknown(error) ? "native.status.outcomeUnknown" : "reminders.snoozeFailed")),
      },
    );
  };

  const handleCancel = () => {
    cancel.mutate(reminder, {
      onSuccess: () => toast.success(t("reminders.cancelled")),
      onError: (error) => toast.error(t(isOutcomeUnknown(error) ? "native.status.outcomeUnknown" : "reminders.cancelFailed")),
    });
  };

  const isOverdue =
    !isDone && reminder.notBefore
      ? reminder.notBefore <= Math.floor(Date.now() / 1_000)
      : false;
  const isInboxList = presentation === "inbox-list";

  return (
    <div
      className={cn(
        "flex items-start gap-3 transition-colors",
        isInboxList
          ? "border-b border-border/45 px-4 py-4 hover:bg-muted/40 focus-within:bg-muted/40"
          : "rounded-md border p-3",
        isInboxList && isSelected && "bg-muted/40",
      )}
      data-testid={`home-reminder-item-${reminder.id}`}
    >
      {isInboxList ? (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Bell className="h-4 w-4" />
        </span>
      ) : null}
      <button
        className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left enabled:hover:opacity-80 disabled:cursor-default"
        disabled={!isInboxList && !isNavigable}
        onClick={() => {
          if (isInboxList) onSelect?.(reminder);
          else if (isNavigable) onNavigate(reminder);
        }}
        type="button"
      >
        {source ? (
          <div className="flex min-w-0 max-w-full items-center gap-1.5 text-xs text-muted-foreground">
            <UserAvatar
              avatarUrl={source.avatarUrl}
              className="h-4 w-4 shrink-0"
              displayName={source.authorLabel}
              shape={source.isAgent ? "squircle" : "circle"}
              size="xs"
            />
            <span className="truncate font-medium text-foreground">
              {source.authorLabel}
            </span>
            <span className="shrink-0">{t("reminders.in")}</span>
            <span className="truncate">
              {formatReminderSourceLocation(source, t)}
            </span>
          </div>
        ) : null}
        <p className="max-w-full truncate text-sm font-medium">
          {reminder.content.target?.preview ||
            reminder.content.note ||
            t("reminders.title")}
        </p>
        {reminder.content.target && reminder.content.note ? (
          <p className="max-w-full truncate text-xs text-muted-foreground">
            {reminder.content.note}
          </p>
        ) : null}
        {reminder.notBefore ? (
          <p
            className={`text-xs ${isOverdue ? "font-medium text-destructive" : "text-muted-foreground"}`}
          >
            <Clock className="mr-1 inline h-3 w-3" />
            {formatRelativeTime(reminder.notBefore, t)}
          </p>
        ) : null}
      </button>
      {isDone || isInboxList ? null : (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            className="h-7 w-7 p-0"
            disabled={isActing}
            onClick={handleComplete}
            size="sm"
            title={t("reminders.complete")}
            type="button"
            variant="ghost"
          >
            <Check className="h-4 w-4" />
          </Button>
          <SnoozeMenu disabled={isActing} onSnooze={handleSnooze} />
          <Button
            className="h-7 w-7 p-0"
            disabled={isActing}
            onClick={handleCancel}
            size="sm"
            title={t("reminders.cancel")}
            type="button"
            variant="ghost"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Renders a user's reminders as grouped rows. `includeDone` adds a Completed
 * group (used by the inbox Reminders view); omit it for pending-only surfaces.
 */
export function RemindersPanel({
  pubkey,
  includeDone = false,
  onSelectReminder,
  presentation = "card",
  selectedReminderId,
}: {
  pubkey: string;
  includeDone?: boolean;
  onSelectReminder?: (reminderId: string) => void;
  presentation?: "inbox-list" | "card";
  selectedReminderId?: string | null;
}) {
  const remindersQuery = useRemindersQuery(pubkey);
  const reminders = remindersQuery.data;
  const host = useReminderHost();
  const t = useUiT();
  const sources = useReminderSources(reminders ?? []);

  const handleNavigate = React.useCallback(
    async (reminder: Reminder) => {
      try { if (hasNavigableTarget(reminder.content.target)) await host.navigate(reminder.content.target); }
      catch { toast.error(t("platform.loadFailed")); }
    },
    [host, t],
  );

  const groups = React.useMemo(
    () => groupReminders(reminders ?? [], includeDone),
    [reminders, includeDone],
  );
  const inboxReminders = React.useMemo(
    () => groups.flatMap((group) => group.reminders),
    [groups],
  );

  if (remindersQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">{t("reminders.loading")}</p>
      </div>
    );
  }

  if (remindersQuery.isError) return <div role="status" className="p-8 text-sm text-muted-foreground">{t("platform.loadFailed")}</div>;

  if (groups.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8">
        <Bell className="h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">{t("reminders.empty")}</p>
        <p className="text-xs text-muted-foreground/70">
          {t("reminders.emptyHint")}
        </p>
      </div>
    );
  }

  if (presentation === "inbox-list") {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        {inboxReminders.map((reminder) => (
          <ReminderRow
            isSelected={reminder.id === selectedReminderId}
            key={reminder.id}
            onNavigate={handleNavigate}
            onSelect={(selected) => onSelectReminder?.(selected.id)}
            presentation="inbox-list"
            pubkey={pubkey}
            reminder={reminder}
            source={sources.get(reminder.id) ?? null}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-4 overflow-y-auto p-4">
      {groups.map((group) => (
        <div key={group.label} className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t(`reminders.group${group.label}`)}
          </h3>
          {group.reminders.map((r) => (
            <ReminderRow
              key={r.id}
              onNavigate={handleNavigate}
              pubkey={pubkey}
              reminder={r}
              source={sources.get(r.id) ?? null}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ReminderDetailPane({
  onBack,
  pubkey,
  reminder,
}: {
  onBack?: () => void;
  pubkey: string;
  reminder: Reminder | null;
}) {
  const host = useReminderHost();
  const t = useUiT();
  const reminderList = React.useMemo(
    () => (reminder ? [reminder] : []),
    [reminder],
  );
  const sources = useReminderSources(reminderList);
  const { complete, snooze, cancel } = useReminderMutations(pubkey);

  if (!reminder) {
    return (
      <section className="flex min-h-0 min-w-0 flex-col bg-background">
        <TopChromeInsetHeader flush>
          <div className="flex min-h-9 items-center px-4 py-2">
            <span className="text-sm font-semibold">{t("reminders.title")}</span>
          </div>
        </TopChromeInsetHeader>
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
          {t("reminders.select")}
        </div>
      </section>
    );
  }

  const source = sources.get(reminder.id) ?? null;
  const isDone = reminder.content.status === "done";
  const isActing = complete.isPending || snooze.isPending || cancel.isPending;
  const isNavigable = hasNavigableTarget(reminder.content.target);
  const preview =
    reminder.content.target?.preview || reminder.content.note || t("reminders.title");

  const handleNavigate = async () => {
    try { if (hasNavigableTarget(reminder.content.target)) await host.navigate(reminder.content.target); }
      catch { toast.error(t("platform.loadFailed")); }
  };

  return (
    <section
      className="flex min-h-0 min-w-0 flex-col bg-background"
      data-testid="home-reminder-detail"
    >
      <TopChromeInsetHeader flush>
        <div className="flex min-h-9 items-center gap-2 px-4 py-2">
          {onBack ? (
            <Button
              aria-label={t("reminders.back")}
              className="h-8 w-8 p-0"
              onClick={onBack}
              size="icon"
              type="button"
              variant="ghost"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          ) : null}
          <span className="text-sm font-semibold">{t("reminders.title")}</span>
        </div>
      </TopChromeInsetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-2xl">
          {source ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <UserAvatar
                avatarUrl={source.avatarUrl}
                className="h-6 w-6"
                displayName={source.authorLabel}
                shape={source.isAgent ? "squircle" : "circle"}
                size="sm"
              />
              <span className="font-medium text-foreground">
                {source.authorLabel}
              </span>
              <span>{t("reminders.in")}</span>
              <span>{formatReminderSourceLocation(source, t)}</span>
            </div>
          ) : null}

          <p className="mt-5 whitespace-pre-wrap text-base leading-6 text-foreground">
            {preview}
          </p>
          {reminder.content.target && reminder.content.note ? (
            <div className="mt-5 border-l-2 border-border pl-4">
              <p className="text-xs font-medium uppercase text-muted-foreground">
                {t("reminders.note")}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                {reminder.content.note}
              </p>
            </div>
          ) : null}

          {reminder.notBefore ? (
            <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>{formatRelativeTime(reminder.notBefore, t)}</span>
            </div>
          ) : null}

          <div className="mt-8 flex flex-wrap items-center gap-2">
            <Button
              disabled={!isNavigable}
              onClick={() => void handleNavigate()}
              size="sm"
              type="button"
              variant="outline"
            >
              <ExternalLink className="h-4 w-4" />
              {t("reminders.open")}
            </Button>
            {isDone ? null : (
              <>
                <Button
                  disabled={isActing}
                  onClick={() =>
                    complete.mutate(reminder, {
                      onSuccess: () => toast.success(t("reminders.completed")),
                      onError: (error) => toast.error(t(isOutcomeUnknown(error) ? "native.status.outcomeUnknown" : "reminders.completeFailed")),
                    })
                  }
                  size="sm"
                  type="button"
                >
                  <Check className="h-4 w-4" />
                  {t("reminders.complete")}
                </Button>
                <SnoozeMenu
                  disabled={isActing}
                  onSnooze={(notBefore) =>
                    snooze.mutate(
                      { reminder, notBefore },
                      {
                        onSuccess: () => toast.success(t("reminders.snoozed")),
                        onError: (error) => toast.error(t(isOutcomeUnknown(error) ? "native.status.outcomeUnknown" : "reminders.snoozeFailed")),
                      },
                    )
                  }
                />
                <Button
                  disabled={isActing}
                  onClick={() =>
                    cancel.mutate(reminder, {
                      onSuccess: () => toast.success(t("reminders.cancelled")),
                      onError: (error) => toast.error(t(isOutcomeUnknown(error) ? "native.status.outcomeUnknown" : "reminders.cancelFailed")),
                    })
                  }
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <X className="h-4 w-4" />
                  {t("reminders.cancel")}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
