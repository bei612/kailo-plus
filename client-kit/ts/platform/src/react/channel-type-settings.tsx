// Original Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/channels/ui/ChannelTypeSettings.tsx::ChannelTypeSettings
// desktop/src/features/channels/ui/ChannelTypePicker.tsx::ChannelTypePicker (dropdown variant, no project lifecycle)
// desktop/src/features/channels/lib/ephemeralChannel.ts::formatTtlDuration
// The creation form uses the original segmented variant and closed preset list; the channel
// management edit dialog uses the original dropdown variant with its "Current (…)" option.
import { ChevronDown, ClockFading, Hash } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useT } from "./context";
import { cn } from "./profile/buzz/shared/lib/cn";
import { Button } from "./profile/buzz/shared/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "./sidebar/dropdown-menu";
import { SegmentedControl } from "./segmented-control";

// Fixed original creation presets, not a new server policy or expiry timer.
export const DEFAULT_EPHEMERAL_TTL_SECONDS = 7 * 24 * 60 * 60;
const TIMEOUT_OPTIONS = [
  { seconds: 30 * 60, label: "channel.ttl.minutes30" },
  { seconds: 60 * 60, label: "channel.ttl.hour1" },
  { seconds: 6 * 60 * 60, label: "channel.ttl.hours6" },
  { seconds: 12 * 60 * 60, label: "channel.ttl.hours12" },
  { seconds: 24 * 60 * 60, label: "channel.ttl.day1" },
  { seconds: 3 * 24 * 60 * 60, label: "channel.ttl.days3" },
  { seconds: DEFAULT_EPHEMERAL_TTL_SECONDS, label: "channel.ttl.days7" },
  { seconds: 14 * 24 * 60 * 60, label: "channel.ttl.days14" },
  { seconds: 30 * 24 * 60 * 60, label: "channel.ttl.days30" },
] as const;
const TTL_UNIT_SECONDS = { d: 86_400, h: 3_600, m: 60, s: 1 } as const;

export function formatTtlDuration(ttlSeconds: number): string {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return "";
  let remaining = Math.floor(ttlSeconds);
  const parts: string[] = [];
  for (const unit of ["d", "h", "m", "s"] as const) {
    const size = TTL_UNIT_SECONDS[unit];
    const count = Math.floor(remaining / size);
    if (count > 0) {
      parts.push(`${count}${unit}`);
      remaining -= count * size;
    }
  }
  return parts.join("");
}

