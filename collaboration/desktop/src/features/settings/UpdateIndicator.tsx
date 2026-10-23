// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/settings/UpdateIndicator.tsx.
// DD-125(5): the original header update indicator; labels from the shared catalog and the
// badge in DD-141 roles (brand while working, success when ready).
import { openUrl } from "@tauri-apps/plugin-opener";
import type { ComponentType } from "react";
import { ExternalLink, RefreshCcw, RotateCw } from "lucide-react";
import { useDeviceLocale } from "@client-kit/platform/react/context";
import { translate, type PlatformMessageKey } from "@client-kit/platform/i18n";

import { Button } from "@/shared/ui/button";
import { Spinner } from "@/shared/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

import { useOptionalUpdaterContext } from "./hooks/UpdaterProvider";
import type { UpdateStatus } from "./hooks/updateStatus";

const indicatorButtonClass =
  "relative text-muted-foreground hover:bg-muted hover:text-foreground";

type IndicatorIcon = ComponentType<{
  "aria-hidden"?: boolean;
  className?: string;
}>;

const variants: Record<
  "available" | "downloading" | "installing" | "manual-required" | "ready",
  {
    Icon: IndicatorIcon;
    iconClassName?: string;
    labelKey: PlatformMessageKey;
    badgeColor: string;
  }
> = {
  available: { Icon: RefreshCcw, labelKey: "updates.indicator.available", badgeColor: "bg-brand" },
  downloading: {
    Icon: Spinner,
    iconClassName: "h-4 w-4 border-2",
    labelKey: "updates.indicator.downloading",
    badgeColor: "bg-brand",
  },
  installing: {
    Icon: Spinner,
    iconClassName: "h-4 w-4 border-2",
    labelKey: "updates.indicator.installing",
    badgeColor: "bg-brand",
  },
  "manual-required": { Icon: ExternalLink, labelKey: "updates.indicator.manual", badgeColor: "bg-brand" },
  ready: { Icon: RotateCw, labelKey: "updates.indicator.ready", badgeColor: "bg-success" },
};

function getVariant(state: UpdateStatus["state"]) {
  if (
    state === "available" ||
    state === "downloading" ||
    state === "installing" ||
    state === "manual-required" ||
    state === "ready"
  ) {
    return variants[state];
  }
  return null;
}

export function UpdateIndicator({ className }: { className?: string }) {
  const locale = useDeviceLocale();
  const updater = useOptionalUpdaterContext();
  if (!updater) {
    return null;
  }
  const { status, installAndRelaunch } = updater;
  const variant = getVariant(status.state);

  if (!variant) {
    return null;
  }

  const { Icon, iconClassName = "h-4 w-4", labelKey, badgeColor } = variant;
  const label = translate(locale, labelKey);
  const releaseUrl = status.state === "manual-required" ? status.releaseUrl : null;
  const handleClick =
    status.state === "ready"
      ? installAndRelaunch
      : releaseUrl
        ? () => {
            void openUrl(releaseUrl);
          }
        : null;
  const isActionable = handleClick !== null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className={`${indicatorButtonClass} ${className ?? ""}`}
          data-testid="update-indicator"
          disabled={!isActionable}
          onClick={() => {
            if (handleClick) {
              void handleClick();
            }
          }}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Icon aria-hidden className={iconClassName} />
          <span
            className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${badgeColor} motion-safe:animate-pulse`}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
