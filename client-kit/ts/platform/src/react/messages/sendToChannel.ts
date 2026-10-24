// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/messages/lib/canSendToChannel.ts::canSendMessageToChannel and
// desktop/src/features/messages/ui/useStableSendToChannel.ts. The original menu item
// is offered on ordinary, settled thread replies the viewer may manage: their own, or
// one signed by an Agent they own. Kailo hosts only offer it; Core re-reads the reply
// and decides authorship, copied tags and audience (DD-125(1)).
import * as React from "react";
import { newIdempotencyKey } from "../../governance";
import { isOutcomeUnknown } from "../../transport";
import type { TimelineMessage } from "./types";

const KIND_STREAM_MESSAGE = 9;

export function canSendMessageToChannel(
  message: TimelineMessage,
  ownPubkeys: ReadonlySet<string>,
  ownedAgentPubkeys?: ReadonlySet<string>,
): boolean {
  const signer = (message.signerPubkey ?? message.pubkey ?? "").toLowerCase();
  return message.kind === KIND_STREAM_MESSAGE && !message.pending && signer.length > 0 &&
    (ownPubkeys.has(signer) || ownedAgentPubkeys?.has(signer) === true);
}

/**
 * Original canManageMessageForCurrentUser for edit/delete (DD-142): a settled stream message the
 * viewer signed, or, in a Workspace channel only, one signed by an Agent whose ACTIVE Installation
 * the viewer owns. Hosts only offer the action; Core re-checks ownership and `manage` and signs as
 * that Agent.
 */
export function canManageMessageForCurrentUser(
  message: TimelineMessage,
  ownPubkey: string | null | undefined,
  ownedAgentPubkeys?: ReadonlySet<string>,
): boolean {
  const signer = (message.signerPubkey ?? "").toLowerCase();
  if (message.kind !== KIND_STREAM_MESSAGE || message.pending || signer.length === 0) return false;
  return (ownPubkey ?? "").toLowerCase() === signer || ownedAgentPubkeys?.has(signer) === true;
}

/**
 * One publication intent per source reply (DD-81): while an earlier attempt's outcome
 * is unknown, a retry reuses its idempotency key so Core answers that attempt instead
 * of signing a second copy. A confirmed or refused attempt releases the key.
 */
export function useSendToChannelIntent(
  publish: (sourceEventId: string, idempotencyKey: string) => Promise<unknown>,
): (message: TimelineMessage) => Promise<void> {
  const publishRef = React.useRef(publish);
  React.useLayoutEffect(() => { publishRef.current = publish; }, [publish]);
  const pending = React.useRef(new Map<string, string>());
  return React.useCallback(async (message: TimelineMessage) => {
    const key = pending.current.get(message.id) ?? newIdempotencyKey();
    pending.current.set(message.id, key);
    try {
      await publishRef.current(message.id, key);
      pending.current.delete(message.id);
    } catch (error) {
      if (!isOutcomeUnknown(error)) pending.current.delete(message.id);
      throw error;
    }
  }, []);
}
