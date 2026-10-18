// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/app/RelayConnectionOverlay.tsx and the AppSidebar footer slot
// (features/sidebar/ui/AppSidebar.tsx): where the original reconnect card appears. The host
// supplies the card state (Desktop: its relay client; Web: its BFF streams, SS-WEB-RELAY).
import { AnimatePresence, motion } from "motion/react";
import { AlertCircle } from "lucide-react";

import { cn } from "../profile/buzz/shared/lib/cn";
import { useSidebar } from "./sidebar";
import { SidebarRelayConnectionCard } from "./sidebar-relay-connection-card";

/** The original useSidebarRelayConnectionCard result both placements read. */
export type RelayConnectionCardState = {
  hasRelayUnreachableError: boolean;
  isRelayConnectionSuccess: boolean;
  isRelayReconnectPending: boolean;
  isWaitingOnReconnectHook?: boolean;
  onDismissRelayConnectionCard: () => void;
  onReconnectRelay: () => void;
  showSidebarRelayConnectionCard: boolean;
};

/** Original AppSidebar footer: the card sits above the profile card while the sidebar is open. */
export function SidebarRelayConnectionFooterCard({ card }: { card: RelayConnectionCardState }) {
  const { isMobile, open: sidebarOpen, openMobile } = useSidebar();
  if (!card.showSidebarRelayConnectionCard || !(isMobile ? openMobile : sidebarOpen)) return null;
  return (
    <SidebarRelayConnectionCard
      className="mb-2"
      isConnected={card.isRelayConnectionSuccess}
      isReconnectPending={card.isRelayReconnectPending}
      isWaitingOnReconnectHook={card.isWaitingOnReconnectHook}
      onDismiss={card.onDismissRelayConnectionCard}
      onReconnect={card.onReconnectRelay}
    />
  );
}

type RelayConnectionOverlayProps = {
  card: RelayConnectionCardState;
  errorMessage?: string;
  /** The host connection is terminally disconnected (original `connectionState === "disconnected"`). */
  isDisconnected?: boolean;
};

/**
 * Fixed bottom-left overlay that shows the relay reconnect card when the
 * sidebar is collapsed. When the sidebar is open, the card lives in the
 * sidebar footer instead (and this overlay is hidden).
 *
 * Also surfaces non-unreachable disconnect errors (e.g. auth rejections)
 * when the sidebar is hidden, since those errors are only rendered inside
 * the sidebar content area which is off-canvas when collapsed.
 */
export function RelayConnectionOverlay({
  card,
  errorMessage,
  isDisconnected = false,
}: RelayConnectionOverlayProps) {
  const { open: sidebarOpen, openMobile, isMobile } = useSidebar();

  // Show the overlay when the sidebar surface isn't visible:
  // - Desktop: sidebar is collapsed (open === false)
  // - Mobile: the sheet is closed (openMobile === false)
  const isSidebarSurfaceHidden = isMobile ? !openMobile : !sidebarOpen;
  const shouldShowReconnectCard =
    card.showSidebarRelayConnectionCard && isSidebarSurfaceHidden;

  // Show a non-unreachable error (e.g. auth rejection) when the sidebar is
  // hidden and the reconnect card isn't already covering it.
  const hasNonUnreachableError =
    Boolean(errorMessage) &&
    !card.hasRelayUnreachableError &&
    isDisconnected;
  const shouldShowErrorFallback =
    hasNonUnreachableError &&
    isSidebarSurfaceHidden &&
    !shouldShowReconnectCard;

  return (
    <AnimatePresence>
      {shouldShowReconnectCard ? (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "pointer-events-none fixed bottom-3 left-3 z-50 w-[284px]",
          )}
          exit={{ opacity: 0, y: 20 }}
          initial={{ opacity: 0, y: -20 }}
          key="relay-connection-overlay"
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="pointer-events-auto rounded-xl bg-background shadow-md">
            <SidebarRelayConnectionCard
              isConnected={card.isRelayConnectionSuccess}
              isReconnectPending={card.isRelayReconnectPending}
              isWaitingOnReconnectHook={card.isWaitingOnReconnectHook}
              onDismiss={card.onDismissRelayConnectionCard}
              onReconnect={card.onReconnectRelay}
            />
          </div>
        </motion.div>
      ) : null}
      {shouldShowErrorFallback ? (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "pointer-events-none fixed bottom-3 left-3 z-50 w-[284px]",
          )}
          exit={{ opacity: 0, y: 20 }}
          initial={{ opacity: 0, y: -20 }}
          key="relay-error-overlay"
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        >
          <div
            className="pointer-events-auto flex items-center gap-2 rounded-xl bg-background px-3 py-2.5 text-sm text-destructive shadow-md"
            data-testid="relay-error-overlay"
            role="alert"
          >
            <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span className="flex-1">{errorMessage}</span>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
