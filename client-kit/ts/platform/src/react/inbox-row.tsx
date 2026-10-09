import type { CSSProperties, ReactNode } from "react";
import { MESSAGE_MARKDOWN_CLASS, MENTION_CHIP_BASE_CLASSES } from "./composer/shared/ui/mentionChip";

/** The Buzz Home row, with host-owned profile/Markdown/actions supplied as slots. */
export function InboxRow({
  id,
  selected,
  read,
  sender,
  avatar,
  timestamp,
  unread,
  label,
  channel,
  preview,
  actions,
  openLabel,
  onSelect,
}: {
  id: string;
  selected: boolean;
  read: boolean;
  sender: ReactNode;
  avatar?: ReactNode;
  timestamp: string;
  unread?: ReactNode;
  label: string;
  channel: string | null;
  preview: ReactNode;
  actions: ReactNode;
  openLabel: string;
  onSelect: () => void;
}) {
  const highlight = selected
    ? "color-mix(in srgb, hsl(var(--background)) 70%, hsl(var(--muted)) 30%)"
    : "color-mix(in srgb, hsl(var(--background)) 75%, hsl(var(--muted)) 25%)";
  return (
    <div
      aria-current={selected ? "true" : undefined}
      className="group/inbox-item relative"
      data-testid={`home-inbox-item-${id}`}
      style={{ "--inbox-row-highlight-bg": highlight } as CSSProperties}
    >
      <button
        aria-label={openLabel}
        className="absolute inset-0 z-0 block w-full border-l border-l-transparent text-left"
        onClick={onSelect}
        type="button"
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 left-0 right-0 transition-colors ${
            selected
              ? "bg-[var(--inbox-row-highlight-bg)]"
              : "group-hover/inbox-item:bg-[var(--inbox-row-highlight-bg)] group-focus-within/inbox-item:bg-[var(--inbox-row-highlight-bg)] group-active/inbox-item:bg-muted/40"
          }`}
        />
      </button>
      {/* biome-ignore lint/a11y: A sibling full-row button supplies keyboard activation; slots may contain profile controls. */}
      <div
        className="relative z-10 block w-full cursor-pointer px-3 py-4 text-left"
        onClick={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest("[data-inbox-profile-trigger]")
          )
            return;
          onSelect();
        }}
      >
        <div className="flex min-w-0 items-start gap-2.5">
          {avatar ? (
            <div
              className="relative shrink-0"
              data-inbox-profile-trigger="true"
            >
              {avatar}
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-start gap-2">
              <span
                className="flex min-w-0 flex-1 items-start leading-4"
                data-inbox-profile-trigger="true"
              >
                {sender}
              </span>
              <span
                className={`flex shrink-0 items-center gap-1.5 text-xs leading-4 text-muted-foreground/70 transition-opacity group-hover/inbox-item:opacity-0 group-focus-within/inbox-item:opacity-0 ${read ? "font-normal" : "font-medium"}`}
              >
                {!read ? (
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full bg-primary"
                  />
                ) : null}
                {unread != null ? (
                  <span data-testid="home-inbox-unread-count">{unread}</span>
                ) : null}
                {timestamp}
              </span>
            </div>
            <div
              className={`${MESSAGE_MARKDOWN_CLASS} mt-0 flex min-h-[var(--inline-chip-min-height)] min-w-0 items-center gap-1.5 text-2xs leading-3 group-hover/inbox-item:pr-[6.75rem] group-focus-within/inbox-item:pr-[6.75rem] ${read ? "font-normal text-muted-foreground/70" : "font-medium text-muted-foreground/80"}`}
              data-inbox-type-label=""
            >
              <span className="shrink-0">{label}</span>
              {channel ? (
                <span
                  className={`${MENTION_CHIP_BASE_CLASSES} inbox-channel-chip min-w-0 max-w-full overflow-hidden`}
                  data-channel-link=""
                >
                  <span className="truncate">#{channel}</span>
                </span>
              ) : null}
            </div>
            <div
              className={`mt-1.5 text-message [&_a]:font-medium [&_a]:text-current ${read ? "font-normal text-muted-foreground" : "font-semibold text-foreground"}`}
            >
              {preview}
            </div>
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute right-3 top-2 z-10 flex items-center gap-0.5 rounded-full bg-[var(--inbox-row-highlight-bg)] p-1 opacity-0 transition-opacity duration-150 ease-out group-hover/inbox-item:pointer-events-auto group-hover/inbox-item:opacity-100 group-focus-within/inbox-item:pointer-events-auto group-focus-within/inbox-item:opacity-100">
        {actions}
      </div>
    </div>
  );
}
