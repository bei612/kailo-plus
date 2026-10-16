// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/user-status/ui/SetStatusDialog.tsx. Copy resolves through the shared
// catalog; the shared package has no Calendar primitive, so the custom expiry date uses the
// native date input as the restored reminders dialog does, keeping the original half-hour menu.
// DD-120 (4): the contract's empty text clears a status, so saving requires text.
import * as React from "react";
import {
  CalendarClock,
  Check,
  ChevronDown,
  Clock3,
  SmilePlus,
} from "lucide-react";

import type { PlatformMessageKey } from "../../../i18n";
import { useUiLocale, useUiT } from "../../context";
import { EmojiPicker } from "../../custom-emoji/EmojiPicker";
import { usePresenceHost } from "../../presence/context";
import { cn } from "../../profile/buzz/shared/lib/cn";
import { Button } from "../../profile/buzz/shared/ui/button";
import { ChooserDialogContent } from "../../composer/shared/ui/chooser-dialog-content";
import { Dialog } from "../../composer/shared/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../sidebar/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "../../conversations/popover";
import type { UserStatusInput } from "../types";
import { DEFAULT_USER_STATUS_EMOJI, StatusEmoji } from "./StatusEmoji";

const PRESETS = [
  { id: "in-a-meeting", label: "userStatus.preset.meeting", emoji: "🗣️" },
  { id: "commuting", label: "userStatus.preset.commuting", emoji: "🚌" },
  { id: "out-sick", label: "userStatus.preset.sick", emoji: "🤒" },
  { id: "vacationing", label: "userStatus.preset.vacation", emoji: "🏖️" },
  { id: "working-remotely", label: "userStatus.preset.remote", emoji: "🏠" },
] as const satisfies ReadonlyArray<{ id: string; label: PlatformMessageKey; emoji: string }>;

const DURATIONS = [
  "1 hour",
  "8 hours",
  "Today",
  "This week",
  "Custom",
] as const;

type DurationLabel = (typeof DURATIONS)[number];

const DURATION_LABEL_KEYS = {
  "1 hour": "userStatus.duration.oneHour",
  "8 hours": "userStatus.duration.eightHours",
  Today: "userStatus.duration.today",
  "This week": "userStatus.duration.thisWeek",
  Custom: "userStatus.duration.custom",
} as const satisfies Record<DurationLabel, PlatformMessageKey>;

const HALF_HOUR_TIMES = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 === 0 ? 0 : 30;
  return {
    hour,
    minute,
    value: `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`,
  };
});

type SetStatusDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialText?: string;
  initialEmoji?: string;
  initialExpiresAt?: number;
  initialUpdatedAt?: number;
  onSave: (status: UserStatusInput) => void;
  onClear: () => void;
  hasExistingStatus: boolean;
};

function roundUpToHalfHour(value: Date) {
  const date = new Date(value);
  date.setSeconds(0, 0);
  date.setMinutes(Math.ceil(date.getMinutes() / 30) * 30);
  return date;
}

function defaultCustomDate() {
  return roundUpToHalfHour(new Date(Date.now() + 24 * 60 * 60 * 1_000));
}

function toLocalTimeValue(date: Date) {
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function toLocalDateValue(date: Date) {
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;
}

function endOfToday(from: Date) {
  const end = new Date(from);
  end.setHours(24, 0, 0, 0);
  return end;
}

function endOfWeek(from: Date) {
  const end = new Date(from);
  const daysUntilMonday = (8 - end.getDay()) % 7 || 7;
  end.setDate(end.getDate() + daysUntilMonday);
  end.setHours(0, 0, 0, 0);
  return end;
}

export function inferredDuration(
  expiresAt: number | undefined,
  updatedAt: number | undefined,
): DurationLabel {
  if (!expiresAt || expiresAt * 1_000 <= Date.now()) return "Today";
  if (!updatedAt) return "Custom";

  const expiration = expiresAt * 1_000;
  const updated = updatedAt * 1_000;
  const withinTwoMinutes = (expected: number) =>
    Math.abs(expiration - expected) <= 2 * 60_000;
  if (withinTwoMinutes(updated + 60 * 60_000)) return "1 hour";
  if (withinTwoMinutes(updated + 8 * 60 * 60_000)) return "8 hours";
  if (withinTwoMinutes(endOfToday(new Date(updated)).getTime())) return "Today";
  if (withinTwoMinutes(endOfWeek(new Date(updated)).getTime())) {
    return "This week";
  }
  return "Custom";
}

function withCustomDateValue(current: Date, value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return current;
  }
  const next = new Date(current);
  next.setFullYear(year!, month! - 1, day!);
  return next;
}

