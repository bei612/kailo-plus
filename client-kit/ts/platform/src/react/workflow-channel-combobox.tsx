// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/workflows/ui/ChannelCombobox.tsx.
// Original control; only its authorized directory and translations are adapted.
import {
  Asterisk,
  Check,
  ChevronDown,
  Hash,
  Lock,
  Search,
} from "lucide-react";
import * as React from "react";

import { WorkspaceVisibility, type WorkspaceView } from "@client-kit/contracts";
import { useT } from "./context";
import { cn } from "./profile/buzz/shared/lib/cn";
import { Popover, PopoverContent, PopoverTrigger } from "./conversations/popover";
import { PortalledScrollArea } from "./profile/buzz/shared/ui/portalled-scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "./sidebar/tooltip";

function ChannelPrivacyIcon({ channel }: { channel: WorkspaceView }) {
  const Icon = channel.visibility === WorkspaceVisibility.Private ? Lock
    : channel.visibility === WorkspaceVisibility.Open ? Hash : null;
  // Missing product visibility is unknown, not permission to label it public.
  if (!Icon) return null;

  return (
    <Icon aria-hidden className="h-5 w-5 shrink-0 text-muted-foreground/60" />
  );
}

type ChannelComboboxProps = {
  allowEmpty?: boolean;
  ariaLabel?: string;
  channels: WorkspaceView[];
  defaultOpen?: boolean;
  disabled?: boolean;
  emptyLabel?: string;
  id?: string;
  isChannelDisabled?: (channel: WorkspaceView) => boolean;
  onAutoOpen?: () => void;
  onChange: (value: string) => void;
  readOnly?: boolean;
  readOnlyTooltip?: string;
  required?: boolean;
  variant?: "header" | "field";
  value: string;
};

