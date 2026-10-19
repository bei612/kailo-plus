// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/moderation/ui/ComposerTimeoutBanner.tsx::ComposerTimeoutBanner
// A banner docked to the composer's top edge while the member is timed out. Purely
// presentational: the state and its per-second tick are owned by useTimeoutState. The
// original amber accent is the host's semantic warning colour.
import { Clock } from "lucide-react";
import { timeoutRemaining } from "../../moderation";
import { useUiT } from "../context";

export function ComposerTimeoutBanner({ expiresAtMs }: {
  /** Timeout expiry in epoch ms, or null when the Relay gave no timestamp. */
  expiresAtMs: number | null;
}) {
  const t = useUiT();
  const remaining = timeoutRemaining(expiresAtMs);
  return (
    <div
      className="relative z-0 mx-5 -mb-3 flex items-center gap-2 rounded-t-2xl border border-b-0 border-warning/30 bg-warning-bg px-4 pb-5 pt-2.5 text-sm leading-5 text-foreground backdrop-blur-sm"
      data-testid="composer-timeout-banner"
    >
      <Clock aria-hidden className="h-4 w-4 shrink-0 text-warning" />
      <span className="min-w-0">
        {remaining
          ? t("moderation.banner.remaining", { remaining: t(remaining.key, remaining.variables) })
          : t("moderation.banner.timedOut")}
      </span>
    </div>
  );
}
