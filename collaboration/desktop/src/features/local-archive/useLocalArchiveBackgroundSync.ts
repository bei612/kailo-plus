// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/local-archive/useArchiveSync.ts.
// DD-159: background sync of the Desktop local archive. Kailo pulls through this device's own
// Relay session on a timer instead of tapping the live stream; access loss removes the copies
// and is announced, transient failures stay silent and retry on the next round.
import * as React from "react";
import { toast } from "sonner";
import { useDeviceLocale } from "@client-kit/platform/react/context";
import { translate } from "@client-kit/platform/i18n";
import { getLocalArchiveStatus, syncLocalArchive } from "@/shared/api/tauriLocalArchive";
import { summarizeSync } from "./localArchiveModel";

const FIRST_SYNC_DELAY_MS = 30_000;
const SYNC_INTERVAL_MS = 30 * 60_000;

export function useLocalArchiveBackgroundSync(enabled: boolean) {
  const locale = useDeviceLocale();
  const localeRef = React.useRef(locale);
  localeRef.current = locale;
  React.useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let running = false;
    const round = async () => {
      if (disposed || running) return;
      running = true;
      try {
        const status = await getLocalArchiveStatus();
        if (disposed || status.subscriptions.length === 0) return;
        const summary = summarizeSync(await syncLocalArchive());
        if (!disposed && summary.tone === "negative") toast.error(translate(localeRef.current, summary.key, summary.variables));
      } catch {
        // Keychain locked or relay unreachable: nothing is deleted, the next round retries.
      } finally {
        running = false;
      }
    };
    const first = window.setTimeout(() => void round(), FIRST_SYNC_DELAY_MS);
    const timer = window.setInterval(() => void round(), SYNC_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [enabled]);
}