export function ChannelCombobox({
  allowEmpty = false,
  ariaLabel: label,
  channels,
  defaultOpen = false,
  disabled,
  emptyLabel: empty,
  id,
  isChannelDisabled,
  onAutoOpen,
  onChange,
  readOnly = false,
  readOnlyTooltip: readOnlyHint,
  required = false,
  variant = "header",
  value,
}: ChannelComboboxProps) {
  const t = useT();
  const ariaLabel = label ?? t("workflows.channel.label");
  const emptyLabel = empty ?? t("workflows.channel.choose");
  const readOnlyTooltip = readOnlyHint ?? t("workflows.channel.readOnlyHint");
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [highlightedIndex, setHighlightedIndex] = React.useState(0);
  const autoOpenHandledRef = React.useRef(false);

  React.useEffect(() => {
    if (!defaultOpen || autoOpenHandledRef.current) return;

    // Let the pointer interaction that mounted the containing dialog finish
    // before installing Radix's outside-interaction listeners.
    const frame = window.requestAnimationFrame(() => {
      autoOpenHandledRef.current = true;
      setOpen(true);
      onAutoOpen?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [defaultOpen, onAutoOpen]);

  const listboxId = `${id ?? "channel"}-listbox`;
  const selected = channels.find((c) => c.id === value);
  // Only authorized WorkspaceView rows are admitted by the existing Automation
  // contract. Private conversations are not workflow scopes in this release.
  const channelLabels = React.useMemo(
    () => new Map(channels.map(channel => [channel.id, channel.name])),
    [channels],
  );

  const filtered = React.useMemo(() => {
    if (!query) return channels;
    const q = query.toLowerCase();
    return channels.filter(
      (c) =>
        (channelLabels.get(c.id) ?? c.name).toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q),
    );
  }, [channelLabels, channels, query]);
  const selectable = React.useMemo(
    () => filtered.filter((channel) => !isChannelDisabled?.(channel)),
    [filtered, isChannelDisabled],
  );
  const highlightedChannel = selectable[highlightedIndex];
  const highlightedOptionId = highlightedChannel
    ? `${listboxId}-option-${highlightedChannel.id}`
    : undefined;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setQuery("");
      setHighlightedIndex(0);
    }
  }

  function selectChannel(channelId: string) {
    onChange(channelId);
    handleOpenChange(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (selectable.length === 0) return;

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        setHighlightedIndex((i) => (i + 1) % selectable.length);
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        setHighlightedIndex(
          (i) => (i - 1 + selectable.length) % selectable.length,
        );
        break;
      }
      case "Enter": {
        e.preventDefault();
        const target = selectable[highlightedIndex];
        if (target) selectChannel(target.id);
        break;
      }
      case "Escape": {
        e.preventDefault();
        handleOpenChange(false);
        break;
      }
    }
  }

  const selectedLabel = selected
    ? (channelLabels.get(selected.id) ?? selected.name)
    : value
      ? t("workflows.channel.unavailable")
      : emptyLabel;

  if (readOnly) {
    return (
      <TooltipProvider><Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-disabled="true"
            aria-label={t("workflows.channel.readOnlyLabel", {label: ariaLabel, channel: selectedLabel})}
            className={cn(
              "flex w-full cursor-default items-center rounded-lg px-3 py-2 text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
              variant === "header" &&
                "justify-center border-0 bg-transparent text-lg font-semibold",
              variant === "field" && "text-sm font-normal",
            )}
            id={id}
            type="button"
          >
            <span className="flex min-w-0 items-center gap-2">
              {selected ? <ChannelPrivacyIcon channel={selected} /> : null}
              <span className="truncate">{selectedLabel}</span>
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{readOnlyTooltip}</TooltipContent>
      </Tooltip></TooltipProvider>
    );
  }

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-controls={listboxId}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          aria-required={required}
          className={cn(
            "group flex w-full items-center rounded-lg px-3 py-2 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            variant === "header" &&
              "justify-center border-0 bg-transparent text-lg font-semibold",
            variant === "field" &&
              "justify-between border border-input/40 bg-background text-sm font-normal",
            !selected && "text-muted-foreground",
          )}
          disabled={disabled}
          id={id}
          role="combobox"
          type="button"
        >
          <span
            className={cn(
              "flex min-w-0 items-center gap-2",
              variant === "header" && "justify-center",
            )}
          >
            {selected ? (
              <ChannelPrivacyIcon channel={selected} />
            ) : required && !value ? (
              <Asterisk aria-hidden className="h-5 w-5 shrink-0 text-primary" />
            ) : null}
            <span className="truncate">{selectedLabel}</span>
          </span>
          <ChevronDown className="ml-1 h-5 w-5 shrink-0 text-muted-foreground opacity-50 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) p-0"
        portalled={variant === "field"}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            aria-activedescendant={highlightedOptionId}
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded={open}
            aria-label={t("workflows.channel.searchLabel", {label: ariaLabel.toLowerCase()})}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            ref={(el) => el?.focus()}
            className="flex-1 bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlightedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t("workflows.channel.searchPlaceholder")}
            role="combobox"
            spellCheck={false}
            value={query}
          />
        </div>
        <PortalledScrollArea
          aria-label={t("workflows.channel.options", {label: ariaLabel})}
          className="max-h-60 overflow-y-auto p-1"
          data-testid="channel-combobox-list"
          id={listboxId}
          role="listbox"
        >
          {allowEmpty && !query ? (
            <button
              aria-selected={!value}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                !value && "bg-accent/50",
              )}
              onClick={() => selectChannel("")}
              role="option"
              type="button"
            >
              <span className="h-5 w-5 shrink-0" />
              <span className="truncate">{emptyLabel}</span>
              <Check
                className={cn(
                  "ml-auto h-4 w-4 shrink-0",
                  !value ? "opacity-100" : "opacity-0",
                )}
              />
            </button>
          ) : null}
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              {t("workflows.channel.none")}
            </p>
          ) : (
            filtered.map((channel) => {
              const optionDisabled = isChannelDisabled?.(channel) ?? false;
              return (
                <button
                  aria-selected={channel.id === value}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-foreground",
                    channel.id === value && "bg-accent/50",
                    channel.id === selectable[highlightedIndex]?.id &&
                      !optionDisabled &&
                      "bg-accent text-accent-foreground",
                  )}
                  disabled={optionDisabled}
                  id={`${listboxId}-option-${channel.id}`}
                  key={channel.id}
                  onClick={() => selectChannel(channel.id)}
                  role="option"
                  type="button"
                >
                  <ChannelPrivacyIcon channel={channel} />
                  <span className="truncate">
                    {channelLabels.get(channel.id) ?? channel.name}
                  </span>
                  <Check
                    className={cn(
                      "ml-auto h-4 w-4 shrink-0",
                      channel.id === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                </button>
              );
            })
          )}
        </PortalledScrollArea>
      </PopoverContent>
    </Popover>
  );
}
