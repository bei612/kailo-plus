// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/channels/ui/FocusThreadDrawer.tsx
import { motion, useReducedMotion } from "motion/react";
import * as React from "react";

import {
  THREAD_FOCUS_DRAWER_TRAVEL_PX,
  THREAD_FOCUS_SLIVER_WIDTH_PX,
} from "./threadFocusLayout";
import { getThreadViewMode } from "./threadViewModePreference";
import { cn } from "../../profile/buzz/shared/lib/cn";
import { useUiT } from "../../context";

type FocusThreadDrawerProps = {
  active?: boolean;
  channelName?: string;
  children: React.ReactNode;
  onClose: () => void;
};

/**
 * Scrim over the channel content area behind the focus drawer.
 *
 * Veil, not shadow, and no blur: the channel fades toward the surface colour
 * rather than being darkened. A black wash is a multiply — it scales text and
 * background down together, so dark-on-light text keeps its contrast ratio and
 * stays readable at any opacity short of a solid bar. Fading toward
 * `background` instead compresses text against the surface in both themes,
 * which is what pushes the sliver back to colour and shape. Matches the shared
 * header backdrop's `bg-background/80` vocabulary, a touch heavier because this
 * one has to defeat body text rather than sit over a gap.
 */
const FOCUS_SCRIM_CLASS = "bg-background/75 dark:bg-background/80";

/**
 * Hover eases the veil one step in both themes.
 *
 * Feedback that the sliver is a target — deliberately not a peek: one step is
 * enough to register as interactive without making the channel readable.
 */
const FOCUS_SCRIM_HOVER_CLASS =
  "hover:bg-background/65 dark:hover:bg-background/70";

/** Arrive and settle. The iOS sheet curve, shared with `buzz-side-panel-enter`. */
const ENTER_EASE = [0.32, 0.72, 0, 1] as const;

/**
 * Leave immediately. Shares the enter's fast-start shape rather than the
 * conventional accelerating ease-in for exits.
 *
 * The "exits accelerate away" rule assumes the whole travel is visible; an
 * ease-in spends its opening frames barely moving and pays that back at the end.
 * Here the tail is hidden under the opacity fade, so acceleration buys nothing
 * and those opening frames are the entire perception of responsiveness — a
 * dismissal that hasn't visibly moved 40ms in reads as hesitation regardless of
 * its total duration. Decisiveness comes from the duration below instead.
 */
const EXIT_EASE = ENTER_EASE;

const SCRIM_ENTER_SECONDS = 0.2;

/**
 * Slightly ahead of the drawer's exit, and deliberately so.
 *
 * A scrim that outlasts the drawer leaves the channel dimmed with nothing on top
 * of it, which reads as lag at the exact moment the user has committed to
 * leaving. Undimming first hands the channel back the instant it is asked for.
 */
const SCRIM_EXIT_SECONDS = 0.12;

/**
 * Enter: opacity front-loaded, transform long.
 *
 * The two channels animate over deliberately different windows, and that
 * asymmetry is the whole point. Short travel *requires* an opacity fade — an
 * opaque surface this large appearing 120px off its mark with no fade is a hard
 * cut, not a slide. But pairing both properties on one timing function (as a
 * single CSS keyframe must) welds them together for the full duration, and since
 * opacity covers 100% of its range while transform covers ~3% of the drawer's
 * width, the fade is what the eye reads. Resolving opacity in the first ~90ms
 * leaves the remaining ~190ms as pure travel: the fade is over before it
 * registers, and what's perceived is sliding.
 *
 * It also keeps the drawer's own entrance from exposing its contents' load
 * order. Anything arriving late (replies resolving, media decoding) lands on an
 * already-opaque surface and reads as "the thread is loading" rather than the UI
 * assembling itself.
 */
const ENTER_TRANSITION = {
  opacity: { duration: 0.09, ease: "linear" },
  x: { duration: 0.28, ease: ENTER_EASE },
} as const;

/**
 * Exit: half the enter's duration, opacity barely back-loaded.
 *
 * Opening and closing are not symmetric tasks. The enter has something to say —
 * it establishes where the thread came from and that the channel is still behind
 * it. The exit has nothing to say: attention has already left for the channel,
 * so its only job is to get out of the way without popping. That makes duration
 * the thing to spend, and 140ms is about the floor before the drawer reads as
 * vanishing rather than leaving.
 *
 * The opacity hold shrinks with it. Its purpose is to let the drawer commit to
 * moving before it dissolves, so it reads as sliding out — but at this duration a
 * hold proportional to the old one would eat half the animation. 20ms is enough
 * to register solidity in the first frame or two.
 */
const EXIT_TRANSITION = {
  opacity: { delay: 0.02, duration: 0.12, ease: "linear" },
  x: { duration: 0.14, ease: EXIT_EASE },
} as const;

/**
 * Reduced motion keeps a crossfade and drops the travel.
 *
 * Travel is the part that's motion; the fade is what makes appearing and
 * disappearing legible. With `x` pinned to 0 the front/back-loaded opacity
 * timings would read as dead air on a stationary surface, so both collapse to
 * one short symmetric fade.
 */
const REDUCED_MOTION_TRANSITION = { duration: 0.12, ease: "linear" } as const;

