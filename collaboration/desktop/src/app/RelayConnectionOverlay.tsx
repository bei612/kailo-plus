import { RelayConnectionOverlay as SharedRelayConnectionOverlay } from "@client-kit/platform/react/sidebar/relay-connection-overlay";

import type { useSidebarRelayConnectionCard } from "@/features/sidebar/ui/useSidebarRelayConnectionCard";
import { useRelayConnection } from "@/shared/api/useRelayConnection";

type RelayConnectionOverlayProps = {
  card: ReturnType<typeof useSidebarRelayConnectionCard>;
  errorMessage?: string;
};

/**
 * The original collapsed-sidebar reconnect overlay; its body is shared with Web in client-kit
 * (REQ-24). Desktop supplies its relay client connection state.
 */
export function RelayConnectionOverlay({
  card,
  errorMessage,
}: RelayConnectionOverlayProps) {
  const connectionState = useRelayConnection();
  return (
    <SharedRelayConnectionOverlay
      card={card}
      errorMessage={errorMessage}
      isDisconnected={connectionState === "disconnected"}
    />
  );
}