function withCustomTime(current: Date, value: string) {
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return current;
  const next = new Date(current);
  next.setHours(hour!, minute!, 0, 0);
  return next;
}

function StatusSection({
  label,
  children,
  className,
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-1.5", className)}>
      {label ? (
        <h3 className="px-1 text-xs font-medium text-muted-foreground">
          {label}
        </h3>
      ) : null}
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-muted/20">
        {children}
      </div>
    </section>
  );
}

const ROW_CLASS =
  "flex min-h-11 w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/50 focus:outline-none focus-visible:bg-muted/50";

export function SetStatusDialog({
  open,
  onOpenChange,
  initialText = "",
  initialEmoji = "",
  initialExpiresAt,
  initialUpdatedAt,
  onSave,
  onClear,
  hasExistingStatus,
}: SetStatusDialogProps) {
  const t = useUiT();
  const locale = useUiLocale();
  const customEmoji = usePresenceHost()?.customEmoji;
  const pickerEmoji = React.useMemo(() => [...(customEmoji ?? [])], [customEmoji]);
  const [text, setText] = React.useState(initialText);
  const [emoji, setEmoji] = React.useState(initialEmoji);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [duration, setDuration] = React.useState<DurationLabel>("Today");
  const [customUntil, setCustomUntil] = React.useState(defaultCustomDate);
  const [durationTouched, setDurationTouched] = React.useState(false);
  const [saveError, setSaveError] = React.useState("");
  const [baseline, setBaseline] = React.useState(() => ({
    text: initialText,
    emoji: initialEmoji,
    expiresAt: initialExpiresAt,
    duration: null as DurationLabel | null,
    customUntil: null as Date | null,
    hasExistingStatus,
  }));
  const initializedForOpenRef = React.useRef(false);
  const timeFormat = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }),
    [locale],
  );
  const formattedTime = (hour: number, minute: number) => {
    const date = new Date(2000, 0, 1, hour, minute);
    return timeFormat.format(date);
  };

  React.useEffect(() => {
    if (!open) {
      initializedForOpenRef.current = false;
      return;
    }
    if (initializedForOpenRef.current) return;
    initializedForOpenRef.current = true;
    setText(initialText);
    setEmoji(initialEmoji);
    const currentExpiration = initialExpiresAt
      ? new Date(initialExpiresAt * 1_000)
      : null;
    if (currentExpiration && currentExpiration.getTime() > Date.now()) {
      const nextDuration = inferredDuration(initialExpiresAt, initialUpdatedAt);
      setDuration(nextDuration);
      setCustomUntil(currentExpiration);
      setBaseline({
        text: initialText,
        emoji: initialEmoji,
        expiresAt: initialExpiresAt,
        duration: nextDuration,
        customUntil: currentExpiration,
        hasExistingStatus,
      });
    } else {
      setDuration("Today");
      const nextCustomUntil = defaultCustomDate();
      setCustomUntil(nextCustomUntil);
      setBaseline({
        text: initialText,
        emoji: initialEmoji,
        expiresAt: undefined,
        duration: null,
        customUntil: null,
        hasExistingStatus,
      });
    }
    setDurationTouched(false);
    setSaveError("");
  }, [
    open,
    initialText,
    initialEmoji,
    initialExpiresAt,
    initialUpdatedAt,
    hasExistingStatus,
  ]);

  const hasContent = Boolean(text.trim());
  const effectiveEmoji =
    emoji || (text.trim() ? DEFAULT_USER_STATUS_EMOJI : "");
  const initialEffectiveEmoji =
    baseline.emoji || (baseline.text.trim() ? DEFAULT_USER_STATUS_EMOJI : "");
  const isDirty =
    text.trim() !== baseline.text.trim() ||
    effectiveEmoji !== initialEffectiveEmoji ||
    durationTouched ||
    (duration === "Custom" &&
      baseline.duration === "Custom" &&
      baseline.customUntil !== null &&
      customUntil.getTime() !== baseline.customUntil.getTime());
  function expirationUnixSeconds(now = new Date()): number | undefined {
    if (
      !durationTouched &&
      baseline.hasExistingStatus &&
      baseline.expiresAt !== undefined
    ) {
      return baseline.expiresAt;
    }
    const expiresAt = (() => {
      switch (duration) {
        case "1 hour":
          return new Date(now.getTime() + 60 * 60_000);
        case "8 hours":
          return new Date(now.getTime() + 8 * 60 * 60_000);
        case "Today":
          return endOfToday(now);
        case "This week":
          return endOfWeek(now);
        case "Custom":
          return customUntil;
      }
    })();
    return Math.floor(expiresAt.getTime() / 1_000);
  }

  const displayedExpiration = expirationUnixSeconds();
  const expirationIsFuture =
    displayedExpiration === undefined ||
    displayedExpiration > Math.floor(Date.now() / 1_000);
  const canSave = hasContent && isDirty && expirationIsFuture;

  function handlePresetClick(preset: (typeof PRESETS)[number]) {
    setText(t(preset.label));
    setEmoji(preset.emoji);
  }

  function handleEmojiSelect(selectedEmoji: string) {
    setEmoji(selectedEmoji);
    setPickerOpen(false);
  }

  function handleSave() {
    if (!hasContent || !isDirty) return;
    const expiresAt = expirationUnixSeconds();
    if (
      expiresAt !== undefined &&
      expiresAt <= Math.floor(Date.now() / 1_000)
    ) {
      setSaveError(t("userStatus.futureRequired"));
      return;
    }
    onSave({
      text: text.trim(),
      emoji: effectiveEmoji,
      expiresAt,
    });
    onOpenChange(false);
  }

  function handleClear() {
    onClear();
    onOpenChange(false);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSave();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ChooserDialogContent
        className="sm:max-w-[420px]"
        contentClassName="space-y-4 pt-3"
        data-testid="set-status-dialog"
        footer={
          <div className="flex w-full items-center justify-between gap-3">
            {baseline.hasExistingStatus ? (
              <Button
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                data-testid="set-status-clear"
                onClick={handleClear}
                type="button"
                variant="ghost"
              >
                {t("userStatus.clear")}
              </Button>
            ) : (
              <span />
            )}
            <Button
              aria-label={t("userStatus.save")}
              data-testid="set-status-save"
              disabled={!canSave}
              onClick={handleSave}
              type="button"
            >
              {t("userStatus.save")}
            </Button>
          </div>
        }
        footerClassName="border-t-0 pt-0"
        headerClassName="pb-2"
        headerSubtitle={t("userStatus.subtitle")}
        title={t("userStatus.title")}
      >
        <div className="flex min-h-12 items-stretch rounded-xl border border-input focus-within:ring-1 focus-within:ring-ring">
          <Popover onOpenChange={setPickerOpen} open={pickerOpen}>
            <div className="shrink-0">
              <PopoverTrigger asChild>
                <button
                  aria-label={t("userStatus.chooseEmoji")}
                  className="flex h-12 w-12 items-center justify-center rounded-xl transition-colors hover:bg-accent"
                  data-testid="set-status-emoji"
                  type="button"
                >
                  {effectiveEmoji ? (
                    <StatusEmoji className="h-5 w-5" value={effectiveEmoji} />
                  ) : (
                    <SmilePlus className="h-5 w-5 text-muted-foreground" />
                  )}
                </button>
              </PopoverTrigger>
            </div>
            <PopoverContent
              align="start"
              className="w-auto overflow-hidden rounded-2xl p-0"
              sideOffset={4}
            >
              <EmojiPicker autoFocus customEmoji={pickerEmoji} onSelect={handleEmojiSelect} />
            </PopoverContent>
          </Popover>
          <input
            aria-label={t("userStatus.placeholder")}
            className="min-w-0 flex-1 bg-transparent px-1 pr-3 text-base outline-none placeholder:text-muted-foreground"
            data-testid="set-status-input"
            maxLength={256}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("userStatus.placeholder")}
            value={text}
          />
        </div>

        <StatusSection label={t("userStatus.duration")}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={ROW_CLASS}
                data-testid="set-status-duration"
                type="button"
              >
                <Clock3 className="h-5 w-5 text-muted-foreground" />
                <span className="flex-1">{t("userStatus.duration")}</span>
                <span className="text-muted-foreground">{t(DURATION_LABEL_KEYS[duration])}</span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              {DURATIONS.map((option) => (
                <DropdownMenuItem
                  className="justify-between"
                  data-testid={`set-status-duration-${option.toLowerCase().replace(/\s+/g, "-")}`}
                  key={option}
                  onSelect={() => {
                    setDuration(option);
                    setDurationTouched(true);
                    setSaveError("");
                  }}
                >
                  {t(DURATION_LABEL_KEYS[option])}
                  {duration === option ? <Check className="h-4 w-4" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {duration === "Custom" ? (
            <div className={ROW_CLASS}>
              <CalendarClock className="h-5 w-5 text-muted-foreground" />
              <span>{t("userStatus.until")}</span>
              <input
                aria-label={t("userStatus.expirationDate")}
                className="flex h-9 min-w-0 flex-1 items-center rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                data-testid="set-status-expiration-date"
                min={toLocalDateValue(new Date())}
                onChange={(event) => {
                  if (!event.target.value) return;
                  setDurationTouched(true);
                  setSaveError("");
                  setCustomUntil((current) =>
                    withCustomDateValue(current, event.target.value),
                  );
                }}
                type="date"
                value={toLocalDateValue(customUntil)}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label={t("userStatus.expirationTime")}
                    className="flex h-9 w-28 shrink-0 items-center rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                    type="button"
                  >
                    <span>
                      {formattedTime(customUntil.getHours(), customUntil.getMinutes())}
                    </span>
                    <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="max-h-[23rem] min-w-28"
                  data-testid="status-expiration-time-menu"
                >
                  {HALF_HOUR_TIMES.map((time) => (
                    <DropdownMenuItem
                      className="justify-between"
                      key={time.value}
                      onSelect={() => {
                        setDurationTouched(true);
                        setSaveError("");
                        setCustomUntil((current) =>
                          withCustomTime(current, time.value),
                        );
                      }}
                    >
                      {formattedTime(time.hour, time.minute)}
                      {time.value === toLocalTimeValue(customUntil) ? (
                        <Check className="h-4 w-4" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
          {saveError || (!expirationIsFuture && isDirty) ? (
            <p className="px-3 py-2 text-xs text-destructive" role="alert">
              {saveError || t("userStatus.futureRequired")}
            </p>
          ) : null}
        </StatusSection>

        {!baseline.hasExistingStatus ? (
          <StatusSection label={t("userStatus.quickStatuses")}>
            {PRESETS.map((preset) => (
              <button
                className={ROW_CLASS}
                data-testid={`set-status-preset-${preset.id}`}
                key={preset.id}
                onClick={() => handlePresetClick(preset)}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className="flex w-5 justify-center text-lg"
                >
                  {preset.emoji}
                </span>
                <span>{t(preset.label)}</span>
              </button>
            ))}
          </StatusSection>
        ) : null}
      </ChooserDialogContent>
    </Dialog>
  );
}
