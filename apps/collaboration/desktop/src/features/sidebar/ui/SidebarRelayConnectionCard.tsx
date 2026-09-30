import { Check, CloudOff } from "lucide-react";
import { resolveLocale, translate } from "@client-kit/platform/i18n";

import {
  SidebarCompactActionCard,
  type SidebarActionCardSurface,
} from "@/shared/ui/sidebar-action-card";
import { Spinner } from "@/shared/ui/spinner";

type SidebarRelayConnectionCardProps = {
  isActionDisabled?: boolean;
  actionTestId?: string;
  className?: string;
  dismissClassName?: string;
  isConnected?: boolean;
  isReconnectPending: boolean;
  isWaitingOnReconnectHook?: boolean;
  onDismiss?: () => void;
  onReconnect: () => void;
  surface?: SidebarActionCardSurface;
  testId?: string;
};

export function SidebarRelayConnectionCard({
  actionTestId,
  className,
  isActionDisabled = false,
  isConnected = false,
  isReconnectPending,
  isWaitingOnReconnectHook = false,
  onDismiss,
  onReconnect,
  surface,
}: SidebarRelayConnectionCardProps) {
  return (
    <SidebarRelayConnectionCompactCard
      actionTestId={actionTestId ?? "sidebar-reconnect"}
      className={className}
      isActionDisabled={isActionDisabled}
      isConnected={isConnected}
      isReconnectPending={isReconnectPending}
      isWaitingOnReconnectHook={isWaitingOnReconnectHook}
      onDismiss={onDismiss}
      onReconnect={onReconnect}
      surface={surface}
      testId="sidebar-relay-unreachable"
    />
  );
}

export function SidebarRelayConnectionCompactCard({
  actionTestId,
  className,
  dismissClassName,
  isActionDisabled = false,
  isConnected = false,
  isReconnectPending,
  isWaitingOnReconnectHook = false,
  onDismiss,
  onReconnect,
  surface,
  testId = "sidebar-relay-unreachable-compact",
}: SidebarRelayConnectionCardProps) {
  const locale = resolveLocale();
  const reconnectTitle = isWaitingOnReconnectHook
    ? translate(locale, "native.relay.waiting")
    : translate(locale, "native.relay.connecting");
  const reconnectDescription = isWaitingOnReconnectHook
    ? translate(locale, "native.relay.helperPrompt")
    : translate(locale, "native.relay.reconnecting");

  return (
    <SidebarCompactActionCard
      actionAriaLabel={translate(
        locale,
        isConnected ? "native.relay.connected" : "native.relay.connect",
      )}
      actionDisabled={isActionDisabled || isReconnectPending || isConnected}
      actionTestId={actionTestId}
      description={
        isConnected
          ? undefined
          : isReconnectPending
            ? reconnectDescription
            : translate(locale, "native.relay.clickToConnect")
      }
      dismissClassName={dismissClassName}
      dismissLabel={translate(locale, "native.relay.dismissNotification")}
      iconKey={
        isConnected ? "connected" : isReconnectPending ? "pending" : "idle"
      }
      icon={
        isConnected ? (
          <Check aria-hidden="true" className="h-5 w-5" />
        ) : isReconnectPending ? (
          <Spinner aria-hidden="true" className="h-5 w-5 border-2" />
        ) : (
          <CloudOff aria-hidden="true" className="h-5 w-5" />
        )
      }
      className={className}
      onAction={onReconnect}
      onDismiss={onDismiss}
      role={isConnected ? "status" : "alert"}
      surface={surface}
      testId={testId}
      title={
        isConnected
          ? translate(locale, "native.relay.connected")
          : isReconnectPending
            ? reconnectTitle
            : translate(locale, "native.relay.unreachable")
      }
      tone={isConnected ? "success" : "neutral"}
    />
  );
}