export function ChannelTypeSettings({ disabled, label, temporary, ttlSeconds, onTemporaryChange, onTtlSecondsChange,
  testIdPrefix = "create-channel", variant = "segmented" }: {
  disabled: boolean;
  /** Original row label: the creation form passes "Type"; the edit dialog keeps "Channel type". */
  label?: string;
  temporary: boolean;
  ttlSeconds: number;
  onTemporaryChange: (temporary: boolean) => void;
  onTtlSecondsChange: (ttl: number) => void;
  testIdPrefix?: string;
  variant?: "dropdown" | "segmented";
}) {
  const t = useT();
  const reduced = useReducedMotion();
  const selected = TIMEOUT_OPTIONS.find((option) => option.seconds === ttlSeconds);
  // Original edit dialog: an existing non-preset TTL stays selectable as "Current (…)".
  const current = variant === "dropdown" && !selected
    ? t("channelManagement.currentTtl", { duration: formatTtlDuration(ttlSeconds) }) : null;
  const options: { seconds: number; label: string }[] = [
    ...(current ? [{ seconds: ttlSeconds, label: current }] : []),
    ...TIMEOUT_OPTIONS.map((option) => ({ seconds: option.seconds, label: t(option.label) })),
  ];
  const typeLabel = t(temporary ? "channel.ttl.temporary" : "channel.ttl.ongoing");
  const TypeIcon = temporary ? ClockFading : Hash;
  return <div className="overflow-hidden rounded-xl border border-input bg-background" data-testid={`${testIdPrefix}-channel-type-container`}>
    <div className="flex items-center justify-between gap-3 px-3 py-3" data-testid={`${testIdPrefix}-channel-type-row`}>
      <span className={cn("text-sm font-medium text-foreground", disabled && variant === "segmented" && "opacity-50")}>{label ?? t("channel.ttl.type")}</span>
      {variant === "segmented" ? <SegmentedControl disabled={disabled} legend={t("channel.ttl.type")} onValueChange={(value) => onTemporaryChange(value === "temporary")}
        optionTestIdPrefix={`${testIdPrefix}-channel-type-option`} testId={`${testIdPrefix}-channel-type`} value={temporary ? "temporary" : "ongoing"}
        options={[{ value: "temporary", label: t("channel.ttl.temporary"), Icon: ClockFading }, { value: "ongoing", label: t("channel.ttl.ongoing"), Icon: Hash }]} />
        : <DropdownMenu modal={false}><DropdownMenuTrigger asChild><Button aria-label={`${label ?? t("channel.ttl.type")}: ${typeLabel}`}
          className="-mr-2.5 h-9 w-fit px-2.5 text-sm font-medium text-foreground hover:bg-muted/50" data-testid={`${testIdPrefix}-channel-type`}
          disabled={disabled} type="button" variant="ghost">
          <TypeIcon className="h-4 w-4" />{typeLabel}<ChevronDown className="h-4 w-4 text-muted-foreground/70" />
        </Button></DropdownMenuTrigger><DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()} style={{ minWidth: "var(--radix-dropdown-menu-trigger-width)" }}>
          <DropdownMenuRadioGroup onValueChange={(value) => onTemporaryChange(value === "temporary")} value={temporary ? "temporary" : "ongoing"}>
            <DropdownMenuRadioItem data-testid={`${testIdPrefix}-channel-type-option-ongoing`} value="ongoing">{t("channel.ttl.ongoing")}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem data-testid={`${testIdPrefix}-channel-type-option-temporary`} value="temporary">{t("channel.ttl.temporary")}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent></DropdownMenu>}
    </div>
    <AnimatePresence initial={false}>{temporary ? <motion.div animate={{ height: "auto", opacity: 1 }} className="overflow-hidden" exit={{ height: 0, opacity: 0 }} initial={{ height: 0, opacity: 0 }}
      key={`${testIdPrefix}-ephemeral-settings`} transition={reduced ? { duration: 0 } : { duration: 0.22, ease: [0.23, 1, 0.32, 1] }}>
      <div className="relative flex items-center justify-between gap-3 px-3 py-3 before:absolute before:inset-x-3 before:top-0 before:border-t before:border-border/70" data-testid={`${testIdPrefix}-ephemeral-settings`}>
        <label className={cn("text-sm font-medium", disabled && variant === "segmented" && "opacity-50")} htmlFor={`${testIdPrefix}-ttl`}>{t("channel.ttl.expires")}</label>
        <DropdownMenu modal={false}><DropdownMenuTrigger asChild><Button aria-label={t("channel.ttl.expires")}
          className="-mr-2.5 ml-auto h-9 w-fit justify-end px-2.5 text-right text-sm font-medium text-foreground hover:bg-muted/50"
          data-testid={`${testIdPrefix}-ttl`} disabled={disabled} id={`${testIdPrefix}-ttl`} type="button" variant="ghost">
          <span className="text-right">{selected ? t(selected.label) : current ?? String(ttlSeconds)}</span><ChevronDown className="size-4 shrink-0 text-muted-foreground/70" />
        </Button></DropdownMenuTrigger><DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()} style={{ minWidth: "var(--radix-dropdown-menu-trigger-width)" }}>
          <DropdownMenuRadioGroup onValueChange={(value) => onTtlSecondsChange(Number(value))} value={String(ttlSeconds)}>
            {options.map((option) => <DropdownMenuRadioItem data-testid={`${testIdPrefix}-ttl-option-${option.seconds}`} key={option.seconds} value={String(option.seconds)}>{option.label}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent></DropdownMenu>
      </div>
    </motion.div> : null}</AnimatePresence>
  </div>;
}
