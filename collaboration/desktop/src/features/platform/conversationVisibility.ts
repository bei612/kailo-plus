import { type ConversationVisibilityHost, DM_VISIBILITY_KIND, hiddenConversationChannels } from "@client-kit/platform/react/new-message";
import { TransportError } from "@client-kit/platform/transport";
import { relayClient } from "@/shared/api/relayClient";
import { invokeTauri, signRelayEvent } from "@/shared/api/tauri";
import { classifyRelayPublishFailure } from "@/shared/api/relayPublishOutcome";
import { KIND_DM_HIDE, KIND_DM_OPEN } from "@/shared/constants/kinds";

/** Original local-key publisher, scoped to this mounted identity and community. */
export function createConversationVisibility(viewer: string, active: () => boolean): ConversationVisibilityHost {
  const check = () => { if (!active()) throw new Error("Relay identity changed"); };
  return {
    read: async () => {
      check();
      const relayPubkey = await invokeTauri<string | null>("get_relay_self");
      if (!relayPubkey) throw new Error("Relay signing identity missing");
      check();
      const events = await relayClient.fetchEvents({kinds: [DM_VISIBILITY_KIND], authors: [relayPubkey], "#p": [viewer], "#d": [viewer], limit: 1});
      check();
      return hiddenConversationChannels(events, {relayPubkey, viewer});
    },
    prepare: async (conversation, hidden) => {
      check();
      const event = await signRelayEvent({kind: hidden ? KIND_DM_HIDE : KIND_DM_OPEN, content: "", tags: [["h", conversation.channelId]]});
      check();
      if (event.pubkey !== viewer) throw new Error("Relay signing identity changed");
      return async () => {
        check();
        try { await relayClient.publishEvent(event, "DM visibility outcome unknown", "DM visibility send failed"); }
        catch (error) {
          if (classifyRelayPublishFailure(error)?.kind === "outcomeUnknown") throw new TransportError("DM visibility outcome unknown");
          throw error;
        }
        check();
      };
    },
  };
}
