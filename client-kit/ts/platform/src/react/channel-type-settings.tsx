// Original Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/channels/ui/ChannelTypeSettings.tsx::ChannelTypeSettings
// The creation form uses the original segmented variant and closed preset list.
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

export function ChannelTypeSettings({ disabled, temporary, ttlSeconds, onTemporaryChange, onTtlSecondsChange }: {
  disabled: boolean;
  temporary: boolean;
  ttlSeconds: number;
  onTemporaryChange: (temporary: boolean) => void;
  onTtlSecondsChange: (ttl: number) => void;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  const selected = TIMEOUT_OPTIONS.find((option) => option.seconds === ttlSeconds);
  return <div className="overflow-hidden rounded-xl border border-input bg-background" data-testid="create-channel-channel-type-container">
    <div className="flex items-center justify-between gap-3 px-3 py-3" data-testid="create-channel-channel-type-row">
      <span className={cn("text-sm font-medium text-foreground", disabled && "opacity-50")}>{t("channel.ttl.type")}</span>
      <SegmentedControl disabled={disabled} legend={t("channel.ttl.type")} onValueChange={(value) => onTemporaryChange(value === "temporary")}
        optionTestIdPrefix="create-channel-channel-type-option" testId="create-channel-channel-type" value={temporary ? "temporary" : "ongoing"}
        options={[{ value: "temporary", label: t("channel.ttl.temporary"), Icon: ClockFading }, { value: "ongoing", label: t("channel.ttl.ongoing"), Icon: Hash }]} />
    </div>
    <AnimatePresence initial={false}>{temporary ? <motion.div animate={{ height: "auto", opacity: 1 }} className="overflow-hidden" exit={{ height: 0, opacity: 0 }} initial={{ height: 0, opacity: 0 }}
      key="create-channel-ephemeral-settings" transition={reduced ? { duration: 0 } : { duration: 0.22, ease: [0.23, 1, 0.32, 1] }}>
      <div className="relative flex items-center justify-between gap-3 px-3 py-3 before:absolute before:inset-x-3 before:top-0 before:border-t before:border-border/70" data-testid="create-channel-ephemeral-settings">
        <label className={cn("text-sm font-medium", disabled && "opacity-50")} htmlFor="create-channel-ttl">{t("channel.ttl.expires")}</label>
        <DropdownMenu modal={false}><DropdownMenuTrigger asChild><Button aria-label={t("channel.ttl.expires")}
          className="-mr-2.5 ml-auto h-9 w-fit justify-end px-2.5 text-right text-sm font-medium text-foreground hover:bg-muted/50"
          data-testid="create-channel-ttl" disabled={disabled} id="create-channel-ttl" type="button" variant="ghost">
          <span className="text-right">{selected ? t(selected.label) : String(ttlSeconds)}</span><ChevronDown className="size-4 shrink-0 text-muted-foreground/70" />
        </Button></DropdownMenuTrigger><DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()} style={{ minWidth: "var(--radix-dropdown-menu-trigger-width)" }}>
          <DropdownMenuRadioGroup onValueChange={(value) => onTtlSecondsChange(Number(value))} value={String(ttlSeconds)}>
            {TIMEOUT_OPTIONS.map((option) => <DropdownMenuRadioItem data-testid={`create-channel-ttl-option-${option.seconds}`} key={option.seconds} value={String(option.seconds)}>{t(option.label)}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent></DropdownMenu>
      </div>
    </motion.div> : null}</AnimatePresence>
  </div>;
}
