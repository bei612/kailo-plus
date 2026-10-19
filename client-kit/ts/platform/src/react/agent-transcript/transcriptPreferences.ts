// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/agents/ui/transcriptAnimationPreference.ts and
// transcriptTimestampPreference.ts: device-level UI preferences persisted in
// localStorage under the original keys, shared by every transcript surface.
import * as React from "react";

function createPreference(storageKey: string, fallback: boolean) {
  const listeners = new Set<() => void>();
  let value = read();

  function read(): boolean {
    if (typeof window === "undefined") return fallback;
    try {
      const stored = window.localStorage.getItem(storageKey);
      return stored === null ? fallback : stored === "1";
    } catch {
      return fallback;
    }
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    set(enabled: boolean) {
      value = enabled;
      try {
        window.localStorage.setItem(storageKey, enabled ? "1" : "0");
      } catch {
        // Persistence is best-effort; the in-memory value still applies.
      }
      for (const listener of listeners) listener();
    },
    useValue(): boolean {
      return React.useSyncExternalStore(
        subscribe,
        () => value,
        () => fallback,
      );
    },
  };
}

// Original defaults: animation on (anything but "0"), timestamps off (only "1").
const animation = createPreference("buzz:animate-transcript-activity", true);
const timestamps = createPreference("buzz:show-transcript-timestamps", false);

export function setTranscriptAnimationEnabled(enabled: boolean): void {
  animation.set(enabled);
}

/** Whether transcript activity rows should animate in. */
export function useTranscriptAnimationEnabled(): boolean {
  return animation.useValue();
}

export function setTranscriptTimestampsEnabled(enabled: boolean): void {
  timestamps.set(enabled);
}

/** Whether every activity row shows its timestamp footer. */
export function useTranscriptTimestampsEnabled(): boolean {
  return timestamps.useValue();
}
