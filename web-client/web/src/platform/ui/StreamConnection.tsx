// Web host for the original relay connection card (REQ-24, SS-WEB-RELAY).
//
// Buzz 779af8886caae1317b4de962082429867ab61503 shared/api/useRelayConnection.ts and
// features/sidebar/ui/useSidebarRelayConnectionCard.ts, driven by the aggregated BFF stream
// state instead of a browser Relay socket: the browser never connects to the Relay (DD-39).
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RelayConnectionCardState } from "@client-kit/platform/react/sidebar/relay-connection-overlay";
import { reconnectStreams, streamConnectionState, subscribeStreamConnection, type StreamConnectionState } from "../bff-client";

/** Original useRelayConnection default: transient connecting states show only after this. */
const DEGRADED_AFTER_MS = 2_000;
/** Original SIDEBAR_CONNECTIVITY_SUCCESS_AUTO_DISMISS_MS. */
const SUCCESS_AUTO_DISMISS_MS = 6_000;

/**
 * Original useRelayConnection: connected, idle and disconnected are reported at once; connecting
 * and reconnecting only once they have lasted `degradedAfterMs`, so a brief stream hand-over does
 * not flash the card.
 */
export function useStreamConnection(degradedAfterMs = DEGRADED_AFTER_MS): StreamConnectionState {
  const actual = useSyncExternalStore(subscribeStreamConnection, streamConnectionState, () => "idle" as const);
  const [reported, setReported] = useState<StreamConnectionState>(actual);
  useEffect(() => {
    if (actual === "connected" || actual === "idle" || actual === "disconnected" || degradedAfterMs <= 0) {
      setReported(actual);
      return;
    }
    const timer = window.setTimeout(() => setReported(actual), degradedAfterMs);
    return () => window.clearTimeout(timer);
  }, [actual, degradedAfterMs]);
  return reported;
}

function isDocumentVisible() {
  return document.visibilityState === "visible";
}

/**
 * Original useSidebarRelayConnectionCard state machine over the BFF streams: the card appears
 * during an outage, "Connected" follows only an outage whose card was on screen and dismisses
 * itself after 6 s while the page is visible, and a dismissal lasts until the next outage.
 */
export function useStreamConnectionCard(): RelayConnectionCardState {
  const state = useStreamConnection();
  const isDegraded = state === "reconnecting" || state === "disconnected";
  const isConnected = state === "connected";
  const [isDismissed, setIsDismissed] = useState(false);
  const [hasSuccess, setHasSuccess] = useState(false);
  const [isWindowVisible, setIsWindowVisible] = useState(isDocumentVisible);
  const [isReconnectPending, setIsReconnectPending] = useState(false);
  const isSuccess = hasSuccess && isConnected;
  const show = (isDegraded || isSuccess) && !isDismissed;
  const outageActive = useRef(false);
  const wasProblemCardVisible = useRef(false);
  const reconnecting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    if (state === "idle") {
      outageActive.current = false;
      wasProblemCardVisible.current = false;
      setIsDismissed(false);
      return;
    }
    if (isDegraded) {
      if (!outageActive.current) {
        outageActive.current = true;
        setHasSuccess(false);
        setIsDismissed(false);
      }
      wasProblemCardVisible.current = show && !isSuccess;
      return;
    }
    if (outageActive.current && isConnected) {
      outageActive.current = false;
      if (wasProblemCardVisible.current) {
        wasProblemCardVisible.current = false;
        setHasSuccess(true);
      }
    }
  }, [state, isDegraded, isConnected, show, isSuccess]);

  useEffect(() => {
    if (!isSuccess || !isWindowVisible) return;
    const timeout = window.setTimeout(() => {
      setHasSuccess(false);
      setIsDismissed(true);
    }, SUCCESS_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timeout);
  }, [isSuccess, isWindowVisible]);

  useEffect(() => {
    const update = () => setIsWindowVisible(isDocumentVisible());
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const onReconnectRelay = useCallback(() => {
    if (reconnecting.current) return;
    reconnecting.current = true;
    setIsReconnectPending(true);
    setHasSuccess(false);
    void reconnectStreams()
      .then((didReconnect) => {
        if (!mounted.current || !didReconnect) return;
        wasProblemCardVisible.current = false;
        setIsDismissed(false);
        setHasSuccess(true);
      })
      .catch(() => undefined)
      .finally(() => {
        reconnecting.current = false;
        if (mounted.current) setIsReconnectPending(false);
      });
  }, []);

  const onDismissRelayConnectionCard = useCallback(() => {
    setHasSuccess(false);
    setIsDismissed(true);
  }, []);

  return {
    // The Web transport has no separate application-level relay error path.
    hasRelayUnreachableError: false,
    isRelayConnectionSuccess: isSuccess,
    isRelayReconnectPending: isReconnectPending,
    onDismissRelayConnectionCard,
    onReconnectRelay,
    showSidebarRelayConnectionCard: show,
  };
}
