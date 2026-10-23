// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/messages/ui/MessageAgentAddressPrefix.tsx::{useMessageAgentAddressPrefix,
// MessageAgentAddressPrefix}. DD-148: the address-tray recipients of a message, limited to Agents the
// host knows in this channel and not already mentioned inline. Uses the shared inline chip only.
import * as React from "react";
import { InlineChip } from "./system/InlineChip";
import { getAgentAddressMentionPubkeys, getVisibleAgentAddressPubkeys } from "./agentAddress";

/** Host knowledge of this channel's Agents (the admitted composer directory). */
export type AgentAddressHost = {
  isKnownAgent: (pubkey: string) => boolean;
  labelFor: (pubkey: string) => string | null;
};

export function useMessageAgentAddressPrefix(host: AgentAddressHost | undefined, body: string,
  tags: readonly (readonly string[])[] | undefined): React.ReactNode {
  return React.useMemo(() => {
    if (!host) return null;
    const pubkeys = getVisibleAgentAddressPubkeys(body,
      getAgentAddressMentionPubkeys(tags).filter(host.isKnownAgent), host.labelFor);
    return pubkeys.length > 0 ? <MessageAgentAddressPrefix host={host} pubkeys={pubkeys} /> : null;
  }, [host, body, tags]);
}

export function MessageAgentAddressPrefix({ host, pubkeys }: { host: AgentAddressHost; pubkeys: readonly string[] }) {
  return <span className="inline" data-testid="message-agent-address-prefix">
    {pubkeys.map((pubkey) => <React.Fragment key={pubkey}>
      <InlineChip className="agent-mention-highlight" data-mention="" icon="agent">
        {host.labelFor(pubkey) ?? `${pubkey.slice(0, 8)}…`}
      </InlineChip>{" "}
    </React.Fragment>)}
  </span>;
}
