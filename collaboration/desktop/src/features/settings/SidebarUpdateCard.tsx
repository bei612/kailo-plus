// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/settings/SidebarUpdateCard.tsx.
// DD-125(5): the original sidebar update card over the shared sidebar action card; copy from
// the shared catalog, and the manual card opens the configured release page (if any).
import * as React from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CircleArrowUp, ExternalLink } from "lucide-react";
import { useDeviceLocale } from "@client-kit/platform/react/context";
import { translate } from "@client-kit/platform/i18n";

import { useOptionalUpdaterContext, useUpdaterContext } from "./hooks/UpdaterProvider";
import { shouldShowSidebarUpdateCard } from "./sidebarUpdateCardVisibility";
import { SidebarCompactActionCard } from "@/shared/ui/sidebar-action-card";
import { Spinner } from "@/shared/ui/spinner";

type SidebarUpdateCardProps = {
  onDismiss: () => void;
};

type SidebarUpdateCompactCardProps = SidebarUpdateCardProps & {
  actionTestId?: string;
  testId?: string;
};

export function SidebarUpdateCompactCard({
  actionTestId,
  onDismiss,
  testId = "sidebar-update-card-compact",
}: SidebarUpdateCompactCardProps) {
  const locale = useDeviceLocale();
  const { installAndRelaunch, status } = useUpdaterContext();
  const [isUpdatePending, setIsUpdatePending] = React.useState(false);
  const updatePendingRef = React.useRef(false);
  const updateFrameRef = React.useRef<number | null>(null);
  const updateTimeoutRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    return () => {
      if (updateFrameRef.current !== null) {
        window.cancelAnimationFrame(updateFrameRef.current);
      }
      if (updateTimeoutRef.current !== null) {
        window.clearTimeout(updateTimeoutRef.current);
      }
      updatePendingRef.current = false;
    };
  }, []);

  const handleUpdate = React.useCallback(() => {
    if (updatePendingRef.current) {
      return;
    }

    updatePendingRef.current = true;
    setIsUpdatePending(true);
    updateFrameRef.current = window.requestAnimationFrame(() => {
      updateFrameRef.current = null;
      updateTimeoutRef.current = window.setTimeout(() => {
        updateTimeoutRef.current = null;
        void installAndRelaunch()
          .catch((error) => {
            console.error("[SidebarUpdateCard] update failed:", error);
          })
          .finally(() => {
            updatePendingRef.current = false;
            setIsUpdatePending(false);
          });
      }, 0);
    });
  }, [installAndRelaunch]);

  const pending = isUpdatePending || status.state === "installing";

  return (
    <SidebarCompactActionCard
      actionAriaLabel={translate(locale, "updates.sidebar.updateNow")}
      actionDisabled={pending}
      actionTestId={actionTestId}
      description={translate(locale, pending ? "updates.sidebar.updating" : "updates.sidebar.clickToUpdate")}
      dismissLabel={translate(locale, "updates.sidebar.dismiss")}
      icon={
        pending ? (
          <Spinner aria-hidden="true" className="h-5 w-5 border-2" />
        ) : (
          <CircleArrowUp aria-hidden="true" className="h-5 w-5" />
        )
      }
      iconKey={pending ? "pending" : "idle"}
      onAction={handleUpdate}
      onDismiss={onDismiss}
      testId={testId}
      title={translate(locale, "updates.sidebar.readyTitle")}
    />
  );
}

export function SidebarUpdateCard({ onDismiss }: SidebarUpdateCardProps) {
  const locale = useDeviceLocale();
  const updater = useOptionalUpdaterContext();
  const status = updater?.status;

  if (!status || !shouldShowSidebarUpdateCard(status)) {
    return null;
  }

  if (status.state === "manual-required") {
    const releaseUrl = status.releaseUrl;
    return (
      <SidebarCompactActionCard
        actionAriaLabel={translate(locale, "updates.sidebar.download")}
        actionDisabled={!releaseUrl}
        actionTestId="sidebar-update-download"
        description={translate(locale, releaseUrl
          ? "updates.sidebar.manualDescription" : "updates.sidebar.manualDescriptionNoLink", { version: status.version })}
        dismissLabel={translate(locale, "updates.sidebar.dismiss")}
        icon={<ExternalLink aria-hidden="true" className="h-5 w-5" />}
        iconKey="manual"
        onAction={() => { if (releaseUrl) void openUrl(releaseUrl); }}
        onDismiss={onDismiss}
        testId="sidebar-update-card-manual"
        title={translate(locale, "updates.sidebar.manualTitle")}
      />
    );
  }

  return (
    <SidebarUpdateCompactCard
      actionTestId="sidebar-update-now"
      onDismiss={onDismiss}
      testId="sidebar-update-card"
    />
  );
}
