// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/settings/hooks/use-updater.ts. DD-125(5): the feed and signing key are
// the Desktop release configuration's; a build without them has no updater plugin and shows
// the original "unavailable" state. The manual-download page is the configured release page
// instead of the original GitHub URL, and is null when none is configured.
import { useState, useRef, useCallback, useEffect } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getUpdaterReleaseUrl, isAutoUpdateSupported } from "@/shared/api/updater";
import {
  BACKGROUND_UPDATE_CHECK_INTERVAL_MS,
  canRunBackgroundCheck,
  isUpdaterUnavailable,
  toErrorMessage,
  type UpdateStatus,
} from "./updateStatus";

export type { UpdateStatus } from "./updateStatus";

function initialUpdateStatus(): UpdateStatus {
  return { state: "idle" };
}

export function useUpdater() {
  const [status, setStatusState] = useState<UpdateStatus>(initialUpdateStatus);
  const statusRef = useRef<UpdateStatus>(initialUpdateStatus());
  const updateRef = useRef<Update | null>(null);
  const checkInFlightRef = useRef(false);
  const downloadInFlightRef = useRef(false);
  const installInFlightRef = useRef(false);
  const manualResultRequestedRef = useRef(false);
  const [releaseUrl, setReleaseUrl] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    void getUpdaterReleaseUrl()
      .then((url) => { if (!disposed) setReleaseUrl(url); })
      .catch(() => { if (!disposed) setReleaseUrl(null); });
    return () => { disposed = true; };
  }, []);

  const setStatus = useCallback((nextStatus: UpdateStatus) => {
    statusRef.current = nextStatus;
    setStatusState(nextStatus);
  }, []);

  const closeUpdate = useCallback(async () => {
    if (downloadInFlightRef.current || installInFlightRef.current) {
      return;
    }
    const current = updateRef.current;
    if (current) {
      updateRef.current = null;
      await current.close();
    }
  }, []);

  const downloadUpdate = useCallback(async () => {
    if (downloadInFlightRef.current) {
      return;
    }

    downloadInFlightRef.current = true;
    try {
      const update = updateRef.current;
      if (!update) {
        return;
      }

      setStatus({ state: "downloading" });
      await update.download();
      setStatus({ state: "ready" });
    } catch (err) {
      setStatus({ state: "error", message: toErrorMessage(err) });
    } finally {
      downloadInFlightRef.current = false;
    }
  }, [setStatus]);

  const installAndRelaunch = useCallback(async () => {
    if (installInFlightRef.current) {
      return;
    }

    const update = updateRef.current;
    if (!update) {
      return;
    }

    installInFlightRef.current = true;
    try {
      setStatus({ state: "installing" });
      await update.install();
      updateRef.current = null;
      await relaunch();
    } catch (err) {
      setStatus({ state: "error", message: toErrorMessage(err) });
    } finally {
      installInFlightRef.current = false;
    }
  }, [setStatus]);

  const runUpdateCheck = useCallback(
    async ({ background }: { background: boolean }) => {
      if (checkInFlightRef.current) {
        if (!background) {
          manualResultRequestedRef.current = true;
          setStatus({ state: "checking" });
        }
        return;
      }

      if (background && !canRunBackgroundCheck(statusRef.current)) {
        return;
      }

      checkInFlightRef.current = true;
      manualResultRequestedRef.current = false;

      try {
        await closeUpdate();

        if (!background) {
          setStatus({ state: "checking" });
        }

        const update = await check({
          headers: { "Cache-Control": "no-cache" },
        });
        const shouldShowQuietResult =
          !background || manualResultRequestedRef.current;

        if (update) {
          // Check support BEFORE exposing any actionable state — on a Linux
          // .deb, the window between "available" and "manual-required" would
          // let a click reach an un-updatable install.
          const autoUpdateOk = await isAutoUpdateSupported();
          updateRef.current = update;
          if (autoUpdateOk) {
            setStatus({ state: "available", version: update.version });
            void downloadUpdate();
          } else {
            // .deb / non-AppImage: surface the manual-download card instead.
            // No install handle is kept when we will never install in-app.
            updateRef.current = null;
            setStatus({
              state: "manual-required",
              version: update.version,
              releaseUrl: await getUpdaterReleaseUrl().catch(() => null),
            });
          }
        } else if (shouldShowQuietResult) {
          setStatus({ state: "up-to-date" });
        }
      } catch (err) {
        const message = toErrorMessage(err);
        const shouldShowQuietResult =
          !background || manualResultRequestedRef.current;

        if (isUpdaterUnavailable(message)) {
          if (shouldShowQuietResult) {
            setStatus({ state: "unavailable" });
          }
          return;
        }

        if (shouldShowQuietResult) {
          setStatus({ state: "error", message });
        }
      } finally {
        manualResultRequestedRef.current = false;
        checkInFlightRef.current = false;
      }
    },
    [closeUpdate, downloadUpdate, setStatus],
  );

  const checkForUpdate = useCallback(async () => {
    await runUpdateCheck({ background: false });
  }, [runUpdateCheck]);

  const checkForUpdateInBackground = useCallback(async () => {
    await runUpdateCheck({ background: true });
  }, [runUpdateCheck]);

  useEffect(() => {
    void checkForUpdateInBackground();

    const intervalId = window.setInterval(() => {
      void checkForUpdateInBackground();
    }, BACKGROUND_UPDATE_CHECK_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
      void closeUpdate();
    };
  }, [checkForUpdateInBackground, closeUpdate]);

  return {
    status,
    releaseUrl,
    checkForUpdate,
    installAndRelaunch,
  };
}
