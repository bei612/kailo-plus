// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/agents/ui/TurnLivenessIndicator.tsx and
// desktop/src/shared/ui/buzz-logo/FuzzyLogo.tsx over the shared BuzzLogoAnimation.
import { motion, useReducedMotion } from "motion/react";

import { useUiT } from "../context";
import { cn } from "../profile/buzz/shared/lib/cn";
import BuzzLogoAnimation from "../projects/buzz-logo/BuzzLogoAnimation";
import { useTranscriptAnimationEnabled } from "./transcriptPreferences";

const MARKS = ["first", "second", "third"] as const;
const STAGGER_SECONDS = 0.25;
const CYCLE_SECONDS = 1.8;

/** The fuzzy Buzz mark; `fuzz={false}` uses the lightweight CSS pulse. */
export function FuzzyLogo({
  ariaLabel,
  className,
  fuzz = true,
  loop = false,
  loopRestSeconds = 0,
  pulse = true,
}: {
  ariaLabel?: string;
  className?: string;
  fuzz?: boolean;
  loop?: boolean;
  loopRestSeconds?: number;
  pulse?: boolean;
}) {
  const hasRestWindow = loop && loopRestSeconds > 0;
  return (
    <BuzzLogoAnimation
      ariaLabel={ariaLabel}
      className={cn(
        pulse && !fuzz && !hasRestWindow && "buzz-logo--pulse",
        className,
      )}
      fullScreen={false}
      loop={loop}
      loopRestSeconds={loopRestSeconds}
      showBackground={false}
      textured={fuzz}
      variant="v8"
    />
  );
}

export function TurnLivenessIndicator({
  className,
  fuzz = false,
}: {
  className?: string;
  /** Defaults to false — the indicator stays mounted for whole turns. */
  fuzz?: boolean;
}) {
  const t = useUiT();
  const animationsEnabled = useTranscriptAnimationEnabled();
  const shouldReduceMotion = useReducedMotion();
  const showStaggeredRow = animationsEnabled && !shouldReduceMotion;
  const label = t("agentTranscript.turnInProgress");

  if (!showStaggeredRow) {
    return (
      <div
        aria-label={label}
        className={cn("opacity-25", className)}
        data-testid="turn-liveness-indicator"
        role="status"
      >
        <FuzzyLogo
          ariaLabel={label}
          className="text-foreground"
          fuzz={fuzz}
          loop
          loopRestSeconds={2}
        />
      </div>
    );
  }

  return (
    <div
      aria-label={label}
      className={cn("flex items-center gap-1.5 opacity-25", className)}
      data-testid="turn-liveness-indicator"
      role="status"
    >
      {MARKS.map((mark, index) => (
        <motion.div
          animate={{
            opacity: [0, 1, 1, 0],
            y: [4, 0, -1, -4],
          }}
          key={mark}
          transition={{
            delay: index * STAGGER_SECONDS,
            duration: CYCLE_SECONDS,
            ease: "easeInOut",
            repeat: Number.POSITIVE_INFINITY,
            times: [0, 0.3, 0.7, 1],
          }}
        >
          <FuzzyLogo
            ariaLabel=""
            className="w-5! text-foreground"
            fuzz={fuzz}
            pulse={false}
          />
        </motion.div>
      ))}
    </div>
  );
}
