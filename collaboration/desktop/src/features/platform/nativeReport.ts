// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/shared/api/moderation.ts::submitReport.
// DD-125(2): 1984 is in the member whitelist and native clients publish it directly with this
// device's CLIENT key (DD-75). Tags are the original ["p", author] and ["e", event, type]; the note
// is the content. An unknown publish outcome keeps the signed event for this intent, so a retry
// resends the same event and never re-signs; it is reported as unknown, never success or failure.
import * as React from "react";
import type { NativeReportPublisher } from "@client-kit/platform/react/moderation";
import { relayClient } from "@/shared/api/relayClient";
import { classifyRelayPublishFailure } from "@/shared/api/relayPublishOutcome";
import { signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";
import { KIND_REPORT } from "@/shared/constants/kinds";
import { useNativeSession } from "@/features/platform/activeCommunity";

const unconfirmed = new Map<string, RelayEvent>();

export function reportTags(authorPubkey: string, eventId: string, reportType: string): string[][] {
  return [["p", authorPubkey.trim().toLowerCase()], ["e", eventId, reportType]];
}

export function useNativeReportPublisher(): NativeReportPublisher {
  const session = useNativeSession();
  const viewer = session.devicePubkey;
  const relayUrl = session.facts.relayUrl;
  return React.useCallback<NativeReportPublisher>(async (input) => {
    const intent = JSON.stringify([relayUrl, viewer, input.eventId, input.reportType, input.note ?? ""]);
    let event = unconfirmed.get(intent);
    if (!event) {
      event = await signRelayEvent({ kind: KIND_REPORT, content: input.note ?? "",
        tags: reportTags(input.authorPubkey, input.eventId, input.reportType) });
      if (event.pubkey !== viewer) throw new Error("Relay signing identity changed");
    }
    try {
      await relayClient.publishEvent(event, "Report outcome unknown", "Report rejected");
    } catch (error) {
      if (classifyRelayPublishFailure(error)?.kind === "outcomeUnknown") {
        unconfirmed.set(intent, event);
        return "unknown";
      }
      unconfirmed.delete(intent);
      throw error;
    }
    unconfirmed.delete(intent);
    return "done";
  }, [relayUrl, viewer]);
}
