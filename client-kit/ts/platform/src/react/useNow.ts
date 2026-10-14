// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/shared/lib/useNow.ts, moved here so the shared Projects page uses
// the original shared ticker on Web and Desktop. The document-visibility pause
// is the original desktop/src/shared/lib/useDocumentVisible.ts::useDocumentVisible
// behavior for this hook only.
import * as React from "react";

type SharedTicker = {
  listeners: Set<() => void>;
  intervalId: ReturnType<typeof setInterval>;
};

const tickers = new Map<number, SharedTicker>();

function isDocumentVisible(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible";
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = React.useState(isDocumentVisible);

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibilityChange = () => setVisible(isDocumentVisible());
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return visible;
}

/**
 * One `setInterval` per distinct interval, shared by every subscriber. All
 * same-cadence consumers tick in a single timer callback, so React batches
 * their state updates into one render/composite pass instead of N unaligned
 * passes per interval. With dozens of "working" badges mounted, per-consumer
 * timers pinned a sustained ~25% of a core in the WebKit process.
 */
function subscribeToSharedTick(
  intervalMs: number,
  listener: () => void,
): () => void {
  let ticker = tickers.get(intervalMs);
  if (!ticker) {
    const created: SharedTicker = {
      listeners: new Set(),
      intervalId: setInterval(() => {
        for (const tick of created.listeners) tick();
      }, intervalMs),
    };
    tickers.set(intervalMs, created);
    ticker = created;
  }
  ticker.listeners.add(listener);

  return () => {
    ticker.listeners.delete(listener);
    if (ticker.listeners.size === 0) {
      clearInterval(ticker.intervalId);
      tickers.delete(intervalMs);
    }
  };
}

/**
 * Returns `Date.now()`, re-rendering the calling component every `intervalMs`.
 * Consumers with the same interval share one timer — mount the hook only where
 * a live clock is actually displayed so idle components never tick.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = React.useState(() => Date.now());
  const documentVisible = useDocumentVisible();

  React.useEffect(() => {
    if (!documentVisible) return;

    setNow(Date.now());
    return subscribeToSharedTick(intervalMs, () => setNow(Date.now()));
  }, [documentVisible, intervalMs]);

  return now;
}
