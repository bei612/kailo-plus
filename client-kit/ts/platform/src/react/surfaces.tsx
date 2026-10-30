import { useId, type ReactNode } from "react";

export function GradientLayer() {
  return (
    <div
      aria-hidden="true"
      className="buzz-theme-gradient-layer pointer-events-none absolute inset-0 -z-10"
      data-buzz-gradient-layer
    >
      <div className="buzz-theme-gradient-underlay absolute inset-0" />
      <div
        className="buzz-theme-gradient-layer-light absolute inset-0 opacity-0"
        data-buzz-gradient="light"
      />
      <div
        className="buzz-theme-gradient-layer-dark absolute inset-0 opacity-0"
        data-buzz-gradient="dark"
      />
    </div>
  );
}

/**
 * DD-141 §10: the Kailo content plane sits flush against the canvas (no
 * floating card margins); its hairline edges and corner live in kailo-shell.css.
 */
export function ContentSurface({ children, terminal }: { children: ReactNode; terminal?: ReactNode }) {
  return (
    <div
      className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
      data-buzz-content-surface
    >
      <div className="buzz-content-primary flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
      {/* Original Buzz terminal dock (DD-161): only the Desktop host supplies a terminal. */}
      {terminal ? <div className="buzz-terminal-dock-host" data-terminal-dock>{terminal}</div> : null}
    </div>
  );
}

/**
 * DD-141 §2.5 brand mark: a gradient tile with a connected "K" — two arms
 * meeting a stem, each ending in a node (people and agents joined in one
 * place). Pictorial only; the product name stays a deployment setting (DD-111).
 */
export function KailoMark({ size = 22, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg aria-hidden="true" className={className} data-kailo-brand-mark focusable="false" height={size}
      viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient gradientUnits="userSpaceOnUse" id={`${id}-fill`} x1="2" x2="22" y1="2" y2="22">
          <stop offset="0" className="kailo-mark-stop-from" />
          <stop offset="0.5" className="kailo-mark-stop-via" />
          <stop offset="1" className="kailo-mark-stop-to" />
        </linearGradient>
      </defs>
      <rect fill={`url(#${id}-fill)`} height="24" rx="7" width="24" />
      <g fill="none" stroke="white" strokeLinecap="round" strokeWidth="2.1">
        <path d="M8.6 6.6v10.8" />
        <path d="M9.4 12.6l5.5-5.2" />
        <path d="M11.5 10.9l4.3 6.1" />
      </g>
      <circle cx="16.1" cy="6.3" fill="white" r="1.55" />
      <circle cx="16.3" cy="17.6" fill="white" r="1.55" />
    </svg>
  );
}
