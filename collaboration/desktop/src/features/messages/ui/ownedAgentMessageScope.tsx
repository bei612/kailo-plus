// DD-142: the channel's owned-Agent set for the shared message rows (main timeline and thread
// panel). The channel pane provides it once; rows read it to offer the original edit/delete on
// an owned Agent's message. A private conversation provides none.
import * as React from "react";
import { canManageDesktopMessage, ownedAgentScope } from "@/features/messages/lib/ownedAgentMessages";
import type { TimelineMessage } from "@/features/messages/types";

const OwnedAgentPubkeysContext = React.createContext<ReadonlySet<string> | undefined>(undefined);

export function OwnedAgentMessageScopeProvider({ channelType, ownedAgentPubkeys, children }: {
  channelType: string | null | undefined;
  ownedAgentPubkeys: ReadonlySet<string> | undefined;
  children: React.ReactNode;
}) {
  return <OwnedAgentPubkeysContext.Provider value={ownedAgentScope(channelType, ownedAgentPubkeys)}>
    {children}
  </OwnedAgentPubkeysContext.Provider>;
}

export function useOwnedAgentPubkeys(): ReadonlySet<string> | undefined {
  return React.useContext(OwnedAgentPubkeysContext);
}

/** The row's edit/delete handlers, offered only when the viewer may manage this message. */
export function useManagedMessageActions<Handler>(
  message: TimelineMessage,
  currentPubkey: string | null | undefined,
  actions: { onEdit?: Handler; onDelete?: Handler },
): { onEdit?: Handler; onDelete?: Handler } {
  const owned = useOwnedAgentPubkeys();
  const manageable = canManageDesktopMessage(message, currentPubkey, owned);
  return { onEdit: manageable ? actions.onEdit : undefined, onDelete: manageable ? actions.onDelete : undefined };
}
