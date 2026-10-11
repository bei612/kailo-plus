// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/home/ui/InboxListPane.tsx.
import { Bell } from "lucide-react";
import { useUiT } from "../../context";
import { cn } from "../../profile/buzz/shared/lib/cn";
import { MESSAGE_MARKDOWN_CLASS, MENTION_CHIP_BASE_CLASSES } from "../../composer/shared/ui/mentionChip";
import type { InboxTypeLabel } from "../../../inbox";
import type { Reminder } from "../lib/reminderTypes";
import type { ReminderSource } from "../host";

function InboxLabel({
  isDone,
  isActionRequired,
  label,
}: {
  isDone: boolean;
  isActionRequired: boolean;
  label: InboxTypeLabel;
}) {
  return (
    <div
      className={cn(
        MESSAGE_MARKDOWN_CLASS,
        "mt-0 flex min-h-[var(--inline-chip-min-height)] min-w-0 items-center gap-1.5 text-2xs leading-3 group-hover/inbox-item:pr-[6.75rem] group-focus-within/inbox-item:pr-[6.75rem]",
        isActionRequired && !isDone
          ? "font-medium text-amber-600/80 dark:text-amber-300/80"
          : isDone
            ? "font-normal text-muted-foreground/70"
            : "font-medium text-muted-foreground/80",
      )}
      data-inbox-type-label=""
    >
      <span className="shrink-0">{label.text}</span>
      {label.channelLabel ? (
        <span
          className={cn(
            MENTION_CHIP_BASE_CLASSES,
            "inbox-channel-chip min-w-0 max-w-full overflow-hidden",
          )}
          data-channel-link=""
        >
          <span className="truncate">#{label.channelLabel}</span>
        </span>
      ) : null}
    </div>
  );
}

function PersonalItemRow({
  id,
  location,
  onClick,
  preview,
  selected,
  status,
}: {
  id: string;
  location: InboxTypeLabel | null;
  onClick: () => void;
  preview: string;
  selected: boolean;
  status: string;
}) {
  const t = useUiT();
  return (
    <button
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-3 border-b border-border/45 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-hidden",
        selected && "bg-muted/40",
      )}
      data-testid={`home-all-reminders-${id}`}
      onClick={onClick}
      type="button"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Bell className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">
          {t("reminders.title")}
        </span>
        {location ? (
          <InboxLabel
            isActionRequired={false}
            isDone={false}
            label={location}
          />
        ) : null}
        <span className="block truncate text-sm text-muted-foreground">
          {preview}
        </span>
      </span>
      <span className="shrink-0 text-xs font-medium text-muted-foreground">
        {status}
      </span>
    </button>
  );
}


export function ReminderInboxRow({reminder,source,selected,onSelect}:{reminder:Reminder;source?:ReminderSource;selected:boolean;onSelect:()=>void}) {
  const t=useUiT();
  return <PersonalItemRow id={reminder.id} selected={selected} onClick={onSelect}
    location={source?.channel ? source.channel.channelType==="dm" ? {text:t("reminders.inDm",{name:source.channelLabel}),channelLabel:null} : {text:t("reminders.in"),channelLabel:source.channelLabel} : null}
    preview={reminder.content.target?.preview||reminder.content.note||t("reminders.title")} status={t("reminders.due")} />;
}