function useViewportRightInsetPx(
  overlayRef: React.RefObject<HTMLDivElement | null>,
) {
  const [rightInsetPx, setRightInsetPx] = React.useState(0);

  React.useLayoutEffect(() => {
    const layoutRoot = overlayRef.current?.parentElement;
    if (!layoutRoot) return;

    const updateRightInset = () => {
      const bounds = layoutRoot.getBoundingClientRect();
      const overflowPx = Math.max(0, bounds.right - window.innerWidth);
      const nextRightInsetPx = Math.min(bounds.width, Math.ceil(overflowPx));
      setRightInsetPx((current) =>
        current === nextRightInsetPx ? current : nextRightInsetPx,
      );
    };

    updateRightInset();
    window.addEventListener("resize", updateRightInset);

    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateRightInset);
    let ancestor: HTMLElement | null = layoutRoot;
    while (ancestor) {
      observer?.observe(ancestor);
      ancestor = ancestor.parentElement;
    }

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateRightInset);
    };
  }, [overlayRef]);

  return rightInsetPx;
}

/**
 * Right-anchored thread drawer that overlays the channel content area.
 *
 * Must be rendered inside `ChannelPane`'s relative layout root, and beneath an
 * `AnimatePresence` so the exit animation can run: everything here is absolutely
 * positioned against the channel content area, so the app sidebar is never
 * covered. The channel stays mounted underneath — a narrow scrim-dimmed sliver
 * of it remains visible for depth, and the whole scrim (sliver included) is one
 * tall click target back to the channel. Orientation lives in the drawer
 * header's breadcrumb, where the eye already is — the sliver carries no label of
 * its own.
 *
 * `z-41` places the drawer above the channel section (whose inner `isolate`
 * wrapper traps the timeline's z-50 pill, z-40 composer overlay, and z-50 drop
 * overlay) and the `z-30` shared header backdrop, while staying below the
 * global `z-45` top chrome. Setting z-index on the positioned container also
 * gives the drawer its own stacking context, so the panel chrome inside is
 * isolated.
 */
export function FocusThreadDrawer({
  active = true,
  channelName,
  children,
  onClose,
}: FocusThreadDrawerProps) {
  const t = useUiT();
  const prefersReducedMotion = useReducedMotion();
  const travelPx = prefersReducedMotion ? 0 : THREAD_FOCUS_DRAWER_TRAVEL_PX;
  const drawerRef = React.useRef<HTMLDivElement>(null);
  const overlayRef = React.useRef<HTMLDivElement>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const activeRef = React.useRef(active);
  activeRef.current = active;
  const viewportRightInsetPx = useViewportRightInsetPx(overlayRef);

  React.useEffect(() => {
    if (!active) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    }

    window.addEventListener("keydown", handleEscape, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleEscape, { capture: true });
    };
  }, [active, onClose]);

  React.useLayoutEffect(() => {
    if (!active) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    drawerRef.current?.focus({ preventScroll: true });

    return () => {
      const previousFocus = previousFocusRef.current;
      requestAnimationFrame(() => {
        // A real dismissal keeps focus mode selected; a presentation switch
        // has already selected split mode and owns focus inside the new panel.
        // Hiding the thread for another panel must not steal that panel's focus.
        if (activeRef.current && getThreadViewMode() === "focus") {
          previousFocus?.focus({ preventScroll: true });
        }
      });
    };
  }, [active]);

  return (
    <div
      className={active ? "absolute inset-0 z-41" : "contents"}
      data-testid={active ? "focus-thread-drawer-overlay" : undefined}
      ref={overlayRef}
      style={active ? { right: viewportRightInsetPx } : undefined}
    >
      <motion.button
        animate={{ opacity: 1 }}
        aria-label={channelName ? `${t("thread.back")} #${channelName}` : t("thread.back")}
        hidden={!active}
        style={active ? undefined : { display: "none" }}
        className={cn(
          "absolute inset-0 cursor-pointer transition-colors duration-150",
          FOCUS_SCRIM_CLASS,
          FOCUS_SCRIM_HOVER_CLASS,
        )}
        data-testid="focus-thread-drawer-scrim"
        exit={{
          opacity: 0,
          transition: prefersReducedMotion
            ? REDUCED_MOTION_TRANSITION
            : { duration: SCRIM_EXIT_SECONDS, ease: "linear" },
        }}
        initial={{ opacity: 0 }}
        onClick={onClose}
        transition={
          prefersReducedMotion
            ? REDUCED_MOTION_TRANSITION
            : { duration: SCRIM_ENTER_SECONDS, ease: "linear" }
        }
        type="button"
      />

      <motion.div
        animate={{ opacity: 1, x: 0 }}
        className={cn(
          // Left corners only, at the app content surface's own `rounded-2xl`:
          // the drawer is flush to that surface's right edge, so it is *clipped*
          // to its right corners rather than nesting inside them. Flush edges
          // share a radius — a smaller one here would put two radii on one
          // element. `shadow-panel-left` draws the left edge and its corners;
          // see the token for why a `border-l` cannot.
          active ? "absolute inset-y-0 right-0 flex flex-col overflow-hidden rounded-l-2xl bg-background shadow-panel-left outline-hidden" : "contents",
        )}
        aria-label={active ? t("thread.title") : undefined}
        data-testid={active ? "focus-thread-drawer" : undefined}
        ref={drawerRef}
        role={active ? "complementary" : undefined}
        tabIndex={active ? -1 : undefined}
        exit={{
          opacity: 0,
          transition: prefersReducedMotion
            ? REDUCED_MOTION_TRANSITION
            : EXIT_TRANSITION,
          x: travelPx,
        }}
        initial={active ? { opacity: 0, x: travelPx } : false}
        style={active ? { left: THREAD_FOCUS_SLIVER_WIDTH_PX } : undefined}
        transition={
          prefersReducedMotion ? REDUCED_MOTION_TRANSITION : ENTER_TRANSITION
        }
      >
        <div className={active ? "flex min-h-0 flex-1 flex-col" : "contents"}>{children}</div>
      </motion.div>
    </div>
  );
}
