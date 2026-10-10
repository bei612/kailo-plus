// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/messages/useChannelTyping.ts: native receive consumer.
// The shared original state is ephemeral; neither history nor unread changes.
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { verifyEvent } from "nostr-tools/pure";
import {
  emptyTypingState, pruneTypingState, receiveTypingEvent, typingEntries,
  TYPING_PRUNE_INTERVAL_MS,
} from "@client-kit/platform/react/messages/typingState";
import { useNativeSession } from "@/features/platform/activeCommunity";
import { relayClient } from "@/shared/api/relayClient";
import type { Channel, RelayEvent } from "@/shared/api/types";

export function useChannelTyping(channel: Channel | null, currentPubkey?: string, relaySelfPubkey?: string | null) {
  const session = useNativeSession();
  const client = session.client;
  const channelId = channel?.id ?? null;
  const enabled = Boolean(channelId && channel?.channelType !== "forum" && channel?.isMember && !channel?.archivedAt && currentPubkey);
  const scope = JSON.stringify([session.facts.relayUrl, channelId, currentPubkey, enabled]);
  const [state, setState] = useState(() => ({ scope, client, typing: emptyTypingState() }));
  const clear = useEffectEvent(() => setState({ scope, client, typing: emptyTypingState() }));
  const receiveMessage = useEffectEvent((event: RelayEvent) => {
    if (!enabled || !channelId || relayClient.getConnectionState() !== "connected") return;
    // Native WS data is untrusted before signature validation; malformed
    // envelopes must not throw into the shared subscription dispatcher.
    try { if (!verifyEvent(event)) return; } catch { return; }
    if (event.pubkey.toLowerCase() === currentPubkey?.toLowerCase()
      || event.tags.filter(tag => tag[0] === "h").length !== 1) return;
    setState(previous => ({ scope, client, typing: receiveTypingEvent(
      previous.scope === scope && previous.client === client ? previous.typing : emptyTypingState(),
      event, channelId, Date.now(), relaySelfPubkey,
    ) }));
  });
  useEffect(() => {
    clear();
    if (!enabled || !channelId) return;
    let disposed = false;
    let cleanup: (() => Promise<void>) | undefined;
    const disposeConnection = relayClient.subscribeToConnectionState(connection => {
      if (!disposed && connection !== "connected") clear();
    });
    relayClient.subscribeToTypingIndicators(channelId, event => {
      if (!disposed) receiveMessage(event);
    }, () => { if (!disposed) clear(); }).then(dispose => {
      if (disposed) void dispose();
      else cleanup = dispose;
    }).catch(error => {
      if (!disposed) {
        clear();
        console.error("Failed to subscribe to typing indicators", channelId, error);
      }
    });
    return () => {
      disposed = true;
      disposeConnection();
      if (cleanup) void cleanup();
    };
  }, [scope, client, enabled, channelId]);
  const active = state.scope === scope && state.client === client && enabled && Object.keys(state.typing.typing).length > 0;
  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => setState(previous => previous.scope === scope && previous.client === client
      ? {scope, client, typing: pruneTypingState(previous.typing)} : previous), TYPING_PRUNE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [active, scope, client]);
  return {
    typingEntries: useMemo(() => state.scope === scope && state.client === client && enabled ? typingEntries(state.typing) : [], [state, scope, client, enabled]),
    receiveMessage,
  };
}
