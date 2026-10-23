// Shared loading/liveness mark (originally Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/shared/ui/buzz-logo/BuzzLogoAnimation.tsx). DD-141 replaces the
// Buzz bee morph with the Kailo glyph; the component name, props and wrapper
// classes stay so every original consumer (loading states, Agent liveness,
// onboarding) keeps its behaviour.
import type { CSSProperties } from "react";
import "./buzz-logo-animation.css";

type VariantKey = "v1" | "v2" | "v3" | "v4" | "v5" | "v6" | "v7" | "v8";

export type BuzzLogoAnimationProps = {
  ariaLabel?: string;
  className?: string;
  fullScreen?: boolean;
  loop?: boolean;
  /**
   * When looping, hold the drawn mark hidden for this many seconds between
   * plays. Only applies when `loop` is true.
   */
  loopRestSeconds?: number;
  reverse?: boolean;
  showBackground?: boolean;
  style?: CSSProperties;
  /** Kept for API compatibility; the Kailo glyph never uses a texture filter. */
  textured?: boolean;
  /** Kept for API compatibility; the Kailo glyph has a single drawing. */
  variant?: VariantKey;
};

export default function BuzzLogoAnimation({
  ariaLabel = "Loading",
  className = "",
  fullScreen = true,
  loop = false,
  loopRestSeconds = 0,
  reverse = false,
  showBackground = true,
  style,
}: BuzzLogoAnimationProps) {
  const classes = [
    "buzz-logo",
    "kailo-glyph",
    fullScreen && "buzz-logo--screen",
    !fullScreen && "buzz-logo--compact",
    showBackground && "buzz-logo--background",
    loop && "kailo-glyph--loop",
    reverse && "kailo-glyph--reverse",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const cycle = { "--kailo-glyph-cycle": `${1.6 + (loop ? Math.max(loopRestSeconds, 0) : 0)}s` } as CSSProperties;

  return (
    <div className={classes} style={{ ...cycle, ...style }} role="img" aria-label={ariaLabel}>
      <svg
        className="buzz-logo__mark"
        viewBox="0 0 24 24"
        width="24"
        height="24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2.4"
      >
        <path className="kailo-glyph__stroke" d="M8.6 6.6v10.8" pathLength={1} />
        <path className="kailo-glyph__stroke kailo-glyph__stroke--2" d="M9.4 12.6l5.5-5.2" pathLength={1} />
        <path className="kailo-glyph__stroke kailo-glyph__stroke--3" d="M11.5 10.9l4.3 6.1" pathLength={1} />
        <circle className="kailo-glyph__node" cx="16.1" cy="6.3" r="1.75" fill="currentColor" stroke="none" />
        <circle className="kailo-glyph__node kailo-glyph__node--2" cx="16.3" cy="17.6" r="1.75" fill="currentColor" stroke="none" />
      </svg>
    </div>
  );
}
