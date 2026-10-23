// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/settings/hooks/use-updater.ts: the status model and its pure rules,
// kept free of React and Tauri so they can be tested directly.

export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "up-to-date" }
  | { state: "unavailable" }
  | { state: "available"; version: string }
  | { state: "downloading" }
  | { state: "installing" }
  | { state: "ready" }
  | { state: "error"; message: string }
  | {
      state: "manual-required";
      version: string;
      /** The release page from the Desktop release configuration; null when none is configured. */
      releaseUrl: string | null;
    };

export const BACKGROUND_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const BACKGROUND_BLOCKED_STATES = new Set<UpdateStatus["state"]>([
  "checking",
  "available",
  "downloading",
  "installing",
  "ready",
  "manual-required",
]);

export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The updater plugin is registered only when the release configuration injected a feed and
 * signing key (DD-125(5)); its absence is the original "unavailable" state, not an error.
 */
export function isUpdaterUnavailable(message: string): boolean {
  return (
    message.includes("plugin updater not found") ||
    message.includes("not initialized") ||
    message.includes("updater not allowed")
  );
}

export function canRunBackgroundCheck(status: UpdateStatus): boolean {
  return !BACKGROUND_BLOCKED_STATES.has(status.state);
}
